import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  moduleFor,
  type MissionManual,
  type MissionStanding,
  type MissionStats,
  type RunOutcome,
  type RunReport,
} from '@escapelab/core';
import { apiResponse, serveRuns, statsResponse, type RunsExport } from '../src/api.js';
import { MissionCatalog } from '../src/missions.js';
import { RunStats } from '../src/runStats.js';

const shipped = new MissionCatalog(fileURLToPath(new URL('../../../missions', import.meta.url)));

function manualOf(catalog: MissionCatalog, id: string): MissionManual {
  const res = apiResponse(catalog, `/missions/${id}/manual`);
  expect(res?.status).toBe(200);
  return res?.body as MissionManual;
}

/** A maze read at two places and a whole-crew press nobody reads for. */
const probe = {
  id: 'probe',
  title: 'Probe',
  story: { intro: '', win: '', lose: '' },
  timeLimitSec: 600,
  players: { min: 2, max: 2 },
  puzzles: [
    { type: 'maze', id: 'netz', title: 'Leitungsnetz' },
    { type: 'button-sync', id: 'start', title: 'Start' },
  ],
  map: {
    tiles: ['#######', '#.....#', '#######'],
    spawns: [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ],
    stations: [
      { puzzleId: 'netz', x: 3, y: 1 },
      { puzzleId: 'start', x: 4, y: 1 },
    ],
    manuals: [
      {
        id: 'plan',
        kind: 'terminal',
        label: 'SCHALTPLAN',
        puzzleIds: ['netz'],
        spots: [{ x: 5, y: 1 }],
      },
      {
        id: 'tafel',
        kind: 'chart',
        label: 'WANDTAFEL',
        puzzleIds: ['netz'],
        spots: [{ x: 1, y: 1 }],
      },
    ],
  },
};

describe('GET /missions/:id/manual', () => {
  it('has one chapter per puzzle, in mission order, for every shipped mission', () => {
    for (const mission of shipped.all) {
      const manual = manualOf(shipped, mission.id);
      expect(manual.missionTitle).toBe(mission.title);
      expect(manual.hintCostSec).toBe(mission.hintCostSec);
      expect(manual.stations).toHaveLength(mission.puzzles.length);
      for (const [i, def] of mission.puzzles.entries()) {
        const station = manual.stations[i];
        expect(station?.index).toBe(i);
        expect(station?.title).toBe(def.title);
        expect(station?.usesEdgework).toBe(moduleFor(def.type).usesEdgework);
        expect(station?.manual).toEqual(moduleFor(def.type).manual(def));
      }
    }
  });

  it('names where in the lab each station\'s rules lie, and nowhere where everyone presses', () => {
    const dir = mkdtempSync(join(tmpdir(), 'escapelab-manual-'));
    try {
      writeFileSync(join(dir, 'probe.json'), JSON.stringify(probe));
      const manual = manualOf(new MissionCatalog(dir), 'probe');
      expect(manual.stations.map(({ readAt }) => readAt)).toEqual([
        ['SCHALTPLAN', 'WANDTAFEL'],
        [],
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('answers an unknown or garbled mission id with 404 and a message', () => {
    for (const id of ['gibt-es-nicht', '%E0%A4%A']) {
      const res = apiResponse(shipped, `/missions/${id}/manual`);
      expect(res?.status).toBe(404);
      expect(res?.body).toEqual({ error: expect.stringContaining('gibt es nicht') });
    }
  });

  it('leaves every other path to the static site', () => {
    expect(apiResponse(shipped, '/')).toBeNull();
    expect(apiResponse(shipped, '/missions/blackout/extra')).toBeNull();
    expect(apiResponse(shipped, '/missions/blackout/manual/extra')).toBeNull();
  });
});

describe('GET /stats', () => {
  const DAY = Date.UTC(2026, 9, 20, 12, 0);

  /** A run on blackout as the server logs it, by Anna and Ben in room QXT4. */
  function run(seconds: number, at: number, outcome: RunOutcome = 'won'): RunReport {
    return {
      version: 2,
      missionId: 'blackout',
      roomCode: 'QXT4',
      difficulty: 'normal',
      timeLimitSec: 480,
      alarmLimit: 5,
      crewSize: 2,
      crew: ['Anna', 'Ben'],
      spawns: { p1: { x: 1, y: 1 }, p2: { x: 2, y: 1 } },
      startedAt: at - seconds * 1000,
      finishedAt: at,
      outcome,
      stations: [],
      emergencies: { count: 0, failed: 0 },
      penalties: [],
      credits: {},
    };
  }

  const stats = new RunStats([
    run(400, DAY),
    run(300, DAY + 1),
    run(480, DAY + 2, 'lost:time'),
    { ...run(500, DAY + 3), missionId: 'abgeschafft' },
  ]);
  const ask = (url: string) => statsResponse(stats, shipped, url);

  it('lists every mission with runs, its crews by name and nothing else', () => {
    const res = ask('/stats');
    expect(res).toEqual({ status: 200, body: stats.all() });
    const body = res?.body as MissionStats[];
    expect(body.map((mission) => mission.missionId)).toEqual(['abgeschafft', 'blackout']);
    const text = JSON.stringify(body);
    expect(text).toContain('"crew":["Anna","Ben"]');
    for (const secret of ['QXT4', 'p1', 'spawns', 'credits']) {
      expect(text).not.toContain(secret);
    }
  });

  it('answers one mission: its stats, none yet where the catalog has it unplayed', () => {
    expect(ask('/stats/blackout')).toEqual({
      status: 200,
      body: { ...stats.mission('blackout'), place: null },
    });
    expect(ask('/stats/systemcheck?run=1')).toEqual({
      status: 200,
      body: { missionId: 'systemcheck', difficulties: [], place: null },
    });
    // A mission gone from the catalog keeps its runs.
    expect(ask('/stats/abgeschafft')?.status).toBe(200);
  });

  it('places the won run that finished at ?run=, and no lost one', () => {
    const placed = (url: string): MissionStanding['place'] =>
      (ask(url)?.body as MissionStanding).place;
    expect(placed(`/stats/blackout?run=${DAY}`)).toEqual({ difficulty: 'normal', place: 2 });
    expect(placed(`/stats/blackout?fresh=1&run=${DAY + 1}`)).toEqual({
      difficulty: 'normal',
      place: 1,
    });
    expect(placed(`/stats/blackout?run=${DAY + 2}`)).toBeNull();
    expect(placed(`/stats/blackout?run=${DAY + 99}`)).toBeNull();
  });

  it('turns away a mission nobody knows with 404, and a ?run= that is no time with 400', () => {
    for (const id of ['gibt-es-nicht', '%E0%A4%A']) {
      expect(ask(`/stats/${id}`)).toEqual({
        status: 404,
        body: { error: expect.stringContaining('gibt es nicht') },
      });
    }
    for (const run of ['', 'gestern', '-5', '1.5']) {
      expect(ask(`/stats/blackout?run=${run}`)).toEqual({
        status: 400,
        body: { error: expect.stringContaining('?run=') },
      });
    }
  });

  it('leaves every other path to the rest of the server', () => {
    for (const url of ['/', '/statistik', '/stats/blackout/runs', '/missions']) {
      expect(ask(url), url).toBeNull();
    }
  });
});

interface Answer {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** A writable the log can be piped into, recording the answer instead of sending it. */
function fakeResponse(): { res: ServerResponse; answered: Promise<Answer> } {
  const answer: Answer = { status: 0, headers: {}, body: '' };
  const res = Object.assign(new PassThrough(), {
    writeHead(status: number, headers: Record<string, string> = {}) {
      Object.assign(answer, { status, headers });
      return res;
    },
  });
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  const answered = new Promise<Answer>((resolve) =>
    res.on('end', () => resolve({ ...answer, body: Buffer.concat(chunks).toString('utf8') })),
  );
  return { res: res as unknown as ServerResponse, answered };
}

function get(url: string, authorization?: string): IncomingMessage {
  const headers = authorization === undefined ? {} : { authorization };
  return { url, method: 'GET', headers } as IncomingMessage;
}

describe('GET /runs.jsonl', () => {
  const dir = mkdtempSync(join(tmpdir(), 'escapelab-runs-route-'));
  const file = join(dir, 'runs.jsonl');
  writeFileSync(file, '{"version":1,"missionId":"a"}\n{"version":1,"missionId":"b"}\n');
  const withToken: RunsExport = { file, token: 'geheim-42' };

  async function ask(runs: RunsExport, req: IncomingMessage): Promise<Answer> {
    const { res, answered } = fakeResponse();
    expect(serveRuns(runs, req, res)).toBe(true);
    return answered;
  }

  it('is not there while RUNS_TOKEN is unset or empty, whatever the request carries', async () => {
    for (const token of [undefined, '']) {
      for (const authorization of [undefined, 'Bearer ', 'Bearer geheim-42']) {
        const answer = await ask({ file, token }, get('/runs.jsonl', authorization));
        expect(answer).toEqual({ status: 404, headers: {}, body: '' });
      }
    }
  });

  it('turns a request away without the token, or with any other', async () => {
    const tries = [undefined, '', 'Bearer', 'Bearer geheim', 'Basic geheim-42', 'geheim-42'];
    for (const authorization of [...tries, 'Bearer geheim-42 nochwas']) {
      const answer = await ask(withToken, get('/runs.jsonl', authorization));
      expect(answer, String(authorization)).toEqual({
        status: 401,
        headers: { 'www-authenticate': 'Bearer' },
        body: '',
      });
    }
  });

  it('hands the log out for the token', async () => {
    for (const authorization of ['Bearer geheim-42', 'bearer  geheim-42']) {
      const answer = await ask(withToken, get('/runs.jsonl?fresh=1', authorization));
      expect(answer.status).toBe(200);
      expect(answer.headers['content-type']).toBe('application/x-ndjson; charset=utf-8');
      expect(answer.body).toBe(readFileSync(file, 'utf8'));
    }
  });

  it('hands out an empty log until the first run has finished', async () => {
    const before = { file: join(dir, 'noch-leer', 'runs.jsonl'), token: 'geheim-42' };
    const answer = await ask(before, get('/runs.jsonl', 'Bearer geheim-42'));
    expect(answer).toMatchObject({ status: 200, body: '' });
  });

  it('leaves every other path and method to the rest of the server', () => {
    const { res } = fakeResponse();
    const post = { ...get('/runs.jsonl', 'Bearer geheim-42'), method: 'POST' } as IncomingMessage;
    expect(serveRuns(withToken, get('/runs'), res)).toBe(false);
    expect(serveRuns(withToken, get('/runs.jsonl/x', 'Bearer geheim-42'), res)).toBe(false);
    expect(serveRuns(withToken, post, res)).toBe(false);
  });
});

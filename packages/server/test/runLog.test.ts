import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  initialState,
  parseMission,
  runReport,
  type Mission,
  type RunReport,
  type ServerMessage,
} from '@escapelab/core';
import { RoomManager } from '../src/roomManager.js';
import { appendRun, parseRuns, readRuns } from '../src/runLog.js';
import type { Room } from '../src/room.js';
import { walkTo, type Walker } from './walk.js';

/**
 * Two presses for the whole crew along a corridor and the hatch between
 * them, below.
 *
 *   0123456
 * 0 #######
 * 1 #.1.2.#   stations (2,1) and (4,1); spawns (1,1) and (5,1)
 * 2 #..H..#   hatch (3,2)
 * 3 #######
 */
const mission: Mission = parseMission({
  id: 'protokollraum',
  title: 'Protokoll-Raum',
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  players: { min: 2, max: 2 },
  puzzles: ['erste', 'zweite'].map((id) => ({ type: 'button-sync', id, title: id })),
  map: {
    tiles: ['#######', '#.....#', '#.....#', '#######'],
    spawns: [
      { x: 1, y: 1 },
      { x: 5, y: 1 },
    ],
    stations: [
      { puzzleId: 'erste', x: 2, y: 1 },
      { puzzleId: 'zweite', x: 4, y: 1 },
    ],
    exit: { x: 3, y: 2 },
  },
});

/** A report as a finished run leaves one: this lab, lost on time before anybody joined in. */
function someReport(): RunReport {
  const lost = { ...initialState(mission), phase: 'lost' as const, startedAt: 1, finishedAt: 2 };
  return runReport(lost, 'QXT4');
}

/** `report` as version 1 wrote it, before names and the room went in. */
function asVersion1(report: RunReport): string {
  const old: Record<string, unknown> = { ...report, version: 1 };
  delete old['crew'];
  delete old['roomCode'];
  return JSON.stringify(old);
}

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'escapelab-runs-'));
});

const linesOf = (file: string): string[] => readFileSync(file, 'utf8').trimEnd().split('\n');

describe('appendRun', () => {
  it('puts every run on a line of its own, in a directory made on demand', () => {
    const file = join(dir, 'neu', 'tief', 'runs.jsonl');
    appendRun(file, someReport());
    appendRun(file, someReport());
    expect(linesOf(file).map((line) => JSON.parse(line))).toEqual([someReport(), someReport()]);
  });

  it('says whether the line was written', () => {
    expect(appendRun(join(dir, 'runs.jsonl'), someReport())).toBe(true);
  });

  it('logs a write that fails instead of throwing it', () => {
    const blocker = join(dir, 'datei');
    writeFileSync(blocker, 'kein Ordner');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(appendRun(join(blocker, 'runs.jsonl'), someReport())).toBe(false);
      expect(logged).toHaveBeenCalledWith(expect.stringContaining(join(blocker, 'runs.jsonl')));
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('RUNS_LOG'));
    } finally {
      logged.mockRestore();
    }
  });
});

describe('parseRuns', () => {
  it('reads the runs back in order, past blank lines', () => {
    const report = someReport();
    const text = `${JSON.stringify(report)}\n\n${JSON.stringify({ ...report, startedAt: 5 })}\n`;
    expect(parseRuns(text, 'runs.jsonl').map((run) => run.startedAt)).toEqual([1, 5]);
    expect(parseRuns('', 'runs.jsonl')).toEqual([]);
  });

  it('reads the reports of version 1, without names, and of version 2 side by side', () => {
    const report = someReport();
    const text = `${asVersion1(report)}\n${JSON.stringify({ ...report, crew: ['Anna', 'Ben'] })}\n`;
    const [old, named] = parseRuns(text, 'runs.jsonl');
    expect(old).toMatchObject({ version: 1, missionId: 'protokollraum' });
    expect(old).not.toHaveProperty('crew');
    expect(named).toMatchObject({ version: 2, roomCode: 'QXT4', crew: ['Anna', 'Ben'] });
  });

  it('names the line that is no run report', () => {
    const good = JSON.stringify(someReport());
    expect(() => parseRuns(`${good}\n{"version":2,`, 'runs.jsonl')).toThrow(
      /^runs\.jsonl:2: not JSON/,
    );
    const broken = [
      good.replace('"version":2', '"version":3'),
      // version 2 without its names, or with a name that is none
      asVersion1(someReport()).replace('"version":1', '"version":2'),
      good.replace('"crew":[]', '"crew":[7]'),
      good.replace('"difficulty":"normal"', '"difficulty":"extrem"'),
      good.replace('"outcome":"lost:time"', '"outcome":"vielleicht"'),
      '[1,2]',
    ];
    for (const line of broken) {
      expect(() => parseRuns(`${good}\n${line}`, 'r'), line).toThrow(
        /^r:2: not a run report of version 1 or 2 — fix or delete that line$/,
      );
    }
  });

  it('reads on past a line that holds no run, for whoever must not stop at it', () => {
    const good = JSON.stringify(someReport());
    const { runs, problems } = readRuns(`${good}\nkaputt\n\n${good}\n{}`, 'runs.jsonl');
    expect(runs).toHaveLength(2);
    expect(problems).toEqual([
      expect.stringMatching(/^runs\.jsonl:2: not JSON/),
      'runs.jsonl:5: not a run report of version 1 or 2 — fix or delete that line',
    ]);
  });
});

/** `name` joins, and everything the room pushes to them is kept. */
function seat(room: Room, name: string): Walker {
  const messages: ServerMessage[] = [];
  const { playerId } = room.join(name);
  room.attach(playerId, (m) => messages.push(m));
  return { playerId, messages };
}

function phaseOf(walker: Walker): string | undefined {
  const last = walker.messages.filter((m) => m.kind === 'view').at(-1);
  return last?.kind === 'view' ? last.view.phase : undefined;
}

describe('a room', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const moveTo = (room: Room, walker: Walker, x: number, y: number): void =>
    walkTo(room, walker, x + 0.5, y + 0.5);

  /** Both at the station, switched on, both press. */
  function solveAt(room: Room, x: number, anna: Walker, ben: Walker): void {
    moveTo(room, ben, x, 1);
    moveTo(room, anna, x, 2);
    room.act(ben.playerId, { kind: 'interact' });
    room.act(anna.playerId, { kind: 'puzzle-input', input: { press: true } });
    room.act(ben.playerId, { kind: 'puzzle-input', input: { press: true } });
  }

  /** A room of the manager whose runs go to `file`, with Anna and Ben in a started run. */
  function startedRoom(file: string) {
    const room = new RoomManager((report) => appendRun(file, report)).create(mission);
    const anna = seat(room, 'Anna');
    const ben = seat(room, 'Ben');
    room.act(ben.playerId, { kind: 'set-ready', ready: true });
    room.act(anna.playerId, { kind: 'start-mission' });
    return { room, anna, ben };
  }

  it('appends a line for every run that ends, a rematch on its own line', () => {
    const file = join(dir, 'runs.jsonl');
    const { room, anna, ben } = startedRoom(file);
    expect(existsSync(file)).toBe(false);

    // The first run runs out of time.
    vi.advanceTimersByTime(mission.timeLimitSec * 1000 + 1);
    expect(phaseOf(anna)).toBe('lost');
    expect(linesOf(file)).toHaveLength(1);

    // Both confirm, the rematch starts by itself, and this time the crew gets out.
    room.act(ben.playerId, { kind: 'set-ready', ready: true });
    room.act(anna.playerId, { kind: 'set-ready', ready: true });
    vi.advanceTimersByTime(10_000);
    solveAt(room, 2, anna, ben);
    vi.advanceTimersByTime(20_000);
    solveAt(room, 4, anna, ben);
    moveTo(room, ben, 3, 2);
    moveTo(room, anna, 3, 2);
    expect(phaseOf(anna)).toBe('won');

    const text = readFileSync(file, 'utf8');
    const [lost, won, ...more] = parseRuns(text, file);
    expect(more).toEqual([]);
    expect(lost).toMatchObject({ missionId: 'protokollraum', outcome: 'lost:time', crewSize: 2 });
    const rematchAt = (lost?.finishedAt ?? 0) + 1;
    expect(won).toMatchObject({
      outcome: 'won',
      startedAt: rematchAt,
      finishedAt: rematchAt + 30_000,
      stations: [
        { puzzleId: 'erste', openedAt: rematchAt, seconds: 10, alarms: 0 },
        { puzzleId: 'zweite', openedAt: rematchAt + 10_000, seconds: 20, alarms: 0 },
      ],
    });
    // The crew goes by the names it played under, in the order it joined, and the room by its
    // code; nobody by id.
    for (const run of [lost, won]) {
      expect(run).toMatchObject({ version: 2, roomCode: room.code, crew: ['Anna', 'Ben'] });
    }
    for (const id of [anna.playerId, ben.playerId]) {
      expect(text).not.toContain(id);
    }
    room.dispose();
  });

  it('plays on when the line cannot be written', () => {
    const blocker = join(dir, 'datei');
    writeFileSync(blocker, 'kein Ordner');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { room, anna } = startedRoom(join(blocker, 'runs.jsonl'));
      vi.advanceTimersByTime(mission.timeLimitSec * 1000 + 1);
      expect(phaseOf(anna)).toBe('lost');
      expect(logged).toHaveBeenCalledOnce();
      room.dispose();
    } finally {
      logged.mockRestore();
    }
  });
});

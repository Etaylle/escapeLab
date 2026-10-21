import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMission, type Mission, type MissionInfo } from '@escapelab/core';
import { apiResponse } from '../src/api.js';
import {
  MAX_MISSION_BYTES,
  RateLimiter,
  serveCustomMissions,
  type CustomMissions,
} from '../src/customMissions.js';
import { MissionCatalog } from '../src/missions.js';

const SHIPPED = fileURLToPath(new URL('../../../missions', import.meta.url));

/** A small mission as the editor saves it: one room, two starts, a keypad and its book. */
function probe(id = 'custom-probe', title = 'Probe'): Record<string, unknown> {
  return {
    id,
    title,
    subtitle: '',
    players: { min: 2, max: 2 },
    story: { intro: '', win: '', lose: '' },
    timeLimitSec: 600,
    puzzles: [{ type: 'keypad', id: 'tastenfeld', title: 'Tastenfeld' }],
    map: {
      tiles: ['#########', '#.......#', '#.......#', '#########'],
      spawns: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
      ],
      stations: [{ puzzleId: 'tastenfeld', x: 6, y: 1 }],
      manuals: [
        {
          id: 'quelle-1',
          kind: 'book',
          label: 'HANDBUCH',
          puzzleIds: ['tastenfeld'],
          spots: [{ x: 6, y: 2 }],
        },
      ],
    },
  };
}

interface Answer {
  status: number;
  body: Record<string, unknown>;
}

/** A request as the server sees one: method, path, the sender's address and its body. */
function request(method: string, url: string, body?: string, from = '10.0.0.5'): IncomingMessage {
  const chunks = body === undefined ? [] : [Buffer.from(body)];
  const headers = body === undefined ? {} : { 'content-length': String(Buffer.byteLength(body)) };
  return Object.assign(Readable.from(chunks), {
    method,
    url,
    headers,
    socket: { remoteAddress: from },
  }) as unknown as IncomingMessage;
}

/** Sends a request to the routes and waits for the answer; null when they leave it alone. */
async function ask(editing: CustomMissions, req: IncomingMessage): Promise<Answer | null> {
  let answered: (answer: Answer) => void = () => undefined;
  const done = new Promise<Answer>((resolve) => (answered = resolve));
  let status = 0;
  const res = {
    writeHead(code: number) {
      status = code;
      return res;
    },
    end(text: string) {
      answered({ status, body: JSON.parse(text) as Record<string, unknown> });
    },
  };
  if (!serveCustomMissions(editing, req, res as unknown as ServerResponse)) {
    return null;
  }
  return done;
}

const save = (editing: CustomMissions, mission: unknown, from?: string): Promise<Answer | null> =>
  ask(editing, request('POST', '/missions/custom', JSON.stringify(mission), from));

let dir: string;
let customDir: string;
let editing: CustomMissions;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'escapelab-custom-'));
  customDir = join(dir, 'custom');
  const catalog = new MissionCatalog(SHIPPED, customDir);
  editing = { catalog, limiter: new RateLimiter(100, 60_000) };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('the catalog with custom missions', () => {
  it('lists the custom ones after the shipped ones and marks them in GET /missions', () => {
    mkdirSync(customDir);
    const second = JSON.stringify(probe('custom-zweite', 'Zweite'));
    writeFileSync(join(customDir, 'custom-zweite.json'), second);
    writeFileSync(join(customDir, 'custom-probe.json'), JSON.stringify(probe()));
    const catalog = new MissionCatalog(SHIPPED, customDir);
    const shipped = new MissionCatalog(SHIPPED).all.map((m) => m.id);
    expect(catalog.all.map((m) => m.id)).toEqual([...shipped, 'custom-probe', 'custom-zweite']);
    const infos = apiResponse(catalog, '/missions')?.body as MissionInfo[];
    expect(infos.filter((info) => info.custom === true).map((info) => info.id)).toEqual([
      'custom-probe',
      'custom-zweite',
    ]);
    expect(infos.find((info) => info.id === 'blackout')).not.toHaveProperty('custom');
  });

  it('leaves out, with a warning, a file that is no mission or does not carry its name', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mkdirSync(customDir);
    writeFileSync(join(customDir, 'custom-kaputt.json'), '{ "id": "custom-kaputt", ');
    writeFileSync(join(customDir, 'custom-falsch.json'), JSON.stringify(probe('custom-anders')));
    writeFileSync(join(customDir, 'custom-blackout.json'), JSON.stringify(probe('blackout')));
    writeFileSync(join(customDir, 'custom-probe.json'), JSON.stringify(probe()));
    const catalog = new MissionCatalog(SHIPPED, customDir);
    expect(catalog.all.filter((m) => catalog.isCustom(m.id)).map((m) => m.id)).toEqual([
      'custom-probe',
    ]);
    expect(catalog.get('blackout').title).toBe('Blackout im Labor');
    const said = warn.mock.calls.map(([line]) => String(line));
    expect(said).toHaveLength(3);
    expect(said.find((line) => line.includes('custom-kaputt.json'))).toBeDefined();
    expect(said.find((line) => line.includes('custom-falsch.json'))).toContain('custom-anders');
  });

  it('leaves out, with a warning, a custom mission leading on to one the catalog lacks', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mkdirSync(customDir);
    const leading = (id: string, next: string): void =>
      writeFileSync(join(customDir, `${id}.json`), JSON.stringify({ ...probe(id), next }));
    leading('custom-weiter', 'blackout');
    leading('custom-kette', 'custom-probe');
    leading('custom-irrweg', 'nirgendwo');
    writeFileSync(join(customDir, 'custom-probe.json'), JSON.stringify(probe()));
    const catalog = new MissionCatalog(SHIPPED, customDir);
    const custom = catalog.all.filter((m) => catalog.isCustom(m.id)).map((m) => m.id);
    expect(custom.sort()).toEqual(['custom-kette', 'custom-probe', 'custom-weiter']);
    expect(catalog.get('custom-weiter').next).toBe('blackout');
    const said = warn.mock.calls.map(([line]) => String(line));
    expect(said).toEqual([expect.stringMatching(/custom-irrweg\.json left out: .*"nirgendwo"/)]);
  });

  it('starts without the custom directory and keeps none without one', () => {
    expect(existsSync(customDir)).toBe(false);
    expect(editing.catalog.all.some((m) => editing.catalog.isCustom(m.id))).toBe(false);
    expect(() => new MissionCatalog(SHIPPED).saveCustom(parseMission(probe()))).toThrow(
      /without a customDir/,
    );
  });
});

describe('the mission a won run leads on to', () => {
  it('is one the shipped catalog has: the tutorial leads on to Blackout', () => {
    const catalog = new MissionCatalog(SHIPPED);
    expect(catalog.get('systemcheck').next).toBe('blackout');
    expect(catalog.get(catalog.get('systemcheck').next ?? '').title).toBe('Blackout im Labor');
  });

  it('stops the server at the start where a shipped mission leads on to nothing', () => {
    const shipped = join(dir, 'shipped');
    mkdirSync(shipped);
    writeFileSync(join(shipped, 'probe.json'), JSON.stringify({ ...probe('probe'), next: 'weg' }));
    expect(() => new MissionCatalog(shipped)).toThrow(/"probe" leads on to "weg", which is no/);
  });
});

describe('POST /missions/custom', () => {
  it('writes a sound mission, and the catalog has it at once, handbook and all', async () => {
    const answer = await save(editing, probe());
    expect(answer?.status).toBe(201);
    expect(answer?.body).toMatchObject({
      id: 'custom-probe',
      info: { title: 'Probe', custom: true },
    });
    const file = readFileSync(join(customDir, 'custom-probe.json'), 'utf8');
    const written = JSON.parse(file) as Mission;
    expect(written).toEqual(parseMission(probe()));
    expect(editing.catalog.get('custom-probe').title).toBe('Probe');
    expect(apiResponse(editing.catalog, '/missions/custom-probe/manual')?.status).toBe(200);
    expect(apiResponse(editing.catalog, '/missions/custom-probe')?.body).toEqual(written);
  });

  it('replaces the mission of the same id', async () => {
    await save(editing, probe());
    const answer = await save(editing, { ...probe(), subtitle: 'Neu gefasst.' });
    expect(answer?.status).toBe(201);
    expect(editing.catalog.get('custom-probe').subtitle).toBe('Neu gefasst.');
    expect(editing.catalog.all.filter((m) => m.id === 'custom-probe')).toHaveLength(1);
  });

  it('turns an unsound mission away with every message, and writes nothing', async () => {
    const lonely = { ...probe(), map: { ...(probe()['map'] as object), spawns: [{ x: 1, y: 1 }] } };
    const answer = await save(editing, lonely);
    expect(answer?.status).toBe(400);
    const issues = answer?.body['issues'] as string[];
    expect(issues).toContain('map.spawns: Too small: expected array to have >=2 items');
    expect(issues.some((line) => line.includes('1 spawns for up to 2 players'))).toBe(true);
    expect(existsSync(join(customDir, 'custom-probe.json'))).toBe(false);
    expect(editing.catalog.find('custom-probe')).toBeUndefined();
  });

  it('takes only ids that start with custom- and could not leave the folder', async () => {
    const ids = ['probe', 'blackout', 'custom-', 'custom-../x', 'custom-Probe', 'custom-a_b'];
    for (const id of ids) {
      const answer = await save(editing, probe(id));
      expect(answer?.status, id).toBe(400);
      expect(String(answer?.body['error'])).toContain('custom-');
    }
    expect(existsSync(customDir)).toBe(false);
  });

  it('turns away a body over 256 kB, and one that is no JSON', async () => {
    const huge = { ...probe(), subtitle: 'x'.repeat(MAX_MISSION_BYTES) };
    expect((await save(editing, huge))?.status).toBe(413);
    const half = '{"id": "custom-probe"';
    const garbled = await ask(editing, request('POST', '/missions/custom', half));
    expect(garbled?.status).toBe(400);
    expect(String(garbled?.body['error'])).toContain('Kein gültiges JSON');
    expect(existsSync(customDir)).toBe(false);
  });

  it('leaves every other method and path to the rest of the server', async () => {
    expect(await ask(editing, request('GET', '/missions/custom'))).toBeNull();
    expect(await ask(editing, request('PUT', '/missions/custom', '{}'))).toBeNull();
    expect(await ask(editing, request('POST', '/missions/custom/x', '{}'))).toBeNull();
    expect(await ask(editing, request('DELETE', '/missions/blackout'))).toBeNull();
  });
});

describe('DELETE /missions/custom/:id', () => {
  it('removes a custom mission, file and all', async () => {
    await save(editing, probe());
    const answer = await ask(editing, request('DELETE', '/missions/custom/custom-probe'));
    expect(answer).toEqual({ status: 200, body: { id: 'custom-probe' } });
    expect(existsSync(join(customDir, 'custom-probe.json'))).toBe(false);
    expect(editing.catalog.find('custom-probe')).toBeUndefined();
    expect(apiResponse(editing.catalog, '/missions/custom-probe')?.status).toBe(404);
  });

  it('answers 404 for a custom mission that is not there, 400 for a shipped one', async () => {
    const missing = await ask(editing, request('DELETE', '/missions/custom/custom-weg'));
    expect(missing?.status).toBe(404);
    const shipped = await ask(editing, request('DELETE', '/missions/custom/blackout'));
    expect(shipped?.status).toBe(400);
    expect(editing.catalog.get('blackout').id).toBe('blackout');
  });
});

describe('the limit on writes', () => {
  it('lets an address write so often a minute, then says 429 till the window moves', async () => {
    let now = 0;
    editing = { catalog: editing.catalog, limiter: new RateLimiter(2, 60_000, () => now) };
    expect((await save(editing, probe()))?.status).toBe(201);
    const removed = await ask(editing, request('DELETE', '/missions/custom/custom-probe'));
    expect(removed?.status).toBe(200);
    const third = await save(editing, probe());
    expect(third?.status).toBe(429);
    expect(existsSync(join(customDir, 'custom-probe.json'))).toBe(false);
    expect((await save(editing, probe(), '10.0.0.6'))?.status).toBe(201);
    now = 60_000;
    expect((await save(editing, probe()))?.status).toBe(201);
  });
});

describe('GET /missions/:id', () => {
  it('hands out a whole mission for the editor to start from; 404 for an unknown one', () => {
    const catalog = new MissionCatalog(SHIPPED);
    expect(apiResponse(catalog, '/missions/blackout')).toEqual({
      status: 200,
      body: catalog.get('blackout'),
    });
    for (const id of ['gibt-es-nicht', '%E0%A4%A', 'custom']) {
      expect(apiResponse(catalog, `/missions/${id}`)?.status).toBe(404);
    }
  });
});

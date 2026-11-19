import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drawPools, type ServerMessage } from '@escapelab/core';
import { healthResponse, type Health } from '../src/api.js';
import {
  DEMO_CODE,
  DEMO_FULL,
  DEMO_IDLE_MS,
  DEMO_MAX_WATCHING,
  DemoHost,
} from '../src/demo/host.js';
import { MissionCatalog } from '../src/missions.js';
import { RoomManager } from '../src/roomManager.js';
import { DEMO_WATCH_ONLY, serveSockets } from '../src/sockets.js';
import { JsonlStore } from '../src/store/jsonl.js';
import { recordRuns } from '../src/store/store.js';
import {
  blackoutMission,
  clockOf,
  over,
  playUntil,
  seenBy,
  watch,
  type Watcher,
} from './demo.js';
import { FakeServer, type FakeSocket } from './line.js';
import { passFor } from './passes.js';

/**
 * The demo room beside the server's rooms: watched by its code with no name and no pass, joined
 * by nobody, counted apart, its runs kept nowhere; it plays run after run while somebody watches
 * and rests once nobody does.
 */

const mission = blackoutMission();
const shipped = new MissionCatalog(fileURLToPath(new URL('../../../missions', import.meta.url)));
/** A seed for each station of the Wechselplatz, in the mission's order of them. */
const SEEDS = [12, 56, 93];

let dir = '';
let hosts: DemoHost[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 10, 19, 22, 0, 0));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  dir = mkdtempSync(join(tmpdir(), 'escapelab-demo-'));
  hosts = [];
});

afterEach(() => {
  hosts.forEach((host) => host.stop());
  rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A demo host on `seeds`, stopped when the test is over. */
function demoOn(seeds: number[] = SEEDS): DemoHost {
  const host = new DemoHost(mission, seeds);
  hosts.push(host);
  return host;
}

/** A server's sockets with their rooms and `host`'s demo room; every run kept in a log in `dir`. */
function serverWith(host: DemoHost) {
  const file = join(dir, 'runs.jsonl');
  const store = JsonlStore.open(file, () => true);
  const manager = new RoomManager(recordRuns(store).record);
  const line = new FakeServer();
  serveSockets(line, { catalog: shipped, manager, demo: host });
  const health: Health = {
    rooms: () => manager.counts(),
    uptimeSec: () => 7,
    version: 'dev',
    demo: () => host.counts(),
  };
  return { file, store, manager, line, health };
}

/** What `socket` was last told it was refused. */
const refusalOf = (socket: FakeSocket): string | undefined =>
  socket.heard.filter((msg) => msg.kind === 'error').at(-1)?.message;

/** A socket that watches the demo by its code, as the menu's „Demo" does: its watcher. */
function watching(line: FakeServer): Watcher & { socket: FakeSocket } {
  const socket = line.connect();
  socket.say({ kind: 'spectate', code: DEMO_CODE });
  return { socket, heard: socket.heard as ServerMessage[], leave: () => socket.close(1000) };
}

describe('the demo room', () => {
  it('is watched by its code with no name and no pass, a run under way seen as it stands', () => {
    const host = demoOn();
    const { line } = serverWith(host);
    const first = watching(line);
    expect(refusalOf(first.socket)).toBeUndefined();
    const midway = playUntil(first, (view) => view.currentPuzzleIndex === 2);
    const late = watching(line);
    expect(seenBy(late)).toMatchObject({ phase: 'playing', currentPuzzleIndex: 2 });
    expect(seenBy(late).startedAt).toBe(midway.startedAt);
    expect(late.socket.heard.some((msg) => msg.kind === 'positions')).toBe(true);
    expect(host.counts()).toEqual({ running: true, spectators: 2, won: 0, lost: 0 });
  });

  it('takes no crew: a join by its code is told so, and no pass comes back to a seat in it', () => {
    const host = demoOn();
    const { line } = serverWith(host);
    const socket = line.connect();
    socket.say({ kind: 'join-room', code: 'demo', name: 'Anna', pass: passFor('Anna') });
    expect(refusalOf(socket)).toBe(DEMO_WATCH_ONLY);
    socket.say({ kind: 'join-room', code: DEMO_CODE, name: 'Automat A', pass: passFor('Anna') });
    expect(refusalOf(socket)).toBe(DEMO_WATCH_ONLY);
    socket.say({ kind: 'resume', code: DEMO_CODE, pass: passFor('Anna') });
    expect(refusalOf(socket)).toBe('Raum "DEMO" existiert nicht (mehr).');
    expect(seenBy(watch(host)).players.map((p) => p.name)).toEqual(['Automat A', 'Automat B']);
  });

  it('counts apart from the rooms in /health, which names no run on for it', () => {
    const host = demoOn();
    const { line, manager, health } = serverWith(host);
    const watcher = watching(line);
    playUntil(watcher, (view) => view.phase === 'playing');
    expect(healthResponse(shipped, health, '/health')?.body).toMatchObject({
      rooms: { total: 0, running: 0, paused: 0, players: 0, spectators: 0 },
      demo: { running: true, spectators: 1, won: 0, lost: 0 },
    });
    expect(manager.list()).toEqual([]);
  });

});

describe('the demo room’s runs', () => {
  it('stay out of the run log and the Bestenliste, and the next seed is played after', () => {
    const host = demoOn();
    const { line, file, store } = serverWith(host);
    const watcher = watching(line);
    const won = playUntil(watcher, over);
    expect(won.phase).toBe('won');
    expect(host.counts()).toMatchObject({ running: false, won: 1, lost: 0 });
    expect(existsSync(file)).toBe(false);
    expect(store.stats().runs).toBe(0);
    // The Auswertung stands some twenty seconds; then the next run starts by itself.
    vi.advanceTimersByTime(15_000);
    expect(seenBy(watcher).phase).toBe('won');
    const next = playUntil(watcher, (view) => view.phase === 'playing', 15);
    expect(next.startedAt).toBeGreaterThan(won.finishedAt ?? Infinity);
    const second = playUntil(watcher, over);
    expect(second.phase).toBe('won');
    expect(second.events.map((e) => e.label)).toContain('Funkpult gelöst');
    expect(won.events.map((e) => e.label)).toContain('Signalkette gelöst');
    expect(existsSync(file)).toBe(false);
    // The run after another is the run a fresh room plays on that seed, to the tick: the one
    // the crew is proved on (test/demoCrew.test.ts).
    const alone = playUntil(watch(demoOn([SEEDS[1] ?? 0])), over);
    expect(clockOf(second)).toBe(clockOf(alone));
    expect(second.penaltySeq).toBe(0);
  });

  it('plays its seeds in turn, round and round', () => {
    const logged = vi.mocked(console.log);
    const host = demoOn([12, 56]);
    const watcher = watch(host);
    for (let run = 0; run < 3; run++) {
      playUntil(watcher, (view) => view.phase === 'playing', 40);
      playUntil(watcher, over);
    }
    const seeds = logged.mock.calls.map(([line]) => /plays seed (\d+)/.exec(String(line))?.[1]);
    expect(seeds.filter((seed) => seed !== undefined)).toEqual(['12', '56', '12']);
    expect(drawPools(mission.puzzles, 56)).toEqual({ wechsel: 'frequenz' });
  });

  it('rests once nobody has watched for a minute, without a timer; plays anew for the next', () => {
    const host = demoOn();
    expect(vi.getTimerCount()).toBe(0);
    const watcher = watch(host);
    const before = playUntil(watcher, (view) => view.currentPuzzleIndex === 1);
    watcher.leave();
    vi.advanceTimersByTime(DEMO_IDLE_MS - 1000);
    expect(host.counts().running).toBe(true);
    // Somebody back within the minute finds the run going on.
    const back = watch(host);
    expect(seenBy(back).startedAt).toBe(before.startedAt);
    back.leave();
    vi.advanceTimersByTime(DEMO_IDLE_MS + 1000);
    expect(host.counts()).toMatchObject({ running: false, spectators: 0 });
    expect(vi.getTimerCount()).toBe(0);
    const next = watch(host);
    expect(seenBy(next).phase).toBe('lobby');
    const fresh = playUntil(next, (view) => view.phase === 'playing', 10);
    expect(fresh.startedAt).toBeGreaterThan(before.startedAt ?? Infinity);
  });

  it('is back after a restart of the server: a new host plays from its first seed', () => {
    const logged = vi.mocked(console.log);
    const gone = demoOn();
    playUntil(watch(gone), (view) => view.currentPuzzleIndex === 1);
    gone.stop();
    const back = demoOn();
    const view = playUntil(watch(back), (seen) => seen.phase === 'playing', 10);
    expect(view.currentPuzzleIndex).toBe(0);
    const said = logged.mock.calls.map(([line]) => String(line));
    expect(said.filter((line) => line.includes('plays seed 12'))).toHaveLength(2);
  });

});

describe('the demo room’s audience', () => {
  it('is a hundred and fifty at most, and the next is told that it is full', () => {
    const host = demoOn();
    const { line } = serverWith(host);
    for (let i = 0; i < DEMO_MAX_WATCHING; i++) {
      watch(host);
    }
    const late = watching(line);
    expect(refusalOf(late.socket)).toBe(DEMO_FULL);
    expect(late.socket.heard.some((msg) => msg.kind === 'spectator-view')).toBe(false);
    expect(host.counts().spectators).toBe(DEMO_MAX_WATCHING);
  });
});

import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage, ServerMessage } from '@escapelab/core';
import { DEMO_CODE, DemoHost } from '../src/demo/host.js';
import { MissionCatalog } from '../src/missions.js';
import { RoomManager } from '../src/roomManager.js';
import { AUDIENCE_WATCHES, serveSockets } from '../src/sockets.js';
import { blackoutRun, lastView } from './blackout.js';
import { blackoutMission, over, playUntil, seenBy, watch, type Watcher } from './demo.js';
import { FakeServer, joinedOf, type FakeSocket } from './line.js';
import { passFor } from './passes.js';
import { walkTo } from './walk.js';

/**
 * What a room refuses changes nothing: a run's start, its rematch and the way back to the lobby
 * are worked out before anything of the room is touched, and the audience is turned away at the
 * door for all but watching and listening — in a crew's room and in the demo room alike.
 */

const shipped = new MissionCatalog(fileURLToPath(new URL('../../../missions', import.meta.url)));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 10, 19, 22, 0, 0));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** The positions the room last told `heard`, by player id. */
function stoodOn(heard: readonly ServerMessage[]): Record<string, { x: number; y: number }> {
  const last = heard.filter((msg) => msg.kind === 'positions').at(-1);
  return last?.kind === 'positions' ? last.players : {};
}

describe('a run’s crew and what the room refuses of it', () => {
  it('keeps everybody standing where they stood through a rematch and a way back refused', () => {
    const { room, anna, ben } = blackoutRun();
    walkTo(room, anna, 4.5, 4.5);
    const run = lastView(anna).startedAt;
    // A run on takes no rematch; the way back to the lobby is the host's alone.
    expect(() => room.act(ben.playerId, { kind: 'rematch' })).toThrow();
    expect(() => room.act(anna.playerId, { kind: 'rematch' })).toThrow();
    expect(() => room.act(ben.playerId, { kind: 'back-to-lobby' })).toThrow();
    expect(() => room.act('nobody', { kind: 'back-to-lobby' })).toThrow();
    expect(() => room.act('nobody', { kind: 'start-mission' })).toThrow();
    expect(lastView(anna)).toMatchObject({ phase: 'playing', startedAt: run });
    // Anna walks on from where she stood: the room has her there still.
    walkTo(room, anna, 5.5, 4.5);
    vi.advanceTimersByTime(100);
    expect(stoodOn(anna.messages)[anna.playerId]).toMatchObject({ x: 5.5, y: 4.5 });
    expect(Object.keys(stoodOn(anna.messages)).sort()).toEqual(
      [anna.playerId, ben.playerId].sort(),
    );
    room.dispose();
  });

  it('stands a figure it lost on its spawn again, never where its page says, and logs it', () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { room, anna } = blackoutRun();
    const lost = room as unknown as { positions: Map<string, unknown> };
    lost.positions.delete(anna.playerId);
    const run = lastView(anna).startedAt ?? 0;
    const spawn = lastView(anna).map?.yourSpawn ?? { x: 0, y: 0 };
    room.updatePosition(anna.playerId, run, { x: 30.5, y: 16.5, facing: 0, moving: true });
    vi.advanceTimersByTime(100);
    expect(stoodOn(anna.messages)[anna.playerId]).toMatchObject({
      x: spawn.x + 0.5,
      y: spawn.y + 0.5,
    });
    expect(warned.mock.calls.flat().join(' ')).toContain('Anna stood nowhere in the run');
    // Nobody who is no seat of the run stands anywhere for a position sent.
    room.updatePosition('nobody', run, { x: 3.5, y: 3.5, facing: 0, moving: false });
    expect(Object.keys(stoodOn(anna.messages))).not.toContain('nobody');
    room.dispose();
  });
});

/** Everything of the game a page may say that is none of the door's, each kind once. */
const OF_THE_CREW: ClientMessage[] = [
  { kind: 'rematch' },
  { kind: 'back-to-lobby' },
  { kind: 'start-mission' },
  { kind: 'set-ready', ready: true },
  { kind: 'switch-mission', missionId: 'systemcheck' },
  { kind: 'select-difficulty', difficulty: 'hart' },
  { kind: 'set-daily', daily: true },
  { kind: 'select-color', color: '#f472b6' },
  { kind: 'intro-done' },
  { kind: 'puzzle-input', input: { press: true } },
  { kind: 'request-hint' },
  { kind: 'open-source', manualId: 'spind' },
  { kind: 'read-note', note: 0 },
  { kind: 'drop-item' },
  { kind: 'interact', x: 3.5, y: 3.5, t: 0 },
  { kind: 'continue-without', absentId: 'p1' },
  { kind: 'call-off' },
  { kind: 'ping', x: 3, y: 3 },
  { kind: 'chat', phrase: 0 },
  { kind: 'say', text: 'Hallo' },
  { kind: 'takeover-answer', seat: 'p1', allow: true },
];

/** The seeds the demo's log named as it started its runs, in turn. */
const seedsLogged = (calls: readonly unknown[][]): string[] =>
  calls.flatMap(([said]) => /plays seed (\d+)/.exec(String(said))?.[1] ?? []);

const refusals = (socket: FakeSocket): string[] =>
  socket.heard.flatMap((msg) => (msg.kind === 'error' ? [msg.message] : []));

describe('the audience at the door', () => {
  it('is refused every word of the crew’s in a crew’s room, which plays on untouched', () => {
    const line = new FakeServer();
    const manager = new RoomManager(undefined, true);
    serveSockets(line, { catalog: shipped, manager });
    const [anna, ben] = ['Anna', 'Ben'].map(() => line.connect()) as [FakeSocket, FakeSocket];
    anna.say({ kind: 'create-room', name: 'Anna', pass: passFor('Anna'), missionId: 'blackout' });
    const { code } = joinedOf(anna);
    ben.say({ kind: 'join-room', code, name: 'Ben', pass: passFor('Ben') });
    ben.say({ kind: 'set-ready', ready: true });
    anna.say({ kind: 'start-mission' });
    const run = anna.view.startedAt ?? 0;
    const spawn = anna.view.map?.yourSpawn ?? { x: 0, y: 0 };
    const step = { x: spawn.x + 0.8, y: spawn.y + 0.5 };
    anna.say({ kind: 'pos', run, ...step, facing: 0, moving: true, t: 1 });
    const zoe = line.connect();
    zoe.say({ kind: 'spectate', code });
    const before = JSON.stringify(anna.view);
    for (const msg of OF_THE_CREW) {
      zoe.say(msg);
    }
    expect(refusals(zoe)).toEqual(OF_THE_CREW.map(() => AUDIENCE_WATCHES));
    // What its page streams, or marks of its menu, goes nowhere without a word.
    zoe.say({ kind: 'pos', run, x: 9, y: 9, facing: 0, moving: true, t: 2 });
    zoe.say({ kind: 'pause-menu', open: true });
    expect(refusals(zoe)).toHaveLength(OF_THE_CREW.length);
    expect(anna.view).toMatchObject({ phase: 'playing', startedAt: run });
    expect(JSON.stringify(anna.view)).toBe(before);
    // Anna walks on from where she stood.
    anna.say({ kind: 'pos', run, x: step.x + 0.3, y: step.y, facing: 0, moving: true, t: 3 });
    vi.advanceTimersByTime(100);
    expect(stoodOn(anna.heard)[anna.view.you.id]).toMatchObject({ x: step.x + 0.3, y: step.y });
    expect(refusals(anna)).toEqual([]);
    manager.get(code).dispose();
  });

  it('listens in on the crew and leaves for the menu as before', () => {
    const line = new FakeServer();
    const manager = new RoomManager();
    serveSockets(line, { catalog: shipped, manager });
    const anna = line.connect();
    anna.say({ kind: 'create-room', name: 'Anna', pass: passFor('Anna'), missionId: 'blackout' });
    const { code } = joinedOf(anna);
    const zoe = line.connect();
    zoe.say({ kind: 'spectate', code });
    zoe.say({ kind: 'rtc', to: anna.view.you.id, signal: { type: 'offer', sdp: 'v=0' } });
    expect(anna.heard.some((msg) => msg.kind === 'rtc')).toBe(true);
    zoe.say({ kind: 'to-menu' });
    expect(zoe.heard.at(-1)).toEqual({ kind: 'at-menu', code });
    expect(refusals(zoe)).toEqual([]);
    manager.get(code).dispose();
  });
});

describe('the demo room and what its audience would do to it', () => {
  /** A demo on `seeds` with its server's sockets, somebody watching it on a socket. */
  function demoWatched(seeds: number[]) {
    const host = new DemoHost(blackoutMission(), seeds);
    const line = new FakeServer();
    serveSockets(line, { catalog: shipped, manager: new RoomManager(), demo: host });
    const socket = line.connect();
    socket.say({ kind: 'spectate', code: DEMO_CODE });
    const watcher: Watcher = { heard: socket.heard, leave: () => socket.close(1000) };
    return { host, socket, watcher };
  }

  it('plays on to its win, on the seed it rolled, whatever the audience sends mid-run', () => {
    const logged = vi.mocked(console.log);
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { host, socket, watcher } = demoWatched([12, 56]);
    playUntil(watcher, (view) => view.currentPuzzleIndex === 1);
    for (let round = 0; round < 3; round++) {
      for (const msg of OF_THE_CREW) {
        socket.say(msg);
      }
    }
    expect(refusals(socket)).toEqual(Array.from({ length: 63 }, () => AUDIENCE_WATCHES));
    const won = playUntil(watcher, over);
    expect(won).toMatchObject({ phase: 'won', penaltySeq: 0 });
    // Through the Auswertung too: the next run plays the next seed, none skipped.
    for (const msg of OF_THE_CREW) {
      socket.say(msg);
    }
    playUntil(watcher, (view) => view.phase === 'playing', 40);
    const seeds = seedsLogged(logged.mock.calls);
    expect(seeds).toEqual(['12', '56']);
    expect(warned).not.toHaveBeenCalled();
    host.stop();
  });

  it('rolls no seed for a start its room refuses', () => {
    const logged = vi.mocked(console.log);
    const host = new DemoHost(blackoutMission(), [12, 56]);
    const watcher = watch(host);
    const room = host.room as unknown as { act: (id: string, msg: ClientMessage) => void };
    // In the lobby, before the crew has said yes: a start refused, thrice.
    for (let i = 0; i < 3; i++) {
      expect(() => room.act('nobody', { kind: 'start-mission' })).toThrow();
    }
    playUntil(watcher, (view) => view.phase === 'playing', 10);
    expect(() => room.act('nobody', { kind: 'rematch' })).toThrow();
    const seeds = seedsLogged(logged.mock.calls);
    expect(seeds).toEqual(['12']);
    expect(seenBy(watcher).phase).toBe('playing');
    host.stop();
  });
});

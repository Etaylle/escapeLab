import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMission, type Mission, type PlayerView, type ServerMessage } from '@escapelab/core';
import { LOBBY_AWAY_MS, LOBBY_GONE_MS, Room } from '../src/room.js';
import { RoomManager } from '../src/roomManager.js';
import { serveSockets } from '../src/sockets.js';
import { FakeServer, joinedOf } from './line.js';
import { passFor } from './passes.js';

/** A shipped mission by its file: Blackout for two or three, the Systemcheck for two. */
const shipped = (file: string): Mission =>
  parseMission(
    JSON.parse(readFileSync(new URL(`../../../missions/${file}`, import.meta.url), 'utf8')),
  );

/** `name` on a seat of `room` and a connection of their own: what they hear, how it ends. */
function seated(room: Room, name: string) {
  const messages: ServerMessage[] = [];
  const { playerId } = room.join(name, passFor(name));
  const detach = room.attach(playerId, (msg) => messages.push(msg));
  const view = (): PlayerView => {
    const last = messages.filter((msg) => msg.kind === 'view').at(-1);
    if (last?.kind !== 'view') {
      throw new Error(`${name} was sent no view`);
    }
    return last.view;
  };
  return { playerId, detach, view, names: () => view().players.map((p) => p.name) };
}

/** `name`'s seat of `room` back on a connection of its own, as their page resumes it. */
function resumed(room: Room, name: string) {
  const messages: ServerMessage[] = [];
  room.attach(room.resume(passFor(name)), (msg) => messages.push(msg));
  return () => {
    const last = messages.filter((msg) => msg.kind === 'view').at(-1);
    return last?.kind === 'view' ? last.view.players.map((p) => p.name) : [];
  };
}

describe('a lobby taken up again from its snapshot', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('waits for every seat from the restore, however long the lobby stood quiet before', () => {
    const room = new Room('STIL', shipped('blackout.json'));
    for (const name of ['Anna', 'Ben', 'Cem']) {
      seated(room, name);
    }
    // The lobby's last snapshot; then five quiet minutes, the server killed, half a minute down.
    const kept = room.snapshot();
    room.dispose();
    vi.advanceTimersByTime(5 * 60_000 + 30_000);
    const restored = Room.restore(kept, Date.now());
    const names = resumed(restored, 'Anna');
    vi.advanceTimersByTime(1000);
    expect(names()).toEqual(['Anna', 'Ben', 'Cem']);
    // Ben back in time, Cem never: his seat freed LOBBY_AWAY_MS after the restore.
    vi.advanceTimersByTime(60_000);
    resumed(restored, 'Ben');
    vi.advanceTimersByTime(LOBBY_AWAY_MS - 61_000 - 1);
    expect(names()).toEqual(['Anna', 'Ben', 'Cem']);
    vi.advanceTimersByTime(1);
    expect(names()).toEqual(['Anna', 'Ben']);
    restored.dispose();
  });
});

describe('a lobby seat whose line is down', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Anna, Ben and Cem in Blackout's lobby, Ben and Cem ready. */
  function lobby() {
    const room = new Room('TEST', shipped('blackout.json'));
    const anna = seated(room, 'Anna');
    const ben = seated(room, 'Ben');
    const cem = seated(room, 'Cem');
    room.setReady(ben.playerId, true);
    room.setReady(cem.playerId, true);
    return { room, anna, ben, cem };
  }

  it('holds the start back, naming whose line is down', () => {
    const { room, anna, cem } = lobby();
    cem.detach();
    expect(() => room.act(anna.playerId, { kind: 'start-mission' })).toThrow(
      'Cems Leitung ist unterbrochen.',
    );
    expect(anna.view().phase).toBe('lobby');
    room.dispose();
  });

  it('is freed 120 s after its line closed, the log saying so; then the crew starts', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { room, anna, ben, cem } = lobby();
    cem.detach();
    vi.advanceTimersByTime(LOBBY_AWAY_MS - 1);
    expect(anna.names()).toEqual(['Anna', 'Ben', 'Cem']);
    vi.advanceTimersByTime(1);
    expect(anna.names()).toEqual(['Anna', 'Ben']);
    expect(room.seatOf(passFor('Cem'))).toBeNull();
    expect(log).toHaveBeenLastCalledWith(
      "[escapelab] room TEST: Cem's seat freed, 120.0 s after its line closed",
    );
    // The crew changed: Ben confirms anew, and the run starts with the two.
    room.setReady(ben.playerId, true);
    room.act(anna.playerId, { kind: 'start-mission' });
    expect(anna.view().phase).toBe('playing');
    expect(anna.names()).toEqual(['Anna', 'Ben']);
    expect(() => room.resume(passFor('Cem'))).toThrow(/Wiederverbinden fehlgeschlagen/);
    room.dispose();
  });

  it('keeps its seat where its line is back in time', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { room, anna, cem } = lobby();
    cem.detach();
    vi.advanceTimersByTime(LOBBY_AWAY_MS / 2);
    room.attach(room.resume(passFor('Cem')), () => undefined);
    vi.advanceTimersByTime(2 * LOBBY_AWAY_MS);
    expect(anna.names()).toEqual(['Anna', 'Ben', 'Cem']);
    room.act(anna.playerId, { kind: 'start-mission' });
    expect(anna.view().phase).toBe('playing');
    room.dispose();
  });

  it('is freed at once where the room comes back to its lobby long after the line closed', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const room = new Room('TEST', shipped('systemcheck.json'));
    const anna = seated(room, 'Anna');
    const ben = seated(room, 'Ben');
    room.setReady(ben.playerId, true);
    room.act(anna.playerId, { kind: 'start-mission' });
    vi.advanceTimersByTime(420_000);
    expect(anna.view().phase).toBe('lost');
    // At the end screen nobody is freed: the room is no lobby.
    ben.detach();
    vi.advanceTimersByTime(LOBBY_AWAY_MS + 10_000);
    expect(anna.names()).toEqual(['Anna', 'Ben']);
    room.act(anna.playerId, { kind: 'back-to-lobby' });
    expect(anna.names()).toEqual(['Anna', 'Ben']);
    vi.advanceTimersByTime(0);
    expect(anna.names()).toEqual(['Anna']);
    room.dispose();
  });
});

describe('a lobby seat whose tab closed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Anna and Ben in Blackout's lobby, each on a socket, served as the server serves them. */
  function served() {
    const line = new FakeServer();
    const blackout = shipped('blackout.json');
    const manager = new RoomManager();
    serveSockets(line, { catalog: { get: () => blackout, default: blackout }, manager });
    const anna = line.connect();
    anna.say({ kind: 'create-room', name: 'Anna', pass: passFor('Anna') });
    const { code } = joinedOf(anna);
    const ben = line.connect();
    ben.say({ kind: 'join-room', code, name: 'Ben', pass: passFor('Ben') });
    const names = (): string[] => anna.view.players.map((p) => p.name);
    return { line, manager, code, ben, names };
  }

  it('is freed 10 s after the socket closed cleanly, a tab closed for good', () => {
    const { manager, code, ben, names } = served();
    ben.close(1001);
    vi.advanceTimersByTime(LOBBY_GONE_MS - 1);
    expect(names()).toEqual(['Anna', 'Ben']);
    vi.advanceTimersByTime(1);
    expect(names()).toEqual(['Anna']);
    manager.get(code).dispose();
  });

  it('keeps its seat where the pass is back within the 10 s, a reload', () => {
    const { line, manager, code, ben, names } = served();
    ben.close(1000);
    vi.advanceTimersByTime(LOBBY_GONE_MS / 2);
    line.connect().say({ kind: 'resume', code, pass: passFor('Ben') });
    vi.advanceTimersByTime(LOBBY_AWAY_MS);
    expect(names()).toEqual(['Anna', 'Ben']);
    manager.get(code).dispose();
  });

  it('holds a line that drops after a reload for 120 s: how this close came is what counts', () => {
    const { line, manager, code, ben, names } = served();
    ben.close(1001);
    const reloaded = line.connect();
    reloaded.say({ kind: 'resume', code, pass: passFor('Ben') });
    reloaded.terminate();
    vi.advanceTimersByTime(LOBBY_GONE_MS);
    expect(names()).toEqual(['Anna', 'Ben']);
    vi.advanceTimersByTime(LOBBY_AWAY_MS - LOBBY_GONE_MS);
    expect(names()).toEqual(['Anna']);
    manager.get(code).dispose();
  });

  it('holds a line cut or dropped, with no close of the page’s, for 120 s as before', () => {
    const { manager, code, ben, names } = served();
    ben.terminate();
    vi.advanceTimersByTime(LOBBY_AWAY_MS - 1);
    expect(names()).toEqual(['Anna', 'Ben']);
    vi.advanceTimersByTime(1);
    expect(names()).toEqual(['Anna']);
    manager.get(code).dispose();
  });

  it('holds the seat in a run, whatever way its socket closed', () => {
    const room = new Room('TEST', shipped('blackout.json'));
    const anna = seated(room, 'Anna');
    const ben = seated(room, 'Ben');
    room.setReady(ben.playerId, true);
    room.act(anna.playerId, { kind: 'start-mission' });
    ben.detach('closed');
    vi.advanceTimersByTime(2 * LOBBY_AWAY_MS);
    expect(anna.names()).toEqual(['Anna', 'Ben']);
    expect(anna.view().away.map((away) => away.name)).toEqual(['Ben']);
    room.dispose();
  });
});

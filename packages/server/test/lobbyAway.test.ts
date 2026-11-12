import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMission, type Mission, type PlayerView, type ServerMessage } from '@escapelab/core';
import { LOBBY_AWAY_MS, Room } from '../src/room.js';
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

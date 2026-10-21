import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseMission,
  type Mission,
  type PlayerView,
  type ServerMessage,
  type SpectatorView,
} from '@escapelab/core';
import { RoomManager, seedsAllowed } from '../src/roomManager.js';
import { walkTo } from './walk.js';

/**
 * Blackout: spawns in the Archiv (3,2), at the west end of the Flur (1,6) and
 * by the lever (6,5); the lights go out three seconds in, and the crew turns
 * the lever of the Notlicht (7,5) above the Flur plate (7,6), which holds the
 * Maschinenraum door; console A of the Notstrom-Kasten stands in the
 * Maschinenraum at (1,9). Seeds 1 and 28 both start Anna at the west end of
 * the Flur and Ben in the Archiv.
 */
const blackout: Mission = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8')),
);

function collector(): { messages: ServerMessage[]; listen: (m: ServerMessage) => void } {
  const messages: ServerMessage[] = [];
  return { messages, listen: (m) => messages.push(m) };
}

function lastView(messages: ServerMessage[]): PlayerView {
  const last = messages.filter((m) => m.kind === 'view').at(-1);
  if (last?.kind !== 'view') {
    throw new Error('expected at least one view message');
  }
  return last.view;
}

function lastSpectatorView(messages: ServerMessage[]): SpectatorView {
  const last = messages.filter((m) => m.kind === 'spectator-view').at(-1);
  if (last?.kind !== 'spectator-view') {
    throw new Error('expected at least one spectator view');
  }
  return last.view;
}

/** Anna (host) and Ben in a Blackout room `manager` opened with `seed`, the run started. */
function startedIn(manager: RoomManager, seed: number | null) {
  const room = manager.create(blackout, seed);
  const anna = { ...room.join('Anna'), ...collector() };
  const ben = { ...room.join('Ben'), ...collector() };
  room.attach(anna.playerId, anna.listen);
  room.attach(ben.playerId, ben.listen);
  room.setReady(ben.playerId, true);
  room.act(anna.playerId, { kind: 'start-mission' });
  return { room, anna, ben };
}

/**
 * What the seed of a room's first run decided, as the room hands it out:
 * where Anna and Ben start, where the audience sees the sources lie, the
 * edgework, and the fuse box Anna switches on beside console A, as the
 * audience sees all of it. Before that the lights go out and the two turn
 * the lever, Ben from the plate beside it, which then holds the Maschinenraum
 * door for Anna on her way to the fuse box.
 */
function firstRunOf(manager: RoomManager, seed: number) {
  const { room, anna, ben } = startedIn(manager, seed);
  const audience = collector();
  room.attachSpectator(audience.listen);
  const start = lastSpectatorView(audience.messages);
  vi.advanceTimersByTime((blackout.intro?.lightsSec ?? 0) * 1000);
  walkTo(room, ben, 7.5, 6.5);
  walkTo(room, anna, 7.5, 5.5);
  room.act(anna.playerId, { kind: 'interact' });
  for (const player of [anna, ben]) {
    room.act(player.playerId, { kind: 'puzzle-input', input: { press: true } });
  }
  walkTo(room, anna, 2.5, 9.5);
  room.act(anna.playerId, { kind: 'interact' });
  const box = lastSpectatorView(audience.messages).puzzle;
  room.dispose();
  return {
    seed: lastView(anna.messages).seed,
    spawns: [anna, ben].map(({ messages }) => lastView(messages).map?.yourSpawn),
    places: start.map?.manuals.map(({ id, x, y }) => ({ id, x, y })),
    edgework: start.edgework,
    box,
  };
}

describe('a room pinned to a seed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('repeats the draw, the places and the instances of its runs', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const manager = new RoomManager(undefined, seedsAllowed({ ALLOW_SEED: '1' }));
    const first = firstRunOf(manager, 1);
    expect(first.seed).toEqual({ room: 1, run: 1 });
    expect(first.box?.kind).toBe('circuit');
    expect(firstRunOf(manager, 1)).toEqual(first);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/pinned to seed 1\b/));
  });

  it('plays another seed differently', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const manager = new RoomManager(undefined, seedsAllowed({ ALLOW_SEED: '1' }));
    const one = firstRunOf(manager, 1);
    const other = firstRunOf(manager, 28);
    expect(other.places).not.toEqual(one.places);
    expect(other.edgework).not.toEqual(one.edgework);
    expect(other.box).not.toEqual(one.box);
  });

  it('is not pinned where ALLOW_SEED is unset: the seed is left out, with a log line', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { room, anna } = startedIn(new RoomManager(undefined, seedsAllowed({})), 1);
    expect(lastView(anna.messages).phase).toBe('playing');
    expect(Object.keys(lastView(anna.messages))).not.toContain('seed');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/seed 1 ignored .*ALLOW_SEED=1/));
    room.dispose();
  });
});

describe('ALLOW_SEED', () => {
  it('allows seeds with 1 only, and refuses to guess at anything but 1, 0 or nothing', () => {
    expect(seedsAllowed({ ALLOW_SEED: '1' })).toBe(true);
    expect(seedsAllowed({ ALLOW_SEED: '0' })).toBe(false);
    expect(seedsAllowed({ ALLOW_SEED: '' })).toBe(false);
    expect(seedsAllowed({})).toBe(false);
    expect(() => seedsAllowed({ ALLOW_SEED: 'yes' })).toThrow(/ALLOW_SEED=yes .*ALLOW_SEED=1/);
  });
});

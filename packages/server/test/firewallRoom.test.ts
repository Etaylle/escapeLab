import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMission, type GameState, type Mission, type ServerMessage } from '@escapelab/core';
import { Room } from '../src/room.js';
import { pressE, walkTo, type Walker } from './walk.js';
import { passFor } from './passes.js';

/**
 * A corridor for two with the Paketfilter: the Sperrpult at the west end, the Analysepult at the
 * east end, the policy in a book between them, the Laborkennung by the spawns.
 *
 *   0123456789012345
 * 0 ################
 * 1 #..............#   console a (5,1); console b (13,1)
 * 2 #..............#   spawns (1,1) (1,2); sign (2,2); book (9,2)
 * 3 ################
 */
const mission: Mission = parseMission({
  id: 'filterflur',
  title: 'Filterflur',
  players: { min: 2, max: 2 },
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  puzzles: [{ type: 'firewall', id: 'filter', title: 'Paketfilter' }],
  map: {
    tiles: ['################', '#..............#', '#..............#', '################'],
    spawns: [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
    ],
    stations: [
      { puzzleId: 'filter', x: 5, y: 1, console: 'a' },
      { puzzleId: 'filter', x: 13, y: 1, console: 'b' },
    ],
    manuals: [
      {
        id: 'buch',
        kind: 'book',
        label: 'RICHTLINIE',
        puzzleIds: ['filter'],
        spots: [{ x: 9, y: 2 }],
      },
    ],
    edgeworkSign: { x: 2, y: 2 },
  },
});

type Player = Walker & { listen: (m: ServerMessage) => number };
type Firewall = Extract<NonNullable<GameState['puzzleState']>, { type: 'firewall' }>;

/** The room's game, as only a test reads it. */
const gameOf = (room: Room): GameState => room['state'];

/** The Paketfilter armed in `room`; throws where none is. */
function filterOf(room: Room): Firewall {
  const state = gameOf(room).puzzleState;
  if (state?.type !== 'firewall') {
    throw new Error('expected the Paketfilter armed');
  }
  return state;
}

/** The alarms the run has logged, by label. */
const alarmsOf = (room: Room): string[] =>
  gameOf(room)
    .events.filter((event) => event.kind === 'penalty')
    .map((event) => event.label);

describe('Room with the Paketfilter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Anna at the Sperrpult, Ben at the Analysepult, the station switched on: the wave runs. */
  function running(): { room: Room; anna: Player; ben: Player } {
    const room = new Room('TEST', mission);
    const [anna, ben] = ['Anna', 'Ben'].map((name) => {
      const messages: ServerMessage[] = [];
      const listen = (m: ServerMessage): number => messages.push(m);
      const player = { ...room.join(name, passFor(name)), messages, listen };
      room.attach(player.playerId, player.listen);
      return player;
    });
    if (anna === undefined || ben === undefined) {
      throw new Error('expected two players');
    }
    room.setReady(ben.playerId, true);
    room.act(anna.playerId, { kind: 'start-mission' });
    walkTo(room, anna, 5.5, 1.5);
    walkTo(room, ben, 13.5, 1.5);
    pressE(room, anna);
    return { room, anna, ben };
  }

  it('wakes itself as an attack reaches the Kern: one alarm within a second, nobody acting', () => {
    const { room } = running();
    const wave = filterOf(room);
    expect(wave.heldAt).toBeNull();
    const first = wave.packets.find((packet) => packet.hostile);
    const arrives = wave.startedAt + (first?.enterMs ?? 0) + 14_000;
    vi.advanceTimersByTime(arrives - Date.now() - 1000);
    expect(alarmsOf(room)).toEqual([]);
    vi.advanceTimersByTime(2000);
    expect(alarmsOf(room)).toEqual(['Paketfilter: Angriff im Kern']);
    const logged = gameOf(room).events.find((event) => event.kind === 'penalty');
    expect(logged?.at).toBeGreaterThanOrEqual(arrives);
    expect(logged?.at).toBeLessThan(arrives + 1000);
    expect(filterOf(room)).toMatchObject({ dealt: 2, startedAt: arrives });
    // The wave it called off charges nothing more: the fresh one's first packet is 18 s away.
    vi.advanceTimersByTime(10_000);
    expect(alarmsOf(room)).toHaveLength(1);
    room.dispose();
  });

  it('holds a wave in flight through a snapshot and a restore, as a pause holds it', () => {
    const { room } = running();
    vi.advanceTimersByTime(6000);
    const taken = Date.now();
    const kept = room.snapshot(taken);
    room.dispose();
    const held = kept.state.puzzleState;
    expect(held?.type === 'firewall' && held.heldAt).toBe(taken);
    vi.advanceTimersByTime(120_000);
    const again = Room.restore(kept, Date.now());
    vi.advanceTimersByTime(120_000);
    expect(filterOf(again).heldAt).toBe(taken);
    expect(filterOf(again).entered).toBe(held?.type === 'firewall' ? held.entered : -1);
    expect(alarmsOf(again)).toEqual([]);
    again.dispose();
  });
});

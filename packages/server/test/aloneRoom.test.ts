import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moduleFor, parseMission, type Mission, type ServerMessage } from '@escapelab/core';
import { Room } from '../src/room.js';
import { pressE, walkTo, type Walker } from './walk.js';
import { passFor } from './passes.js';

/**
 * A corridor for two: the keypad at the west end, its book further east,
 * both spawns out of reach of either.
 *
 *   0123456789012
 * 0 #############
 * 1 #...........#   keypad (4,1)
 * 2 #...........#   spawns (1,1) (1,2); book (10,2)
 * 3 #############
 */
const mission: Mission = parseMission({
  id: 'einzeln',
  title: 'Einzeln',
  players: { min: 2, max: 2 },
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  puzzles: [{ type: 'keypad', id: 'code', title: 'Code' }],
  map: {
    tiles: ['#############', '#...........#', '#...........#', '#############'],
    spawns: [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
    ],
    stations: [{ puzzleId: 'code', x: 4, y: 1 }],
    manuals: [
      {
        id: 'buch',
        kind: 'book',
        label: 'HANDBUCH',
        puzzleIds: ['code'],
        spots: [{ x: 10, y: 2 }],
      },
    ],
  },
});

function lastView(walker: Walker) {
  const last = walker.messages.filter((m) => m.kind === 'view').at(-1);
  if (last === undefined || last.kind !== 'view') {
    throw new Error('expected a view message');
  }
  return last.view;
}

describe('Room: one player works a station alone', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Anna at the keypad, switched on; Ben reading at the book. */
  function inPlace() {
    const room = new Room('TEST', mission);
    const [anna, ben] = ['Anna', 'Ben'].map((name) => {
      const messages: ServerMessage[] = [];
      const player = { ...room.join(name, passFor(name)), messages };
      room.attach(player.playerId, (m) => messages.push(m));
      return player;
    });
    if (anna === undefined || ben === undefined) {
      throw new Error('expected two players');
    }
    room.setReady(ben.playerId, true);
    room.act(anna.playerId, { kind: 'start-mission' });
    walkTo(room, anna, 4.5, 1.5);
    walkTo(room, ben, 10.5, 2.5);
    pressE(room, anna);
    return { room, anna, ben };
  }

  /** The keypad's next press, worked out from the keys at the station. */
  function nextPress(anna: Walker): { keyIndex: number } {
    const [def] = mission.puzzles;
    const atKeys = lastView(anna).puzzle;
    if (def === undefined || atKeys === null) {
      throw new Error('expected the open keypad');
    }
    const [move] = moduleFor(def.type).solve(def, { operator: atKeys, reader: atKeys }, null);
    if (move === undefined || !('keyIndex' in move.input)) {
      throw new Error('expected a key to press');
    }
    return move.input;
  }

  it('takes a press while the reader is away, without an alarm', () => {
    const { room, anna, ben } = inPlace();
    const press = nextPress(anna);

    // Ben walks off towards the keypad, out of reach of the book and not yet at the station.
    walkTo(room, ben, 7.5, 1.5);
    expect(lastView(ben).presence).toMatchObject({ stationId: null, manualId: null });
    room.act(anna.playerId, { kind: 'puzzle-input', input: press });
    expect(lastView(ben)).toMatchObject({ penaltySeq: 0, puzzle: { kind: 'keypad', litCount: 1 } });
    room.dispose();
  });

  it('takes a press from a second player at the same station', () => {
    const { room, anna, ben } = inPlace();
    walkTo(room, ben, 5.5, 1.5);
    expect(lastView(ben).presence).toMatchObject({ stationId: 'code', manualId: null });
    room.act(ben.playerId, { kind: 'puzzle-input', input: nextPress(anna) });
    const lit = { penaltySeq: 0, puzzle: { kind: 'keypad', litCount: 1 } };
    expect(lastView(anna)).toMatchObject(lit);
    room.dispose();
  });
});

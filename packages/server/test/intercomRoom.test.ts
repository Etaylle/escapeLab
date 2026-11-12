import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canSee, parseMission, type Mission, type ServerMessage } from '@escapelab/core';
import { Room } from '../src/room.js';
import { walkTo, type Walker } from './walk.js';
import { passFor } from './passes.js';

/**
 * The Signalkette's two consoles 14 tiles apart, a wall between them and the way round it
 * along the bottom row; its book stands by that way.
 *
 *   0123456789012345678
 * 0 ###################
 * 1 #........#........#   console a (2,1); console b (16,1)
 * 2 #........#........#   at a (2.5,2.5); at b (16.5,2.5)
 * 3 #.................#   spawns (1,3) (2,3); book (12,3); sign (17,3)
 * 4 ###################
 */
const mission: Mission = parseMission({
  id: 'gegensprechen',
  title: 'Gegensprechen',
  players: { min: 2, max: 2 },
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  puzzles: [{ type: 'signal', id: 'kette', title: 'Signalkette' }],
  map: {
    tiles: [
      '###################',
      '#........#........#',
      '#........#........#',
      '#.................#',
      '###################',
    ],
    spawns: [
      { x: 1, y: 3 },
      { x: 2, y: 3 },
    ],
    stations: [
      { puzzleId: 'kette', x: 2, y: 1, console: 'a' },
      { puzzleId: 'kette', x: 16, y: 1, console: 'b' },
    ],
    manuals: [
      {
        id: 'buch',
        kind: 'book',
        label: 'HANDBUCH',
        puzzleIds: ['kette'],
        spots: [{ x: 12, y: 3 }],
      },
    ],
    edgeworkSign: { x: 17, y: 3 },
  },
});

const AT_A = { x: 2.5, y: 2.5 };
const AT_B = { x: 16.5, y: 2.5 };

function lastView(walker: Walker) {
  const last = walker.messages.filter((m) => m.kind === 'view').at(-1);
  if (last === undefined || last.kind !== 'view') {
    throw new Error('expected a view message');
  }
  return last.view;
}

describe('Room: the station’s intercom', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Anna and Ben in a run, neither at a console yet. */
  function crew() {
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
    return { room, anna, ben };
  }

  it('reaches both views once both stand at the consoles, a wall and 14 tiles apart', () => {
    const { room, anna, ben } = crew();
    const map = lastView(anna).map;
    if (map === null) {
      throw new Error('expected the run’s map');
    }
    expect(Math.hypot(AT_B.x - AT_A.x, AT_B.y - AT_A.y)).toBe(14);
    expect(canSee(map, AT_A, AT_B, new Set())).toBe(false);

    walkTo(room, anna, AT_A.x, AT_A.y);
    expect(lastView(anna).intercom).toEqual([anna.playerId]);
    expect(lastView(ben).intercom).toBeUndefined();

    walkTo(room, ben, AT_B.x, AT_B.y);
    const both = [anna.playerId, ben.playerId].sort();
    expect(lastView(anna).intercom).toEqual(both);
    expect(lastView(ben).intercom).toEqual(both);

    // Ben walks off to the gap under the wall, at no place of the station: the link is gone.
    walkTo(room, ben, 9.5, 3.5);
    expect(lastView(anna).intercom).toEqual([anna.playerId]);
    expect(lastView(ben).intercom).toBeUndefined();
    room.dispose();
  });
});

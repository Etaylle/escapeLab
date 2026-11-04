import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMission, type ServerMessage } from '@escapelab/core';
import { Room } from '../src/room.js';
import { pressE, walkTo, type Walker } from './walk.js';

/**
 * A room with a pillar, the keypad's console right behind it: out of sight from the west side,
 * where both start, in sight from north, east and south of it. The locker with its rules stands
 * in the far corner.
 *
 *   0123456789
 * 0 ##########
 * 1 #........#   spawns (1,1) and (1,2)
 * 2 #...#....#   pillar (4,2); console (5,2)
 * 3 #........#   locker (8,3)
 * 4 ##########
 */
const pillared = parseMission({
  id: 'saeulenraum',
  title: 'Säulen-Raum',
  players: { min: 2, max: 2 },
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  puzzles: [{ type: 'keypad', id: 'code', title: 'Code' }],
  map: {
    tiles: ['##########', '#........#', '#...#....#', '#........#', '##########'],
    spawns: [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
    ],
    stations: [{ puzzleId: 'code', x: 5, y: 2 }],
    manuals: [
      {
        id: 'spind',
        kind: 'locker',
        label: 'SPIND',
        puzzleIds: ['code'],
        spots: [{ x: 8, y: 3 }],
      },
    ],
  },
});

/** Pressed to the pillar's west face: 1.55 tiles from the console's middle, the pillar between. */
const BEHIND = { x: 3.95, y: 2.5 };
/** Right north of the console, in plain sight of it. */
const BESIDE = { x: 5.5, y: 1.5 };

function collector(): { messages: ServerMessage[]; listen: (m: ServerMessage) => void } {
  const messages: ServerMessage[] = [];
  return { messages, listen: (m) => messages.push(m) };
}

function lastView(walker: Walker) {
  const last = walker.messages.filter((m) => m.kind === 'view').at(-1);
  if (last === undefined || last.kind !== 'view') {
    throw new Error('expected a view message');
  }
  return last.view;
}

/** Where `walker` stands as the room counts it, and whether they have found the console. */
function atConsole(walker: Walker) {
  const view = lastView(walker);
  return { at: view.presence.stationId, found: view.map?.stations[0]?.found ?? null };
}

describe('Room with a console behind a pillar', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function started() {
    const room = new Room('TEST', pillared);
    const anna = { ...room.join('Anna'), ...collector() };
    const ben = { ...room.join('Ben'), ...collector() };
    room.attach(anna.playerId, anna.listen);
    room.attach(ben.playerId, ben.listen);
    room.setReady(ben.playerId, true);
    room.act(anna.playerId, { kind: 'start-mission' });
    return { room, anna, ben };
  }

  it('counts nobody at it through the pillar, however close: no device, E works nothing', () => {
    const { room, anna } = started();
    walkTo(room, anna, BEHIND.x, BEHIND.y);
    vi.advanceTimersByTime(1000); // the lamp faces east, at the pillar
    expect(atConsole(anna)).toEqual({ at: null, found: false });
    const refusal = 'Zu weit weg — nur direkt an der leuchtenden Station.';
    expect(() => pressE(room, anna)).toThrow(refusal);
    expect(lastView(anna).puzzle).toBeNull();
    room.dispose();
  });

  it('counts whoever comes round the pillar into sight of it, and E there switches it on', () => {
    const { room, anna, ben } = started();
    walkTo(room, anna, BESIDE.x, BESIDE.y);
    expect(atConsole(anna)).toEqual({ at: 'code', found: true });
    pressE(room, anna);
    expect(lastView(anna).puzzle?.console).toBe('a');
    // Ben comes up behind the pillar meanwhile: the device is up, but not for him.
    walkTo(room, ben, BEHIND.x, BEHIND.y);
    expect(atConsole(ben)).toEqual({ at: null, found: false });
    expect(lastView(ben).puzzle?.console).toBeNull();
    room.dispose();
  });

  it('keeps a console found as its finder’s: round the pillar, within reach, still there', () => {
    const { room, anna } = started();
    walkTo(room, anna, BESIDE.x, BESIDE.y);
    walkTo(room, anna, 2.5, 2.5); // out of reach of it, by the west wall
    expect(atConsole(anna)).toEqual({ at: null, found: true });
    walkTo(room, anna, BEHIND.x, BEHIND.y);
    expect(atConsole(anna)).toEqual({ at: 'code', found: true });
    room.dispose();
  });
});

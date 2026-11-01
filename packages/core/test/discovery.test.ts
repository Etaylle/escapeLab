import { describe, expect, it } from 'vitest';
import {
  applyAction,
  findables,
  findKey,
  lookAround,
  shutDoors,
  viewFor,
  type Find,
  type GameState,
} from '../src/index.js';
import { inCone, type Findable, type Looker } from '../src/discovery.js';
import { blackoutMission } from './blackoutPlan.js';
import { lightsOut, started, T0 } from './lab.js';

/** A source to find at (x, y). */
const source = (id: string, x: number, y: number): Findable => ({
  find: { of: 'source', id },
  key: `source:${id}`,
  x,
  y,
});

/** A part lying at (x, y). */
const part = (id: string, x: number, y: number): Findable => ({
  find: { of: 'item', id },
  key: `item:${id}`,
  x,
  y,
});

const WEST = Math.PI;
const EAST = 0;
const NORTH = -Math.PI / 2;
const NOTHING_SHUT: ReadonlySet<string> = new Set();

/**
 * A room with a pillar.
 *
 *   012345678901
 * 0 ############
 * 1 #..........#
 * 2 #....#.....#   pillar (5,2)
 * 3 #..........#
 * 4 ############
 */
const ROOM = {
  tiles: ['############', '#..........#', '#....#.....#', '#..........#', '############'],
};

/** What `looker` finds of `things` in ROOM at `now`, nothing glanced at before. */
function foundIn(looker: Looker, things: Findable[], now = T0): string[] {
  return lookAround(ROOM, NOTHING_SHUT, looker, things, {}, now).found;
}

describe('finding by reach', () => {
  it('finds what lies within two tiles with nothing between, and nothing a step further', () => {
    // Facing the west wall: the lamp's cone finds nothing to the east.
    const looker = { x: 1.5, y: 1.5, facing: WEST };
    const things = [
      source('zwei', 3.5, 1.5),
      source('mehr', 3.6, 1.5),
      source('schraeg', 2.9, 2.9),
    ];
    expect(foundIn(looker, things)).toEqual(['source:zwei', 'source:schraeg']);
  });

  it('finds nothing behind a wall, however near', () => {
    const looker = { x: 4.5, y: 2.5, facing: WEST };
    // 1.8 tiles east, the pillar between.
    expect(foundIn(looker, [source('dahinter', 6.3, 2.5)])).toEqual([]);
    expect(foundIn({ ...looker, x: 6.9 }, [source('dahinter', 6.3, 2.5)])).toEqual([
      'source:dahinter',
    ]);
  });

  it('finds a part within 0.9 tiles whatever stands between: it lies at one’s feet', () => {
    // Two walls meet at the corner (2,2) between the player and the floor beyond it.
    const corner = { tiles: ['#####', '#.#.#', '##..#', '#####'] };
    const looker = { x: 1.9, y: 1.9, facing: WEST };
    const look = (thing: Findable) =>
      lookAround(corner, NOTHING_SHUT, looker, [thing], {}, T0).found;
    expect(look(part('sicherung', 2.4, 2.4))).toEqual(['item:sicherung']);
    expect(look(source('buch', 2.4, 2.4))).toEqual([]);
  });
});

describe('finding by the lamp', () => {
  const hall = { tiles: ['##########', '#........#', '##########'] };
  const far = source('tafel', 6.5, 1.5);
  const look = (facing: number, glances = {}, now = T0) =>
    lookAround(hall, NOTHING_SHUT, { x: 1.5, y: 1.5, facing }, [far], glances, now);

  it('finds what stays in the cone for a quarter of a second, and nothing before', () => {
    const first = look(EAST);
    expect(first).toEqual({ found: [], glances: { 'source:tafel': T0 }, dueAt: T0 + 250 });
    expect(look(EAST, first.glances, T0 + 249).found).toEqual([]);
    expect(look(EAST, first.glances, T0 + 250)).toEqual({
      found: ['source:tafel'],
      glances: {},
      dueAt: null,
    });
  });

  it('starts a glance cut short anew', () => {
    const first = look(EAST);
    const away = look(WEST, first.glances, T0 + 200);
    expect(away).toEqual({ found: [], glances: {}, dueAt: null });
    const again = look(EAST, away.glances, T0 + 300);
    expect(again.glances).toEqual({ 'source:tafel': T0 + 300 });
    expect(look(EAST, again.glances, T0 + 549).found).toEqual([]);
    expect(look(EAST, again.glances, T0 + 550).found).toEqual(['source:tafel']);
  });

  it('reaches 7.5 tiles, half a radian either side, and no further', () => {
    const floor = Array<string>(12).fill(`#${'.'.repeat(18)}#`);
    const open = { tiles: ['#'.repeat(20), ...floor, '#'.repeat(20)] };
    const from = { x: 1.5, y: 6.5, facing: EAST };
    const at = (away: number, angle: number) => ({
      x: from.x + away * Math.cos(angle),
      y: from.y + away * Math.sin(angle),
    });
    const lit = (away: number, angle: number) => inCone(open, NOTHING_SHUT, from, at(away, angle));
    expect([lit(7.5, 0), lit(7.6, 0)]).toEqual([true, false]);
    expect([lit(5, 0.49), lit(5, -0.49), lit(5, 0.51), lit(5, -0.51)]).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it('is cut off by walls and doors shut, and goes through a door open', () => {
    const behind = { x: 8.5, y: 2.5 };
    expect(inCone(ROOM, NOTHING_SHUT, { x: 3.5, y: 2.5, facing: EAST }, behind)).toBe(false);
    const doorway = { tiles: ['#######', '#.....#', '#######'] };
    const looker = { x: 1.5, y: 1.5, facing: EAST };
    const past = { x: 5.5, y: 1.5 };
    expect(inCone(doorway, new Set(['3,1']), looker, past)).toBe(false);
    expect(inCone(doorway, NOTHING_SHUT, looker, past)).toBe(true);
  });
});

/** Blackout on the pinned seed, the lights out, nobody found anything. */
function blackout(): GameState {
  return lightsOut(started(blackoutMission(), 5));
}

/** What a player standing at `looker` finds in `state` at once, nothing glanced at before. */
function findsIn(state: GameState, looker: Looker): string[] {
  const map = state.mission.map;
  return lookAround(map, shutDoors(map, state), looker, findables(state), {}, T0).found;
}

describe('what a run has to find', () => {
  it('lists the sources as placed, notes on their faces, loose parts, consoles, the sign', () => {
    const state = blackout();
    const things = findables(state);
    const at = (key: string) => things.find((thing) => thing.key === key);
    expect(at('source:buch-archiv')).toMatchObject({ x: 6.5, y: 1.5 });
    // The note on the Archiv's north wall (2,0) hangs on its south face, over (2,1).
    expect(at('note:2')?.x).toBe(2.5);
    expect(at('note:2')?.y).toBeCloseTo(1.05);
    expect(at('item:ersatzsicherung')).toMatchObject({ x: 7.5, y: 5.5 });
    expect(at('console:notstrom/b')).toMatchObject({ x: 2.5, y: 7.5 });
    expect(at('console:notlicht/-')).toMatchObject({ x: 11.5, y: 7.5 });
    expect(at('sign')).toMatchObject({ x: 2.5, y: 3.5 });
    expect(things.some((thing) => thing.key.includes('shelf'))).toBe(false);
    const carried = applyAction(state, {
      type: 'pick-item',
      playerId: 'p1',
      itemId: 'ersatzsicherung',
      at: T0,
    });
    expect(findables(carried).some((thing) => thing.key === 'item:ersatzsicherung')).toBe(false);
  });

  it('keys every thing apart, both consoles of a station too', () => {
    const finds: Find[] = [
      { of: 'source', id: 'buch' },
      { of: 'console', puzzleId: 'kette', console: 'a' },
      { of: 'console', puzzleId: 'kette', console: 'b' },
      { of: 'console', puzzleId: 'kabel', console: null },
      { of: 'sign' },
    ];
    expect(finds.map(findKey)).toEqual([
      'source:buch',
      'console:kette/a',
      'console:kette/b',
      'console:kabel/-',
      'sign',
    ]);
  });
});

describe('a room the power lights', () => {
  // Blackout's lever lights the Flur and the Archiv: it is the first station.
  const lit = (): GameState => ({ ...blackout(), currentPuzzleIndex: 1 });

  it('finds nothing for a player two steps in but what the same two rules find', () => {
    const state = lit();
    expect(viewFor(state, 'p1').map?.litRooms).toEqual(['FLUR', 'ARCHIV']);
    // Two steps in from the door at (4,6), facing in: the shelves, nothing to find.
    const in2 = { x: 4.5, y: 4.5, facing: NORTH };
    expect(findsIn(state, in2)).toEqual([]);
    expect(findsIn(blackout(), in2)).toEqual([]);
  });

  it('finds the sign by the shelves, nothing across the room till the lamp rests on it', () => {
    const state = lit();
    const byShelves = { x: 3.5, y: 3.5, facing: WEST };
    expect(findsIn(state, byShelves)).toEqual(['sign']);
    // The book on its lectern at (6,1), looked at for a quarter of a second.
    const book = { ...byShelves, facing: Math.atan2(1.5 - 3.5, 6.5 - 3.5) };
    const map = state.mission.map;
    const things = findables(state).filter((thing) => thing.key !== 'sign');
    const glance = lookAround(map, shutDoors(map, state), book, things, {}, T0);
    expect(glance.found).toEqual([]);
    expect(Object.keys(glance.glances)).toContain('source:buch-archiv');
    const later = lookAround(map, shutDoors(map, state), book, things, glance.glances, T0 + 250);
    expect(later.found).toContain('source:buch-archiv');
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canSee, parseMission, sightFrom, visibleTiles } from '../src/index.js';
import { tileKey, type Spot } from '../src/reach.js';

/**
 * Sight on the tile map: a wall hides what lies behind it, a doorway shows a
 * wedge of the room beyond, a shut door hides and an open one shows, and two
 * walls meeting corner to corner leave no gap to peek through — from
 * wherever one stands.
 */

/**
 * Two rooms, west (x 1–3) and east (x 5–11), with a door at (4,4).
 *
 *   0123456789012
 * 0 #############
 * 1 #...#.......#
 * 2 #...#.......#
 * 3 #...#.......#
 * 4 #...........#   door (4,4)
 * 5 #...#.......#
 * 6 #...#.......#
 * 7 #...#.......#
 * 8 #############
 */
const twoRooms = {
  tiles: [
    '#############',
    '#...#.......#',
    '#...#.......#',
    '#...#.......#',
    '#...........#',
    '#...#.......#',
    '#...#.......#',
    '#...#.......#',
    '#############',
  ],
};
const DOOR = tileKey(4, 4);
const OPEN = new Set<string>();
const SHUT = new Set([DOOR]);

/**
 * Two rooms touching corner to corner at the grid point (3,3): a gap of no
 * width between the walls (3,2) and (2,3).
 *
 *   012345
 * 0 ######
 * 1 #..###
 * 2 #..###
 * 3 ###..#
 * 4 ###..#
 * 5 ######
 */
const cornerRooms = { tiles: ['######', '#..###', '#..###', '###..#', '###..#', '######'] };
const SECOND_ROOM = ['3,3', '4,3', '3,4', '4,4'];

const middle = (x: number, y: number): Spot => ({ x: x + 0.5, y: y + 0.5 });

/** The floor tiles of a map, as tile centres. */
function floorOf(map: { tiles: readonly string[] }): Spot[] {
  return map.tiles.flatMap((row, y) =>
    [...row].flatMap((tile, x) => (tile === '.' ? [middle(x, y)] : [])),
  );
}

describe('canSee', () => {
  it('sees across open floor and not through a wall', () => {
    expect(canSee(twoRooms, middle(1, 1), middle(3, 7), OPEN)).toBe(true);
    expect(canSee(twoRooms, middle(2, 2), middle(6, 2), OPEN)).toBe(false);
  });

  it('sees through an open door and not through a shut one', () => {
    expect(canSee(twoRooms, middle(1, 4), middle(10, 4), OPEN)).toBe(true);
    expect(canSee(twoRooms, middle(1, 4), middle(10, 4), SHUT)).toBe(false);
  });

  it('never lets the tiles at either end block: a door may have shut on whoever stands in it', () => {
    expect(canSee(twoRooms, middle(4, 4), middle(1, 4), SHUT)).toBe(true);
    expect(canSee(twoRooms, middle(10, 4), middle(4, 4), SHUT)).toBe(true);
  });

  it('stops at a wall it only touches at a corner, and passes it a hair away', () => {
    // (1.5,1.5) → (3.5,3.5) runs exactly through the grid point (2,2), a corner of the
    // pillar (2,1).
    const pillar = { tiles: ['######', '#.#..#', '#....#', '#....#', '######'] };
    expect(canSee(pillar, middle(1, 1), middle(3, 3), OPEN)).toBe(false);
    expect(canSee(pillar, middle(3, 3), middle(1, 1), OPEN)).toBe(false);
    // A little steeper it passes below the pillar; a little flatter it runs into it.
    expect(canSee(pillar, middle(1, 1), { x: 3.45, y: 3.5 }, OPEN)).toBe(true);
    expect(canSee(pillar, middle(1, 1), { x: 3.5, y: 3.45 }, OPEN)).toBe(false);
  });

  it('does not squeeze between two walls meeting corner to corner, either way', () => {
    expect(canSee(cornerRooms, middle(1, 1), middle(4, 4), OPEN)).toBe(false);
    expect(canSee(cornerRooms, middle(4, 4), middle(1, 1), OPEN)).toBe(false);
    expect(canSee(cornerRooms, middle(2, 2), middle(3, 3), OPEN)).toBe(false);
    expect(canSee(cornerRooms, { x: 2.9, y: 2.9 }, { x: 3.1, y: 3.1 }, OPEN)).toBe(false);
  });

  it('is symmetric between every two floor tiles of Blackout, doors shut or open', () => {
    for (const shut of [OPEN, blackoutDoors]) {
      const floor = floorOf(blackout);
      for (const a of floor) {
        for (const b of floor) {
          expect(canSee(blackout, a, b, shut), `${a.x},${a.y} ↔ ${b.x},${b.y}`).toBe(
            canSee(blackout, b, a, shut),
          );
        }
      }
    }
  });

  it('refuses a line without finite ends loudly', () => {
    expect(() => canSee(twoRooms, middle(1, 1), { x: Infinity, y: 1 }, OPEN)).toThrow(/finite/);
  });
});

describe('visibleTiles', () => {
  it('hides what lies behind a wall and shows every wall of the room one stands in', () => {
    const seen = sightFrom(twoRooms, middle(2, 2), 8, SHUT);
    const east = floorOf(twoRooms).filter((spot) => spot.x > 5);
    const hidden = east.filter((spot) =>
      seen.tiles.has(tileKey(Math.floor(spot.x), Math.floor(spot.y))),
    );
    expect(hidden).toEqual([]);
    // The whole ring of walls, the four corners joining them included.
    for (let y = 0; y <= 8; y++) {
      expect(seen.walls.has(tileKey(0, y)), `west wall at y ${y}`).toBe(true);
      expect(seen.walls.has(tileKey(4, y)), `dividing wall at y ${y}`).toBe(true);
    }
    for (let x = 0; x <= 4; x++) {
      expect(seen.walls.has(tileKey(x, 0)), `north wall at x ${x}`).toBe(true);
      expect(seen.walls.has(tileKey(x, 8)), `south wall at x ${x}`).toBe(true);
    }
    expect(seen.walls.has('5,0')).toBe(false);
  });

  it('shows the corner wall between two seen walls, but no floor round a corner', () => {
    const seen = sightFrom(cornerRooms, middle(1, 1), 6, OPEN);
    expect(seen.walls.has('0,0') && seen.walls.has('3,0') && seen.walls.has('0,3')).toBe(true);
    expect(SECOND_ROOM.filter((key) => seen.tiles.has(key))).toEqual([]);
  });

  it('shows a wedge through a doorway, widening into the room beyond', () => {
    const seen = visibleTiles(twoRooms, middle(3, 4), 10, OPEN);
    // Straight through the door, and wider and wider the further in.
    for (const key of ['5,4', '5,3', '5,5', '8,2', '8,6', '11,1', '11,7']) {
      expect(seen.has(key), key).toBe(true);
    }
    // Beside the door the wall hides the room's corners near it.
    for (const key of ['5,1', '5,2', '5,6', '5,7', '8,1', '8,7']) {
      expect(seen.has(key), key).toBe(false);
    }
  });

  it('stops at a shut door, which is seen, and shows the room behind an open one', () => {
    const shut = sightFrom(twoRooms, middle(3, 4), 10, SHUT);
    expect(shut.walls.has(DOOR)).toBe(true);
    expect([...shut.tiles].filter((key) => Number(key.split(',')[0]) > 4)).toEqual([]);
    const open = sightFrom(twoRooms, middle(3, 4), 10, OPEN);
    expect(open.walls.has(DOOR)).toBe(false);
    expect(open.tiles.has('9,4')).toBe(true);
  });

  it('never peeks between two walls meeting corner to corner, from anywhere in the room', () => {
    for (let x = 1.05; x < 3; x += 0.1) {
      for (let y = 1.05; y < 3; y += 0.1) {
        const seen = visibleTiles(cornerRooms, { x, y }, 6, OPEN);
        expect(SECOND_ROOM.filter((key) => seen.has(key)), `from ${x},${y}`).toEqual([]);
        expect(seen.has('3,2') && seen.has('2,3')).toBe(true);
      }
    }
  });

  it('reaches no further than the radius, and lists only tiles on the map', () => {
    const seen = sightFrom(twoRooms, middle(1, 4), 3, OPEN);
    expect(seen.tiles.has('3,4')).toBe(true);
    expect(seen.tiles.has('5,4')).toBe(false);
    expect([...seen.walls].every((key) => seen.tiles.has(key))).toBe(true);
    const open = { tiles: ['....', '....'] };
    const edge = visibleTiles(open, middle(0, 0), 5, OPEN);
    expect([...edge].sort()).toEqual(['0,0', '0,1', '1,0', '1,1', '2,0', '2,1', '3,0', '3,1']);
  });

  it('outlines the floor in sight: inside the room behind a shut door, out through an open one', () => {
    const inside = (spot: Spot): boolean => spot.x >= 1 - 1e-9 && spot.x <= 4 + 1e-9;
    const shut = sightFrom(twoRooms, middle(2, 4), 10, SHUT).outline;
    expect(shut.length).toBeGreaterThan(100);
    expect(shut.every(inside)).toBe(true);
    const open = sightFrom(twoRooms, middle(2, 4), 10, OPEN).outline;
    expect(Math.max(...open.map((spot) => spot.x))).toBeCloseTo(12, 6);
    expect(open.filter((spot) => !inside(spot)).every((spot) => Math.abs(spot.y - 4.5) < 2)).toBe(
      true,
    );
  });

  it('outlines a closed room exactly along its walls, nowhere further than the radius', () => {
    const from = middle(2, 3);
    const outline = sightFrom(twoRooms, from, 10, SHUT).outline;
    // The shut door stands flush in the dividing wall at x 4.
    const onWall = (spot: Spot): boolean =>
      [1, 4].some((x) => Math.abs(spot.x - x) < 1e-6) ||
      [1, 8].some((y) => Math.abs(spot.y - y) < 1e-6);
    expect(outline.filter((spot) => !onWall(spot))).toEqual([]);
    const far = sightFrom(twoRooms, from, 1.5, SHUT).outline;
    expect(far.every((spot) => Math.hypot(spot.x - from.x, spot.y - from.y) <= 1.5 + 1e-9)).toBe(
      true,
    );
  });

  it('lights every floor tile within reach that a sight line from the lamp sees the middle of', () => {
    const floor = floorOf(blackout);
    for (const shut of [OPEN, blackoutDoors]) {
      for (const from of floor) {
        const seen = visibleTiles(blackout, from, 7.5, shut);
        const missed = floor.filter(
          (spot) =>
            Math.hypot(spot.x - from.x, spot.y - from.y) <= 7 &&
            canSee(blackout, from, spot, shut) &&
            !seen.has(tileKey(Math.floor(spot.x), Math.floor(spot.y))),
        );
        expect(missed, `from ${from.x},${from.y}`).toEqual([]);
      }
    }
  });

  it('refuses a radius that is no finite number of tiles', () => {
    expect(() => visibleTiles(twoRooms, middle(1, 1), Infinity, OPEN)).toThrow(/radius/);
    expect(() => visibleTiles(twoRooms, middle(1, 1), Number.NaN, OPEN)).toThrow(/radius/);
  });
});

const blackout = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8')),
).map;
/** Every door of Blackout shut, as at the start of a run. */
const blackoutDoors = new Set(blackout.doors.map((door) => tileKey(door.x, door.y)));
const cabinet = blackout.manuals.find((manual) => manual.id === 'aktenschrank');
const CABINET_SPOTS = (cabinet?.spots ?? []).map((spot) => tileKey(spot.x, spot.y));

describe('sight in Blackout', () => {
  it('has the cabinet spots in the Labor this test is about', () => {
    expect(CABINET_SPOTS).toEqual(['7,8', '8,8', '7,10']);
  });

  it('hides the Labor cabinet from console B in the Maschinenraum, doors shut or open', () => {
    const consoleB = middle(4, 9);
    for (const shut of [blackoutDoors, OPEN]) {
      const seen = visibleTiles(blackout, consoleB, 7.5, shut);
      expect(CABINET_SPOTS.filter((key) => seen.has(key))).toEqual([]);
      for (const spot of cabinet?.spots ?? []) {
        expect(canSee(blackout, consoleB, middle(spot.x, spot.y), shut)).toBe(false);
      }
    }
  });

  it('shows the Labor from its door: a wedge from the doorway, every cabinet spot one step in', () => {
    const labor = new Set([...blackoutDoors].filter((key) => key !== '10,7'));
    const fromDoor = visibleTiles(blackout, middle(10, 7), 7.5, labor);
    expect(fromDoor.has('7,10')).toBe(true);
    // The wall beside the door hides the spots along it until one steps in.
    expect(fromDoor.has('7,8') || fromDoor.has('8,8')).toBe(false);
    const inside = visibleTiles(blackout, middle(10, 8), 7.5, labor);
    expect(CABINET_SPOTS.filter((key) => inside.has(key))).toEqual(CABINET_SPOTS);
    for (const spot of cabinet?.spots ?? []) {
      expect(canSee(blackout, middle(10, 8), middle(spot.x, spot.y), labor)).toBe(true);
    }
  });

  // A look costs about 0.1 ms here; the budget is loose enough for a loaded
  // machine or a small CI runner and still catches a regression of 100×.
  it('looks from every floor tile in well under 10 ms on average', () => {
    const floor = floorOf(blackout);
    const started = performance.now();
    for (const from of floor) {
      visibleTiles(blackout, from, 7.5, blackoutDoors);
    }
    const perLook = (performance.now() - started) / floor.length;
    expect(perLook).toBeLessThan(10);
  });
});

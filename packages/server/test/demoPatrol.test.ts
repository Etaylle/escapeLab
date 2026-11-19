import { describe, expect, it } from 'vitest';
import type { DronePosition, MapDef, MapView } from '@escapelab/core';
import { havens, patrolsOn, spottedOn, type SightOn } from '../src/demo/patrol.js';
import { atHand, nearestOf, tilesBy } from '../src/demo/places.js';
import { groundOf, keyOf, lengthOf, middleOf, pointAlong, wayOver } from '../src/demo/route.js';

/**
 * The demo crew's reckoning on a map of its own: a corridor a drone flies up and down, a side
 * room off it, a door between two rooms.
 *
 *   #############
 *   #...........#   y 1: the corridor, the drone's beat from x 1 to x 11 and back
 *   #####.#######
 *   #.....#.....#   y 3: the side room, and a room behind the door at (6,3)
 *   #############
 */
const TILES = ['#############', '#...........#', '#####.#######', '#.....#.....#', '#############'];

function mapOf(doorOpen: boolean): MapView {
  const partial = {
    width: 13,
    height: 5,
    tiles: TILES.map((row, y) => (y === 3 ? `${row.slice(0, 6)}.${row.slice(7)}` : row)),
    doors: [{ id: 'tuer', x: 6, y: 3, open: doorOpen }],
    plates: [{ id: 'kamera', x: 3, y: 1, label: '', pressed: false, freezesDrone: true }],
    decor: [{ kind: 'shelf', x: 2, y: 3 }],
  };
  return partial as unknown as MapView;
}

const DRONE = {
  id: 'wache',
  waypoints: [
    { x: 1, y: 1 },
    { x: 11, y: 1 },
  ],
  speed: 2,
  range: 4,
  halfAngleDeg: 30,
  penaltySec: 15,
  activeAfterSolved: 0,
} as MapDef['drones'][number];

const at = (x: number, facing: number, frozen = false): Record<string, DronePosition> => ({
  wache: { x, y: 1.5, facing, range: 4, halfAngleDeg: 30, alerted: false, frozen },
});

const sight = (): SightOn => ({ map: mapOf(true), shut: new Set() });

describe('a way over the map', () => {
  it('goes round the furniture and through an open door, never over a camera plate', () => {
    const way = wayOver(groundOf(mapOf(true)), { x: 1, y: 3 }, { x: 8, y: 3 });
    expect(way).toBeNull();
    const round = wayOver(groundOf(mapOf(true)), { x: 3, y: 3 }, { x: 8, y: 3 });
    expect(round?.map(keyOf)).toEqual(['3,3', '4,3', '5,3', '6,3', '7,3', '8,3']);
    // The plate at (3,1) stands in the corridor: no way leads over it.
    expect(wayOver(groundOf(mapOf(true)), { x: 1, y: 1 }, { x: 5, y: 1 })).toBeNull();
  });

  it('stops at a shut door, unless it is taken as held open', () => {
    const shut = mapOf(false);
    expect(wayOver(groundOf(shut), { x: 5, y: 3 }, { x: 7, y: 3 })).toBeNull();
    const held = wayOver(groundOf(shut, new Set(['tuer'])), { x: 5, y: 3 }, { x: 7, y: 3 });
    expect(held?.map(keyOf)).toEqual(['5,3', '6,3', '7,3']);
  });

  it('is measured along its points', () => {
    const points = [middleOf({ x: 1, y: 1 }), middleOf({ x: 4, y: 1 }), middleOf({ x: 4, y: 3 })];
    expect(lengthOf(points)).toBe(5);
    expect(pointAlong(points, 4)).toEqual({ x: 4.5, y: 2.5 });
    expect(pointAlong(points, 9)).toEqual({ x: 4.5, y: 3.5 });
  });
});

describe('a place to stand', () => {
  it('is a free tile beside the thing, a haven before any other, the nearest of those', () => {
    const map = mapOf(true);
    const tiles = tilesBy(groundOf(map), { x: 4, y: 3 }, new Set(['5,3']));
    expect(tiles.map(keyOf)).toEqual(['5,3', '3,3']);
    // On the thing's own tile only where nothing beside it is free: the plate's is off limits.
    expect(tilesBy(groundOf(map), { x: 3, y: 1 }, new Set()).map(keyOf)).toEqual(['4,1', '2,1']);
    // The shelf boxes the room's west corner in: whoever uses a thing there stands on its tile.
    expect(tilesBy(groundOf(map), { x: 1, y: 3 }, new Set()).map(keyOf)).toEqual(['1,3']);
    expect(nearestOf(map, { x: 3, y: 3 }, tiles, new Set())).toEqual({ x: 3, y: 3 });
    expect(nearestOf(map, { x: 3, y: 3 }, tiles, new Set(['5,3']))).toEqual({ x: 5, y: 3 });
  });

  it('is at hand: within the room’s reach of the thing’s middle', () => {
    const point = atHand({ x: 5, y: 3 }, { x: 4, y: 3 });
    expect(point).toEqual({ x: 5.25, y: 3.5 });
  });
});

describe('the patrols foretold', () => {
  it('leave as havens only the tiles no drone ever looks at', () => {
    const safe = havens([DRONE], sight());
    // The corridor is all beat; the rooms below it lie behind the wall, and the gap at (5,2)
    // too steeply under the beat for a cone of thirty degrees to reach into.
    expect(safe.has('6,1')).toBe(false);
    expect(safe.has('1,1')).toBe(false);
    expect(safe.has('1,3')).toBe(true);
    expect(safe.has('9,3')).toBe(true);
    expect(safe.has('5,2')).toBe(true);
    // A wall is nobody's haven.
    expect(safe.has('4,2')).toBe(false);
  });

  it('spot a walk into the cone, and none behind the drone or out of its range', () => {
    const east = patrolsOn([DRONE], at(4.5, 0));
    const walk = (x: number) => ({ points: [middleOf({ x, y: 1 })], speed: 4.2, hold: 1 });
    expect(spottedOn(walk(6), east, sight())).toBe(0);
    expect(spottedOn(walk(2), east, sight())).toBeNull();
    // Ten tiles ahead it is out of range now, and in it once the drone has flown on.
    expect(spottedOn({ ...walk(11), hold: 0.5 }, east, sight())).toBeNull();
    expect(spottedOn({ ...walk(11), hold: 4 }, east, sight())).toBeGreaterThan(0.5);
  });

  it('take a drone held still by its plate, or asleep, to look at nothing', () => {
    expect(patrolsOn([DRONE], at(4.5, 0, true))).toEqual([]);
    expect(patrolsOn([DRONE], {})).toEqual([]);
  });

  it('follow the beat round its end: a drone flying off comes back', () => {
    // Flying east at x 9, it turns at x 11.5 and looks west along the corridor after.
    const east = patrolsOn([DRONE], at(9.5, 0));
    const behind = { points: [middleOf({ x: 8, y: 1 })], speed: 4.2 };
    expect(spottedOn({ ...behind, hold: 0.5 }, east, sight())).toBeNull();
    const seen = spottedOn({ ...behind, hold: 6 }, east, sight());
    expect(seen).toBeGreaterThan(1);
    expect(seen).toBeLessThan(2);
  });
});

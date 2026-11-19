import { walkable, type MapView } from '@escapelab/core';

/**
 * Ways over the map as a seat's view shows it, for the demo crew (crew.ts): over floor that no
 * furniture takes and through the doors that stand open — what a page walks its figure over.
 * Tiles are whole numbers, points lie anywhere on them; a tile's middle is where a figure stands
 * on it.
 */

/** A tile of the map, or a point on it, in tiles. */
export interface Spot {
  x: number;
  y: number;
}

export const keyOf = (tile: Spot): string => `${tile.x},${tile.y}`;
export const tileOf = (point: Spot): Spot => ({ x: Math.floor(point.x), y: Math.floor(point.y) });
export const middleOf = (tile: Spot): Spot => ({ x: tile.x + 0.5, y: tile.y + 0.5 });
export const distance = (a: Spot, b: Spot): number => Math.hypot(a.x - b.x, a.y - b.y);

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** The tiles beside `tile`, east, west, south and north of it. */
export const besides = (tile: Spot): Spot[] =>
  NEIGHBOURS.map(([dx, dy]) => ({ x: tile.x + dx, y: tile.y + dy }));

/** The doors of `map` shut right now, by tile key. */
export function shutOn(map: MapView): Set<string> {
  return new Set(map.doors.filter((door) => !door.open).map(keyOf));
}

/**
 * The ground a walk goes over: the map, the tiles shut to it (doors, by key) and the tiles it
 * keeps off though they are floor — a camera plate, which would hold a drone still.
 */
export interface Ground {
  map: MapView;
  shut: ReadonlySet<string>;
  off: ReadonlySet<string>;
}

/** The ground of `map` as it stands; the doors of `held` (by id) taken as open. */
export function groundOf(map: MapView, held: ReadonlySet<string> = new Set()): Ground {
  const shut = map.doors.filter((door) => !door.open && !held.has(door.id)).map(keyOf);
  const off = map.plates.filter((plate) => plate.freezesDrone).map(keyOf);
  return { map, shut: new Set(shut), off: new Set(off) };
}

/** Whether a figure can stand on `tile` of `ground`. */
export function free(ground: Ground, tile: Spot): boolean {
  const key = keyOf(tile);
  return walkable(ground.map, tile.x, tile.y) && !ground.shut.has(key) && !ground.off.has(key);
}

/**
 * The tiles of a shortest way over `ground` from `from` to `to`, both included; null where none
 * leads there. The tile it starts on never stops it: a door may have shut on whoever stands in it.
 */
export function wayOver(ground: Ground, from: Spot, to: Spot): Spot[] | null {
  const cameFrom = new Map<string, Spot | null>([[keyOf(from), null]]);
  const queue: Spot[] = [from];
  // A for…of over an array also visits what is pushed onto it while it runs.
  for (const tile of queue) {
    if (tile.x === to.x && tile.y === to.y) {
      return traced(cameFrom, tile);
    }
    for (const next of besides(tile)) {
      if (!cameFrom.has(keyOf(next)) && free(ground, next)) {
        cameFrom.set(keyOf(next), tile);
        queue.push(next);
      }
    }
  }
  return null;
}

/** The way that led to `end`, from its start. */
function traced(cameFrom: ReadonlyMap<string, Spot | null>, end: Spot): Spot[] {
  const way: Spot[] = [];
  for (let at: Spot | null = end; at !== null; at = cameFrom.get(keyOf(at)) ?? null) {
    way.unshift(at);
  }
  return way;
}

/** How long a way of `points` is, in tiles. */
export function lengthOf(points: readonly Spot[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += distance(points[i - 1] as Spot, points[i] as Spot);
  }
  return length;
}

/** The point `along` tiles down the way of `points`: its end past its length. */
export function pointAlong(points: readonly Spot[], along: number): Spot {
  let left = Math.max(0, along);
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1] as Spot, points[i] as Spot];
    const leg = distance(a, b);
    if (left <= leg && leg > 0) {
      return { x: a.x + ((b.x - a.x) * left) / leg, y: a.y + ((b.y - a.y) * left) / leg };
    }
    left -= leg;
  }
  return points.at(-1) ?? { x: 0, y: 0 };
}

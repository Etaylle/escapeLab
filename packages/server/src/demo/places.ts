import type { ConsoleId, MapView, PlayerView } from '@escapelab/core';
import {
  besides,
  free,
  groundOf,
  keyOf,
  middleOf,
  wayOver,
  type Ground,
  type Spot,
} from './route.js';

/**
 * Where things are, as a seat's view says it, and where a figure stands to use them: beside a
 * console or a source, on a plate or a part, close enough for the room to count it there
 * (room.ts: 1.6 tiles to work or read, 0.95 to take, set in or unlock).
 */

/** How far from a thing's middle a figure stands to reach into it, tiles: within the room's. */
const AT_HAND = 0.75;

/** The station armed on `view`, by its puzzle's id; null for none — or none this seat knows of. */
export function armedOn(view: PlayerView): string | null {
  const armed = view.map?.stations.find((s) => s.known && s.status === 'armed');
  return armed?.puzzleId ?? null;
}

/** Where console `console` of the station of `puzzleId` stands on `map`; null for none shown. */
export function consoleOn(map: MapView, puzzleId: string, console: ConsoleId | null): Spot | null {
  const spot = map.stations.find(
    (s) => s.puzzleId === puzzleId && (s.console ?? null) === console,
  );
  return spot === undefined ? null : { x: spot.x, y: spot.y };
}

/** Whether an emergency has the lab on `view`. */
export const emergencyOn = (view: PlayerView | null): boolean => view?.map?.sabotage != null;

/**
 * The tiles to stand on by the thing on `target`: the free ones beside it, those of `safe` (by
 * key) first — and the thing's own tile only where none beside it is free: nobody stands on a
 * console that has room before it.
 */
export function tilesBy(ground: Ground, target: Spot, safe: ReadonlySet<string>): Spot[] {
  const beside = besides(target).filter((tile) => free(ground, tile));
  const rank = (tile: Spot): number => (safe.has(keyOf(tile)) ? 0 : 1);
  return beside.length > 0
    ? beside.sort((a, b) => rank(a) - rank(b))
    : [target].filter((tile) => free(ground, tile));
}

/** How many steps a shortest way from `from` to `to` over `ground` takes; Infinity for none. */
export function stepsOver(ground: Ground, from: Spot, to: Spot): number {
  const way = wayOver(ground, from, to);
  return way === null ? Infinity : way.length - 1;
}

/**
 * The tile of `tiles` — ranked best first — `from` gets to in the fewest steps among the best
 * it gets to at all, over `map` with the doors of `held` taken as open; null where it gets to
 * none.
 */
export function nearestOf(
  map: MapView,
  from: Spot,
  tiles: readonly Spot[],
  safe: ReadonlySet<string>,
  held: ReadonlySet<string> = new Set(),
): Spot | null {
  const ground = groundOf(map, held);
  const reached = tiles
    .map((tile) => ({ tile, steps: stepsOver(ground, from, tile), haven: safe.has(keyOf(tile)) }))
    .filter((entry) => entry.steps < Infinity);
  const best = reached.some((entry) => entry.haven)
    ? reached.filter((entry) => entry.haven)
    : reached;
  best.sort((a, b) => a.steps - b.steps);
  return best[0]?.tile ?? null;
}

/**
 * The point to stand on, on the tile `tile`, to reach into the thing on `target`: the tile's
 * middle on the thing's own tile, else drawn towards the thing until it is at hand.
 */
export function atHand(tile: Spot, target: Spot): Spot {
  const [from, to] = [middleOf(tile), middleOf(target)];
  return { x: to.x + (from.x - to.x) * AT_HAND, y: to.y + (from.y - to.y) * AT_HAND };
}

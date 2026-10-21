import type { MapDef } from './mission.js';

/**
 * Where the crew can walk, for mission validation: over floor that no
 * furniture takes; puzzle doors open for good once their puzzle is solved,
 * plate doors only while someone stands on the plate — or for good, too,
 * once the puzzle they name in `untilSolved` is solved. Tiles are keyed "x,y".
 */

export interface Spot {
  x: number;
  y: number;
}

type Door = MapDef['doors'][number];

export const tileKey = (x: number, y: number): string => `${x},${y}`;

const STEPS = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
] as const;

/** The decor tiles of each map's decor list, worked out once per list. */
const solidByDecor = new WeakMap<readonly Spot[], ReadonlySet<string>>();

/**
 * The tiles a map's furniture stands on, by key: solid like walls for every
 * step — the avatars', the reach proofs', the harness's route — though light
 * and sight pass over it.
 */
export function decorTiles(decor: readonly Spot[]): ReadonlySet<string> {
  let tiles = solidByDecor.get(decor);
  if (tiles === undefined) {
    tiles = new Set(decor.map((piece) => tileKey(piece.x, piece.y)));
    solidByDecor.set(decor, tiles);
  }
  return tiles;
}

/** Whether somebody can stand on the tile (x, y): floor that no furniture takes. */
export function walkable(map: Pick<MapDef, 'tiles' | 'decor'>, x: number, y: number): boolean {
  return map.tiles[y]?.charAt(x) === '.' && !decorTiles(map.decor).has(tileKey(x, y));
}

/** Tiles reachable from `start`, treating doors as walls unless `isOpen` says otherwise. */
function flood(map: MapDef, start: Spot, isOpen: (door: Door) => boolean): Set<string> {
  const doorAt = new Map(map.doors.map((d) => [tileKey(d.x, d.y), d]));
  const seen = new Set<string>([tileKey(start.x, start.y)]);
  const queue: Spot[] = [start];
  // A for…of over an array also visits what is pushed onto it while it runs.
  for (const current of queue) {
    for (const [dx, dy] of STEPS) {
      const next = { x: current.x + dx, y: current.y + dy };
      const k = tileKey(next.x, next.y);
      if (seen.has(k) || !walkable(map, next.x, next.y)) {
        continue;
      }
      const door = doorAt.get(k);
      if (door !== undefined && !isOpen(door)) {
        continue;
      }
      seen.add(k);
      queue.push(next);
    }
  }
  return seen;
}

/** Whether `solved` opens a door for good: its puzzle, or the one a plate door waits for. */
const solvedDoor =
  (solved: ReadonlySet<string>) =>
  (door: Door): boolean => {
    const { opensBy } = door;
    const puzzleId = opensBy.kind === 'puzzle' ? opensBy.puzzleId : opensBy.untilSolved;
    return puzzleId !== undefined && solved.has(puzzleId);
  };

/** Where the plate of a plate door lies; null for a puzzle door or an unknown plate. */
function plateOf(map: MapDef, door: Door): Spot | null {
  const { opensBy } = door;
  if (opensBy.kind !== 'plate') {
    return null;
  }
  return map.plates.find((p) => p.id === opensBy.plateId) ?? null;
}

/**
 * Per-player reachability once `solved` puzzles are done, as a fixpoint: a
 * plate door is passable for a player when some *other* player can reach
 * the plate, which is exactly the cooperation the game requires.
 */
export function reachability(
  map: MapDef,
  spawns: readonly Spot[],
  solved: ReadonlySet<string>,
): Set<string>[] {
  const opened = solvedDoor(solved);
  let reach: Set<string>[] = spawns.map(() => new Set<string>());
  for (let round = 0; round < spawns.length * map.doors.length + 2; round++) {
    const known = reach;
    const heldFor = (i: number, door: Door): boolean => {
      const plate = plateOf(map, door);
      return (
        plate !== null && known.some((tiles, j) => j !== i && tiles.has(tileKey(plate.x, plate.y)))
      );
    };
    const next = spawns.map((spawn, i) =>
      flood(map, spawn, (door) => opened(door) || heldFor(i, door)),
    );
    const grew = next.some((tiles, i) => tiles.size !== (reach[i]?.size ?? 0));
    reach = next;
    if (!grew) {
      break;
    }
  }
  return reach;
}

/**
 * Every crew a mission takes: each count of players from `min` to `max`,
 * starting on any choice of that many spawns. Players are interchangeable,
 * so these are choices, not orders.
 */
export function crewsOf(spawns: readonly Spot[], min: number, max: number): Spot[][] {
  const choose = (from: readonly Spot[], size: number): Spot[][] =>
    size === 0
      ? [[]]
      : from.flatMap((spot, i) =>
          choose(from.slice(i + 1), size - 1).map((rest) => [spot, ...rest]),
        );
  const sizes = Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => min + i);
  return sizes.flatMap((size) => choose(spawns, size));
}

/** On the spot or orthogonally next to it: well within the presence radius. */
export function canStandAt(tiles: ReadonlySet<string>, spot: Spot): boolean {
  return (
    tiles.has(tileKey(spot.x, spot.y)) ||
    STEPS.some(([dx, dy]) => tiles.has(tileKey(spot.x + dx, spot.y + dy)))
  );
}

/**
 * Whether every player can stand at `spot` at the same time. Nobody may be
 * left outside holding a plate, so the crew gathers in the spot's home — the
 * tiles joined to it by doors that `solved` opened for good — and the others
 * come in through plate doors whose plate lies inside the home, held by
 * somebody already there: somebody has to start in the home. (A crew that
 * could still make it by trading plates further out is turned down too; that
 * is the safe side.)
 */
export function canGather(
  map: MapDef,
  spawns: readonly Spot[],
  solved: ReadonlySet<string>,
  spot: Spot,
): boolean {
  const opened = solvedDoor(solved);
  const home = flood(map, spot, opened);
  const heldInside = (door: Door): boolean => {
    const plate = plateOf(map, door);
    return plate !== null && home.has(tileKey(plate.x, plate.y));
  };
  const someoneInside = spawns.some((spawn) => home.has(tileKey(spawn.x, spawn.y)));
  const walksIn = (spawn: Spot): Set<string> =>
    flood(map, spawn, (door) => opened(door) || heldInside(door));
  return someoneInside && spawns.every((spawn) => canStandAt(walksIn(spawn), spot));
}

/**
 * Whether two different players can stand at two spots at the same time
 * once `solved` puzzles are done, asked of as many pairs of spots as needed:
 * one of them walks to their spot first — the others holding plates for
 * them, as in `reachability` — and stays there; then another walks to the
 * other spot with the help of everybody but the one who stays.
 */
export function twoAtOnce(
  map: MapDef,
  spawns: readonly Spot[],
  solved: ReadonlySet<string>,
): (one: Spot, other: Spot) => boolean {
  const reach = reachability(map, spawns, solved);
  const staying = new Map<number, Set<string>[]>();
  /** What the others reach while player `first` stands still. */
  const others = (first: number): Set<string>[] => {
    const known = staying.get(first);
    if (known !== undefined) {
      return known;
    }
    const rest = reachability(map, spawns.filter((_, i) => i !== first), solved);
    staying.set(first, rest);
    return rest;
  };
  return (one, other) => {
    const orders: [Spot, Spot][] = [
      [one, other],
      [other, one],
    ];
    return reach.some((tiles, first) =>
      orders.some(
        ([mine, theirs]) =>
          canStandAt(tiles, mine) && others(first).some((rest) => canStandAt(rest, theirs)),
      ),
    );
  };
}

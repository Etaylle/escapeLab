import type { MapDef } from './mission.js';
import type { PuzzleDef } from './puzzles/index.js';
import { pickOf } from './rng.js';

/**
 * Stations that take turns: puzzles naming the same `pool` are alternatives for one place — a
 * Wechselplatz — and a run has exactly one of them, drawn from its seed. The others are out of
 * service for that run: never armed, never solved, without an instance in any view. Whatever
 * waits for „this place is solved" — a door, a part — names the pool instead of a member, and
 * every count of stations counts a pool as one.
 */

/** The station a run has at each Wechselplatz: the drawn puzzle's id, by the pool's id. */
export type Draw = Readonly<Record<string, string>>;

type Pooled = Pick<PuzzleDef, 'id' | 'pool'>;

/** A mission's pools, in the order the file first names them: each with its members' ids. */
export function poolsOf(puzzles: readonly Pooled[]): Map<string, string[]> {
  const pools = new Map<string, string[]>();
  for (const { id, pool } of puzzles) {
    if (pool !== undefined) {
      pools.set(pool, [...(pools.get(pool) ?? []), id]);
    }
  }
  return pools;
}

/**
 * The draw of `seed`: for each pool one of its members, picked from the seed and the pool's id
 * alone — whatever order the puzzles stand in, at any difficulty — so that one seed always has
 * the same stations and the Tagesschicht gives every crew the day's.
 */
export function drawPools(puzzles: readonly Pooled[], seed: number): Draw {
  const draw: Record<string, string> = {};
  for (const [pool, members] of poolsOf(puzzles)) {
    const drawn = pickOf([...members].sort(), seed, `pool:${pool}`);
    if (drawn !== undefined) {
      draw[pool] = drawn;
    }
  }
  return draw;
}

/** Every draw a mission can have — one for a mission without pools, the empty one. */
export function everyDraw(puzzles: readonly Pooled[]): Draw[] {
  let draws: Record<string, string>[] = [{}];
  for (const [pool, members] of poolsOf(puzzles)) {
    draws = draws.flatMap((draw) => members.map((id) => ({ ...draw, [pool]: id })));
  }
  return draws;
}

/** How many stations a run of the mission has: every pool counts as the one it draws. */
export function stationCount(puzzles: readonly Pooled[]): number {
  return puzzles.filter((p) => p.pool === undefined).length + poolsOf(puzzles).size;
}

/** Whether `draw` leaves `puzzle` out of service: it shares a pool, and another was drawn. */
export function restsIn(draw: Draw, puzzle: Pooled): boolean {
  const drawn = puzzle.pool === undefined ? undefined : draw[puzzle.pool];
  return drawn !== undefined && drawn !== puzzle.id;
}

/**
 * The puzzles as a run of `draw` takes them: its stations first, in the file's order — a pool
 * standing where its first member stands, as the drawn one —, the stations out of service after
 * them. A run's `mission.puzzles` stand so, which keeps every index below `stationCount` a
 * station of the run.
 */
export function runOrder<P extends Pooled>(puzzles: readonly P[], draw: Draw): P[] {
  const placed = new Set<string>();
  const live = puzzles.flatMap((puzzle) => {
    const drawn = puzzle.pool === undefined ? undefined : draw[puzzle.pool];
    if (puzzle.pool === undefined || drawn === undefined) {
      return [puzzle];
    }
    if (placed.has(puzzle.pool)) {
      return [];
    }
    placed.add(puzzle.pool);
    return puzzles.filter((p) => p.id === drawn);
  });
  return [...live, ...puzzles.filter((puzzle) => restsIn(draw, puzzle))];
}

/** The stations a run of `draw` has, in the run's order: `runOrder` less those out of service. */
export function stationsIn<P extends Pooled>(puzzles: readonly P[], draw: Draw): P[] {
  return runOrder(puzzles, draw).filter((puzzle) => !restsIn(draw, puzzle));
}

/** The puzzle `ref` names in a run of `draw`: a pool's drawn station, else the id it is. */
export function drawnOf(draw: Draw, ref: string): string {
  return draw[ref] ?? ref;
}

/** Whether `ref` — a puzzle's id, or a pool's — names `puzzle`. */
export function namesStation(ref: string | undefined, puzzle: Pooled): boolean {
  return ref !== undefined && (ref === puzzle.id || ref === puzzle.pool);
}

/** A draw in words, as a validation issue names it: `pool "funk" drawing "morse"`; '' for none. */
export function drawInWords(draw: Draw): string {
  return Object.entries(draw)
    .map(([pool, id]) => `pool "${pool}" drawing "${id}"`)
    .join(', ');
}

type Source = MapDef['manuals'][number];

/** Whether a source prints rules of a station in service: `resting` are those out of it. */
const inService = (source: Source, resting: ReadonlySet<string>): boolean =>
  source.puzzleIds.some((id) => !resting.has(id));

/**
 * The parts a run of `draw` does not put out, by id: one a station out of service waits for,
 * and the key of a cabinet whose rules are all of stations out of service.
 */
export function partsHeldBack(
  puzzles: readonly Pooled[],
  map: Pick<MapDef, 'items' | 'manuals'>,
  draw: Draw,
): Set<string> {
  const resting = new Set(puzzles.filter((p) => restsIn(draw, p)).map((p) => p.id));
  const deadLocks = new Set(
    map.manuals.filter((m) => !inService(m, resting)).map((m) => m.needsKey),
  );
  return new Set(
    map.items
      .filter(
        (item) =>
          (item.requiredFor !== undefined && resting.has(item.requiredFor)) ||
          deadLocks.has(item.id),
      )
      .map((item) => item.id),
  );
}

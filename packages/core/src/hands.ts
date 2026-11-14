import type { Mission } from './mission.js';
import type { ConsoleId } from './puzzles/module.js';

/**
 * The hands a station takes (backlog M-1): the places at it that one member of the crew holds
 * at once, as its mission lays them out.
 */

/** A place at a station that one hand of the crew holds. */
export type Place =
  /** one of its consoles: 'a' at a station with one, the whole crew's panel included */
  | { kind: 'console'; console: ConsoleId }
  /** a manual object covering it, where somebody reads its rules (map.ts `backupsOf`) */
  | { kind: 'source'; id: string }
  /** the plate of a door it keeps open until it is solved (`untilSolved`), by the plate's id */
  | { kind: 'plate'; id: string }
  /** a part it still needs carried in, by the item's id */
  | { kind: 'part'; id: string };

/**
 * Every place of the station of `puzzleId`, in this order: its consoles — a and b, or the one
 * it has —, the manual objects covering it, the plates of the doors that stay open once it is
 * solved (`untilSolved`), and the parts it still needs carried in: those it waits for
 * (`requiredFor`), and the key of a cabinet covering it that no station before it opens.
 */
export function placesOf(mission: Pick<Mission, 'puzzles' | 'map'>, puzzleId: string): Place[] {
  const { map, puzzles } = mission;
  const consoles = map.stations
    .filter((spot) => spot.puzzleId === puzzleId)
    .map((spot): Place => ({ kind: 'console', console: spot.console ?? 'a' }));
  const sources = map.manuals.filter((manual) => manual.puzzleIds.includes(puzzleId));
  const plates = map.doors.flatMap(({ opensBy }) =>
    opensBy.kind === 'plate' && opensBy.untilSolved === puzzleId ? [opensBy.plateId] : [],
  );
  const firstCovered = (ids: readonly string[]): string | undefined =>
    puzzles.find((puzzle) => ids.includes(puzzle.id))?.id;
  const keys = sources.flatMap(({ needsKey, puzzleIds }) =>
    needsKey !== undefined && firstCovered(puzzleIds) === puzzleId ? [needsKey] : [],
  );
  const awaited = map.items.filter((item) => item.requiredFor === puzzleId).map((item) => item.id);
  return [
    ...consoles,
    ...sources.map((manual): Place => ({ kind: 'source', id: manual.id })),
    ...[...new Set(plates)].map((id): Place => ({ kind: 'plate', id })),
    ...[...new Set([...awaited, ...keys])].map((id): Place => ({ kind: 'part', id })),
  ];
}

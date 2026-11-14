import { crewOf } from './actions.js';
import { crewFound, findKey } from './discovery.js';
import { consoleOf, lightsAreOut, solvedYet, stationKey } from './map.js';
import type { Mission } from './mission.js';
import { moduleFor, type PuzzleDef } from './puzzles/index.js';
import type { ConsoleId } from './puzzles/module.js';
import type { GameState } from './state.js';

/**
 * The hands a station takes (backlog M-1): the places at it that one member of the crew holds
 * at once, as its mission lays them out, and who of the crew holds which right now.
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

/** How many the crew the run counts has to be, at least, for a view to name its hands. */
const HANDS_FROM = 3;

/** One of the crew at the station in front of it, and the place they hold there: null for none. */
interface Hand {
  playerId: string;
  place: Place | null;
}

/**
 * The hands at the station in front of the crew, as a view tells them (PlayerView `hands`): the
 * place each of the crew the run counts holds, in crew order, and the places of the station
 * that nobody holds and the crew knows of.
 */
export interface HandsView {
  held: Hand[];
  open: Place[];
}

/**
 * The hands at the armed station for a crew of HANDS_FROM or more, from presence — the
 * server's word of who stands where — and the parts in hand; null for a smaller crew, and while
 * no station is armed: before the lights go out, and once the last one is solved.
 */
export function handsOf(state: GameState): HandsView | null {
  const def = state.mission.puzzles[state.currentPuzzleIndex];
  const crew = crewOf(state).map((player) => player.id);
  if (!lightsAreOut(state) || def === undefined || crew.length < HANDS_FROM) {
    return null;
  }
  return {
    held: crew.map((playerId) => ({ playerId, place: placeHeld(state, def, playerId) })),
    open: placesOf(state.mission, def.id).filter((place) => isOpen(state, def, crew, place)),
  };
}

/**
 * The place `playerId` holds at the station of `def`, the first of: one of its consoles, a
 * manual object covering it, a plate that holds something still (`plateHolds`), a part in
 * hand. Null for none.
 */
function placeHeld(state: GameState, def: PuzzleDef, playerId: string): Place | null {
  const at = consoleOf(state, def.id, playerId);
  if (at !== null) {
    return { kind: 'console', console: at };
  }
  const { manuals, plates } = state.presence;
  const here = (players: readonly string[] | undefined): boolean =>
    players?.includes(playerId) === true;
  const source = state.mission.map.manuals.find(
    (manual) => manual.puzzleIds.includes(def.id) && here(manuals[manual.id]),
  );
  if (source !== undefined) {
    return { kind: 'source', id: source.id };
  }
  const plate = Object.keys(plates).find((id) => here(plates[id]) && plateHolds(state, id));
  if (plate !== undefined) {
    return { kind: 'plate', id: plate };
  }
  const part = Object.keys(state.items).find((id) => state.items[id]?.carriedBy === playerId);
  return part === undefined ? null : { kind: 'part', id: part };
}

/**
 * Whether holding the plate `plateId` does something still: it holds a drone still, or opens a
 * door that is not open for good yet — whose `untilSolved` station the crew has not solved.
 */
function plateHolds(state: GameState, plateId: string): boolean {
  const { doors, drones } = state.mission.map;
  const opens = doors.some(
    ({ opensBy }) =>
      opensBy.kind === 'plate' &&
      opensBy.plateId === plateId &&
      (opensBy.untilSolved === undefined || !solvedYet(state, opensBy.untilSolved)),
  );
  return opens || drones.some((drone) => drone.frozenByPlate === plateId);
}

/** Whether `place` at the station of `def` waits for a hand, as far as the crew knows of it. */
function isOpen(state: GameState, def: PuzzleDef, crew: readonly string[], place: Place): boolean {
  const { manuals, plates } = state.presence;
  switch (place.kind) {
    case 'console':
      return consoleFree(state, def, crew, place.console);
    case 'source':
      return knownSource(state, place.id) && (manuals[place.id] ?? []).length === 0;
    case 'plate':
      return (plates[place.id] ?? []).length === 0;
    case 'part':
      return partWanted(state, place.id);
  }
}

/**
 * Whether the console `console` of the station of `def` waits for a hand: nobody stands at it —
 * where the whole crew works the panel, somebody of the crew is not at it yet.
 */
function consoleFree(
  state: GameState,
  def: PuzzleDef,
  crew: readonly string[],
  console: ConsoleId,
): boolean {
  if (moduleFor(def.type).wholeCrew) {
    return crew.some((playerId) => consoleOf(state, def.id, playerId) === null);
  }
  return (state.presence.stations[stationKey({ puzzleId: def.id, console })] ?? []).length === 0;
}

/** Whether somebody of the crew has come across the manual object `id`. */
const knownSource = (state: GameState, id: string): boolean =>
  crewFound(state, findKey({ of: 'source', id }));

/**
 * Whether the part `id` still waits to be carried in, as far as the crew knows: somebody has
 * found it, it is in nobody's hand nor in its place — and, a cabinet's key, the cabinet has been
 * come across too, or naming it would give the cabinet away.
 */
function partWanted(state: GameState, id: string): boolean {
  const item = state.items[id];
  const lock = state.mission.map.manuals.find((manual) => manual.needsKey === id);
  const lockKnown = lock === undefined || knownSource(state, lock.id);
  const lying = (item?.carriedBy ?? null) === null && item?.delivered !== true;
  return lying && lockKnown && crewFound(state, findKey({ of: 'item', id }));
}

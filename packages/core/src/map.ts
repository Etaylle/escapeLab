import { startsClosed, type ManualDef, type MapDef } from './mission.js';
import type { ConsoleId } from './puzzles/module.js';
import { tileKey, type Spot } from './reach.js';
import type { GameState } from './state.js';

/**
 * Pure helpers for the tile map: doors, the steps an avatar can take, the
 * currently armed station, who stands where.
 */

/** One spot of a station on the map: its puzzle, and which console where it has two. */
type StationSpot = Pick<MapDef['stations'][number], 'puzzleId' | 'console'>;

/**
 * What presence keys a station spot by: the puzzle id for a station with
 * one console and for console a, `<puzzleId>/b` for console b.
 */
export function stationKey(spot: StationSpot): string {
  return spot.console === 'b' ? `${spot.puzzleId}/b` : spot.puzzleId;
}

export function platePressed(state: GameState, plateId: string): boolean {
  return state.pressedPlates.includes(plateId);
}

/** Whether the crew has solved `puzzleId`: it comes before the current one, or the run is won. */
function solvedYet(state: GameState, puzzleId: string): boolean {
  const index = state.mission.puzzles.findIndex((p) => p.id === puzzleId);
  return index >= 0 && (state.phase === 'won' || index < state.currentPuzzleIndex);
}

/**
 * A puzzle door is open once its puzzle is solved; a plate door while its
 * plate is held, and for good once the puzzle it names in `untilSolved` is.
 */
export function doorOpen(map: MapDef, state: GameState, doorId: string): boolean {
  const door = map.doors.find((d) => d.id === doorId);
  if (door === undefined) {
    return false;
  }
  const { opensBy } = door;
  if (opensBy.kind === 'puzzle') {
    return solvedYet(state, opensBy.puzzleId);
  }
  return (
    platePressed(state, opensBy.plateId) ||
    (opensBy.untilSolved !== undefined && solvedYet(state, opensBy.untilSolved))
  );
}

/** The doors shut right now, by tile key: they stop avatars and sight alike. */
export function shutDoors(map: MapDef, state: GameState): Set<string> {
  return new Set(
    map.doors.filter((door) => !doorOpen(map, state, door.id)).map((d) => tileKey(d.x, d.y)),
  );
}

/**
 * The longest step an avatar takes between two position updates, in tiles:
 * clients walk 4.2 tiles and send about 12 updates a second, so a step is
 * about 0.35, and a burst after some lag stays below this.
 */
export const MAX_STEP = 1.5;
/** How finely a step is checked along its way, in tiles. */
const STEP_SAMPLE = 0.2;

/**
 * Whether an avatar can get from `from` to `to` between two position
 * updates: at most MAX_STEP tiles, and every point along the way, sampled
 * every STEP_SAMPLE tiles, on floor that is no door shut right now. The tile
 * the step starts on never stops it — a door may have shut on whoever
 * stands in it.
 */
export function stepAllowed(map: MapDef, state: GameState, from: Spot, to: Spot): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length > MAX_STEP) {
    return false;
  }
  const shut = shutDoors(map, state);
  const start = tileKey(Math.floor(from.x), Math.floor(from.y));
  const samples = Math.ceil(length / STEP_SAMPLE);
  for (let i = 1; i <= samples; i++) {
    const x = Math.floor(from.x + (dx * i) / samples);
    const y = Math.floor(from.y + (dy * i) / samples);
    const tile = tileKey(x, y);
    if (tile !== start && (map.tiles[y]?.charAt(x) !== '.' || shut.has(tile))) {
      return false;
    }
  }
  return true;
}

/**
 * Whether the run is on with its lights out: the clock runs, and security —
 * the armed station, the patrols, the emergencies — is on duty.
 */
export function lightsAreOut(state: GameState): boolean {
  return state.phase === 'playing' && state.lightsOutAt !== null;
}

/**
 * The spots of the current puzzle's station while the mission is running
 * with its lights out — one, or one per console — with the console each is
 * (null where the station has one); empty otherwise.
 */
export function armedStations(
  map: MapDef,
  state: GameState,
): { x: number; y: number; console: ConsoleId | null }[] {
  const current = state.mission.puzzles[state.currentPuzzleIndex];
  if (!lightsAreOut(state) || current === undefined) {
    return [];
  }
  return map.stations
    .filter((s) => s.puzzleId === current.id)
    .map((s) => ({ x: s.x, y: s.y, console: s.console ?? null }));
}

/**
 * The drones on patrol once the lights are out: those whose
 * `activeAfterSolved` puzzles the crew has solved. The rest sleep at their
 * first waypoint — neither moving, nor seeing, nor showing up.
 */
export function patrollingDrones(map: MapDef, state: GameState): MapDef['drones'] {
  if (!lightsAreOut(state)) {
    return [];
  }
  return map.drones.filter((drone) => drone.activeAfterSolved <= state.currentPuzzleIndex);
}

/**
 * Whether the next emergency may be scheduled: the lights are out, the crew
 * has solved the sabotage's `afterSolved` puzzles — before that it may still
 * be locked in its starting rooms — and is not yet running for the hatch.
 */
export function emergenciesDue(state: GameState): boolean {
  const sabotage = state.mission.map.sabotage;
  const solved = state.currentPuzzleIndex;
  return (
    lightsAreOut(state) &&
    sabotage !== undefined &&
    solved >= sabotage.afterSolved &&
    solved < state.mission.puzzles.length
  );
}

/** Players at the station of `puzzleId`, at either console: while it is open, they work it. */
export function operatorsOf(state: GameState, puzzleId: string): string[] {
  const atA = state.presence.stations[stationKey({ puzzleId })] ?? [];
  const atB = state.presence.stations[stationKey({ puzzleId, console: 'b' })] ?? [];
  return [...new Set([...atA, ...atB])];
}

/**
 * The console `playerId` stands at by the station of `puzzleId`: 'a' at a
 * station with one console, 'a' or 'b' at one with two; null away from it.
 * Somebody in reach of both consoles at once counts as at console a.
 */
export function consoleOf(state: GameState, puzzleId: string, playerId: string): ConsoleId | null {
  const at = (spot: StationSpot): boolean =>
    state.presence.stations[stationKey(spot)]?.includes(playerId) === true;
  if (at({ puzzleId })) {
    return 'a';
  }
  return at({ puzzleId, console: 'b' }) ? 'b' : null;
}

/** Whether a manual object can be read: always, unless it is a locker or cabinet not yet opened. */
export function sourceOpen(state: GameState, manual: Pick<ManualDef, 'id' | 'kind'>): boolean {
  return !startsClosed(manual.kind) || state.opened.includes(manual.id);
}

/** Players standing at an open manual object that covers `puzzleId`: they read its rules. */
export function readersOf(state: GameState, puzzleId: string): string[] {
  const readers = state.mission.map.manuals
    .filter((manual) => manual.puzzleIds.includes(puzzleId) && sourceOpen(state, manual))
    .flatMap((manual) => state.presence.manuals[manual.id] ?? []);
  return [...new Set(readers)];
}

/** A crew member backing up a player at a station, and where they stand. */
export interface Backup {
  playerId: string;
  /** the other console as the lab names it („Pult B"), or the manual object's label */
  where: string;
}

/**
 * Who backs up `playerId` at the station of `puzzleId`: every other crew
 * member at the station's other console, where it has two, then at every
 * open manual object covering it, in map order. Empty while `playerId`
 * stands at neither console. Nobody works a station alone — the reducer
 * takes an input only with somebody here.
 */
export function backupsOf(state: GameState, puzzleId: string, playerId: string): Backup[] {
  const at = consoleOf(state, puzzleId, playerId);
  if (at === null) {
    return [];
  }
  const other: ConsoleId = at === 'a' ? 'b' : 'a';
  const twoConsoles = state.mission.map.stations.some(
    (s) => s.puzzleId === puzzleId && s.console !== undefined,
  );
  const atOther = twoConsoles
    ? (state.presence.stations[stationKey({ puzzleId, console: other })] ?? []).map(
        (id): Backup => ({ playerId: id, where: `Pult ${other.toUpperCase()}` }),
      )
    : [];
  const reading = state.mission.map.manuals
    .filter((manual) => manual.puzzleIds.includes(puzzleId) && sourceOpen(state, manual))
    .flatMap((manual) =>
      (state.presence.manuals[manual.id] ?? []).map(
        (id): Backup => ({ playerId: id, where: manual.label }),
      ),
    );
  return [...atOther, ...reading].filter((backup) => backup.playerId !== playerId);
}

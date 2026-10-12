import { startsClosed, type ManualDef, type MapDef } from './mission.js';
import type { ConsoleId } from './puzzles/module.js';
import type { GameState } from './state.js';

/** Pure helpers for the tile map: doors, the currently armed station, who stands where. */

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

export function doorOpen(map: MapDef, state: GameState, doorId: string): boolean {
  const door = map.doors.find((d) => d.id === doorId);
  if (door === undefined) {
    return false;
  }
  if (door.opensBy.kind === 'plate') {
    return platePressed(state, door.opensBy.plateId);
  }
  const puzzleId = door.opensBy.puzzleId;
  const index = state.mission.puzzles.findIndex((p) => p.id === puzzleId);
  return index >= 0 && (state.phase === 'won' || index < state.currentPuzzleIndex);
}

/**
 * The spots of the current puzzle's station while the mission is running —
 * one, or one per console — with the console each is (null where the
 * station has one); empty otherwise.
 */
export function armedStations(
  map: MapDef,
  state: GameState,
): { x: number; y: number; console: ConsoleId | null }[] {
  const current = state.mission.puzzles[state.currentPuzzleIndex];
  if (state.phase !== 'playing' || current === undefined) {
    return [];
  }
  return map.stations
    .filter((s) => s.puzzleId === current.id)
    .map((s) => ({ x: s.x, y: s.y, console: s.console ?? null }));
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

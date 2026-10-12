import type { MapDef } from './mission.js';
import type { GameState } from './state.js';

/** Pure helpers for the tile map: doors, the currently armed station, who stands where. */

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

/** The station of the current puzzle, while the mission is running. */
export function armedStation(map: MapDef, state: GameState): { x: number; y: number } | null {
  const current = state.mission.puzzles[state.currentPuzzleIndex];
  if (state.phase !== 'playing' || current === undefined) {
    return null;
  }
  const station = map.stations.find((s) => s.puzzleId === current.id);
  return station === undefined ? null : { x: station.x, y: station.y };
}

/** Players standing at the station of `puzzleId`: while it is open, they work it. */
export function operatorsOf(state: GameState, puzzleId: string): string[] {
  return state.presence.stations[puzzleId] ?? [];
}

/** Players standing at a manual object that covers `puzzleId`: they read its rules. */
export function readersOf(state: GameState, puzzleId: string): string[] {
  const readers = state.mission.map.manuals
    .filter((manual) => manual.puzzleIds.includes(puzzleId))
    .flatMap((manual) => state.presence.manuals[manual.id] ?? []);
  return [...new Set(readers)];
}

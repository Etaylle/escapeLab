import type { KnownStation, MapStation, MapView, PlayerView } from '@escapelab/core';

/**
 * Whether a thing on a map is known to the crew (core view.ts): then the view tells it whole —
 * a source's label and rules, a part's carrier and drop-off, whether a note was read. One
 * nobody has found shows only what it is and where, while in sight.
 */
export function known<T extends { known: boolean }>(
  thing: T,
): thing is Extract<T, { known: true }> {
  return thing.known;
}

/**
 * Whether a station's spot is an armed one: the objective, which every view tells whole — the
 * station up, or any still to solve while a free-order run waits for the crew's pick.
 */
export function isArmed(station: MapStation): station is KnownStation {
  return station.known && station.status === 'armed';
}

/**
 * The goal while no station is open, as the goal line and the Einsatzinfo name it: the armed
 * station — or, where several stand armed at once, for the crew to pick from in free order, how
 * many are left to solve; null while none is armed.
 */
export function armedGoal(
  view: Pick<PlayerView, 'puzzleCount' | 'currentPuzzleIndex'>,
  map: Pick<MapView, 'stations'>,
): string | null {
  const armed = map.stations.filter(isArmed);
  if (new Set(armed.map((station) => station.puzzleId)).size > 1) {
    return `Noch ${view.puzzleCount - view.currentPuzzleIndex} Stationen`;
  }
  return armed[0]?.title ?? null;
}

/**
 * A station spot's status as the view tells it. One merely seen tells none: it stands there
 * as a locked one does.
 */
export function statusOf(station: MapStation): KnownStation['status'] {
  return station.known ? station.status : 'locked';
}

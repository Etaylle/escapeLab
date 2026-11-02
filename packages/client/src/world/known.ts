import type { KnownStation, MapStation } from '@escapelab/core';

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

/** Whether a station's spot is the armed one: the objective, which every view tells whole. */
export function isArmed(station: MapStation): station is KnownStation {
  return station.known && station.status === 'armed';
}

/**
 * A station spot's status as the view tells it. One merely seen tells none: it stands there
 * as a locked one does.
 */
export function statusOf(station: MapStation): KnownStation['status'] {
  return station.known ? station.status : 'locked';
}

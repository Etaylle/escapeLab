import type { MapView, PlayerPosition, PlayerPresence } from '@escapelab/core';
import { isArmed } from './known.js';

/**
 * Where a crew member stands, guessed from their live position the way the server decides it
 * (core view.ts presence): for the crew members whose presence this screen is not told — the
 * crew strip names it (screens/Crew.tsx), the figures stand to it (assemble.ts).
 */

/** Where someone stands: at a station, at which console where that is told, at an open source. */
export type Whereabouts = Pick<PlayerPresence, 'stationId' | 'manualId'> &
  Partial<Pick<PlayerPresence, 'console'>>;

/** How far from a station or a source someone stands at it, tiles, as the server counts it. */
export const PRESENCE_RADIUS = 1.6;

/** Whether `pos` lies within `radius` tiles of the middle of the tile `spot`. */
export function near(
  pos: Pick<PlayerPosition, 'x' | 'y'>,
  spot: { x: number; y: number },
  radius: number,
): boolean {
  return Math.hypot(pos.x - (spot.x + 0.5), pos.y - (spot.y + 0.5)) <= radius;
}

/** Where someone at `pos` stands: at the armed station, or at an open source, by their place. */
export function presenceNear(
  map: MapView | null,
  pos: Pick<PlayerPosition, 'x' | 'y'> | undefined,
): Whereabouts {
  if (map === null || pos === undefined) {
    return { stationId: null, manualId: null };
  }
  const station = map.stations.find((s) => isArmed(s) && near(pos, s, PRESENCE_RADIUS));
  const source = map.manuals.find((m) => m.known && m.opened && near(pos, m, PRESENCE_RADIUS));
  return { stationId: station?.puzzleId ?? null, manualId: source?.id ?? null };
}

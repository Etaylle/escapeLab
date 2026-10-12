import type { ManualHere, MapView } from '@escapelab/core';

/** Prompt and client-side gate for stations and manual objects; the server counts 1.6. */
export const INTERACT_RADIUS = 1.5;
/** Pick-up and drop-off reach; the server allows 0.95. */
export const ITEM_RADIUS = 0.9;

/** What pressing E does where the player stands, its prompt and where the prompt goes. */
export type ContextAction =
  | { kind: 'deliver' | 'pick' | 'operate'; label: string; x: number; y: number }
  | { kind: 'read'; manualId: string; label: string; x: number; y: number };

/**
 * What pressing E would do where the player stands. Items come first, in the
 * order the server applies; then whichever is nearer, the armed station or a
 * manual object the server already counts this player at — so the prompt
 * never promises something it cannot do. Full hands rule out the station,
 * but not reading.
 */
export function contextAction(
  map: MapView,
  self: { x: number; y: number },
  youId: string,
  manualsHere: readonly Pick<ManualHere, 'id'>[],
): ContextAction | null {
  const dist = (x: number, y: number): number => Math.hypot(self.x - x, self.y - y);

  const mine = map.items.find((item) => item.carriedBy === youId && !item.delivered);
  if (mine !== undefined && dist(mine.deliverTo.x + 0.5, mine.deliverTo.y + 0.5) <= ITEM_RADIUS) {
    return {
      kind: 'deliver',
      label: `[E] ${mine.label} einsetzen`,
      x: mine.deliverTo.x + 0.5,
      y: mine.deliverTo.y - 0.45,
    };
  }

  const loose = map.items.find(
    (item) => !item.delivered && item.carriedBy === null && dist(item.x, item.y) <= ITEM_RADIUS,
  );
  if (mine === undefined && loose !== undefined) {
    return { kind: 'pick', label: `[E] ${loose.label} aufnehmen`, x: loose.x, y: loose.y - 0.95 };
  }

  const station = mine === undefined ? map.stations.find((s) => s.status === 'armed') : undefined;
  const candidates: { action: ContextAction; d: number }[] = map.manuals
    .filter((manual) => manualsHere.some((here) => here.id === manual.id))
    .map((manual) => ({
      action: {
        kind: 'read',
        manualId: manual.id,
        label: '[E] Lesen',
        x: manual.x + 0.5,
        y: manual.y - 0.55,
      },
      d: dist(manual.x + 0.5, manual.y + 0.5),
    }));
  if (station !== undefined) {
    candidates.push({
      action: { kind: 'operate', label: '[E] Bedienen', x: station.x + 0.5, y: station.y - 0.55 },
      d: dist(station.x + 0.5, station.y + 0.5),
    });
  }
  const nearest = candidates
    .filter((candidate) => candidate.d <= INTERACT_RADIUS)
    .sort((a, b) => a.d - b.d)[0];
  return nearest?.action ?? null;
}

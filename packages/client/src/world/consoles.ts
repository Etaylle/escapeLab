import type { ConsoleId, MapView } from '@escapelab/core';

/** A console of a two-console station as the lab names it: „Pult A", „Pult B". */
export function consoleName(id: ConsoleId): string {
  return `Pult ${id.toUpperCase()}`;
}

/**
 * The title the world prints over an armed station's spot. A station with two
 * consoles has two spots, and each names its console: „Signalprobe · Pult A".
 */
export function spotTitle(spot: MapView['stations'][number]): string {
  return spot.console === undefined ? spot.title : `${spot.title} · ${consoleName(spot.console)}`;
}

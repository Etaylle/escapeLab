import type { KnownPart, KnownSource, MapView } from '@escapelab/core';
import { known } from './known.js';

/**
 * What changed in the lab between two views of it. What a player finds is not the lab's news:
 * it chimes for them alone (finds.ts).
 */
export interface WorldNews {
  /** lockers just searched and cabinets just unlocked */
  opened: KnownSource[];
  /** labels of the rooms whose lights just came on */
  lit: string[];
  /**
   * parts just put where they belong — a fuse in its holder; a key gone into the lock of a
   * cabinet that just opened is the cabinet's news
   */
  delivered: KnownPart[];
  /** parts just put down off somebody's hands (Q), where they now lie */
  dropped: KnownPart[];
}

/**
 * What `now` shows that `before` did not. The first look (`before` null)
 * has no news: whatever the lab showed when this client came in was there
 * already.
 */
export function worldNews(before: MapView | null, now: MapView): WorldNews {
  if (before === null) {
    return { opened: [], lit: [], delivered: [], dropped: [] };
  }
  const was = new Map(before.manuals.filter(known).map((manual) => [manual.id, manual]));
  const opened = now.manuals
    .filter(known)
    .filter((manual) => manual.opened && was.get(manual.id)?.opened === false);
  const unlocked = new Set(opened.map((manual) => `${manual.x},${manual.y}`));
  const parts = before.items.filter(known);
  const placed = new Set(parts.filter((item) => item.delivered).map((item) => item.id));
  const held = new Set(parts.filter((item) => item.carriedBy !== null).map((item) => item.id));
  const after = now.items.filter(known);
  return {
    opened,
    lit: now.litRooms.filter((room) => !before.litRooms.includes(room)),
    delivered: after.filter(
      (item) =>
        item.delivered &&
        !placed.has(item.id) &&
        !unlocked.has(`${Math.floor(item.x)},${Math.floor(item.y)}`),
    ),
    dropped: after.filter(
      (item) => held.has(item.id) && item.carriedBy === null && !item.delivered,
    ),
  };
}

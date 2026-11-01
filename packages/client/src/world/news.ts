import type { MapView } from '@escapelab/core';

type Manual = MapView['manuals'][number];
type Item = MapView['items'][number];

/**
 * What changed in the lab between two views of it. What a player finds is not the lab's news:
 * it chimes for them alone (finds.ts).
 */
export interface WorldNews {
  /** lockers just searched and cabinets just unlocked */
  opened: Manual[];
  /** labels of the rooms whose lights just came on */
  lit: string[];
  /**
   * parts just put where they belong — a fuse in its holder; a key gone into the lock of a
   * cabinet that just opened is the cabinet's news
   */
  delivered: Item[];
  /** parts just put down off somebody's hands (Q), where they now lie */
  dropped: Item[];
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
  const was = new Map(before.manuals.map((manual) => [manual.id, manual]));
  const opened = now.manuals.filter(
    (manual) => manual.opened && was.get(manual.id)?.opened === false,
  );
  const unlocked = new Set(opened.map((manual) => `${manual.x},${manual.y}`));
  const placed = new Set(before.items.filter((item) => item.delivered).map((item) => item.id));
  const held = new Set(before.items.filter((item) => item.carriedBy !== null).map((i) => i.id));
  return {
    opened,
    lit: now.litRooms.filter((room) => !before.litRooms.includes(room)),
    delivered: now.items.filter(
      (item) =>
        item.delivered &&
        !placed.has(item.id) &&
        !unlocked.has(`${Math.floor(item.x)},${Math.floor(item.y)}`),
    ),
    dropped: now.items.filter(
      (item) => held.has(item.id) && item.carriedBy === null && !item.delivered,
    ),
  };
}

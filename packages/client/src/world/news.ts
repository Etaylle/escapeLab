import type { MapView } from '@escapelab/core';

type Manual = MapView['manuals'][number];
type Note = MapView['notes'][number];
type Item = MapView['items'][number];

/** What changed in the lab between two views of it. */
export interface WorldNews {
  /** manual objects the crew has just come across */
  found: Manual[];
  /** notes of the last shift the crew has just come across */
  notes: Note[];
  /** lockers just searched and cabinets just unlocked */
  opened: Manual[];
  /** labels of the rooms whose lights just came on */
  lit: string[];
  /**
   * parts just put where they belong — a fuse in its holder; a key gone into the lock of a
   * cabinet that just opened is the cabinet's news
   */
  delivered: Item[];
}

/**
 * What `now` shows that `before` did not. The first look (`before` null)
 * has no news: whatever the lab showed when this client came in was there
 * already.
 */
export function worldNews(before: MapView | null, now: MapView): WorldNews {
  if (before === null) {
    return { found: [], notes: [], opened: [], lit: [], delivered: [] };
  }
  const was = new Map(before.manuals.map((manual) => [manual.id, manual]));
  const known = new Set(before.notes.map((note) => note.index));
  const opened = now.manuals.filter(
    (manual) => manual.opened && was.get(manual.id)?.opened === false,
  );
  const unlocked = new Set(opened.map((manual) => `${manual.x},${manual.y}`));
  const placed = new Set(before.items.filter((item) => item.delivered).map((item) => item.id));
  return {
    found: now.manuals.filter((manual) => !was.has(manual.id)),
    notes: now.notes.filter((note) => !known.has(note.index)),
    opened,
    lit: now.litRooms.filter((room) => !before.litRooms.includes(room)),
    delivered: now.items.filter(
      (item) =>
        item.delivered &&
        !placed.has(item.id) &&
        !unlocked.has(`${Math.floor(item.x)},${Math.floor(item.y)}`),
    ),
  };
}

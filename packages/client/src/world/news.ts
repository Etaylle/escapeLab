import type { MapView } from '@escapelab/core';

type Manual = MapView['manuals'][number];
type Note = MapView['notes'][number];

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
}

/**
 * What `now` shows that `before` did not. The first look (`before` null)
 * has no news: whatever the lab showed when this client came in was there
 * already.
 */
export function worldNews(before: MapView | null, now: MapView): WorldNews {
  if (before === null) {
    return { found: [], notes: [], opened: [], lit: [] };
  }
  const was = new Map(before.manuals.map((manual) => [manual.id, manual]));
  const known = new Set(before.notes.map((note) => note.index));
  return {
    found: now.manuals.filter((manual) => !was.has(manual.id)),
    notes: now.notes.filter((note) => !known.has(note.index)),
    opened: now.manuals.filter((manual) => manual.opened && was.get(manual.id)?.opened === false),
    lit: now.litRooms.filter((room) => !before.litRooms.includes(room)),
  };
}

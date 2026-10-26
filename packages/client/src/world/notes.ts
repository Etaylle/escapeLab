import { noteSpot, type MapView } from '@escapelab/core';

/**
 * Where a note of the last shift shows in the world. On the floor it lies in
 * its tile's middle; pinned to a wall it hangs on the face that looks into
 * the floor it is read from (core's `noteSpot`: south first, the face the
 * view looks at) — the sheet on the wall above the point, the point at the
 * wall's foot. Pure.
 */

type Note = MapView['notes'][number];

export interface NoteMount {
  /** in tiles: the middle of the sheet on the floor, or the foot of its wall's face */
  x: number;
  y: number;
  /** on a wall, the way its face looks in radians (0 east, π/2 south); null on the floor */
  facing: number | null;
  /** the floor tile it is read from */
  spot: { x: number; y: number };
}

/**
 * How far a note's sheet lies from its mount, in tiles: up its wall's face, toward the wall,
 * pinned there; up its tile, on the floor (art.ts draws it so).
 */
export const SHEET_ON_WALL = 0.56;
export const SHEET_ON_FLOOR = 0.16;

/** Where `note` shows; null where it lies neither on the floor nor on a wall beside it. */
export function noteMount(
  map: Pick<MapView, 'tiles'>,
  note: Pick<Note, 'x' | 'y'>,
): NoteMount | null {
  const spot = noteSpot(map, note);
  if (spot === null) {
    return null;
  }
  const dx = spot.x - note.x;
  const dy = spot.y - note.y;
  if (dx === 0 && dy === 0) {
    return { x: note.x + 0.5, y: note.y + 0.5, facing: null, spot };
  }
  return {
    x: note.x + 0.5 + dx * 0.5,
    y: note.y + 0.5 + dy * 0.5,
    facing: Math.atan2(dy, dx),
    spot,
  };
}

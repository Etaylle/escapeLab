import type { Spot } from './reach.js';

/**
 * The notes of the last shift on a map: sheets pinned to a wall's face or
 * lying on the floor, free to read — lore, never a rule. Where a note is read
 * from is its spot: the floor tile it lies on, or, pinned to a wall, the
 * floor tile its face looks into — south first, the face the view looks at,
 * then north, east and west. The server counts who stands at that spot and
 * finds the note for the crew by it, as it does a manual object.
 */

/** How many notes a map may carry. */
export const MAX_NOTES = 8;
/** How many characters a note may hold. */
export const NOTE_TEXT_MAX = 160;

/** The faces of a wall a note may hang on, by the floor beside each, in the order one is taken. */
const FACES = [
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
] as const;

/**
 * Where the note at `at` is read from: its own tile on the floor, the floor
 * beside it on a wall; null where it lies on neither — off the map, in the
 * void, or in a wall with no floor beside it.
 */
export function noteSpot(map: { readonly tiles: readonly string[] }, at: Spot): Spot | null {
  const floor = (x: number, y: number): boolean => map.tiles[y]?.charAt(x) === '.';
  if (floor(at.x, at.y)) {
    return { x: at.x, y: at.y };
  }
  if (map.tiles[at.y]?.charAt(at.x) !== '#') {
    return null;
  }
  const face = FACES.find(({ dx, dy }) => floor(at.x + dx, at.y + dy));
  return face === undefined ? null : { x: at.x + face.dx, y: at.y + face.dy };
}

/** What presence keys a note by: its index among the map's notes, as text. */
export const noteKey = (index: number): string => String(index);

/**
 * The menu's places (docs/art-bible.md „The menu's places"): a room of the lab for each item of
 * the menu, which the scene's camera travels to as the item is hovered or in the player's focus
 * and holds while the item's panel lies open (camera.ts); with nothing attended the scene drifts
 * along the opening's shot, as it always did. Pure but for the one place the page holds: the
 * rooms by mission and item, where on the canvas a place shows, and who listens for the place.
 * Tiles, unless said otherwise.
 */

/** A tile of the lab, its middle where a coordinate ends in .5. */
export interface Spot {
  x: number;
  y: number;
}

/**
 * Blackout's lab (missions/blackout.json), a room for each item: „Einsatz starten" the Reaktor's
 * core, „Beitreten" the Flur at the Serverschott, „Offene Runden" the Ost-Flur's console hall —
 * the lab's Leitstand —, „Handbuch" the Archiv's shelves with the book, „Bestenliste" the
 * Süd-Flur's notice board, „Meine Einsätze" the Serverraum's lockers, „Editor" the Labor's
 * benches — its workshop —, „Einstellungen" the Maschinenraum's panel.
 */
const BLACKOUT: Readonly<Record<string, Spot>> = {
  missions: { x: 30.5, y: 16 },
  join: { x: 19.5, y: 10 },
  rounds: { x: 28.5, y: 7 },
  handbook: { x: 5.5, y: 3.5 },
  history: { x: 22.5, y: 17 },
  myruns: { x: 16.5, y: 4.5 },
  editor: { x: 14.5, y: 18.5 },
  settings: { x: 3, y: 16 },
};

/** The places of each lab that has them, by mission; a lab without drifts for every item. */
const PLACES: Readonly<Record<string, Readonly<Record<string, Spot>>>> = { blackout: BLACKOUT };

/** The places of mission `missionId`'s lab, by menu item; none for a lab without any. */
export function placesOf(missionId: string): Readonly<Record<string, Spot>> {
  return PLACES[missionId] ?? {};
}

/**
 * Where a place shows on the scene's canvas, a share of its width and height: between the menu's
 * column and the hero, where the hero's lamp reaches.
 */
export const SCENE_ANCHOR = { x: 0.5, y: 0.55 } as const;

/**
 * The corner of the frame that shows `spot` at SCENE_ANCHOR on a canvas `w` × `h` device px, at
 * `scale` device px a tile: whole pixels of the lab at that scale, its top left at 0, 0.
 */
export function placeCorner(spot: Spot, scale: number, w: number, h: number): Spot {
  return {
    x: Math.round(spot.x * scale - SCENE_ANCHOR.x * w),
    y: Math.round(spot.y * scale - SCENE_ANCHOR.y * h),
  };
}

/** The item whose place the menu shows now; null for the drift. */
let held: string | null = null;
const listeners = new Set<() => void>();

/** The item whose place the menu shows now (`holdPlace`); null for the drift. */
export function heldPlace(): string | null {
  return held;
}

/** The menu shows the place of `item` now — null: none, the drift —, every listener told. */
export function holdPlace(item: string | null): void {
  if (held === item) {
    return;
  }
  held = item;
  for (const listener of [...listeners]) {
    listener();
  }
}

/** The item whose place the scene's camera stands at or travels to now (`showPlace`). */
let shown: string | null = null;

/**
 * The item whose place the scene's camera stands at or travels to now (stage.ts): the place held,
 * once the pieces of the bake it shows are baked; null for the drift — and in a lab without
 * places, which drifts for every item.
 */
export function placeShown(): string | null {
  return shown;
}

/** The scene's camera stands at or travels to the place of `item` now; null: the drift. */
export function showPlace(item: string | null): void {
  shown = item;
}

/** Tells `changed` whenever the place held changes; returns what stops it. */
export function watchPlace(changed: () => void): () => void {
  listeners.add(changed);
  return () => {
    listeners.delete(changed);
  };
}

/**
 * The canvas as the world draws on it, and what lies over it: the objective
 * bar along the top edge, the minimap, and the controls in the bottom corners
 * — on a touch screen the steering pad under the left thumb and the buttons
 * under the right one. The camera keeps the avatar clear of them, and the
 * screen's own text — edge arrows, room names — keeps off them. The camera's
 * frame is set in CSS pixels (`tileCss`); everything else is in device
 * pixels. Pure.
 */

/** A box on the canvas. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The canvas, and what lies over it; all in device pixels but `dpr` and `textScale`. */
export interface Viewport {
  w: number;
  h: number;
  /** device pixels per CSS pixel */
  dpr: number;
  /**
   * how large the screen's own text stands against its normal size: the reader's text size
   * (settings.ts TEXT_SCALE) — room names, the E prompt, captions, chat, the arrows' captions
   */
  textScale: number;
  /** how far the objective bar reaches down from the top edge */
  top: number;
  /** what else lies over the canvas: the minimap, the controls in the bottom corners */
  boxes: readonly Box[];
}

/** How far `boxes` reach up from the bottom edge of a canvas `height` high: 0 for none. */
export function reachOf(boxes: readonly Box[], height: number): number {
  return Math.max(0, ...boxes.map((box) => height - box.top));
}

/** Whether two boxes share any area; boxes that only touch do not. */
export function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * How far down `box` has to move to lie clear of `avoid`, `gap` between them: negative to go
 * up over it — the way a tag goes, above what it would cover — or, where that would take it
 * above `ceiling`, down below it. 0 where the two do not meet.
 */
export function shiftClear(box: Box, avoid: Box, gap: number, ceiling: number): number {
  if (!overlaps(box, avoid)) {
    return 0;
  }
  const up = avoid.top - gap - box.bottom;
  return box.top + up >= ceiling ? up : avoid.bottom + gap - box.top;
}

/** What the camera works with for one frame, in device pixels. */
export interface Lens {
  /** device pixels per tile */
  scale: number;
  w: number;
  h: number;
  /** how far the overlays reach down from the top edge */
  top: number;
  /** how far the avatar is lifted on a touch screen, whose pad would sit on it */
  lift: number;
}

/** How many tiles of height the camera frames on a canvas TALL_CSS or taller: a laptop's view. */
export const TILES_HIGH = 11.5;
/** How many below that: a phone held sideways shows fewer, so that its figure stays readable. */
export const TILES_HIGH_SHORT = 9;
/** From how tall a canvas, CSS pixels, the camera frames TILES_HIGH tiles of height. */
export const TALL_CSS = 600;
/**
 * How small and how large a tile stands on screen, CSS pixels: the figure, 0.85 of a tile,
 * never under 24 px, and the lab no wall of giant tiles on a tall monitor.
 */
export const TILE_CSS = { min: 28, max: 96 } as const;

/**
 * How tall a tile stands on a canvas `height` CSS pixels tall: its height over the tiles the
 * camera frames there (TILES_HIGH, TILES_HIGH_SHORT), held within TILE_CSS. The frame is fixed
 * in CSS pixels, so every screen shows the same world whatever its density; the canvas draws
 * it at its own (render/backing.ts), device pixels a tile being this times that.
 */
export function tileCss(height: number): number {
  const tilesHigh = height >= TALL_CSS ? TILES_HIGH : TILES_HIGH_SHORT;
  return Math.min(TILE_CSS.max, Math.max(TILE_CSS.min, height / tilesHigh));
}

/** `target` held between `lo` and `hi`; their middle where there is no room between them. */
function within(target: number, lo: number, hi: number): number {
  return lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, target));
}

/** How far above the spot it stands on the avatar and its name tag reach, in tiles. */
const HEADROOM = 1;
/** How far below that spot its feet reach, in tiles. */
const FOOTROOM = 0.5;

/**
 * How far the avatar is lifted on a touch screen, device pixels: so far that
 * its feet stand clear above the controls — they reach `reach` up from the
 * bottom of a canvas `h` high under an objective bar `top` deep, at `scale`
 * device pixels a tile — and no further; nothing where they reach no higher
 * than the middle of the band below the bar leaves free.
 */
export function liftAbove(reach: number, h: number, top: number, scale: number): number {
  return Math.max(0, reach + FOOTROOM * scale + top / 2 - h / 2);
}

/**
 * Where the camera looks — the world point drawn at the canvas's middle, in
 * tiles — as it follows `focus`, the avatar. That goes in the middle of the
 * band the top overlays leave free, lifted by `lift`, but never so high that
 * its head is under them. The lab stays in frame: its top edge comes down at
 * most to where the overlays end, so the avatar never walks in under them up
 * at the top wall either, and its bottom edge rises at most `lift` off the
 * canvas's; the strips of void beyond lie under the overlays and the pad. A
 * lab smaller than that is centred in it.
 */
export function clampCamera(
  map: { width: number; height: number },
  focus: { x: number; y: number },
  lens: Lens,
): { x: number; y: number } {
  const halfW = lens.w / 2 / lens.scale;
  const halfH = lens.h / 2 / lens.scale;
  const top = lens.top / lens.scale;
  const lift = lens.lift / lens.scale;
  // the avatar's place on screen, in tiles down from the top edge
  const spot = Math.max(halfH - lift + top / 2, top + HEADROOM);
  return {
    x: within(focus.x, halfW, map.width - halfW),
    y: within(focus.y - spot + halfH, halfH - top, map.height - halfH + lift),
  };
}

/**
 * The size room names are drawn at at the normal text size, CSS pixels: above any prop's label
 * (art.ts: 12 at most); the reader's text size scales it (`Viewport.textScale`).
 */
export const ROOM_NAME_PX = 13;
/** How far a room name's letters rise above and drop below its baseline, against its size. */
const NAME_RISE = 0.8;
const NAME_DROP = 0.3;
/** The plate under a room name reaches this far past its letters, sideways and up and down. */
const PLATE_SIDE = 0.5;
const PLATE_END = 0.25;
/** Air a room name's plate keeps from the canvas's sides and from anything else, CSS pixels. */
const NAME_AIR = 6;

/** A room's name on the canvas: its anchor, the baseline's middle, and how wide its text runs. */
export interface RoomName {
  text: string;
  x: number;
  y: number;
  width: number;
}

/** How large room names are drawn on `view`, device pixels: their size at its text size. */
export function roomNamePx(view: Pick<Viewport, 'dpr' | 'textScale'>): number {
  return ROOM_NAME_PX * view.textScale * view.dpr;
}

/**
 * The dark plate a room name stands on, device pixels, its letters `size` high: signage that
 * reads on lit floor as in the dark (overlays.ts draws it).
 */
export function namePlate(name: RoomName, size: number): Box {
  const side = name.width / 2 + PLATE_SIDE * size;
  return {
    left: name.x - side,
    top: name.y - (NAME_RISE + PLATE_END) * size,
    right: name.x + side,
    bottom: name.y + (NAME_DROP + PLATE_END) * size,
  };
}

/** `box` grown by `by` all round. */
function grown(box: Box, by: number): Box {
  return { left: box.left - by, top: box.top - by, right: box.right + by, bottom: box.bottom + by };
}

/**
 * The room names worth drawing, and where. A name whose anchor lies off the
 * canvas is left out — the edge arrows point that way — and one near a side
 * is nudged in to be read whole. A name is dropped where its plate would lie
 * under the objective bar or past the bottom edge, over a box such as the
 * minimap or the controls, or over a name placed before it.
 */
export function placeRoomNames(names: readonly RoomName[], view: Viewport): RoomName[] {
  const { w, h, dpr } = view;
  const air = NAME_AIR * dpr;
  const size = roomNamePx(view);
  const taken: Box[] = [...view.boxes];
  const placed: RoomName[] = [];
  for (const name of names) {
    if (name.x < 0 || name.x > w || name.y < 0 || name.y > h) {
      continue;
    }
    const half = name.width / 2 + PLATE_SIDE * size + air;
    const x = Math.min(w - half, Math.max(half, name.x));
    const box = grown(namePlate({ ...name, x }, size), air);
    const covered = box.top < view.top || box.bottom > h;
    if (covered || taken.some((other) => overlaps(box, other))) {
      continue;
    }
    taken.push(box);
    placed.push({ ...name, x });
  }
  return placed;
}

/**
 * The canvas as the world draws on it, and what lies over it: the objective
 * bar along the top edge, the control cluster along the bottom one, the
 * minimap. The camera keeps the avatar clear of them, and the screen's own
 * text — edge arrows, room names — keeps off them. Pure; device pixels.
 */

/** A box on the canvas. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The canvas, and what lies over it; all in device pixels but `dpr`. */
export interface Viewport {
  w: number;
  h: number;
  /** device pixels per CSS pixel */
  dpr: number;
  /** how far the objective bar reaches down from the top edge */
  top: number;
  /** how far the control cluster reaches up from the bottom edge */
  bottom: number;
  /** what else lies over the canvas: the minimap */
  boxes: readonly Box[];
}

/** Whether two boxes share any area; boxes that only touch do not. */
export function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
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

/** `target` held between `lo` and `hi`; their middle where there is no room between them. */
function within(target: number, lo: number, hi: number): number {
  return lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, target));
}

/** How far above the spot it stands on the avatar and its name tag reach, in tiles. */
const HEADROOM = 1;

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

/** The size room names are drawn at, CSS pixels: above any prop's label (art.ts: 12 at most). */
export const ROOM_NAME_PX = 13;
/** How far a room name's letters rise above and drop below its baseline, against its size. */
const NAME_RISE = 0.8;
const NAME_DROP = 0.3;
/** Air a room name keeps from the canvas's sides and from anything else, CSS pixels. */
const NAME_AIR = 6;

/** A room's name on the canvas: its anchor, the baseline's middle, and how wide its text runs. */
export interface RoomName {
  text: string;
  x: number;
  y: number;
  width: number;
}

/**
 * The room names worth drawing, and where. A name whose anchor lies off the
 * canvas is left out — the edge arrows point that way — and one near a side
 * is nudged in to be read whole. A name is dropped where it would lie under
 * the overlays at the top or the bottom edge, over a box such as the minimap,
 * or over a name placed before it.
 */
export function placeRoomNames(names: readonly RoomName[], view: Viewport): RoomName[] {
  const { w, h, dpr } = view;
  const air = NAME_AIR * dpr;
  const rise = ROOM_NAME_PX * NAME_RISE * dpr + air;
  const drop = ROOM_NAME_PX * NAME_DROP * dpr + air;
  const taken: Box[] = [...view.boxes];
  const placed: RoomName[] = [];
  for (const name of names) {
    if (name.x < 0 || name.x > w || name.y < 0 || name.y > h) {
      continue;
    }
    const half = name.width / 2 + air;
    const x = Math.min(w - half, Math.max(half, name.x));
    const box = { left: x - half, top: name.y - rise, right: x + half, bottom: name.y + drop };
    const covered = box.top < view.top || box.bottom > h - view.bottom;
    if (covered || taken.some((other) => overlaps(box, other))) {
      continue;
    }
    taken.push(box);
    placed.push({ ...name, x });
  }
  return placed;
}

import { bake, bakeGrid, drawBaked, type Baked, type TileBox } from '../baked.js';
import { inTiles, type Frame } from './frame.js';
import { keep, touch, type CacheLimits, type FrameCache } from './frameCache.js';
import { sameGrid } from './grid.js';

/**
 * The light's bakes (baked.ts), kept between frames by name — a lit room's
 * ceiling lights in a colour, an emergency lamp's light, the open hatch's —
 * each with what it was baked of: a bake is used again while it is of the
 * same (the same sight, the same rooms, the same text) and lies on the
 * frame's grid, and baked anew once it is not. While the grid moves — the
 * camera pulling back at the end, the window resized — a light is drawn
 * straight onto the picture instead, as baking it anew on every frame would
 * cost more. Bakes the last two frames did not use go past BAKE_LIMITS
 * (frameCache.ts).
 */

/** A bake and what it was baked of: compared by identity, or as text. */
interface Kept {
  of: unknown;
  baked: Baked | null;
}

export type BakeStore = FrameCache<Kept>;

/** How many bakes are kept, and the pixels they hold: 64 MB at four bytes a pixel. */
export const BAKE_LIMITS: CacheLimits = { most: 160, pixels: 16 * 1024 * 1024 };

const canvasOf = (kept: Kept): HTMLCanvasElement | null => kept.baked?.canvas ?? null;

/** Which bake a light is laid on from: its name, what it is baked of, and the box it covers. */
export interface BakeOf {
  name: string;
  of: unknown;
  box: TileBox | null;
}

/**
 * The bake `name` of `of` for `frame`: kept, or baked anew over `box` with
 * `draw` (tile space) on a canvas of the art's — into the canvas of the bake
 * it replaces where there was one. Null where there is no box.
 */
export function bakedFor(
  frame: Frame,
  { name, of, box }: BakeOf,
  draw: (g: CanvasRenderingContext2D) => void,
): Baked | null {
  const store = frame.kit.bakes;
  const kept = touch(store, name, frame);
  if (kept !== undefined && kept.of === of && fits(kept.baked, frame)) {
    return kept.baked;
  }
  const into = kept?.baked?.canvas ?? frame.kit.art.atlas.make(1, 1);
  const baked = box === null ? null : bake(box, frame.grid, draw, into);
  keep(store, [name, { of, baked }], frame, BAKE_LIMITS, canvasOf);
  return baked;
}

/** Whether a bake kept serves `frame`: none to serve, or baked on the grid it would be baked on. */
function fits(baked: Baked | null, frame: Frame): boolean {
  return baked === null || sameGrid(baked.grid, bakeGrid(baked.box, frame.grid));
}

/**
 * Lays the light `draw` draws in tile space over `ctx`, as `ctx`'s alpha
 * and compositing say: copied from its bake (`bakeOf`) while the grid holds
 * still, else drawn straight — `ctx`'s transform as it was after either way.
 */
export function layBake(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  bakeOf: BakeOf,
  draw: (g: CanvasRenderingContext2D) => void,
): void {
  if (!frame.steady) {
    ctx.save();
    inTiles(ctx, frame);
    draw(ctx);
    ctx.restore();
    return;
  }
  const baked = bakedFor(frame, bakeOf, draw);
  if (baked !== null) {
    drawBaked(ctx, baked, frame.grid);
  }
}

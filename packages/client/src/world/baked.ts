import { phaseOf, sameGrid, type PixelGrid } from './render/grid.js';

/**
 * Light that seldom changes, baked: drawn once into a canvas of its own on
 * the frame's pixel grid (render/grid.ts) — at the frame's scale, its pixels
 * where the picture's pixels lie — which every frame then copies onto the
 * picture pixel for pixel in one go: far cheaper than drawing it there, and
 * than a scaled copy, which the canvas has to filter. The lit rooms' ceiling
 * lights, the open hatch's light, the emergency lamps', the light through
 * open doors and the faint lights' glow are baked this way (render/bakes.ts):
 * again only as they change, or for another grid. A box too large to bake
 * (`bakeable`) is baked at fewer pixels a tile and drawn scaled, filtered.
 * Bakes added onto the picture together are added up into one first
 * (`addBaked`): one copy instead of several.
 */

type Spot = { x: number; y: number };

/**
 * How many pixels a baked canvas may hold: as many as a square 4096 px a side, which every
 * browser gives a canvas (iOS's Safari no more). A larger box is baked at fewer pixels a tile.
 */
export const BAKE_PIXELS = 4096 * 4096;
/**
 * The longest side a baked canvas may have, px: a long, low box may run past 4096 within
 * BAKE_PIXELS. Blackout's lab, 36 tiles wide, lit whole on a laptop at density 2 — 116 px a
 * tile — bakes 4187 px wide and 2559 high, pixel for pixel; held to 4096 a side, it was baked
 * at fewer pixels and every frame of the escape copied it filtered, twice the frame's work.
 */
export const BAKE_SIDE = 8192;

/** Whether a canvas `width` × `height` px may be baked: within BAKE_PIXELS and BAKE_SIDE. */
export function bakeable(width: number, height: number): boolean {
  return width * height <= BAKE_PIXELS && Math.max(width, height) <= BAKE_SIDE;
}

/** A box of whole tiles on the map: its corner and its size, in tiles. */
export interface TileBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A light baked over `box`. */
export interface Baked {
  canvas: HTMLCanvasElement;
  box: TileBox;
  /** the grid it was baked on */
  grid: PixelGrid;
  /** where its top-left pixel lies, in whole pixels from the whole pixel the grid's origin is at */
  left: number;
  top: number;
}

/** A round light: its middle and its radius, in tiles. */
export interface Round {
  x: number;
  y: number;
  r: number;
}

/**
 * The box of whole tiles round every tile of `tiles` and every round light
 * of `rounds`, cut to the map; null where that leaves nothing to bake.
 */
export function bakeBox(
  map: { width: number; height: number },
  tiles: readonly Spot[],
  rounds: readonly Round[],
): TileBox | null {
  type Edges = readonly [left: number, top: number, right: number, bottom: number];
  const edges: Edges[] = [
    ...tiles.map((tile): Edges => [tile.x, tile.y, tile.x + 1, tile.y + 1]),
    ...rounds.map(
      (round): Edges => [
        Math.floor(round.x - round.r),
        Math.floor(round.y - round.r),
        Math.ceil(round.x + round.r),
        Math.ceil(round.y + round.r),
      ],
    ),
  ];
  let [left, top, right, bottom] = [map.width, map.height, 0, 0];
  for (const [l, t, r, b] of edges) {
    left = Math.min(left, l);
    top = Math.min(top, t);
    right = Math.max(right, r);
    bottom = Math.max(bottom, b);
  }
  const x = Math.max(0, left);
  const y = Math.max(0, top);
  const w = Math.min(map.width, right) - x;
  const h = Math.min(map.height, bottom) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

/**
 * The grid `box` is baked on for a frame on `grid`: that grid, or — where it
 * would be too large to bake (`bakeable`) — the most whole pixels a tile that
 * are not; a bake like that is drawn scaled.
 */
export function bakeGrid(box: TileBox, grid: PixelGrid): PixelGrid {
  const fits = (scale: number): boolean => bakeable(box.w * scale, box.h * scale);
  if (fits(grid.scale)) {
    return grid;
  }
  let scale = Math.floor(Math.min(grid.scale, BAKE_SIDE / Math.max(box.w, box.h)));
  while (scale > 1 && !fits(scale)) {
    scale -= 1;
  }
  return { scale, ox: 0, oy: 0 };
}

/**
 * Bakes what `draw` draws in tile space over `box` on `grid`: into `into`
 * where given — cleared first, its size set anew only where the box needs
 * another — else into a new canvas.
 */
export function bake(
  box: TileBox,
  grid: PixelGrid,
  draw: (g: CanvasRenderingContext2D) => void,
  into: HTMLCanvasElement = document.createElement('canvas'),
): Baked {
  const on = bakeGrid(box, grid);
  const s = on.scale;
  const [px, py] = phaseOf(on);
  const left = Math.floor(box.x * s + px);
  const top = Math.floor(box.y * s + py);
  const width = Math.max(1, Math.ceil((box.x + box.w) * s + px) - left);
  const height = Math.max(1, Math.ceil((box.y + box.h) * s + py) - top);
  if (into.width !== width || into.height !== height) {
    into.width = width;
    into.height = height;
  }
  const g = into.getContext('2d');
  if (g === null) {
    throw new Error('baked: canvas.getContext("2d") returned null; cannot bake the light.');
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, width, height);
  g.save();
  g.setTransform(s, 0, 0, s, px - left, py - top);
  draw(g);
  g.restore();
  return { canvas: into, box, grid: on, left, top };
}

/**
 * The bakes `parts`, all baked on one grid, added up into `into`: each copied
 * over the box round them all at whole pixels, adding ('lighter'), so that a
 * channel of a pixel is the sum of the parts' as whole numbers — laying the
 * sum adds onto a picture exactly what laying the parts one by one did, where
 * no channel passes full. Null where `parts` is empty, or where the box round
 * them would be too large to bake (`bakeable`).
 */
export function addBaked(parts: readonly Baked[], into: HTMLCanvasElement): Baked | null {
  const first = parts[0];
  if (first === undefined) {
    return null;
  }
  const left = Math.min(...parts.map((p) => p.left));
  const top = Math.min(...parts.map((p) => p.top));
  const width = Math.max(...parts.map((p) => p.left + p.canvas.width)) - left;
  const height = Math.max(...parts.map((p) => p.top + p.canvas.height)) - top;
  if (!bakeable(width, height)) {
    return null;
  }
  if (into.width !== width || into.height !== height) {
    into.width = width;
    into.height = height;
  }
  const g = into.getContext('2d');
  if (g === null) {
    throw new Error('baked: canvas.getContext("2d") returned null; cannot add the bakes up.');
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, width, height);
  g.globalCompositeOperation = 'lighter';
  for (const part of parts) {
    g.drawImage(part.canvas, part.left - left, part.top - top);
  }
  g.globalCompositeOperation = 'source-over';
  const box = boxRound(parts.map((p) => p.box));
  return { canvas: into, box, grid: first.grid, left, top };
}

/** The box of whole tiles round `boxes`, none of them empty. */
function boxRound(boxes: readonly TileBox[]): TileBox {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const w = Math.max(...boxes.map((b) => b.x + b.w)) - x;
  const h = Math.max(...boxes.map((b) => b.y + b.h)) - y;
  return { x, y, w, h };
}

/**
 * Lays `baked` over `g` for a frame on `grid`: copied pixel for pixel where
 * it was baked on that grid, else scaled to it. How it mixes in is `g`'s to
 * say; `g`'s transform is as it was after.
 */
export function drawBaked(g: CanvasRenderingContext2D, baked: Baked, grid: PixelGrid): void {
  g.save();
  if (sameGrid(baked.grid, grid)) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(baked.canvas, Math.round(grid.ox) + baked.left, Math.round(grid.oy) + baked.top);
  } else {
    // A pixel of the bake lies at (left - phase + i) / scale tiles from the origin.
    const k = grid.scale / baked.grid.scale;
    const [px, py] = phaseOf(baked.grid);
    g.setTransform(k, 0, 0, k, grid.ox + (baked.left - px) * k, grid.oy + (baked.top - py) * k);
    g.drawImage(baked.canvas, 0, 0);
  }
  g.restore();
}

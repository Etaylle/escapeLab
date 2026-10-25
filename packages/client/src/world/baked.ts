import { phaseOf, sameGrid, type PixelGrid } from './render/grid.js';

/**
 * Light that seldom changes, baked: drawn once into a canvas of its own on
 * the frame's pixel grid (render/grid.ts) — at the frame's scale, its pixels
 * where the picture's pixels lie — which every frame then copies onto the
 * picture pixel for pixel in one go: far cheaper than drawing it there, and
 * than a scaled copy, which the canvas has to filter. The lit rooms' ceiling
 * lights, the open hatch's light, the emergency lamps', the light through
 * open doors and the faint lights' glow are baked this way (render/bakes.ts):
 * again only as they change, or for another grid. A box too large for
 * BAKE_MAX is baked at fewer pixels a tile and drawn scaled, filtered.
 */

type Spot = { x: number; y: number };

/** The longest side a baked canvas may have, px: a larger box is baked at fewer pixels. */
export const BAKE_MAX = 4096;

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
 * The grid `box` is baked on for a frame on `grid`: that grid, or — where
 * its longer side would pass BAKE_MAX pixels — fewer pixels a tile, on whole
 * pixels; a bake like that is drawn scaled.
 */
export function bakeGrid(box: TileBox, grid: PixelGrid): PixelGrid {
  const most = BAKE_MAX / Math.max(box.w, box.h);
  return grid.scale <= most ? grid : { scale: Math.floor(most), ox: 0, oy: 0 };
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

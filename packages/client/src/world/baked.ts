/**
 * Light that seldom changes, baked: drawn once into a canvas of its own,
 * BAKE_PX pixels to a tile, which every frame then lays over the picture in
 * one go and without smoothing — a third of what a smoothed draw of the
 * same size costs, and at this many pixels a tile it does not show. The lit
 * rooms' ceiling lights and the open hatch's glow are baked this way
 * (GameWorld.tsx): baked again only as they change, in the steps of
 * `bakeStep`.
 */

type Spot = { x: number; y: number };

/** Pixels a tile a light is baked at; fewer only where the canvas would grow past BAKE_MAX. */
export const BAKE_PX = 32;
/** The longest side a baked canvas may have, in pixels. */
export const BAKE_MAX = 2048;
/** The steps a moving share is baked in: a room warming up, the red coming, the hatch opening. */
const STEPS = 32;

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

/** Pixels a tile `box` is baked at: BAKE_PX, or fewer where its longer side would pass BAKE_MAX. */
export function bakeScale(box: TileBox): number {
  return Math.max(1, Math.min(BAKE_PX, Math.floor(BAKE_MAX / Math.max(box.w, box.h))));
}

/** `share` (0 to 1) rounded to the steps a bake follows: in between, the last bake stands. */
export function bakeStep(share: number): number {
  return Math.round(share * STEPS) / STEPS;
}

/**
 * Bakes what `draw` draws in tile space over `box`: into `into` where
 * given — cleared first, its size set anew only where the box needs
 * another — else into a new canvas.
 */
export function bake(
  box: TileBox,
  draw: (g: CanvasRenderingContext2D) => void,
  into: HTMLCanvasElement = document.createElement('canvas'),
): Baked {
  const scale = bakeScale(box);
  const width = box.w * scale;
  const height = box.h * scale;
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
  g.setTransform(scale, 0, 0, scale, -box.x * scale, -box.y * scale);
  draw(g);
  g.restore();
  return { canvas: into, box };
}

/**
 * Lays `baked` over `g`, whose transform is in tiles, unsmoothed; how it
 * mixes in is `g`'s to say. `g` keeps its smoothing as it was.
 */
export function drawBaked(g: CanvasRenderingContext2D, { canvas, box }: Baked): void {
  const smooth = g.imageSmoothingEnabled;
  g.imageSmoothingEnabled = false;
  g.drawImage(canvas, box.x, box.y, box.w, box.h);
  g.imageSmoothingEnabled = smooth;
}

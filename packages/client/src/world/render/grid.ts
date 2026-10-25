/**
 * How the world lies on the canvas's pixels this frame: device pixels a tile
 * and where the world's origin falls. A canvas draws a picture copied pixel
 * for pixel several times faster than one it has to filter — moved by a
 * fraction of a pixel, or scaled — so what seldom changes is baked on this
 * grid (baked.ts, tileCache.ts) and copied onto the canvas at whole pixels.
 * The camera that follows you is put on whole pixels for that (snapCamera):
 * the picture moves in steps of a pixel. The audience's camera, and the one
 * pulling back over the lab at the end, keep their fraction; what is baked
 * for them is baked at it.
 */

/** The world on the canvas: device pixels a tile, and where the world's origin (0, 0) lies. */
export interface PixelGrid {
  scale: number;
  ox: number;
  oy: number;
}

/** How far apart two grids' phases may lie and still count as one, px. */
const SAME_PHASE = 1e-6;

/** The grid of a camera at (x, y) in tiles, `scale` device pixels a tile, on a canvas `w` × `h`. */
export function gridOf(
  camera: { x: number; y: number; scale: number },
  w: number,
  h: number,
): PixelGrid {
  const s = camera.scale;
  return { scale: s, ox: w / 2 - camera.x * s, oy: h / 2 - camera.y * s };
}

/**
 * The fraction of a pixel by which `grid` lies off the canvas's whole pixels, across and
 * down, from -0.5 to 0.5: the world's origin lies at the nearest whole pixel plus this.
 */
export function phaseOf(grid: PixelGrid): [number, number] {
  return [grid.ox - Math.round(grid.ox), grid.oy - Math.round(grid.oy)];
}

/** Whether a picture baked for `a` is copied pixel for pixel onto `b`: one scale, one phase. */
export function sameGrid(a: PixelGrid, b: PixelGrid): boolean {
  const [ax, ay] = phaseOf(a);
  const [bx, by] = phaseOf(b);
  return (
    a.scale === b.scale && Math.abs(ax - bx) < SAME_PHASE && Math.abs(ay - by) < SAME_PHASE
  );
}

/**
 * The camera at (x, y), `scale` device pixels a tile, moved by less than
 * half a pixel so that the world's origin falls on a whole pixel of a canvas
 * `w` × `h`.
 */
export function snapCamera(
  camera: { x: number; y: number; scale: number },
  w: number,
  h: number,
): { x: number; y: number; scale: number } {
  const s = camera.scale;
  const ox = Math.round(w / 2 - camera.x * s);
  const oy = Math.round(h / 2 - camera.y * s);
  return { x: (w / 2 - ox) / s, y: (h / 2 - oy) / s, scale: s };
}

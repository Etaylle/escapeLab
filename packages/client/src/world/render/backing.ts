/**
 * The world's canvas at the screen's density: its backing store as many
 * device pixels as its box has CSS pixels times the density, at most
 * MAX_DENSITY — a 3× phone draws at 2×, where its pixels are too small to
 * tell apart and four times the pixels would cost the frame — whole pixels,
 * rounded, so that a density of 1.25 or 1.5 (a laptop at 125 %, a browser's
 * zoom) gives the same size frame after frame instead of sizing the canvas
 * anew every frame. Everything the passes draw is in device pixels: the
 * text, the sprites (keyed by device pixels a tile, atlas.ts) and the bakes.
 */

/** The densest the world draws, device pixels a CSS pixel. */
export const MAX_DENSITY = 2;

/** The world's canvas for a box `cssW` × `cssH` at the screen's `ratio`: its size and density. */
export function backingSize(
  cssW: number,
  cssH: number,
  ratio: number,
): { w: number; h: number; dpr: number } {
  const dpr = Math.min(MAX_DENSITY, ratio > 0 ? ratio : 1);
  return { w: Math.round(cssW * dpr), h: Math.round(cssH * dpr), dpr };
}

/**
 * Sizes `canvas` and the darkness's `overlay` to the canvas's box at `ratio` — only where they
 * differ, as sizing a canvas clears it — and returns the density drawn at. A canvas with no box
 * — off the page, its screen unmounting, or hidden — is left as it is, and null returned: there
 * is nothing to draw into, and a canvas sized to nothing can not be drawn from.
 */
export function fitBacking(
  canvas: HTMLCanvasElement,
  overlay: HTMLCanvasElement,
  ratio: number,
): number | null {
  if (canvas.clientWidth === 0 || canvas.clientHeight === 0) {
    return null;
  }
  const { w, h, dpr } = backingSize(canvas.clientWidth, canvas.clientHeight, ratio);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  if (overlay.width !== w || overlay.height !== h) {
    overlay.width = w;
    overlay.height = h;
  }
  return dpr;
}

import type { CanvasMaker } from '../atlas.js';
import { rgba, type Rgb } from '../palette.js';
import { frameCache, keep, touch, type CacheLimits, type FrameCache } from './frameCache.js';

/**
 * Radial gradients baked once as sprites, a sprite a gradient and radius,
 * and copied where a glow goes at whole pixels: a canvas makes a gradient
 * anew on every fill and works it out pixel by pixel, where a copy at whole
 * pixels costs it a quarter of that. A glow's middle moves by less than half
 * a pixel for it. How strongly one is laid on is the context's alpha: a
 * gradient's stops all scaled by one share are its sprite at that alpha.
 */

/**
 * A radial gradient from its middle (offset 0) out to its rim (offset 1):
 * colour and alpha at each stop.
 */
export type RadialStops = readonly (readonly [offset: number, rgb: Rgb, alpha: number])[];

/** The sprites baked so far, by stops and radius, and what they are baked on. */
export interface RadialSprites {
  make: CanvasMaker;
  baked: FrameCache<HTMLCanvasElement>;
}

/**
 * How many sprites are kept, and the pixels they hold (24 MB at four bytes a
 * pixel): a zoom moving makes new ones on every frame, and those the last two
 * frames did not use go past these (frameCache.ts).
 */
export const SPRITE_LIMITS: CacheLimits = { most: 96, pixels: 6 * 1024 * 1024 };

const itself = (canvas: HTMLCanvasElement): HTMLCanvasElement => canvas;

/** Sprites baked on canvases from `make`. */
export function radialSprites(make: CanvasMaker): RadialSprites {
  return { make, baked: frameCache() };
}

/** What stops cut into the darkness: black, as deep as each stop says. */
export function cutStops(
  stops: readonly (readonly [offset: number, depth: number])[],
): RadialStops {
  return stops.map(([offset, depth]) => [offset, [0, 0, 0], depth] as const);
}

/** Half a sprite's side for a radius of `r` px: room for the rim's last pixel and one more. */
function halfOf(r: number): number {
  return Math.ceil(r) + 1;
}

/** The stops as text, worked out once for stops that are kept. */
const stopKeys = new WeakMap<RadialStops, string>();

function stopsKey(stops: RadialStops): string {
  let key = stopKeys.get(stops);
  if (key === undefined) {
    key = JSON.stringify(stops);
    stopKeys.set(stops, key);
  }
  return key;
}

/** The sprite of `stops` out to `r` px round its middle, for `frame`; baked on its first use. */
export function radialSprite(
  sprites: RadialSprites,
  stops: RadialStops,
  r: number,
  frame: object,
): HTMLCanvasElement {
  const key = `${stopsKey(stops)}|${r.toFixed(2)}`;
  const known = touch(sprites.baked, key, frame);
  if (known !== undefined) {
    return known;
  }
  const half = halfOf(r);
  const canvas = sprites.make(half * 2, half * 2);
  const g = canvas.getContext('2d');
  if (g === null) {
    throw new Error('radial: canvas.getContext("2d") returned null; cannot bake a glow.');
  }
  const gradient = g.createRadialGradient(half, half, 0, half, half, r);
  for (const [offset, colour, alpha] of stops) {
    gradient.addColorStop(offset, rgba(colour, alpha));
  }
  g.fillStyle = gradient;
  g.fillRect(0, 0, half * 2, half * 2);
  keep(sprites.baked, [key, canvas], frame, SPRITE_LIMITS, itself);
  return canvas;
}

/**
 * Lays the gradient `stops` round (x, y) out to `r`, device pixels, over
 * `g` from its sprite, at whole pixels, for `frame`; `g`'s transform has to
 * be the canvas's own, its alpha and compositing are the caller's to set.
 */
export function drawRadial(
  g: CanvasRenderingContext2D,
  sprites: RadialSprites,
  stops: RadialStops,
  [x, y, r]: readonly [number, number, number],
  frame: object,
): void {
  if (!(r > 0)) {
    return;
  }
  const half = halfOf(r);
  g.drawImage(radialSprite(sprites, stops, r, frame), Math.round(x) - half, Math.round(y) - half);
}

import { BLACK, rgba, type Rgb } from './palette.js';

/**
 * What every drawing of the world shares: the bible's line and light rules as
 * numbers, paths, the memo of gradients, the soft ellipse shadows and glows
 * are made of, and seeded noise. Drawings work in tile units — 1 is a tile —
 * with the origin where the drawing says.
 */

export const TAU = Math.PI * 2;

/** The outline round every prop: 2 px at 64 px a tile, so it scales with the zoom. */
export const OUTLINE = 2 / 64;
/** How dark the shadow at a standing prop's foot is in its middle. */
export const FOOT_SHADOW = 0.25;

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Maps a 0..1 looping phase to a smooth 0..1..0 wave with no jump at the wrap. */
export function pulseWave(phase: number): number {
  return 0.5 - 0.5 * Math.cos(phase * TAU);
}

/** mulberry32: a tiny seeded PRNG for deterministic noise; floats in [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A well-mixed 32-bit hash of a seed and a tile: the same tile, the same number. */
export function hashTile(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x + 0x9e37, 0x85ebca6b) ^ Math.imul(y + 0x79b9, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Adds a rounded-rect subpath. `r` rounds the top corners and `rBottom` the bottom ones;
 * both are clamped to half the rect's shorter side.
 */
export function roundRectPath(
  p: CanvasPath,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  rBottom = r,
): void {
  const limit = Math.max(0, Math.min(w, h) / 2);
  const rt = Math.min(r, limit);
  const rb = Math.min(rBottom, limit);
  p.moveTo(x + rt, y);
  p.arcTo(x + w, y, x + w, y + h, rt);
  p.arcTo(x + w, y + h, x, y + h, rb);
  p.arcTo(x, y + h, x, y, rb);
  p.arcTo(x, y, x + w, y, rt);
  p.closePath();
}

/** Adds a circle subpath that is not connected to the previous subpath. */
export function addCircle(p: CanvasPath, x: number, y: number, r: number): void {
  p.moveTo(x + r, y);
  p.arc(x, y, r, 0, TAU);
}

type GradientBuilder = (ctx: CanvasRenderingContext2D, key: string) => CanvasGradient;
type GradientsByKey = Map<string, CanvasGradient>;
type GradientsByBuilder = Map<GradientBuilder, GradientsByKey>;

/**
 * Gradient memo: context → builder → key → gradient. A CanvasGradient's
 * coordinates are resolved in the user space active when it fills, so one
 * built once in a drawing's own tile units stays right under any transform a
 * later call sets up. Gradients belong to the context that made them, hence
 * the WeakMap; builders are module-level functions and keys come from small
 * fixed sets, so the memo stays tiny and a lookup allocates nothing.
 */
const gradientCache = new WeakMap<CanvasRenderingContext2D, GradientsByBuilder>();

/** The gradient `build` makes for `key` on `ctx`, built on first use. */
export function cachedGradient(
  ctx: CanvasRenderingContext2D,
  build: GradientBuilder,
  key: string,
): CanvasGradient {
  let byBuilder = gradientCache.get(ctx);
  if (byBuilder === undefined) {
    byBuilder = new Map<GradientBuilder, GradientsByKey>();
    gradientCache.set(ctx, byBuilder);
  }
  let byKey = byBuilder.get(build);
  if (byKey === undefined) {
    byKey = new Map<string, CanvasGradient>();
    byBuilder.set(build, byKey);
  }
  let gradient = byKey.get(key);
  if (gradient === undefined) {
    gradient = build(ctx, key);
    byKey.set(key, gradient);
  }
  return gradient;
}

/** The key a colour goes by in the gradient memo. */
const keyOf = (rgb: Rgb): string => rgb.join(',');

/** Unit-radius radial falloff used by softEllipse; the key names its colour. */
function buildSoftGradient(ctx: CanvasRenderingContext2D, key: string): CanvasGradient {
  const [r = 0, g = 0, b = 0] = key.split(',').map(Number);
  const rgb: Rgb = [r, g, b];
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, rgba(rgb, 1));
  gradient.addColorStop(0.45, rgba(rgb, 0.6));
  gradient.addColorStop(1, rgba(rgb, 0));
  return gradient;
}

/**
 * Fills an ellipse with a soft radial falloff of `rgb` that peaks at `alpha`
 * in the centre: ground shadows with 'source-over', light glows with 'lighter'.
 */
export function softEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rgb: Rgb,
  alpha: number,
  op: GlobalCompositeOperation,
): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = op;
  ctx.globalAlpha *= alpha;
  ctx.translate(cx, cy);
  ctx.scale(rx, ry);
  ctx.fillStyle = cachedGradient(ctx, buildSoftGradient, keyOf(rgb));
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** The bible's foot shadow under a standing prop: FOOT_SHADOW dark in its middle. */
export function footShadow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): void {
  softEllipse(ctx, cx, cy, rx, ry, BLACK, FOOT_SHADOW, 'source-over');
}

/** Strokes the current path with the bible's outline in `ink`. */
export function outline(ctx: CanvasRenderingContext2D, ink: string, width = OUTLINE): void {
  ctx.lineWidth = width;
  ctx.strokeStyle = ink;
  ctx.stroke();
}

/** A rounded box filled with `fill` and outlined in `ink`, from its top left corner. */
export function box(
  ctx: CanvasRenderingContext2D,
  [x, y, w, h]: readonly [number, number, number, number],
  r: number,
  fill: string | CanvasGradient,
  ink: string,
): void {
  ctx.beginPath();
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  outline(ctx, ink);
}

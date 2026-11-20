/**
 * Small helpers shared by Ferret Flush's rules and its drawing (the reference's src/kit.js):
 * numbers, easing, colours and a few shapes for a canvas. Nothing here needs a page.
 */

export const TAU = Math.PI * 2;

export function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** How far `value` has come from `start` to `end`, held between 0 and 1. */
export function span(value: number, start: number, end: number): number {
  return clamp((value - start) / (end - start), 0, 1);
}

/** The shortest signed turn from one angle to another, in radians. */
export function angleDelta(from: number, to: number): number {
  const turn = (to - from) % TAU;
  if (turn > Math.PI) return turn - TAU;
  if (turn < -Math.PI) return turn + TAU;
  return turn;
}

export const ease = {
  in: (t: number): number => t * t * t,
  out: (t: number): number => 1 - (1 - t) ** 3,
  inOut: (t: number): number => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  /** Overshoots a little before it settles: for things that pop up. */
  back: (t: number): number => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2,
};

/** A repeatable random source (mulberry32), so the marsh looks the same on every visit. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let n = Math.imul(state ^ (state >>> 15), 1 | state);
    n = (n + Math.imul(n ^ (n >>> 7), 61 | n)) ^ n;
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rgb = readonly [number, number, number];

/** '#rrggbb' as [red, green, blue]. */
export function rgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function css(color: Rgb, alpha = 1): string {
  const [r, g, b] = color.map(Math.round) as [number, number, number];
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

export type Point = [number, number];

/** A curve from `a` to `c` that bends toward `b`: returns the point at u between 0 and 1. */
export function curve(a: Point, b: Point, c: Point): (u: number) => Point {
  return (u) => {
    const v = 1 - u;
    return [
      v * v * a[0] + 2 * v * u * b[0] + u * u * c[0],
      v * v * a[1] + 2 * v * u * b[1] + u * u * c[1],
    ];
  };
}

export function ellipse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  turn = 0,
): void {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), turn, 0, TAU);
  ctx.fill();
}

export function line(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

/** Fills a soft tube along a curve by stamping discs: the body of a ferret, an arm, a tail. */
export function tube(
  ctx: CanvasRenderingContext2D,
  at: (u: number) => Point,
  radius: number | ((u: number) => number),
  steps = 28,
): void {
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const [x, y] = at(i / steps);
    const r = typeof radius === 'function' ? radius(i / steps) : radius;
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, TAU);
  }
  ctx.fill();
}

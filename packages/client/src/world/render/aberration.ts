import type { Alarm } from '../alarm.js';
import { css, GUN_BLUE, GUN_GREEN, GUN_RED, mix, WHITE } from '../palette.js';
import type { Frame } from './frame.js';

/**
 * An alarm knocks the picture's colours apart for ABERRATION_MS: the
 * finished frame's red pushed one way and its blue the other, ABERRATION_PX
 * at the start and closing in as the knock fades, the way a CRT's guns slip
 * when the camera is shaken — along the picture's two sides, a SIDE of its
 * width each, where a tube's convergence is worst and the eye looks least;
 * the middle, where the crew stands, stays sharp. Canvas, after everything
 * else is drawn: the frame is copied twice into the kit's scratch canvases,
 * each copy cut down to one colour, the picture's own red and blue faded by
 * as much as the knock is strong, and the two copies laid back on it —
 * exactly two offset draws of the finished frame, kept to the sides. The
 * sides keep the cost of the knock's frames within the budget of a frame's
 * effect (docs/art-bible.md). Under reduced motion there is none.
 */

/** How long the colours stay knocked apart after an alarm, ms. */
export const ABERRATION_MS = 150;
/** How far apart they are at first, CSS pixels. */
export const ABERRATION_PX = 3;
/** How much of the picture's width each of its two sides takes, where the colours slip. */
export const SIDE = 1 / 8;

/** The knock `ms` after an alarm: how strong, 1 to 0, and how far apart, CSS px; null for none. */
export interface Knock {
  strength: number;
  px: number;
}

/** The knock of `alarm` at `now` (epoch ms); none before it, after ABERRATION_MS, when reduced. */
export function knockAt(alarm: Alarm | null, now: number, reduced: boolean): Knock | null {
  if (alarm === null || reduced) {
    return null;
  }
  const ms = now - alarm.at;
  if (ms < 0 || ms >= ABERRATION_MS) {
    return null;
  }
  const strength = 1 - ms / ABERRATION_MS;
  return { strength, px: ABERRATION_PX * strength };
}

/** The scratch canvases the frame's colours are cut into, made for the kit on the first knock. */
export interface Fringe {
  red: CanvasRenderingContext2D;
  blue: CanvasRenderingContext2D;
}

/** The scratch canvases of `frame`'s kit at the canvas's size: made once, sized as it is. */
function fringeOf(frame: Frame, w: number, h: number): Fringe {
  const make = (): CanvasRenderingContext2D => {
    const g = frame.kit.art.atlas.make(w, h).getContext('2d');
    if (g === null) {
      throw new Error('aberration: canvas.getContext("2d") returned null; cannot split colours.');
    }
    return g;
  };
  const fringe = (frame.kit.fringe ??= { red: make(), blue: make() });
  for (const g of [fringe.red, fringe.blue]) {
    if (g.canvas.width !== w || g.canvas.height !== h) {
      g.canvas.width = w;
      g.canvas.height = h;
    }
  }
  return fringe;
}

/**
 * The picture's two sides, where the colours slip — `pad` pixels wider toward the middle —
 * as left, top, width, height, device pixels.
 */
export function sidesOf(w: number, h: number, pad = 0): [number, number, number, number][] {
  const side = Math.round(w * SIDE) + pad;
  return [
    [0, 0, side, h],
    [w - side, 0, side, h],
  ];
}

/**
 * Copies the sides `sides` of the finished frame of `from` into `g` — the frame is opaque, so
 * each copy covers what lay there — and cuts them down to `colour` alone.
 */
function oneColour(
  g: CanvasRenderingContext2D,
  from: HTMLCanvasElement,
  colour: string,
  sides: readonly (readonly [number, number, number, number])[],
): void {
  g.globalCompositeOperation = 'source-over';
  for (const side of sides) {
    g.drawImage(from, ...side, ...side);
  }
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = colour;
  for (const side of sides) {
    g.fillRect(...side);
  }
}

/** Knocks the finished frame's colours apart along its sides, where an alarm has just come in. */
export function draw(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const knock = knockAt(frame.alarm, frame.now, frame.reduced);
  if (knock === null) {
    return;
  }
  const { w, h, dpr } = frame.viewport;
  const shift = Math.max(1, Math.round(knock.px * dpr));
  const sides = sidesOf(w, h);
  // Each copy cut down a shift wider than the sides: what slides into them is one colour too.
  const cut = sidesOf(w, h, shift);
  const fringe = fringeOf(frame, w, h);
  oneColour(fringe.red, ctx.canvas, css(GUN_RED), cut);
  oneColour(fringe.blue, ctx.canvas, css(GUN_BLUE), cut);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath();
  for (const side of sides) {
    ctx.rect(...side);
  }
  ctx.clip();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'multiply';
  // The picture's own red and blue faded by as much as the knock is strong, its green kept.
  ctx.fillStyle = css(mix(GUN_GREEN, WHITE, 1 - knock.strength));
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = knock.strength;
  ctx.drawImage(fringe.red.canvas, shift, 0);
  ctx.drawImage(fringe.blue.canvas, -shift, 0);
  ctx.restore();
}

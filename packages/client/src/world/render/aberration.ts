import type { Alarm } from '../alarm.js';
import { css, GUN_BLUE, GUN_RED } from '../palette.js';
import type { Frame } from './frame.js';

/**
 * An alarm knocks the picture's colours apart for ABERRATION_MS: the
 * finished frame's red pushed one way and its blue the other, ABERRATION_PX
 * at the start and closing in as the knock fades, the way a CRT's guns slip
 * when the camera is shaken — along the picture's two sides, a SIDE of its
 * width each, where a tube's convergence is worst and the eye looks least;
 * the middle, where the crew stands, stays sharp. Canvas, after everything
 * else is drawn: the frame's two sides are copied twice into the kit's
 * scratch canvases — no larger than the sides — each copy cut down to one
 * colour, and the two copies added back over it, one pushed each way, FRINGE
 * strong and fading with the knock: exactly two offset passes of the finished
 * frame, each laid in its two sides. The knock comes with the alarm's red
 * strobe over the world (alarm.ts), which hides the light it adds. Kept to the
 * sides, the knock's frames stay within the budget of a frame's effect
 * (docs/art-bible.md). Under reduced motion there is none.
 */

/** How long the colours stay knocked apart after an alarm, ms. */
export const ABERRATION_MS = 150;
/** How far apart they are at first, CSS pixels. */
export const ABERRATION_PX = 4;
/** How much of the picture's width each of its two sides takes, where the colours slip. */
export const SIDE = 1 / 12;
/** How strongly the pushed copies are laid over the picture at the knock's start. */
export const FRINGE = 0.6;

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

/**
 * The scratch canvases the sides' colours are cut into, made for the kit on the first knock:
 * each holds the left side's copy at its left and the right side's beside it.
 */
export interface Fringe {
  red: CanvasRenderingContext2D;
  blue: CanvasRenderingContext2D;
}

/** Where the knock works on a picture: the sides' width, and how much more each copy takes. */
export interface Sides {
  /** each side's width, device pixels */
  side: number;
  /** each copy's width: the side and as far as the copies may be pushed toward the middle */
  copy: number;
}

/** The sides of a picture `w` wide at `dpr` device pixels a CSS pixel. */
export function sidesOf(w: number, dpr: number): Sides {
  const side = Math.round(w * SIDE);
  return { side, copy: side + Math.ceil(ABERRATION_PX * dpr) };
}

/** The scratch canvases of `frame`'s kit, two copies wide and `h` high: made once, sized as asked. */
function fringeOf(frame: Frame, copy: number, h: number): Fringe {
  const make = (): CanvasRenderingContext2D => {
    const g = frame.kit.art.atlas.make(copy * 2, h).getContext('2d');
    if (g === null) {
      throw new Error('aberration: canvas.getContext("2d") returned null; cannot split colours.');
    }
    return g;
  };
  const fringe = (frame.kit.fringe ??= { red: make(), blue: make() });
  for (const g of [fringe.red, fringe.blue]) {
    if (g.canvas.width !== copy * 2 || g.canvas.height !== h) {
      g.canvas.width = copy * 2;
      g.canvas.height = h;
    }
  }
  return fringe;
}

/** Copies the two sides of the finished frame `from` into `g`, cut down to `colour` alone. */
function oneColour(
  g: CanvasRenderingContext2D,
  from: HTMLCanvasElement,
  colour: string,
  copy: number,
): void {
  const { width, height } = g.canvas;
  g.globalCompositeOperation = 'copy';
  g.drawImage(from, 0, 0, copy, height, 0, 0, copy, height);
  g.globalCompositeOperation = 'source-over';
  g.drawImage(from, from.width - copy, 0, copy, height, copy, 0, copy, height);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = colour;
  g.fillRect(0, 0, width, height);
}

/** Lays the copies in `g` back over the sides of `ctx`, pushed `shift` pixels across. */
function layBack(ctx: CanvasRenderingContext2D, g: CanvasRenderingContext2D, shift: number): void {
  const { width, height } = g.canvas;
  const copy = width / 2;
  ctx.drawImage(g.canvas, 0, 0, copy, height, shift, 0, copy, height);
  ctx.drawImage(g.canvas, copy, 0, copy, height, ctx.canvas.width - copy + shift, 0, copy, height);
}

/** Knocks the finished frame's colours apart along its sides, where an alarm has just come in. */
export function draw(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const knock = knockAt(frame.alarm, frame.now, frame.reduced);
  if (knock === null) {
    return;
  }
  const { w, h, dpr } = frame.viewport;
  const shift = Math.max(1, Math.round(knock.px * dpr));
  const { side, copy } = sidesOf(w, dpr);
  const fringe = fringeOf(frame, copy, h);
  oneColour(fringe.red, ctx.canvas, css(GUN_RED), copy);
  oneColour(fringe.blue, ctx.canvas, css(GUN_BLUE), copy);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath();
  ctx.rect(0, 0, side, h);
  ctx.rect(w - side, 0, side, h);
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = knock.strength * FRINGE;
  layBack(ctx, fringe.red, shift);
  layBack(ctx, fringe.blue, -shift);
  ctx.restore();
}

import { drawScientist, type FigureLayer } from '../art.js';
import type { CanvasMaker } from '../atlas.js';
import { softEllipse } from '../brush.js';
import type { FigurePose } from '../figure.js';
import { BLACK } from '../palette.js';
import type { HeroMotion, HeroPlace, StageBox } from './hero.js';
import { drawHandLamp } from './lampArt.js';

/**
 * The hero drawn (menu/hero.ts, screens/MenuHero.tsx): the crew figure as art.ts draws it, the
 * hand lamp in its hands (lampArt.ts), on a canvas of its own at the stage's density. It is laid
 * from two layers kept between frames — its legs with the shadow under them, and everything over
 * its legs drawn with the breath taken out (art.ts FigureLayer) — the upper laid as far up as the
 * breath has it, in whole pixels. A frame that changes no more than the breath draws no figure
 * anew: two copies, and only where the breath has come to another pixel. A layer is drawn again
 * only where what it shows has changed — a glance, the visor's light, a wave, the lamp turned
 * another step, the colour, the size.
 */

/**
 * The hero's drop shadow on the lab's floor, figure units: wider than a figure's own blob, which
 * its boots hide at this size, and thrown a little to the bottom right, away from the key light.
 */
export const DROP_SHADOW = { dx: 0.03, dy: 0.03, rx: 0.36, ry: 0.085, alpha: 0.45 } as const;

/**
 * The bands of the hero's canvas its layers cover, figure units from its feet: the legs from
 * over their tops down to the canvas's foot, the rest from the canvas's top down to under the
 * body — a copy of a layer costs the pixels it covers, the clear ones as well.
 */
export const LAYER_BANDS = { legsTop: 0.3, upperFoot: 0.08 } as const;

/** A layer of the hero kept between frames: its canvas, and what it was last drawn as. */
interface Layer {
  canvas: HTMLCanvasElement;
  /** what it shows (`layerKey`); null before it was drawn */
  key: string | null;
  /** where its canvas lies on the hero's, device px down */
  top: number;
}

/** The hero's canvas, its two layers, and what it shows. */
export interface HeroCanvas {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  legs: Layer;
  upper: Layer;
  /** what the canvas shows: its layers as drawn and the breath's lift; null before anything */
  laid: string | null;
  /** how often each layer has been drawn, for the walkthrough's probe */
  drawn: Record<'legs' | 'upper', number>;
}

/** What one frame of the hero shows. */
export interface HeroFrame {
  place: HeroPlace;
  /** its canvas's box in the stage, CSS px: its place's, wider while it walks in */
  box: StageBox;
  pose: FigurePose;
  /** where it stands right of its place, whether it walks, where it faces */
  motion: HeroMotion;
  color: string;
  /** the stage's density, device px a CSS px */
  dpr: number;
  /** the lamp in its hands: turned `tilt` from straight ahead, its lens alight `on`, 0 to 1 */
  lamp: { tilt: number; on: number };
}

/** The hero's canvas `canvas`, its layers made by `make`; null where the browser gives no 2D. */
export function heroCanvas(canvas: HTMLCanvasElement, make: CanvasMaker): HeroCanvas | null {
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    return null;
  }
  return {
    canvas,
    ctx,
    legs: { canvas: make(1, 1), key: null, top: 0 },
    upper: { canvas: make(1, 1), key: null, top: 0 },
    laid: null,
    drawn: { legs: 0, upper: 0 },
  };
}

/** Where the feet stand on the hero's canvas and how large a figure unit is, device px. */
interface Anchor {
  x: number;
  y: number;
  s: number;
}

/** The anchor of `frame`'s feet on its canvas at its density: its place, as far right as it is. */
function anchorOf({ place, box, motion, dpr }: HeroFrame): Anchor {
  return {
    x: Math.round((place.feet.x + motion.offset * place.scale - box.left) * dpr),
    y: Math.round((place.feet.y - box.top) * dpr),
    s: place.scale * dpr,
  };
}

/**
 * What layer `which` of `frame` shows, as a key: the canvas's size and anchor, the colour, and
 * of the pose what that layer draws — the breath left out, which the upper is laid by.
 */
function layerKey(which: FigureLayer, frame: HeroFrame, size: string): string {
  const { pose } = frame;
  if (which === 'legs') {
    return `${size} ${frame.color} ${frame.motion.facing} ${pose.shadow}`;
  }
  const arms = pose.arms === null ? '-' : `${pose.arms.front},${pose.arms.back}`;
  const parts = [pose.look, pose.shimmer, arms, pose.holding, pose.dim, pose.bow];
  const { tilt, on } = frame.lamp;
  return `${size} ${frame.color} ${frame.motion.facing} ${parts.join(' ')} ${tilt} ${on}`;
}

/** The figure as `frame` has it, drawn on `ctx` whole or as `layer` says, its feet at `at`. */
function drawFigure(ctx: CanvasRenderingContext2D, frame: HeroFrame, layer: FigureLayer): void {
  const { tilt, on } = frame.lamp;
  const { motion } = frame;
  drawScientist(ctx, {
    color: frame.color,
    name: '',
    facing: motion.facing,
    moving: motion.moving,
    walkPhase: motion.walk,
    isYou: false,
    connected: true,
    pose: layer === 'all' ? frame.pose : { ...frame.pose, bob: 0 },
    ground: 'lit',
    named: false,
    layer,
    held: (held) => drawHandLamp(held, tilt, on),
  });
}

/** The hero's drop shadow under its feet, at the figure's own scale. */
function dropShadow(ctx: CanvasRenderingContext2D): void {
  const { dx, dy, rx, ry, alpha } = DROP_SHADOW;
  softEllipse(ctx, dx, dy, rx, ry, BLACK, alpha, 'source-over');
}

/** The band of a hero's canvas `h` device px tall that layer `which` covers, anchored at `at`. */
function bandOf(which: FigureLayer, h: number, at: Anchor): { top: number; height: number } {
  if (which === 'legs') {
    const top = Math.max(0, Math.floor(at.y - LAYER_BANDS.legsTop * at.s));
    return { top, height: h - top };
  }
  return { top: 0, height: Math.min(h, Math.ceil(at.y - LAYER_BANDS.upperFoot * at.s)) };
}

/**
 * Draws layer `which` of `frame` on `layer`'s canvas: as wide as the hero's, `w` device px, and
 * covering its band of the hero's `h`, the feet anchored at `at`.
 */
function drawLayer(
  layer: Layer,
  which: FigureLayer,
  frame: HeroFrame,
  [w, h, at]: readonly [number, number, Anchor],
): void {
  const { canvas } = layer;
  const band = bandOf(which, h, at);
  if (canvas.width !== w || canvas.height !== band.height) {
    canvas.width = w;
    canvas.height = band.height;
  }
  layer.top = band.top;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    return;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, band.height);
  ctx.setTransform(at.s, 0, 0, at.s, at.x, at.y - band.top);
  if (which === 'legs') {
    dropShadow(ctx);
  }
  drawFigure(ctx, frame, which);
}

/**
 * The hero walking: drawn whole on its canvas, frame after frame — legs, body and breath all
 * move — its layers left to be laid again once it stands.
 */
function drawWalking(hero: HeroCanvas, frame: HeroFrame, at: Anchor): void {
  const { canvas, ctx } = hero;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(at.s, 0, 0, at.s, at.x, at.y);
  dropShadow(ctx);
  drawFigure(ctx, frame, 'all');
  hero.laid = null;
}

/**
 * Lays one frame of the hero on its canvas: sized to its box at the stage's density; walking,
 * drawn whole; standing, each layer drawn anew where what it shows has changed, and the two laid
 * over each other where anything has — the upper lifted by the breath, in whole pixels. Says
 * whether the canvas changed.
 */
export function paintHero(hero: HeroCanvas, frame: HeroFrame): boolean {
  const { canvas, ctx } = hero;
  const w = Math.max(1, Math.round(frame.box.width * frame.dpr));
  const h = Math.max(1, Math.round(frame.box.height * frame.dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    hero.laid = null;
  }
  const at = anchorOf(frame);
  if (frame.motion.moving) {
    drawWalking(hero, frame, at);
    return true;
  }
  const size = `${w}x${h}@${at.x},${at.y},${at.s}`;
  for (const which of ['legs', 'upper'] as const) {
    const key = layerKey(which, frame, size);
    if (hero[which].key !== key) {
      drawLayer(hero[which], which, frame, [w, h, at]);
      hero[which].key = key;
      hero.drawn[which] += 1;
    }
  }
  const lift = Math.round(frame.pose.bob * at.s);
  const laid = `${hero.legs.key} ${hero.upper.key} ${lift}`;
  if (laid === hero.laid) {
    return false;
  }
  hero.laid = laid;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(hero.legs.canvas, 0, hero.legs.top);
  ctx.drawImage(hero.upper.canvas, 0, hero.upper.top - lift);
  return true;
}

/** Lets the hero's canvases go at once rather than whenever they are collected. */
export function freeHero(hero: HeroCanvas): void {
  for (const canvas of [hero.canvas, hero.legs.canvas, hero.upper.canvas]) {
    canvas.width = 0;
    canvas.height = 0;
  }
}

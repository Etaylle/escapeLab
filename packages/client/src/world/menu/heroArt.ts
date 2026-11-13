import { drawScientist, type FigureLayer } from '../art.js';
import type { CanvasMaker } from '../atlas.js';
import { softEllipse } from '../brush.js';
import type { FigurePose } from '../figure.js';
import { BLACK } from '../palette.js';
import { HERO_FACING, type HeroPlace } from './hero.js';

/**
 * The hero drawn (menu/hero.ts, screens/MenuHero.tsx): the crew figure as art.ts draws it, on a
 * canvas of its own at the stage's density. It is laid from two layers kept between frames —
 * its legs with the shadow under them, and everything over its legs drawn with the breath taken
 * out (art.ts FigureLayer) — the upper laid as far up as the breath has it, in whole pixels. A
 * frame that changes no more than the breath draws no figure anew: two copies, and only where
 * the breath has come to another pixel. A layer is drawn again only where what it shows has
 * changed — a glance, the visor's light, a wave, the colour, the size.
 */

/**
 * The hero's drop shadow on the lab's floor, figure units: wider than a figure's own blob, which
 * its boots hide at this size, and thrown a little to the bottom right, away from the key light.
 */
export const DROP_SHADOW = { dx: 0.03, dy: 0.03, rx: 0.36, ry: 0.085, alpha: 0.45 } as const;

/** A layer of the hero kept between frames: its canvas, and what it was last drawn as. */
interface Layer {
  canvas: HTMLCanvasElement;
  /** what it shows (`layerKey`); null before it was drawn */
  key: string | null;
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
  pose: FigurePose;
  color: string;
  /** the stage's density, device px a CSS px */
  dpr: number;
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
    legs: { canvas: make(1, 1), key: null },
    upper: { canvas: make(1, 1), key: null },
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

/** The anchor of `frame`'s place on a canvas at its density. */
function anchorOf({ place, dpr }: HeroFrame): Anchor {
  return {
    x: Math.round((place.feet.x - place.box.left) * dpr),
    y: Math.round((place.feet.y - place.box.top) * dpr),
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
    return `${size} ${frame.color} ${pose.shadow}`;
  }
  const arms = pose.arms === null ? '-' : `${pose.arms.front},${pose.arms.back}`;
  const parts = [pose.look, pose.shimmer, arms, pose.holding, pose.dim, pose.bow];
  return `${size} ${frame.color} ${parts.join(' ')}`;
}

/** Draws layer `which` of `frame` on `layer`'s canvas, `w` × `h` device px, anchored at `at`. */
function drawLayer(
  layer: Layer,
  which: FigureLayer,
  frame: HeroFrame,
  [w, h, at]: readonly [number, number, Anchor],
): void {
  const { canvas } = layer;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    return;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.setTransform(at.s, 0, 0, at.s, at.x, at.y);
  if (which === 'legs') {
    const { dx, dy, rx, ry, alpha } = DROP_SHADOW;
    softEllipse(ctx, dx, dy, rx, ry, BLACK, alpha, 'source-over');
  }
  drawScientist(ctx, {
    color: frame.color,
    name: '',
    facing: HERO_FACING,
    moving: false,
    walkPhase: 0,
    isYou: false,
    connected: true,
    pose: { ...frame.pose, bob: 0 },
    ground: 'lit',
    named: false,
    layer: which,
  });
}

/**
 * Lays one frame of the hero on its canvas: sized to its box at the stage's density, each layer
 * drawn anew where what it shows has changed, and the two laid over each other where anything
 * has — the upper lifted by the breath, in whole pixels. Says whether the canvas changed.
 */
export function paintHero(hero: HeroCanvas, frame: HeroFrame): boolean {
  const { canvas, ctx } = hero;
  const w = Math.max(1, Math.round(frame.place.box.width * frame.dpr));
  const h = Math.max(1, Math.round(frame.place.box.height * frame.dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    hero.laid = null;
  }
  const at = anchorOf(frame);
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
  ctx.drawImage(hero.legs.canvas, 0, 0);
  ctx.drawImage(hero.upper.canvas, 0, -lift);
  return true;
}

/** Lets the hero's canvases go at once rather than whenever they are collected. */
export function freeHero(hero: HeroCanvas): void {
  for (const canvas of [hero.canvas, hero.legs.canvas, hero.upper.canvas]) {
    canvas.width = 0;
    canvas.height = 0;
  }
}

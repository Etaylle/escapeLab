import { drawScientist, HELD_SCALE, type EdgeLight, type FigureLayer, type Rim } from '../art.js';
import type { CanvasMaker } from '../atlas.js';
import { softEllipse } from '../brush.js';
import { HOLD, type FigurePose } from '../figure.js';
import { BLACK, css, lift, parseHex, sink, TUNGSTEN } from '../palette.js';
import { LAMP_RAISE, type HeroMotion, type HeroPlace, type StageBox } from './hero.js';
import { drawHandLamp } from './lampArt.js';

/**
 * The hero drawn (menu/hero.ts, screens/MenuHero.tsx): the crew figure as art.ts draws it, the
 * hand lamp in its hands (lampArt.ts), on a canvas of its own at the stage's density. It is laid
 * from two layers kept between frames — its legs with the shadow under them, and everything over
 * its legs drawn with the breath taken out (art.ts FigureLayer) — the upper laid as far up as the
 * breath has it, in whole pixels, and over them the light crossing its visor while it speaks. A
 * frame that changes no more than the breath and that light draws no figure anew: two copies and
 * the light's band, and only where the breath or the light has moved. A layer is drawn again only
 * where what it shows has changed — a glance, a wave, the lamp turned another step, the colour,
 * the size.
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
  /**
   * the lamp in its hands: turned `tilt` from straight ahead, its lens alight `on` and flaring
   * `flare`, each 0 to 1 at the steps the beam is laid at (lamp.ts `lightStep`)
   */
  lamp: { tilt: number; on: number; flare: number };
  /** its visor catches the glow of the item it looks at */
  glow: boolean;
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
 * Whether the light across the visor of `pose` is drawn within the upper layer: while the front
 * hand is raised to wave, which passes before the visor, over that light — and the wave draws the
 * layer anew on every frame anyway. Else the light is laid over the layers, moving on without
 * either drawn anew.
 */
function lightInLayer(pose: FigurePose): boolean {
  return (pose.arms?.front ?? 0) > HOLD.front;
}

/**
 * What layer `which` of `frame` shows, as a key: the canvas's size and anchor, the colour, and
 * of the pose what that layer draws — the breath left out, which the upper is laid by, and the
 * visor's light, laid over it but while the front hand waves.
 */
function layerKey(which: FigureLayer, frame: HeroFrame, size: string): string {
  const { pose } = frame;
  if (which === 'legs') {
    return `${size} ${frame.color} ${frame.motion.facing} ${pose.shadow}`;
  }
  const arms = pose.arms === null ? '-' : `${pose.arms.front},${pose.arms.back}`;
  const light = lightInLayer(pose) ? pose.shimmer : null;
  const parts = [pose.look, light, arms, pose.holding, pose.dim, pose.bow, frame.glow];
  const { tilt, on, flare } = frame.lamp;
  return `${size} ${frame.color} ${frame.motion.facing} ${parts.join(' ')} ${tilt} ${on} ${flare}`;
}

/**
 * The pose `layer` draws of `frame`'s: all of it whole; a layer without the breath, which the
 * upper is laid by — the upper without the visor's light, too, where that is laid over it.
 */
function poseOf(frame: HeroFrame, layer: FigureLayer): FigurePose {
  const { pose } = frame;
  if (layer === 'all') {
    return pose;
  }
  const lightApart = layer === 'upper' && !lightInLayer(pose);
  return { ...pose, bob: 0, shimmer: lightApart ? null : pose.shimmer };
}

/**
 * How far the hero's colour sinks in the lab at night (scene.ts `nightTo`): the lamp in its
 * hands, not the room, lights it.
 */
export const HERO_NIGHT = 0.35;
/** The lamp's warm light along the hero's front edge, toward the menu, at its strongest. */
export const FRONT_RIM: EdgeLight = { rgb: lift(TUNGSTEN, 0.15), alpha: 0.85 };
/** The glow of the item the hero looks at, as its visor catches it: the beam's warm light. */
export const VISOR_GLOW: EdgeLight = { rgb: lift(TUNGSTEN, 0.2), alpha: 0.55 };
/** The lab's cold light along its back edge, at its strongest; null for none. */
export const BACK_RIM: EdgeLight | null = null;

/** The hero's colour `color` in the lab at night (HERO_NIGHT). */
function nightColor(color: string): string {
  return css(sink(parseHex(color), HERO_NIGHT));
}

/** The light on the hero's edges with its lamp `on` of the way (0 to 1): the front's with it. */
function rimOf(on: number): Rim {
  const front = on <= 0 ? null : { ...FRONT_RIM, alpha: FRONT_RIM.alpha * on };
  return { front, back: BACK_RIM };
}

/** The figure as `frame` has it, drawn on `ctx` whole or as `layer` says, its feet at `at`. */
function drawFigure(ctx: CanvasRenderingContext2D, frame: HeroFrame, layer: FigureLayer): void {
  const { tilt, on, flare } = frame.lamp;
  const { motion } = frame;
  drawScientist(ctx, {
    color: nightColor(frame.color),
    name: '',
    facing: motion.facing,
    moving: motion.moving,
    walkPhase: motion.walk,
    isYou: false,
    connected: true,
    pose: poseOf(frame, layer),
    ground: 'lit',
    named: false,
    layer,
    held: (held) => {
      held.translate(0, -LAMP_RAISE.up / HELD_SCALE);
      drawHandLamp(held, tilt, on, flare);
    },
    rim: rimOf(on),
    visorGlow: frame.glow ? VISOR_GLOW : null,
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
 * Lays the hero's canvas `w` × `h` from its layers, its feet anchored at `at`: the legs, the
 * upper lifted by the breath in whole pixels, and over them the light across the visor where it
 * is laid apart (lightInLayer) — as the upper layer would hold it, lifted alike. Only where any
 * of it has changed since the canvas was laid last; says whether it was laid.
 */
function layCanvas(
  hero: HeroCanvas,
  frame: HeroFrame,
  [w, h, at]: readonly [number, number, Anchor],
): boolean {
  const lift = Math.round(frame.pose.bob * at.s);
  const light = lightInLayer(frame.pose) ? null : frame.pose.shimmer;
  const laid = `${hero.legs.key} ${hero.upper.key} ${lift} ${light}`;
  if (laid === hero.laid) {
    return false;
  }
  hero.laid = laid;
  const { ctx } = hero;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(hero.legs.canvas, 0, hero.legs.top);
  ctx.drawImage(hero.upper.canvas, 0, hero.upper.top - lift);
  if (light !== null) {
    ctx.setTransform(at.s, 0, 0, at.s, at.x, at.y - lift);
    drawFigure(ctx, frame, 'shimmer');
  }
  return true;
}

/**
 * Lays one frame of the hero on its canvas: sized to its box at the stage's density; walking,
 * drawn whole; standing, each layer drawn anew where what it shows has changed, and the canvas
 * laid from them where anything has (layCanvas). Says whether the canvas changed.
 */
export function paintHero(hero: HeroCanvas, frame: HeroFrame): boolean {
  const { canvas } = hero;
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
  return layCanvas(hero, frame, [w, h, at]);
}

/**
 * Lets the hero's canvases go at once — its own and its two layers — rather than whenever they
 * are collected, and forgets what they showed: painted again, it lays them anew.
 */
export function freeHero(hero: HeroCanvas): void {
  for (const canvas of [hero.canvas, hero.legs.canvas, hero.upper.canvas]) {
    canvas.width = 0;
    canvas.height = 0;
  }
  hero.legs.key = null;
  hero.upper.key = null;
  hero.laid = null;
}

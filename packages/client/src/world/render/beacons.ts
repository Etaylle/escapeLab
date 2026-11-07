import type { Sight } from '@escapelab/core';
import type { CanvasMaker } from '../atlas.js';
import {
  BEACON_TINT,
  beaconAngle,
  beaconPhase,
  BLOOM_REACH,
  BLOOM_RGB,
  LOBE_HALF,
  LOBE_REACH,
  LOBE_SPREAD,
  lobesOut,
} from '../beacon.js';
import { TAU } from '../brush.js';
import { EMERGENCY, rgba } from '../palette.js';
import { toScreen, type Frame, type FrameLit } from './frame.js';
import { drawRadial, type RadialStops } from './radial.js';

/**
 * The emergency lamps' beacons on the Canvas pass (world/beacon.ts): over the darkness each lamp
 * burning in view adds its two turning lobes of red and a soft red bloom round its lens — the
 * light layer lights the lobes itself (gl/sources.ts). A lobe is laid from a sprite baked once
 * for each of LOBE_STEPS steps of a turn at the frame's zoom, in the box round its own wedge, and
 * copied at whole pixels: turning a sprite as it is drawn, or filling a gradient wedge, costs the
 * software canvas several times as much as the copy (measured in docs/art-bible.md). Each lamp's
 * lobes keep to the box its light can see, so that no wall lets them through to the room behind
 * it. The lobes only add their red: the floor in their path is lit red, not cut out of the dark.
 */

/** How many steps of a turn a lobe is baked at: 3.75° apart. */
export const LOBE_STEPS = 96;
/** How strongly the lobes are laid on. */
export const LOBE_ALPHA = 0.9;
/**
 * The layers a lobe is baked of, each as wide as its share of LOBE_HALF — the widest out to its
 * spread (beacon.ts) — and as strong as its share of the light: added up, the lobe fades toward
 * its edges instead of ending at a line.
 */
const LAYERS: readonly (readonly [width: number, share: number])[] = [
  [LOBE_SPREAD / LOBE_HALF, 0.2],
  [1, 0.3],
  [0.65, 0.3],
  [0.3, 0.2],
];
/** The bloom round a burning lens: hot in the middle, out to BLOOM_REACH tiles. */
const BLOOM_STOPS: RadialStops = [
  [0, BLOOM_RGB, 0.34],
  [0.4, EMERGENCY, 0.12],
  [1, EMERGENCY, 0],
];

/** A lobe as baked: its canvas, and where its top-left lies from its lamp, device pixels. */
export interface Lobe {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
}

/** The lobes baked so far for one zoom, by step; a step not needed yet is not baked. */
export interface LobeSprites {
  scale: number;
  lobes: (Lobe | undefined)[];
}

/** The step of a turn nearest `angle`, 0 to LOBE_STEPS - 1. */
export function lobeStep(angle: number): number {
  const step = Math.round((angle / TAU) * LOBE_STEPS) % LOBE_STEPS;
  return step < 0 ? step + LOBE_STEPS : step;
}

/** The box of whole pixels round a lobe pointing at `angle`, `r` px long, from its lamp. */
function lobeBox(angle: number, r: number): { left: number; top: number; w: number; h: number } {
  const spread = LOBE_SPREAD;
  const xs = [0];
  const ys = [0];
  for (let k = 0; k <= 8; k++) {
    const t = angle - spread + (2 * spread * k) / 8;
    xs.push(Math.cos(t) * r);
    ys.push(Math.sin(t) * r);
  }
  const left = Math.floor(Math.min(...xs)) - 1;
  const top = Math.floor(Math.min(...ys)) - 1;
  return {
    left,
    top,
    w: Math.ceil(Math.max(...xs)) + 1 - left,
    h: Math.ceil(Math.max(...ys)) + 1 - top,
  };
}

/** Bakes the lobe of step `step` at `scale` device pixels a tile, on a canvas from `make`. */
export function bakeLobe(make: CanvasMaker, step: number, scale: number): Lobe {
  const angle = (step / LOBE_STEPS) * TAU;
  const r = LOBE_REACH * scale;
  const { left, top, w, h } = lobeBox(angle, r);
  const canvas = make(w, h);
  const g = canvas.getContext('2d');
  if (g === null) {
    throw new Error('beacons: canvas.getContext("2d") returned null; cannot bake a lobe.');
  }
  g.translate(-left, -top);
  g.globalCompositeOperation = 'lighter';
  for (const [width, share] of LAYERS) {
    const gradient = g.createRadialGradient(0, 0, 0, 0, 0, r);
    for (const [offset, rgb, alpha] of BEACON_TINT) {
      gradient.addColorStop(offset, rgba(rgb, alpha * share));
    }
    g.fillStyle = gradient;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, r, angle - LOBE_HALF * width, angle + LOBE_HALF * width);
    g.closePath();
    g.fill();
  }
  return { canvas, x: left, y: top };
}

/** The lobe pointing nearest `angle` at `scale`, baked on its first use; a new zoom bakes anew. */
function lobeAt(frame: Frame, angle: number): Lobe {
  const { kit, camera } = frame;
  if (kit.beacons?.scale !== camera.scale) {
    kit.beacons = { scale: camera.scale, lobes: [] };
  }
  const step = lobeStep(angle);
  const known = kit.beacons.lobes[step];
  if (known !== undefined) {
    return known;
  }
  const baked = bakeLobe(kit.art.atlas.make, step, camera.scale);
  kit.beacons.lobes[step] = baked;
  return baked;
}

/** What a lamp's light sees, as a box of tiles: its floor and the walls it lights whole. */
const sightBoxes = new WeakMap<Sight, { x0: number; y0: number; x1: number; y1: number }>();

/** The box of tiles round all a lamp's light can see: its floor's outline and its walls. */
export function sightBox(sight: Sight): { x0: number; y0: number; x1: number; y1: number } {
  const known = sightBoxes.get(sight);
  if (known !== undefined) {
    return known;
  }
  const xs = sight.outline.map((spot) => spot.x);
  const ys = sight.outline.map((spot) => spot.y);
  for (const key of sight.walls) {
    const [x = 0, y = 0] = key.split(',').map(Number);
    xs.push(x, x + 1);
    ys.push(y, y + 1);
  }
  const box =
    xs.length === 0
      ? { x0: 0, y0: 0, x1: 0, y1: 0 }
      : { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  sightBoxes.set(sight, box);
  return box;
}

/** Whether a beacon at (sx, sy) on the canvas, its lobes `r` px long, lies off it altogether. */
function offCanvas(frame: Frame, sx: number, sy: number, r: number): boolean {
  const { w, h } = frame.viewport;
  return sx + r < 0 || sy + r < 0 || sx - r > w || sy - r > h;
}

/**
 * The lobes `lobes` of one beacon over `ctx`, kept to the box its light `lit` sees, at whole
 * pixels.
 */
function drawLobes(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  lit: FrameLit,
  lobes: readonly number[],
): void {
  const box = sightBox(lit.sight);
  const [left, top] = toScreen(frame, box.x0, box.y0);
  const [right, bottom] = toScreen(frame, box.x1, box.y1);
  const [sx, sy] = toScreen(frame, lit.lamp.x, lit.lamp.y);
  ctx.save();
  ctx.beginPath();
  ctx.rect(Math.round(left), Math.round(top), Math.round(right - left), Math.round(bottom - top));
  ctx.clip();
  for (const facing of lobes) {
    const lobe = lobeAt(frame, facing);
    ctx.drawImage(lobe.canvas, Math.round(sx) + lobe.x, Math.round(sy) + lobe.y);
  }
  ctx.restore();
}

/**
 * The beacons of the lamps burning in view over `ctx` (render/light.ts, the Canvas pass): each
 * lamp's lobes as far as it has turned — those reaching out into the room (beacon.ts
 * `lobesOut`) — and the bloom round its lens, as brightly as the lamps burn. A frame with no
 * lamp burning lets the baked lobes go.
 */
export function drawBeacons(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const { lamps } = frame.light;
  if (lamps.length === 0) {
    frame.kit.beacons = null;
    return;
  }
  const s = frame.camera.scale;
  const ms = frame.time * 1000;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  for (const { mount, lit } of lamps) {
    const [sx, sy] = toScreen(frame, mount.x, mount.y);
    if (offCanvas(frame, sx, sy, LOBE_REACH * s)) {
      continue;
    }
    ctx.globalAlpha = LOBE_ALPHA;
    const angle = beaconAngle(ms, beaconPhase(mount), frame.reduced);
    drawLobes(ctx, frame, lit, lobesOut(mount, angle));
    ctx.globalAlpha = frame.burn;
    drawRadial(ctx, frame.kit.radials, BLOOM_STOPS, [sx, sy, BLOOM_REACH * s], frame);
  }
  ctx.restore();
}

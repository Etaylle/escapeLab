import type { CanvasMaker } from '../atlas.js';
import { beamAcross, beamSpread, GLOW_RGB } from '../beam.js';
import { roundRectPath, TAU } from '../brush.js';
import { OWN_BEAM_STOPS } from '../light.js';
import {
  BLACK,
  css,
  GLASS,
  INK,
  lift,
  mix,
  rgba,
  sink,
  STEEL,
  TUNGSTEN,
  WHITE,
} from '../palette.js';
import {
  newParticles,
  particleAlpha,
  inCone,
  stepParticles,
  STILL_AIR,
  type Particles,
} from '../particles.js';
import { acrossStops } from '../render/beam.js';
import { stepped } from './hero.js';
import { BEAM_STEP, LENS_AHEAD, lightStep, type HeroLamp } from './lamp.js';

/**
 * The hand lamp drawn (menu/lamp.ts): in the hero's hands, a steel torch whose lens burns warm
 * while it is on; and its beam over the menu's lab, on the scene's canvas, under the menu and
 * its vignette — a soft cone of the lamp's warm light, its core along its axis, fading out along
 * its reach, the dust motes of the world's air drifting in it (particles.ts). The beam is turned
 * once for each degree of its sweep from a sprite baked once for its reach — a conic gradient
 * across, the lamp's falloff along (render/beam.ts profiles the world's beams so) — and laid
 * each frame whole at whole pixels, the copy the software canvas makes fastest: laid over the lab
 * as a haze of the lamp's light, which over a lab at night looks as light added onto it would, at
 * a fifth less of the beam's cost.
 */

/**
 * The menu's beam: as wide as this either way of its axis before its edge fades, radians — a
 * little wider than the world's, held there by its cost, which grows with the cone's pixels.
 */
export const BEAM_HALF = 0.22;
/**
 * How strong its light is at its strongest, on the core near the lens, laid over the lab at
 * night: a warm haze the dust hangs in.
 */
export const BEAM_LIGHT = 0.6;
/** How strong the flare's second light over the beam is at its strongest, against the first. */
export const FLARE_LIGHT = 0.9;
/** The dust in the beam: the world's (render/atmosphere.ts), lit by the lamp in the dark. */
const MOTE: readonly [number, number, number] = lift(TUNGSTEN, 0.4);
const MOTE_ALPHA = 0.9;
/**
 * How much larger a mote shows than in the world, its sprite soft to its rim: the menu's lab
 * stands nearer the eye.
 */
const MOTE_SCALE = 4;

const BARREL = css(sink(STEEL, 0.35));
const HEAD = css(sink(STEEL, 0.12));
const RIM = css(INK);
const SHEEN = rgba(WHITE, 0.22);
const LENS_OFF = css(sink(mix(STEEL, GLASS, 0.5), 0.3));
const LENS_ON = css(lift(TUNGSTEN, 0.55));
/** The glint at a lens alight: white in its middle, the lamp's warm light round it. */
const GLINT = { reach: 0.14, middle: rgba(WHITE, 0.9), warm: rgba(TUNGSTEN, 0.55) } as const;

/**
 * The torch in the hands, drawn as art.ts draws what a figure holds — round its grip, pointing
 * ahead, in its own units — turned `tilt` up or down from straight ahead, its lens alight `on`
 * of the way (0 to 1), its glint grown as far again as it flares (`flare`, 0 to 1).
 */
export function drawHandLamp(
  ctx: CanvasRenderingContext2D,
  tilt: number,
  on: number,
  flare = 0,
): void {
  ctx.save();
  ctx.rotate(tilt);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 0.045;
  ctx.strokeStyle = RIM;
  ctx.beginPath();
  roundRectPath(ctx, -0.27, -0.055, 0.32, 0.11, 0.04);
  ctx.fillStyle = BARREL;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  roundRectPath(ctx, 0.04, -0.085, 0.15, 0.17, 0.035);
  ctx.fillStyle = HEAD;
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = SHEEN;
  ctx.fillRect(-0.24, -0.04, 0.26, 0.022);
  ctx.beginPath();
  ctx.ellipse(LENS_AHEAD - 0.03, 0, 0.026, 0.07, 0, 0, TAU);
  ctx.fillStyle = on > 0 ? LENS_ON : LENS_OFF;
  ctx.fill();
  if (on > 0) {
    drawGlint(ctx, on, GLINT.reach * (1 + flare));
  }
  ctx.restore();
}

/** The glint of a lens alight, `on` of its strength: a hot spot over the lens, `reach` round. */
function drawGlint(ctx: CanvasRenderingContext2D, on: number, reach: number): void {
  const glint = ctx.createRadialGradient(LENS_AHEAD, 0, 0, LENS_AHEAD, 0, reach);
  glint.addColorStop(0, GLINT.middle);
  glint.addColorStop(0.3, GLINT.warm);
  glint.addColorStop(1, rgba(TUNGSTEN, 0));
  ctx.globalAlpha *= on;
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = glint;
  ctx.fillRect(LENS_AHEAD - reach, -reach, 2 * reach, 2 * reach);
}

/** A canvas a beam was baked on, and its corner from the lens it shines from, device px. */
interface Baked {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  /** what it was baked for: the master's reach, a turn's step and the master it came from */
  key: string;
}

/** The menu's beam as the scene keeps it between frames: its master, its turn, its dust. */
export interface SceneBeam {
  make: CanvasMaker;
  /** the beam pointing right, as long as the lamp reaches, baked once for its reach */
  master: Baked | null;
  /** the master turned to the step the beam points at */
  turned: Baked | null;
  dust: Particles;
  /** a mote's sprite, baked as the first mote shows; null before */
  mote: HTMLCanvasElement | null;
  /** how often the beam was turned anew, for the walkthrough's probe */
  turns: number;
}

/** The beam of a scene that lays none yet, its canvases made by `make`. */
export function sceneBeam(make: CanvasMaker): SceneBeam {
  return { make, master: null, turned: null, dust: newParticles(7), mote: null, turns: 0 };
}

/** How far either way of its axis the beam casts any light, radians. */
const SPREAD = beamSpread(BEAM_HALF);

/** The 2D context of `canvas`, there by the canvas's word. */
function drawOn(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('menu beam: canvas.getContext("2d") returned null; cannot bake the beam.');
  }
  return ctx;
}

/**
 * The beam pointing right from a lens at its canvas's left middle, `r` device px long, on a
 * canvas from `make`: a conic gradient across — the core and its flanks (world/beam.ts) — of the
 * lamp's warm light at BEAM_LIGHT, cut down along its reach as your lamp's beam falls off.
 */
function bakeMaster(make: CanvasMaker, r: number): Baked {
  const h = Math.ceil(2 * r * Math.sin(SPREAD)) + 2;
  const canvas = make(Math.ceil(r) + 1, h);
  const g = drawOn(canvas);
  const across = g.createConicGradient(-Math.PI, 0, h / 2);
  for (const [offset, share] of acrossStops(BEAM_HALF, (off) => beamAcross(off, BEAM_HALF))) {
    across.addColorStop(offset, rgba(GLOW_RGB, share * BEAM_LIGHT));
  }
  g.fillStyle = across;
  g.fillRect(0, 0, canvas.width, h);
  g.globalCompositeOperation = 'destination-in';
  const along = g.createRadialGradient(0, h / 2, 0, 0, h / 2, r);
  for (const [offset, depth] of OWN_BEAM_STOPS) {
    along.addColorStop(offset, rgba(BLACK, depth));
  }
  g.fillStyle = along;
  g.fillRect(0, 0, canvas.width, h);
  return { canvas, x: 0, y: -h / 2, key: `${Math.round(r)}` };
}

/** How many points along its arc a beam's box is found from. */
const ARC_POINTS = 12;

/**
 * The box of whole device px round a beam `r` long pointing at `angle` from its lens: the lens
 * and its arc — what the beam lights, and no more — so that a beam pointing on the slant is laid
 * from a box no larger than one pointing straight across.
 */
function wedgeBox(angle: number, r: number): { x: number; y: number; w: number; h: number } {
  const xs = [0];
  const ys = [0];
  for (let k = 0; k <= ARC_POINTS; k++) {
    const t = angle - SPREAD + (2 * SPREAD * k) / ARC_POINTS;
    xs.push(Math.cos(t) * r);
    ys.push(Math.sin(t) * r);
  }
  const x = Math.floor(Math.min(...xs)) - 1;
  const y = Math.floor(Math.min(...ys)) - 1;
  return { x, y, w: Math.ceil(Math.max(...xs)) + 1 - x, h: Math.ceil(Math.max(...ys)) + 1 - y };
}

/**
 * `master` turned `angle` about its lens onto `into` — a canvas sized to its box — or a new one;
 * sampled without smoothing, which a light this soft does not show and the software canvas
 * turns faster.
 */
function turnMaster(make: CanvasMaker, master: Baked, angle: number, into: Baked | null): Baked {
  const box = wedgeBox(angle, master.canvas.width - 1);
  const canvas = into?.canvas ?? make(box.w, box.h);
  if (canvas.width !== box.w || canvas.height !== box.h) {
    canvas.width = box.w;
    canvas.height = box.h;
  }
  const g = drawOn(canvas);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, box.w, box.h);
  g.translate(-box.x, -box.y);
  g.rotate(angle);
  g.imageSmoothingEnabled = false;
  g.drawImage(master.canvas, 0, master.y);
  g.imageSmoothingEnabled = true;
  return { canvas, x: box.x, y: box.y, key: `${master.key} ${angle}` };
}

/**
 * The beam of `lamp` at a density of `dpr`, from `beam`'s sprites: the master baked anew for a
 * new reach, turned anew for a new step of the sweep; null where it reaches nowhere.
 */
function turnedFor(beam: SceneBeam, lamp: HeroLamp, dpr: number): Baked | null {
  const r = Math.round(lamp.reach * dpr);
  if (r < 2) {
    return null;
  }
  if (beam.master?.key !== `${r}`) {
    if (beam.master !== null) {
      beam.master.canvas.width = 0;
      beam.master.canvas.height = 0;
    }
    beam.master = bakeMaster(beam.make, r);
  }
  const angle = stepped(lamp.angle, BEAM_STEP);
  if (beam.turned?.key !== `${beam.master.key} ${angle}`) {
    beam.turned = turnMaster(beam.make, beam.master, angle, beam.turned);
    beam.turns += 1;
  }
  return beam.turned;
}

/** What the scene's frame lays the beam by: its density, a scene tile, the clock, the motion. */
export interface BeamFrame {
  /** device px a CSS px of the scene's canvas */
  dpr: number;
  /** a scene tile, CSS px: the dust's size and drift are the world's, in tiles */
  tile: number;
  /** the page's clock, ms */
  now: number;
  /** less motion asked for: no dust drifts */
  reduced: boolean;
}

/**
 * Lays the beam of the hero's `lamp` over `ctx` — the scene's canvas, the lab copied on it — at
 * whole pixels, as strong as the lamp is on, and the dust drifting in it. Without a lamp alight
 * it lays nothing and lets its canvases go: no hero stands on the stage, or the menu has gone for
 * the lobby, whose scene drifts on.
 */
export function layBeam(
  ctx: CanvasRenderingContext2D,
  beam: SceneBeam,
  lamp: HeroLamp | null,
  frame: BeamFrame,
): void {
  if (lamp === null || lamp.on <= 0) {
    freeBeam(beam);
    return;
  }
  const turned = turnedFor(beam, lamp, frame.dpr);
  if (turned === null) {
    return;
  }
  const x = Math.round(lamp.x * frame.dpr) + turned.x;
  const y = Math.round(lamp.y * frame.dpr) + turned.y;
  ctx.globalAlpha = lamp.on;
  ctx.drawImage(turned.canvas, x, y);
  if (lamp.flare > 0) {
    ctx.globalAlpha = lightStep(lamp.flare) * FLARE_LIGHT;
    ctx.drawImage(turned.canvas, x, y);
    ctx.globalAlpha = lamp.on;
  }
  layDust(ctx, beam, lamp, frame);
  ctx.globalAlpha = 1;
}

/** How wide a mote's sprite is baked, device px: a soft round speck, drawn at a mote's size. */
const MOTE_SPRITE = 16;

/** A mote's sprite on a canvas from `make`: a speck of the lamp's light, soft to its rim. */
function bakeMote(make: CanvasMaker): HTMLCanvasElement {
  const canvas = make(MOTE_SPRITE, MOTE_SPRITE);
  const g = drawOn(canvas);
  const r = MOTE_SPRITE / 2;
  const glow = g.createRadialGradient(r, r, 0, r, r, r);
  glow.addColorStop(0, rgba(MOTE, 1));
  glow.addColorStop(0.3, rgba(MOTE, 0.7));
  glow.addColorStop(1, rgba(MOTE, 0));
  g.fillStyle = glow;
  g.fillRect(0, 0, MOTE_SPRITE, MOTE_SPRITE);
  return canvas;
}

/**
 * The dust in the beam: the motes of the world's air (particles.ts), born in the cone and
 * drifting slowly, in scene tiles, each a soft speck of the lamp's light shown only inside the
 * cone, as strong as the lamp is on; under reduced motion none.
 */
function layDust(
  ctx: CanvasRenderingContext2D,
  beam: SceneBeam,
  lamp: HeroLamp,
  { dpr, tile, now, reduced }: BeamFrame,
): void {
  if (reduced || tile <= 0) {
    return;
  }
  const cone = {
    x: lamp.x / tile,
    y: lamp.y / tile,
    facing: lamp.angle,
    halfAngle: BEAM_HALF,
    reach: lamp.reach / tile,
  };
  stepParticles(beam.dust, now / 1000, { ...STILL_AIR, cones: [cone] });
  const sprite = (beam.mote ??= bakeMote(beam.make));
  const px = tile * dpr;
  for (const mote of beam.dust.live) {
    if (mote.kind === 'dust' && inCone(cone, mote.x, mote.y)) {
      const size = mote.size * MOTE_SCALE * px;
      ctx.globalAlpha = lamp.on * MOTE_ALPHA * particleAlpha(mote);
      ctx.drawImage(sprite, mote.x * px - size / 2, mote.y * px - size / 2, size, size);
    }
  }
}

/** Lets the beam's canvases go at once. */
export function freeBeam(beam: SceneBeam): void {
  for (const baked of [beam.master, beam.turned]) {
    if (baked !== null) {
      baked.canvas.width = 0;
      baked.canvas.height = 0;
    }
  }
  if (beam.mote !== null) {
    beam.mote.width = 0;
    beam.mote.height = 0;
  }
  beam.master = null;
  beam.turned = null;
  beam.mote = null;
}

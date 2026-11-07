import type { CanvasMaker } from '../atlas.js';
import { dressedFor } from '../artKit.js';
import {
  BEAM_STEPS,
  beamAcross,
  beamSpread,
  beamStep,
  clearAlong,
  CORE_EDGE,
  CORE_GLOW,
  CORE_HALF,
  coreAcross,
  CREW_BEAM,
  glossy,
  GLOW_REACH,
  GLOW_RGB,
  STREAK,
} from '../beam.js';
import { TAU } from '../brush.js';
import { BEAM_REACH } from '../frameLight.js';
import { OWN_BEAM_STOPS, type Lamp } from '../light.js';
import { BLACK, lift, rgba, TUNGSTEN, WHITE, type Rgb } from '../palette.js';
import { inTiles, toScreen, type Frame, type FrameLit } from './frame.js';
import { drawRadial, type RadialStops } from './radial.js';

/**
 * A flashlight's beam on the Canvas pass (world/beam.ts): cut into the darkness from a sprite
 * baked once for each of BEAM_STEPS steps of a turn at the frame's zoom — its core, its flanks
 * and its soft edge across, its falloff along — at half the picture's resolution, the light
 * soft all over, and laid on scaled up at whole pixels without smoothing: the software canvas
 * lays a sprite scaled so as fast as one copied, where smoothing it costs it a third more, and
 * a wedge clipped and filled every frame as much again (docs/art-bible.md). A beam shorter than
 * your lamp's (the crew's, CREW_REACH) is your lamp's sprite laid smaller. Your core's warm
 * light goes into the darkness's canvas right after, from a second sprite of the same bake:
 * laid over the picture with the darkness, where the lamp sees, at no cost to the picture. Over
 * the light, on either path: the glint at each lamp's lens, and the streak a beam leaves on a
 * shining floor.
 */

/** How many times smaller than the picture a beam is baked. */
const SHRINK = 2;
/** How many baked beams are kept: the one laid longest ago goes first. */
const KEEP = 24;
/** How many points across a beam its profile is baked from. */
const ACROSS = 24;

/** A canvas baked for a beam, and its box from the beam's lamp, device pixels. */
export interface Baked {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A beam as baked: what it cuts out of the dark, and its core's warm light in a narrower box. */
export interface BeamSprite {
  cut: Baked;
  glow: Baked;
}

/** The beams baked so far for one zoom and half-angle, by step, the latest drawn last. */
export interface BeamSprites {
  scale: number;
  half: number;
  steps: Map<number, BeamSprite>;
}

/** The box of whole pixels round a beam pointing at `angle`, `r` px long and `spread` wide. */
function beamBox(angle: number, r: number, spread: number): Omit<Baked, 'canvas'> {
  const xs = [0];
  const ys = [0];
  for (let k = 0; k <= 12; k++) {
    const t = angle - spread + (2 * spread * k) / 12;
    xs.push(Math.cos(t) * r);
    ys.push(Math.sin(t) * r);
  }
  const x = Math.floor(Math.min(...xs)) - 1;
  const y = Math.floor(Math.min(...ys)) - 1;
  return { x, y, w: Math.ceil(Math.max(...xs)) + 1 - x, h: Math.ceil(Math.max(...ys)) + 1 - y };
}

/**
 * A profile across a beam `half` wide — `across` of the angle off its axis — as a conic
 * gradient's stops round its lamp, its axis at 0.5.
 */
export function acrossStops(
  half: number,
  across: (off: number) => number = (off) => beamAcross(off, half),
): [offset: number, share: number][] {
  const spread = beamSpread(half);
  const stops: [number, number][] = [[0, 0]];
  for (let k = 0; k <= ACROSS; k++) {
    const off = -spread + (2 * spread * k) / ACROSS;
    stops.push([0.5 + off / TAU, across(off)]);
  }
  stops.push([1, 0]);
  return stops;
}

/** A beam pointing at `angle`, `r` device pixels long, baked in `box`. */
interface Baking {
  angle: number;
  r: number;
  box: Omit<Baked, 'canvas'>;
}

/**
 * Bakes one profile of the beam `baking` on a canvas from `make`, SHRINK times smaller:
 * `stops` across as a conic gradient of `rgb`, `scale`d, cut down along its reach by your
 * lamp's falloff (light.ts OWN_BEAM_STOPS).
 */
function bakeProfile(
  make: CanvasMaker,
  { angle, r, box }: Baking,
  [stops, rgb, scale]: readonly [[number, number][], Rgb, number],
): Baked {
  const shrunk = (side: number): number => Math.max(1, Math.ceil(side / SHRINK));
  const canvas = make(shrunk(box.w), shrunk(box.h));
  const g = canvas.getContext('2d');
  if (g === null) {
    throw new Error('beam: canvas.getContext("2d") returned null; cannot bake a beam.');
  }
  g.scale(1 / SHRINK, 1 / SHRINK);
  g.translate(-box.x, -box.y);
  const across = g.createConicGradient(angle - Math.PI, 0, 0);
  for (const [offset, share] of stops) {
    across.addColorStop(offset, rgba(rgb, share * scale));
  }
  g.fillStyle = across;
  g.fillRect(box.x, box.y, box.w, box.h);
  g.globalCompositeOperation = 'destination-in';
  const along = g.createRadialGradient(0, 0, 0, 0, 0, r);
  for (const [offset, depth] of OWN_BEAM_STOPS) {
    along.addColorStop(offset, rgba(BLACK, depth));
  }
  g.fillStyle = along;
  g.fillRect(box.x, box.y, box.w, box.h);
  return { canvas, ...box };
}

/**
 * Bakes the beam of step `step`, `reach` tiles long and `half` radians wide either way, at
 * `scale` device pixels a tile, on canvases from `make`: what it cuts out of the darkness, and
 * its core's warm light (CORE_GLOW of GLOW_RGB) in a box only as wide as its core, and
 * GLOW_REACH of its reach long.
 */
export function bakeBeam(
  make: CanvasMaker,
  step: number,
  [scale, reach, half]: readonly [number, number, number],
): BeamSprite {
  const angle = (step / BEAM_STEPS) * TAU;
  const r = reach * scale;
  const cut = bakeProfile(make, { angle, r, box: beamBox(angle, r, beamSpread(half)) }, [
    acrossStops(half),
    BLACK,
    1,
  ]);
  const core = { angle, r, box: beamBox(angle, r * GLOW_REACH, CORE_HALF + CORE_EDGE) };
  const glow = bakeProfile(make, core, [acrossStops(half, coreAcross), GLOW_RGB, CORE_GLOW]);
  return { cut, glow };
}

/**
 * Your lamp's beam (BEAM_REACH long) pointing nearest `beam`'s facing at the frame's zoom, as
 * wide as `beam`: baked on first use.
 */
function beamAt(frame: Frame, beam: NonNullable<Lamp['beam']>): BeamSprite {
  const { kit, camera } = frame;
  const { halfAngle: half } = beam;
  const known = kit.beams;
  const same = known?.scale === camera.scale && known.half === half;
  const sprites = same ? known : { scale: camera.scale, half, steps: new Map() };
  kit.beams = sprites;
  const step = beamStep(beam.facing);
  const bake = (): BeamSprite =>
    bakeBeam(kit.art.atlas.make, step, [camera.scale, BEAM_REACH, half]);
  const baked = sprites.steps.get(step) ?? bake();
  // The step drawn last moves to the end; past KEEP the one drawn longest ago goes.
  sprites.steps.delete(step);
  sprites.steps.set(step, baked);
  if (sprites.steps.size > KEEP) {
    const oldest = sprites.steps.keys().next();
    if (oldest.done !== true) {
      sprites.steps.delete(oldest.value);
    }
  }
  return baked;
}

/** Whether a light `r` px round (sx, sy) lies off the canvas of `frame` altogether. */
function offCanvas(frame: Frame, sx: number, sy: number, r: number): boolean {
  const { w, h } = frame.viewport;
  return sx + r < 0 || sy + r < 0 || sx - r > w || sy - r > h;
}

/**
 * Cuts the beam of `lamp` into the darkness of `cut` from its sprite, `alpha` deep, at whole
 * pixels — where `warm`, laying its core's warm light into the darkness after; `cut`'s
 * transform has to be the canvas's own, its compositing the darkness's cut, which it leaves so.
 */
export function cutBeam(
  cut: CanvasRenderingContext2D,
  frame: Frame,
  lamp: Lamp,
  [alpha, warm]: readonly [number, boolean],
): void {
  const { beam } = lamp;
  if (beam === null) {
    return;
  }
  const [sx, sy] = toScreen(frame, lamp.x, lamp.y);
  if (offCanvas(frame, sx, sy, beam.reach * frame.camera.scale)) {
    return;
  }
  const sprite = beamAt(frame, beam);
  const k = beam.reach / BEAM_REACH;
  const lay = ({ canvas, x, y, w, h }: Baked): void => {
    const [left, top] = [Math.round(sx + x * k), Math.round(sy + y * k)];
    cut.drawImage(canvas, left, top, Math.round(w * k), Math.round(h * k));
  };
  const cutting = cut.globalCompositeOperation;
  cut.imageSmoothingEnabled = false;
  cut.globalAlpha = alpha;
  lay(sprite.cut);
  if (warm) {
    cut.globalCompositeOperation = 'source-over';
    lay(sprite.glow);
    cut.globalCompositeOperation = cutting;
  }
  cut.globalAlpha = 1;
  cut.imageSmoothingEnabled = true;
}

/** How far ahead of the hand the lens sits, tiles, and how far its glint reaches. */
const LENS = { ahead: 0.1, glint: 0.3 } as const;
/** The glint at a lamp's lens: white in the middle, warm round it. */
const GLINT_STOPS: RadialStops = [
  [0, WHITE, 0.85],
  [0.2, lift(TUNGSTEN, 0.5), 0.45],
  [1, TUNGSTEN, 0],
];
/** The streak on a shining floor: faint, warm white, fading out along and across. */
const STREAK_TINT = lift(TUNGSTEN, 0.6);
const STREAK_STOPS = [
  [0, 0.16],
  [0.55, 0.06],
  [1, 0],
] as const;

/** The glint at the lens of `lamp`, `alpha` strong: a small hot spot just ahead of the hand. */
function drawGlint(ctx: CanvasRenderingContext2D, frame: Frame, lamp: Lamp, alpha: number): void {
  const facing = lamp.beam?.facing ?? 0;
  const x = lamp.x + Math.cos(facing) * LENS.ahead;
  const y = lamp.y + Math.sin(facing) * LENS.ahead;
  const [sx, sy] = toScreen(frame, x, y);
  ctx.globalAlpha = alpha;
  drawRadial(ctx, frame.kit.radials, GLINT_STOPS, [sx, sy, LENS.glint * frame.camera.scale], frame);
}

/**
 * Whether the beam of `lit` leaves a streak: the floor half way along it shines (world/beam.ts
 * `glossy`), and it reaches far enough along the beam, in its lamp's sight, to show one.
 */
export function streakOf(frame: Frame, { lamp, sight }: FrameLit): number | null {
  const { beam } = lamp;
  if (beam === null) {
    return null;
  }
  const end = clearAlong(sight, { x: lamp.x, y: lamp.y, facing: beam.facing }, STREAK.to);
  if (end - STREAK.from < 1) {
    return null;
  }
  const mid = (STREAK.from + end) / 2;
  const x = Math.floor(lamp.x + Math.cos(beam.facing) * mid);
  const y = Math.floor(lamp.y + Math.sin(beam.facing) * mid);
  const { width, height } = frame.map;
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return null;
  }
  const { dressing } = dressedFor(frame.kit.art, frame.map, frame.missionId);
  return glossy(dressing.kinds[y * width + x]) ? end : null;
}

/** The streak along the beam of `lamp` out to `end` tiles, `alpha` strong, added over `ctx`. */
function drawStreak(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  lamp: Lamp,
  [end, alpha]: readonly [number, number],
): void {
  const facing = lamp.beam?.facing ?? 0;
  const half = (end - STREAK.from) / 2;
  inTiles(ctx, frame);
  ctx.translate(lamp.x, lamp.y);
  ctx.rotate(facing);
  ctx.translate(STREAK.from + half, 0);
  ctx.scale(half, STREAK.width / 2);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  for (const [offset, a] of STREAK_STOPS) {
    gradient.addColorStop(offset, rgba(STREAK_TINT, a));
  }
  ctx.globalAlpha = alpha;
  ctx.fillStyle = gradient;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/**
 * The flashlights' flares over the light (render/light.ts), on either path alike: the glint at
 * each lens and, on a shining floor, the streak along its beam — your lamp's whole, the crew's
 * a little softer (CREW_BEAM).
 */
export function drawFlares(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const { own, crew } = frame.light;
  const lamps = [
    ...(own === null ? [] : [[own, 1] as const]),
    ...crew.map((lit) => [lit, CREW_BEAM] as const),
  ];
  if (lamps.length === 0) {
    return;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  for (const [lit, alpha] of lamps) {
    const end = streakOf(frame, lit);
    if (end !== null) {
      drawStreak(ctx, frame, lit.lamp, [end, alpha]);
    }
    drawGlint(ctx, frame, lit.lamp, alpha);
  }
  ctx.restore();
}

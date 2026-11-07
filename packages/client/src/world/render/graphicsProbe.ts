import { beaconAngle, beaconPhase, beaconTurnMs, LOBE_REACH } from '../beacon.js';
import { CORE_HALF } from '../beam.js';
import { figureBox } from '../depth.js';
import { hotspotOf } from '../droneLights.js';
import type { FigureTask } from '../figure.js';
import type { GradePhase } from '../grade.js';
import type { ParticleKind } from '../particles.js';
import type { Sim } from '../sim.js';
import { crewPose, groundAt } from './actors.js';
import { conesOf, motesLit } from './atmosphere.js';
import { streakOf } from './beam.js';
import { navOf } from './drones.js';
import type { Frame, RenderKit } from './frame.js';
import { hidersNow } from './occluders.js';

/**
 * What the walkthrough (`?trace=1`, tools/shots.mjs) reads of the world's
 * picture to prove the graphics package's captures: your figure's walk cycle
 * and the light its shadow follows, the hatch's opening, the particles alive
 * and the motes lit in the cones, and the canvas's backing store against its
 * box.
 */
export interface GraphicsProbe {
  /** your figure's walk: where in its cycle (0 to 1), and whether it walks */
  gait: { phase: number; moving: boolean };
  /** the light your figure stands in as the last frame drew it; null before the first */
  ground: 'lit' | 'dark' | 'plain' | null;
  /** how far the hatch stood open as the last frame drew it, 0 to 1 */
  hatch: number;
  /** the particles alive by kind, and how many motes the cones light */
  particles: Partial<Record<ParticleKind, number>> & { litMotes: number };
  /** the canvas: its backing store, device pixels, and its box, CSS pixels */
  backing: { width: number; height: number; cssWidth: number; cssHeight: number };
  /**
   * the emergency lamps burning as beacons as the last frame drew them (world/beacon.ts): where
   * each hangs, tiles, where its first lobe pointed, radians, at the frame's sim time, s, how
   * long it takes to turn once, ms, and how far its lobes reach, tiles
   */
  beacons: { x: number; y: number; angle: number; t: number; turnMs: number; reach: number }[];
  /**
   * the crew standing behind a tall thing as the last frame drew them (world/depth.ts): who,
   * where, and the tall things drawn again over them, each by its tile and what it is
   */
  hidden: { id: string; x: number; y: number; by: { x: number; y: number; of: string }[] }[];
  /**
   * the colour grade the last frame was drawn in (world/grade.ts): the phase it turns to — null
   * before the first frame — and its wash, a byte a channel, and how strongly it lies over
   */
  grade: { phase: GradePhase | null; rgb: number[]; alpha: number };
  /**
   * your flashlight's beam as the last frame drew it (world/beam.ts): where its lens is and where
   * it points, tiles and radians, how far and how wide either way it reaches, how wide its core
   * is, and how far along it the streak on a shining floor runs, tiles — null for none; null
   * without a beam
   */
  beam: {
    x: number;
    y: number;
    facing: number;
    reach: number;
    halfAngle: number;
    core: number;
    streak: number | null;
  } | null;
  /**
   * the drones as the last frame drew them (world/droneLights.ts): where each hangs and faces,
   * whether it is alerted or frozen, where its hotspot falls — null for none — and how brightly
   * its nav lights burn
   */
  drones: {
    id: string;
    x: number;
    y: number;
    facing: number;
    alerted: boolean;
    frozen: boolean;
    hotspot: { x: number; y: number } | null;
    nav: { port: number; starboard: number };
  }[];
  /**
   * the crew's figures as the last frame posed them (figure.ts): who, what they are busy with,
   * the way they show themselves facing, radians, and whether their hands hold something
   */
  crew: { id: string; task: FigureTask; facing: number; holding: boolean }[];
}

/** The crew's figures a frame posed, you first. */
function crewOf(drawn: Frame | null): GraphicsProbe['crew'] {
  if (drawn === null) {
    return [];
  }
  const ids = [...(drawn.spectator ? [] : [drawn.youId]), ...drawn.others.keys()];
  return ids.map((id) => {
    const other = drawn.others.get(id);
    const gait = other === undefined ? drawn.self : other;
    const facing = drawn.facings.get(id) ?? gait.facing;
    const walk = other === undefined ? drawn.walkPhase : other.phase;
    const pose = crewPose(drawn, id, { moving: gait.moving, facing, walk });
    return { id, task: drawn.tasks.get(id) ?? null, facing, holding: pose.holding };
  });
}

/** The drones a frame drew, with their lights. */
function dronesOf(drawn: Frame | null): GraphicsProbe['drones'] {
  if (drawn === null) {
    return [];
  }
  return Object.entries(drawn.drones).map(([id, drone]) => {
    const eye = drawn.light.eyes.get(id);
    const { x, y, facing, alerted, frozen } = drone;
    const hotspot = eye === undefined ? null : hotspotOf(drone, eye.sight);
    return { id, x, y, facing, alerted, frozen, hotspot, nav: navOf(drawn, id) };
  });
}

/** Your beam as a frame drew it. */
function beamOf(drawn: Frame | null): GraphicsProbe['beam'] {
  const own = drawn?.light.own ?? null;
  if (drawn === null || own === null || own.lamp.beam === null) {
    return null;
  }
  const { x, y, beam } = own.lamp;
  const { facing, reach, halfAngle } = beam;
  return { x, y, facing, reach, halfAngle, core: CORE_HALF, streak: streakOf(drawn, own) };
}

/** The grade a frame was drawn in, and the phase it turns to. */
function gradeOf(kit: RenderKit, drawn: Frame | null): GraphicsProbe['grade'] {
  const phase = kit.grade?.phase ?? null;
  if (drawn === null) {
    return { phase, rgb: [], alpha: 0 };
  }
  const { rgb, alpha } = drawn.grade;
  return { phase, rgb: rgb.map(Math.round), alpha };
}

/** The crew a frame drew behind tall things, and what hid each. */
function hiddenOf(drawn: Frame | null): GraphicsProbe['hidden'] {
  if (drawn === null) {
    return [];
  }
  const crew = [...drawn.others].map(([id, o]) => ({ id, x: o.rx, y: o.ry }));
  if (!drawn.spectator) {
    crew.push({ id: drawn.youId, x: drawn.self.x, y: drawn.self.y });
  }
  return crew.flatMap(({ id, x, y }) => {
    const by = hidersNow(drawn, figureBox(x, y), y).map(({ tall }) => ({
      x: tall.x,
      y: tall.y,
      of: tall.of,
    }));
    return by.length === 0 ? [] : [{ id, x, y, by }];
  });
}

/** The beacons a frame drew: each burning lamp, its first lobe's angle, the frame's sim time. */
function beaconsOf(drawn: Frame | null): GraphicsProbe['beacons'] {
  if (drawn === null) {
    return [];
  }
  return drawn.light.lamps.map(({ mount }) => ({
    x: mount.x,
    y: mount.y,
    angle: beaconAngle(drawn.time * 1000, beaconPhase(mount), drawn.reduced),
    t: drawn.time,
    turnMs: beaconTurnMs(drawn.reduced),
    reach: LOBE_REACH,
  }));
}

/** What the probe reads of a mounted world. */
export interface ProbedWorld {
  canvas: HTMLCanvasElement;
  kit: RenderKit;
  sim: Sim;
  drawn: Frame | null;
}

/** The graphics probe of `world` now. */
export function graphicsProbe(world: ProbedWorld): GraphicsProbe {
  const { canvas, kit, sim, drawn } = world;
  const particles: GraphicsProbe['particles'] = { litMotes: 0 };
  for (const particle of kit.art.particles.live) {
    particles[particle.kind] = (particles[particle.kind] ?? 0) + 1;
  }
  if (drawn !== null) {
    const cones = conesOf(drawn);
    particles.litMotes = kit.art.particles.live.filter(
      (p) => p.kind === 'dust' && motesLit(cones, p.x, p.y),
    ).length;
  }
  return {
    gait: { phase: sim.walkPhase, moving: sim.self.moving },
    ground: drawn === null ? null : groundAt(drawn, sim.self.x, sim.self.y),
    hatch: drawn?.hatch ?? 0,
    particles,
    backing: {
      width: canvas.width,
      height: canvas.height,
      cssWidth: canvas.clientWidth,
      cssHeight: canvas.clientHeight,
    },
    beacons: beaconsOf(drawn),
    hidden: hiddenOf(drawn),
    grade: gradeOf(kit, drawn),
    beam: beamOf(drawn),
    drones: dronesOf(drawn),
    crew: crewOf(drawn),
  };
}

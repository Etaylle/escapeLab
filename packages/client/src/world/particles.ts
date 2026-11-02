import type { PlayerView } from '@escapelab/core';
import { alarmNotice, type Alarm } from './alarm.js';
import { animTick, ANIM_HZ } from './anim.js';
import { seededRandom } from './brush.js';
import { isArmed } from './known.js';

/**
 * The world's particles, small and few, from one pool: dust motes drifting
 * slowly in the light cones — your flashlight's beam, a drone's eye, a lit
 * room's light through an open door; steam rising from the machine room's
 * vents and puffing from the reactor's core; a burst of sparks out of the
 * fuse box when a wrong cut shorts it — the device's own sparks stay inside
 * its panel; these are the world's; a wisp of smoke rising from the main
 * breaker for SMOKE_MS after the blackout's thunk; and dust trickling from
 * the hatch's rim as it grinds open. Never more than MAX_PARTICLES at once,
 * each kind within its own share, and never more particle objects made than
 * that: one that dies waits in the pool to be born again. Stepped at most
 * ANIM_HZ times a second; only the sparks move faster than a walking crew
 * member. Under reduced motion nothing new drifts, rises or flies. Pure but
 * for the seeded dice the pool carries.
 */

/** How many particles live at once, at most. */
export const MAX_PARTICLES = 120;
/** How many of them each kind may take: the sparks always find room. */
export const SHARE: Readonly<Record<Exclude<ParticleKind, 'spark'>, number>> = {
  dust: 44,
  steam: 28,
  smoke: 18,
  debris: 30,
};
/** A burst of sparks. */
const SPARKS = 18;
/** At most this many steps are caught up after a pause; the rest are skipped. */
const CATCH_UP = 4;
/** How long the main breaker smokes after the blackout's thunk, ms. */
export const SMOKE_MS = 10_000;
/** How often a reactor's core puffs steam: the chance of a puff each step. */
const PUFF_ODDS = 1 / 30;

export type ParticleKind = 'dust' | 'steam' | 'spark' | 'smoke' | 'debris';

export interface Particle {
  kind: ParticleKind;
  /** where, in tiles */
  x: number;
  y: number;
  /** how fast, tiles a second */
  vx: number;
  vy: number;
  /** how long it has lived and will live, s */
  age: number;
  life: number;
  /** its radius, tiles */
  size: number;
}

/** A cone of light, in tiles and radians: a flashlight's beam, a drone's eye, a door's spill. */
export interface Beam {
  x: number;
  y: number;
  facing: number;
  halfAngle: number;
  reach: number;
}

/** A point in the world, in tiles. */
export interface Spot {
  x: number;
  y: number;
}

/** What makes particles this step. */
export interface Emitters {
  /** the light cones dust drifts in; none in the lit lab */
  cones: readonly Beam[];
  /** the steam outlets in light, where steam rises from */
  vents: readonly Spot[];
  /** the reactors' cores in light: now and then a puff of steam from their vents */
  cores: readonly Spot[];
  /** a short at the fuse box: sparks fly from (x, y), once for each `seq` */
  short: { x: number; y: number; seq: number } | null;
  /** the main breaker while it smokes after the blackout's thunk; null for none */
  smoke: Spot | null;
  /** the hatch's rim while it grinds open, dust trickling from it; null for none */
  hatch: Spot | null;
  /** less motion asked for: nothing new drifts or flies */
  reduced: boolean;
}

/** No emitter at all: what a step makes nothing from. */
export const STILL_AIR: Emitters = {
  cones: [],
  vents: [],
  cores: [],
  short: null,
  smoke: null,
  hatch: null,
  reduced: false,
};

/** The particles alive, those waiting to be born again, the step they moved at last, the dice. */
export interface Particles {
  live: Particle[];
  /** the dead, kept to be born again: no more particles are ever made than MAX_PARTICLES */
  spare: Particle[];
  /** the animation step they were moved at last; null before the first */
  tick: number | null;
  rand: () => number;
  /** the short whose sparks have flown, by its `seq`; null before any */
  burst: number | null;
}

/** A fresh pool, its dice seeded with `seed`. */
export function newParticles(seed = 1): Particles {
  return { live: [], spare: [], tick: null, rand: seededRandom(seed), burst: null };
}

function count(p: Particles, kind: ParticleKind): number {
  let n = 0;
  for (const particle of p.live) {
    if (particle.kind === kind) n += 1;
  }
  return n;
}

/** Room for one more `kind`: within its share, and a spark may push out the oldest of the rest. */
function roomFor(p: Particles, kind: ParticleKind): boolean {
  if (kind !== 'spark' && count(p, kind) >= SHARE[kind]) {
    return false;
  }
  if (p.live.length < MAX_PARTICLES) {
    return true;
  }
  if (kind !== 'spark') {
    return false;
  }
  const oldest = p.live.findIndex((particle) => particle.kind !== 'spark');
  if (oldest < 0) {
    return false;
  }
  const [gone] = p.live.splice(oldest, 1);
  if (gone !== undefined) p.spare.push(gone);
  return true;
}

/** Brings a particle to life as `born` says: one from the pool where one waits, else a new one. */
function born(p: Particles, particle: Particle): void {
  const reused = p.spare.pop();
  p.live.push(reused === undefined ? particle : Object.assign(reused, particle));
}

/** A mote somewhere inside `cone`, drifting slowly every way. */
function spawnDust(p: Particles, cone: Beam): void {
  const { rand } = p;
  const away = 0.8 + rand() * Math.max(0.2, cone.reach - 1.5);
  const angle = cone.facing + (rand() * 2 - 1) * cone.halfAngle * 0.85;
  const drift = 0.03 + rand() * 0.09;
  const heading = rand() * Math.PI * 2;
  born(p, {
    kind: 'dust',
    x: cone.x + Math.cos(angle) * away,
    y: cone.y + Math.sin(angle) * away,
    vx: Math.cos(heading) * drift,
    vy: Math.sin(heading) * drift,
    age: 0,
    life: 2 + rand() * 2.5,
    size: 0.016 + rand() * 0.02,
  });
}

function spawnSteam(p: Particles, vent: Spot, spread = 0.12): void {
  const { rand } = p;
  born(p, {
    kind: 'steam',
    x: vent.x + (rand() - 0.5) * spread,
    y: vent.y,
    vx: (rand() - 0.5) * 0.1,
    vy: -(0.2 + rand() * 0.15),
    age: 0,
    life: 1.2 + rand() * 0.8,
    size: 0.06 + rand() * 0.04,
  });
}

/** A wisp of the breaker's smoke: grey, rising slower than steam, spreading as it goes. */
function spawnSmoke(p: Particles, at: Spot): void {
  const { rand } = p;
  born(p, {
    kind: 'smoke',
    x: at.x + (rand() - 0.5) * 0.1,
    y: at.y,
    vx: (rand() - 0.5) * 0.12,
    vy: -(0.16 + rand() * 0.12),
    age: 0,
    life: 2.4 + rand() * 1.2,
    size: 0.05 + rand() * 0.03,
  });
}

/** A grain of dust shaken off the hatch's rim, falling as the leaf grinds open. */
function spawnDebris(p: Particles, rim: Spot): void {
  const { rand } = p;
  born(p, {
    kind: 'debris',
    x: rim.x + (rand() - 0.5) * 0.8,
    y: rim.y + (rand() - 0.5) * 0.15,
    vx: (rand() - 0.5) * 0.2,
    vy: 0.35 + rand() * 0.5,
    age: 0,
    life: 0.6 + rand() * 0.7,
    size: 0.03 + rand() * 0.035,
  });
}

function burstSparks(p: Particles, short: Spot): void {
  const { rand } = p;
  for (let k = 0; k < SPARKS && roomFor(p, 'spark'); k++) {
    const angle = -Math.PI * (0.1 + rand() * 0.8);
    const speed = 2 + rand() * 3;
    born(p, {
      kind: 'spark',
      x: short.x,
      y: short.y,
      vx: Math.cos(angle) * speed * (rand() < 0.5 ? -1 : 1),
      vy: Math.sin(angle) * speed,
      age: 0,
      life: 0.3 + rand() * 0.35,
      size: 0.02,
    });
  }
}

/** How each kind changes over a step of `dt` seconds besides moving: falling, spreading. */
function age(particle: Particle, dt: number): void {
  if (particle.kind === 'spark') {
    particle.vy += 7 * dt;
  } else if (particle.kind === 'debris') {
    particle.vy = Math.min(1.6, particle.vy + 1.5 * dt);
  } else if (particle.kind === 'steam') {
    particle.size += 0.12 * dt;
  } else if (particle.kind === 'smoke') {
    particle.size += 0.08 * dt;
  }
}

/** Moves and ages everything a step of `dt` seconds; the dead go back to the pool. */
function move(p: Particles, dt: number): void {
  let kept = 0;
  for (const particle of p.live) {
    particle.age += dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    age(particle, dt);
    if (particle.age < particle.life) {
      p.live[kept++] = particle;
    } else {
      p.spare.push(particle);
    }
  }
  p.live.length = kept;
}

/** Each emitter has its chance to add to the particles this step. */
function emit(p: Particles, emitters: Emitters): void {
  for (const cone of emitters.cones) {
    if (p.rand() < 0.5 && roomFor(p, 'dust')) spawnDust(p, cone);
  }
  for (const vent of emitters.vents) {
    if (p.rand() < 0.3 && roomFor(p, 'steam')) spawnSteam(p, vent);
  }
  for (const core of emitters.cores) {
    if (p.rand() < PUFF_ODDS) {
      for (let k = 0; k < 3 && roomFor(p, 'steam'); k++) spawnSteam(p, core, 0.6);
    }
  }
  const { smoke, hatch } = emitters;
  if (smoke !== null && p.rand() < 0.6 && roomFor(p, 'smoke')) spawnSmoke(p, smoke);
  for (let k = 0; hatch !== null && k < 3 && roomFor(p, 'debris'); k++) spawnDebris(p, hatch);
}

/** One step of `dt` seconds: everything moves and ages, the dead go, the emitters make more. */
function advance(p: Particles, dt: number, emitters: Emitters): void {
  move(p, dt);
  const { short } = emitters;
  if (short !== null && short.seq !== p.burst) {
    p.burst = short.seq;
    if (!emitters.reduced) burstSparks(p, short);
  }
  if (!emitters.reduced) {
    emit(p, emitters);
  }
}

/**
 * Moves the particles on to sim time `time` (s), a step for every
 * animation tick since they last moved — at most ANIM_HZ a second, however
 * often this is called — and lets the emitters add to them.
 */
export function stepParticles(p: Particles, time: number, emitters: Emitters): void {
  const tick = animTick(time);
  if (p.tick === null || tick < p.tick) {
    p.tick = tick;
    return;
  }
  const steps = Math.min(CATCH_UP, tick - p.tick);
  for (let k = 0; k < steps; k++) {
    advance(p, 1 / ANIM_HZ, emitters);
  }
  p.tick = tick;
}

/** How far a particle shows, 0 to 1: fading in, holding, fading out over its life. */
export function particleAlpha(particle: Particle): number {
  const t = particle.age / particle.life;
  return Math.min(1, t * 5, (1 - t) * 3);
}

/** Whether (x, y) lies inside `cone`: within its reach and its angle either way of its facing. */
export function inCone(cone: Beam, x: number, y: number): boolean {
  const dx = x - cone.x;
  const dy = y - cone.y;
  const turn = Math.atan2(dy, dx) - cone.facing;
  const off = Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn)));
  return off < cone.halfAngle && Math.hypot(dx, dy) < cone.reach;
}

/**
 * The short to throw sparks for: the run's latest alarm, where it was a
 * wrong move while a fuse box is the armed station — out of that box, once
 * for its alarm. Null for none.
 */
export function shortOf(
  view: Pick<PlayerView, 'events' | 'alarms' | 'map'>,
  alarm: Alarm | null,
): { x: number; y: number; seq: number } | null {
  if (alarm === null) {
    return null;
  }
  const box = view.map?.stations.find((s) => isArmed(s) && s.look === 'fusebox');
  const notice = alarmNotice(view.events, view.alarms);
  if (box === undefined || notice?.cause !== 'Fehlversuch' || notice.seq !== alarm.seq) {
    return null;
  }
  return { x: box.x + 0.5, y: box.y + 0.25, seq: alarm.seq };
}

/**
 * Where the main breaker smokes from at `now` (epoch ms): the main switch's box — the first
 * station that is a lever — for SMOKE_MS after the blackout's thunk at `thunkAt`; null before
 * the thunk, after the smoke, on a map without one, and while the lab has its power.
 */
export function breakerSmoke(
  stations: readonly { x: number; y: number; look?: string }[],
  thunkAt: number | null,
  now: number,
): Spot | null {
  if (thunkAt === null || now < thunkAt || now - thunkAt > SMOKE_MS) {
    return null;
  }
  const breaker = stations.find((station) => station.look === 'lever');
  return breaker === undefined ? null : { x: breaker.x + 0.62, y: breaker.y + 0.05 };
}

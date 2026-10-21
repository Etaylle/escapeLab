import type { PlayerView } from '@escapelab/core';
import { alarmNotice, type Alarm } from './alarm.js';
import { animTick, ANIM_HZ } from './anim.js';
import { seededRandom } from './brush.js';

/**
 * The world's particles, small and few: dust motes drifting slowly in your
 * flashlight's beam, steam rising from the machine room's vents, and a burst
 * of sparks out of the fuse box when a wrong cut shorts it — the device's
 * own sparks stay inside its panel; these are the world's. Never more than
 * MAX_PARTICLES at once, stepped at most ANIM_HZ times a second; only the
 * sparks move faster than a walking crew member. Pure but for the seeded
 * dice the pool carries.
 */

/** How many particles live at once, at most. */
export const MAX_PARTICLES = 80;
/** How many of them may be dust, and steam: the sparks always find room. */
const MAX_DUST = 26;
const MAX_STEAM = 36;
/** A burst of sparks. */
const SPARKS = 18;
/** At most this many steps are caught up after a pause; the rest are skipped. */
const CATCH_UP = 4;

export type ParticleKind = 'dust' | 'steam' | 'spark';

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

/** A flashlight's beam, in tiles and radians. */
export interface Beam {
  x: number;
  y: number;
  facing: number;
  halfAngle: number;
  reach: number;
}

/** What makes particles this step. */
export interface Emitters {
  /** your flashlight's beam: dust drifts in it; null without one */
  beam: Beam | null;
  /** the steam outlets in light, where steam rises from */
  vents: readonly { x: number; y: number }[];
  /** a short at the fuse box: sparks fly from (x, y), once for each `seq` */
  short: { x: number; y: number; seq: number } | null;
  /** less motion asked for: nothing new drifts or flies */
  reduced: boolean;
}

/** The particles alive, the step they were last moved at, and their dice. */
export interface Particles {
  live: Particle[];
  /** the animation step they were moved at last; null before the first */
  tick: number | null;
  rand: () => number;
  /** the short whose sparks have flown, by its `seq`; null before any */
  burst: number | null;
}

/** A fresh pool, its dice seeded with `seed`. */
export function newParticles(seed = 1): Particles {
  return { live: [], tick: null, rand: seededRandom(seed), burst: null };
}

function count(p: Particles, kind: ParticleKind): number {
  return p.live.reduce((n, particle) => n + (particle.kind === kind ? 1 : 0), 0);
}

/** Room for one more: a spark may push out the oldest mote or puff. */
function roomFor(p: Particles, kind: ParticleKind): boolean {
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
  p.live.splice(oldest, 1);
  return true;
}

function spawnDust(p: Particles, beam: Beam): void {
  const { rand } = p;
  const away = 0.8 + rand() * (beam.reach - 1.5);
  const angle = beam.facing + (rand() * 2 - 1) * beam.halfAngle * 0.85;
  const drift = 0.03 + rand() * 0.09;
  const heading = rand() * Math.PI * 2;
  p.live.push({
    kind: 'dust',
    x: beam.x + Math.cos(angle) * away,
    y: beam.y + Math.sin(angle) * away,
    vx: Math.cos(heading) * drift,
    vy: Math.sin(heading) * drift,
    age: 0,
    life: 2 + rand() * 2.5,
    size: 0.016 + rand() * 0.02,
  });
}

function spawnSteam(p: Particles, vent: { x: number; y: number }): void {
  const { rand } = p;
  p.live.push({
    kind: 'steam',
    x: vent.x + (rand() - 0.5) * 0.12,
    y: vent.y,
    vx: (rand() - 0.5) * 0.1,
    vy: -(0.2 + rand() * 0.15),
    age: 0,
    life: 1.2 + rand() * 0.8,
    size: 0.06 + rand() * 0.04,
  });
}

function burstSparks(p: Particles, short: { x: number; y: number }): void {
  const { rand } = p;
  for (let k = 0; k < SPARKS && roomFor(p, 'spark'); k++) {
    const angle = -Math.PI * (0.1 + rand() * 0.8);
    const speed = 2 + rand() * 3;
    p.live.push({
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

/** One step of `dt` seconds: everything moves and ages, the dead go, the emitters make more. */
function advance(p: Particles, dt: number, emitters: Emitters): void {
  for (const particle of p.live) {
    particle.age += dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    if (particle.kind === 'spark') {
      particle.vy += 7 * dt;
    } else if (particle.kind === 'steam') {
      particle.size += 0.12 * dt;
    }
  }
  p.live = p.live.filter((particle) => particle.age < particle.life);
  const { short } = emitters;
  if (short !== null && short.seq !== p.burst) {
    p.burst = short.seq;
    if (!emitters.reduced) burstSparks(p, short);
  }
  if (emitters.reduced) {
    return;
  }
  const { beam } = emitters;
  if (beam !== null && count(p, 'dust') < MAX_DUST && p.rand() < 0.5 && roomFor(p, 'dust')) {
    spawnDust(p, beam);
  }
  for (const vent of emitters.vents) {
    if (count(p, 'steam') < MAX_STEAM && p.rand() < 0.3 && roomFor(p, 'steam')) {
      spawnSteam(p, vent);
    }
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
  const box = view.map?.stations.find((s) => s.status === 'armed' && s.look === 'fusebox');
  const notice = alarmNotice(view.events, view.alarms);
  if (box === undefined || notice?.cause !== 'Fehlversuch' || notice.seq !== alarm.seq) {
    return null;
  }
  return { x: box.x + 0.5, y: box.y + 0.25, seq: alarm.seq };
}

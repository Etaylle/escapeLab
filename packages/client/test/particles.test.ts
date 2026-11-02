import { describe, expect, it } from 'vitest';
import type { PlayerView } from '@escapelab/core';
import { ANIM_HZ, animTime, WALK_SPEED } from '../src/world/anim.js';
import {
  breakerSmoke,
  inCone,
  MAX_PARTICLES,
  newParticles,
  particleAlpha,
  SHARE,
  shortOf,
  SMOKE_MS,
  STILL_AIR,
  stepParticles,
  type Emitters,
  type Particle,
  type ParticleKind,
} from '../src/world/particles.js';
import { mapWith } from './fixtures.js';

const beam = { x: 2, y: 2, facing: 0, halfAngle: 0.5, reach: 7.5 };
const vents = [
  { x: 5, y: 1 },
  { x: 8, y: 1 },
  { x: 11, y: 1 },
];
const busy: Emitters = { ...STILL_AIR, cones: [beam], vents };

/** The kinds among `live`, counted. */
function kinds(live: readonly Particle[]): Partial<Record<ParticleKind, number>> {
  const counts: Partial<Record<ParticleKind, number>> = {};
  for (const particle of live) {
    counts[particle.kind] = (counts[particle.kind] ?? 0) + 1;
  }
  return counts;
}

/** Everything emitting at once: three cones, vents, a core, the breaker, the hatch, shorts. */
const everything = (frame: number): Emitters => ({
  cones: [beam, { ...beam, x: 9, facing: Math.PI }, { ...beam, y: 5, facing: -Math.PI / 2 }],
  vents,
  cores: [{ x: 6, y: 4 }],
  short: frame % 20 === 0 ? { x: 1, y: 1, seq: frame } : null,
  smoke: { x: 4, y: 3 },
  hatch: { x: 1.5, y: 1.2 },
  reduced: false,
});

describe('the world’s particles — few, small and slow', () => {
  it('never lets more than MAX_PARTICLES live, however long and however much is emitted', () => {
    const p = newParticles(7);
    let most = 0;
    for (let frame = 0; frame < 60 * 30; frame++) {
      // A short every third of a second on top: the sparks push the oldest motes out.
      stepParticles(p, frame / 60, everything(frame));
      most = Math.max(most, p.live.length);
    }
    expect(most).toBe(MAX_PARTICLES);
    expect(p.live.length).toBeLessThanOrEqual(MAX_PARTICLES);
  });

  it('moves them at most ANIM_HZ times a second, however often the frames come', () => {
    const p = newParticles(3);
    stepParticles(p, 0, busy);
    const snapshots: string[] = [];
    for (let frame = 1; frame <= 120; frame++) {
      stepParticles(p, frame / 120, busy);
      snapshots.push(JSON.stringify(p.live));
    }
    const changes = snapshots.filter((s, i) => i > 0 && s !== snapshots[i - 1]).length;
    expect(changes).toBeLessThanOrEqual(ANIM_HZ);
    expect(changes).toBeGreaterThan(ANIM_HZ / 2);
  });

  it('lets nothing outrun a walking crew member but the sparks', () => {
    const p = newParticles(11);
    for (let frame = 0; frame < 600; frame++) {
      const short = { x: 1, y: 1, seq: Math.floor(frame / 100) };
      stepParticles(p, frame / 60, { ...busy, short });
      for (const particle of p.live.filter((q) => q.kind !== 'spark')) {
        expect(Math.hypot(particle.vx, particle.vy)).toBeLessThan(WALK_SPEED);
      }
    }
    expect(p.live.some((q) => q.kind === 'spark' && Math.hypot(q.vx, q.vy) > WALK_SPEED)).toBe(
      false,
    );
  });

  it('throws one burst of sparks for each short, and none under reduced motion', () => {
    const p = newParticles(5);
    stepParticles(p, 0, busy);
    const short = { x: 3, y: 3, seq: 1 };
    stepParticles(p, 1 / ANIM_HZ, { ...STILL_AIR, short });
    const sparks = p.live.filter((q) => q.kind === 'spark').length;
    expect(sparks).toBeGreaterThan(10);
    stepParticles(p, 2 / ANIM_HZ, { ...STILL_AIR, short });
    expect(p.live.filter((q) => q.kind === 'spark').length).toBeLessThanOrEqual(sparks);
    const calm = newParticles(5);
    stepParticles(calm, 0, busy);
    const quiet = { ...busy, short: { x: 3, y: 3, seq: 2 }, reduced: true };
    stepParticles(calm, 1, quiet);
    expect(calm.live).toEqual([]);
  });

  it('drifts dust in the beam and lets steam rise from the vents', () => {
    const p = newParticles(9);
    for (let frame = 0; frame < 120; frame++) {
      stepParticles(p, frame / 60, busy);
    }
    const dust = p.live.filter((q) => q.kind === 'dust');
    const steam = p.live.filter((q) => q.kind === 'steam');
    expect(dust.length).toBeGreaterThan(3);
    expect(dust.every((q) => q.x > beam.x)).toBe(true);
    expect(steam.length).toBeGreaterThan(3);
    expect(steam.every((q) => q.vy < 0)).toBe(true);
  });

  it('fades a particle in and out over its life', () => {
    const at = (age: number): number =>
      particleAlpha({ kind: 'dust', x: 0, y: 0, vx: 0, vy: 0, age, life: 2, size: 0.02 });
    expect(at(0)).toBe(0);
    expect(at(1)).toBe(1);
    expect(at(2)).toBe(0);
  });

  it('holds the animation clock still between its steps', () => {
    expect(animTime(1 / ANIM_HZ - 0.001)).toBe(0);
    expect(animTime(1 / ANIM_HZ + 0.001)).toBeCloseTo(1 / ANIM_HZ);
  });
});

describe('the particle pool — bounded, reused, each kind within its share', () => {
  it('never makes more particles than MAX_PARTICLES, however long everything emits', () => {
    const p = newParticles(13);
    const made = new Set<Particle>();
    for (let frame = 0; frame < 60 * 40; frame++) {
      stepParticles(p, frame / 60, everything(frame));
      for (const particle of p.live) made.add(particle);
      expect(p.live.length).toBeLessThanOrEqual(MAX_PARTICLES);
      expect(p.live.length + p.spare.length).toBeLessThanOrEqual(MAX_PARTICLES);
    }
    expect(MAX_PARTICLES).toBeLessThanOrEqual(120);
    expect(made.size).toBeLessThanOrEqual(MAX_PARTICLES);
  });

  it('gives a particle that died back to the pool, to be born again', () => {
    const p = newParticles(17);
    stepParticles(p, 0, busy);
    for (let frame = 1; frame < 120; frame++) stepParticles(p, frame / 60, busy);
    const first = new Set(p.live);
    for (let frame = 120; frame < 600; frame++) stepParticles(p, frame / 60, busy);
    const reborn = p.live.filter((particle) => first.has(particle));
    expect(p.spare.length + p.live.length).toBeGreaterThan(0);
    expect(reborn.length).toBeGreaterThan(0);
  });

  it('keeps every kind but the sparks within its share', () => {
    const p = newParticles(19);
    for (let frame = 0; frame < 60 * 30; frame++) {
      stepParticles(p, frame / 60, everything(frame));
      const counts = kinds(p.live);
      for (const [kind, most] of Object.entries(SHARE)) {
        expect(counts[kind as ParticleKind] ?? 0).toBeLessThanOrEqual(most);
      }
    }
  });

  it('drifts dust only inside the light cones it was born in', () => {
    const p = newParticles(23);
    const cones = everything(0).cones;
    for (let frame = 0; frame < 240; frame++) {
      stepParticles(p, frame / 60, { ...STILL_AIR, cones });
      for (const mote of p.live.filter((q) => q.kind === 'dust' && q.age === 1 / ANIM_HZ)) {
        const bornX = mote.x - mote.vx / ANIM_HZ;
        const bornY = mote.y - mote.vy / ANIM_HZ;
        expect(cones.some((cone) => inCone(cone, bornX, bornY))).toBe(true);
      }
    }
    expect(p.live.some((q) => q.kind === 'dust')).toBe(true);
  });

  it('puffs steam from a core now and then, smoke from the breaker, dust from the hatch', () => {
    const p = newParticles(29);
    const seen = new Set<ParticleKind>();
    for (let frame = 0; frame < 60 * 8; frame++) {
      const emitters = { ...STILL_AIR, cores: [{ x: 6, y: 4 }], smoke: { x: 4, y: 3 } };
      const hatch = frame < 120 ? { x: 1.5, y: 1.2 } : null;
      stepParticles(p, frame / 60, { ...emitters, hatch });
      for (const particle of p.live) seen.add(particle.kind);
    }
    expect([...seen].sort()).toEqual(['debris', 'smoke', 'steam']);
    const smoke = p.live.filter((q) => q.kind === 'smoke');
    expect(smoke.every((q) => q.vy < 0 && Math.hypot(q.vx, q.vy) < WALK_SPEED)).toBe(true);
  });

  it('lets the hatch’s dust fall, slower than anybody walks', () => {
    const p = newParticles(31);
    for (let frame = 0; frame < 90; frame++) {
      stepParticles(p, frame / 60, { ...STILL_AIR, hatch: { x: 1.5, y: 1.2 } });
    }
    const debris = p.live.filter((q) => q.kind === 'debris');
    expect(debris.length).toBeGreaterThan(5);
    expect(debris.every((q) => q.vy > 0 && Math.hypot(q.vx, q.vy) < WALK_SPEED)).toBe(true);
  });

  it('makes nothing new under reduced motion', () => {
    const p = newParticles(37);
    for (let frame = 0; frame < 240; frame++) {
      stepParticles(p, frame / 60, { ...everything(frame), reduced: true });
    }
    expect(p.live).toEqual([]);
  });
});

describe('breakerSmoke — the main breaker smoking after the blackout’s thunk', () => {
  const lever = { x: 11, y: 7, look: 'lever' };
  const fuse = { x: 1, y: 12, look: 'fusebox' };

  it('smokes from the main switch’s box for SMOKE_MS after the thunk', () => {
    expect(breakerSmoke([fuse, lever], 5000, 5000)).toEqual({ x: 11.62, y: 7.05 });
    expect(breakerSmoke([fuse, lever], 5000, 5000 + SMOKE_MS)).not.toBeNull();
    expect(breakerSmoke([fuse, lever], 5000, 5001 + SMOKE_MS)).toBeNull();
  });

  it('smokes not before the thunk, not without one, nor on a map without a main switch', () => {
    expect(breakerSmoke([lever], 5000, 4999)).toBeNull();
    expect(breakerSmoke([lever], null, 5000)).toBeNull();
    expect(breakerSmoke([fuse], 5000, 6000)).toBeNull();
  });
});

describe('shortOf — when the fuse box shorts out', () => {
  const box = {
    seen: true,
    found: false,
    known: false,
    puzzleId: 'notstrom',
    x: 1,
    y: 9,
    title: 'Notstrom-Kasten',
    status: 'armed' as const,
    console: 'a' as const,
    look: 'fusebox' as const,
  };
  const view = (
    label: string,
    stations: NonNullable<PlayerView['map']>['stations'] = [box],
  ): Pick<PlayerView, 'events' | 'alarms' | 'map'> => ({
    events: [{ kind: 'penalty', at: 5, label, seconds: 20 }],
    alarms: { count: 1, limit: 5 },
    map: mapWith({ stations }),
  });

  it('throws its sparks out of the armed fuse box on a wrong cut', () => {
    expect(shortOf(view('Falsches Kabel'), { seq: 1, at: 5 })).toEqual({ x: 1.5, y: 9.25, seq: 1 });
  });

  it('throws none for a drone’s alarm, nor where no fuse box is armed, nor for none', () => {
    expect(shortOf(view('Von einer Drohne erfasst'), { seq: 1, at: 5 })).toBeNull();
    const done = view('Falsches Kabel', [{ ...box, status: 'done' }]);
    expect(shortOf(done, { seq: 1, at: 5 })).toBeNull();
    expect(shortOf(view('Falsches Kabel'), null)).toBeNull();
  });
});

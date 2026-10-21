import { describe, expect, it } from 'vitest';
import type { PlayerView } from '@escapelab/core';
import { ANIM_HZ, animTime, WALK_SPEED } from '../src/world/anim.js';
import {
  MAX_PARTICLES,
  newParticles,
  particleAlpha,
  shortOf,
  stepParticles,
  type Emitters,
} from '../src/world/particles.js';
import { mapWith } from './fixtures.js';

const beam = { x: 2, y: 2, facing: 0, halfAngle: 0.5, reach: 7.5 };
const vents = [
  { x: 5, y: 1 },
  { x: 8, y: 1 },
  { x: 11, y: 1 },
];
const busy: Emitters = { beam, vents, short: null, reduced: false };

describe('the world’s particles — few, small and slow', () => {
  it('never lets more than MAX_PARTICLES live, however long and however much is emitted', () => {
    const p = newParticles(7);
    let most = 0;
    for (let frame = 0; frame < 60 * 30; frame++) {
      // A short every third of a second on top: the sparks push the oldest motes out.
      const short = frame % 20 === 0 ? { x: 1, y: 1, seq: frame } : null;
      stepParticles(p, frame / 60, { ...busy, short });
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
    stepParticles(p, 1 / ANIM_HZ, { beam: null, vents: [], short, reduced: false });
    const sparks = p.live.filter((q) => q.kind === 'spark').length;
    expect(sparks).toBeGreaterThan(10);
    stepParticles(p, 2 / ANIM_HZ, { beam: null, vents: [], short, reduced: false });
    expect(p.live.filter((q) => q.kind === 'spark').length).toBeLessThanOrEqual(sparks);
    const calm = newParticles(5);
    stepParticles(calm, 0, busy);
    stepParticles(calm, 1, { beam, vents, short: { x: 3, y: 3, seq: 2 }, reduced: true });
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

describe('shortOf — when the fuse box shorts out', () => {
  const box = {
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

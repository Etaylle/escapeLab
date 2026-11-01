import { describe, expect, it } from 'vitest';
import { SPRINT_FACTOR, WALK_SPEED } from '@escapelab/core';
import {
  gaitStep,
  GAIT_CYCLE,
  handLamp,
  HIP_X,
  HAND_AHEAD,
  HAND_DEPTH,
  LEAN,
  leanOf,
  PX,
  STANDING,
  STEP_LIFT,
  STRIDE,
  strideAt,
  SWAY,
  WALK_BOB,
  WALK_HIP,
} from '../src/world/figure.js';
import { ownLamp } from '../src/world/frameLight.js';
import { followOthers, newSim } from '../src/world/sim.js';
import { REMOTE_DELAY_MS } from '../src/world/trail.js';

/** `value` sampled over one walk cycle, `steps` points from phase 0. */
function overCycle<T>(steps: number, value: (phase: number) => T): T[] {
  return Array.from({ length: steps }, (_, i) => value(i / steps));
}

describe('gaitStep — the legs keep pace with the ground', () => {
  it('goes once round the cycle every GAIT_CYCLE tiles, wrapping to 0', () => {
    expect(gaitStep(0, GAIT_CYCLE / 4)).toBeCloseTo(0.25, 12);
    expect(gaitStep(0.5, GAIT_CYCLE / 2)).toBeCloseTo(0, 12);
    expect(gaitStep(0.9, GAIT_CYCLE * 0.3)).toBeCloseTo(0.2, 12);
  });

  it('holds still where nothing is covered, and never runs backwards', () => {
    expect(gaitStep(0.4, 0)).toBe(0.4);
    expect(gaitStep(0.4, -1)).toBe(0.4);
  });

  it('swings the legs as much faster as a sprint covers more ground in the same time', () => {
    const dt = 1 / 60;
    const walking = gaitStep(0, WALK_SPEED * dt * 10);
    const sprinting = gaitStep(0, WALK_SPEED * SPRINT_FACTOR * dt * 10);
    expect(sprinting).toBeCloseTo(walking * SPRINT_FACTOR, 12);
  });
});

describe('strideAt — a walk cycle', () => {
  it('stands on both feet under its hips, either side of the middle, while not walking', () => {
    expect(strideAt(0.3, false)).toEqual(STANDING);
    expect([STANDING.front.x, STANDING.back.x]).toEqual([HIP_X, -HIP_X]);
  });

  it('passes the feet with the front one lifted and the body a pixel up at phase 0', () => {
    const { front, back, bob } = strideAt(0, true);
    expect(front.x).toBeCloseTo(WALK_HIP, 12);
    expect(back.x).toBeCloseTo(-WALK_HIP, 12);
    expect(front.lift).toBeCloseTo(STEP_LIFT, 12);
    expect(back.lift).toBe(0);
    expect(bob).toBeCloseTo(-WALK_BOB, 12);
    expect(WALK_BOB).toBe(PX);
  });

  it('plants both feet wide, the front one leading at a quarter, the back one at three', () => {
    const quarter = strideAt(0.25, true);
    expect(quarter.front.x).toBeCloseTo(WALK_HIP + STRIDE, 12);
    expect(quarter.back.x).toBeCloseTo(-WALK_HIP - STRIDE, 12);
    expect(quarter.front.lift).toBeCloseTo(0, 12);
    expect(quarter.back.lift).toBeCloseTo(0, 12);
    expect(quarter.bob).toBeCloseTo(0, 12);
    // The legs take turns leading: at three quarters the back foot is the one ahead.
    const three = strideAt(0.75, true);
    expect(three.back.x).toBeGreaterThan(three.front.x);
    expect(three.back.x - three.front.x).toBeCloseTo(2 * (STRIDE - WALK_HIP), 12);
  });

  it('lifts the back foot as the front one did, half a cycle later', () => {
    for (const phase of [0.05, 0.1, 0.2, 0.4]) {
      const now = strideAt(phase, true);
      const later = strideAt(phase + 0.5, true);
      expect(later.back.lift).toBeCloseTo(now.front.lift, 12);
      // Each foot swings about its own hip: the back one's swing is the front one's, later.
      expect(later.back.x + WALK_HIP).toBeCloseTo(now.front.x - WALK_HIP, 12);
    }
  });

  it('never lifts both feet at once, and lifts each in turn over a cycle', () => {
    const strides = overCycle(64, (phase) => strideAt(phase, true));
    expect(strides.every(({ front, back }) => front.lift === 0 || back.lift === 0)).toBe(true);
    expect(strides.some(({ front }) => front.lift > 0)).toBe(true);
    expect(strides.some(({ back }) => back.lift > 0)).toBe(true);
  });

  it('moves the body by one pixel of the art at most', () => {
    const bobs = overCycle(64, (phase) => strideAt(phase, true).bob);
    expect(Math.min(...bobs)).toBeCloseTo(-PX, 12);
    expect(Math.max(...bobs)).toBeLessThanOrEqual(0);
  });
});

describe('leanOf — leaning into the way it walks', () => {
  it('leans fully walking across the picture, not at all walking up or down it', () => {
    expect(leanOf(0, true)).toBeCloseTo(LEAN, 12);
    expect(leanOf(Math.PI, true)).toBeCloseTo(LEAN, 12);
    expect(leanOf(Math.PI / 2, true)).toBeCloseTo(0, 12);
    expect(leanOf(Math.PI / 4, true)).toBeCloseTo(LEAN * Math.SQRT1_2, 12);
  });

  it('stands upright while standing', () => {
    expect(leanOf(0, false)).toBe(0);
  });
});

describe('handLamp — the flashlight in the hands', () => {
  const at = { x: 4.5, y: 2.5, facing: 0, moving: false };

  it('holds the lamp before the chest, toward where the figure faces', () => {
    expect(handLamp(at, 0.3, false)).toEqual({ x: 4.5 + HAND_AHEAD, y: 2.5, facing: 0 });
    const down = handLamp({ ...at, facing: Math.PI / 2 }, 0, false);
    expect(down.x).toBeCloseTo(4.5, 12);
    expect(down.y).toBeCloseTo(2.5 + HAND_DEPTH, 12);
  });

  it('sways the beam either way of the facing once a stride while walking', () => {
    const walking = { ...at, moving: true };
    const facings = overCycle(32, (phase) => handLamp(walking, phase, false).facing);
    expect(Math.max(...facings)).toBeCloseTo(SWAY, 6);
    expect(Math.min(...facings)).toBeCloseTo(-SWAY, 6);
    const lamp = handLamp({ ...at, moving: true }, 0.25, false);
    expect(lamp.y).not.toBe(2.5);
  });

  it('holds still for a player who asked for less motion', () => {
    for (const phase of [0.1, 0.25, 0.6]) {
      expect(handLamp({ ...at, moving: true }, phase, true)).toEqual(handLamp(at, 0, false));
    }
  });

  it('is where your flashlight shines from, its cone where the lamp points', () => {
    const sim = newSim(0);
    Object.assign(sim.self, { x: 3.5, y: 2.5, facing: 0, moving: true });
    sim.walkPhase = 0.25;
    const lamp = ownLamp(sim, false);
    const hand = handLamp(sim.self, 0.25, false);
    expect([lamp.x, lamp.y, lamp.beam?.facing]).toEqual([hand.x, hand.y, hand.facing]);
    expect(lamp.beam?.facing).toBeCloseTo(SWAY, 12);
  });
});

describe('followOthers — a partner’s legs keep pace with the ground they cover', () => {
  /**
   * A partner running east at `speed` tiles a second, sampled every 80 ms and drawn
   * REMOTE_DELAY_MS behind, over `frames` frames: their walk phase, short of a whole cycle at
   * either pace.
   */
  function phaseAfter(speed: number, frames = 18): number {
    const sim = newSim(0);
    for (let i = 0; i < frames; i++) {
      const now = 1_000 + (i * 1000) / 60;
      const t = Math.floor(now / 80) * 80;
      const pos = { x: 2 + (speed * t) / 1000, y: 2.5, facing: 0, moving: true, t, rt: t };
      followOthers(sim, { p2: pos }, 'p1', now - REMOTE_DELAY_MS);
    }
    return sim.others.get('p2')?.phase ?? Number.NaN;
  }

  it('swings a sprinting partner’s legs faster than a walking one’s', () => {
    const walking = phaseAfter(WALK_SPEED);
    const sprinting = phaseAfter(WALK_SPEED * SPRINT_FACTOR);
    expect(walking).toBeGreaterThan(0);
    expect(sprinting).toBeLessThan(1);
    expect(sprinting / walking).toBeCloseTo(SPRINT_FACTOR, 6);
  });

  it('keeps a partner’s legs still while they stand', () => {
    const sim = newSim(0);
    const standing = { x: 2, y: 2.5, facing: 0, moving: false, t: null };
    followOthers(sim, { p2: { ...standing, rt: 0 } }, 'p1', 0);
    followOthers(sim, { p2: { ...standing, facing: 1, rt: 80 } }, 'p1', 40);
    followOthers(sim, { p2: { ...standing, facing: 1, rt: 80 } }, 'p1', 120);
    expect(sim.others.get('p2')?.phase).toBe(0);
    expect(sim.others.get('p2')?.moving).toBe(false);
  });
});

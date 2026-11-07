import { describe, expect, it } from 'vitest';
import {
  BEAM_EDGE,
  BEAM_STEPS,
  beamAcross,
  beamSpread,
  beamStep,
  clearAlong,
  CORE_EDGE,
  CORE_HALF,
  FLANK,
  glossy,
} from '../src/world/beam.js';
import { TAU } from '../src/world/brush.js';

const HALF = 0.5;

describe('beamAcross — a flashlight’s light across its beam', () => {
  it('clears all of the dark along its axis, FLANK of it on its flanks, none past its edge', () => {
    expect(beamAcross(0, HALF)).toBe(1);
    const flank = CORE_HALF + CORE_EDGE + 0.01;
    expect(flank).toBeLessThan(HALF - BEAM_EDGE);
    expect(beamAcross(flank, HALF)).toBeCloseTo(FLANK, 6);
    expect(beamAcross(beamSpread(HALF), HALF)).toBe(0);
    expect(beamAcross(HALF + 1, HALF)).toBe(0);
  });

  it('is brighter in its core than on its flanks, and soft at its edge: no line anywhere', () => {
    let last = beamAcross(0, HALF);
    for (let off = 0.005; off <= beamSpread(HALF); off += 0.005) {
      const now = beamAcross(off, HALF);
      expect(now).toBeLessThanOrEqual(last + 1e-12);
      // A step of 0.005 rad never drops more than a few per cent: the edges fade.
      expect(last - now).toBeLessThan(0.05);
      expect(beamAcross(-off, HALF)).toBeCloseTo(now, 12);
      last = now;
    }
  });

  it('halves at its nominal half-angle, the edge fading either way of it', () => {
    expect(beamAcross(HALF, HALF)).toBeCloseTo(FLANK / 2, 6);
  });
});

describe('beamStep — the step of a turn a beam is baked at', () => {
  it('rounds to a degree and wraps round the turn either way', () => {
    expect(BEAM_STEPS).toBe(360);
    expect(beamStep(0)).toBe(0);
    expect(beamStep(Math.PI)).toBe(180);
    expect(beamStep(TAU)).toBe(0);
    expect(beamStep(-TAU / 360)).toBe(359);
    expect(beamStep((10.4 / 360) * TAU)).toBe(10);
  });
});

describe('glossy — the floors a beam leaves a streak on', () => {
  it('is lino and steel, not concrete, planks nor an unnamed room', () => {
    for (const kind of ['lab', 'server', 'reactor', 'control'] as const) {
      expect(glossy(kind)).toBe(true);
    }
    for (const kind of ['corridor', 'archive', 'machine', 'plain'] as const) {
      expect(glossy(kind)).toBe(false);
    }
    expect(glossy(undefined)).toBe(false);
  });
});

describe('clearAlong — how far a beam runs over floor in its sight', () => {
  const sight = { tiles: new Set(['1,1', '2,1', '3,1', '4,1']) };

  it('ends before the first tile out of sight ahead', () => {
    // From (1.5, 1.5) east, a point every quarter tile: the last on (4, 1) lies 3.25 tiles on.
    expect(clearAlong(sight, { x: 1.5, y: 1.5, facing: 0 }, 6)).toBe(3.25);
  });

  it('runs its whole way where nothing ends it, to its own tile’s edge where it leaves', () => {
    expect(clearAlong(sight, { x: 1.5, y: 1.5, facing: 0 }, 2)).toBe(2);
    expect(clearAlong(sight, { x: 1.5, y: 1.5, facing: Math.PI / 2 }, 6)).toBe(0.25);
  });
});

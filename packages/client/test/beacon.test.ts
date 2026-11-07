import { describe, expect, it } from 'vitest';
import {
  BEACON_STOPS,
  BEACON_TINT,
  BEACON_TURN_MS,
  BEACON_TURN_REDUCED_MS,
  beaconAngle,
  beaconPhase,
  LOBE_HALF,
  LOBE_REACH,
  LOBE_SOFT,
  LOBE_SPREAD,
  lobesAt,
  lobesOut,
} from '../src/world/beacon.js';
import { TAU } from '../src/world/brush.js';
import { beaconLights, tintOf } from '../src/world/gl/sources.js';
import { lampSources } from '../src/world/sources.js';
import { frameWith, lightWith, lit } from './frames.js';

/** How far `b` lies on from `a` round a turn, 0 to 2π. */
const turnedFrom = (a: number, b: number): number => (((b - a) % TAU) + TAU) % TAU;

describe('beaconAngle — a turn every 3 s, a slow 6 s sweep under less motion', () => {
  it('turns a full circle in BEACON_TURN_MS, a third of it a second', () => {
    expect(BEACON_TURN_MS).toBe(3000);
    const at0 = beaconAngle(0, 0.25, false);
    expect(beaconAngle(3000, 0.25, false)).toBeCloseTo(at0, 9);
    expect(turnedFrom(at0, beaconAngle(1000, 0.25, false))).toBeCloseTo(TAU / 3, 9);
    expect(turnedFrom(at0, beaconAngle(750, 0.25, false))).toBeCloseTo(TAU / 4, 9);
  });

  it('turns at half that pace where the player asked for less motion', () => {
    expect(BEACON_TURN_REDUCED_MS).toBe(6000);
    const at0 = beaconAngle(0, 0.1, true);
    expect(turnedFrom(at0, beaconAngle(1000, 0.1, true))).toBeCloseTo(TAU / 6, 9);
    expect(beaconAngle(6000, 0.1, true)).toBeCloseTo(at0, 9);
  });

  it('turns smoothly, every moment its own angle, from 0 to under 2π', () => {
    const angles = Array.from({ length: 200 }, (_, i) => beaconAngle(i * 17, 0.6, false));
    for (const angle of angles) {
      expect(angle).toBeGreaterThanOrEqual(0);
      expect(angle).toBeLessThan(TAU);
    }
    // 17 ms on, 17/3000 of a turn: no step of the 15 Hz animation clock.
    expect(turnedFrom(angles[0] ?? 0, angles[1] ?? 0)).toBeCloseTo((17 / 3000) * TAU, 9);
  });

  it('starts every lamp at a phase of its own, from where it hangs, the same every run', () => {
    const phases = [
      beaconPhase({ x: 15.5, y: 9.05 }),
      beaconPhase({ x: 20.5, y: 9.05 }),
      beaconPhase({ x: 6.5, y: 14.05 }),
    ];
    expect(new Set(phases.map((p) => p.toFixed(6))).size).toBe(3);
    expect(beaconPhase({ x: 15.5, y: 9.05 })).toBe(phases[0]);
    for (const phase of phases) {
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(1);
    }
  });
});

describe('the lobes — two, opposite, those turned into the wall left out', () => {
  it('points the two lobes opposite each other', () => {
    for (const angle of [0, 1, Math.PI, 4, TAU - 0.01]) {
      const [first, second] = lobesAt(angle);
      expect(first).toBe(angle);
      expect(turnedFrom(first, second)).toBeCloseTo(Math.PI, 9);
      expect(second).toBeLessThan(TAU);
    }
  });

  it('keeps both of a lamp on the ceiling, and of one on a wall those leaving the wall', () => {
    const ceiling = { facing: null };
    expect(lobesOut(ceiling, 1)).toHaveLength(2);
    // On a north wall, looking south: a lobe pointing south lights the room, north the wall.
    const wall = { facing: Math.PI / 2 };
    expect(lobesOut(wall, Math.PI / 2)).toEqual([Math.PI / 2]);
    expect(lobesOut(wall, -Math.PI / 2 + TAU)).toEqual([Math.PI / 2]);
    // Along the wall both graze the room: both kept.
    expect(lobesOut(wall, 0)).toHaveLength(2);
    // Just past the wall's plane, the lobe's soft edge still reaches out.
    expect(lobesOut(wall, Math.PI + LOBE_SPREAD * 0.9)).toHaveLength(2);
  });
});

describe('beaconLights — the light layer lights each lobe as a light that moves', () => {
  const mount = { x: 15.5, y: 9.05, facing: Math.PI / 2 };
  const lamps = [{ mount, lit: lit({ x: 15.5, y: 9.05, glow: LOBE_REACH }) }];

  it('lights two red beams a burning lamp, opposite, falling off, their edges soft', () => {
    const frame = frameWith({ time: 1.25, light: lightWith({ lamps }) });
    const lights = beaconLights(frame);
    expect(lights).toHaveLength(2);
    const [first, second] = lights;
    const angle = beaconAngle(1250, beaconPhase(mount), false);
    expect(first?.beam).toEqual({
      facing: angle,
      halfAngle: LOBE_HALF,
      reach: LOBE_REACH,
      stops: BEACON_STOPS,
      soft: LOBE_SOFT,
    });
    expect(turnedFrom(first?.beam?.facing ?? 0, second?.beam?.facing ?? 0)).toBeCloseTo(
      Math.PI,
      9,
    );
    expect(first?.tint).toEqual(tintOf(BEACON_TINT));
    expect(first?.glow).toBeNull();
    // Walls stop it: it has a size, as every light that throws shadows.
    expect(first?.size).toBeGreaterThan(0);
    expect(first?.colour[0]).toBe(255);
    expect(first?.colour[1]).toBeLessThan(80);
  });

  it('turns them as the run goes on, and half as fast under less motion', () => {
    const at = (time: number, reduced: boolean): number =>
      beaconLights(frameWith({ time, reduced, light: lightWith({ lamps }) }))[0]?.beam?.facing ??
      NaN;
    expect(turnedFrom(at(2, false), at(3, false))).toBeCloseTo(TAU / 3, 9);
    expect(turnedFrom(at(2, true), at(3, true))).toBeCloseTo(TAU / 6, 9);
  });

  it('lights none while no lamp burns: the power on, or every room lit again', () => {
    expect(beaconLights(frameWith({ light: lightWith({ lamps: [] }) }))).toEqual([]);
  });

  it('holds the lamps’ tubes still, without a flicker, under less motion', () => {
    const light = lightWith({ lamps });
    expect(lampSources(frameWith({ light }))[0]?.tremble).toBe(true);
    expect(lampSources(frameWith({ light, reduced: true }))[0]?.tremble).toBeUndefined();
  });
});

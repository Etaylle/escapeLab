import { describe, expect, it } from 'vitest';
import {
  CREW_GLOW_STOPS,
  DRONE_BEAM_STOPS,
  EMERGENCY_STOPS,
  OWN_BEAM_STOPS,
  OWN_GLOW_STOPS,
} from '../src/world/light.js';
import {
  flickerAt,
  FLOATS_PER_SOURCE,
  packLights,
  profileOf,
  pulseAt,
  strengthAt,
  viewOf,
  type TileView,
} from '../src/world/gl/pack.js';
import { MAX_SOURCES } from '../src/world/gl/shaders.js';
import type { Light } from '../src/world/gl/sources.js';
import { frameWith } from './frames.js';

/** A light with a glow of `reach` at (x, y), `strength` strong, and `parts`. */
function light(x: number, y: number, strength = 1, parts: Partial<Light> = {}): Light {
  return {
    x,
    y,
    colour: [255, 128, 0],
    glow: { reach: 2, stops: CREW_GLOW_STOPS },
    beam: null,
    tint: null,
    size: 0.2,
    strength,
    ...parts,
  };
}

/** The world from (0, 0) to (20, 12), in tiles. */
const VIEW: TileView = { left: 0, top: 0, right: 20, bottom: 12 };

/** The floats of light number `i` in a packing. */
function floats(data: Float32Array, i: number): number[] {
  return [...data.slice(i * FLOATS_PER_SOURCE, (i + 1) * FLOATS_PER_SOURCE)];
}

describe('profileOf — the Canvas pass’s stops as the light pass takes them', () => {
  it('takes stops of three as they are, and makes stops of two a straight line', () => {
    expect(profileOf(OWN_GLOW_STOPS)).toEqual([1, 0.7, 1]);
    expect(profileOf(OWN_BEAM_STOPS)).toEqual([1, 0.45, 0.8]);
    expect(profileOf(DRONE_BEAM_STOPS)).toEqual([0.9, 0.5, 0.45]);
  });

  it('turns away stops that do not run from the middle out to nothing at the rim', () => {
    expect(() => profileOf([[0.1, 1], [1, 0]])).toThrow(/offset 0 to \[1, 0\]/);
    expect(() => profileOf([[0, 1], [1, 0.2]])).toThrow(/offset 0 to \[1, 0\]/);
    expect(() => profileOf([[0, 1], [0.3, 0.5], [0.6, 0.2], [1, 0]])).toThrow(/two or three/);
  });
});

describe('pulses and flickers, worked out per moment', () => {
  it('dips a pulse by its depth and back over its period, full without one', () => {
    const pulse = { periodMs: 1000, depth: 0.6 };
    expect(pulseAt(undefined, 123)).toBe(1);
    expect(pulseAt(pulse, 250)).toBeCloseTo(1);
    expect(pulseAt(pulse, 750)).toBeCloseTo(0.4);
    expect(pulseAt(pulse, 0)).toBeCloseTo(0.7);
    expect(pulseAt(pulse, 1250)).toBeCloseTo(pulseAt(pulse, 250));
  });

  it('burns the emergency lamps’ pulse as the Canvas pass burns them: 0.7 + 0.3·sin(2.4·t)', () => {
    const burn = { periodMs: ((2 * Math.PI) / 2.4) * 1000, depth: 0.6 };
    for (const t of [0, 0.4, 1.3, 2.9, 7.7]) {
      expect(pulseAt(burn, t * 1000)).toBeCloseTo(0.7 + 0.3 * Math.sin(2.4 * t), 9);
    }
  });

  it('flickers the same for the same moment, steadily within a step, near full mostly', () => {
    expect(flickerAt(7, 1234)).toBe(flickerAt(7, 1234));
    expect(flickerAt(7, 1000)).toBe(flickerAt(7, 1000 + 1000 / 14 - 1));
    const run = Array.from({ length: 400 }, (_, i) => flickerAt(7, i * 71));
    expect(Math.min(...run)).toBeGreaterThanOrEqual(0.3);
    expect(Math.max(...run)).toBeLessThanOrEqual(1);
    expect(new Set(run).size).toBeGreaterThan(50);
    const drops = run.filter((v) => v === 0.3).length;
    expect(drops).toBeGreaterThan(0);
    expect(drops).toBeLessThan(run.length / 4);
    // Two lights hanging elsewhere do not flicker in step.
    const other = Array.from({ length: 400 }, (_, i) => flickerAt(91, i * 71));
    expect(other).not.toEqual(run);
  });

  it('scales a light by its strength, its pulse and its flicker', () => {
    const pulsing = light(1, 1, 0.5, { pulse: { periodMs: 1000, depth: 0.6 } });
    expect(strengthAt(pulsing, 750)).toBeCloseTo(0.2);
    const flickering = light(1, 1, 1, { flicker: true });
    const seen = new Set(Array.from({ length: 200 }, (_, i) => strengthAt(flickering, i * 50)));
    expect(seen.size).toBeGreaterThan(1);
    expect(strengthAt(light(1, 1, 0.8), 999)).toBe(0.8);
  });
});

describe('packLights — the lights as the light pass reads them', () => {
  it('writes a light’s place, reach, falloff, beam, colour and tint', () => {
    const beam = { facing: Math.PI / 2, halfAngle: 0.5, reach: 7.5, stops: OWN_BEAM_STOPS };
    const tint = { amount: 0.85, knee: 0.12, atKnee: 0.5, atHalf: 0.2, white: 0.3 };
    const glow = { reach: 3.2, stops: OWN_GLOW_STOPS };
    const lamp = light(3, 4, 0.5, { glow, beam, tint: { ...tint, whiteAtKnee: 0.05 } });
    const { data, count } = packLights([lamp], 0, VIEW);
    expect(count).toBe(1);
    const f = floats(data, 0);
    const near = (v: number): unknown => expect.closeTo(v);
    expect(f.slice(0, 8)).toEqual([3, 4, near(0.2), near(3.2), 0.5, near(0.7), 0.5, 7.5]);
    expect(f[8]).toBeCloseTo(0);
    expect(f[9]).toBeCloseTo(1);
    expect(f[10]).toBeCloseTo(Math.cos(0.56));
    expect(f[11]).toBeCloseTo(Math.cos(0.44));
    expect(f.slice(12, 16)).toEqual([0.5, near(0.45), near(0.4), near(0.425)]);
    expect(f.slice(16, 20)).toEqual([1, near(128 / 255), 0, near(0.3)]);
    expect(f.slice(20, 24)).toEqual([near(0.12), 0.5, near(0.05), near(0.2)]);
  });

  it('marks a light walls do not stop, and writes no reach for what it lacks', () => {
    const glow = light(5, 5, 1, { size: null });
    const beamOnly = light(6, 6, 1, {
      glow: null,
      beam: { facing: 0, halfAngle: 0.3, reach: 4, stops: DRONE_BEAM_STOPS },
    });
    const { data } = packLights([glow, beamOnly], 0, VIEW);
    expect(floats(data, 0)[2]).toBe(-1);
    expect(floats(data, 0)[7]).toBe(0);
    expect(floats(data, 1)[3]).toBe(0);
    expect(floats(data, 1)[7]).toBe(4);
  });

  it('keeps the strongest lights first, ties in order, the faint and the far away left out', () => {
    const lights = [
      light(1, 1, 0.3),
      light(2, 2, 0.9),
      light(3, 3, 0.6),
      light(4, 4, 0.6, { colour: [1, 2, 3] }),
      light(5, 5, 0.0001),
      light(40, 5, 1),
      light(21.5, 5, 1),
    ];
    const { data, count, dropped } = packLights(lights, 0, VIEW);
    expect(count).toBe(5);
    expect(dropped).toBe(0);
    // Strength by its brightest: 21.5 burns full, 2 at 0.9 of it; 3 and 4 tie, in their order.
    expect([0, 1, 2, 3, 4].map((i) => floats(data, i)[0])).toEqual([21.5, 2, 3, 4, 1]);
  });

  it('keeps at most MAX_SOURCES lights, the dimmest dropped, however many are in view', () => {
    const lights = Array.from({ length: MAX_SOURCES + 8 }, (_, i) =>
      light(1 + (i % 18), 1 + Math.floor(i / 18), 0.1 + i / 100),
    );
    const { data, count, dropped } = packLights(lights, 0, VIEW);
    expect(count).toBe(MAX_SOURCES);
    expect(dropped).toBe(8);
    const strengths = Array.from({ length: count }, (_, i) => floats(data, i)[4] ?? 0);
    expect(strengths).toEqual([...strengths].sort((a, b) => b - a));
    expect(Math.min(...strengths)).toBeCloseTo(0.9 * (0.1 + 8 / 100));
  });

  it('works pulses out for the moment it packs, into the floats it is handed', () => {
    const into = new Float32Array(MAX_SOURCES * FLOATS_PER_SOURCE);
    const pulsing = light(2, 2, 1, {
      pulse: { periodMs: 1000, depth: 0.6 },
      glow: { reach: 1.5, stops: EMERGENCY_STOPS },
    });
    const at = (ms: number): number =>
      floats(packLights([pulsing], ms, VIEW, into).data, 0)[4] ?? 0;
    expect(packLights([pulsing], 0, VIEW, into).data).toBe(into);
    expect(at(250)).toBeCloseTo(0.55);
    expect(at(750)).toBeCloseTo(0.55 * 0.4);
  });

  it('reads what the camera of a frame shows, in tiles', () => {
    const frame = frameWith({ camera: { x: 5, y: 3, scale: 100 } });
    expect(viewOf(frame)).toEqual({ left: 1, top: 0, right: 9, bottom: 6 });
  });
});

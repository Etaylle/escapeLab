import { describe, expect, it } from 'vitest';
import {
  CREW_GLOW_STOPS,
  DRONE_BEAM_STOPS,
  EMERGENCY_GLOW,
  EMERGENCY_STOPS,
  EMERGENCY_TINT,
  HATCH_TINT,
  objectGlowStops,
  OWN_BEAM_STOPS,
  OWN_GLOW_STOPS,
  SPILL_STOPS,
  spillTint,
} from '../src/world/light.js';
import { strengthAt } from '../src/world/gl/pack.js';
import {
  colouredSources,
  fromSource,
  lightsOf,
  tintOf,
  type Light,
  type LightSource,
} from '../src/world/gl/sources.js';
import { objectGlows } from '../src/world/render/darkness.js';
import { mapWith } from './fixtures.js';
import { frameWith, lightWith, lit, TILES } from './frames.js';

const beam = { facing: 0.4, halfAngle: 0.5, reach: 7.5 };

/** The lights of `lights` standing at (x, y). */
function at(lights: readonly Light[], x: number, y: number): Light[] {
  return lights.filter((light) => light.x === x && light.y === y);
}

describe('lightsOf — what the light layer lights in a frame', () => {
  it('lights your flashlight, glow and cone, with the Canvas pass’s falloffs', () => {
    const own = lit({ x: 2.5, y: 2.5, glow: 3.2, beam });
    const [lamp] = at(lightsOf(frameWith({ light: lightWith({ own }) })), 2.5, 2.5);
    expect(lamp?.glow).toEqual({ reach: 3.2, stops: OWN_GLOW_STOPS });
    expect(lamp?.beam).toEqual({ ...beam, stops: OWN_BEAM_STOPS });
    expect(lamp?.tint).toBeNull();
    expect(lamp?.size).toBeGreaterThan(0);
    expect(lamp?.strength).toBe(1);
  });

  it('lights the lamps the rest of the crew carry', () => {
    const crew = [lit({ x: 6.5, y: 3.5, glow: 2.8 })];
    const [lamp] = at(lightsOf(frameWith({ light: lightWith({ crew }) })), 6.5, 3.5);
    expect(lamp?.glow).toEqual({ reach: 2.8, stops: CREW_GLOW_STOPS });
    expect(lamp?.beam).toBeNull();
  });

  it('lights a drone’s cone with the glimmer round it, a frozen drone’s glimmer only', () => {
    const drone = { range: 4, halfAngleDeg: 30, alerted: false, facing: 1 };
    const drones = {
      d1: { ...drone, x: 3, y: 3, frozen: false },
      d2: { ...drone, x: 7, y: 4, frozen: true },
    };
    const eye = lit({ x: 3, y: 3, glow: 0, beam: { facing: 1, halfAngle: 0.52, reach: 4 } });
    const light = lightWith({ eyes: new Map([['d1', eye]]) });
    const lights = lightsOf(frameWith({ drones, light }));
    const [looking] = at(lights, 3, 3);
    const stops = DRONE_BEAM_STOPS;
    expect(looking?.beam).toEqual({ facing: 1, halfAngle: 0.52, reach: 4, stops });
    expect(looking?.glow).toEqual({ reach: 1.1, stops: objectGlowStops(0.75) });
    expect(looking?.size).not.toBeNull();
    const [frozen] = at(lights, 7, 4);
    expect(frozen?.beam).toBeNull();
    expect(frozen?.glow).toEqual({ reach: 0.9, stops: objectGlowStops(0.5) });
    expect(frozen?.size).toBeNull();
  });

  it('lights the burning emergency lamps red, pulsing as the Canvas pass burns them', () => {
    const mount = { x: 1.5, y: 1.5, facing: null };
    const lamps = [{ mount, lit: lit({ x: 1.5, y: 1.5, glow: EMERGENCY_GLOW }) }];
    for (const time of [0, 0.8, 2.2]) {
      const burn = 0.7 + 0.3 * Math.sin(2.4 * time);
      const frame = frameWith({ light: lightWith({ lamps }), time, burn });
      const [lamp] = at(lightsOf(frame), 1.5, 1.5);
      expect(lamp?.glow).toEqual({ reach: EMERGENCY_GLOW, stops: EMERGENCY_STOPS });
      expect(lamp?.colour).toEqual([255, 38, 32]);
      expect(lamp?.tint).toEqual(tintOf(EMERGENCY_TINT));
      expect(lamp === undefined ? 0 : strengthAt(lamp, time * 1000)).toBeCloseTo(frame.burn, 9);
    }
  });

  it('lights the open hatch as far as it stands open, and a lit room through an open door', () => {
    const exit = { lit: lit({ x: 8.5, y: 3.5, glow: 3.2 }), open: 0.4 };
    const wedge = { facing: 0, halfAngle: 0.62, reach: 3.2 };
    const spill = lit({ x: 5.9, y: 2.5, glow: 0, beam: wedge });
    const light = lightWith({ exit, spills: [{ lit: spill, open: 0.5 }] });
    const lights = lightsOf(frameWith({ light, red: 0 }));
    const [hatch] = at(lights, 8.5, 3.5);
    expect(hatch?.glow).toEqual({ reach: 3.2, stops: objectGlowStops(0.95) });
    expect(hatch?.tint).toEqual(tintOf(HATCH_TINT));
    expect(hatch?.strength).toBe(0.4);
    const [door] = at(lights, 5.9, 2.5);
    expect(door?.beam).toEqual({ facing: 0, halfAngle: 0.62, reach: 3.2, stops: SPILL_STOPS });
    expect(door?.tint).toEqual(tintOf(spillTint([255, 214, 168])));
    expect(door?.strength).toBe(0.5);
  });

  it('lights the glow of the lab’s objects, which no wall stops, as the Canvas pass does', () => {
    const map = mapWith({
      width: 10,
      height: 6,
      tiles: TILES,
      stations: [{ puzzleId: 's', x: 2, y: 2, title: 'S', status: 'armed' }],
      edgeworkSign: { x: 7, y: 1 },
    });
    const frame = frameWith({ map });
    const glows = lightsOf(frame).filter((light) => light.size === null);
    const read = glows.map(({ x, y, glow, strength }) => ({ x, y, reach: glow?.reach, strength }));
    const cut = objectGlows(frame);
    const asRead = cut.map(({ x, y, radius, strength }) => ({ x, y, reach: radius, strength }));
    expect(read).toEqual(asRead);
    expect(glows).toHaveLength(2);
  });

  it('lights nothing in a dark frame with no lamp, drone or object', () => {
    expect(lightsOf(frameWith())).toEqual([]);
  });
});

describe('the coloured lights, in world/sources.ts’s shape', () => {
  it('names the burning emergency lamps as LightSource: place, colour, reach, pulse', () => {
    const mount = { x: 4.5, y: 2.05, facing: Math.PI / 2 };
    const lamps = [{ mount, lit: lit({ x: 4.5, y: 2.05, glow: EMERGENCY_GLOW }) }];
    const [source] = colouredSources(frameWith({ light: lightWith({ lamps }) }));
    expect(source).toEqual({
      x: 4.5,
      y: 2.05,
      colour: [255, 38, 32],
      reach: EMERGENCY_GLOW,
      strength: 1,
      pulse: { periodMs: expect.closeTo((2 * Math.PI * 1000) / 2.4), depth: 0.6 },
    });
  });

  it('lights any LightSource as an emergency lamp is lit, in its colour, flickering', () => {
    const source: LightSource = {
      x: 9,
      y: 2,
      colour: [80, 255, 120],
      reach: 2,
      strength: 0.4,
      flicker: true,
    };
    const light = fromSource(source);
    expect(light).toMatchObject({ x: 9, y: 2, colour: [80, 255, 120], strength: 0.4 });
    expect(light.flicker).toBe(true);
    expect(light.glow).toEqual({ reach: 2, stops: EMERGENCY_STOPS });
    expect(light.tint).toEqual(tintOf(EMERGENCY_TINT));
    expect(light.size).not.toBeNull();
    expect('pulse' in light).toBe(false);
  });
});

describe('tintOf — a Canvas gradient of coloured light as the light pass draws it', () => {
  it('reads the emergency red’s strength, knee, halfway and how much whiter it burns', () => {
    const tint = tintOf(EMERGENCY_TINT);
    expect(tint.amount).toBe(0.85);
    expect(tint.knee).toBe(0.12);
    expect(tint.atKnee).toBeCloseTo(0.42 / 0.85);
    expect(tint.atHalf).toBeCloseTo(0.16 / 0.85);
    // (255, 112, 98) lies a third of the way from (255, 38, 32) to white; (255, 50, 42) barely.
    expect(tint.white).toBeCloseTo((74 / 217 + 66 / 223) / 2);
    expect(tint.whiteAtKnee).toBeCloseTo((12 / 217 + 10 / 223) / 2);
  });

  it('reads a gradient with no stop before halfway at a quarter of the way: a door’s spill', () => {
    const tint = tintOf(spillTint([255, 214, 168]));
    expect(tint.knee).toBe(0.25);
    expect(tint.amount).toBe(0.3);
    expect(tint.atKnee).toBeCloseTo((0.3 - (0.25 / 0.6) * 0.2) / 0.3);
    expect(tint.atHalf).toBeCloseTo((0.3 - (0.5 / 0.6) * 0.2) / 0.3);
    expect(tint.white).toBe(0);
  });

  it('turns away a gradient that does not start at the middle', () => {
    expect(() => tintOf([[0.2, [255, 0, 0], 1], [1, [255, 0, 0], 0]])).toThrow(/offset 0/);
  });
});

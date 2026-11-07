import { describe, expect, it } from 'vitest';
import type { DronePosition } from '@escapelab/core';
import {
  HOTSPOT_AT,
  NAV_HZ,
  NAV_ON,
  NAV_SIDE,
  navLights,
  navSpots,
  hotspotOf,
  rotorAngle,
  searchColour,
} from '../src/world/droneLights.js';
import { ALARM } from '../src/world/palette.js';

const DRONE: DronePosition = {
  x: 2.5,
  y: 2.5,
  facing: 0,
  range: 5,
  halfAngleDeg: 30,
  alerted: false,
  frozen: false,
};

/** A sight of the floor east of the drone, `tiles` long, on its row. */
function rowOf(tiles: number): { tiles: Set<string> } {
  return { tiles: new Set(Array.from({ length: tiles + 1 }, (_, i) => `${2 + i},2`)) };
}

describe('navLights — a drone’s red and green, blinking', () => {
  it('blinks each at NAV_HZ, burning NAV_ON of a beat, the green half a beat after the red', () => {
    expect(NAV_HZ).toBe(1);
    expect(navLights(0, 0, false)).toEqual({ port: 1, starboard: 0 });
    expect(navLights(NAV_ON * 1000 + 1, 0, false)).toEqual({ port: 0, starboard: 0 });
    expect(navLights(500, 0, false)).toEqual({ port: 0, starboard: 1 });
    expect(navLights(1000, 0, false)).toEqual({ port: 1, starboard: 0 });
    // Lit share over a second, sampled finely: NAV_ON of it each, never both at once.
    let red = 0;
    let both = 0;
    for (let ms = 0; ms < 1000; ms += 5) {
      const lights = navLights(ms, 0.3, false);
      red += lights.port;
      both += lights.port * lights.starboard;
    }
    expect(red / 200).toBeCloseTo(NAV_ON, 2);
    expect(both).toBe(0);
  });

  it('keeps each drone in its own step, and both lights steady under reduced motion', () => {
    expect(navLights(0, 0.6, false)).not.toEqual(navLights(0, 0, false));
    for (const ms of [0, 250, 500, 750]) {
      expect(navLights(ms, 0, true)).toEqual({ port: 1, starboard: 1 });
    }
  });
});

describe('navSpots — where a drone’s red and green hang', () => {
  it('hangs the red on its left and the green on its right as it faces, either way round', () => {
    const east = navSpots(DRONE);
    expect(east.port.y).toBeCloseTo(2.5 - NAV_SIDE, 12);
    expect(east.starboard.y).toBeCloseTo(2.5 + NAV_SIDE, 12);
    expect(east.port.x).toBeLessThan(2.5);
    const south = navSpots({ ...DRONE, facing: Math.PI / 2 });
    // Facing south, its left is east.
    expect(south.port.x).toBeCloseTo(2.5 + NAV_SIDE, 12);
    expect(south.starboard.x).toBeCloseTo(2.5 - NAV_SIDE, 12);
  });
});

describe('hotspotOf — where a drone’s searchlight falls brightest', () => {
  it('lies HOTSPOT_AT of its range ahead, where its eye looks, turning with it', () => {
    const spot = hotspotOf(DRONE, rowOf(6));
    expect(spot?.x).toBeCloseTo(2.5 + 5 * HOTSPOT_AT, 12);
    expect(spot?.y).toBeCloseTo(2.5, 12);
    const column = { tiles: new Set(['2,2', '2,3', '2,4', '2,5']) };
    const south = hotspotOf({ ...DRONE, facing: Math.PI / 2 }, column);
    expect(south?.x).toBeCloseTo(2.5, 12);
    expect(south?.y).toBeCloseTo(2.5 + 5 * HOTSPOT_AT, 12);
  });

  it('comes nearer where its sight ends first, and falls on no wall close ahead', () => {
    // Two tiles of floor ahead: 1.25 tiles to the last point on them, past half the way.
    const near = hotspotOf(DRONE, rowOf(2));
    expect(near?.x).toBeCloseTo(2.5 + 2.25, 12);
    expect(hotspotOf(DRONE, rowOf(0))).toBeNull();
  });

  it('is none for a frozen drone, which sees nothing', () => {
    expect(hotspotOf({ ...DRONE, frozen: true }, rowOf(6))).toBeNull();
  });
});

describe('searchColour and rotorAngle', () => {
  it('turns the searchlight red while the drone is alerted, amber-white otherwise', () => {
    expect(searchColour(true)).toEqual(ALARM);
    const [r, g, b] = searchColour(false);
    expect(r).toBeGreaterThan(b);
    expect(g).toBeGreaterThan(b);
  });

  it('turns the rotors’ blur with the clock, and holds it still under reduced motion', () => {
    expect(rotorAngle(0, false)).toBe(0);
    expect(rotorAngle(100, false)).toBeGreaterThan(0);
    expect(rotorAngle(100, true)).toBe(0);
    expect(rotorAngle(1234, true)).toBe(0);
  });
});

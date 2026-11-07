import { describe, expect, it } from 'vitest';
import type { DronePosition } from '@escapelab/core';
import { HOTSPOT_AT, HOTSPOT_R, navSpots, searchColour } from '../src/world/droneLights.js';
import { figurePhase } from '../src/world/figure.js';
import { lightsOf } from '../src/world/gl/sources.js';
import { drawDroneBody, drawDroneShadow } from '../src/world/hazards.js';
import { ALARM, css, DONE_GREEN, EMERGENCY, lift, sink } from '../src/world/palette.js';
import { drawDroneFlares, navOf } from '../src/world/render/drones.js';
import type { Frame, FrameLit } from '../src/world/render/frame.js';
import { callEntries, callsOf, fakeCanvas, setsOf } from './fakeCanvas.js';
import { frameWith, lightWith, lit } from './frames.js';

const DRONE: DronePosition = {
  x: 2.5,
  y: 2.5,
  facing: 0,
  range: 5,
  halfAngleDeg: 30,
  alerted: false,
  frozen: false,
};

/** The drone's eye, seeing the floor east of it along its row. */
function eye(): FrameLit {
  const tiles = new Set(Array.from({ length: 7 }, (_, i) => `${2 + i},2`));
  const sight = { tiles, walls: new Set<string>(), outline: [] };
  return { ...lit({ x: 2.5, y: 2.5, glow: 0, beam: null }), sight };
}

/** A frame with the drone `d1` as `drone` is, its eye `eyes` gives, `time` s into the run. */
function withDrone(drone: DronePosition, time: number, eyes = new Map([['d1', eye()]])): Frame {
  return frameWith({ drones: { d1: drone }, time, light: lightWith({ eyes }) });
}

/** The time into the run, s, at which drone `d1`'s red burns and its green does not. */
function redOnly(): number {
  for (let ms = 0; ms < 1000; ms += 10) {
    const nav = navOf(frameWith({ time: ms / 1000 }), 'd1');
    if (nav.port === 1 && nav.starboard === 0) {
      return ms / 1000;
    }
  }
  throw new Error('no moment with the red alone');
}

describe('drawDroneFlares — a drone’s hotspot and nav lights over the light', () => {
  it('adds the hotspot ahead where the eye looks, and the glow of the light that burns', () => {
    const frame = withDrone(DRONE, redOnly());
    const { ctx, log } = fakeCanvas(800, 600);
    drawDroneFlares(ctx, frame);
    const laid = callEntries(log, 'drawImage');
    expect(laid.every((e) => e.op === 'lighter')).toBe(true);
    // The hotspot: HOTSPOT_AT of the range ahead, 100 px a tile round (5, 3) — then the red.
    const [spot, red] = laid;
    const r = Math.ceil(HOTSPOT_R * 100) + 1;
    const x = 400 + (2.5 + 5 * HOTSPOT_AT - 5) * 100;
    expect(spot?.args.slice(1)).toEqual([Math.round(x) - r, 250 - r]);
    const port = navSpots(DRONE).port;
    expect(red?.args[2]).toBe(Math.round(300 + (port.y - 3) * 100) - 21);
    expect(laid).toHaveLength(2);
  });

  it('turns the hotspot red while the drone is alerted', () => {
    const calm = fakeCanvas(800, 600);
    drawDroneFlares(calm.ctx, withDrone(DRONE, redOnly()));
    const alerted = fakeCanvas(800, 600);
    drawDroneFlares(alerted.ctx, withDrone({ ...DRONE, alerted: true }, redOnly()));
    const sprite = (log: typeof calm.log) => callEntries(log, 'drawImage')[0]?.args[0];
    expect(sprite(alerted.log)).not.toBe(sprite(calm.log));
    expect(searchColour(true)).toEqual(ALARM);
  });

  it('lights nothing of a frozen drone, and no hotspot for an eye that sees no floor ahead', () => {
    const frozen = fakeCanvas(800, 600);
    drawDroneFlares(frozen.ctx, withDrone({ ...DRONE, frozen: true }, redOnly()));
    expect(callEntries(frozen.log, 'drawImage')).toEqual([]);
    const blind = fakeCanvas(800, 600);
    drawDroneFlares(blind.ctx, withDrone(DRONE, redOnly(), new Map()));
    // The red alone: no eye, no hotspot.
    expect(callEntries(blind.log, 'drawImage')).toHaveLength(1);
    const none = fakeCanvas(800, 600);
    drawDroneFlares(none.ctx, frameWith());
    expect(none.log).toEqual([]);
  });

  it('keeps both nav lights burning under reduced motion', () => {
    const { ctx, log } = fakeCanvas(800, 600);
    drawDroneFlares(ctx, { ...withDrone(DRONE, redOnly()), reduced: true });
    expect(callEntries(log, 'drawImage')).toHaveLength(3);
    expect(navOf({ ...frameWith(), reduced: true }, 'd1')).toEqual({ port: 1, starboard: 1 });
    expect(figurePhase('d1')).toBeGreaterThanOrEqual(0);
  });
});

describe('drawDroneBody and drawDroneShadow — the drone itself', () => {
  it('turns its rotors’ blur round the body: a ring, two streaks where the clock has them', () => {
    const { ctx, log } = fakeCanvas(100, 100);
    drawDroneBody(ctx, DRONE, { nav: { port: 1, starboard: 0 }, rotor: 1 });
    const arcs = callsOf(log, 'arc').filter(([, , r]) => r === 0.37);
    expect(arcs.map(([, , , from]) => from)).toEqual([0, 1, 1 + Math.PI]);
  });

  it('lights its red and darkens its green as they burn, both dark on a frozen drone', () => {
    const { ctx, log } = fakeCanvas(100, 100);
    drawDroneBody(ctx, DRONE, { nav: { port: 1, starboard: 0 }, rotor: 0 });
    const fills = setsOf(log, 'fillStyle');
    expect(fills).toContain(css(lift(EMERGENCY, 0.35)));
    expect(fills).toContain(css(sink(DONE_GREEN, 0.65)));
    const frozen = fakeCanvas(100, 100);
    const burning = { nav: { port: 1, starboard: 1 }, rotor: 0 };
    drawDroneBody(frozen.ctx, { ...DRONE, frozen: true }, burning);
    const dark = setsOf(frozen.log, 'fillStyle');
    expect(dark).toContain(css(sink(EMERGENCY, 0.65)));
    expect(dark).not.toContain(css(lift(EMERGENCY, 0.35)));
  });

  it('casts a soft shadow: a gradient falling off to its rim, not a filled ellipse', () => {
    const { ctx, log } = fakeCanvas(100, 100);
    drawDroneShadow(ctx, DRONE);
    expect(callsOf(log, 'ellipse')).toEqual([]);
    expect(callsOf(log, 'createRadialGradient')).toHaveLength(1);
  });
});

describe('lightsOf — a drone’s eye on the light layer', () => {
  it('lights red while the drone is alerted, cold white otherwise', () => {
    const beam = { facing: 0, halfAngle: 0.5, reach: 5 };
    const eyes = new Map([['d1', lit({ x: 2.5, y: 2.5, glow: 0, beam })]]);
    const colour = (alerted: boolean) =>
      lightsOf(frameWith({ drones: { d1: { ...DRONE, alerted } }, light: lightWith({ eyes }) }))
        .find((light) => light.x === 2.5 && light.beam !== null)?.colour;
    expect(colour(true)).toEqual(ALARM);
    expect(colour(false)).not.toEqual(ALARM);
  });
});

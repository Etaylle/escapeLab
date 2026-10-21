import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DronePosition, MapView } from '@escapelab/core';
import {
  distanceGain,
  MUFFLE_HZ,
  panOf,
  PAN_SPAN,
  placeOf,
  STEP_TILES,
  type CrewScene,
} from '../src/world/spatial.js';
import { WALL_SHARE } from '../src/voice/rules.js';
import type {
  FakeGain,
  FakeOscillator,
  FakePanner} from './fakeGraph.js';
import {
  downstream,
  fakeGraph,
  lastContext,
  type FakeFilter,
  type FakeNode,
} from './fakeGraph.js';

/**
 * Two rooms joined by a corridor: the west room (1–5), a wall at x 6 with a door at (6, 2),
 * the east room (7–13).
 */
const MAP: Pick<MapView, 'tiles' | 'doors'> = {
  tiles: [
    '###############',
    '#.....#.......#',
    '#.............#',
    '#.....#.......#',
    '###############',
  ],
  doors: [{ id: 'door', x: 6, y: 2, open: false }],
};
const OPEN: Pick<MapView, 'tiles' | 'doors'> = {
  ...MAP,
  doors: [{ id: 'door', x: 6, y: 2, open: true }],
};

describe('where a sound sits', () => {
  it('pans by how far to the side it is: all one side at PAN_SPAN tiles', () => {
    expect(PAN_SPAN).toBe(6);
    expect(panOf(0)).toBe(0);
    expect(panOf(3)).toBe(0.5);
    expect(panOf(-6)).toBe(-1);
    expect(panOf(-20)).toBe(-1);
    expect(panOf(9)).toBe(1);
  });

  it('plays in full within 2 tiles and fades out by 10', () => {
    expect(distanceGain(0)).toBe(1);
    expect(distanceGain(2)).toBe(1);
    expect(distanceGain(6)).toBe(0.5);
    expect(distanceGain(10)).toBe(0);
    expect(distanceGain(14)).toBe(0);
  });

  it('muffles a sound behind a wall or a shut door, at the share a voice keeps through one', () => {
    const shut = new Set(['6,2']);
    const through = placeOf(MAP, shut, { x: 4.5, y: 2.5 }, { x: 8.5, y: 2.5 });
    expect(through).toEqual({ pan: 4 / PAN_SPAN, gain: 0.75 * WALL_SHARE, muffled: true });
    const clear = placeOf(OPEN, new Set(), { x: 4.5, y: 2.5 }, { x: 8.5, y: 2.5 });
    expect(clear).toEqual({ pan: 4 / PAN_SPAN, gain: 0.75, muffled: false });
    const left = placeOf(OPEN, new Set(), { x: 8.5, y: 2.5 }, { x: 2.5, y: 2.5 });
    expect(left.pan).toBe(-1);
  });
});

describe('the crew and the drones, heard', () => {
  beforeEach(() => {
    fakeGraph();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function spatial() {
    vi.resetModules();
    const module = await import('../src/world/spatial.js');
    // The engine, made on first use: the partner's first step makes it.
    (await import('../src/world/audio.js')).sharedAudio();
    return { module, ctx: lastContext() };
  }

  const crew = (
    map: Pick<MapView, 'tiles' | 'doors'>,
    rx: number,
    moving: boolean,
    now: number,
    drones: Record<string, DronePosition> = {},
  ): CrewScene => ({
    map,
    self: { x: 4.5, y: 2.5 },
    others: new Map([['ben', { rx, ry: 2.5, moving }]]),
    drones,
    now,
  });

  /** The panners made, by the pan they were set to. */
  const pans = (ctx: ReturnType<typeof lastContext>): number[] =>
    ctx.all<FakePanner>('panner').map((panner) => panner.pan.value);

  it('steps for a partner every half tile they walk, placed where they are', async () => {
    const { module, ctx } = await spatial();
    module.hearCrew(crew(OPEN, 8.5, true, 0));
    expect(pans(ctx)).toEqual([]);
    module.hearCrew(crew(OPEN, 8.5 + STEP_TILES * 0.6, true, 16));
    expect(pans(ctx)).toEqual([]); // not half a tile yet
    module.hearCrew(crew(OPEN, 8.5 + STEP_TILES * 1.2, true, 32));
    expect(pans(ctx)).toEqual([(8.5 + STEP_TILES * 1.2 - 4.5) / PAN_SPAN]);
    const [panner] = ctx.all<FakePanner>('panner');
    // The thump's sine and the scuff come through the placing chain into the master gain.
    const into = ctx.all<FakeOscillator>('oscillator').filter((osc) =>
      downstream(osc).has(panner as FakeNode),
    );
    expect(into).toHaveLength(1);
  });

  it('muffles a partner’s steps behind a shut door; nobody standing still steps', async () => {
    const { module, ctx } = await spatial();
    module.hearCrew(crew(MAP, 8.5, true, 0));
    module.hearCrew(crew(MAP, 9.1, true, 16));
    const [panner] = ctx.all<FakePanner>('panner');
    const lowpass = ctx
      .all<FakeFilter>('biquad')
      .find((filter) => filter.outputs.includes(panner as FakeNode));
    expect(lowpass?.frequency.value).toBe(MUFFLE_HZ);
    module.hearCrew(crew(MAP, 9.8, false, 32)); // carried along by the stream, not walking
    expect(ctx.all<FakePanner>('panner')).toHaveLength(1);
  });

  it('places the nearest partner for the probe: the side, the distance’s gain', async () => {
    const { module } = await spatial();
    expect(module.spatialProbe()).toEqual({ partnerPan: null, partnerGain: null });
    module.hearCrew(crew(OPEN, 1.5, false, 0));
    expect(module.spatialProbe()).toEqual({ partnerPan: -0.5, partnerGain: 0.875 });
    module.hearCrew(crew(OPEN, 10.5, false, 50)); // within the placing interval: kept
    expect(module.spatialProbe().partnerPan).toBe(-0.5);
    module.hearCrew(crew(OPEN, 10.5, false, 150));
    expect(module.spatialProbe()).toEqual({ partnerPan: 1, partnerGain: 0.5 });
  });

  it('buzzes a drone where it flies, quiet frozen, chirping once as it catches one', async () => {
    const { module, ctx } = await spatial();
    const drone = (x: number, alerted: boolean, frozen = false): DronePosition => ({
      x,
      y: 2.5,
      facing: 0,
      range: 4,
      halfAngleDeg: 30,
      alerted,
      frozen,
    });
    module.hearCrew(crew(OPEN, 1.5, false, 0, { d: drone(10.5, false) }));
    const [rotorPan] = ctx.all<FakePanner>('panner');
    expect(rotorPan?.pan.events).toEqual([['target', 1, 10, 0.08]]);
    const saws = ctx.all<FakeOscillator>('oscillator').filter((osc) => osc.type === 'sawtooth');
    expect(saws.map((saw) => saw.frequency.value)).toEqual([118, 121.5]);
    module.hearCrew(crew(OPEN, 1.5, false, 200, { d: drone(10.5, true) }));
    module.hearCrew(crew(OPEN, 1.5, false, 400, { d: drone(10.5, true) }));
    const chirps = ctx.all<FakeOscillator>('oscillator').filter((osc) => osc.type === 'square');
    expect(chirps).toHaveLength(2); // two blips, once
    module.hearCrew(crew(OPEN, 1.5, false, 600, { d: drone(10.5, false, true) }));
    const filters = ctx.all<FakeFilter>('biquad');
    const muffle = filters.find((f) => f.outputs.includes(rotorPan as FakeNode));
    const level = ctx.all<FakeGain>('gain').find((g) => g.outputs.includes(muffle as FakeNode));
    expect(level?.gain.events.at(-1)).toEqual(['target', 0, 10, 0.08]); // frozen: quiet
    module.hearCrew(crew(OPEN, 1.5, false, 800, {}));
    expect(saws.every((saw) => saw.stoppedAt === 10.4)).toBe(true); // gone: silent
  });

  it('never throws, with no audio at all', async () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.resetModules();
    const module = await import('../src/world/spatial.js');
    expect(() => {
      module.hearCrew(crew(OPEN, 1.5, true, 0));
      module.hearCrew(crew(OPEN, 2.5, true, 200));
      module.stopSpatial();
    }).not.toThrow();
  });
});

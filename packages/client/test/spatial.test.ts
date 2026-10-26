import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DronePosition, MapView } from '@escapelab/core';
import {
  distanceGain,
  HEAR_EVERY_S,
  MUFFLE_HZ,
  panOf,
  PAN_SPAN,
  placeOf,
  STEP_TILES,
  type CrewScene,
} from '../src/world/spatial.js';
import { WALL_SHARE } from '../src/voice/rules.js';
import {
  endAll,
  fakeGraph,
  lastContext,
  reaches,
  type FakeBufferSource,
  type FakeFilter,
  type FakeNode,
  type FakeOscillator,
  type FakePanner,
} from './fakeGraph.js';
import { loadedSamples } from './fakeSamples.js';

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
    await loadedSamples();
    const module = await import('../src/world/spatial.js');
    const audio = await import('../src/world/audio.js');
    audio.sharedAudio(); // the engine, made on first use
    return { module, audio, ctx: lastContext() };
  }

  const drone = (x: number, alerted = false, frozen = false): DronePosition => ({
    x,
    y: 2.5,
    facing: 0,
    range: 4,
    halfAngleDeg: 30,
    alerted,
    frozen,
  });

  const crew = (
    map: Pick<MapView, 'tiles' | 'doors'>,
    rx: number,
    moving: boolean,
    drones: Record<string, DronePosition> = {},
  ): CrewScene => ({
    map,
    self: { x: 4.5, y: 2.5 },
    others: new Map([['ben', { rx, ry: 2.5, moving }]]),
    drones,
  });

  /** The steps played: the sources of the footstep's recorded takes. */
  const stepsOf = (ctx: ReturnType<typeof lastContext>): FakeBufferSource[] =>
    ctx
      .all<FakeBufferSource>('buffer')
      .filter((source) => /^step-[123]$/.test(source.buffer?.tag ?? ''));

  it('steps for a partner every half tile they walk, spread over the tenth to come', async () => {
    const { module, ctx } = await spatial();
    module.hearCrew(crew(OPEN, 8.5, true));
    module.hearCrew(crew(OPEN, 8.5 + STEP_TILES * 0.6, true));
    expect(stepsOf(ctx)).toEqual([]); // not half a tile yet
    module.hearCrew(crew(OPEN, 8.5 + STEP_TILES * 3.2, true)); // 1.6 walked: three steps
    const steps = stepsOf(ctx).map((source) => source.startedAt as number);
    const gap = HEAR_EVERY_S / 3;
    expect(steps).toEqual([10.01, 10.01 + gap, 10.01 + 2 * gap].map((at) => expect.closeTo(at, 9)));
    module.hearCrew(crew(OPEN, 8.5 + STEP_TILES * 4.1, true)); // the 0.1 left and 0.45 more
    expect(stepsOf(ctx)).toHaveLength(4);
    expect(ctx.all<FakePanner>('panner')).toHaveLength(1); // one placing for the partner's feet
    expect(ctx.all<FakeOscillator>('oscillator')).toHaveLength(0); // nothing made
    expect(stepsOf(ctx).every((step) => step.playbackRate.value === 1)).toBe(true); // ±10 %, at 0.5
  });

  it('muffles a partner’s steps behind a shut door; nobody standing still steps', async () => {
    const { module, ctx } = await spatial();
    module.hearCrew(crew(MAP, 8.5, true));
    module.hearCrew(crew(MAP, 9.1, true));
    const [panner] = ctx.all<FakePanner>('panner');
    const filters = ctx.all<FakeFilter>('biquad');
    const lowpass = filters.find((filter) => filter.outputs.includes(panner as FakeNode));
    expect(lowpass?.frequency.value).toBe(MUFFLE_HZ);
    module.hearCrew(crew(MAP, 9.8, false)); // carried along by the stream, not walking
    expect(ctx.all<FakePanner>('panner')).toHaveLength(1);
  });

  it('lets a step go once played, and a partner’s feet as they leave earshot', async () => {
    const { module, audio, ctx } = await spatial();
    module.hearCrew(crew(OPEN, 8.5, true));
    module.hearCrew(crew(OPEN, 9.1, true));
    expect(audio.inUse()).toMatchObject({ voice: 1, noise: 0 });
    const [step] = stepsOf(ctx);
    const [feet] = ctx.all<FakePanner>('panner');
    expect(step?.outputs).toHaveLength(1);
    endAll(ctx);
    expect(step?.disconnected).toBe(true);
    expect(audio.inUse()).toMatchObject({ voice: 0, noise: 0 });
    module.hearCrew(crew(OPEN, 9.1, false));
    expect(feet?.disconnected).toBe(false); // still within earshot: kept
    module.hearCrew(crew(OPEN, 14.6, true)); // ten tiles off and more: no step, feet let go
    expect(feet?.disconnected).toBe(true);
    expect(stepsOf(ctx)).toHaveLength(1);
  });

  it('places the nearest partner for the probe: the side, the distance’s gain', async () => {
    const { module } = await spatial();
    expect(module.spatialProbe()).toEqual({ partnerPan: null, partnerGain: null });
    module.hearCrew(crew(OPEN, 1.5, false));
    expect(module.spatialProbe()).toEqual({ partnerPan: -0.5, partnerGain: 0.875 });
    module.hearCrew(crew(OPEN, 10.5, false));
    expect(module.spatialProbe()).toEqual({ partnerPan: 1, partnerGain: 0.5 });
  });

  it('buzzes the nearest drone in earshot as one loop, and stops it beyond', async () => {
    const { module, audio, ctx } = await spatial();
    module.hearCrew(crew(OPEN, 1.5, false, { d: drone(10.5) }));
    module.hearCrew(crew(OPEN, 1.5, false, { d: drone(10.5) }));
    const rotor = ctx.all<FakeBufferSource>('buffer').find((b) => b.loop);
    expect(rotor?.buffer?.tag).toBe('drone-rotor');
    expect(audio.inUse().loop).toBe(1);
    const [pan] = ctx.all<FakePanner>('panner');
    expect(pan?.pan.events.at(-1)).toEqual(['target', 1, 10, 0.08]);
    expect(ctx.all<FakeOscillator>('oscillator')).toHaveLength(0); // no live saws
    module.hearCrew(crew(OPEN, 1.5, false, { d: drone(14.6) })); // ten tiles off and more
    expect(rotor?.stoppedAt).toBeCloseTo(10.4, 9);
    rotor?.end();
    expect(audio.inUse().loop).toBe(0);
  });

  it('keeps a frozen drone silent, and chirps once as a drone catches somebody', async () => {
    const { module, ctx } = await spatial();
    module.hearCrew(crew(OPEN, 1.5, false, { d: drone(8.5, false, true) }));
    module.hearCrew(crew(OPEN, 1.5, false, { d: drone(8.5, false, true) }));
    expect(ctx.all<FakeBufferSource>('buffer').filter((b) => b.loop)).toHaveLength(0);
    module.hearCrew(crew(OPEN, 1.5, false, { d: drone(8.5, true) }));
    module.hearCrew(crew(OPEN, 1.5, false, { d: drone(8.5, true) }));
    const chirps = ctx
      .all<FakeBufferSource>('buffer')
      .filter((b) => b.buffer?.tag === 'drone-alert');
    expect(chirps).toHaveLength(1); // once
    // Placed where the drone flies: four tiles to the right, through the placing's panner.
    const [chirp] = chirps;
    const panners = ctx.all<FakePanner>('panner');
    expect(panners.some((panner) => reaches(chirp as FakeNode, panner))).toBe(true);
    expect(panners.at(-1)?.pan.value).toBeCloseTo(4 / PAN_SPAN, 9);
  });

  it('never throws, with no audio at all', async () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.resetModules();
    const module = await import('../src/world/spatial.js');
    expect(() => {
      module.hearCrew(crew(OPEN, 1.5, true, { d: drone(8.5, true) }));
      module.hearCrew(crew(OPEN, 2.5, true));
      module.stopSpatial();
    }).not.toThrow();
  });
});

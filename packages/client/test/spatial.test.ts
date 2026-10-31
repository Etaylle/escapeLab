import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DronePosition, MapView } from '@escapelab/core';
import type { RoomPlan } from '../src/world/ambience.js';
import {
  distanceGain,
  HEAR_EVERY_S,
  MAX_TILES,
  MUFFLE_HZ,
  panOf,
  PAN_SPAN,
  PASS_EVERY_S,
  placeOf,
  REF_TILES,
  ROLLOFF,
  STEP_TILES,
  WALL_DB,
  WALL_DELAY_S,
  type CrewScene,
} from '../src/world/spatial.js';
import {
  endAll,
  fakeGraph,
  lastContext,
  reaches,
  type FakeBufferSource,
  type FakeFilter,
  type FakeGain,
  type FakeNode,
  type FakeOscillator,
  type FakePanner,
  type FakeParam,
} from './fakeGraph.js';
import { loadedSamples } from './fakeSamples.js';

/**
 * Two rooms: the west room (x 1–5, a lab), a wall at x 6 with a door at (6, 2), the east room
 * (x 7–23, a server room) — wide enough for a sound beyond MAX_TILES.
 */
const MAP: Pick<MapView, 'tiles' | 'doors'> = {
  tiles: [
    '#########################',
    '#.....#.................#',
    '#.......................#',
    '#.....#.................#',
    '#########################',
  ],
  doors: [{ id: 'door', x: 6, y: 2, open: false }],
};
const OPEN: Pick<MapView, 'tiles' | 'doors'> = {
  ...MAP,
  doors: [{ id: 'door', x: 6, y: 2, open: true }],
};

/** The map's rooms as the beds work them out (ambience.ts `roomPlan`). */
const PLAN: RoomPlan = {
  width: 25,
  rooms: MAP.tiles.flatMap((row, y) =>
    [...row].map((tile, x) => {
      if (tile !== '.' || y === 0 || x === 6) return null;
      return x < 6 ? 'WEST' : 'EAST';
    }),
  ),
  kinds: new Map([
    ['WEST', 'lab'],
    ['EAST', 'server'],
  ]),
  links: [{ a: 'EAST', b: 'WEST', door: 'door', x: 6.5, y: 2.5 }],
};

const WALL = 10 ** (WALL_DB / 20);

describe('where a sound sits', () => {
  it('pans by how far to the side it is: all one side at PAN_SPAN tiles', () => {
    expect(PAN_SPAN).toBe(6);
    expect(panOf(0)).toBe(0);
    expect(panOf(3)).toBe(0.5);
    expect(panOf(-6)).toBe(-1);
    expect(panOf(-20)).toBe(-1);
    expect(panOf(9)).toBe(1);
  });

  it('plays in full within 4 tiles, then falls off inversely with a rolloff of 1.2', () => {
    expect([REF_TILES, ROLLOFF, MAX_TILES]).toEqual([4, 1.2, 12]);
    expect(distanceGain(0)).toBe(1);
    expect(distanceGain(4)).toBe(1);
    expect(distanceGain(8)).toBeCloseTo(4 / (4 + 1.2 * 4), 12);
    expect(distanceGain(12)).toBeCloseTo(4 / (4 + 1.2 * 8), 12);
    // Twice as far beyond the reference, a third under; never silent by itself.
    for (let d = 4; d < 30; d += 0.5) {
      expect(distanceGain(d + 0.5)).toBeLessThan(distanceGain(d));
      expect(distanceGain(d)).toBeGreaterThan(0);
    }
  });

  it('muffles a sound behind a wall or shut door 6 dB down, and drops one beyond 12 tiles', () => {
    const shut = new Set(['6,2']);
    const from = { x: 4.5, y: 2.5 };
    const through = placeOf(MAP, shut, from, { x: 8.5, y: 2.5 });
    expect(through).toEqual({ pan: 4 / PAN_SPAN, gain: WALL, muffled: true, heard: true });
    const clear = placeOf(OPEN, new Set(), from, { x: 10.5, y: 2.5 });
    expect(clear).toEqual({ pan: 1, gain: distanceGain(6), muffled: false, heard: true });
    const far = placeOf(OPEN, new Set(), from, { x: 16.6, y: 2.5 });
    expect(far).toEqual({ pan: 1, gain: 0, muffled: false, heard: false });
    expect(placeOf(OPEN, new Set(), from, { x: 16.5, y: 2.5 }).heard).toBe(true); // 12 tiles
    expect(WALL_DB).toBe(-6);
  });
});

describe('the crew, the drones and the doors, heard', () => {
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
    const floors = await import('../src/world/footsteps.js');
    floors.followFloors(PLAN, 'WEST');
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

  /** The steps played: the sources of the footsteps' recorded takes, by their ids. */
  const stepsOf = (ctx: ReturnType<typeof lastContext>): FakeBufferSource[] =>
    ctx.all<FakeBufferSource>('buffer').filter((s) => /^step-/.test(s.buffer?.tag ?? ''));

  /** The sources of the recording `id` started. */
  const played = (ctx: ReturnType<typeof lastContext>, id: string): FakeBufferSource[] =>
    ctx.all<FakeBufferSource>('buffer').filter((source) => source.buffer?.tag === id);

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
    expect(stepsOf(ctx).every((step) => step.playbackRate.value === 1)).toBe(true); // ±5 %, at 0.5
  });

  it('steps on the floor under the partner, and keeps it across a doorway', async () => {
    const { module, ctx } = await spatial();
    module.hearCrew(crew(OPEN, 9.5, true)); // the server room: steel
    module.hearCrew(crew(OPEN, 8.4, true));
    expect(stepsOf(ctx).map((s) => s.buffer?.tag)).toEqual(['step-steel-2', 'step-steel-2']);
    module.hearCrew(crew(OPEN, 6.5, true)); // the doorway: no room's, the last floor kept
    expect(stepsOf(ctx).at(-1)?.buffer?.tag).toBe('step-steel-2');
    module.hearCrew(crew(OPEN, 4.6, true)); // the lab: linoleum
    expect(stepsOf(ctx).at(-1)?.buffer?.tag).toBe('step-lino-2');
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    module.hearCrew(crew(OPEN, 4.6 - STEP_TILES, true));
    const last = stepsOf(ctx).at(-1);
    expect(last?.buffer?.tag).toBe('step-lino-3');
    expect(last?.playbackRate.value).toBeCloseTo(1.049, 9); // at most 5 % faster
  });

  it('muffles a partner’s steps behind a shut door: 6 dB down, 15 ms late', async () => {
    const { module, ctx } = await spatial();
    module.hearCrew(crew(MAP, 8.5, true));
    module.hearCrew(crew(MAP, 9.1, true));
    const [lowpass] = ctx.all<FakeFilter>('biquad');
    const [delay] = ctx.all<FakeNode & { delayTime: FakeParam }>('delay');
    expect(lowpass?.frequency.value).toBe(MUFFLE_HZ);
    expect(delay?.delayTime.value).toBe(WALL_DELAY_S);
    expect(WALL_DELAY_S).toBe(0.015);
    const level = ctx.all<FakeGain>('gain').find((g) => g.outputs.includes(lowpass as FakeNode));
    expect(level?.gain.value).toBeCloseTo(0.02 * distanceGain(4.6) * WALL, 9);
    module.hearCrew(crew(MAP, 9.8, false)); // carried along by the stream, not walking
    expect(ctx.all<FakePanner>('panner')).toHaveLength(1);
  });

  it('lets a step go once played, and a partner’s feet beyond 12 tiles', async () => {
    const { module, audio, ctx } = await spatial();
    module.hearCrew(crew(OPEN, 8.5, true));
    module.hearCrew(crew(OPEN, 9.1, true));
    expect(audio.inUse()).toMatchObject({ voice: 1 });
    const [step] = stepsOf(ctx);
    const [feet] = ctx.all<FakePanner>('panner');
    expect(step?.outputs).toHaveLength(1);
    endAll(ctx);
    expect(step?.disconnected).toBe(true);
    expect(audio.inUse()).toMatchObject({ voice: 0 });
    module.hearCrew(crew(OPEN, 15.5, false)); // carried eleven tiles off, standing
    module.hearCrew(crew(OPEN, 16, true)); // a step there: still heard
    expect(feet?.disconnected).toBe(false);
    expect(stepsOf(ctx)).toHaveLength(2);
    module.hearCrew(crew(OPEN, 18.6, true)); // fourteen: no step started, the feet let go
    expect(feet?.disconnected).toBe(true);
    expect(stepsOf(ctx)).toHaveLength(2);
  });

  it('places the nearest partner for the probe: the side, the distance’s gain', async () => {
    const { module } = await spatial();
    expect(module.spatialProbe()).toEqual({ partnerPan: null, partnerGain: null });
    module.hearCrew(crew(OPEN, 1.5, false));
    expect(module.spatialProbe()).toEqual({ partnerPan: -0.5, partnerGain: 1 });
    module.hearCrew(crew(OPEN, 10.5, false));
    expect(module.spatialProbe()).toEqual({ partnerPan: 1, partnerGain: distanceGain(6) });
  });

  it('buzzes the nearest drone in earshot as one loop, and stops it beyond', async () => {
    const { module, audio, ctx } = await spatial();
    module.hearCrew(crew(OPEN, 1.5, false, { d: drone(14.5) }));
    module.hearCrew(crew(OPEN, 1.5, false, { d: drone(14.5) }));
    const rotor = ctx.all<FakeBufferSource>('buffer').find((b) => b.loop);
    expect(rotor?.buffer?.tag).toBe('drone-rotor');
    expect(audio.inUse().loop).toBe(1);
    const [pan] = ctx.all<FakePanner>('panner');
    expect(pan?.pan.events.at(-1)).toEqual(['target', 1, 10, 0.08]);
    expect(ctx.all<FakeOscillator>('oscillator')).toHaveLength(0); // no live saws
    module.hearCrew(crew(OPEN, 1.5, false, { d: drone(16.6) })); // twelve tiles off and more
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
    const chirps = played(ctx, 'drone-alert');
    expect(chirps).toHaveLength(1); // once
    // Placed where the drone flies: four tiles to the right, through the placing's panner.
    const [chirp] = chirps;
    const panners = ctx.all<FakePanner>('panner');
    expect(panners.some((panner) => reaches(chirp as FakeNode, panner))).toBe(true);
    expect(panners.at(-1)?.pan.value).toBeCloseTo(4 / PAN_SPAN, 9);
  });

  it('whooshes a drone by as it comes close, once in six seconds at most', async () => {
    const { module, ctx } = await spatial();
    module.hearCrew(crew(OPEN, 1.5, false, { d: drone(9.5) })); // five tiles off: no pass
    expect(played(ctx, 'drone-pass')).toHaveLength(0);
    module.hearCrew(crew(OPEN, 1.5, false, { d: drone(6.5) })); // two tiles: it passes
    module.hearCrew(crew(OPEN, 1.5, false, { d: drone(5.5) })); // still close: no second
    expect(played(ctx, 'drone-pass')).toHaveLength(1);
    module.hearCrew(crew(OPEN, 1.5, false, { d: drone(9.5) }));
    module.hearCrew(crew(OPEN, 1.5, false, { d: drone(6.5) })); // back too soon
    expect(played(ctx, 'drone-pass')).toHaveLength(1);
    ctx.currentTime += PASS_EVERY_S;
    module.hearCrew(crew(OPEN, 1.5, false, { d: drone(9.5) }));
    module.hearCrew(crew(OPEN, 1.5, false, { d: drone(6.5) }));
    expect(played(ctx, 'drone-pass')).toHaveLength(2);
    const [, second] = played(ctx, 'drone-pass');
    const panners = ctx.all<FakePanner>('panner');
    expect(panners.some((panner) => reaches(second as FakeNode, panner))).toBe(true);
  });

  it('places a door that slides open or shut, and the audience hears it unplaced', async () => {
    const { module, ctx } = await spatial();
    const door = { id: 'door', x: 6, y: 2, open: true };
    module.doorMoved(OPEN, { x: 9.5, y: 2.5 }, door);
    const [slide] = played(ctx, 'door-slide');
    const placed = ctx.all<FakePanner>('panner').at(-1) as FakePanner;
    expect(placed.pan.value).toBeCloseTo(-3 / PAN_SPAN, 9); // three tiles to the left
    expect(reaches(slide as FakeNode, placed)).toBe(true);
    module.doorMoved(MAP, { x: 9.5, y: 2.5 }, { ...door, open: false }); // its own leaf: no wall
    expect(played(ctx, 'door-close-2')).toHaveLength(1);
    const muffles = ctx.all<FakeFilter>('biquad').map((filter) => filter.frequency.value);
    expect(muffles.every((hz) => hz !== MUFFLE_HZ)).toBe(true);
    module.doorMoved(OPEN, null, door);
    expect(ctx.all<FakePanner>('panner').at(-1)?.pan.value).toBe(0);
    module.doorMoved(OPEN, { x: 20.5, y: 2.5 }, door); // fourteen tiles off: not started
    expect(played(ctx, 'door-slide')).toHaveLength(2);
  });

  it('never throws, with no audio at all', async () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.resetModules();
    const module = await import('../src/world/spatial.js');
    expect(() => {
      module.hearCrew(crew(OPEN, 1.5, true, { d: drone(8.5, true) }));
      module.hearCrew(crew(OPEN, 2.5, true));
      module.doorMoved(OPEN, { x: 1.5, y: 2.5 }, { id: 'door', x: 6, y: 2, open: true });
      module.stopSpatial();
    }).not.toThrow();
  });
});

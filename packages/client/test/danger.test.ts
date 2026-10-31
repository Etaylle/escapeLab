import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DronePosition, MapView } from '@escapelab/core';
import {
  closingDrone,
  CLOSING_TILES,
  DANGER_TILES,
  glowOf,
  tickEvery,
  tickRate,
} from '../src/world/danger.js';
import { glowSpot } from '../src/world/markers.js';
import { ALARM, rgba } from '../src/world/palette.js';
import { draw } from '../src/world/render/overlays.js';
import { MUFFLE_HZ } from '../src/world/spatial.js';
import { callsOf, fakeCanvas } from './fakeCanvas.js';
import {
  fakeGraph,
  lastContext,
  reaches,
  type FakeBufferSource,
  type FakeFilter,
  type FakeNode,
  type FakePanner,
} from './fakeGraph.js';
import { loadedSamples } from './fakeSamples.js';
import { frameWith } from './frames.js';

/** A drone at (x, y), in flight unless `frozen`. */
const drone = (x: number, y = 2.5, frozen = false): DronePosition => ({
  x,
  y,
  facing: 0,
  range: 4,
  halfAngleDeg: 30,
  alerted: false,
  frozen,
});

const SELF = { x: 4.5, y: 2.5 };

describe('which drone closes in', () => {
  it('senses one within five tiles that is nearer than a look ago', () => {
    expect(DANGER_TILES).toBe(5);
    const before = new Map([['d', 4.5]]);
    expect(closingDrone(SELF, { d: drone(8.5) }, before, null)).toEqual({
      id: 'd',
      x: 8.5,
      y: 2.5,
      distance: 4,
    });
  });

  it('senses none that flies off, keeps its distance, lies further, or is held still', () => {
    expect(closingDrone(SELF, { d: drone(8.5) }, new Map([['d', 3.5]]), null)).toBeNull();
    const steady = new Map([['d', 4 - CLOSING_TILES / 2]]);
    expect(closingDrone(SELF, { d: drone(8.5) }, steady, null)).toBeNull();
    expect(closingDrone(SELF, { d: drone(10.5) }, new Map([['d', 9]]), null)).toBeNull();
    const frozen = { d: drone(8.5, 2.5, true) };
    expect(closingDrone(SELF, frozen, new Map([['d', 5]]), null)).toBeNull();
    // Without a look before, nothing tells it closes in.
    expect(closingDrone(SELF, { d: drone(8.5) }, new Map(), null)).toBeNull();
  });

  it('keeps the drone sensed while it holds its distance, and takes the nearest of two', () => {
    const steady = new Map([['d', 4.02]]);
    expect(closingDrone(SELF, { d: drone(8.5) }, steady, 'd')?.id).toBe('d');
    const both = new Map([
      ['far', 5],
      ['near', 4],
    ]);
    const drones = { far: drone(8.5), near: drone(2, 0.5) };
    expect(closingDrone(SELF, drones, both, null)?.id).toBe('near');
  });

  it('ticks faster and higher, and glows harder, the nearer it comes', () => {
    expect(tickEvery(5)).toBe(900);
    expect(tickEvery(0)).toBe(220);
    expect(tickEvery(2)).toBeLessThan(tickEvery(4));
    expect(tickRate(2)).toBeGreaterThan(tickRate(4));
    expect(tickRate(5)).toBeGreaterThan(1);
    expect(glowOf(5)).toBeCloseTo(0.35, 9);
    expect(glowOf(0)).toBe(1);
  });
});

describe('the glow at the screen’s edge', () => {
  it('sits where the line from the middle toward the drone leaves the screen', () => {
    const view = { w: 800, h: 600 };
    expect(glowSpot(700, 300, view)).toEqual({ x: 800, y: 300, r: 144 });
    expect(glowSpot(400, 0, view)).toEqual({ x: 400, y: 0, r: 144 });
    const corner = glowSpot(-400, -300, view);
    expect([corner?.x, corner?.y]).toEqual([0, 0]);
    expect(glowSpot(400, 300, view)).toBeNull();
  });

  it('is drawn red toward the drone, no arrow and no caption for it', () => {
    const { ctx, log } = fakeCanvas(800, 600);
    // (8, 3) lies at (700, 300): the glow on the right edge's middle.
    const danger = { x: 8, y: 3, color: 'red', label: 'DROHNE', glow: 0.8 };
    draw(ctx, frameWith({ markers: [danger] }));
    expect(callsOf(log, 'createRadialGradient')).toEqual([[800, 300, 0, 800, 300, 144]]);
    expect(callsOf(log, 'fillRect')).toContainEqual([656, 156, 144, 288]);
    expect(callsOf(log, 'fillText').map(([text]) => text)).not.toContainEqual(
      expect.stringContaining('DROHNE'),
    );
    expect(rgba(ALARM, 0.4)).toMatch(/^rgba\(/);
  });
});

describe('the tick', () => {
  const OPEN: Pick<MapView, 'tiles' | 'doors'> = {
    tiles: [
      '###############',
      '#.............#',
      '#.............#',
      '#.............#',
      '###############',
    ],
    doors: [],
  };
  const WALLED: Pick<MapView, 'tiles' | 'doors'> = {
    ...OPEN,
    tiles: [
      '###############',
      '#.....#.......#',
      '#.....#.......#',
      '#.....#.......#',
      '###############',
    ],
  };

  beforeEach(() => {
    fakeGraph();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function sense() {
    vi.resetModules();
    await loadedSamples();
    const module = await import('../src/world/danger.js');
    const audio = await import('../src/world/audio.js');
    audio.sharedAudio();
    return { module, ctx: lastContext() };
  }

  const ticksOf = (ctx: ReturnType<typeof lastContext>): FakeBufferSource[] =>
    ctx.all<FakeBufferSource>('buffer').filter((source) => source.buffer?.tag === 'ping');

  it('ticks from where a drone closing in flies, short and pitched up, nearer faster', async () => {
    const { module, ctx } = await sense();
    const look = (x: number, now: number) =>
      module.senseDanger({ map: OPEN, self: SELF, drones: { d: drone(x) } }, now);
    look(9.5, 0);
    look(9.3, 200);
    expect(ticksOf(ctx)).toHaveLength(0); // not a look-back yet
    look(9.0, 450);
    const [first] = ticksOf(ctx);
    expect(first?.playbackRate.value).toBeCloseTo(tickRate(4.5), 9);
    expect((first?.stoppedAt ?? 0) - (first?.startedAt ?? 0)).toBeCloseTo(0.07, 9);
    const [pan] = ctx.all<FakePanner>('panner');
    expect(pan?.pan.value).toBeGreaterThan(0); // to the right
    expect(module.dangerMarker()).toMatchObject({ x: 9, label: 'DROHNE', glow: glowOf(4.5) });
    look(8.9, 550);
    expect(ticksOf(ctx)).toHaveLength(1); // the next not due yet
    look(6.5, 1450);
    expect(ticksOf(ctx)).toHaveLength(2);
  });

  it('muffles the tick through a wall, and falls silent as the drone flies off', async () => {
    const { module, ctx } = await sense();
    const look = (x: number, now: number) =>
      module.senseDanger({ map: WALLED, self: SELF, drones: { d: drone(x) } }, now);
    look(9.5, 0);
    look(9.0, 450);
    const [pan] = ctx.all<FakePanner>('panner');
    const lowpass = ctx
      .all<FakeFilter>('biquad')
      .find((filter) => filter.outputs.includes(pan as FakeNode));
    expect(lowpass?.frequency.value).toBe(MUFFLE_HZ);
    expect(reaches(ticksOf(ctx)[0] as FakeNode, pan as FakeNode)).toBe(true);
    look(9.6, 900);
    expect(module.dangerMarker()).toBeNull();
    module.stopDanger();
    expect(module.dangerMarker()).toBeNull();
  });
});

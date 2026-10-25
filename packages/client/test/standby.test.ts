import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MapView } from '@escapelab/core';
import type { LightLayer } from '../src/world/gl/lightLayer.js';
import { pulseAt } from '../src/world/gl/pack.js';
import { BLOOM_THRESHOLD } from '../src/world/gl/shaders.js';
import { fromSource, STANDBY_PULSE, STANDBY_STRENGTH } from '../src/world/gl/sources.js';
import { EMERGENCY_TINT } from '../src/world/light.js';
import { AMBER, SERVER_BLUE } from '../src/world/palette.js';
import type { Frame } from '../src/world/render/frame.js';
import { draw } from '../src/world/render/light.js';
import { drawStandby, STANDBY_BREATH } from '../src/world/render/standby.js';
import { standbySources } from '../src/world/sources.js';
import { callEntries, callsOf, fakeCanvas, FakePath2D, setsOf } from './fakeCanvas.js';
import { mapWith } from './fixtures.js';
import { canvasLight, frameWith, TILES } from './frames.js';

/**
 * The lab of two rooms: the Archiv dark, with a rack and a generator; the
 * Labor lit, with a desk.
 */
function lab(): MapView {
  return mapWith({
    width: 10,
    height: 6,
    tiles: TILES,
    labels: [
      { text: 'ARCHIV', x: 2, y: 2, kind: 'archive' },
      { text: 'LABOR', x: 7, y: 2, kind: 'lab' },
    ],
    doors: [{ id: 'tuer', x: 5, y: 2, open: false }],
    decor: [
      { kind: 'rack', x: 2, y: 1 },
      { kind: 'generator', x: 3, y: 3 },
      { kind: 'desk', x: 7, y: 3 },
    ],
  });
}

/** The lab with the Labor's lights long up. */
function labFrame(parts: Partial<Frame> = {}): Frame {
  const labor = [{ x: 7, y: 3 }];
  const path = new FakePath2D() as unknown as Path2D;
  const lit = new Map([['LABOR', { tiles: labor, path, since: -Infinity }]]);
  return frameWith({ map: lab(), lit, litTiles: new Set(['7,3']), ...parts });
}

describe('standby — the lights asleep in a room without power', () => {
  beforeAll(() => {
    vi.stubGlobal('Path2D', FakePath2D);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('counts a rack and a generator in the dark asleep, a desk in a lit room awake', () => {
    const asleep = standbySources(labFrame());
    expect(asleep.map((s) => [s.colour, s.standby])).toEqual([
      [[...SERVER_BLUE], 0.4],
      [[...AMBER], 1],
    ]);
    // Where the world shows nothing of the room yet, none.
    const unseen = labFrame({ light: { ...labFrame().light, shown: () => false } });
    expect(standbySources(unseen)).toEqual([]);
  });

  it('bakes their glows once, the brighter counting where they overlap, and they breathe', () => {
    const frame = labFrame({ time: 0.8 });
    const { ctx, log } = fakeCanvas(800, 600);
    drawStandby(ctx, frame);
    const baked = frame.kit.bakes.entries.get('standby')?.baked;
    expect(baked).toBeTruthy();
    const laid = callEntries(log, 'drawImage').find((e) => e.args[0] === baked?.canvas);
    expect(laid?.op).toBe('lighter');
    expect(laid?.alpha).toBeCloseTo(pulseAt(STANDBY_BREATH, 800));
    drawStandby(fakeCanvas(800, 600).ctx, { ...frame, time: 2 });
    expect(frame.kit.bakes.entries.get('standby')?.baked).toBe(baked);
    // Held at full under reduced motion.
    const still = fakeCanvas(800, 600);
    drawStandby(still.ctx, { ...frame, reduced: true });
    expect(callEntries(still.log, 'drawImage')[0]?.alpha).toBe(1);
  });

  it('cuts each glow to what its light can see, and draws nothing where none sleeps', () => {
    const frame = labFrame({ steady: false });
    const { ctx, log } = fakeCanvas(800, 600);
    drawStandby(ctx, frame);
    expect(callsOf(log, 'clip')).toHaveLength(2);
    const ops = setsOf(log, 'globalCompositeOperation');
    expect(ops).toContain('lighten');
    const awake = fakeCanvas(800, 600);
    drawStandby(awake.ctx, frameWith());
    expect(awake.log).toEqual([]);
  });

  it('glows over the dark on the light layer’s way too', () => {
    const layerCanvas = fakeCanvas(800, 1200, 'layer').canvas;
    const layer: LightLayer = {
      render: () => ({ canvas: layerCanvas, w: 800, h: 600 }),
      dispose: vi.fn(),
    };
    const frame = labFrame();
    frame.kit.light = { ...canvasLight(), choice: { path: 'gl', reason: 'a test' }, layer };
    const { ctx, log } = fakeCanvas(800, 600);
    draw(ctx, frame);
    const images = callsOf(log, 'drawImage').map(([canvas]) => canvas);
    expect(images.slice(0, 2)).toEqual([layerCanvas, layerCanvas]);
    expect(images[2]).toBe(frame.kit.bakes.entries.get('standby')?.baked?.canvas);
  });
});

describe('standby — on the light layer: just above the bloom’s threshold, breathing', () => {
  it('burns a light asleep so that its colour blooms a little, and never sinks below', () => {
    const colour: [number, number, number] = [72, 160, 255];
    const awake = { x: 1, y: 1, colour, reach: 1.4, strength: 0.24 };
    const asleep = { ...awake, standby: 0.4 };
    const light = fromSource(asleep);
    expect(light.strength).toBe(STANDBY_STRENGTH);
    expect(light.pulse).toEqual(STANDBY_PULSE);
    const peak = (EMERGENCY_TINT[0]?.[2] ?? 0) * STANDBY_STRENGTH;
    expect(peak).toBeGreaterThan(BLOOM_THRESHOLD);
    expect(peak).toBeLessThan(BLOOM_THRESHOLD * 1.5);
    expect(peak * (1 - STANDBY_PULSE.depth)).toBeGreaterThanOrEqual(BLOOM_THRESHOLD);
    // In step with the glow the Canvas pass lays round it.
    expect(STANDBY_PULSE.periodMs).toBe(STANDBY_BREATH.periodMs);
    expect(STANDBY_PULSE.periodMs).toBeGreaterThanOrEqual(2000);
    expect(STANDBY_PULSE.periodMs).toBeLessThanOrEqual(4000);
    // A light awake keeps its own strength.
    expect(fromSource(awake).strength).toBe(0.24);
  });
});

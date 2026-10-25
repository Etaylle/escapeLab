import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { artKit } from '../src/world/artKit.js';
import type { CanvasMaker } from '../src/world/atlas.js';
import type { LightLayer } from '../src/world/gl/lightLayer.js';
import type { Pools } from '../src/world/gl/maps.js';
import { EMERGENCY_STOPS, OWN_GLOW_STOPS } from '../src/world/light.js';
import { warmUp } from '../src/world/rooms.js';
import { ALARM_RED, WARM } from '../src/world/power.js';
import { draw, dropLight } from '../src/world/render/light.js';
import type { Frame } from '../src/world/render/frame.js';
import { cutStops } from '../src/world/render/radial.js';
import {
  callEntries,
  callsOf,
  fakeCanvas,
  setsOf,
  type Entry,
  type FakeCanvas,
  type FakeGradient,
} from './fakeCanvas.js';
import { canvasLight, frameWith, kitWith, lightWith, lit } from './frames.js';

/** What was drawn on each canvas the art made — the bakes' — by the canvas. */
let logs = new Map<unknown, Entry[]>();

/** A frame drawing its darkness into `overlay`, the warm ceiling layer baked as `warm`. */
function withKit(overlay: FakeCanvas, warm: FakeCanvas, parts: Partial<Frame> = {}): Frame {
  const make: CanvasMaker = (width, height) => {
    const made = fakeCanvas(width, height, `canvas ${width}x${height}`);
    logs.set(made.canvas, made.log);
    return made.canvas;
  };
  const kit = { ...kitWith(overlay), art: artKit(make) };
  const frame = frameWith({ ...parts, kit });
  kit.ceiling = { tiles: frame.map.tiles.join('\n'), byLight: new Map([[WARM, warm.canvas]]) };
  return frame;
}

/** What the pass drew for `frame` on the picture, the darkness's canvas seen apart. */
function drawn(frame: Frame): Entry[] {
  const { ctx, log } = fakeCanvas(800, 600);
  draw(ctx, frame);
  return log;
}

/** The bake `name` the frame keeps, and what was drawn into it. */
function bakeOf(frame: Frame, name: string): { canvas: unknown; log: Entry[]; of: unknown } {
  const kept = frame.kit.bakes.entries.get(name);
  const canvas = kept?.baked?.canvas;
  return { canvas, log: logs.get(canvas) ?? [], of: kept?.of };
}

/** The gradients set as a fill in `log`. */
function gradients(log: readonly Entry[]): FakeGradient[] {
  return setsOf(log, 'fillStyle').filter(
    (value): value is FakeGradient => typeof value === 'object' && value !== null,
  );
}

describe('light — the darkness over the picture, and what cuts it open', () => {
  let overlay: FakeCanvas;
  let warm: FakeCanvas;
  beforeEach(() => {
    logs = new Map();
    overlay = fakeCanvas(800, 600, 'overlay');
    warm = fakeCanvas(10, 6, 'warm');
    vi.stubGlobal('document', { createElement: () => fakeCanvas(0, 0, 'baked').canvas });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fills the darkness in one go, cuts your lamp into it from its sprite, lays it over', () => {
    const beam = { facing: 0, halfAngle: 0.5, reach: 7.5 };
    const own = lit({ x: 2.5, y: 2.5, glow: 3.2, beam }, 'own');
    const frame = withKit(overlay, warm, { light: lightWith({ own }) });
    const log = drawn(frame);
    expect(overlay.log.slice(0, 5)).toMatchObject([
      { name: 'setTransform', args: [1, 0, 0, 1, 0, 0] },
      { name: 'globalCompositeOperation', value: 'copy' },
      { name: 'fillStyle', value: 'rgba(3,5,9,0.92)' },
      { name: 'fillRect', args: [0, 0, 800, 600] },
      { name: 'globalCompositeOperation', value: 'source-over' },
    ]);
    expect(callsOf(overlay.log, 'clip')[0]).toEqual([own.clip]);
    // The glow: 3.2 tiles round (2.5, 2.5) — at (150, 250) on the canvas, 100 px a tile — from
    // its sprite, 321 px either side of its middle, at whole pixels.
    const glow = callEntries(overlay.log, 'drawImage').find((e) => e.args[1] === 150 - 321);
    expect(glow).toMatchObject({
      args: [expect.anything(), 150 - 321, 250 - 321],
      op: 'destination-out',
    });
    const key = `${JSON.stringify(cutStops(OWN_GLOW_STOPS))}|320.00`;
    expect(frame.kit.radials.baked.entries.get(key)).toBe(glow?.args[0]);
    const laid = callEntries(log, 'drawImage').find((e) => e.args[0] === overlay.canvas);
    expect(laid).toMatchObject({ args: [overlay.canvas, 0, 0], alpha: 1 });
  });

  it('deepens the darkness in the clock’s last minute and all through the escape', () => {
    const now = 1_000_000;
    const first = (parts: Partial<Frame>): unknown => {
      const dark = fakeCanvas(800, 600);
      drawn(withKit(dark, warm, { now, ...parts }));
      return setsOf(dark.log, 'fillStyle')[0];
    };
    expect(first({ deadlineAt: now + 30_000 })).toBe('rgba(3,5,9,0.945)');
    expect(first({ escapeSince: now - 10 })).toBe('rgba(3,5,9,0.945)');
    expect(first({ deadlineAt: now + 90_000 })).toBe('rgba(3,5,9,0.92)');
    expect(first({ time: 1 })).toBe(`rgba(3,5,9,${0.92 + 0.02 * Math.sin(1.7)})`);
  });

  it('keeps the darkness off your room while the lab has power, and warms it from a bake', () => {
    const room = {
      light: { keys: new Set(['2,2', '3,2']), runs: [{ x: 2, y: 2, length: 2 }] },
      path: { path: 'room' } as unknown as Path2D,
    };
    const scene = { lit: true, cover: 0 };
    const frame = withKit(overlay, warm, { scene, light: lightWith({ room }) });
    const log = drawn(frame);
    const power = bakeOf(frame, 'power:room');
    // Baked once, cut to the room, the pools added; laid on at whole pixels from (2, 2).
    expect(callsOf(power.log, 'clip')).toEqual([[room.path]]);
    expect(callEntries(power.log, 'drawImage')).toMatchObject([
      { args: [warm.canvas, 0, 0, 10, 6], op: 'lighter' },
    ]);
    const laid = callEntries(log, 'drawImage').find((e) => e.args[0] === power.canvas);
    expect(laid).toMatchObject({ args: [power.canvas, -100 + 200, 200], op: 'lighter', alpha: 1 });
    expect(callsOf(log, 'clip')).toEqual([]);
    // The room's two tiles from (2, 2), cleared of darkness in whole pixels.
    expect(callsOf(overlay.log, 'clearRect')).toContainEqual([100, 200, 200, 100]);
  });

  it('shows the audience the lab whole: no darkness, warm all over while the power is on', () => {
    const scene = { lit: true, cover: 0 };
    const frame = withKit(overlay, warm, { spectator: true, scene });
    const powered = drawn(frame);
    expect(callsOf(powered, 'clip')).toEqual([]);
    const whole = bakeOf(frame, 'power:whole');
    expect(callsOf(powered, 'drawImage')).toEqual([[whole.canvas, -100, 0]]);
    expect(overlay.log).toEqual([]);
    expect(drawn(withKit(overlay, warm, { spectator: true }))).toEqual([]);
  });

  it('lifts the darkness as every room’s light comes on at the end of a run won', () => {
    const lifting = withKit(overlay, warm, { ending: { lit: 0.25, pull: 0.2, dark: 0 } });
    const images = callEntries(drawn(lifting), 'drawImage');
    const power = bakeOf(lifting, 'power:whole').canvas;
    expect(images[0]).toMatchObject({ args: [power, -100, 0], alpha: 0.25 });
    expect(images[1]).toMatchObject({ args: [overlay.canvas, 0, 0], alpha: 0.75 });
    const ending = { lit: 1, pull: 1, dark: 0 };
    const whole = withKit(fakeCanvas(800, 600), warm, { ending });
    const last = callsOf(drawn(whole), 'drawImage');
    expect(last).toEqual([[bakeOf(whole, 'power:whole').canvas, -100, 0]]);
  });

  it('adds the emergency lamps’ red and cuts their dark from one bake each, as they burn', () => {
    const lamp = lit({ x: 1.5, y: 1.5, glow: 1.5 }, 'lamp');
    const lamps = [{ mount: { x: 1.5, y: 1.5, facing: null }, lit: lamp }];
    const frame = withKit(overlay, warm, { light: lightWith({ lamps }), burn: 0.8 });
    const log = drawn(frame);
    const red = bakeOf(frame, 'glow:lamp:1.5,1.5');
    expect(red.of).toBe(lamp.sight);
    expect(callsOf(red.log, 'clip')).toEqual([[lamp.clip]]);
    // Baked at full strength, in tile space: 1.5 tiles round (1.5, 1.5).
    expect(gradients(red.log)[0]?.args).toEqual([1.5, 1.5, 0, 1.5, 1.5, 1.5]);
    expect(gradients(red.log)[0]?.stops).toEqual([
      [0, 'rgba(255, 112, 98, 0.85)'],
      [0.12, 'rgba(255, 50, 42, 0.42)'],
      [0.5, 'rgba(255, 38, 32, 0.16)'],
      [1, 'rgba(255, 38, 32, 0)'],
    ]);
    expect(callsOf(red.log, 'fillRect')).toEqual([[0, 0, 3, 3]]);
    // Laid on as brightly as the lamps burn, at whole pixels: (0, 0) lies at (-100, 0).
    const laid = callEntries(log, 'drawImage').find((e) => e.args[0] === red.canvas);
    expect(laid).toMatchObject({ args: [red.canvas, -100, 0], op: 'lighter', alpha: 0.8 });
    expect(callsOf(log, 'clip')).toEqual([]);
    const cut = bakeOf(frame, 'cut:lamp:1.5,1.5');
    expect(gradients(cut.log)[0]?.stops[0]).toEqual([0, `rgba(0,0,0,${EMERGENCY_STOPS[0]?.[1]})`]);
    const cutIn = callEntries(overlay.log, 'drawImage').find((e) => e.args[0] === cut.canvas);
    expect(cutIn).toMatchObject({ op: 'destination-out', alpha: 0.8 });
  });

  it('spills a lit room’s light through an open door in the warm colour, within its wedge', () => {
    const beam = { facing: 0, halfAngle: 0.62, reach: 3.2 };
    const spill = lit({ x: 5.9, y: 2.5, glow: 0, beam }, 'spill');
    const light = lightWith({ spills: [{ lit: spill, open: 0.5 }] });
    const frame = withKit(overlay, warm, { light });
    const log = drawn(frame);
    const [r, g, b] = WARM.tint;
    const wedge = bakeOf(frame, 'glow:spill:5.9,2.5:warm');
    expect(gradients(wedge.log).at(-1)?.stops[0]).toEqual([0, `rgba(${r}, ${g}, ${b}, 0.3)`]);
    expect(callsOf(wedge.log, 'arc').at(-1)).toEqual([5.9, 2.5, 3.2, -0.62, 0.62]);
    const laid = callEntries(log, 'drawImage').find((e) => e.args[0] === wedge.canvas);
    expect(laid).toMatchObject({ op: 'lighter', alpha: 0.5 });
    expect(frame.kit.bakes.entries.has('glow:spill:5.9,2.5:red')).toBe(false);
  });

  it('tints the picture the escape’s red, swelling with the siren unless motion is reduced', () => {
    const tint = (parts: Partial<Frame>): unknown[] =>
      setsOf(drawn(withKit(fakeCanvas(800, 600), warm, parts)), 'fillStyle').filter(
        (fill) => typeof fill === 'string' && fill.startsWith('rgba(255, 34, 22'),
      );
    // A quarter of the siren's 1.25 s turn: the swell at its top.
    expect(tint({ red: 1, time: 0.3125 })).toEqual([`rgba(255, 34, 22, ${(0.06 + 0.05 * 1) * 1})`]);
    expect(tint({ red: 0.5, time: 0.3125, reduced: true })).toEqual([
      `rgba(255, 34, 22, ${(0.06 + 0.05 * 0.5) * 0.5})`,
    ]);
    expect(tint({ red: 0, time: 0.3125 })).toEqual([]);
  });

  it('bakes the open hatch’s light once for the sight it sees from, again for another', () => {
    const hatch = { lit: lit({ x: 8.5, y: 3.5, glow: 3.2 }, 'hatch'), open: 0.5 };
    const frame = withKit(overlay, warm, { light: lightWith({ exit: hatch }), hatch: 0.5 });
    drawn(frame);
    const first = frame.kit.bakes.entries.get('cut:hatch');
    expect(first?.of).toBe(hatch.lit.sight);
    const baked = first?.baked;
    drawn(frame);
    expect(frame.kit.bakes.entries.get('cut:hatch')?.baked).toBe(baked);
    const moved = { lit: lit({ x: 8.5, y: 3.5, glow: 3.2 }, 'hatch'), open: 0.5 };
    drawn({ ...frame, light: lightWith({ exit: moved }) });
    const again = frame.kit.bakes.entries.get('cut:hatch');
    expect(again?.of).toBe(moved.lit.sight);
    expect(again?.baked?.canvas).toBe(baked?.canvas);
    const laid = callEntries(overlay.log, 'drawImage').find((e) => e.args[0] === baked?.canvas);
    expect(laid?.alpha).toBe(0.5);
  });

  it('keeps a lit room clear of the darkness, as far as its lights have come on', () => {
    const tiles = [{ x: 6, y: 2 }];
    const path = { path: 'labor' } as unknown as Path2D;
    const fills = (since: number): unknown[][] => {
      const dark = fakeCanvas(800, 600);
      drawn(withKit(dark, warm, { time: 10, lit: new Map([['LABOR', { tiles, path, since }]]) }));
      expect(callsOf(dark.log, 'clearRect')).toContainEqual([500, 200, 100, 100]);
      return callsOf(dark.log, 'fillRect').filter(([x, y]) => x === 500 && y === 200);
    };
    expect(fills(-Infinity)).toEqual([]);
    expect(fills(10 - 0.25)).toEqual([[500, 200, 100, 100]]);
    expect(1 - warmUp(250)).toBeGreaterThan(0);
  });

  it('lays the lit rooms’ light from one bake once up, from each room’s while one comes on', () => {
    const room = (x: number, path: string) => ({
      tiles: [{ x, y: 2 }],
      path: { path } as unknown as Path2D,
      since: -Infinity,
    });
    const rooms = new Map([
      ['ARCHIV', room(2, 'archiv')],
      ['LABOR', room(7, 'labor')],
    ]);
    const up = withKit(overlay, warm, { time: 10, lit: rooms });
    drawn(up);
    const clips = callsOf(bakeOf(up, 'rooms').log, 'clip');
    expect(clips).toEqual([[{ path: 'archiv' }], [{ path: 'labor' }]]);
    expect([...up.kit.bakes.entries.keys()].some((name) => name.startsWith('room:'))).toBe(false);
    // The Labor's lights a quarter of a second in: each room apart, the Labor as far as it is up.
    const coming = new Map([...rooms, ['LABOR', { ...room(7, 'labor'), since: 10 - 0.25 }]]);
    const frame = withKit(overlay, warm, { time: 10, lit: coming });
    const log = drawn(frame);
    const labor = bakeOf(frame, 'room:LABOR:warm');
    const laid = callEntries(log, 'drawImage').find((e) => e.args[0] === labor.canvas);
    expect(laid?.alpha).toBeCloseTo(warmUp(250));
    expect(frame.kit.bakes.entries.has('rooms')).toBe(false);
  });

  it('draws the lights straight while the zoom moves, baking none of them', () => {
    const lamp = lit({ x: 1.5, y: 1.5, glow: 1.5 }, 'lamp');
    const lamps = [{ mount: { x: 1.5, y: 1.5, facing: null }, lit: lamp }];
    const frame = withKit(overlay, warm, { light: lightWith({ lamps }), burn: 0.8, steady: false });
    const log = drawn(frame);
    expect(frame.kit.bakes.entries.size).toBe(0);
    expect(callsOf(log, 'clip')).toContainEqual([lamp.clip]);
    expect(gradients(log)[0]?.args).toEqual([1.5, 1.5, 0, 1.5, 1.5, 1.5]);
  });
});

describe('light — through the WebGL light layer where the world’s way says so', () => {
  let overlay: FakeCanvas;
  let warm: FakeCanvas;
  beforeEach(() => {
    logs = new Map();
    overlay = fakeCanvas(800, 600, 'overlay');
    warm = fakeCanvas(10, 6, 'warm');
  });

  /** A frame whose light takes a stand-in layer, its halves 600 × 450 drawn into `layerCanvas`. */
  function onLayer(parts: Partial<Frame> = {}) {
    const layerCanvas = fakeCanvas(600, 900, 'layer').canvas;
    const pools: Pools[] = [];
    const layer: LightLayer = {
      render: vi.fn((_: Frame, read: Pools) => {
        pools.push(read);
        return { canvas: layerCanvas, w: 600, h: 450 };
      }),
      dispose: vi.fn(),
    };
    const frame = withKit(overlay, warm, parts);
    frame.kit.light = { ...canvasLight(), choice: { path: 'gl', reason: 'a test' }, layer };
    return { frame, layer, layerCanvas, pools };
  }

  it('multiplies the light map over the picture, then adds glow and bloom: no darkness', () => {
    const { frame, layer, layerCanvas } = onLayer();
    const log = drawn(frame);
    expect(layer.render).toHaveBeenCalledOnce();
    const images = callEntries(log, 'drawImage');
    expect(images).toMatchObject([
      { args: [layerCanvas, 0, 0, 600, 450, 0, 0, 800, 600], op: 'multiply', alpha: 1 },
      { args: [layerCanvas, 0, 450, 600, 450, 0, 0, 800, 600], op: 'lighter', alpha: 1 },
    ]);
    expect(overlay.log).toEqual([]);
    expect(callsOf(log, 'fillRect')).toEqual([]);
  });

  it('lifts the darkness of a run won on the layer, and draws the lab lit whole on Canvas', () => {
    const lifting = onLayer({ ending: { lit: 0.5, pull: 0.2, dark: 0 } });
    drawn(lifting.frame);
    expect(lifting.layer.render).toHaveBeenCalledOnce();
    const whole = onLayer({ ending: { lit: 1, pull: 1, dark: 0 } });
    const log = drawn(whole.frame);
    expect(whole.layer.render).not.toHaveBeenCalled();
    const power = bakeOf(whole.frame, 'power:whole').canvas;
    expect(callsOf(log, 'drawImage')).toEqual([[power, -100, 0]]);
  });

  it('leaves the audience’s light, which has no darkness, to the Canvas pass', () => {
    const { frame, layer } = onLayer({ spectator: true, scene: { lit: true, cover: 0 } });
    const images = callsOf(drawn(frame), 'drawImage');
    expect(images).toEqual([[bakeOf(frame, 'power:whole').canvas, -100, 0]]);
    expect(layer.render).not.toHaveBeenCalled();
  });

  it('takes the Canvas pass where the probe forces it, and the layer again once let go', () => {
    const { frame, layer } = onLayer();
    if (frame.kit.light !== null) {
      frame.kit.light.forced = 'canvas';
    }
    drawn(frame);
    expect(layer.render).not.toHaveBeenCalled();
    expect(overlay.log.length).toBeGreaterThan(0);
    if (frame.kit.light !== null) {
      frame.kit.light.forced = null;
    }
    drawn(frame);
    expect(layer.render).toHaveBeenCalledOnce();
  });

  it('reads the ceiling lights’ pools off their baked layer, once per layer', () => {
    const { frame, pools } = onLayer();
    const pixels = new Uint8ClampedArray(10 * 6 * 4).fill(0);
    pixels.set([255, 214, 168, 51], 0);
    const read = vi.fn(() => ({ data: pixels }));
    const baked = { width: 10, height: 6, getContext: () => ({ getImageData: read }) };
    frame.kit.ceiling = {
      tiles: frame.map.tiles.join('\n'),
      byLight: new Map([
        [WARM, baked as unknown as HTMLCanvasElement],
        [ALARM_RED, baked as unknown as HTMLCanvasElement],
      ]),
    };
    drawn(frame);
    const warmPools = pools[0]?.(WARM);
    expect(warmPools?.[0]).toBeCloseTo(0.2);
    expect(pools[0]?.(WARM)).toBe(warmPools);
    expect(read).toHaveBeenCalledOnce();
  });

  it('takes a world’s light down as the world goes', () => {
    const { frame, layer } = onLayer();
    const path = frame.kit.light;
    const dispose = vi.fn();
    if (path !== null) {
      path.dispose = dispose;
    }
    dropLight(frame.kit);
    expect(dispose).toHaveBeenCalledOnce();
    expect(frame.kit.light).toBeNull();
    expect(layer.dispose).not.toHaveBeenCalled();
  });
});

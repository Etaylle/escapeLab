import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { warmUp } from '../src/world/rooms.js';
import { WARM } from '../src/world/power.js';
import { draw } from '../src/world/render/light.js';
import type { Frame } from '../src/world/render/frame.js';
import {
  callEntries,
  callsOf,
  fakeCanvas,
  setsOf,
  type FakeCanvas,
  type FakeGradient,
} from './fakeCanvas.js';
import { frameWith, kitWith, lightWith, lit } from './frames.js';

/** A frame drawing its darkness into `overlay`, the warm ceiling layer baked as `warm`. */
function withKit(overlay: FakeCanvas, warm: FakeCanvas, parts: Partial<Frame> = {}): Frame {
  const frame = frameWith(parts);
  const kit = kitWith(overlay);
  kit.ceiling = { tiles: frame.map.tiles.join('\n'), byLight: new Map([[WARM, warm.canvas]]) };
  return { ...frame, kit };
}

/** What the pass drew for `frame` on the picture, the darkness's canvas seen apart. */
function drawn(frame: Frame) {
  const { ctx, log } = fakeCanvas(800, 600);
  draw(ctx, frame);
  return log;
}

/** The gradients set as a fill in `log`, by where they lie. */
function gradients(log: ReturnType<typeof drawn>): FakeGradient[] {
  return setsOf(log, 'fillStyle').filter(
    (value): value is FakeGradient => typeof value === 'object' && value !== null,
  );
}

describe('light — the darkness over the picture, and what cuts it open', () => {
  let overlay: FakeCanvas;
  let warm: FakeCanvas;
  beforeEach(() => {
    overlay = fakeCanvas(800, 600, 'overlay');
    warm = fakeCanvas(10, 6, 'warm');
    vi.stubGlobal('document', { createElement: () => fakeCanvas(0, 0, 'baked').canvas });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fills the darkness, cuts your lamp into it where it sees, lays it over the picture', () => {
    const beam = { facing: 0, halfAngle: 0.5, reach: 7.5 };
    const own = lit({ x: 2.5, y: 2.5, glow: 3.2, beam }, 'own');
    const log = drawn(withKit(overlay, warm, { light: lightWith({ own }) }));
    expect(overlay.log.slice(0, 5)).toMatchObject([
      { name: 'setTransform', args: [1, 0, 0, 1, 0, 0] },
      { name: 'globalCompositeOperation', value: 'source-over' },
      { name: 'clearRect', args: [0, 0, 800, 600] },
      { name: 'fillStyle', value: 'rgba(3,5,9,0.92)' },
      { name: 'fillRect', args: [0, 0, 800, 600] },
    ]);
    expect(callsOf(overlay.log, 'clip')[0]).toEqual([own.clip]);
    // The glow: 3.2 tiles round (2.5, 2.5) — at (150, 250) on the canvas, 100 px a tile.
    const r = 3.2 * 100;
    const glow = callEntries(overlay.log, 'fillRect').find((e) => e.args[0] === 150 - r);
    expect(glow).toMatchObject({ args: [150 - r, 250 - r, r * 2, r * 2], op: 'destination-out' });
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

  it('keeps the darkness off your room while the lab has its power, and warms the room', () => {
    const room = {
      light: { keys: new Set(['2,2', '3,2']), runs: [{ x: 2, y: 2, length: 2 }] },
      path: { path: 'room' } as unknown as Path2D,
    };
    const scene = { lit: true, cover: 0 };
    const frame = withKit(overlay, warm, { scene, light: lightWith({ room }) });
    const log = drawn(frame);
    expect(callsOf(log, 'clip')).toEqual([[room.path]]);
    const layer = callEntries(log, 'drawImage').find((e) => e.args[0] === warm.canvas);
    expect(layer).toMatchObject({ args: [warm.canvas, 0, 0, 10, 6], op: 'lighter', alpha: 1 });
    // The room's two tiles from (2, 2), cleared of darkness in whole pixels.
    expect(callsOf(overlay.log, 'clearRect')).toContainEqual([100, 200, 200, 100]);
  });

  it('shows the audience the lab whole: no darkness, warm all over while the power is on', () => {
    const scene = { lit: true, cover: 0 };
    const powered = drawn(withKit(overlay, warm, { spectator: true, scene }));
    expect(callsOf(powered, 'clip')).toEqual([]);
    expect(callsOf(powered, 'drawImage')).toEqual([[warm.canvas, 0, 0, 10, 6]]);
    expect(overlay.log).toEqual([]);
    expect(drawn(withKit(overlay, warm, { spectator: true }))).toEqual([]);
  });

  it('lifts the darkness as every room’s light comes on at the end of a run won', () => {
    const lifting = drawn(withKit(overlay, warm, { ending: { lit: 0.25, pull: 0.2, dark: 0 } }));
    const images = callEntries(lifting, 'drawImage');
    expect(images[0]).toMatchObject({ args: [warm.canvas, 0, 0, 10, 6], alpha: 0.25 });
    expect(images[1]).toMatchObject({ args: [overlay.canvas, 0, 0], alpha: 0.75 });
    const ending = { lit: 1, pull: 1, dark: 0 };
    const lit = drawn(withKit(fakeCanvas(800, 600), warm, { ending }));
    expect(callsOf(lit, 'drawImage')).toEqual([[warm.canvas, 0, 0, 10, 6]]);
  });

  it('adds the emergency lamps’ red where each can see, as brightly as they burn', () => {
    const lamp = lit({ x: 1.5, y: 1.5, glow: 1.5 }, 'lamp');
    const lamps = [{ mount: { x: 1.5, y: 1.5, facing: null }, lit: lamp }];
    const log = drawn(withKit(overlay, warm, { light: lightWith({ lamps }), burn: 0.8 }));
    expect(callsOf(log, 'clip')).toEqual([[lamp.clip]]);
    // 1.5 tiles round (1.5, 1.5): at (50, 150) on the canvas, 150 px.
    const round = [50, 150, 0, 50, 150, 150].join();
    const red = gradients(log).find((g) => g.args.join() === round);
    expect(red?.stops).toEqual([
      [0, `rgba(255, 112, 98, ${0.85 * 0.8})`],
      [0.12, `rgba(255, 50, 42, ${0.42 * 0.8})`],
      [0.5, `rgba(255, 38, 32, ${0.16 * 0.8})`],
      [1, 'rgba(255, 38, 32, 0)'],
    ]);
    expect(callEntries(log, 'fillRect').at(-1)).toMatchObject({
      args: [-100, 0, 300, 300],
      op: 'lighter',
    });
    expect(callsOf(overlay.log, 'clip')).toContainEqual([lamp.clip]);
    const cut = gradients(overlay.log).find((g) => g.args.join() === round);
    expect(cut?.stops[0]).toEqual([0, `rgba(0,0,0,${0.55 * 0.8})`]);
  });

  it('spills a lit room’s light through an open door in the warm colour, within its wedge', () => {
    const beam = { facing: 0, halfAngle: 0.62, reach: 3.2 };
    const spill = lit({ x: 5.9, y: 2.5, glow: 0, beam }, 'spill');
    const light = lightWith({ spills: [{ lit: spill, open: 0.5 }] });
    const log = drawn(withKit(overlay, warm, { light }));
    const [r, g, b] = WARM.tint;
    const wedge = gradients(log).at(-1);
    expect(wedge?.stops[0]).toEqual([0, `rgba(${r},${g},${b},${0.3 * 0.5})`]);
    const sx = 400 + (5.9 - 5) * 100;
    expect(callsOf(log, 'arc').at(-1)).toEqual([sx, 250, 3.2 * 100, -0.62, 0.62]);
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
    const first = frame.kit.hatchCut;
    expect(first?.sight).toBe(hatch.lit.sight);
    drawn(frame);
    expect(frame.kit.hatchCut).toBe(first);
    const baked = first?.baked?.canvas;
    const moved = { lit: lit({ x: 8.5, y: 3.5, glow: 3.2 }, 'hatch'), open: 0.5 };
    drawn({ ...frame, light: lightWith({ exit: moved }) });
    expect(frame.kit.hatchCut).not.toBe(first);
    expect(frame.kit.hatchCut?.baked?.canvas).toBe(baked);
    const laid = callEntries(overlay.log, 'drawImage').find((e) => e.args[0] === baked);
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
});

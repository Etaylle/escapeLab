import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { artKit } from '../src/world/artKit.js';
import type { CanvasMaker } from '../src/world/atlas.js';
import type { LightLayer } from '../src/world/gl/lightLayer.js';
import type { Pools } from '../src/world/gl/maps.js';
import { CREW_BEAM, CREW_REACH } from '../src/world/beam.js';
import { blend, GRADES, type Wash } from '../src/world/grade.js';
import { EMERGENCY_STOPS, OWN_GLOW_STOPS } from '../src/world/light.js';
import { rgba, SERVER_BLUE } from '../src/world/palette.js';
import { warmUp } from '../src/world/rooms.js';
import { ALARM_RED, WARM } from '../src/world/power.js';
import { draw, dropLight } from '../src/world/render/light.js';
import type { Frame, LitRoom } from '../src/world/render/frame.js';
import { cutStops } from '../src/world/render/radial.js';
import {
  callEntries,
  callsOf,
  fakeCanvas,
  FakePath2D,
  setsOf,
  type Entry,
  type FakeCanvas,
  type FakeGradient,
} from './fakeCanvas.js';
import { mapWith } from './fixtures.js';
import { canvasLight, frameWith, kitWith, lightWith, lit, TILES } from './frames.js';

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

/** A path filled in a log: its rectangles, the fill rule and the fill style it was filled with. */
interface Filled {
  rects: unknown[][];
  rule: unknown;
  style: unknown;
}

/** The paths filled in `log`, in order. */
function fillsOf(log: readonly Entry[]): Filled[] {
  const fills: Filled[] = [];
  let rects: unknown[][] = [];
  let style: unknown = null;
  for (const entry of log) {
    if (entry.kind === 'set') {
      style = entry.name === 'fillStyle' ? entry.value : style;
    } else if (entry.name === 'beginPath') {
      rects = [];
    } else if (entry.name === 'rect') {
      rects.push(entry.args);
    } else if (entry.name === 'fill') {
      fills.push({ rects, rule: entry.args[0] ?? 'nonzero', style });
    }
  }
  return fills;
}

/** A rack in the Labor: it glows steadily. */
const RACK = { kind: 'rack' as const, x: 7, y: 3 };

/** A lit room of one tile at (x, 2), long lit, its clip a stand-in path named `path`. */
function room(x: number, path: string): LitRoom {
  return { tiles: [{ x, y: 2 }], path: { path } as unknown as Path2D, since: -Infinity };
}

/** Where in `log` the grade `wash` is filled over the picture: the fill after its colour is set. */
function gradeFill(log: readonly Entry[], wash: Wash): number {
  const style = rgba(wash.rgb, wash.alpha);
  const set = log.findIndex((e) => e.kind === 'set' && e.name === 'fillStyle' && e.value === style);
  if (set < 0) {
    return -1;
  }
  return log.findIndex((e, i) => i > set && e.kind === 'call' && e.name === 'fillRect');
}

/** Where in `log` the first drawImage of `image` lies; -1 for none. */
function laidAt(log: readonly Entry[], image: unknown): number {
  return log.findIndex((e) => e.kind === 'call' && e.name === 'drawImage' && e.args[0] === image);
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

  it('fills the darkness once over, cuts your lamp into it from its sprite, lays it over', () => {
    const beam = { facing: 0, halfAngle: 0.5, reach: 7.5 };
    const own = lit({ x: 2.5, y: 2.5, glow: 3.2, beam }, 'own');
    const frame = withKit(overlay, warm, { light: lightWith({ own }) });
    const log = drawn(frame);
    // Cleared, then filled: a fill copying over the frame before costs as much as the overlay.
    expect(overlay.log.slice(0, 3)).toMatchObject([
      { name: 'setTransform', args: [1, 0, 0, 1, 0, 0] },
      { name: 'globalCompositeOperation', value: 'source-over' },
      { name: 'clearRect', args: [0, 0, 800, 600] },
    ]);
    expect(fillsOf(overlay.log)).toEqual([
      { rects: [[0, 0, 800, 600]], rule: 'evenodd', style: 'rgba(3,5,9,0.92)' },
    ]);
    expect(setsOf(overlay.log, 'globalCompositeOperation')).not.toContain('copy');
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

  it('cuts the crew’s lamps in too, glow and beam, a little softer, each where it sees', () => {
    const beam = { facing: Math.PI, halfAngle: 0.5, reach: CREW_REACH };
    const ben = lit({ x: 7.5, y: 2.5, glow: 2.8, beam }, 'ben');
    const frame = withKit(overlay, warm, { light: lightWith({ crew: [ben] }) });
    drawn(frame);
    expect(callsOf(overlay.log, 'clip')).toEqual([[ben.clip]]);
    const sprite = frame.kit.beams?.steps.get(180);
    const laid = callEntries(overlay.log, 'drawImage');
    const cut = laid.find((e) => e.args[0] === sprite?.cut.canvas);
    expect(cut).toMatchObject({ op: 'destination-out', alpha: CREW_BEAM });
    // Their beam's core lays no warm light: yours alone does.
    expect(laid.some((e) => e.args[0] === sprite?.glow.canvas)).toBe(false);
  });

  it('deepens the darkness in the clock’s last minute and all through the escape', () => {
    const now = 1_000_000;
    const first = (parts: Partial<Frame>): unknown => {
      const dark = fakeCanvas(800, 600);
      drawn(withKit(dark, warm, { now, ...parts }));
      return setsOf(dark.log, 'fillStyle')[0];
    };
    expect(first({ timeLeft: 30_000 })).toBe('rgba(3,5,9,0.945)');
    expect(first({ escapeSince: now - 10 })).toBe('rgba(3,5,9,0.945)');
    expect(first({ timeLeft: 90_000 })).toBe('rgba(3,5,9,0.92)');
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
    // The room's two tiles from (2, 2) left out of the darkness in whole pixels, nothing over them.
    expect(fillsOf(overlay.log)).toEqual([
      {
        rects: [
          [0, 0, 800, 600],
          [100, 200, 200, 100],
        ],
        rule: 'evenodd',
        style: 'rgba(3,5,9,0.92)',
      },
    ]);
  });

  it('leaves your powered room out of a lit room’s darkness: no tile filled twice', () => {
    const room = {
      light: { keys: new Set(['2,2', '3,2']), runs: [{ x: 2, y: 2, length: 2 }] },
      path: { path: 'room' } as unknown as Path2D,
    };
    const tiles = [1, 2, 3, 4].map((x) => ({ x, y: 2 }));
    const coming = { tiles, path: { path: 'labor' } as unknown as Path2D, since: 10 - 0.25 };
    const parts = { time: 10, scene: { lit: true, cover: 0 }, light: lightWith({ room }) };
    drawn(withKit(overlay, warm, { ...parts, lit: new Map([['LABOR', coming]]) }));
    const keep = 1 - warmUp(250);
    expect(fillsOf(overlay.log)).toEqual([
      {
        rects: [
          [0, 0, 800, 600],
          [100, 200, 200, 100],
          [0, 200, 100, 100],
          [300, 200, 100, 100],
        ],
        rule: 'evenodd',
        style: `rgba(3,5,9,${0.92 + 0.02 * Math.sin(17)})`,
      },
      {
        rects: [
          [0, 200, 100, 100],
          [300, 200, 100, 100],
        ],
        rule: 'nonzero',
        style: `rgba(3,5,9,${(0.92 + 0.02 * Math.sin(17)) * keep})`,
      },
    ]);
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
    // Laid from its bake, no clip: the one clip is the box its beacon's lobes keep to (beacons.ts).
    expect(callsOf(log, 'clip')).toEqual([[]]);
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
    const fills = (since: number): Filled[] => {
      const dark = fakeCanvas(800, 600);
      drawn(withKit(dark, warm, { time: 10, lit: new Map([['LABOR', { tiles, path, since }]]) }));
      const [round, ...over] = fillsOf(dark.log);
      // The dark is filled round the room's tile, in whole pixels.
      expect(round?.rects).toEqual([
        [0, 0, 800, 600],
        [500, 200, 100, 100],
      ]);
      expect(round?.rule).toBe('evenodd');
      return over;
    };
    const base = 0.92 + 0.02 * Math.sin(17);
    expect(fills(-Infinity)).toEqual([]);
    const style = `rgba(3,5,9,${base * (1 - warmUp(250))})`;
    expect(fills(10 - 0.25)).toEqual([{ rects: [[500, 200, 100, 100]], rule: 'nonzero', style }]);
    expect(1 - warmUp(250)).toBeGreaterThan(0);
  });

  it('lays the lit rooms’ light from one bake once up, from each room’s while one comes on', () => {
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

  it('adds the lit rooms, the steady glows and the open hatch up: one copy for them all', () => {
    vi.stubGlobal('Path2D', FakePath2D);
    // A rack in the Labor glows steadily; the hatch at (8, 4) stands open.
    const map = mapWith({ width: 10, height: 6, tiles: TILES, decor: [RACK] });
    const exit = { lit: lit({ x: 8.5, y: 4.5, glow: 3.2 }, 'hatch'), open: 1 };
    const parts = { map, time: 10, red: 1, escapeSince: 1, hatch: 1 };
    const lab = new Map([['LABOR', room(7, 'labor')]]);
    const frame = withKit(overlay, warm, { ...parts, light: lightWith({ exit }), lit: lab });
    frame.kit.ceiling?.byLight.set(ALARM_RED, warm.canvas);
    const log = drawn(frame);
    // Each baked as it always was: the room's red ceiling lights, the rack's blue, the hatch's.
    const [rooms, pools, hatch] = ['rooms', 'pools', 'glow:hatch'].map((n) => bakeOf(frame, n));
    expect(callEntries(rooms?.log ?? [], 'drawImage')).toMatchObject([
      { args: [warm.canvas, 0, 0, 10, 6], op: 'lighter' },
    ]);
    expect(gradients(pools?.log ?? [])[0]?.stops[0]?.[1]).toBe(rgba(SERVER_BLUE, 0.55 * 0.28));
    expect(gradients(hatch?.log ?? [])[0]?.stops[0]?.[1]).toBe('rgba(240, 255, 246, 0.8)');
    // Added up at whole pixels into one canvas, which alone is laid on the picture, added.
    const sum = bakeOf(frame, 'steady');
    const added = callEntries(sum.log, 'drawImage');
    expect(added.map((e) => e.args[0])).toEqual([rooms?.canvas, pools?.canvas, hatch?.canvas]);
    const whole = added.every((e) => e.op === 'lighter' && e.args.slice(1).every(Number.isInteger));
    expect(whole).toBe(true);
    const images = callEntries(log, 'drawImage');
    const bakes = [sum, rooms, pools, hatch].map((b) => b?.canvas);
    const laid = images.filter((e) => bakes.includes(e.args[0]));
    expect(laid.map((e) => [e.args[0], e.op, e.alpha])).toEqual([[sum.canvas, 'lighter', 1]]);
    // Before the escape's red tint goes over the picture.
    const red = (e: Entry): boolean =>
      e.kind === 'set' && String(e.value).startsWith('rgba(255, 34');
    expect(log.indexOf(laid[0] as Entry)).toBeLessThan(log.findIndex(red));
  });

  it('adds them up again only as one of them is baked anew', () => {
    vi.stubGlobal('Path2D', FakePath2D);
    const map = mapWith({ width: 10, height: 6, tiles: TILES, decor: [RACK] });
    const lab = new Map([['LABOR', room(7, 'labor')]]);
    const frame = withKit(overlay, warm, { map, time: 10, lit: lab });
    drawn(frame);
    const first = frame.kit.bakes.entries.get('steady')?.baked;
    drawn(frame);
    expect(frame.kit.bakes.entries.get('steady')?.baked).toBe(first);
    // The Archiv's lights come up too: the rooms are baked anew, and the sum with them.
    drawn({ ...frame, lit: new Map([...lab, ['ARCHIV', room(2, 'archiv')]]) });
    const again = frame.kit.bakes.entries.get('steady')?.baked;
    expect(again).not.toBe(first);
    expect(again?.canvas).toBe(first?.canvas);
  });

  it('keeps the hatch’s glow apart while it grinds open, at the strength of the moment', () => {
    const exit = { lit: lit({ x: 8.5, y: 4.5, glow: 3.2 }, 'hatch'), open: 0.4 };
    const frame = withKit(overlay, warm, { light: lightWith({ exit }), hatch: 0.4 });
    const log = drawn(frame);
    const hatch = bakeOf(frame, 'glow:hatch');
    const laid = callEntries(log, 'drawImage').find((e) => e.args[0] === hatch.canvas);
    expect(laid).toMatchObject({ op: 'lighter', alpha: 0.4 });
    expect(frame.kit.bakes.entries.has('steady')).toBe(false);
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

describe('light — the phase’s colour grade over the picture and its darkness', () => {
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

  it('lays it over the darkness in one fill of the whole canvas, under the lamps’ red', () => {
    const lamp = lit({ x: 1.5, y: 1.5, glow: 1.5 }, 'lamp');
    const lamps = [{ mount: { x: 1.5, y: 1.5, facing: null }, lit: lamp }];
    const grade = GRADES.blackout;
    const frame = withKit(overlay, warm, { light: lightWith({ lamps }), grade });
    const log = drawn(frame);
    const fill = gradeFill(log, grade);
    expect(fill).toBeGreaterThan(laidAt(log, overlay.canvas));
    expect(fill).toBeLessThan(laidAt(log, bakeOf(frame, 'glow:lamp:1.5,1.5').canvas));
    expect(log[fill]).toMatchObject({ args: [0, 0, 800, 600], op: 'source-over', alpha: 1 });
    expect(callsOf(log, 'fillRect')).toHaveLength(1);
  });

  it('lays the escape’s red over it while the grade turns to the escape’s', () => {
    const grade = blend(GRADES.blackout, GRADES.escape, 0.5);
    const log = drawn(withKit(overlay, warm, { grade, red: 1, time: 0.3125 }));
    const red = log.findIndex(
      (e) => e.kind === 'set' && String(e.value).startsWith('rgba(255, 34, 22'),
    );
    expect(gradeFill(log, grade)).toBeGreaterThanOrEqual(0);
    expect(red).toBeGreaterThan(gradeFill(log, grade));
  });

  it('grades the audience’s lab and the lab lit whole over the power’s light', () => {
    const scene = { lit: true, cover: 0 };
    const audience = withKit(overlay, warm, { spectator: true, scene, grade: GRADES.normal });
    const seen = drawn(audience);
    const power = laidAt(seen, bakeOf(audience, 'power:whole').canvas);
    expect(gradeFill(seen, GRADES.normal)).toBeGreaterThan(power);
    const ending = { lit: 1, pull: 1, dark: 0 };
    const won = withKit(fakeCanvas(800, 600), warm, { ending, grade: GRADES.won });
    const lit = drawn(won);
    const wholePower = laidAt(lit, bakeOf(won, 'power:whole').canvas);
    expect(gradeFill(lit, GRADES.won)).toBeGreaterThan(wholePower);
  });

  it('lays nothing for the escape’s grade, which leaves the picture as it is', () => {
    const log = drawn(withKit(overlay, warm, { grade: GRADES.escape }));
    expect(callsOf(log, 'fillRect')).toEqual([]);
    expect(setsOf(log, 'fillStyle')).toEqual([]);
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

  it('leaves the grade to the layer, which folds it into its light map: no fill of its own', () => {
    const { frame, layer } = onLayer({ grade: GRADES.blackout });
    const log = drawn(frame);
    expect(layer.render).toHaveBeenCalledWith(frame, expect.any(Function));
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

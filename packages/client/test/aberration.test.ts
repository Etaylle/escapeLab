import { describe, expect, it, vi } from 'vitest';
import {
  ABERRATION_MS,
  ABERRATION_PX,
  draw,
  FRINGE,
  knockAt,
  SIDE,
  sidesOf,
} from '../src/world/render/aberration.js';
import type { Frame } from '../src/world/render/frame.js';
import { drawFrame } from '../src/world/render/pipeline.js';
import { callEntries, callsOf, fakeCanvas, FakePath2D, type FakeCanvas } from './fakeCanvas.js';
import { frameWith, kitWith } from './frames.js';

const NOW = 5_000_000;

/** A frame `ms` after an alarm came in (none for null), its scratch canvases recorded too. */
function knocked(
  ms: number | null,
  parts: Partial<Frame> = {},
): { frame: Frame; made: FakeCanvas[] } {
  const made: FakeCanvas[] = [];
  const kit = kitWith();
  kit.art.atlas.make = (width, height) => {
    const scratch = fakeCanvas(width, height, `scratch ${made.length}`);
    made.push(scratch);
    return scratch.canvas;
  };
  const alarm = ms === null ? null : { seq: 1, at: NOW - ms };
  return { frame: frameWith({ kit, alarm, now: NOW, ...parts }), made };
}

/** What the pass drew onto the picture's own canvas for `frame`, 800 × 600. */
function drawnOnto(frame: Frame): FakeCanvas {
  const picture = fakeCanvas(800, 600, 'picture');
  draw(picture.ctx, frame);
  return picture;
}

/** The pass's offset passes: by the scratch canvas each comes from, where each piece lands. */
function passes(log: FakeCanvas['log']): Map<unknown, unknown[][]> {
  const byCopy = new Map<unknown, unknown[][]>();
  for (const { args } of callEntries(log, 'drawImage')) {
    byCopy.set(args[0], [...(byCopy.get(args[0]) ?? []), args.slice(5, 7)]);
  }
  return byCopy;
}

describe('aberration — an alarm knocks the finished picture’s colours apart', () => {
  it('lays exactly two offset passes of the finished frame over it for ABERRATION_MS', () => {
    for (const ms of [0, 40, 100, ABERRATION_MS - 1]) {
      const { frame, made } = knocked(ms);
      const { log } = drawnOnto(frame);
      const laid = passes(log);
      expect([...laid.keys()]).toEqual([made[0]?.canvas, made[1]?.canvas]);
      const strength = 1 - ms / ABERRATION_MS;
      const shift = Math.max(1, Math.round(ABERRATION_PX * strength));
      const { copy } = sidesOf(800, 1);
      // Red pushed one way, blue the other: each pass in the picture's two sides.
      expect(laid.get(made[0]?.canvas)).toEqual([
        [shift, 0],
        [800 - copy + shift, 0],
      ]);
      expect(laid.get(made[1]?.canvas)).toEqual([
        [-shift, 0],
        [800 - copy - shift, 0],
      ]);
      for (const entry of callEntries(log, 'drawImage')) {
        expect(entry.op).toBe('lighter');
        expect(entry.alpha).toBeCloseTo(FRINGE * strength, 12);
      }
    }
  });

  it('draws nothing before an alarm, after ABERRATION_MS, without one, or for less motion', () => {
    expect(drawnOnto(knocked(null).frame).log).toEqual([]);
    expect(drawnOnto(knocked(ABERRATION_MS).frame).log).toEqual([]);
    expect(drawnOnto(knocked(-10).frame).log).toEqual([]);
    expect(drawnOnto(knocked(30, { reduced: true }).frame).log).toEqual([]);
  });

  it('closes the colours in as the knock fades: ABERRATION_PX apart at first, less after', () => {
    expect(knockAt({ seq: 1, at: NOW }, NOW, false)).toEqual({ strength: 1, px: ABERRATION_PX });
    const shifts = [0, 50, 100, 140].map((ms) => {
      const { log } = drawnOnto(knocked(ms).frame);
      return Number(callsOf(log, 'drawImage')[0]?.[5]);
    });
    expect(shifts[0]).toBe(ABERRATION_PX);
    expect([...shifts].sort((a, b) => b - a)).toEqual(shifts);
    expect(shifts[3]).toBeLessThan(shifts[0] ?? 0);
  });

  it('shifts by device pixels: twice as far on a screen twice as dense', () => {
    const viewport = { w: 1600, h: 1200, dpr: 2, textScale: 1, top: 0, boxes: [] };
    const { frame } = knocked(0, { viewport });
    const picture = fakeCanvas(1600, 1200, 'picture');
    draw(picture.ctx, frame);
    expect(callsOf(picture.log, 'drawImage')[0]?.[5]).toBe(2 * ABERRATION_PX);
  });

  it('cuts each copy of the picture’s two sides down to one colour', () => {
    const { frame, made } = knocked(75);
    const picture = drawnOnto(frame);
    const { copy } = sidesOf(800, 1);
    for (const [scratch, colour] of [
      [made[0], '#ff0000'],
      [made[1], '#0000ff'],
    ] as const) {
      expect([scratch?.canvas.width, scratch?.canvas.height]).toEqual([copy * 2, 600]);
      const copies = callEntries(scratch?.log ?? [], 'drawImage');
      expect(copies.map((entry) => [entry.args.slice(1), entry.op])).toEqual([
        [[0, 0, copy, 600, 0, 0, copy, 600], 'copy'],
        [[800 - copy, 0, copy, 600, copy, 0, copy, 600], 'source-over'],
      ]);
      expect(copies.every((entry) => entry.args[0] === picture.canvas)).toBe(true);
      const cut = callEntries(scratch?.log ?? [], 'fillRect')[0];
      expect(cut?.op).toBe('multiply');
      expect(cut?.args).toEqual([0, 0, copy * 2, 600]);
      expect(scratch?.log).toContainEqual({ kind: 'set', name: 'fillStyle', value: colour });
    }
  });

  it('keeps to the picture’s two sides, a SIDE of its width each', () => {
    const { log } = drawnOnto(knocked(20).frame);
    const side = Math.round(800 * SIDE);
    expect(callsOf(log, 'rect')).toEqual([
      [0, 0, side, 600],
      [800 - side, 0, side, 600],
    ]);
    const clip = log.findIndex((entry) => entry.kind === 'call' && entry.name === 'clip');
    const firstDraw = log.findIndex((entry) => entry.kind === 'call' && entry.name === 'drawImage');
    expect(clip).toBeGreaterThan(-1);
    expect(clip).toBeLessThan(firstDraw);
    // Each copy reaches past its side by as far as it may be pushed: what slides in is cut too.
    expect(sidesOf(800, 2)).toEqual({ side, copy: side + 2 * ABERRATION_PX });
  });

  it('comes last in the pipeline, over the finished picture', () => {
    vi.stubGlobal('Path2D', FakePath2D);
    const { frame } = knocked(10);
    const picture = fakeCanvas(800, 600, 'picture');
    drawFrame(picture.ctx, frame);
    vi.unstubAllGlobals();
    const last = picture.log.filter((entry) => entry.kind === 'call').slice(-5);
    expect(last.map((entry) => entry.kind === 'call' && entry.name)).toEqual([
      'drawImage',
      'drawImage',
      'drawImage',
      'drawImage',
      'restore',
    ]);
  });
});

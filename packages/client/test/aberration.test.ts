import { describe, expect, it, vi } from 'vitest';
import {
  ABERRATION_MS,
  ABERRATION_PX,
  draw,
  knockAt,
  SIDE,
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

/** What the pass drew onto the picture's own canvas for `frame`. */
function drawnOnto(frame: Frame): FakeCanvas {
  const picture = fakeCanvas(800, 600, 'picture');
  draw(picture.ctx, frame);
  return picture;
}

describe('aberration — an alarm knocks the finished picture’s colours apart', () => {
  it('lays exactly two offset copies of the finished frame over it for ABERRATION_MS', () => {
    for (const ms of [0, 40, 100, ABERRATION_MS - 1]) {
      const { frame, made } = knocked(ms);
      const { log } = drawnOnto(frame);
      const blits = callEntries(log, 'drawImage');
      expect(blits).toHaveLength(2);
      const [red, blue] = blits;
      const shift = Number(red?.args[1]);
      expect(shift).toBeGreaterThanOrEqual(1);
      expect(red?.args.slice(1)).toEqual([shift, 0]);
      expect(blue?.args.slice(1)).toEqual([-shift, 0]);
      expect(red?.args[0]).toBe(made[0]?.canvas);
      expect(blue?.args[0]).toBe(made[1]?.canvas);
      expect(red?.op).toBe('lighter');
      expect(blue?.op).toBe('lighter');
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
      return Number(callsOf(log, 'drawImage')[0]?.[1]);
    });
    expect(shifts[0]).toBe(ABERRATION_PX);
    expect([...shifts].sort((a, b) => b - a)).toEqual(shifts);
    expect(shifts[3]).toBeLessThan(shifts[0] ?? 0);
  });

  it('shifts by device pixels: twice as far on a screen twice as dense', () => {
    const viewport = { w: 1600, h: 1200, dpr: 2, top: 0, bottom: 0, boxes: [] };
    const { log } = drawnOnto(knocked(0, { viewport }).frame);
    expect(callsOf(log, 'drawImage')[0]?.[1]).toBe(2 * ABERRATION_PX);
  });

  it('cuts each copy down to one colour of the finished frame, and fades the picture’s own', () => {
    const { frame, made } = knocked(75);
    const picture = drawnOnto(frame);
    const side = Math.round(800 * SIDE) + 2;
    for (const [scratch, colour] of [
      [made[0], '#ff0000'],
      [made[1], '#0000ff'],
    ] as const) {
      const copies = callEntries(scratch?.log ?? [], 'drawImage');
      expect(copies.map((copy) => copy.args)).toEqual([
        [picture.canvas, 0, 0, side, 600, 0, 0, side, 600],
        [picture.canvas, 800 - side, 0, side, 600, 800 - side, 0, side, 600],
      ]);
      const cut = callEntries(scratch?.log ?? [], 'fillRect')[0];
      expect(cut?.op).toBe('multiply');
      expect(scratch?.log).toContainEqual({ kind: 'set', name: 'fillStyle', value: colour });
    }
    const fade = callEntries(picture.log, 'fillRect')[0];
    expect(fade?.op).toBe('multiply');
    const faded = { kind: 'set', name: 'fillStyle', value: '#80ff80' };
    expect(picture.log).toContainEqual(faded);
  });

  it('comes last in the pipeline, over the finished picture', () => {
    vi.stubGlobal('Path2D', FakePath2D);
    const { frame } = knocked(10);
    const picture = fakeCanvas(800, 600, 'picture');
    drawFrame(picture.ctx, frame);
    vi.unstubAllGlobals();
    const last = picture.log.filter((entry) => entry.kind === 'call').slice(-3);
    expect(last.map((entry) => entry.kind === 'call' && entry.name)).toEqual([
      'drawImage',
      'drawImage',
      'restore',
    ]);
    expect(last.slice(0, 2).map((entry) => entry.kind === 'call' && entry.op)).toEqual([
      'lighter',
      'lighter',
    ]);
  });
});

describe('aberration — kept to the picture’s sides', () => {
  it('clips both offset draws to the two sides, a SIDE of the width each', () => {
    const { frame } = knocked(20);
    const { log } = drawnOnto(frame);
    const side = Math.round(800 * SIDE);
    expect(callsOf(log, 'rect')).toEqual([
      [0, 0, side, 600],
      [800 - side, 0, side, 600],
    ]);
    const clip = log.findIndex((entry) => entry.kind === 'call' && entry.name === 'clip');
    const firstDraw = log.findIndex((entry) => entry.kind === 'call' && entry.name === 'drawImage');
    expect(clip).toBeGreaterThan(-1);
    expect(clip).toBeLessThan(firstDraw);
  });

  it('cuts each copy down a shift wider than the sides, so what slides in is one colour too', () => {
    const { frame, made } = knocked(0);
    drawnOnto(frame);
    const side = Math.round(800 * SIDE) + ABERRATION_PX;
    expect(callsOf(made[0]?.log ?? [], 'fillRect')).toEqual([
      [0, 0, side, 600],
      [800 - side, 0, side, 600],
    ]);
  });
});

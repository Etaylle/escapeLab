import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRACE_FRAMES } from '../src/world/frameTrace.js';
import { bakedFor } from '../src/world/render/bakes.js';
import { censusTrace, lightCensus } from '../src/world/render/census.js';
import { clipOf } from '../src/world/render/clips.js';
import { FakePath2D } from './fakeCanvas.js';
import { frameWith } from './frames.js';

describe('census — what the light works out anew, frame by frame', () => {
  it('takes each frame’s sights and bakes off the running counts', () => {
    const census = lightCensus();
    const trace = censusTrace();
    trace.record(census);
    census.sights += 3;
    census.bakes += 1;
    trace.record(census);
    census.sights += 1;
    trace.record(census);
    trace.record(census);
    // Sights a frame 0, 3, 1, 0: the median by nearest rank 0, the 95th 3.
    expect(trace.work).toEqual({
      frames: 4,
      sights: { p50: 0, p95: 3, max: 3, total: 4 },
      bakes: 1,
    });
  });

  it('forgets the frames before a reset, counting on from the last one before it', () => {
    const census = lightCensus();
    const trace = censusTrace();
    census.sights = 10;
    census.bakes = 4;
    trace.record(census);
    trace.reset();
    const none = { p50: 0, p95: 0, max: 0, total: 0 };
    expect(trace.work).toEqual({ frames: 0, sights: none, bakes: 0 });
    census.sights += 2;
    census.bakes += 1;
    trace.record(census);
    const two = { p50: 2, p95: 2, max: 2, total: 2 };
    expect(trace.work).toEqual({ frames: 1, sights: two, bakes: 1 });
  });

  it('keeps the frame trace’s length of frames a frame, the totals over all of them', () => {
    const census = lightCensus();
    const trace = censusTrace();
    trace.record(census);
    for (let i = 0; i < TRACE_FRAMES + 20; i++) {
      census.sights += 1;
      trace.record(census);
    }
    expect(trace.work.frames).toBe(TRACE_FRAMES);
    expect(trace.work.sights.total).toBe(TRACE_FRAMES + 20);
  });
});

describe('census — counted where the light works it out', () => {
  beforeEach(() => {
    vi.stubGlobal('Path2D', FakePath2D);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('counts a bake made, none for a bake used again', () => {
    const frame = frameWith();
    const box = { x: 1, y: 1, w: 2, h: 2 };
    const square = (g: CanvasRenderingContext2D): void => g.fillRect(1, 1, 2, 2);
    bakedFor(frame, { name: 'lamp', of: 1, box }, square);
    bakedFor(frame, { name: 'lamp', of: 1, box }, square);
    expect(frame.kit.census.bakes).toBe(1);
    bakedFor(frame, { name: 'lamp', of: 2, box }, square);
    bakedFor(frame, { name: 'none', of: 1, box: null }, square);
    expect(frame.kit.census.bakes).toBe(2);
  });

  it('counts the sight a coloured light’s clip is worked out from, once for its spot', () => {
    const frame = frameWith();
    const rack = { x: 7.5, y: 3.5, reach: 1.5 };
    clipOf(frame, rack, '');
    clipOf(frame, rack, '');
    expect(frame.kit.census.sights).toBe(1);
    clipOf(frame, { ...rack, x: 2.5 }, '');
    expect(frame.kit.census.sights).toBe(2);
  });
});

import { describe, expect, it } from 'vitest';
import {
  frameTrace,
  TRACE_FRAMES,
  traceRequested,
  type FrameTrace,
} from '../src/world/frameTrace.js';

/** A trace fed the durations 0, 1, 2, … up to `count - 1`. */
function fedWith(count: number): FrameTrace {
  const trace = frameTrace();
  for (let ms = 0; ms < count; ms++) {
    trace.record(ms);
  }
  return trace;
}

/** The durations `from`, `from + 1`, … — TRACE_FRAMES of them. */
const ringFrom = (from: number): number[] =>
  Array.from({ length: TRACE_FRAMES }, (_, i) => from + i);

describe('frameTrace — the last frame durations for the walkthrough', () => {
  it('starts empty', () => {
    expect(frameTrace().frames).toEqual([]);
  });

  it('keeps every duration, oldest first, while the ring has room', () => {
    const trace = frameTrace();
    for (const ms of [16.7, 33.4, 17.1]) {
      trace.record(ms);
    }
    expect(trace.frames).toEqual([16.7, 33.4, 17.1]);
  });

  it('holds exactly the last TRACE_FRAMES once full', () => {
    expect(fedWith(TRACE_FRAMES).frames).toEqual(ringFrom(0));
  });

  it('drops the oldest past the end, the rest still oldest first', () => {
    expect(fedWith(TRACE_FRAMES + 5).frames).toEqual(ringFrom(5));
  });

  it('stays in order over more than two laps of the ring', () => {
    expect(fedWith(2 * TRACE_FRAMES + 7).frames).toEqual(ringFrom(TRACE_FRAMES + 7));
  });

  it('hands out a copy that later frames leave alone', () => {
    const trace = fedWith(3);
    const read = trace.frames;
    trace.record(99);
    read.push(-1);
    expect(read).toEqual([0, 1, 2, -1]);
    expect(trace.frames).toEqual([0, 1, 2, 99]);
  });
});

describe('traceRequested — only ?trace=1 turns the trace on', () => {
  it.each([
    ['?trace=1', true],
    ['?room=K7QX&trace=1', true],
    ['', false],
    ['?room=K7QX', false],
    ['?trace=0', false],
    ['?trace', false],
    ['?trace=true', false],
  ])('%j → %s', (search, on) => {
    expect(traceRequested(search)).toBe(on);
  });
});

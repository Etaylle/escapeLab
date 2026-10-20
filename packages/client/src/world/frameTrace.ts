/**
 * The walkthrough's frame budget (`tools/shots.mjs`): a page opened with
 * `?trace=1` keeps the world's last frame durations — the time from one
 * animation frame to the next, unclamped — and the harness reads them off
 * `window.__escapelab.frames` (probes.ts), after `resetFrames()` to sample a
 * window of its own choosing. Without the flag nothing is kept.
 */

/** How many frame durations the trace keeps: about five seconds at 60 Hz. */
export const TRACE_FRAMES = 300;

/** The last TRACE_FRAMES frame durations, in ms, in a ring of fixed size. */
export interface FrameTrace {
  /** Adds one frame's duration; once the ring is full, the oldest makes room. */
  record(ms: number): void;
  /** The durations kept, oldest first: a fresh copy on every read. */
  readonly frames: number[];
  /** Forgets every duration kept: what is read next was recorded after this. */
  resetFrames(): void;
}

/** Whether a page's query string asks for the frame trace and the other probes: `?trace=1`. */
export function traceRequested(search: string): boolean {
  return new URLSearchParams(search).get('trace') === '1';
}

/** A fresh trace, empty until its first frame. */
export function frameTrace(): FrameTrace {
  const ring: number[] = [];
  // Where the next duration goes; once the ring is full, also where the oldest is.
  let next = 0;
  return {
    record(ms) {
      ring[next] = ms;
      next = (next + 1) % TRACE_FRAMES;
    },
    get frames() {
      return ring.length < TRACE_FRAMES
        ? [...ring]
        : [...ring.slice(next), ...ring.slice(0, next)];
    },
    resetFrames() {
      ring.length = 0;
      next = 0;
    },
  };
}

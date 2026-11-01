import { TRACE_FRAMES } from '../frameTrace.js';

/**
 * What the world's light works out anew, counted where it is made: the sights
 * taken — a lamp's (frameLight.ts), a coloured light's clip (render/clips.ts)
 * — and the bakes made (render/bakes.ts), each costing far more than a frame
 * that finds it kept. The walkthrough (`?trace=1`, probes.ts `lightWork`) reads
 * how many a window took, frame by frame, so that a cache that stops holding
 * shows in CI's log as more of them a frame before it shows in the frames.
 */

/** The sights and bakes worked out since the world came up. */
export interface LightCensus {
  sights: number;
  bakes: number;
}

/** A census of nothing yet. */
export function lightCensus(): LightCensus {
  return { sights: 0, bakes: 0 };
}

/** What a window of frames worked out: how many frames were drawn, sights a frame, bakes. */
export interface LightWork {
  frames: number;
  /** the sights worked out a frame — by nearest rank, as tools/percentile.mjs — and in all */
  sights: { p50: number; p95: number; max: number; total: number };
  bakes: number;
}

/** A window's census, frame by frame, read off a world's running counts. */
export interface CensusTrace {
  /** Ends a drawn frame: what `census` counted since the frame before is this frame's. */
  record(census: LightCensus): void;
  /** What the frames since the last reset worked out, the last TRACE_FRAMES of them a frame. */
  readonly work: LightWork;
  /** Forgets the frames kept: what is read next was worked out after this. */
  reset(): void;
}

/** The p-th percentile of `values` by nearest rank; 0 for none. */
function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(1, Math.ceil((p * sorted.length) / 100)) - 1] ?? 0;
}

/** A fresh trace: nothing counted until its first frame. */
export function censusTrace(): CensusTrace {
  let last: LightCensus | null = null;
  let sights: number[] = [];
  let total = { sights: 0, bakes: 0 };
  return {
    record(census) {
      const before = last ?? census;
      const counted = census.sights - before.sights;
      sights.push(counted);
      if (sights.length > TRACE_FRAMES) {
        sights.shift();
      }
      total = { sights: total.sights + counted, bakes: total.bakes + census.bakes - before.bakes };
      last = { ...census };
    },
    get work() {
      const stats = {
        p50: percentile(sights, 50),
        p95: percentile(sights, 95),
        max: Math.max(0, ...sights),
        total: total.sights,
      };
      return { frames: sights.length, sights: stats, bakes: total.bakes };
    },
    reset() {
      sights = [];
      total = { sights: 0, bakes: 0 };
    },
  };
}

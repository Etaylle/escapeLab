/**
 * What each pass of the world's picture costs (`?profile=1`): every pass
 * timed on its own, its canvas made to draw what it was asked to before the
 * clock stops — a canvas records its drawing and draws it later, at the
 * latest when the frame is put on the screen, so a pass timed without that
 * would leave its pixels to whatever comes next — and the per-frame sums of
 * the last PROFILE_FRAMES frames kept, for the walkthrough to read p50 and
 * p95 off `window.__escapelab.passes` (probes.ts). Reading a pixel back costs
 * a little of its own, so a profiled frame runs a little slower than one that
 * is not; without the flag nothing is timed.
 */

/** The parts of a frame timed: its assembly, then the passes in draw order. */
export const PASS_NAMES = [
  'assemble',
  'tiles',
  'objects',
  'actors',
  'glow',
  'light',
  'darkness',
  'hud',
  'overlays',
] as const;

export type PassName = (typeof PASS_NAMES)[number];

/** A part's cost per frame, ms: the median and the 95th percentile. */
export interface PassStat {
  p50: number;
  p95: number;
}

/** Every part's cost per frame, and the frame's whole. */
export type PassStats = Record<PassName | 'total', PassStat>;

/** How many frames the profile keeps: about five seconds at 60 Hz. */
export const PROFILE_FRAMES = 300;

export interface PassProfile {
  /**
   * Times `draw` as part `name` of this frame, the canvas of `ctx` flushed
   * before the clock stops, and returns what it returns. A part timed inside
   * another counts for itself alone: the outer one's time leaves it out. A
   * part timed twice in a frame counts both times.
   */
  time<T>(name: PassName, ctx: CanvasRenderingContext2D | null, draw: () => T): T;
  /** Ends the frame: what each part took goes into its ring, 0 for a part that did not run. */
  endFrame(): void;
  /** The cost of each part over the frames kept; zeros before the first frame. */
  readonly stats: PassStats;
  /** Forgets every frame kept: what is read next was drawn after this. */
  reset(): void;
}

/** Whether a page's query string asks for the profile: `?profile=1`. */
export function profileRequested(search: string): boolean {
  return new URLSearchParams(search).get('profile') === '1';
}

/** Makes the canvas of `ctx` draw what it was asked to so far: a pixel read back flushes it. */
function flush(ctx: CanvasRenderingContext2D): void {
  ctx.getImageData(0, 0, 1, 1);
}

/** The p-th percentile of `values` by nearest rank (tools/percentile.mjs); 0 for none. */
function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(1, Math.ceil((p * sorted.length) / 100)) - 1] ?? 0;
}

/** A fresh profile reading the time off `clock`, ms (performance.now() by default). */
export function passProfile(clock: () => number = () => performance.now()): PassProfile {
  const rings = new Map<PassName | 'total', number[]>();
  const keys: (PassName | 'total')[] = [...PASS_NAMES, 'total'];
  let frame = new Map<PassName, number>();
  /** the parts being timed now, outermost first, each with the time of the parts inside it */
  const open: { inner: number }[] = [];
  const keep = (key: PassName | 'total', ms: number): void => {
    const ring = rings.get(key) ?? [];
    ring.push(ms);
    if (ring.length > PROFILE_FRAMES) {
      ring.shift();
    }
    rings.set(key, ring);
  };
  return {
    time(name, ctx, draw) {
      const timing = { inner: 0 };
      open.push(timing);
      const start = clock();
      try {
        const drawn = draw();
        if (ctx !== null) {
          flush(ctx);
        }
        return drawn;
      } finally {
        open.pop();
        const spent = clock() - start;
        const outer = open.at(-1);
        if (outer !== undefined) {
          outer.inner += spent;
        }
        frame.set(name, (frame.get(name) ?? 0) + spent - timing.inner);
      }
    },
    endFrame() {
      let total = 0;
      for (const name of PASS_NAMES) {
        const ms = frame.get(name) ?? 0;
        total += ms;
        keep(name, ms);
      }
      keep('total', total);
      frame = new Map();
    },
    get stats() {
      const entries = keys.map((key) => {
        const ring = rings.get(key) ?? [];
        return [key, { p50: percentile(ring, 50), p95: percentile(ring, 95) }] as const;
      });
      return Object.fromEntries(entries) as PassStats;
    },
    reset() {
      rings.clear();
      frame = new Map();
    },
  };
}

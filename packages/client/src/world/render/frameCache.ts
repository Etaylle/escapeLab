/**
 * Canvases kept between frames by key — the light's bakes (bakes.ts), the
 * glows' sprites (radial.ts) — the one used longest ago first. What the frame
 * being drawn uses, or the frame before it used, stays whatever it holds: on
 * a large window one frame's bakes alone may pass the limits, and baking them
 * anew frame after frame would cost far more than the memory they hold. Of
 * the rest, the ones used longest ago go past `most` entries or past `pixels`
 * between them, their canvases freed at once: a zoom moving or a room warming
 * up leaves stale ones behind, and a weak machine has little memory to spare.
 */

/** What is kept, and which keys the frame being drawn and the one before it used. */
export interface FrameCache<T> {
  /** by key, the one used longest ago first */
  entries: Map<string, T>;
  /** the frame being drawn, compared by identity */
  frame: object | null;
  using: Set<string>;
  used: Set<string>;
}

/** How many entries a cache keeps at most, and how many pixels their canvases may hold. */
export interface CacheLimits {
  most: number;
  pixels: number;
}

/** An empty cache. */
export function frameCache<T>(): FrameCache<T> {
  return { entries: new Map(), frame: null, using: new Set(), used: new Set() };
}

/** Marks `key` as used by `frame`: a frame other than the last moves the marks on by one. */
function mark(cache: FrameCache<unknown>, key: string, frame: object): void {
  if (cache.frame !== frame) {
    cache.frame = frame;
    cache.used = cache.using;
    cache.using = new Set();
  }
  cache.using.add(key);
}

/** The entry under `key`, now the one used last, by `frame`; undefined where there is none. */
export function touch<T>(cache: FrameCache<T>, key: string, frame: object): T | undefined {
  mark(cache, key, frame);
  const entry = cache.entries.get(key);
  if (entry !== undefined) {
    cache.entries.delete(key);
    cache.entries.set(key, entry);
  }
  return entry;
}

/**
 * Keeps `entry` under `key`, used by `frame`; then lets the entries used
 * longest ago go — none the last two frames used — until at most
 * `limits.most` are left and their canvases (`canvasOf`) hold at most
 * `limits.pixels`, and frees the canvas of each that goes.
 */
export function keep<T>(
  cache: FrameCache<T>,
  [key, entry]: readonly [string, T],
  frame: object,
  limits: CacheLimits,
  canvasOf: (entry: T) => HTMLCanvasElement | null,
): void {
  mark(cache, key, frame);
  cache.entries.delete(key);
  cache.entries.set(key, entry);
  const pixelsOf = (kept: T): number => {
    const canvas = canvasOf(kept);
    return canvas === null ? 0 : canvas.width * canvas.height;
  };
  let total = 0;
  for (const kept of cache.entries.values()) {
    total += pixelsOf(kept);
  }
  // What the last two frames used was used last: it all lies after the first of it.
  for (const [name, kept] of cache.entries) {
    const within = cache.entries.size <= limits.most && total <= limits.pixels;
    if (within || cache.using.has(name) || cache.used.has(name)) {
      break;
    }
    total -= pixelsOf(kept);
    const canvas = canvasOf(kept);
    if (canvas !== null) {
      canvas.width = 0;
      canvas.height = 0;
    }
    cache.entries.delete(name);
  }
}

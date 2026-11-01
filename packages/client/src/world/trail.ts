import { WALK_SPEED, type RelayedPosition } from '@escapelab/core';

/**
 * trail.ts: a partner's walk as this screen draws it — the way Source and Fiedler draw remote
 * players: every position the server relays is a sample of the walk at a known moment, and the
 * figure is drawn REMOTE_DELAY_MS in the past, on a straight line between the two samples
 * round that moment. Past the newest sample it goes on as it went for at most
 * MAX_EXTRAPOLATE_MS, then stands. Nothing eases or chases: the figure covers ground at the pace
 * the walker covered it. A walk that sets off after a stand longer than STAND_MS starts as late
 * as a walk's pace allows, not creeping off the moment the walker last stood sampled.
 *
 * A sample's moment is the sender's own (`t`, the frame it was walked in), tied to the server's
 * clock by the smallest gap between it and the server's receipt (`rt`) over the last
 * OFFSET_WINDOW samples: the sender's clock offset plus its fastest way to the server. A spawn
 * the server placed itself has no `t`; its receipt is its moment.
 */

/** How far in the past a partner is drawn, ms: about two of the sender's 80-ms updates. */
export const REMOTE_DELAY_MS = 150;
/** How far past its newest sample a walking figure goes on, ms, before it stands. */
export const MAX_EXTRAPOLATE_MS = 100;
/** Over how many samples the sender's offset to the server's clock is the smallest gap. */
export const OFFSET_WINDOW = 32;
/** Two samples this far apart, in tiles, are a jump — a spawn, a step put back — never a walk. */
export const JUMP_TILES = 1.5;
/** How long a sample is kept once the drawn moment has passed it, ms. */
const KEEP_MS = 1000;
/**
 * A stand longer than this between a standing sample and the walk's first, ms, ends as late as
 * a walk's pace allows: spread over the whole stand, the walk's first steps would creep off
 * early and the rest jump in as the sample came. A shorter stop — a turn — is drawn straight.
 */
export const STAND_MS = 2 * REMOTE_DELAY_MS;

/** One sample of a walk: where, facing where, walking or not, by the sender's clock and the server's. */
export interface Sample {
  x: number;
  y: number;
  facing: number;
  moving: boolean;
  /** the sender's clock, epoch ms; null for a position the server placed */
  t: number | null;
  /** the server's receipt, epoch ms by its clock */
  rt: number;
}

/** A partner's samples, oldest first, and the gaps their moments had to the server's receipt. */
export interface Trail {
  samples: Sample[];
  gaps: number[];
}

/** A trail before its first sample. */
export function newTrail(): Trail {
  return { samples: [], gaps: [] };
}

/** Whether `pos` is the sample the trail ended with: a broadcast repeats what did not change. */
function repeats(trail: Trail, pos: RelayedPosition): boolean {
  const last = trail.samples.at(-1);
  return last !== undefined && last.t === pos.t && last.rt === pos.rt;
}

/**
 * Takes the latest relayed position of a partner into their trail — once: the same sample
 * heard again is no new one. A sample from before the trail's newest starts it over (the
 * sender's page began anew).
 */
export function hear(trail: Trail, pos: RelayedPosition): void {
  if (repeats(trail, pos)) {
    return;
  }
  const last = trail.samples.at(-1);
  if (last !== undefined && pos.t !== null && last.t !== null && pos.t < last.t) {
    trail.samples = [];
    trail.gaps = [];
  }
  const { x, y, facing, moving, t, rt } = pos;
  trail.samples.push({ x, y, facing, moving, t, rt });
  if (t !== null) {
    trail.gaps = [...trail.gaps, rt - t].slice(-OFFSET_WINDOW);
  }
}

/** The sender's clock against the server's: the smallest gap of late; 0 before any. */
function offsetOf(trail: Trail): number {
  return trail.gaps.length === 0 ? 0 : Math.min(...trail.gaps);
}

/** When `sample` was true on the server's clock, with the sender's offset `offset`. */
function momentOf(sample: Sample, offset: number): number {
  return sample.t === null ? sample.rt : sample.t + offset;
}

/** Where a partner is drawn, which way they face and whether they walk. */
export interface Drawn {
  x: number;
  y: number;
  facing: number;
  moving: boolean;
}

/** Less of a way than this between two samples, in tiles, is standing, however they say it. */
const STILL_TILES = 0.001;

/**
 * `a` on its way to `b`, true `span` ms apart, `k` of that time gone (0 to 1): on a straight
 * line — a jump stays at `a` until it is made, and a walk setting off after a stand longer
 * than STAND_MS waits as long as a walk's pace leaves it. The figure walks while it covers
 * that way, facing along it, as a walker faces where they go; standing, it faces as sampled.
 */
function between(a: Sample, b: Sample, k: number, span: number): Drawn {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const way = Math.hypot(dx, dy);
  if (way > JUMP_TILES) {
    return { x: a.x, y: a.y, facing: a.facing, moving: a.moving };
  }
  let share = k;
  if (!a.moving && b.moving && span > STAND_MS) {
    const walked = Math.min(1, (way / WALK_SPEED) * (1000 / span));
    share = Math.max(0, (k - (1 - walked)) / walked);
  }
  const walking = way > STILL_TILES && share > 0 && share < 1;
  return {
    x: a.x + dx * share,
    y: a.y + dy * share,
    facing: walking ? Math.atan2(dy, dx) : share >= 1 ? b.facing : a.facing,
    moving: walking,
  };
}

/**
 * Past the newest sample (`last`, true at `lastAt`): on as the walk went from `before` for at
 * most MAX_EXTRAPOLATE_MS — a walker who stopped, or jumped, stands where they were sampled.
 */
function onward(before: Sample | undefined, last: Sample, lastAt: number, at: number, offset: number): Drawn {
  const still = { x: last.x, y: last.y, facing: last.facing, moving: last.moving };
  if (before === undefined || !last.moving) {
    return still;
  }
  const span = lastAt - momentOf(before, offset);
  const jump = Math.hypot(last.x - before.x, last.y - before.y) > JUMP_TILES;
  if (span <= 0 || jump) {
    return still;
  }
  const ahead = Math.min(at - lastAt, MAX_EXTRAPOLATE_MS) / span;
  return { ...still, x: last.x + (last.x - before.x) * ahead, y: last.y + (last.y - before.y) * ahead };
}

/**
 * Where the trail puts its walker at `at` (server time, epoch ms — REMOTE_DELAY_MS before now
 * as the caller reads it): between the samples round it, before the first at the first, past
 * the newest as `onward` has it; null for a trail without samples. Samples the moment has
 * long passed are let go.
 */
export function drawnAt(trail: Trail, at: number): Drawn | null {
  const offset = offsetOf(trail);
  const { samples } = trail;
  const next = samples.findIndex((sample) => momentOf(sample, offset) > at);
  if (next === -1) {
    const last = samples.at(-1);
    return last === undefined
      ? null
      : onward(samples.at(-2), last, momentOf(last, offset), at, offset);
  }
  const later = samples[next];
  const earlier = samples[next - 1];
  if (later === undefined) {
    return null;
  }
  if (earlier === undefined) {
    return { x: later.x, y: later.y, facing: later.facing, moving: later.moving };
  }
  const from = momentOf(earlier, offset);
  const span = Math.max(1e-6, momentOf(later, offset) - from);
  const k = (at - from) / span;
  // What the drawn moment has long passed goes; the sample just before it stays.
  const gone = samples.findIndex((sample, i) => i >= next - 1 || momentOf(sample, offset) >= at - KEEP_MS);
  if (gone > 0) {
    trail.samples = samples.slice(gone);
  }
  return between(earlier, later, k, span);
}

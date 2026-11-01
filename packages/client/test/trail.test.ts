import { describe, expect, it } from 'vitest';
import { WALK_SPEED, type RelayedPosition } from '@escapelab/core';
import {
  drawnAt,
  hear,
  JUMP_TILES,
  MAX_EXTRAPOLATE_MS,
  newTrail,
  REMOTE_DELAY_MS,
  type Trail,
} from '../src/world/trail.js';

const FRAME_MS = 1000 / 60;
/** How often a page sends its position, ms (world/stream.ts): every fifth frame. */
const SEND_MS = 80;

/** A sample of a walk east along row 2.5, `x` at the sender's `t`, the server taking it at `rt`. */
function walking(x: number, t: number | null, rt: number, moving = true): RelayedPosition {
  return { x, y: 2.5, facing: 0, moving, t, rt };
}

/** The coefficient of variation of `values`: their spread against their mean. */
function variation(values: readonly number[]): number {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const sd = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);
  return sd / mean;
}

/** A small deterministic stream of numbers in [0, 1). */
function jitter(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 2_147_483_648;
  };
}

/** A relayed sample and when it reaches the partner's screen (server time). */
interface Relayed {
  arrives: number;
  pos: RelayedPosition;
}

/**
 * A walk east at WALK_SPEED for `seconds`, sampled on every fifth frame of the sender's — its
 * clock `skew` ms off the server's — taken by the server 1–3 ms later and on the partner's
 * screen up to a broadcast's 66 ms after that (`seed` picks the delays).
 */
function relay(seconds: number, seed: number, skew = 0): Relayed[] {
  const next = jitter(seed);
  const out: Relayed[] = [];
  for (let frame = 0; frame * FRAME_MS <= seconds * 1000; frame += 5) {
    const t = frame * FRAME_MS;
    const rt = t + 1 + 2 * next();
    const x = 2 + WALK_SPEED * (t / 1000);
    out.push({ arrives: rt + 1 + 66 * next(), pos: walking(x, t + skew, rt) });
  }
  return out;
}

/** The newest of `relayed` on screen at `now`; none before the first. */
function newestAt(relayed: readonly Relayed[], now: number): Relayed | undefined {
  return relayed.filter((r) => r.arrives <= now).at(-1);
}

/** What a screen draws of `relayed` frame by frame, REMOTE_DELAY_MS behind: moment and x. */
function drawnByTrail(relayed: readonly Relayed[], untilMs: number): { at: number; x: number }[] {
  const trail = newTrail();
  const drawn: { at: number; x: number }[] = [];
  for (let frame = 0; frame * FRAME_MS <= untilMs; frame++) {
    const now = frame * FRAME_MS;
    const latest = newestAt(relayed, now);
    if (latest !== undefined) {
      hear(trail, latest.pos);
    }
    const at = now - REMOTE_DELAY_MS;
    const where = drawnAt(trail, at);
    if (where !== null) {
      drawn.push({ at, x: where.x });
    }
  }
  return drawn;
}

/** The rule it replaced: every frame 1 − e^(−12 dt) of the way to the newest position heard. */
function drawnByChase(relayed: readonly Relayed[], untilMs: number): { at: number; x: number }[] {
  let rx = 2;
  const drawn: { at: number; x: number }[] = [];
  for (let frame = 0; frame * FRAME_MS <= untilMs; frame++) {
    const now = frame * FRAME_MS;
    const target = newestAt(relayed, now)?.pos.x ?? rx;
    rx += (target - rx) * (1 - Math.exp(-(FRAME_MS / 1000) * 12));
    drawn.push({ at: now, x: rx });
  }
  return drawn;
}

/** The steps from frame to frame while the walk was well under way, tiles. */
function midWalkSteps(drawn: readonly { at: number; x: number }[], fromMs: number, toMs: number) {
  return drawn
    .slice(1)
    .map((d, i) => ({ at: d.at, step: d.x - (drawn[i]?.x ?? d.x) }))
    .filter((d) => d.at > fromMs && d.at < toMs)
    .map((d) => d.step);
}

describe('a partner drawn 150 ms in the past', () => {
  it('covers the same ground every frame however unevenly the samples arrive', () => {
    const steps = midWalkSteps(drawnByTrail(relay(3, 7), 3400), 400, 2700);
    expect(steps.length).toBeGreaterThan(100);
    expect(variation(steps)).toBeLessThan(0.05);
    const ideal = WALK_SPEED * (FRAME_MS / 1000);
    const sorted = [...steps].sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length / 2)]).toBeCloseTo(ideal, 3);
  });

  it('is far steadier than the exponential chase it replaced, on the same arrivals', () => {
    const relayed = relay(3, 7);
    const chased = variation(midWalkSteps(drawnByChase(relayed, 3400), 400, 2700));
    const trailed = variation(midWalkSteps(drawnByTrail(relayed, 3400), 400, 2700));
    expect(chased).toBeGreaterThan(0.25);
    expect(trailed).toBeLessThan(chased / 5);
  });

  it('keeps the walk 150 ms behind, plus the fastest way the samples took to the server', () => {
    const relayed = relay(2, 11);
    const fastest = Math.min(...relayed.map((r) => r.pos.rt - (r.pos.t ?? r.pos.rt)));
    for (const { at, x } of drawnByTrail(relayed, 2400).filter((d) => d.at > 500 && d.at < 1500)) {
      const truth = 2 + WALK_SPEED * ((at - fastest) / 1000);
      expect(Math.abs(x - truth)).toBeLessThan(0.01);
    }
  });

  it('draws a sender whose clock runs 5 s ahead just the same', () => {
    const right = drawnByTrail(relay(2, 3), 2400);
    const ahead = drawnByTrail(relay(2, 3, 5_000), 2400);
    expect(ahead).toHaveLength(right.length);
    ahead.forEach((d, i) => expect(d.x).toBeCloseTo(right[i]?.x ?? Number.NaN, 6));
  });
});

describe('a partner past their newest sample', () => {
  /** A trail of a walk sampled at 0, 80 and 160 ms, the server taking each 5 ms later. */
  function sampled(moving = true): Trail {
    const trail = newTrail();
    for (const t of [0, SEND_MS, 2 * SEND_MS]) {
      hear(trail, walking(2 + WALK_SPEED * (t / 1000), t, t + 5, moving || t < 2 * SEND_MS));
    }
    return trail;
  }

  it('walks on as they walked for at most 100 ms, then stands', () => {
    const trail = sampled();
    const newest = 2 + WALK_SPEED * 0.16;
    const lastAt = 2 * SEND_MS + 5;
    expect(drawnAt(trail, lastAt + 50)?.x).toBeCloseTo(newest + WALK_SPEED * 0.05, 9);
    const capped = newest + WALK_SPEED * (MAX_EXTRAPOLATE_MS / 1000);
    expect(drawnAt(trail, lastAt + MAX_EXTRAPOLATE_MS)?.x).toBeCloseTo(capped, 9);
    expect(drawnAt(trail, lastAt + 900)?.x).toBeCloseTo(capped, 9);
  });

  it('stands where a walker who stopped was sampled standing', () => {
    const trail = sampled(false);
    const newest = 2 + WALK_SPEED * 0.16;
    expect(drawnAt(trail, 2 * SEND_MS + 5 + 60)?.x).toBe(newest);
    expect(drawnAt(trail, 2 * SEND_MS + 5 + 60)?.moving).toBe(false);
  });

  it('stands at the first sample before it, and draws nothing without one', () => {
    expect(drawnAt(newTrail(), 0)).toBeNull();
    expect(drawnAt(sampled(), -500)?.x).toBe(2);
  });

  it('keeps a second of samples on a slow line, where every frame draws past the newest', () => {
    const trail = newTrail();
    // ten minutes of a walk, each sample drawn 200 ms after its moment: a 300 ms round trip
    for (let i = 0; i < 7_500; i++) {
      const t = i * SEND_MS;
      hear(trail, walking(2 + (i % 100) * 0.01, t, t + 5));
      drawnAt(trail, t + 5 + 200);
    }
    expect(trail.samples.length).toBeLessThanOrEqual(1000 / SEND_MS + 3);
    // and goes on from the newest two as ever
    const newest = 2 + 99 * 0.01;
    expect(drawnAt(trail, 7_499 * SEND_MS + 5 + 50)?.x).toBeCloseTo(newest + 0.01 * (50 / 80), 9);
  });
});

describe('what a trail takes in', () => {
  it('takes a sample heard again only once', () => {
    const trail = newTrail();
    hear(trail, walking(2, 0, 5));
    hear(trail, walking(2, 0, 5));
    hear(trail, walking(2.3, 80, 85));
    hear(trail, walking(2.3, 80, 85));
    expect(trail.samples).toHaveLength(2);
  });

  it('never slides a jump: a step put back or a new spawn is made at its moment', () => {
    const trail = newTrail();
    hear(trail, walking(2, 0, 5));
    hear(trail, walking(2 + JUMP_TILES + 1, 80, 85));
    expect(drawnAt(trail, 60)?.x).toBe(2);
    expect(drawnAt(trail, 86)?.x).toBe(2 + JUMP_TILES + 1);
  });

  it('starts over where the sender’s page did: a sample from before its newest', () => {
    const trail = newTrail();
    hear(trail, walking(2, 50_000, 50_005));
    hear(trail, walking(2.3, 50_080, 50_085));
    hear(trail, walking(9, 100, 50_200));
    expect(trail.samples).toHaveLength(1);
    expect(drawnAt(trail, 50_300)?.x).toBe(9);
  });

  it('sets off after a long stand as late as a walk’s pace allows: no creeping, no jump', () => {
    const trail = newTrail();
    hear(trail, walking(2, 0, 2, false));
    // she sets off 10 s on; the first sample of her walk was taken 40 ms into it
    const first = 2 + WALK_SPEED * 0.04;
    hear(trail, walking(first, 10_040, 10_042));
    // drawn as that sample comes in, 150 ms behind: she still stands
    expect(drawnAt(trail, 10_042 - REMOTE_DELAY_MS)?.x).toBe(2);
    expect(drawnAt(trail, 9_999)?.x).toBe(2);
    expect(drawnAt(trail, 10_022)?.x).toBeCloseTo(2 + WALK_SPEED * 0.02, 9);
    expect(drawnAt(trail, 10_042)?.x).toBeCloseTo(first, 9);
  });

  it('draws a short stop — a turn — straight from one sample to the next', () => {
    const trail = newTrail();
    hear(trail, walking(2.336, 80, 82, false));
    hear(trail, walking(2.2, 160, 162));
    expect(drawnAt(trail, 122)?.x).toBeCloseTo(2.268, 9);
  });

  it('faces the way the figure goes, never walking backwards through a turn', () => {
    const trail = newTrail();
    // east, then back west: the samples round the turn say east and west
    hear(trail, { ...walking(2.4, 0, 2), facing: 0 });
    hear(trail, { ...walking(2.3, 80, 82), facing: Math.PI });
    const drawn = drawnAt(trail, 42);
    expect(drawn?.x).toBeCloseTo(2.35, 9);
    expect(drawn?.facing).toBeCloseTo(Math.PI, 9);
    expect(drawn?.moving).toBe(true);
  });

  it('walks its legs from the first step after a long stand, and stands still before it', () => {
    const trail = newTrail();
    hear(trail, walking(2, 0, 2, false));
    hear(trail, walking(2 + WALK_SPEED * 0.04, 10_040, 10_042));
    expect(drawnAt(trail, 9_990)?.moving).toBe(false);
    expect(drawnAt(trail, 10_022)?.moving).toBe(true);
  });

  it('places a spawn the server set on its receipt, then walks on from it', () => {
    const trail = newTrail();
    hear(trail, walking(2, null, 1_000, false));
    hear(trail, walking(2.336, 1_080, 1_085));
    expect(drawnAt(trail, 1_000)?.x).toBe(2);
    expect(drawnAt(trail, 1_085)?.x).toBeCloseTo(2.336, 9);
  });
});

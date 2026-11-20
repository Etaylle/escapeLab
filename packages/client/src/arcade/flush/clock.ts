/**
 * Ferret Flush's beat (the reference's src/clock.js): the rules move in fixed steps of 1/120 s
 * whatever the screen's rate, and the picture is drawn between the last two steps. A short
 * hit-stop holds the rules while the picture goes on.
 */
import type { Game } from './rules.js';

export const STEP = 1 / 120;
/** A frame longer than this (a hiccup, a hidden tab) counts as this long, as in the original. */
export const MAX_FRAME = 0.05;

export interface Clock {
  last: number | null;
  carry: number;
  hold: number;
}

export function createClock(): Clock {
  return { last: null, carry: 0, hold: 0 };
}

/** Holds the rules for a moment, as a hit lands. */
export function holdFor(clock: Clock, seconds: number): void {
  clock.hold = Math.max(clock.hold, seconds);
}

/** Starts counting afresh: after a pause nothing of the pause is made up for. */
export function resetClock(clock: Clock): void {
  clock.last = null;
  clock.carry = 0;
  clock.hold = 0;
}

/**
 * The steps the rules take at `now` (milliseconds), and how far the picture is past the last of
 * them, between 0 and 1. The seconds of the frame come back as `seconds` for the effects.
 */
export function tick(clock: Clock, now: number): { steps: number; alpha: number; seconds: number } {
  if (clock.last === null) {
    clock.last = now;
    return { steps: 0, alpha: 1, seconds: 0 };
  }
  const seconds = Math.min(MAX_FRAME, Math.max(0, (now - clock.last) / 1000));
  clock.last = now;
  const held = Math.min(clock.hold, seconds);
  clock.hold -= held;
  clock.carry += seconds - held;
  const steps = Math.floor(clock.carry / STEP + 1e-9);
  clock.carry = Math.max(0, clock.carry - steps * STEP);
  return { steps, alpha: Math.min(1, clock.carry / STEP), seconds };
}

/** Where every bird is before a step, by its id. */
export function snapshot(game: Game): Map<number, readonly [number, number, number]> {
  const seen = new Map<number, readonly [number, number, number]>();
  for (const bird of game.birds) seen.set(bird.id, [bird.x, bird.y, bird.angle ?? 0]);
  return seen;
}

/**
 * Moves every bird to where it is drawn, between the last two steps, and returns the function
 * that puts them back where the rules left them.
 */
export function blend(
  game: Game,
  before: ReadonlyMap<number, readonly [number, number, number]>,
  alpha: number,
): () => void {
  const kept: [Game['birds'][number], number, number, number | undefined][] = [];
  for (const bird of game.birds) {
    const from = before.get(bird.id);
    if (!from) continue;
    kept.push([bird, bird.x, bird.y, bird.angle]);
    bird.x = from[0] + (bird.x - from[0]) * alpha;
    bird.y = from[1] + (bird.y - from[1]) * alpha;
    if (bird.angle !== undefined) bird.angle = from[2] + (bird.angle - from[2]) * alpha;
  }
  return () => {
    for (const [bird, x, y, angle] of kept) {
      bird.x = x;
      bird.y = y;
      if (angle !== undefined) bird.angle = angle;
    }
  };
}

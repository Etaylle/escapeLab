/**
 * What the demo crew does, written down as it happens — walk there, wait, press — and carried
 * out a tick at a time: a script is a generator that gives way (`yield`) until the crew's next
 * tick. The crew's clock is the tick's moment, read from `Clock.now`.
 */

/** A stretch of what the crew does: gives way until the next tick, ends with its result. */
export type Script<T = void> = Generator<void, T, void>;

/** The crew's clock: the moment of the tick being carried out, epoch ms. */
export interface Clock {
  now: number;
}

/** Nothing for `ms` on `clock`. */
export function* pause(clock: Clock, ms: number): Script {
  const until = clock.now + ms;
  while (clock.now < until) {
    yield;
  }
}

/** Gives way until `ready()`. */
export function* until(ready: () => boolean): Script {
  while (!ready()) {
    yield;
  }
}

/** `one` and `other` side by side, a step of each a tick, until both are done. */
export function* both(one: Script, other: Script): Script {
  let left = [one, other];
  while (left.length > 0) {
    left = left.filter((script) => script.next().done !== true);
    if (left.length > 0) {
      yield;
    }
  }
}

/**
 * Numbers that look thrown and are not: the same crew makes the same pauses run after run, so
 * that a run proved on fake timers is the run the demo plays.
 */
export class Dice {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** A number from `min` to `max`. */
  between([min, max]: readonly [number, number]): number {
    // Numerical Recipes' linear congruential step, 32 bits.
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return min + ((max - min) * this.state) / 2 ** 32;
  }
}

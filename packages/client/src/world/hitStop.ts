/**
 * A solve's impact, as Enter the Gungeon and Hotline Miami land a hit: for HIT_STOP_MS the crew's
 * figures and the camera hold still where they were, and a white flash lies over the world,
 * fading out over FLASH_MS — small and short, the run going on underneath. Under reduced motion
 * neither happens. Pure: assemble.ts holds the frame, render/light.ts lays the flash.
 */

/** How long the figures and the camera hold at a solve, ms. */
export const HIT_STOP_MS = 60;
/** How long a solve's white flash takes to fade out, ms. */
export const FLASH_MS = 180;
/** How strongly the flash lies over the world as it comes. */
export const FLASH = 0.16;

/** The solves this screen has seen: how many stations stood done, and when the last came. */
export interface Solves {
  done: number;
  /** epoch ms; null before this screen saw one */
  at: number | null;
}

/**
 * The solves after `solves` for a frame `now` (epoch ms) whose map has `done` stations done: a
 * new one where more stand done than the frame before saw; the first frame only counts them,
 * so that a run joined or reloaded late lands no impact for what was solved before.
 */
export function solvesAt(solves: Solves | null, done: number, now: number): Solves {
  if (solves === null) {
    return { done, at: null };
  }
  if (done > solves.done) {
    return { done, at: now };
  }
  return done === solves.done ? solves : { done, at: solves.at };
}

/** Whether the figures and the camera hold at `now` for the solve at `at`; never when reduced. */
export function holding(at: number | null, now: number, reduced: boolean): boolean {
  return !reduced && at !== null && now >= at && now - at < HIT_STOP_MS;
}

/** How strongly a solve's flash lies over the world at `now`, FLASH at most; none when reduced. */
export function flashAt(at: number | null, now: number, reduced: boolean): number {
  if (reduced || at === null || now < at || now - at >= FLASH_MS) {
    return 0;
  }
  return FLASH * (1 - (now - at) / FLASH_MS);
}

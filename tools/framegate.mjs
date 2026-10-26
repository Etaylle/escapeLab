/**
 * The frame budget's verdict on one gated window of the walkthrough (shots.mjs `sampleFrames`).
 * A p95 within the budget passes as it is. A p95 over it has the window looked at once more,
 * after a pause, the same scene for as long, and fails only where that look is over the budget
 * too: a runner without a GPU stalls now and then for reasons of its own, and a handful of slow
 * frames in one window is its hiccup; slow frames in two windows in a row are the game's.
 */

/** How long the gate waits before it looks at a window over the budget again, ms. */
export const AGAIN_AFTER_MS = 1000;

/**
 * Gates a window whose first look found a p95 of `first.p95` ms on `budget` (ms): over it,
 * `pause` waits and `measure` looks at the window again.
 *
 * @template {{ p95: number }} Look
 * @param {Look} first the window's first look
 * @param {number} budget the p95 the window may reach, ms
 * @param {() => Promise<Look | null>} measure looks at the window again: the same scene for as
 *   long; null where it found no frames
 * @param {() => Promise<void>} pause waits between the two looks
 * @returns {Promise<{ again: Look | null, over: boolean, verdict: string }>} the second look,
 *   null where none was needed or it found nothing; whether the window fails; the log's words
 */
export async function gateWindow(first, budget, measure, pause) {
  if (first.p95 <= budget) {
    return { again: null, over: false, verdict: `within ${budget} ms` };
  }
  await pause();
  const again = await measure();
  if (again === null) {
    return { again, over: true, verdict: `!! over ${budget} ms, and no frames to look at again` };
  }
  return again.p95 <= budget
    ? { again, over: false, verdict: `a hiccup, within ${budget} ms` }
    : { again, over: true, verdict: `!! over ${budget} ms twice` };
}

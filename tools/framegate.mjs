/**
 * The frame budget's verdict on one gated window of the walkthrough (shots.mjs `sampleFrames`).
 * A window may reach the budget at p95 — SHOTS_FRAME_P95_MS, 40 ms — or twice the p95 of the
 * run's quiet pacing window, measured earlier in the same run, whichever is more
 * (`allowanceOf`): a runner that paces at 33.4 ms, half the screen's rate, draws every scene at
 * its own rate, and only a scene dearer than twice that pace is the game's; a scene that grows
 * dearer on a fast runner still trips the budget itself. A p95 within the allowance passes as
 * it is. A p95 over it has the window looked at once more, after a pause, the same scene for as
 * long, and fails only where that look is over the allowance too: a runner without a GPU
 * stalls now and then for reasons of its own, and a handful of slow frames in one window is its
 * hiccup; slow frames in two windows in a row are the game's.
 */

/** How long the gate waits before it looks at a window over the budget again, ms. */
export const AGAIN_AFTER_MS = 1000;

/** How many times the run's pace a window may take at p95 where that is more than the budget. */
export const PACE_FACTOR = 2;

/** Milliseconds as the log prints them: to a tenth, without a trailing „.0" (40, 66.8). */
const ms = (value) => String(Number(value.toFixed(1)));

/**
 * What a gated window may reach at p95, ms, and why, in the log's words: the budget, or
 * PACE_FACTOR times the p95 of the run's pacing window (`pacing`), whichever is more — the
 * budget alone where no pacing window was measured yet (null), as for that window itself.
 *
 * @param {number} budget the p95 a window may always reach, ms (SHOTS_FRAME_P95_MS)
 * @param {number | null} pacing the p95 of the run's pacing window, ms; null before it
 * @returns {{ ms: number, text: string }} the allowance, and „allowed 66.8 (2 × pacing 33.4)"
 */
export function allowanceOf(budget, pacing) {
  if (pacing === null) {
    return { ms: budget, text: `allowed ${budget.toFixed(1)} (no pacing measured yet)` };
  }
  const paced = PACE_FACTOR * pacing;
  const why = `${PACE_FACTOR} × pacing ${pacing.toFixed(1)}`;
  return paced > budget
    ? { ms: paced, text: `allowed ${paced.toFixed(1)} (${why})` }
    : { ms: budget, text: `allowed ${budget.toFixed(1)} (${why} is less)` };
}

/**
 * Gates a window whose first look found a p95 of `first.p95` ms on `allowed` (ms, as
 * `allowanceOf` has it): over it, `pause` waits and `measure` looks at the window again.
 *
 * @template {{ p95: number }} Look
 * @param {Look} first the window's first look
 * @param {number} allowed the p95 the window may reach, ms
 * @param {() => Promise<Look | null>} measure looks at the window again: the same scene for as
 *   long; null where it found no frames
 * @param {() => Promise<void>} pause waits between the two looks
 * @returns {Promise<{ again: Look | null, over: boolean, verdict: string }>} the second look,
 *   null where none was needed or it found nothing; whether the window fails; the log's words
 */
export async function gateWindow(first, allowed, measure, pause) {
  const limit = `${ms(allowed)} ms`;
  if (first.p95 <= allowed) {
    return { again: null, over: false, verdict: `within ${limit}` };
  }
  await pause();
  const again = await measure();
  if (again === null) {
    return { again, over: true, verdict: `!! over ${limit}, and no frames to look at again` };
  }
  return again.p95 <= allowed
    ? { again, over: false, verdict: `a hiccup, within ${limit}` }
    : { again, over: true, verdict: `!! over ${limit} twice` };
}

/**
 * A gated window's p95s as its log line prints them, with what it was allowed and why:
 * „p95 50.0 ms, allowed 66.8 (2 × pacing 33.4), again 48.1 ms".
 *
 * @param {{ p95: number }} first the window's first look
 * @param {{ p95: number } | null} again its second look; null for none
 * @param {{ text: string }} allowance what `allowanceOf` allowed it
 * @returns {string}
 */
export function p95Text(first, again, allowance) {
  const second = again === null ? '' : `, again ${again.p95.toFixed(1)} ms`;
  return `p95 ${first.p95.toFixed(1)} ms, ${allowance.text}${second}`;
}

/**
 * The run's pace, as its pacing window measured it, p95 in ms: the look the gate's verdict
 * rests on — the second where the first was over — or null where the window failed, since a
 * pace over the budget is no pace to measure the run's other windows against.
 *
 * @param {{ p95: number }} first the pacing window's first look
 * @param {{ again: { p95: number } | null, over: boolean }} gate what `gateWindow` made of it
 * @returns {number | null}
 */
export function paceOf(first, gate) {
  if (gate.over) {
    return null;
  }
  return (gate.again ?? first).p95;
}

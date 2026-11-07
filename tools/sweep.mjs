/**
 * The walkthrough's proof that the emergency lamps turn as beacons once the lights fail (client
 * world/beacon.ts): two shots a second apart round a lamp, against what the page's graphics
 * probe says of its lobes at each — the lobe has to have turned as far as the beacon's clock
 * says, and the picture round the lamp has to have changed with it. Pure.
 */
import { TOLERANCE } from './pixeldiff.mjs';

/** How far a probe's angle may lie off the turn its clock says, radians. */
export const TURN_SLACK = 0.2;
/** How much of the picture round the lamp has to change between the shots, as a share. */
export const LEAST_CHANGE = 0.02;

const TAU = Math.PI * 2;

/** `a` brought into 0 to 2π. */
function wrapped(a) {
  return ((a % TAU) + TAU) % TAU;
}

/**
 * The share of the pixels of `box` (CSS px; the pictures taken at `scale` device px a CSS px)
 * that differ between the decoded PNGs `a` and `b` by more than TOLERANCE in a channel.
 *
 * @param {{ width: number, height: number, rgba: Uint8Array }} a
 * @param {{ width: number, height: number, rgba: Uint8Array }} b
 * @param {{ x: number, y: number, width: number, height: number }} box
 * @param {number} [scale]
 * @returns {number} 0 to 1; 0 for a box that holds no pixel, or pictures of other sizes
 */
export function changedShare(a, b, box, scale = 1) {
  if (a.width !== b.width || a.height !== b.height) {
    return 0;
  }
  const left = Math.max(0, Math.round(box.x * scale));
  const top = Math.max(0, Math.round(box.y * scale));
  const right = Math.min(a.width, Math.round((box.x + box.width) * scale));
  const bottom = Math.min(a.height, Math.round((box.y + box.height) * scale));
  let changed = 0;
  let count = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const i = (y * a.width + x) * 4;
      const moved = [0, 1, 2].some((c) => Math.abs(a.rgba[i + c] - b.rgba[i + c]) > TOLERANCE);
      changed += moved ? 1 : 0;
      count += 1;
    }
  }
  return count === 0 ? 0 : changed / count;
}

/**
 * How far a beacon's first lobe turned from the probe's `before` to its `after` (each
 * `{ angle, t }`, radians and sim seconds), radians 0 to 2π, against how far a beacon turning
 * once every `turnMs` turns in the sim time between them, and how far apart the two lie.
 *
 * @param {{ angle: number, t: number }} before
 * @param {{ angle: number, t: number }} after
 * @param {number} turnMs
 * @returns {{ turned: number, expected: number, off: number }}
 */
export function sweepOf(before, after, turnMs) {
  const turned = wrapped(after.angle - before.angle);
  const expected = wrapped((((after.t - before.t) * 1000) / turnMs) * TAU);
  const gap = Math.abs(turned - expected);
  return { turned, expected, off: Math.min(gap, TAU - gap) };
}

/**
 * Whether a sweep reads as one: the lobe turned as far as its clock says, within TURN_SLACK, by
 * a tenth of a turn at least, and LEAST_CHANGE of the picture round the lamp changed with it.
 *
 * @param {{ turned: number, expected: number, off: number }} sweep
 * @param {number} share
 * @returns {boolean}
 */
export function sweepVerdict(sweep, share) {
  const away = Math.min(sweep.turned, TAU - sweep.turned);
  return sweep.off <= TURN_SLACK && away >= TAU / 10 && share >= LEAST_CHANGE;
}

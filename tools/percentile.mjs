/**
 * The p-th percentile of `values` by nearest rank: the smallest of them that
 * at least p % of them do not exceed. The walkthrough's frame budget takes p50
 * and p95 of the world's frame durations with it.
 *
 * @param {readonly number[]} values finite numbers in any order; left unchanged
 * @param {number} p the percentile, from 0 to 100
 * @returns {number} one of `values`
 * @throws {RangeError} for no values, a value that is not finite, or p outside 0–100
 */
export function percentile(values, p) {
  if (values.length === 0) {
    throw new RangeError('percentile of no values: sample at least one');
  }
  const bad = values.find((value) => !Number.isFinite(value));
  if (bad !== undefined) {
    throw new RangeError(`percentile of a value that is not a finite number: ${bad}`);
  }
  if (!(p >= 0 && p <= 100)) {
    throw new RangeError(`percentile ${p}: p has to lie between 0 and 100`);
  }
  const sorted = [...values].sort((a, b) => a - b);
  // p * n before the division: 95 * 300 / 100 is exactly 285, 0.95 * 300 need not be.
  const rank = Math.max(1, Math.ceil((p * sorted.length) / 100));
  return sorted[rank - 1];
}

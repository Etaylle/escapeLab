import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { percentile } from './percentile.mjs';

/** `count` copies of `ms`. */
const frames = (count, ms) => Array.from({ length: count }, () => ms);

describe('percentile — nearest rank', () => {
  it('reads p50 and p95 of 1 to 100 as 50 and 95', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    assert.equal(percentile(values, 50), 50);
    assert.equal(percentile(values, 95), 95);
  });

  it('lets 15 slow frames in 300 pass p95, but not 16', () => {
    assert.equal(percentile([...frames(285, 16.7), ...frames(15, 50)], 95), 16.7);
    assert.equal(percentile([...frames(284, 16.7), ...frames(16, 50)], 95), 50);
  });

  it('rounds the rank up between two values', () => {
    assert.equal(percentile([10, 20, 30], 50), 20);
    assert.equal(percentile([10, 20, 30, 40], 95), 40);
  });

  it('sorts by value, not as text, and leaves its input as it was', () => {
    const values = [100, 9, 25, 3];
    assert.equal(percentile(values, 50), 9);
    assert.deepEqual(values, [100, 9, 25, 3]);
  });

  it('gives the smallest value at p0 and the largest at p100', () => {
    assert.equal(percentile([7, 3, 5], 0), 3);
    assert.equal(percentile([7, 3, 5], 100), 7);
  });

  it('gives a single sample for every p', () => {
    for (const p of [0, 50, 95, 100]) {
      assert.equal(percentile([16.7], p), 16.7);
    }
  });

  it('rejects no values, values that are not finite numbers, and p outside 0 to 100', () => {
    assert.throws(() => percentile([], 50), RangeError);
    assert.throws(() => percentile([16.7, Number.NaN], 50), RangeError);
    assert.throws(() => percentile([16.7, Number.POSITIVE_INFINITY], 50), RangeError);
    assert.throws(() => percentile([16.7, '17'], 50), RangeError);
    assert.throws(() => percentile([16.7], -1), RangeError);
    assert.throws(() => percentile([16.7], 101), RangeError);
    assert.throws(() => percentile([16.7], Number.NaN), RangeError);
  });
});

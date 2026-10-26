import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AGAIN_AFTER_MS, gateWindow } from './framegate.mjs';

const BUDGET = 40;

/**
 * A window's second looks, faked: each `measure` takes the next of `p95s` (null for a look
 * that found no frames); `steps` keeps what was asked of it, in order.
 */
function fakeWindow(...p95s) {
  const steps = [];
  return {
    steps,
    measure: async () => {
      steps.push('measure');
      const p95 = p95s[steps.filter((step) => step === 'measure').length - 1];
      return p95 === null ? null : { p95 };
    },
    pause: async () => {
      steps.push('pause');
    },
  };
}

describe('gateWindow — a frame window against the budget, looked at again once', () => {
  it('passes a window within the budget as it is, and never looks again', async () => {
    const window = fakeWindow(16.7);
    const gate = await gateWindow({ p95: 16.7 }, BUDGET, window.measure, window.pause);
    assert.deepEqual(gate, { again: null, over: false, verdict: 'within 40 ms' });
    assert.deepEqual(window.steps, []);
  });

  it('counts a p95 right on the budget within it', async () => {
    const window = fakeWindow(50);
    const gate = await gateWindow({ p95: BUDGET }, BUDGET, window.measure, window.pause);
    assert.equal(gate.over, false);
    assert.deepEqual(window.steps, []);
  });

  it('passes a window over the budget once and within it the second time: a hiccup', async () => {
    const window = fakeWindow(18.3);
    const gate = await gateWindow({ p95: 50 }, BUDGET, window.measure, window.pause);
    assert.deepEqual(gate, {
      again: { p95: 18.3 },
      over: false,
      verdict: 'a hiccup, within 40 ms',
    });
  });

  it('fails a window over the budget twice', async () => {
    const window = fakeWindow(48.1);
    const gate = await gateWindow({ p95: 50 }, BUDGET, window.measure, window.pause);
    assert.deepEqual(gate, { again: { p95: 48.1 }, over: true, verdict: '!! over 40 ms twice' });
  });

  it('pauses before the second look, and looks only once more', async () => {
    const window = fakeWindow(48.1, 16.7);
    await gateWindow({ p95: 50 }, BUDGET, window.measure, window.pause);
    assert.deepEqual(window.steps, ['pause', 'measure']);
  });

  it('fails a window over the budget whose second look found no frames', async () => {
    const window = fakeWindow(null);
    const gate = await gateWindow({ p95: 50 }, BUDGET, window.measure, window.pause);
    assert.equal(gate.over, true);
    assert.equal(gate.again, null);
    assert.match(gate.verdict, /^!! over 40 ms/);
  });

  it('waits a second between the two looks', () => {
    assert.equal(AGAIN_AFTER_MS, 1000);
  });
});

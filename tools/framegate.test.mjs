import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AGAIN_AFTER_MS,
  allowanceOf,
  gateWindow,
  PACE_FACTOR,
  p95Text,
  paceOf,
} from './framegate.mjs';

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

describe('gateWindow — a frame window against its allowance, looked at again once', () => {
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

describe('allowanceOf — the budget, or twice the run’s own pace, whichever is more', () => {
  it('passes the escape of a slow runner at 60 ms against its pacing at 33.4', async () => {
    const allowed = allowanceOf(BUDGET, { p95: 33.4, load: 8.24 });
    assert.equal(allowed.text, 'allowed 66.8 (2 × pacing 33.4 at load 8.2)');
    const window = fakeWindow(60);
    const gate = await gateWindow({ p95: 60 }, allowed.ms, window.measure, window.pause);
    assert.deepEqual(gate, { again: null, over: false, verdict: 'within 66.8 ms' });
    assert.deepEqual(window.steps, []);
  });

  it('fails the escape of a normal runner at 45 ms against its pacing at 16.8', async () => {
    const allowed = allowanceOf(BUDGET, { p95: 16.8, load: 3 });
    assert.deepEqual(allowed, {
      ms: BUDGET,
      text: 'allowed 40.0 (2 × pacing 16.8 at load 3.0 is less)',
    });
    const window = fakeWindow(45);
    const gate = await gateWindow({ p95: 45 }, allowed.ms, window.measure, window.pause);
    assert.deepEqual(gate, { again: { p95: 45 }, over: true, verdict: '!! over 40 ms twice' });
  });

  it('allows the budget alone before the run’s pacing window, and that window itself', () => {
    assert.deepEqual(allowanceOf(BUDGET, null), {
      ms: BUDGET,
      text: 'allowed 40.0 (no pacing measured yet)',
    });
  });

  it('takes twice the pace, no more and no less, and the budget the harness was given', () => {
    assert.equal(PACE_FACTOR, 2);
    const pace = (p95) => ({ p95, load: 1 });
    assert.equal(allowanceOf(BUDGET, pace(25)).ms, 50);
    assert.equal(allowanceOf(BUDGET, pace(20)).ms, BUDGET);
    assert.equal(allowanceOf(100, pace(33.4)).ms, 100);
  });

  it('prints the p95 at the load it ran at, what it was allowed and why, the second look', () => {
    const allowed = allowanceOf(BUDGET, { p95: 33.4, load: 8.2 });
    assert.equal(
      p95Text({ p95: 50 }, null, allowed, 12.34),
      'p95 50.0 ms at load 12.3, allowed 66.8 (2 × pacing 33.4 at load 8.2)',
    );
    assert.equal(
      p95Text({ p95: 70.04 }, { p95: 48.1 }, allowed, 0.5),
      'p95 70.0 ms at load 0.5, allowed 66.8 (2 × pacing 33.4 at load 8.2), again 48.1 ms',
    );
  });
});

describe('paceOf — the run’s pace, as its pacing window measured it', () => {
  it('takes the first look of a window within the budget, with the load it ran at', () => {
    assert.deepEqual(paceOf({ p95: 33.4 }, { again: null, over: false }, 9.1), {
      p95: 33.4,
      load: 9.1,
    });
  });

  it('takes the second look where the first was a hiccup', () => {
    assert.deepEqual(paceOf({ p95: 52 }, { again: { p95: 16.8 }, over: false }, 2), {
      p95: 16.8,
      load: 2,
    });
  });

  it('takes no pace from a window that failed', () => {
    assert.equal(paceOf({ p95: 52 }, { again: { p95: 51 }, over: true }, 2), null);
    assert.equal(paceOf({ p95: 52 }, { again: null, over: true }, 2), null);
  });
});

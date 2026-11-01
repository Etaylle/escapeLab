import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { withOthersFrozen } from './freeze.mjs';

/**
 * A run's other pages, faked: `steps` keeps what was done to which page and when the measure
 * ran, in order; `refuse` names the page whose freeze or whose thaw throws. The audience's page
 * says it froze idle, every other page paused.
 */
function fakeRun(names, refuse = {}) {
  const steps = [];
  return {
    steps,
    pages: names.map((name) => ({ name })),
    hands: {
      freeze: async ({ name }) => {
        steps.push(`freeze ${name}`);
        if (refuse.freeze === name) {
          throw new Error('Target page, context or browser has been closed\n  call log: …');
        }
        return name === 'audience' ? 'idle' : 'paused';
      },
      thaw: async ({ name }) => {
        steps.push(`thaw ${name}`);
        if (refuse.thaw === name) {
          throw new Error('Session closed');
        }
      },
    },
    measure: (value) => async () => {
      steps.push('measure');
      return value;
    },
  };
}

describe('withOthersFrozen — one page measured, every other page frozen meanwhile', () => {
  it('freezes every other page before it measures and thaws them after, the last first', async () => {
    const run = fakeRun(['guest', 'audience']);
    await withOthersFrozen(run.pages, run.hands, run.measure(null));
    assert.deepEqual(run.steps, [
      'freeze guest',
      'freeze audience',
      'measure',
      'thaw audience',
      'thaw guest',
    ]);
  });

  it('hands back what the measure returned, and how each page froze', async () => {
    const run = fakeRun(['guest', 'audience']);
    const result = await withOthersFrozen(run.pages, run.hands, run.measure({ p95: 16.7 }));
    assert.deepEqual(result, {
      value: { p95: 16.7 },
      frozen: [
        { name: 'guest', how: 'paused' },
        { name: 'audience', how: 'idle' },
      ],
    });
  });

  it('measures at once where no other page is open', async () => {
    const run = fakeRun([]);
    const result = await withOthersFrozen(run.pages, run.hands, run.measure(7));
    assert.deepEqual(result, { value: 7, frozen: [] });
    assert.deepEqual(run.steps, ['measure']);
  });

  it('thaws every page it froze when the measure throws, and throws its error', async () => {
    const run = fakeRun(['guest', 'audience']);
    const broken = new Error('no frames recorded');
    const measure = async () => {
      run.steps.push('measure');
      throw broken;
    };
    await assert.rejects(withOthersFrozen(run.pages, run.hands, measure), (error) => error === broken);
    assert.deepEqual(run.steps.slice(-2), ['thaw audience', 'thaw guest']);
  });

  it('thaws the pages frozen before one that does not freeze, measures nothing, names it', async () => {
    const run = fakeRun(['guest', 'audience', 'phone'], { freeze: 'audience' });
    await assert.rejects(withOthersFrozen(run.pages, run.hands, run.measure(1)), {
      message: 'audience did not freeze: Target page, context or browser has been closed',
    });
    assert.deepEqual(run.steps, ['freeze guest', 'freeze audience', 'thaw guest']);
  });

  it('thaws the rest when one page does not thaw, and throws naming it', async () => {
    const run = fakeRun(['guest', 'audience', 'phone'], { thaw: 'audience' });
    await assert.rejects(withOthersFrozen(run.pages, run.hands, run.measure(1)), {
      message: 'audience did not thaw: Session closed',
    });
    assert.deepEqual(run.steps.slice(-3), ['thaw phone', 'thaw audience', 'thaw guest']);
  });

  it('throws both where the measure threw and a page did not thaw', async () => {
    const run = fakeRun(['guest'], { thaw: 'guest' });
    const broken = new Error('no frames recorded');
    const measure = async () => {
      throw broken;
    };
    await assert.rejects(withOthersFrozen(run.pages, run.hands, measure), (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors[0], broken);
      assert.equal(error.message, 'no frames recorded; guest did not thaw: Session closed');
      return true;
    });
  });
});

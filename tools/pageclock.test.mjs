import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { swingVerdict } from './pageclock.mjs';

describe('swingVerdict — meter-swing.png, the needle held mid-swing by the page', () => {
  const held = { pressed: 4.2, swung: 216.9, length: 600 };
  const swing = (more) => ({
    from: -90,
    target: -10.8,
    at: -58.4,
    after: -58.4,
    hold: held,
    holdMs: 60,
    ...more,
  });

  it('passes a needle held on its way, naming when its swing began on the page’s clock', () => {
    assert.deepEqual(swingVerdict(swing({})), {
      faults: [],
      text:
        "its 600-ms swing began 213 ms after the probe on the page's clock; held 60 ms in, " +
        'the needle at -58.4° on its way from -90° to -10.8°',
    });
  });

  it('passes a needle swinging past its reading, as its spring does', () => {
    assert.deepEqual(swingVerdict(swing({ at: 2.5, after: 2.5 })).faults, []);
  });

  it('fails a needle that never swung, and one standing at either end of its way', () => {
    assert.deepEqual(swingVerdict(swing({ hold: { ...held, swung: null } })).faults, [
      'the needle never swung from -90° to -10.8°: no turn ran on it',
    ]);
    assert.deepEqual(swingVerdict(swing({ hold: null })).faults, [
      'the needle never swung from -90° to -10.8°: no turn ran on it',
    ]);
    assert.deepEqual(swingVerdict(swing({ at: -10.8, after: -10.8 })).faults, [
      'the needle stood at -10.8°, not on its way from -90° to -10.8°',
    ]);
    assert.deepEqual(swingVerdict(swing({ at: -89.5, after: -89.5 })).faults, [
      'the needle stood at -89.5°, not on its way from -90° to -10.8°',
    ]);
  });

  it('fails a needle that moved under the shot: the hold did not hold it', () => {
    const verdict = swingVerdict(swing({ after: -40.1 }));
    assert.deepEqual(verdict.faults, ['the needle moved under the shot, from -58.4° to -40.1°']);
    assert.match(verdict.text, /— !! -40\.1° once shot$/);
  });

  it('says where no press was seen on the page', () => {
    const text = swingVerdict(swing({ hold: { ...held, pressed: null } })).text;
    assert.match(text, /began 217 ms into the hold, no probe seen/);
  });
});

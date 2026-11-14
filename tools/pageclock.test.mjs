import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  deviceVerdict,
  figureHeld,
  strideHeld,
  stripVerdict,
  swingVerdict,
} from './pageclock.mjs';

describe('stripVerdict — a sync station’s strip, as each page noted it', () => {
  it('names when each page showed the station done after its own press', () => {
    const verdict = stripVerdict([
      { name: 'Anna', seen: { done: 160.4, pressed: 112.2 } },
      { name: 'Ben', seen: { done: 1210, pressed: 980 } },
    ]);
    assert.deepEqual(verdict, {
      stuck: [],
      text: 'Anna 48 ms after the press, Ben 230 ms after the press',
    });
  });

  it('holds a strip seen done however late the walkthrough looked: the page noted it', () => {
    // Ben's strip showed it done 90 ms after his press, then the radio's banner took its place.
    const verdict = stripVerdict([{ name: 'Ben', seen: { done: 4090, pressed: 4000 } }]);
    assert.deepEqual(verdict.stuck, []);
  });

  it('names a page whose strip never showed the station done, or that kept no watch', () => {
    const verdict = stripVerdict([
      { name: 'Anna', seen: { done: 50, pressed: null } },
      { name: 'Ben', seen: { done: null, pressed: 20 } },
      { name: 'Cem', seen: null },
    ]);
    assert.deepEqual(verdict, {
      stuck: ['Ben', 'Cem'],
      text: 'Anna 50 ms into the watch, no press seen, Ben never, Cem never',
    });
  });
});

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
        'the page noted its 600-ms swing 213 ms after the probe, on its clock; held 60 ms in, ' +
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
    assert.match(text, /swing 217 ms into the hold, no probe seen/);
  });
});

describe('deviceVerdict — a device a phone shows sideways, measured once it settled', () => {
  const fine = { scroll: 0, controls: 6, small: [], cut: [] };
  const still = { waited: 12, still: [] };

  it('passes a device whole in the window with every control a fingertip’s 44 px', () => {
    assert.deepEqual(deviceVerdict(fine, still), { faults: [], unjudged: null });
  });

  it('fails a short control measured once nothing moved any more, and the rest as before', () => {
    const seen = {
      scroll: 12,
      controls: 0,
      small: ['„Kabel 1 messen" 75×43'],
      cut: ['„Notizen" 129×44'],
    };
    assert.deepEqual(deviceVerdict(seen, still), {
      faults: [
        'no control shown',
        'it scrolls 12px',
        '„Kabel 1 messen" 75×43 under 44 px',
        '„Notizen" 129×44 cut off',
      ],
      unjudged: null,
    });
  });

  it('leaves a control measured short while the panel still rose unjudged, naming the wait', () => {
    const seen = { ...fine, small: ['„Zurücktreten" 133×43'] };
    assert.deepEqual(deviceVerdict(seen, { waited: 3004, still: ['panel-up'] }), {
      faults: [],
      unjudged:
        '„Zurücktreten" 133×43 measured under 44 px while panel-up still ran, 3004 ms into ' +
        "the wait on the page's clock: not judged",
    });
    assert.deepEqual(deviceVerdict(fine, { waited: 3004, still: ['panel-up'] }), {
      faults: [],
      unjudged: null,
    });
  });
});

describe('figureHeld — a figure held in its pose through its shot', () => {
  const jump = { mood: 'celebrate', key: 'rise', least: 0.12 };
  const up = { color: '#2dd4bf', mood: 'celebrate', rise: 0.142, glance: 0 };

  it('holds a figure still in the air as the page held it', () => {
    assert.equal(figureHeld(up, { ...up }, jump), true);
    const glance = { mood: 'play', key: 'glance', least: 0.9 };
    const turned = { ...up, mood: 'play', rise: 0, glance: -1.1 };
    assert.equal(figureHeld(turned, { ...turned }, glance), true);
  });

  it('fails one a frame moved under the shot, one landed, one gone, one in another mood', () => {
    assert.equal(figureHeld(up, { ...up, rise: 0.137 }, jump), false);
    assert.equal(figureHeld(up, { ...up, rise: 0 }, jump), false);
    assert.equal(figureHeld(up, null, jump), false);
    assert.equal(figureHeld(up, { ...up, mood: 'play' }, jump), false);
  });

  it('fails a figure held out of its pose, however still it stood', () => {
    const low = { ...up, rise: 0.05 };
    assert.equal(figureHeld(low, { ...low }, jump), false);
  });
});

describe('strideHeld — your walk held in a stride through its shot', () => {
  const wide = { from: 0.18, to: 0.32 };
  const held = { phase: 0.24, moving: true };

  it('holds a walk still in its stretch as the page held it', () => {
    assert.equal(strideHeld(held, { ...held }, wide), true);
  });

  it('fails one a frame moved, one stopped, one out of the stretch, and one with no probe', () => {
    assert.equal(strideHeld(held, { ...held, phase: 0.29 }, wide), false);
    assert.equal(strideHeld(held, { ...held, moving: false }, wide), false);
    for (const phase of [0.1, 0.4]) {
      const out = { phase, moving: true };
      assert.equal(strideHeld(out, { ...out }, wide), false);
    }
    assert.equal(strideHeld(held, null, wide), false);
  });
});

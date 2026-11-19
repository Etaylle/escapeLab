import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { REST_INTO_WAVE_S, REST_LEAD_S, restTiming } from './rest.mjs';

describe('restTiming — the Paketfilter drill’s second wave and its emergency', () => {
  it('lets the wave run where the emergency falls into its first seconds', () => {
    assert.deepEqual(restTiming(1.5, 7.2), { hold: false, intoS: 8.7, holdS: 0 });
    assert.equal(restTiming(0, REST_INTO_WAVE_S).hold, false);
  });

  it('holds the wave where the emergency would fall later, till it is the lead away', () => {
    // A slow runner: the first look at the wave 3 s in, the emergency 20 s off.
    assert.deepEqual(restTiming(3, 20), { hold: true, intoS: 23, holdS: 20 - REST_LEAD_S });
    assert.equal(restTiming(0.5, REST_INTO_WAVE_S).hold, true);
  });

  it('holds nothing where the emergency is no further off than the lead, late as it falls', () => {
    assert.deepEqual(restTiming(13, 1), { hold: false, intoS: 14, holdS: 0 });
    assert.equal(restTiming(13, REST_LEAD_S).hold, false);
  });
});

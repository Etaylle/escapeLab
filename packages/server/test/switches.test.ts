import { describe, expect, it } from 'vitest';
import { seedsAllowed } from '../src/roomManager.js';
import { switchOn } from '../src/switches.js';
import { takesAllowed } from '../src/takes.js';
import { recordingAllowed } from '../src/voiceRecording.js';

/** The server's switches for development, read one way: ALLOW_SEED, ALLOW_RECORD, ALLOW_TAKES. */

describe('a switch', () => {
  it('is on with 1 alone, off with 0 or unset, and refuses anything else, saying what 1 does', () => {
    expect(switchOn({ ALLOW_X: '1' }, 'ALLOW_X', 'tut etwas')).toBe(true);
    for (const env of [{}, { ALLOW_X: '' }, { ALLOW_X: '0' }, { ALLOW_Y: '1' }]) {
      expect(switchOn(env, 'ALLOW_X', 'tut etwas'), JSON.stringify(env)).toBe(false);
    }
    for (const flag of ['yes', 'true', ' 1', '01']) {
      expect(() => switchOn({ ALLOW_X: flag }, 'ALLOW_X', 'tut etwas'), flag).toThrow(
        `ALLOW_X=${flag} versteht der Server nicht — ALLOW_X=1 tut etwas`,
      );
    }
  });

  it('is how the seed, the recordings and the takes are switched on', () => {
    const readers = [
      ['ALLOW_SEED', seedsAllowed],
      ['ALLOW_RECORD', recordingAllowed],
      ['ALLOW_TAKES', takesAllowed],
    ] as const;
    for (const [name, allowed] of readers) {
      expect([allowed({ [name]: '1' }), allowed({})], name).toEqual([true, false]);
      expect(() => allowed({ [name]: 'ja' }), name).toThrow(
        new RegExp(`^${name}=ja versteht der Server nicht — ${name}=1 \\S`),
      );
    }
  });
});

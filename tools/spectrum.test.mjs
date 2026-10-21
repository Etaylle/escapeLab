import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bandPowers, decibels } from './spectrum.mjs';

const RATE = 44100;

/** `seconds` of a sine at `hz`. */
const sine = (hz, seconds = 0.5) =>
  Array.from({ length: Math.round(RATE * seconds) }, (_, i) => Math.sin((2 * Math.PI * hz * i) / RATE));

/** `length` samples of white noise from a fixed seed, so the test is the same every run. */
function noise(length) {
  let seed = 12345;
  return Array.from({ length }, () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648 - 0.5;
  });
}

describe('bandPowers — a signal’s power by band', () => {
  it('finds a sine in its own band and next to nothing elsewhere', () => {
    const [own, above] = bandPowers(sine(1000), RATE, [
      [900, 1100],
      [4000, 22050],
    ]);
    assert.ok(decibels(above, own) < -60, `above 4 kHz at ${decibels(above, own).toFixed(1)} dB`);
  });

  it('shares white noise out by bandwidth', () => {
    const [low, high] = bandPowers(noise(65536), RATE, [
      [300, 3400],
      [4000, 22050],
    ]);
    const expected = decibels(22050 - 4000, 3400 - 300);
    assert.ok(Math.abs(decibels(high, low) - expected) < 1, `${decibels(high, low)} vs ${expected}`);
  });

  it('refuses a frame that is no power of two, and a signal shorter than a frame', () => {
    assert.throws(() => bandPowers(noise(8192), RATE, [[0, 100]], 1000), RangeError);
    assert.throws(() => bandPowers(noise(100), RATE, [[0, 100]]), RangeError);
  });
});

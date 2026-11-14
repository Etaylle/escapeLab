import { describe, expect, it } from 'vitest';
import type { Pcm } from '../scripts/pcm.js';
import {
  bandsAt,
  bestSeam,
  correlation,
  featuresOf,
  fluxOf,
  HOP_MS,
  MARGIN_MS,
  seamScore,
  SPECTRUM_WEIGHT_DB,
  spectrumGap,
  spectrumOf,
} from '../scripts/seam.js';

/**
 * Where a loop of found music crosses into its next pass (scripts/seam.ts): measured on music of
 * the test's own whose beat and whose chords repeat exactly, so that one period is the answer.
 */

const RATE = 8000;

/**
 * `seconds` of music at RATE: a click every half second — a 2 kHz burst dying in 20 ms — over a
 * tone that steps through four pitches, two seconds each, round every eight.
 */
function music(seconds: number, pitches = [220, 330, 440, 554]): Pcm {
  const samples = Float32Array.from({ length: RATE * seconds }, (_, i) => {
    const t = i / RATE;
    const pitch = pitches[Math.floor(t / 2) % pitches.length] ?? 220;
    const since = t % 0.5;
    const click = since < 0.02 ? Math.exp(-since * 200) * Math.sin(2 * Math.PI * 2000 * t) : 0;
    return 0.2 * Math.sin(2 * Math.PI * pitch * t) + 0.3 * click;
  });
  return { rate: RATE, channels: [samples] };
}

describe('the seam’s measures', () => {
  it('read the spectrum in third-octave bands from 63 Hz, short of the file’s top', () => {
    const bands = bandsAt(RATE);
    expect(bands[0]).toBe(63);
    expect(bands.at(-1)).toBeLessThan(0.45 * RATE);
    expect(bandsAt(44_100)).toHaveLength(24);
    const spectrum = spectrumOf(music(4));
    expect(spectrum).toHaveLength(bands.length);
    expect(spectrum[0]).toHaveLength((4 * 1000) / HOP_MS);
  });

  it('find the clicks in the flux, one every half second', () => {
    const flux = fluxOf(spectrumOf(music(4)));
    const peaks = [...flux].flatMap((value, frame) =>
      value > 0.5 * Math.max(...flux) ? [frame] : [],
    );
    expect(peaks).toEqual([50, 100, 150, 200, 250, 300, 350]);
  });

  it('correlate what rises and falls together, against it, and nothing that stands still', () => {
    const x = Float32Array.from([1, 3, 2, 5, 1, 3, 2, 5, 4, 2, 3, 0, 9, 9, 9, 9]);
    expect(correlation(x, 0, 4, 4)).toBeCloseTo(1, 12);
    expect(correlation(x, 0, 8, 4)).toBeCloseTo(-1, 12);
    expect(correlation(x, 0, 12, 4)).toBe(0);
    const spectrum = spectrumOf(music(12));
    expect(spectrumGap(spectrum, 100, 900, 200)).toBeCloseTo(0, 6);
    expect(spectrumGap(spectrum, 100, 300, 200)).toBeGreaterThan(3);
  });
});

/** `seconds` of clicks every half second over a steady tone at `low` Hz, then at `high` Hz. */
function twoTones(seconds: number, low: number, high: number): Pcm {
  const half = (RATE * seconds) / 2;
  const samples = Float32Array.from({ length: RATE * seconds }, (_, i) => {
    const t = i / RATE;
    const since = t % 0.5;
    const click = since < 0.02 ? Math.exp(-since * 200) * Math.sin(2 * Math.PI * 2000 * t) : 0;
    return 0.2 * Math.sin(2 * Math.PI * (i < half ? low : high) * t) + 0.3 * click;
  });
  return { rate: RATE, channels: [samples] };
}

describe('the seam’s score', () => {
  it('weighs the spectra’s gap against beats that line up alike', () => {
    // From 5 s: 30 s on, the same tone; 60 s on, another — the clicks alike in both.
    const features = featuresOf(twoTones(80, 440, 660));
    const n = 400;
    const same = seamScore(features, 400, 3000, n);
    const other = seamScore(features, 400, 6000, n);
    expect(correlation(features.flux, 400, 400 + 6000, n)).toBeGreaterThan(0.95);
    expect(same).toBeGreaterThan(0.95);
    expect(same - other).toBeGreaterThan(0.5);
    expect(SPECTRUM_WEIGHT_DB).toBe(10);
  });
});

describe('the seam found', () => {
  it('moves the loop’s end to where beat and chord come round alike, within its reach', () => {
    const features = featuresOf(music(100));
    // Planned 70.3 s round; within 3 s of it only 72 s is a whole round of the chords.
    const seam = bestSeam(features, { startMs: 2000, endMs: 75_300, fadeMs: 3000 }, 3000);
    expect(seam).toMatchObject({ startMs: 2000, endMs: 2000 + 72_000 + 3000, fadeMs: 3000 });
    expect(seam.score).toBeCloseTo(1, 2);
  });

  it('keeps the plan’s seam where it may not move, and scores it lower off the round', () => {
    const features = featuresOf(music(100));
    const planned = { startMs: 2000, endMs: 75_300, fadeMs: 3000 };
    const kept = bestSeam(features, planned, 0);
    expect(kept).toMatchObject(planned);
    expect(kept.score).toBeLessThan(0.5);
  });

  it('finds no seam where the music past it runs out of the file', () => {
    const features = featuresOf(music(40));
    const seam = bestSeam(features, { startMs: 2000, endMs: 39_500, fadeMs: 2000 }, 0);
    expect(seam.score).toBe(-Infinity);
    expect(MARGIN_MS).toBe(1000);
  });
});

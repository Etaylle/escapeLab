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
  periodsOf,
  seamScore,
  SPECTRUM_WEIGHT_DB,
  spectrumGap,
  spectrumOf,
  type Features,
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
  it('moves the loop to where beat and chord come round alike, within its reach', () => {
    const features = featuresOf(music(100));
    // Planned 70.3 s round; within 3 s of it only 72 s is a whole round of the chords.
    const seam = bestSeam(features, { startMs: 2000, endMs: 75_300, fadeMs: 3000 }, 3000);
    expect(seam.endMs - seam.fadeMs - seam.startMs).toBe(72_000);
    expect(seam.startMs).toBeGreaterThanOrEqual(1000); // never under the lead a pass needs
    expect(seam.startMs).toBeLessThanOrEqual(5000);
    expect(seam.fadeMs).toBe(3000);
    expect(seam.score).toBeCloseTo(1, 2);
  });

  it('keeps the plan’s seam where it may not move, scored as seamScore scores it', () => {
    const features = featuresOf(music(100));
    const planned = { startMs: 2000, endMs: 75_300, fadeMs: 3000 };
    const kept = bestSeam(features, planned, 0);
    expect(kept).toMatchObject(planned);
    // Its window from a second before its start, 500 frames: 3 s of fade and 2 s around it.
    expect(kept.score).toBeCloseTo(seamScore(features, 100, 7030, 500), 3);
    expect(kept.score).toBeLessThan(0.5);
  });

  it('moves the start to where the music it crosses from has come in', () => {
    // Eight seconds of silence, then the music: a seam from 6 s would cross from nothing.
    const quiet = new Float32Array(RATE * 8);
    const rest = music(92).channels[0] ?? new Float32Array(0);
    const both = new Float32Array(quiet.length + rest.length);
    both.set(rest, quiet.length);
    const features = featuresOf({ rate: RATE, channels: [both] });
    const seam = bestSeam(features, { startMs: 6000, endMs: 81_000, fadeMs: 3000 }, 4000);
    expect(seam.startMs).toBeGreaterThanOrEqual(9000);
    expect(seam.endMs - seam.fadeMs - seam.startMs).toBe(72_000);
  });

  it('goes round in whole bars alone where the tempo is known, the beats falling together', () => {
    expect(periodsOf(6730, 6740, null)).toEqual(Array.from({ length: 11 }, (_, i) => 6730 + i));
    expect(periodsOf(6730, 7330, 2000)).toEqual([6800, 7000, 7200]);
    expect(periodsOf(6000, 6400, (4 * 60_000) / 76)).toEqual([6000, 6316]); // 19, 20 bars
    const features = featuresOf(music(100));
    // Bars of 3 s within 3 s of 70.3: 69 and 72 s round — the chords come round on 72.
    const planned = { startMs: 2000, endMs: 75_300, fadeMs: 3000 };
    const seam = bestSeam(features, planned, 3000, [0, 1e6], 3000);
    expect(seam.endMs - seam.fadeMs - seam.startMs).toBe(72_000);
  });

  it('keeps the rounds it may go: none shorter or longer than it is given', () => {
    const features = featuresOf(music(100));
    // Planned 58 s round, sought 3 s either way: 56 s is the chords' round within reach.
    const planned = { startMs: 2000, endMs: 63_000, fadeMs: 3000 };
    const free = bestSeam(features, planned, 3000);
    expect(free.endMs - free.fadeMs - free.startMs).toBe(56_000);
    const kept = bestSeam(features, planned, 3000, [60_000, 120_000]);
    const round = kept.endMs - kept.fadeMs - kept.startMs;
    expect(round).toBeGreaterThanOrEqual(60_000);
    expect(round).toBeLessThanOrEqual(61_000);
  });

  it('finds no seam where the music past it runs out of the file', () => {
    const features = featuresOf(music(40));
    const seam = bestSeam(features, { startMs: 2000, endMs: 39_500, fadeMs: 2000 }, 0);
    expect(seam.score).toBe(-Infinity);
    expect(MARGIN_MS).toBe(1000);
  });
});

/** Features of the test's own: `flux` as it is, over one band of silence — no gap anywhere. */
function fluxOnly(flux: readonly number[]): Features {
  const frames = Float32Array.from(flux);
  return { flux: frames, spectrum: [new Float32Array(frames.length)] };
}

/** 90 s of seeded noise in frames, whose `length` frames from `from` come round `period` later. */
function roundAt(from: number, length: number, period: number): number[] {
  let x = 7;
  const flux = Array.from({ length: 9000 }, () => {
    x = (x * 1_103_515_245 + 12_345) % 2_147_483_648;
    return x / 2_147_483_648;
  });
  for (let t = from; t < from + length; t++) flux[t + period] = flux[t] ?? 0;
  return flux;
}

/** A fade of 1 s from `startMs`, `period` frames round. */
const fadeOf = (startMs: number, period: number) => ({
  startMs,
  endMs: startMs + period * HOP_MS + 1000,
  fadeMs: 1000,
});

describe('the seam found within its bounds', () => {
  it('never starts a loop within its first second, where the lead of a pass would not fit', () => {
    // Round alike from half a second in — the second before it silent on both sides.
    const flux = roundAt(0, 250, 6300);
    for (let t = 6250; t < 6300; t++) flux[t] = 0;
    const seam = bestSeam(fluxOnly(flux), fadeOf(1500, 6300), 1500);
    expect(seam.startMs).toBeGreaterThanOrEqual(1000);
  });

  it('keeps its start within its reach of the plan’s, either way', () => {
    // Alike from 6 s, and from 2 s: the plan's 4 s, sought 1 s either way, reaches neither.
    const later = bestSeam(fluxOnly(roundAt(500, 300, 6300)), fadeOf(4000, 6300), 1000);
    expect(later.startMs).toBeLessThanOrEqual(5000);
    const earlier = bestSeam(fluxOnly(roundAt(100, 300, 6300)), fadeOf(4000, 6300), 1000);
    expect(earlier.startMs).toBeGreaterThanOrEqual(3000);
  });

  it('keeps its round under the longest it is given, where the best lies past it', () => {
    // Alike 64 s round from 4 s; planned 63 s, sought 1 s either way.
    const features = fluxOnly(roundAt(300, 300, 6400));
    const free = bestSeam(features, fadeOf(4000, 6300), 1000);
    expect(free.endMs - free.fadeMs - free.startMs).toBe(64_000);
    const kept = bestSeam(features, fadeOf(4000, 6300), 1000, [0, 63_500]);
    expect(kept.endMs - kept.fadeMs - kept.startMs).toBeLessThanOrEqual(63_500);
  });

  it('scores music whose flux stands still by its spectra alone, never as no seam', () => {
    // A flux of 0.1 throughout, sought a second either way: in some of its windows the variance
    // rounds to a trace above nothing, which is no beat.
    const seam = bestSeam(fluxOnly(new Array(9000).fill(0.1)), fadeOf(2000, 6300), 1000);
    expect(seam.score).toBe(0);
  });

  it('reads silence at the floor of its levels, never below it', () => {
    const quiet = spectrumOf({ rate: RATE, channels: [new Float32Array(RATE)] });
    expect(new Set(quiet.flatMap((band) => [...band]))).toEqual(new Set([-90]));
  });
});

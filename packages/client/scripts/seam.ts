/**
 * Where a loop of found music crosses into its next pass (scripts/packs.ts): of the crossfades the
 * plan allows, the one whose two sides sound most alike. Nobody counts the bars of found music, so
 * nothing here knows where a bar starts; it measures instead. Both passes play the same file, the
 * outgoing one ahead of the incoming one by the loop's period, so what has to match is the music
 * at the loop's start and the music one period later. Each is read in 10 ms frames (HOP_MS) as a
 * spectrum of third-octave bands (`spectrumOf`): the music under the seam lines up its beats where
 * the two sides' spectral flux — how much the bands rise from frame to frame, the onsets — goes up
 * and down together (a correlation), and its chord, its instruments and its level where the two
 * spectra lie close (their RMS difference in dB). The seam's score is the first less the second
 * over SPECTRUM_WEIGHT_DB, over the fade and MARGIN_MS either side of it; the period is moved in
 * steps of a frame within the plan's reach and the best one kept (`bestSeam`). Pure.
 *
 * Runs on Node's own TypeScript, as the sound script does: it imports nothing of the app.
 */
import type { Crossfade } from '../src/world/packFile.ts';
import type { Pcm } from './pcm.ts';

/** The frames the spectrum is read in, ms: a seam is found to this. */
export const HOP_MS = 10;
/** The lowest band's centre, Hz; each next band a third of an octave higher. */
const LOWEST_HZ = 63;
/** How many bands at most: from 63 Hz to some 12.7 kHz, as far as the file's rate reaches. */
const MOST_BANDS = 24;
/** A band's Q for a third of an octave: √(2^⅓) / (2^⅓ − 1). */
const THIRD_Q = Math.sqrt(2 ** (1 / 3)) / (2 ** (1 / 3) - 1);
/** A band's level is counted down to this, dB: silence divides nothing. */
const FLOOR_DB = -90;
/** How far apart the two sides' spectra may lie, dB RMS, to weigh as much as perfect beats. */
export const SPECTRUM_WEIGHT_DB = 10;
/** The music either side of the fade that is compared with it, ms. */
export const MARGIN_MS = 1000;

/** The mean of `pcm`'s channels. */
function monoOf(pcm: Pcm): Float32Array {
  const frames = pcm.channels[0]?.length ?? 0;
  const mono = new Float32Array(frames);
  for (const channel of pcm.channels) {
    for (let i = 0; i < frames; i++) mono[i] = (mono[i] ?? 0) + (channel[i] ?? 0);
  }
  const share = 1 / Math.max(1, pcm.channels.length);
  for (let i = 0; i < frames; i++) mono[i] = (mono[i] ?? 0) * share;
  return mono;
}

/** The bands' centres at `rate`: a third of an octave apart, under 0.45 of the rate. */
export function bandsAt(rate: number): number[] {
  return Array.from({ length: MOST_BANDS }, (_, k) => LOWEST_HZ * 2 ** (k / 3)).filter(
    (hz) => hz < 0.45 * rate,
  );
}

/**
 * `mono` through a band-pass a third of an octave wide at `hz` (the audio EQ cookbook's, 0 dB at
 * its peak), each HOP_MS frame's level, dB.
 */
function bandLevels(mono: Float32Array, rate: number, hz: number, hop: number): Float32Array {
  const w0 = (2 * Math.PI * hz) / rate;
  const alpha = Math.sin(w0) / (2 * THIRD_Q);
  const a0 = 1 + alpha;
  const [b0, a1, a2] = [alpha / a0, (-2 * Math.cos(w0)) / a0, (1 - alpha) / a0];
  const levels = new Float32Array(Math.floor(mono.length / hop));
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let frame = 0; frame < levels.length; frame++) {
    let sum = 0;
    for (let i = frame * hop; i < (frame + 1) * hop; i++) {
      const x = mono[i] ?? 0;
      const y = b0 * x - b0 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      sum += y * y;
    }
    levels[frame] = Math.max(FLOOR_DB, 10 * Math.log10(sum / hop + 1e-30));
  }
  return levels;
}

/** `pcm`'s spectrum: each band's level in each HOP_MS frame, dB, a list of frames per band. */
export function spectrumOf(pcm: Pcm): Float32Array[] {
  const mono = monoOf(pcm);
  const hop = Math.max(1, Math.round((pcm.rate * HOP_MS) / 1000));
  return bandsAt(pcm.rate).map((hz) => bandLevels(mono, pcm.rate, hz, hop));
}

/** Each frame's spectral flux: how much its bands rose against the frame before, dB, summed. */
export function fluxOf(spectrum: readonly Float32Array[]): Float32Array {
  const frames = spectrum[0]?.length ?? 0;
  const flux = new Float32Array(frames);
  for (const band of spectrum) {
    for (let t = 1; t < frames; t++) {
      flux[t] = (flux[t] ?? 0) + Math.max(0, (band[t] ?? 0) - (band[t - 1] ?? 0));
    }
  }
  return flux;
}

/**
 * How `x` from `a` and from `b` rise and fall together over `n` values: their correlation, −1 to 1;
 * 0 where either stands still.
 */
export function correlation(x: Float32Array, a: number, b: number, n: number): number {
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    sa += x[a + i] ?? 0;
    sb += x[b + i] ?? 0;
  }
  const ma = sa / n;
  const mb = sb / n;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    const da = (x[a + i] ?? 0) - ma;
    const db = (x[b + i] ?? 0) - mb;
    ab += da * db;
    aa += da * da;
    bb += db * db;
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}

/** How far apart `spectrum` from frame `a` and from `b` lies over `n` frames, dB RMS. */
export function spectrumGap(spectrum: readonly Float32Array[], a: number, b: number, n: number) {
  let sum = 0;
  for (const band of spectrum) {
    for (let i = 0; i < n; i++) sum += ((band[a + i] ?? 0) - (band[b + i] ?? 0)) ** 2;
  }
  return Math.sqrt(sum / Math.max(1, n * spectrum.length));
}

/** A seam as found: the crossfade, and how alike its two sides sound — higher, more alike. */
export interface Seam extends Crossfade {
  readonly score: number;
}

/** The features a seam is judged by: the spectrum and its flux, frame by frame. */
export interface Features {
  readonly spectrum: readonly Float32Array[];
  readonly flux: Float32Array;
}

/** `pcm` read for its seams. */
export function featuresOf(pcm: Pcm): Features {
  const spectrum = spectrumOf(pcm);
  return { spectrum, flux: fluxOf(spectrum) };
}

/**
 * How alike the music at `from` (frames) and `period` frames later sounds over `n` frames: the
 * flux's correlation less the spectra's gap over SPECTRUM_WEIGHT_DB.
 */
export function seamScore(features: Features, from: number, period: number, n: number): number {
  const beats = correlation(features.flux, from, from + period, n);
  return beats - spectrumGap(features.spectrum, from, from + period, n) / SPECTRUM_WEIGHT_DB;
}

/**
 * `fade` with its end moved within `seekMs` of the plan's, in HOP_MS steps, to where the two sides
 * of its seam sound most alike (`seamScore`), over the fade and MARGIN_MS either side; its start
 * and its length as planned. With no reach, `fade` as it is, scored.
 */
export function bestSeam(features: Features, fade: Crossfade, seekMs: number): Seam {
  const frames = features.flux.length;
  const from = Math.max(0, Math.round((fade.startMs - MARGIN_MS) / HOP_MS));
  const n = Math.round((fade.fadeMs + 2 * MARGIN_MS) / HOP_MS);
  const planned = Math.round((fade.endMs - fade.fadeMs - fade.startMs) / HOP_MS);
  const reach = Math.round(seekMs / HOP_MS);
  let best = { period: planned, score: -Infinity };
  for (let period = planned - reach; period <= planned + reach; period++) {
    if (period <= n || from + period + n > frames) continue;
    const score = seamScore(features, from, period, n);
    if (score > best.score) best = { period, score };
  }
  const endMs = fade.startMs + best.period * HOP_MS + fade.fadeMs;
  return { ...fade, endMs, score: Number(best.score.toFixed(3)) };
}

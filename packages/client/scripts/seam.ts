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
 * over SPECTRUM_WEIGHT_DB, over the fade and MARGIN_MS either side of it; the loop's start and its
 * period are each moved in steps of a frame within the plan's reach and the best pair kept
 * (`bestSeam`), every window's sums taken from running sums, so that the search stays quick. Pure.
 *
 * Runs on Node's own TypeScript, as the sound script does: it imports nothing of the app but the
 * pack format (src/world/packFile.ts), which imports nothing.
 */
import { MIN_LEAD_MS, type Crossfade } from '../src/world/packFile.ts';
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
 * Running sums of what a seam of `period` frames is judged by, frame by frame from `lo` to `hi`:
 * the flux on each side, its products and squares, and the spectra's squared gap — the sum of
 * the first i frames at index i, so that any window's sum is one subtraction.
 */
interface Sums {
  readonly a: Float64Array;
  readonly b: Float64Array;
  readonly ab: Float64Array;
  readonly aa: Float64Array;
  readonly bb: Float64Array;
  readonly gap: Float64Array;
}

/** The running sums for `period`, frames `lo` to `hi`. */
function sumsOf(features: Features, period: number, lo: number, hi: number): Sums {
  const length = Math.max(0, hi - lo);
  const fresh = (): Float64Array => new Float64Array(length + 1);
  const sums: Sums = {
    a: fresh(),
    b: fresh(),
    ab: fresh(),
    aa: fresh(),
    bb: fresh(),
    gap: fresh(),
  };
  for (let i = 0; i < length; i++) {
    const t = lo + i;
    const x = features.flux[t] ?? 0;
    const y = features.flux[t + period] ?? 0;
    let gap = 0;
    for (const band of features.spectrum) gap += ((band[t] ?? 0) - (band[t + period] ?? 0)) ** 2;
    sums.a[i + 1] = (sums.a[i] ?? 0) + x;
    sums.b[i + 1] = (sums.b[i] ?? 0) + y;
    sums.ab[i + 1] = (sums.ab[i] ?? 0) + x * y;
    sums.aa[i + 1] = (sums.aa[i] ?? 0) + x * x;
    sums.bb[i + 1] = (sums.bb[i] ?? 0) + y * y;
    sums.gap[i + 1] = (sums.gap[i] ?? 0) + gap;
  }
  return sums;
}

/** A variance this small against its sum of squares is none: the flux stands still. */
const STILL = 1e-9;

/**
 * The score (`seamScore`) of the window of `n` frames from index `i` of `sums`, over `bands`
 * bands, worked out from the running sums.
 */
function windowScore(sums: Sums, i: number, n: number, bands: number): number {
  const take = (running: Float64Array): number => (running[i + n] ?? 0) - (running[i] ?? 0);
  const [a, b] = [take(sums.a), take(sums.b)];
  const [ab, aa, bb] = [take(sums.ab), take(sums.aa), take(sums.bb)];
  const varA = n * aa - a * a;
  const varB = n * bb - b * b;
  const moving = varA > STILL * n * aa && varB > STILL * n * bb;
  const beats = moving ? (n * ab - a * b) / Math.sqrt(varA * varB) : 0;
  const gap = Math.sqrt(Math.max(0, take(sums.gap)) / Math.max(1, n * bands));
  return beats - gap / SPECTRUM_WEIGHT_DB;
}

/** The best seam of one period: the start within `first`–`last` (frames) that scores most. */
function bestStart(
  features: Features,
  period: number,
  [first, last]: readonly [number, number],
  n: number,
): { from: number; score: number } {
  const margin = MARGIN_MS / HOP_MS;
  const fits = Math.min(last, features.flux.length - period - n + margin);
  let best = { from: first, score: -Infinity };
  if (period <= n || fits < first) return best;
  const lo = first - margin;
  const sums = sumsOf(features, period, lo, fits - margin + n);
  for (let from = first; from <= fits; from++) {
    const score = windowScore(sums, from - margin - lo, n, features.spectrum.length);
    if (score > best.score) best = { from, score };
  }
  return best;
}

/**
 * The periods a seam may go round in, frames, from `shortest` to `longest`: every frame's — or,
 * for music of a tempo its composer states, whole bars of `barMs` alone, each to the nearest frame,
 * so that the beats of the two passes fall together where the flux cannot tell them.
 */
export function periodsOf(shortest: number, longest: number, barMs: number | null): number[] {
  if (barMs === null) {
    return Array.from({ length: Math.max(0, longest - shortest + 1) }, (_, i) => shortest + i);
  }
  const bar = barMs / HOP_MS;
  const first = Math.ceil((shortest - 0.5) / bar);
  const last = Math.floor((longest + 0.5) / bar);
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) =>
    Math.round((first + i) * bar),
  ).filter((period) => period >= shortest && period <= longest);
}

/**
 * `fade` with its start and its period each moved within `seekMs` of the plan's, in HOP_MS steps,
 * to where the two sides of its seam sound most alike (`seamScore`) over the fade and MARGIN_MS
 * either side — its start never under MIN_LEAD_MS, its period within `periodMs` and of whole bars
 * of `barMs` where that is given (`periodsOf`), its length as planned. With no reach, `fade` as it
 * is, scored; −Infinity where no seam within reach finds the music past it in the file.
 */
export function bestSeam(
  features: Features,
  fade: Crossfade,
  seekMs: number,
  periodMs: readonly [number, number] = [0, Infinity],
  barMs: number | null = null,
): Seam {
  const n = Math.round((fade.fadeMs + 2 * MARGIN_MS) / HOP_MS);
  const reach = Math.round(seekMs / HOP_MS);
  const start = Math.round(fade.startMs / HOP_MS);
  const lowest = Math.max(MIN_LEAD_MS, MARGIN_MS) / HOP_MS;
  const starts = [Math.max(lowest, start - reach), start + reach] as const;
  const planned = Math.round((fade.endMs - fade.fadeMs - fade.startMs) / HOP_MS);
  const shortest = Math.max(planned - reach, Math.ceil(periodMs[0] / HOP_MS));
  const longest = Math.min(planned + reach, Math.floor(periodMs[1] / HOP_MS));
  let best = { from: start, period: planned, score: -Infinity };
  for (const period of periodsOf(shortest, longest, barMs)) {
    const found = bestStart(features, period, starts, n);
    if (found.score > best.score) best = { ...found, period };
  }
  const startMs = best.from * HOP_MS;
  const endMs = (best.from + best.period) * HOP_MS + fade.fadeMs;
  return { startMs, endMs, fadeMs: fade.fadeMs, score: Number(best.score.toFixed(3)) };
}

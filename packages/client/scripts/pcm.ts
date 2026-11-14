/**
 * Decoded audio for the sound script (sfx.ts) and the opening's cue (introCue.ts): a WAV read as
 * afconvert writes one, and written for afconvert to encode; how loud a recording is — its peak
 * and its RMS, its silence, its noise floor, and its loudness as ITU-R BS.1770-4 measures it
 * (`lufsOf`); and a span of it cut out, its edges faded so that no cut clicks (`sliceOf`). Pure:
 * nothing here opens a file.
 *
 * Runs on Node's own TypeScript, as the sound script does: it imports nothing of the app.
 */

/** Decoded audio: its rate and each channel's samples, −1 to 1. */
export interface Pcm {
  readonly rate: number;
  readonly channels: readonly Float32Array[];
}

/** A sample, or a 10 ms frame, quieter than this counts as silence: −60 dBFS. */
export const SILENCE = 10 ** (-60 / 20);
/** A recording's noise floor is the RMS of its quietest stretch this long, ms. */
export const FLOOR_WINDOW_MS = 100;

/** How many samples each channel of `pcm` holds. */
const lengthOf = (pcm: Pcm): number => pcm.channels[0]?.length ?? 0;

interface WavFormat {
  readonly code: number;
  readonly channels: number;
  readonly rate: number;
  readonly bits: number;
}

/** The samples of a WAV's data chunk, `size` bytes from `from`: 16-bit or 32-bit float. */
function samplesOf(view: DataView, from: number, size: number, format: WavFormat): Pcm {
  const step = format.bits / 8;
  const frames = Math.floor(size / (step * format.channels));
  const float = format.code === 3 && format.bits === 32;
  if (!float && !(format.code === 1 && format.bits === 16)) {
    throw new Error(`sfx: a WAV of format ${format.code} at ${format.bits} bits, not 16-bit PCM`);
  }
  const read = (at: number): number =>
    float ? view.getFloat32(at, true) : view.getInt16(at, true) / 32768;
  const channels = Array.from({ length: format.channels }, (_, c) => {
    const data = new Float32Array(frames);
    for (let i = 0; i < frames; i++) data[i] = read(from + (i * format.channels + c) * step);
    return data;
  });
  return { rate: format.rate, channels };
}

/** The PCM of a WAV file, as afconvert writes it; its chunks before the data skipped. */
export function parseWav(bytes: Uint8Array): Pcm {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number): string => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') {
    throw new Error('sfx: not a WAV file');
  }
  let format: WavFormat | null = null;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (tag(at) === 'fmt ') {
      const code = view.getUint16(body, true);
      format = {
        // WAVE_FORMAT_EXTENSIBLE names its own in the first two bytes of its subformat
        code: code === 0xfffe ? view.getUint16(body + 24, true) : code,
        channels: view.getUint16(body + 2, true),
        rate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (tag(at) === 'data' && format !== null) {
      return samplesOf(view, body, Math.min(size, bytes.length - body), format);
    }
    at = body + size + (size % 2);
  }
  throw new Error('sfx: a WAV file without its format or its data');
}

/** `pcm` as a WAV file of 16-bit samples, interleaved, each held within full scale. */
export function wavBytes(pcm: Pcm): Uint8Array<ArrayBuffer> {
  const frames = lengthOf(pcm);
  const count = pcm.channels.length;
  const data = frames * count * 2;
  const bytes = new Uint8Array(44 + data);
  const view = new DataView(bytes.buffer);
  const tag = (at: number, text: string): void => {
    for (let i = 0; i < 4; i++) bytes[at + i] = text.charCodeAt(i);
  };
  tag(0, 'RIFF');
  view.setUint32(4, 36 + data, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, count, true);
  view.setUint32(24, pcm.rate, true);
  view.setUint32(28, pcm.rate * count * 2, true);
  view.setUint16(32, count * 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, data, true);
  pcm.channels.forEach((channel, c) => {
    for (let i = 0; i < frames; i++) {
      const held = Math.max(-1, Math.min(1, channel[i] ?? 0));
      view.setInt16(44 + (i * count + c) * 2, Math.round(held * 32767), true);
    }
  });
  return bytes;
}

/** How a recording measures: how long (ms), its peak and RMS, the silence before its sound (ms). */
export interface Loudness {
  readonly ms: number;
  readonly peak: number;
  readonly rms: number;
  readonly leadMs: number;
}

/** Measures `pcm`: its peak and its RMS over every channel, from where its sound starts. */
export function loudnessOf(pcm: Pcm): Loudness {
  const frames = lengthOf(pcm);
  const lead = Math.min(
    frames,
    ...pcm.channels.map((data) => {
      const first = data.findIndex((x) => Math.abs(x) > SILENCE);
      return first < 0 ? frames : first;
    }),
  );
  let peak = 0;
  let sum = 0;
  for (const data of pcm.channels) {
    for (let i = lead; i < frames; i++) {
      const x = data[i] ?? 0;
      peak = Math.max(peak, Math.abs(x));
      sum += x * x;
    }
  }
  const count = (frames - lead) * pcm.channels.length;
  return {
    ms: Math.round((frames / pcm.rate) * 1000),
    peak,
    rms: count > 0 ? Math.sqrt(sum / count) : 0,
    leadMs: (lead / pcm.rate) * 1000,
  };
}

/** The share of `pcm`'s 10 ms frames whose RMS, over every channel, lies under SILENCE. */
export function silenceOf(pcm: Pcm): number {
  const samples = lengthOf(pcm);
  const frame = Math.max(1, Math.round(pcm.rate / 100));
  let frames = 0;
  let silent = 0;
  for (let from = 0; from < samples; from += frame) {
    const to = Math.min(samples, from + frame);
    let sum = 0;
    for (const data of pcm.channels) {
      for (let i = from; i < to; i++) sum += (data[i] ?? 0) ** 2;
    }
    frames += 1;
    if (Math.sqrt(sum / ((to - from) * pcm.channels.length)) < SILENCE) silent += 1;
  }
  return frames > 0 ? silent / frames : 1;
}

/** Each full 10 ms frame's sum of squares, over every channel, and the frame's length. */
function frameSums(pcm: Pcm): { sums: number[]; frame: number } {
  const samples = lengthOf(pcm);
  const frame = Math.max(1, Math.round(pcm.rate / 100));
  const sums: number[] = [];
  for (let from = 0; from + frame <= samples; from += frame) {
    let sum = 0;
    for (const data of pcm.channels) {
      for (let i = from; i < from + frame; i++) sum += (data[i] ?? 0) ** 2;
    }
    sums.push(sum);
  }
  return { sums, frame };
}

/**
 * `pcm`'s noise floor: the RMS, over every channel, of its quietest FLOOR_WINDOW_MS, stepped
 * 10 ms at a time; of all of it where it is shorter.
 */
export function floorOf(pcm: Pcm): number {
  const { sums, frame } = frameSums(pcm);
  const span = Math.round(FLOOR_WINDOW_MS / 10);
  const width = pcm.channels.length * frame;
  if (sums.length < span) {
    const total = sums.reduce((sum, each) => sum + each, 0);
    return sums.length > 0 ? Math.sqrt(total / (sums.length * width)) : 0;
  }
  let least = Infinity;
  for (let k = 0; k + span <= sums.length; k++) {
    let window = 0;
    for (let j = k; j < k + span; j++) window += sums[j] ?? 0;
    least = Math.min(least, window);
  }
  return Math.sqrt(least / (span * width));
}

// --- loudness as BS.1770 measures it -------------------------------------------------------

/** A biquad's coefficients, a0 normalised to 1: its feed-forward b0–b2, its feedback a1 and a2. */
export interface Biquad {
  readonly b: readonly [number, number, number];
  readonly a: readonly [number, number];
}

/**
 * BS.1770's K-weighting at `rate`, as two biquads: the head's high shelf (+4 dB above some
 * 1.7 kHz) and the RLB high-pass (some 38 Hz), from their analog prototypes by the bilinear
 * transform — at 48 kHz exactly the coefficients the recommendation tabulates.
 */
export function kWeighting(rate: number): readonly [Biquad, Biquad] {
  const shelfK = Math.tan((Math.PI * 1681.974450955533) / rate);
  const shelfQ = 0.7071752369554196;
  const vh = 10 ** (3.999843853973347 / 20);
  const vb = vh ** 0.4996667741545416;
  const shelfA0 = 1 + shelfK / shelfQ + shelfK * shelfK;
  const shelf: Biquad = {
    b: [
      (vh + (vb * shelfK) / shelfQ + shelfK * shelfK) / shelfA0,
      (2 * (shelfK * shelfK - vh)) / shelfA0,
      (vh - (vb * shelfK) / shelfQ + shelfK * shelfK) / shelfA0,
    ],
    a: [(2 * (shelfK * shelfK - 1)) / shelfA0, (1 - shelfK / shelfQ + shelfK * shelfK) / shelfA0],
  };
  const passK = Math.tan((Math.PI * 38.13547087602444) / rate);
  const passQ = 0.5003270373238773;
  const passA0 = 1 + passK / passQ + passK * passK;
  const highPass: Biquad = {
    b: [1, -2, 1],
    a: [(2 * (passK * passK - 1)) / passA0, (1 - passK / passQ + passK * passK) / passA0],
  };
  return [shelf, highPass];
}

/** BS.1770's blocks: 400 ms, a new one every 100 ms (a step), so that each overlaps by three. */
const STEPS_PER_BLOCK = 4;
const STEP_S = 0.1;
/** A block under −70 LUFS is silence; one 10 LU under the mean of the rest does not count. */
const ABSOLUTE_GATE = -70;
const RELATIVE_GATE = -10;

/** The loudness of a block whose channels' K-weighted mean squares sum to `power`, LUFS. */
const loudnessAt = (power: number): number => -0.691 + 10 * Math.log10(power);

/**
 * Each 100 ms step's sum of K-weighted squares in `channel` at `rate`, the two biquads run one
 * after the other over every sample.
 */
function weightedSteps(channel: Float32Array, rate: number): Float64Array {
  const [one, two] = kWeighting(rate);
  const step = Math.max(1, Math.round(rate * STEP_S));
  const sums = new Float64Array(Math.floor(channel.length / step));
  let x1 = 0;
  let x2 = 0;
  let m1 = 0;
  let m2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < sums.length * step; i++) {
    const x = channel[i] ?? 0;
    const m = one.b[0] * x + one.b[1] * x1 + one.b[2] * x2 - one.a[0] * m1 - one.a[1] * m2;
    const y = two.b[0] * m + two.b[1] * m1 + two.b[2] * m2 - two.a[0] * y1 - two.a[1] * y2;
    x2 = x1;
    x1 = x;
    m2 = m1;
    m1 = m;
    y2 = y1;
    y1 = y;
    const at = Math.floor(i / step);
    sums[at] = (sums[at] ?? 0) + y * y;
  }
  return sums;
}

/**
 * The power of each block of `pcm`: its channels' K-weighted mean squares, summed; a recording
 * shorter than a block is one block.
 */
function blockPowers(pcm: Pcm): number[] {
  const steps = pcm.channels.map((channel) => weightedSteps(channel, pcm.rate));
  const count = steps.length === 0 ? 0 : Math.min(...steps.map((sums) => sums.length));
  const width = Math.max(1, Math.round(pcm.rate * STEP_S));
  const span = Math.min(STEPS_PER_BLOCK, Math.max(1, count));
  const blocks: number[] = [];
  for (let k = 0; k + span <= count; k++) {
    let power = 0;
    for (const sums of steps) {
      for (let j = k; j < k + span; j++) power += (sums[j] ?? 0) / (span * width);
    }
    blocks.push(power);
  }
  return blocks;
}

const meanOf = (list: readonly number[]): number =>
  list.reduce((sum, each) => sum + each, 0) / list.length;

/**
 * `pcm`'s integrated loudness, LUFS, as ITU-R BS.1770-4 measures it: every channel K-weighted
 * (each of its two counted in full, as left and right are), the mean square of each 400 ms block
 * — a new one every 100 ms — summed over the channels, the blocks under −70 LUFS left out as
 * silence and then those 10 LU under the mean of the rest, and the mean of what is left.
 * −Infinity for silence.
 */
export function lufsOf(pcm: Pcm): number {
  const heard = blockPowers(pcm).filter((power) => loudnessAt(power) > ABSOLUTE_GATE);
  if (heard.length === 0) return -Infinity;
  const gate = loudnessAt(meanOf(heard)) + RELATIVE_GATE;
  return loudnessAt(meanOf(heard.filter((power) => loudnessAt(power) > gate)));
}

// --- a span cut out -------------------------------------------------------------------------

/**
 * The span of `pcm` from `fromMs` to `toMs` — no further than its end — its first and its last
 * `edgeMs` faded in and out on a raised cosine, so that the cut does not click where the sound
 * at it is not at rest.
 */
export function sliceOf(pcm: Pcm, fromMs: number, toMs: number, edgeMs: number): Pcm {
  const total = lengthOf(pcm);
  const from = Math.min(total, Math.max(0, Math.round((fromMs / 1000) * pcm.rate)));
  const to = Math.min(total, Math.max(from, Math.round((toMs / 1000) * pcm.rate)));
  const edge = Math.min(Math.floor((to - from) / 2), Math.round((edgeMs / 1000) * pcm.rate));
  const fade = (i: number): number => (edge > 0 ? 0.5 - 0.5 * Math.cos((Math.PI * i) / edge) : 1);
  const channels = pcm.channels.map((channel) => {
    const span = channel.slice(from, to);
    for (let i = 0; i < edge; i++) {
      span[i] = (span[i] ?? 0) * fade(i);
      span[span.length - 1 - i] = (span[span.length - 1 - i] ?? 0) * fade(i);
    }
    return span;
  });
  return { rate: pcm.rate, channels };
}

/**
 * A take as the server takes it: the microphone's channels mixed into one, the silence at
 * either end cut away down to KEEP_MS, written as a WAV of 16-bit PCM at RATE. Pure, so the
 * trim and the file are tested without a browser.
 */

/** The rate a take is written at, Hz: what afconvert turns into the game's AAC. */
export const RATE = 44100;
/** The window the trim measures the energy in, ms. */
export const FRAME_MS = 10;
/** A window sounds where its energy is no further than this under the loudest window's, dB. */
export const THRESHOLD_DB = -35;
/** Nor quieter than this, dB under full scale: a take of room noise alone sounds nowhere. */
export const FLOOR_DB = -60;
/** The silence kept before the first window that sounds and after the last, ms. */
export const KEEP_MS = 120;

/** The channels of a recording averaged into one. */
export function mixDown(channels: readonly Float32Array[]): Float32Array {
  const length = Math.min(...channels.map((channel) => channel.length));
  const mono = new Float32Array(channels.length === 0 ? 0 : length);
  for (const channel of channels) {
    for (let i = 0; i < mono.length; i++) {
      mono[i] = (mono[i] ?? 0) + (channel[i] ?? 0) / channels.length;
    }
  }
  return mono;
}

/** The energy (RMS) of every `frame` samples of `samples`, the last window as long as is left. */
function energies(samples: Float32Array, frame: number): number[] {
  const out: number[] = [];
  for (let start = 0; start < samples.length; start += frame) {
    const end = Math.min(samples.length, start + frame);
    let sum = 0;
    for (let i = start; i < end; i++) sum += (samples[i] ?? 0) ** 2;
    out.push(Math.sqrt(sum / (end - start)));
  }
  return out;
}

/**
 * `samples` at `rate` with the silence at either end cut away: every FRAME_MS window's energy
 * against the loudest window's — a window sounds at THRESHOLD_DB under it or louder, and never
 * under FLOOR_DB — and KEEP_MS kept before the first window that sounds and after the last.
 * Empty where nothing sounds.
 */
export function trimSilence(samples: Float32Array, rate: number): Float32Array {
  const frame = Math.max(1, Math.round((rate * FRAME_MS) / 1000));
  const energy = energies(samples, frame);
  const loudest = energy.reduce((most, e) => Math.max(most, e), 0);
  const threshold = Math.max(loudest * 10 ** (THRESHOLD_DB / 20), 10 ** (FLOOR_DB / 20));
  const first = energy.findIndex((e) => e >= threshold);
  if (first < 0) {
    return new Float32Array(0);
  }
  let last = energy.length - 1;
  while ((energy[last] ?? 0) < threshold) last--;
  const keep = Math.round((rate * KEEP_MS) / 1000);
  const from = Math.max(0, first * frame - keep);
  const to = Math.min(samples.length, (last + 1) * frame + keep);
  return samples.slice(from, to);
}

/** `samples` as a WAV file: RIFF, a `fmt ` chunk for 16-bit PCM in one channel at `rate`, data. */
export function encodeWav(samples: Float32Array, rate: number): ArrayBuffer {
  const bytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + bytes);
  const view = new DataView(buffer);
  const ascii = (at: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // one channel
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // bytes a second
  view.setUint16(32, 2, true); // bytes a sample
  view.setUint16(34, 16, true); // bits a sample
  ascii(36, 'data');
  view.setUint32(40, bytes, true);
  samples.forEach((sample, i) => {
    const clipped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, Math.round(clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff), true);
  });
  return buffer;
}

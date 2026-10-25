import { describe, expect, it } from 'vitest';
import {
  encodeWav,
  FLOOR_DB,
  FRAME_MS,
  KEEP_MS,
  mixDown,
  RATE,
  THRESHOLD_DB,
  trimSilence,
} from '../src/record/wav.js';

const KEEP = Math.round((RATE * KEEP_MS) / 1000);
const FRAME = Math.round((RATE * FRAME_MS) / 1000);

/** `seconds` of a 300 Hz tone at `peak`. */
const tone = (seconds: number, peak = 0.5): Float32Array =>
  Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) =>
    peak * Math.sin((2 * Math.PI * 300 * i) / RATE),
  );

/** `seconds` of steady noise at `level`, dB under full scale, alternating so its RMS is exact. */
const hush = (seconds: number, level = -Infinity): Float32Array =>
  Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) =>
    (i % 2 === 0 ? 1 : -1) * 10 ** (level / 20),
  );

const join = (...parts: Float32Array[]): Float32Array => {
  const all = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.length;
  }
  return all;
};

describe('the trim', () => {
  it('cuts the silence at both ends down to 120 ms', () => {
    const spoken = tone(1);
    const trimmed = trimSilence(join(hush(0.5), spoken, hush(0.7)), RATE);
    expect(KEEP_MS).toBe(120);
    expect(Math.abs(trimmed.length - (spoken.length + 2 * KEEP))).toBeLessThanOrEqual(FRAME);
    const firstSound = trimmed.findIndex((sample) => sample !== 0);
    expect(Math.abs(firstSound - KEEP)).toBeLessThanOrEqual(FRAME);
  });

  it('takes room noise for silence: under the floor, or far enough under the speech', () => {
    const spoken = tone(0.8, 0.5);
    const noise = hush(0.4, FLOOR_DB - 10);
    const room = trimSilence(join(noise, spoken, noise), RATE);
    expect(Math.abs(room.length - (spoken.length + 2 * KEEP))).toBeLessThanOrEqual(FRAME);
    // 0.5 at its peak is an RMS of 0.35: noise 45 dB under that is silence, 25 dB under is not.
    const rms = 0.5 / Math.SQRT2;
    const under = (db: number): number => 20 * Math.log10(rms) + db;
    const quiet = join(hush(0.4, under(-45)), spoken, hush(0.4, under(-45)));
    expect(trimSilence(quiet, RATE).length).toBeLessThan(spoken.length + 2 * KEEP + FRAME);
    const loud = join(hush(0.4, under(-25)), spoken, hush(0.4, under(-25)));
    expect(trimSilence(loud, RATE).length).toBe(loud.length);
    expect(THRESHOLD_DB).toBe(-35);
  });

  it('keeps a pause between words: only the ends go', () => {
    const words = join(tone(0.3), hush(0.6), tone(0.4));
    const trimmed = trimSilence(join(hush(0.5), words, hush(0.5)), RATE);
    expect(Math.abs(trimmed.length - (words.length + 2 * KEEP))).toBeLessThanOrEqual(FRAME);
  });

  it('leaves a take that sounds to its ends as it is', () => {
    const spoken = tone(0.5);
    expect(trimSilence(spoken, RATE)).toEqual(spoken);
    const late = join(hush(0.05), spoken);
    expect(trimSilence(late, RATE).length).toBe(late.length);
  });

  it('leaves nothing of a silent take, or of an empty one', () => {
    expect(trimSilence(hush(1), RATE)).toHaveLength(0);
    expect(trimSilence(hush(1, FLOOR_DB - 6), RATE)).toHaveLength(0);
    expect(trimSilence(new Float32Array(0), RATE)).toHaveLength(0);
  });
});

describe('the WAV a take is sent as', () => {
  it('heads its samples with RIFF, a fmt chunk for 16-bit PCM in one channel, and data', () => {
    const wav = new DataView(encodeWav(new Float32Array(3), RATE));
    const ascii = (at: number, length: number): string =>
      String.fromCharCode(...Array.from({ length }, (_, i) => wav.getUint8(at + i)));
    expect(wav.byteLength).toBe(44 + 6);
    expect(ascii(0, 4)).toBe('RIFF');
    expect(wav.getUint32(4, true)).toBe(36 + 6);
    expect(ascii(8, 8)).toBe('WAVEfmt ');
    expect(wav.getUint32(16, true)).toBe(16);
    expect(wav.getUint16(20, true)).toBe(1);
    expect(wav.getUint16(22, true)).toBe(1);
    expect(wav.getUint32(24, true)).toBe(44100);
    expect(wav.getUint32(28, true)).toBe(88200);
    expect(wav.getUint16(32, true)).toBe(2);
    expect(wav.getUint16(34, true)).toBe(16);
    expect(ascii(36, 4)).toBe('data');
    expect(wav.getUint32(40, true)).toBe(6);
  });

  it('writes each sample as 16 bits, clipped to full scale', () => {
    const samples = Float32Array.from([0, 1, -1, 0.5, -0.5, 2, -2]);
    const wav = new DataView(encodeWav(samples, RATE));
    const written = Array.from(samples, (_, i) => wav.getInt16(44 + i * 2, true));
    expect(written).toEqual([0, 32767, -32768, 16384, -16384, 32767, -32768]);
  });
});

describe('the channels of a take', () => {
  it('are averaged into one, as long as the shortest', () => {
    const left = Float32Array.from([1, 0.5, -1]);
    const right = Float32Array.from([0, 0.5, 1, 1]);
    expect(Array.from(mixDown([left, right]))).toEqual([0.5, 0.5, 0]);
    expect(Array.from(mixDown([left]))).toEqual([1, 0.5, -1]);
    expect(mixDown([])).toHaveLength(0);
  });
});

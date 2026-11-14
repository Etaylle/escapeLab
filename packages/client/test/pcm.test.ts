import { describe, expect, it } from 'vitest';
import { kWeighting, lufsOf, parseWav, sliceOf, wavBytes, type Pcm } from '../scripts/pcm.js';

/**
 * The sound script's PCM (scripts/pcm.ts): loudness as ITU-R BS.1770-4 measures it, a span cut
 * out with its edges faded, and a WAV written for afconvert to encode.
 */

/** `seconds` of a sine at `hz` and `amplitude`, at `rate`, in each of `channels` channels. */
function sine(rate: number, seconds: number, amplitude: number, hz = 997, channels = 1): Pcm {
  const wave = Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) =>
    amplitude * Math.sin((2 * Math.PI * hz * i) / rate),
  );
  return { rate, channels: Array.from({ length: channels }, () => Float32Array.from(wave)) };
}

/** `pcm` followed by `next`, channel by channel. */
const joined = (pcm: Pcm, next: Pcm): Pcm => ({
  rate: pcm.rate,
  channels: pcm.channels.map((data, c) => {
    const more = next.channels[c] ?? new Float32Array(0);
    const both = new Float32Array(data.length + more.length);
    both.set(data);
    both.set(more, data.length);
    return both;
  }),
});

describe('loudness as BS.1770 measures it', () => {
  it('weights by the recommendation’s own coefficients at 48 kHz', () => {
    const [shelf, highPass] = kWeighting(48_000);
    const table = {
      shelf: [1.53512485958697, -2.69169618940638, 1.19839281085285],
      shelfA: [-1.69065929318241, 0.73248077421585],
      highPassA: [-1.99004745483398, 0.99007225036621],
    };
    shelf.b.forEach((b, i) => expect(b).toBeCloseTo(table.shelf[i] ?? NaN, 12));
    shelf.a.forEach((a, i) => expect(a).toBeCloseTo(table.shelfA[i] ?? NaN, 12));
    expect(highPass.b).toEqual([1, -2, 1]);
    highPass.a.forEach((a, i) => expect(a).toBeCloseTo(table.highPassA[i] ?? NaN, 12));
  });

  it('reads a full-scale 997 Hz tone in one channel as −3.01 LUFS, in two as 0, at any rate', () => {
    for (const rate of [48_000, 44_100]) {
      expect(lufsOf(sine(rate, 5, 1))).toBeCloseTo(-3.01, 1);
      expect(lufsOf(sine(rate, 5, 1, 997, 2))).toBeCloseTo(0, 1);
      expect(lufsOf(sine(rate, 5, 0.1, 997, 2))).toBeCloseTo(-20, 1);
    }
    expect(lufsOf({ rate: 48_000, channels: [new Float32Array(48_000)] })).toBe(-Infinity);
  });

  it('leaves out what lies 10 LU under the rest, and silence: a quiet second half counts not', () => {
    const loud = sine(48_000, 6, 0.1, 997, 2); // −20 LUFS
    const quiet = sine(48_000, 6, 0.01, 997, 2); // −40 LUFS: 20 LU under, under the gate
    const both = lufsOf(joined(loud, quiet));
    // Ungated, the mean of the two halves' power would come to some −23 LUFS.
    expect(both).toBeGreaterThan(-20.6);
    expect(both).toBeLessThan(-19.9);
    // Silence is no block at all; the three blocks that take in the loud end count as heard.
    const none = (): Float32Array => new Float32Array(288_000);
    const silent = lufsOf(joined(loud, { rate: 48_000, channels: [none(), none()] }));
    expect(silent).toBeGreaterThan(-20.2);
    expect(silent).toBeLessThan(-19.9);
  });

  it('measures a recording shorter than its 400 ms blocks as one block', () => {
    expect(lufsOf(sine(48_000, 0.25, 0.1, 997, 2))).toBeCloseTo(-20, 0);
  });
});

describe('a span cut out', () => {
  const rate = 1000;
  const steady: Pcm = {
    rate,
    channels: [Float32Array.from({ length: 4000 }, () => 0.5), Float32Array.from({ length: 4000 })],
  };

  it('cuts from where it starts to where it ends, every channel alike', () => {
    const cut = sliceOf(steady, 1000, 2500, 0);
    expect(cut.rate).toBe(rate);
    expect(cut.channels.map((data) => data.length)).toEqual([1500, 1500]);
    expect([...(cut.channels[0] ?? [])].every((x) => x === 0.5)).toBe(true);
    expect(sliceOf(steady, 3500, 9000, 0).channels[0]).toHaveLength(500); // no further than its end
  });

  it('fades its first and last 10 ms in and out on a raised cosine, the rest as it was', () => {
    const cut = sliceOf(steady, 1000, 2000, 10).channels[0] ?? new Float32Array(0);
    expect(cut[0]).toBe(0);
    expect(cut[5]).toBeCloseTo(0.25, 6); // half way up the curve
    expect(cut[10]).toBe(0.5);
    expect(cut[989]).toBe(0.5);
    expect(cut[999]).toBe(0);
    // A cut shorter than its two edges fades over half of it each way.
    const short = sliceOf(steady, 0, 8, 10).channels[0] ?? new Float32Array(0);
    expect([short[0], short[7]]).toEqual([0, 0]);
  });
});

describe('a WAV written', () => {
  it('reads back as written, 16-bit, every channel, each sample held within full scale', () => {
    const pcm: Pcm = {
      rate: 8000,
      channels: [Float32Array.from([0, 0.5, -0.5, 1.5]), Float32Array.from([0.25, 0, -1, -2])],
    };
    const back = parseWav(wavBytes(pcm));
    expect(back.rate).toBe(8000);
    const rounded = back.channels.map((data) => [...data].map((x) => Number(x.toFixed(3))));
    expect(rounded).toEqual([
      [0, 0.5, -0.5, 1],
      [0.25, 0, -1, -1],
    ]);
  });
});

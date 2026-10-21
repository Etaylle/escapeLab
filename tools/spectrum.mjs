/**
 * How a signal's power is shared out over frequency bands: the walkthrough
 * measures the radio's chain with it (shots.mjs), white noise in and the
 * chain's output rendered offline in the page — its band-pass shows as the
 * power above 4 kHz against the power from 300 Hz to 3.4 kHz.
 */

/** In-place radix-2 FFT of `re`/`im` (length a power of two). */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k++) {
        const wr = Math.cos(step * k);
        const wi = Math.sin(step * k);
        const a = start + k;
        const b = a + size / 2;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

/**
 * The power of `samples` in each band, by Hann-windowed frames of `size`
 * samples overlapping by half: the sum of the band's bins, averaged over the
 * frames — what a ratio of two bands of one signal compares.
 *
 * @param {ArrayLike<number>} samples the signal
 * @param {number} rate its sample rate, Hz
 * @param {readonly (readonly [number, number])[]} bands [from, to) in Hz
 * @param {number} size frame length, a power of two
 * @returns {number[]} one power per band
 * @throws {RangeError} for a frame size that is no power of two, or a signal shorter than one
 */
export function bandPowers(samples, rate, bands, size = 4096) {
  if (!(size >= 2 && (size & (size - 1)) === 0)) {
    throw new RangeError(`frame size ${size}: it has to be a power of two`);
  }
  if (samples.length < size) {
    throw new RangeError(`${samples.length} samples: at least one frame of ${size} is needed`);
  }
  const powers = bands.map(() => 0);
  let frames = 0;
  for (let start = 0; start + size <= samples.length; start += size / 2) {
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      re[i] = samples[start + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));
    }
    fft(re, im);
    for (let k = 1; k < size / 2; k++) {
      const hz = (k * rate) / size;
      const power = re[k] * re[k] + im[k] * im[k];
      bands.forEach(([from, to], i) => {
        if (hz >= from && hz < to) powers[i] += power;
      });
    }
    frames += 1;
  }
  return powers.map((power) => power / frames);
}

/** `a` against `b`, two powers, in dB. */
export function decibels(a, b) {
  return 10 * Math.log10(a / b);
}

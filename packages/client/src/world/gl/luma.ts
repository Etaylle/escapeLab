/**
 * How bright a picture comes out overall, for holding the light layer to
 * the Canvas pass: a GL frame and a Canvas frame of the same scene have to
 * match in mean luma within LUMA_TOLERANCE. The walkthrough reads it off the
 * world's canvas through the page's light probe (path.ts). Pure.
 */

/** How far a GL frame's mean luma may lie from the Canvas frame's of the same scene, as a share. */
export const LUMA_TOLERANCE = 0.1;

/**
 * The mean Rec. 709 luma, 0 to 255, of RGBA pixels (`data`, four bytes a
 * pixel), over every `stride`-th pixel; null for no pixels.
 */
export function meanLuma(data: ArrayLike<number>, stride = 1): number | null {
  if (!(Number.isInteger(stride) && stride >= 1)) {
    throw new Error(`luma: the stride has to be a whole number of pixels from 1, not ${stride}`);
  }
  let sum = 0;
  let pixels = 0;
  for (let i = 0; i + 3 < data.length; i += 4 * stride) {
    sum += 0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0);
    pixels += 1;
  }
  return pixels === 0 ? null : sum / pixels;
}

/**
 * How far `value` lies from `reference`, as a share of the reference: 0.1
 * for ten per cent either way; 0 where both are black, and Infinity where
 * only the reference is.
 */
export function lumaGap(value: number, reference: number): number {
  if (reference === 0) {
    return value === 0 ? 0 : Number.POSITIVE_INFINITY;
  }
  return Math.abs(value - reference) / reference;
}

/** Whether a GL frame's mean luma (`value`) matches the Canvas frame's (`reference`). */
export function lumaMatch(value: number, reference: number, tolerance = LUMA_TOLERANCE): boolean {
  return lumaGap(value, reference) <= tolerance;
}

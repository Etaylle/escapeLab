import { describe, expect, it } from 'vitest';
import { LUMA_TOLERANCE, lumaGap, lumaMatch, meanLuma } from '../src/world/gl/luma.js';

/** RGBA pixels, one [r, g, b] each, opaque. */
function pixels(...rgb: [number, number, number][]): Uint8ClampedArray {
  return Uint8ClampedArray.from(rgb.flatMap(([r, g, b]) => [r, g, b, 255]));
}

describe('the luma match between a GL frame and a Canvas frame of one scene', () => {
  it('weighs red, green and blue as Rec. 709 does, and averages the pixels', () => {
    expect(meanLuma(pixels([255, 0, 0]))).toBeCloseTo(0.2126 * 255);
    expect(meanLuma(pixels([0, 255, 0]))).toBeCloseTo(0.7152 * 255);
    expect(meanLuma(pixels([0, 0, 255]))).toBeCloseTo(0.0722 * 255);
    expect(meanLuma(pixels([255, 255, 255], [0, 0, 0]))).toBeCloseTo(127.5);
  });

  it('reads every stride-th pixel only, and nothing where there are no pixels', () => {
    const striped = pixels([100, 100, 100], [0, 0, 0], [100, 100, 100], [0, 0, 0]);
    expect(meanLuma(striped, 2)).toBeCloseTo(100);
    expect(meanLuma(striped, 1)).toBeCloseTo(50);
    expect(meanLuma(new Uint8ClampedArray(0))).toBeNull();
    expect(() => meanLuma(striped, 0)).toThrow(/stride/);
    expect(() => meanLuma(striped, 1.5)).toThrow(/stride/);
  });

  it('measures the gap as a share of the Canvas frame’s luma, either way', () => {
    expect(lumaGap(110, 100)).toBeCloseTo(0.1);
    expect(lumaGap(90, 100)).toBeCloseTo(0.1);
    expect(lumaGap(0, 0)).toBe(0);
    expect(lumaGap(1, 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it('matches within ten per cent, and not a hair beyond', () => {
    expect(LUMA_TOLERANCE).toBe(0.1);
    expect(lumaMatch(32.4, 30)).toBe(true);
    expect(lumaMatch(27.1, 30)).toBe(true);
    expect(lumaMatch(33.1, 30)).toBe(false);
    expect(lumaMatch(26.9, 30)).toBe(false);
    expect(lumaMatch(12, 10, 0.25)).toBe(true);
    expect(lumaMatch(13, 10, 0.25)).toBe(false);
  });
});

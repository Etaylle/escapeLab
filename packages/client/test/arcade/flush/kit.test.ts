import { describe, expect, it } from 'vitest';
import {
  TAU,
  angleDelta,
  clamp,
  css,
  curve,
  ease,
  mixRgb,
  rgb,
  seeded,
  span,
} from '../../../src/arcade/flush/kit.js';

/** The small helpers Ferret Flush's rules lean on (the reference's test/kit.test.js). */
const close = (a: number, b: number): void => {
  expect(Math.abs(a - b)).toBeLessThan(1e-9);
};

describe('Ferret Flush kit', () => {
  it('turns the shortest way between two angles, never more than half a circle', () => {
    close(angleDelta(0, 1), 1);
    close(angleDelta(1, 0), -1);
    close(angleDelta(0.1, TAU - 0.1), -0.2);
    close(angleDelta(TAU - 0.1, 0.1), 0.2);
    close(angleDelta(0, 5 * TAU + 0.3), 0.3);
    close(angleDelta(-7 * TAU, -0.3), -0.3);
  });

  it('holds span and clamp inside their limits', () => {
    expect(clamp(12, 0, 10)).toBe(10);
    expect(clamp(-2, 0, 10)).toBe(0);
    expect(span(5, 0, 10)).toBe(0.5);
    expect(span(-3, 0, 10)).toBe(0);
    expect(span(30, 0, 10)).toBe(1);
  });

  it('starts every easing at zero and ends it at one', () => {
    for (const curveOf of Object.values(ease)) {
      close(curveOf(0), 0);
      close(curveOf(1), 1);
    }
    expect(ease.back(0.8)).toBeGreaterThan(1);
  });

  it('repeats a seeded random source and keeps it between zero and one', () => {
    const a = seeded(3);
    const b = seeded(3);
    const values = Array.from({ length: 200 }, () => a());
    expect(Array.from({ length: 200 }, () => b())).toEqual(values);
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(new Set(values).size).toBeGreaterThan(190);
  });

  it('mixes colours between their ends', () => {
    expect(rgb('#ff8000')).toEqual([255, 128, 0]);
    expect(css(mixRgb(rgb('#000000'), rgb('#ffffff'), 0.5))).toBe('rgb(128,128,128)');
    expect(css([1, 2, 3], 0.5)).toBe('rgba(1,2,3,0.5)');
  });

  it('starts and ends a curve where told and bends it toward the middle point', () => {
    const at = curve([0, 0], [10, 20], [20, 0]);
    expect(at(0)).toEqual([0, 0]);
    expect(at(1)).toEqual([20, 0]);
    expect(at(0.5)).toEqual([10, 10]);
  });
});

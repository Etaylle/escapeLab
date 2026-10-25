import { describe, expect, it } from 'vitest';
import { gridOf, phaseOf, sameGrid, snapCamera } from '../src/world/render/grid.js';

describe('grid — how the world lies on the canvas’s pixels', () => {
  it('puts the world’s origin where the camera says, the camera’s point in the middle', () => {
    expect(gridOf({ x: 5, y: 3, scale: 100 }, 800, 600)).toEqual({ scale: 100, ox: -100, oy: 0 });
    expect(gridOf({ x: 2.25, y: 1, scale: 78 }, 1440, 820)).toEqual({
      scale: 78,
      ox: 720 - 2.25 * 78,
      oy: 410 - 78,
    });
  });

  it('measures the fraction of a pixel the origin lies off a whole one, -0.5 to 0.5', () => {
    expect(phaseOf({ scale: 78, ox: 100.25, oy: -3.75 })).toEqual([0.25, 0.25]);
    expect(phaseOf({ scale: 78, ox: 99.75, oy: 3 })).toEqual([-0.25, 0]);
    // A hair off a whole pixel, as floating point leaves it, is on it.
    const [px] = phaseOf({ scale: 78, ox: 100 - 1e-12, oy: 0 });
    expect(Math.abs(px)).toBeLessThan(1e-9);
  });

  it('counts two grids one where a bake on the one copies pixel for pixel onto the other', () => {
    const a = { scale: 78, ox: 100.25, oy: 4 };
    expect(sameGrid(a, { scale: 78, ox: -299.75, oy: 9 })).toBe(true);
    expect(sameGrid(a, { scale: 78, ox: 100.5, oy: 4 })).toBe(false);
    expect(sameGrid(a, { scale: 80, ox: 100.25, oy: 4 })).toBe(false);
  });

  it('moves a camera by less than half a pixel onto whole pixels, its zoom kept', () => {
    const exact = { x: 7.3123, y: 4.0456, scale: 78.095 };
    const snapped = snapCamera(exact, 1440, 820);
    expect(snapped.scale).toBe(exact.scale);
    expect(Math.abs((snapped.x - exact.x) * exact.scale)).toBeLessThanOrEqual(0.5);
    expect(Math.abs((snapped.y - exact.y) * exact.scale)).toBeLessThanOrEqual(0.5);
    const [px, py] = phaseOf(gridOf(snapped, 1440, 820));
    expect(Math.abs(px)).toBeLessThan(1e-9);
    expect(Math.abs(py)).toBeLessThan(1e-9);
  });
});

import { describe, expect, it } from 'vitest';
import {
  FLASH,
  FLASH_MS,
  flashAt,
  HIT_STOP_MS,
  holding,
  solvesAt,
} from '../src/world/hitStop.js';

describe('solvesAt — the solves a screen sees come in', () => {
  it('counts the stations done on its first frame, landing no impact for them', () => {
    expect(solvesAt(null, 2, 1000)).toEqual({ done: 2, at: null });
  });

  it('marks a solve when one more station stands done, and keeps it while none follows', () => {
    const first = solvesAt(null, 0, 1000);
    const solved = solvesAt(first, 1, 5000);
    expect(solved).toEqual({ done: 1, at: 5000 });
    expect(solvesAt(solved, 1, 5100)).toBe(solved);
    // A run started anew counts its stations again without an impact.
    expect(solvesAt(solved, 0, 6000)).toEqual({ done: 0, at: 5000 });
  });
});

describe('holding — the figures and the camera holding at a solve', () => {
  it('holds for HIT_STOP_MS from the solve, not before it and not after', () => {
    expect(HIT_STOP_MS).toBe(60);
    expect(holding(5000, 4999, false)).toBe(false);
    expect(holding(5000, 5000, false)).toBe(true);
    expect(holding(5000, 5000 + HIT_STOP_MS - 1, false)).toBe(true);
    expect(holding(5000, 5000 + HIT_STOP_MS, false)).toBe(false);
    expect(holding(null, 5000, false)).toBe(false);
  });

  it('never holds under reduced motion', () => {
    expect(holding(5000, 5010, true)).toBe(false);
  });
});

describe('flashAt — the white flash over the world at a solve', () => {
  it('comes at FLASH and fades out straight over FLASH_MS', () => {
    expect(flashAt(5000, 5000, false)).toBe(FLASH);
    expect(flashAt(5000, 5000 + FLASH_MS / 2, false)).toBeCloseTo(FLASH / 2, 12);
    expect(flashAt(5000, 5000 + FLASH_MS, false)).toBe(0);
    expect(flashAt(5000, 4990, false)).toBe(0);
    expect(FLASH).toBeLessThan(0.25);
  });

  it('lays nothing under reduced motion, nor without a solve', () => {
    expect(flashAt(5000, 5010, true)).toBe(0);
    expect(flashAt(null, 5010, false)).toBe(0);
  });
});

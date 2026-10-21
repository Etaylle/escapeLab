import { describe, expect, it } from 'vitest';
import {
  bakeVignette,
  BREATH_MS,
  vignetteBreath,
  vignetteShown,
} from '../src/world/vignette.js';

const NOW = 1_700_000_000_000;

describe('vignetteShown — when the red edge is up', () => {
  it('comes up in the clock’s last minute and not before', () => {
    expect(vignetteShown(NOW + 61_000, NOW, false, false)).toBe(false);
    expect(vignetteShown(NOW + 59_000, NOW, false, false)).toBe(true);
    expect(vignetteShown(NOW - 1_000, NOW, false, false)).toBe(true);
  });

  it('stays up all through the escape, however much time is left', () => {
    expect(vignetteShown(NOW + 300_000, NOW, true, false)).toBe(true);
  });

  it('never shows on a run without a clock, nor once the run’s end plays', () => {
    expect(vignetteShown(null, NOW, true, false)).toBe(false);
    expect(vignetteShown(NOW + 1_000, NOW, true, true)).toBe(false);
  });
});

describe('vignetteBreath — how strong the edge breathes', () => {
  it('starts full, sinks to 0.55 halfway through a breath and comes back full', () => {
    expect(vignetteBreath(0, false)).toBeCloseTo(1);
    expect(vignetteBreath(BREATH_MS / 2, false)).toBeCloseTo(0.55);
    expect(vignetteBreath(BREATH_MS, false)).toBeCloseTo(1);
    expect(vignetteBreath(3 * BREATH_MS + BREATH_MS / 2, false)).toBeCloseTo(0.55);
  });

  it('eases: falls steadily through the first half, rises through the second', () => {
    const steps = Array.from({ length: 11 }, (_, i) => vignetteBreath((i / 20) * BREATH_MS, false));
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]).toBeLessThan(steps[i - 1] ?? Infinity);
    }
    expect(vignetteBreath(BREATH_MS / 4, false)).toBeCloseTo(0.775);
    expect(vignetteBreath((3 * BREATH_MS) / 4, false)).toBeCloseTo(0.775);
  });

  it('holds still and full under reduced motion', () => {
    for (const ms of [0, BREATH_MS / 4, BREATH_MS / 2, 12_345]) {
      expect(vignetteBreath(ms, true)).toBe(1);
    }
  });
});

/** A canvas whose 2D context records what the bake does. */
function recordingCanvas(): {
  canvas: HTMLCanvasElement;
  rects: number[][];
  fills: unknown[];
  state: { shadowBlur: number; shadowColor: string; shadowOffsetX: number };
} {
  const rects: number[][] = [];
  const fills: unknown[] = [];
  const state = { shadowBlur: 0, shadowColor: '', shadowOffsetX: 0 };
  const g = Object.assign(state, {
    fillStyle: '',
    clearRect: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    beginPath: () => undefined,
    rect: (...args: number[]) => rects.push(args),
    fill: (rule: unknown) => fills.push(rule),
  });
  const canvas = { width: 0, height: 0, getContext: () => g } as unknown as HTMLCanvasElement;
  return { canvas, rects, fills, state };
}

describe('bakeVignette — the edge as CSS drew its inset shadow', () => {
  it('sizes the canvas and blurs as wide as the old shadow, in device pixels', () => {
    const { canvas, state } = recordingCanvas();
    bakeVignette(canvas, 2828, 1338, 2);
    expect([canvas.width, canvas.height]).toEqual([2828, 1338]);
    expect(state.shadowBlur).toBe(320);
    expect(state.shadowColor).toBe('rgba(248, 60, 60, 0.34)');
  });

  it('lets only the shadow fall on the canvas: a frame round it, solid to the spread', () => {
    const { canvas, rects, fills, state } = recordingCanvas();
    const [width, height] = [1414, 669];
    bakeVignette(canvas, width, height, 1);
    const [outer, inner] = rects;
    if (outer === undefined || inner === undefined) {
      throw new Error('the bake drew no frame');
    }
    expect(fills).toEqual(['evenodd']);
    // The shape itself lies wholly right of the canvas …
    expect(outer[0]).toBeGreaterThanOrEqual(width);
    // … and its shadow lands on it: the hole inset by the spread, the frame past every edge.
    const back = (x: number): number => x + state.shadowOffsetX;
    const [ox = 0, oy = 0, ow = 0, oh = 0] = outer;
    const [ix = 0, iy, iw, ih] = inner;
    expect([back(ix), iy, iw, ih]).toEqual([50, 50, width - 100, height - 100]);
    expect(back(ox)).toBeLessThanOrEqual(-state.shadowBlur);
    expect(back(ox + ow)).toBeGreaterThanOrEqual(width + state.shadowBlur);
    expect(oy).toBeLessThanOrEqual(-state.shadowBlur);
    expect(oy + oh).toBeGreaterThanOrEqual(height + state.shadowBlur);
  });

  it('keeps the hole from turning inside out on a canvas smaller than the spread', () => {
    const { canvas, rects } = recordingCanvas();
    bakeVignette(canvas, 60, 40, 1);
    expect(rects[1]?.slice(2)).toEqual([0, 0]);
  });

  it('says what is wrong where a canvas has no 2D context', () => {
    const canvas = { width: 0, height: 0, getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() => bakeVignette(canvas, 10, 10, 1)).toThrow(/getContext\("2d"\) returned null/);
  });
});

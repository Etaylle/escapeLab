import { describe, expect, it } from 'vitest';
import { backingSize } from '../src/world/render/backing.js';
import {
  clampCamera,
  TALL_CSS,
  TILE_CSS,
  TILES_HIGH,
  TILES_HIGH_SHORT,
  tileCss,
} from '../src/world/viewport.js';

/**
 * The audit's five screens (docs/foundation-audit.md, section 2): the world's canvas as each
 * window lays it out, CSS pixels, and the density the screen has.
 */
const SCREENS = [
  { name: '1440×820 @1', css: { w: 1416, h: 671 }, ratio: 1 },
  { name: '1440×820 @2', css: { w: 1416, h: 671 }, ratio: 2 },
  { name: '1280×720 @1', css: { w: 1256, h: 571 }, ratio: 1 },
  { name: '1280×720 @2', css: { w: 1256, h: 571 }, ratio: 2 },
  { name: 'phone 844×390 @3', css: { w: 828, h: 291 }, ratio: 3 },
] as const;

/** Blackout's lab, tiles. */
const LAB = { width: 27, height: 17 };

/** What a screen frames: device pixels a tile on its canvas, and the tiles across and down. */
function framed(css: { w: number; h: number }, ratio: number) {
  const { w, h, dpr } = backingSize(css.w, css.h, ratio);
  const scale = tileCss(h / dpr) * dpr;
  return { scale, w, h, dpr, across: w / scale, down: h / scale };
}

describe('tileCss — the camera’s frame in CSS pixels', () => {
  it('frames 11.5 tiles of height on a laptop’s canvas, 9 on a shorter one', () => {
    const expected: Record<string, { down: number; across: number }> = {
      '1440×820 @1': { down: 11.5, across: 24.27 },
      '1440×820 @2': { down: 11.5, across: 24.27 },
      '1280×720 @1': { down: 9, across: 19.8 },
      '1280×720 @2': { down: 9, across: 19.8 },
      'phone 844×390 @3': { down: 9, across: 25.61 },
    };
    for (const { name, css, ratio } of SCREENS) {
      const frame = framed(css, ratio);
      expect(frame.down, name).toBeCloseTo(expected[name]?.down ?? NaN, 2);
      expect(frame.across, name).toBeCloseTo(expected[name]?.across ?? NaN, 2);
    }
  });

  it('turns from the short count to the tall one where the canvas reaches TALL_CSS', () => {
    expect(TILES_HIGH).toBe(11.5);
    expect(TILES_HIGH_SHORT).toBe(9);
    expect(tileCss(TALL_CSS - 1)).toBeCloseTo((TALL_CSS - 1) / TILES_HIGH_SHORT, 9);
    expect(tileCss(TALL_CSS)).toBeCloseTo(TALL_CSS / TILES_HIGH, 9);
  });

  it('holds a tile within 28 and 96 CSS pixels however small or tall the canvas', () => {
    expect(TILE_CSS).toEqual({ min: 28, max: 96 });
    expect(tileCss(200)).toBe(28);
    expect(tileCss(0)).toBe(28);
    expect(tileCss(1500)).toBe(96);
    expect(tileCss(9 * 28)).toBeCloseTo(28, 9);
    expect(tileCss(11.5 * 96)).toBeCloseTo(96, 9);
  });

  it('frames the same tiles at every density: the backing store follows, not the frame', () => {
    for (const { name, css } of SCREENS) {
      const plain = framed(css, 1);
      // At 1.25 and 1.5 the backing rounds to whole pixels: a hundredth of a tile at most.
      for (const ratio of [1.25, 1.5, 2, 3]) {
        const dense = framed(css, ratio);
        expect(dense.across, `${name} at ${ratio}`).toBeCloseTo(plain.across, 1);
        expect(dense.down, `${name} at ${ratio}`).toBeCloseTo(plain.down, 1);
        // Crisp: as many device pixels a tile as CSS pixels times the density drawn at.
        expect(dense.scale / dense.dpr, `${name} at ${ratio}`).toBeCloseTo(tileCss(css.h), 1);
      }
    }
  });

  it('lets the camera follow and lead sideways on every screen: the lab is wider than the view', () => {
    for (const { name, css, ratio } of SCREENS) {
      const { scale, w, h, across } = framed(css, ratio);
      expect(across, name).toBeLessThan(LAB.width);
      const lens = { scale, w, h, top: 0, lift: 0 };
      const led = { x: LAB.width / 2 + 0.6, y: LAB.height / 2 };
      expect(clampCamera(LAB, led, lens).x, name).toBeCloseTo(led.x, 9);
      // Pinned at the lab's edge, as before: its west wall stays at the canvas's side.
      expect(clampCamera(LAB, { x: 1, y: led.y }, lens).x, name).toBeCloseTo(across / 2, 9);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { plateCaption, worldText, type TextStyle } from '../src/world/art.js';
import { ROOM_NAME_PX } from '../src/world/viewport.js';

/** How many CSS pixels high text `size` tiles high comes out at `tilePx` device pixels a tile. */
const cssPx = (style: TextStyle, tilePx: number, dpr: number): number =>
  (style.size * tilePx) / dpr;

/** The size a style's font names, in its own text space. */
const fontPx = (style: TextStyle): number => Number(/(\d+(?:\.\d+)?)px/.exec(style.font)?.[1]);

/** Zooms from a phone's smallest to a wide window's largest, device pixels a tile. */
const ZOOMS = [20, 40, 46, 60, 88, 120, 170, 340];

describe('worldText — how large the world’s labels and names come out', () => {
  it('follows an ordinary zoom: a fifth of a tile for a label, a name a bit more', () => {
    // 52 px a tile: a label 10.4 px high, a name 13.5 — both inside their ranges
    const text = worldText(52, 1);
    expect(text.label.size).toBeCloseTo(0.2);
    expect(text.name.size).toBeCloseTo(0.26);
  });

  it('holds labels to 10–12 CSS pixels and names to 11–14, at any zoom and density', () => {
    for (const tilePx of ZOOMS) {
      for (const dpr of [1, 2]) {
        const { label, name } = worldText(tilePx * dpr, dpr);
        expect(cssPx(label, tilePx * dpr, dpr)).toBeGreaterThanOrEqual(10 - 1e-9);
        expect(cssPx(label, tilePx * dpr, dpr)).toBeLessThanOrEqual(12 + 1e-9);
        expect(cssPx(name, tilePx * dpr, dpr)).toBeGreaterThanOrEqual(11 - 1e-9);
        expect(cssPx(name, tilePx * dpr, dpr)).toBeLessThanOrEqual(14 + 1e-9);
      }
    }
  });

  it('keeps every prop’s label below the room names', () => {
    for (const tilePx of ZOOMS) {
      expect(cssPx(worldText(tilePx, 1).label, tilePx, 1)).toBeLessThan(ROOM_NAME_PX);
    }
  });

  it('names a font of that size, with its halo grown or shrunk alongside', () => {
    const [small, large] = [worldText(20, 1), worldText(340, 1)];
    for (const pick of [(t: typeof small) => t.label, (t: typeof small) => t.name]) {
      expect(fontPx(pick(large)) / fontPx(pick(small))).toBeCloseTo(
        pick(large).size / pick(small).size,
      );
      expect(pick(large).halo / fontPx(pick(large))).toBeCloseTo(
        pick(small).halo / fontPx(pick(small)),
      );
    }
  });
});

describe('plateCaption — what a plate says it does', () => {
  it('names the door a plate holds open, and leaves the camera plate as it reads', () => {
    expect(plateCaption({ label: 'HALTEN', freezesDrone: false })).toBe('HALTEN · TÜR');
    expect(plateCaption({ label: 'KAMERA HALTEN', freezesDrone: true })).toBe('KAMERA HALTEN');
    // A label a mission wrote otherwise stays as written.
    expect(plateCaption({ label: 'SCHLEUSE', freezesDrone: false })).toBe('SCHLEUSE');
  });
});

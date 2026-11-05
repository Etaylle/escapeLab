import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { backingSize } from '../src/world/render/backing.js';
import {
  BAND_REACHES,
  clampCamera,
  DRONE_REACH,
  TALL_CSS,
  TILE_CSS,
  TILES_HIGH,
  TILES_HIGH_SHORT,
  tileCss,
  type Framing,
} from '../src/world/viewport.js';

/**
 * The audit's five screens (docs/foundation-audit.md, section 2): the box of the world's canvas
 * as each window lays it out, inside its 1-px border, CSS pixels; the density the screen has;
 * how far the objective bar reaches there with a line on the air — 129.3 px at a laptop's size,
 * 44 on a phone held sideways, whose bar and crew strip fold into one row a line adds nothing
 * to (screens/hudFold.ts), as measured in Blackout (insets.ts `bar`).
 */
const SCREENS = [
  { name: '1440×820 @1', css: { w: 1414, h: 669 }, ratio: 1, bar: 129.3, touch: false },
  { name: '1440×820 @2', css: { w: 1414, h: 669 }, ratio: 2, bar: 129.3, touch: false },
  { name: '1280×720 @1', css: { w: 1254, h: 569 }, ratio: 1, bar: 129.3, touch: false },
  { name: '1280×720 @2', css: { w: 1254, h: 569 }, ratio: 2, bar: 129.3, touch: false },
  { name: 'phone 844×390 @3', css: { w: 826, h: 345 }, ratio: 3, bar: 44, touch: true },
] as const;

/** Blackout's lab as its mission draws it: its rows of tiles, '.' its floor. */
const BLACKOUT_FILE = new URL('../../../missions/blackout.json', import.meta.url);
const BLACKOUT_TILES = (
  JSON.parse(readFileSync(BLACKOUT_FILE, 'utf8')) as { map: { tiles: string[] } }
).map.tiles;
/** Blackout's lab, tiles. */
const LAB = { width: BLACKOUT_TILES[0]?.length ?? 0, height: BLACKOUT_TILES.length };

/** A screen: its canvas, CSS pixels, its density, the bar with a line on the air, its input. */
interface Screen {
  css: { w: number; h: number };
  ratio: number;
  bar: number;
  touch: boolean;
}

/** What `screen` frames: device px a tile on its canvas, the tiles across, down, below the bar. */
function framed({ css, ratio, bar, touch }: Screen) {
  const { w, h, dpr } = backingSize(css.w, css.h, ratio);
  const px = tileCss({ height: h / dpr, bar, touch });
  const scale = px * dpr;
  return { scale, w, h, dpr, across: w / scale, down: h / scale, band: (css.h - bar) / px };
}

/** The frame of a canvas `height` CSS pixels tall under a bar `bar` deep, with keys or by touch. */
const tile = (height: number, bar = 0, touch = false): number => tileCss({ height, bar, touch });

describe('tileCss — the camera’s frame in CSS pixels', () => {
  it('frames the audit’s five screens: 11.5 tiles high on a laptop, 9 on a phone', () => {
    const expected: Record<string, { down: number; across: number }> = {
      '1440×820 @1': { down: 11.5, across: 24.31 },
      '1440×820 @2': { down: 11.5, across: 24.31 },
      // Under 600 px the band below the bar decides: 9 tiles of it, 11.65 in all.
      '1280×720 @1': { down: 11.65, across: 25.67 },
      '1280×720 @2': { down: 11.65, across: 25.67 },
      'phone 844×390 @3': { down: 9, across: 21.55 },
    };
    for (const screen of SCREENS) {
      const frame = framed(screen);
      expect(frame.down, screen.name).toBeCloseTo(expected[screen.name]?.down ?? NaN, 2);
      expect(frame.across, screen.name).toBeCloseTo(expected[screen.name]?.across ?? NaN, 2);
    }
  });

  it('turns from the short count to the tall one where the canvas reaches TALL_CSS', () => {
    expect(TILES_HIGH).toBe(11.5);
    expect(TILES_HIGH_SHORT).toBe(9);
    expect(tile(TALL_CSS - 1)).toBeCloseTo((TALL_CSS - 1) / TILES_HIGH_SHORT, 9);
    expect(tile(TALL_CSS)).toBeCloseTo(TALL_CSS / TILES_HIGH, 9);
  });

  it('holds a tile within 28 and 96 CSS pixels however small or tall the canvas', () => {
    expect(TILE_CSS).toEqual({ min: 28, max: 96 });
    expect(tile(200)).toBe(28);
    expect(tile(0)).toBe(28);
    expect(tile(1500)).toBe(96);
    expect(tile(9 * 28)).toBeCloseTo(28, 9);
    expect(tile(11.5 * 96)).toBeCloseTo(96, 9);
  });

  it('frames the same tiles at every density: the backing store follows, not the frame', () => {
    for (const screen of SCREENS) {
      const plain = framed({ ...screen, ratio: 1 });
      // At 1.25 and 1.5 the backing rounds to whole pixels: a hundredth of a tile at most.
      for (const ratio of [1.25, 1.5, 2, 3]) {
        const dense = framed({ ...screen, ratio });
        const at = `${screen.name} at ${ratio}`;
        expect(dense.across, at).toBeCloseTo(plain.across, 1);
        expect(dense.down, at).toBeCloseTo(plain.down, 1);
        // Crisp: as many device pixels a tile as CSS pixels times the density drawn at.
        const css: Framing = { height: screen.css.h, bar: screen.bar, touch: screen.touch };
        expect(dense.scale / dense.dpr, at).toBeCloseTo(tileCss(css), 1);
      }
    }
  });

  it('lets the camera follow and lead sideways on every screen: the lab is wider', () => {
    for (const screen of SCREENS) {
      const { scale, w, h, across } = framed(screen);
      expect(across, screen.name).toBeLessThan(LAB.width);
      const lens = { scale, w, h, top: 0, lift: 0 };
      const led = { x: LAB.width / 2 + 0.6, y: LAB.height / 2 };
      expect(clampCamera(LAB, led, lens).x, screen.name).toBeCloseTo(led.x, 9);
      // Pinned at the lab's edge, as before: its west wall stays at the canvas's side.
      const west = clampCamera(LAB, { x: 1, y: led.y }, lens).x;
      expect(west, screen.name).toBeCloseTo(across / 2, 9);
    }
  });
});

describe('the camera on Blackout’s lab, as each screen frames it', () => {
  /** The middle of every floor tile of the lab. */
  const floor = BLACKOUT_TILES.flatMap((row, y) =>
    [...row].flatMap((c, x) => (c === '.' ? [{ x: x + 0.5, y: y + 0.5 }] : [])),
  );

  it('travels ten tiles sideways at least on every screen, and up and down five', () => {
    for (const screen of SCREENS) {
      const { across, down } = framed(screen);
      expect(LAB.width - across, screen.name).toBeGreaterThanOrEqual(10);
      expect(LAB.height - down, screen.name).toBeGreaterThanOrEqual(5);
    }
  });

  it('stands held at a side wall on at most 70 % of the lab’s floor, the bar at rest', () => {
    // At rest the bar reaches 81 CSS px down on a laptop, 44 on the phone (insets.ts `bar`).
    const rest = { true: 44, false: 81 } as const;
    for (const screen of SCREENS) {
      const { scale, w, h, dpr } = framed(screen);
      const lens = { scale, w, h, top: rest[`${screen.touch}`] * dpr, lift: 0 };
      const pinned = floor.filter((at) => Math.abs(clampCamera(LAB, at, lens).x - at.x) > 1e-6);
      expect(pinned.length / floor.length, screen.name).toBeLessThanOrEqual(0.7);
    }
  });
});

describe('tileCss — the band below the objective bar', () => {
  it('keeps twice a drone’s reach below the bar with keys, one and a half by touch', () => {
    expect(DRONE_REACH).toBe(4.5);
    expect(BAND_REACHES).toEqual({ fine: 2, touch: 1.5 });
    for (const screen of SCREENS) {
      const least = DRONE_REACH * (screen.touch ? BAND_REACHES.touch : BAND_REACHES.fine);
      expect(framed(screen).band, screen.name).toBeGreaterThanOrEqual(least - 1e-9);
    }
  });

  it('lets the band win over the tile count, shrinking the tiles until it holds the reach', () => {
    // 1280×720: 9 tiles high would leave 6.95 below the bar; the band takes 9 of 48.86 px.
    expect(tile(569)).toBeCloseTo(569 / 9, 9);
    expect(tile(569, 129.3)).toBeCloseTo((569 - 129.3) / 9, 9);
    // A laptop's tall canvas keeps its 11.5 while the band holds the reach twice…
    expect(tile(669, 129.3)).toBeCloseTo(669 / 11.5, 9);
    // …and gives way where a taller bar would cut the band short.
    expect(tile(669, 200)).toBeCloseTo((669 - 200) / 9, 9);
  });

  it('holds 1.5 reaches by touch: its tile count stands while the HUD keeps a quarter', () => {
    expect(tile(289, 289 / 4, true)).toBeCloseTo(289 / 9, 9);
    expect(tile(289, 100, true)).toBeCloseTo((289 - 100) / 6.75, 9);
    // With keys the same canvas and bar have to hold the reach twice: smaller tiles.
    expect(tile(400, 100, true)).toBeCloseTo(400 / 9, 9);
    expect(tile(400, 100, false)).toBeCloseTo((400 - 100) / 9, 9);
  });

  it('keeps the 28-px floor where a canvas is too small for the band: a legible figure', () => {
    expect(tile(300, 100)).toBe(28);
    expect(tile(150, 100, true)).toBe(28);
  });

  it('measures against a drone of Blackout at the normal difficulty: none reaches further', () => {
    const blackout = JSON.parse(
      readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8'),
    ) as { map: { drones: { range?: number }[] } };
    const reaches = blackout.map.drones.map((drone) => drone.range ?? 4.5);
    expect(Math.max(...reaches)).toBe(DRONE_REACH);
  });
});

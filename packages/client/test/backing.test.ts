import { describe, expect, it } from 'vitest';
import { atlasLevel, newAtlas, sprite } from '../src/world/atlas.js';
import { backingSize, fitBacking, MAX_DENSITY } from '../src/world/render/backing.js';
import { fakeSprites } from './frames.js';

/** A canvas laid out `cssW` × `cssH`, counting how often its size is set. */
function boxed(cssW: number, cssH: number): { canvas: HTMLCanvasElement; sets: () => number } {
  let sets = 0;
  let width = 300;
  let height = 150;
  const canvas = {
    clientWidth: cssW,
    clientHeight: cssH,
    get width() {
      return width;
    },
    set width(value: number) {
      sets += 1;
      width = value;
    },
    get height() {
      return height;
    },
    set height(value: number) {
      sets += 1;
      height = value;
    },
  } as unknown as HTMLCanvasElement;
  return { canvas, sets: () => sets };
}

describe('backingSize — the canvas at the screen’s density', () => {
  it('takes the box’s CSS pixels times the density', () => {
    expect(backingSize(1400, 700, 1)).toEqual({ w: 1400, h: 700, dpr: 1 });
    expect(backingSize(1400, 700, 2)).toEqual({ w: 2800, h: 1400, dpr: 2 });
  });

  it('draws no denser than MAX_DENSITY, and at 1 where the screen names none', () => {
    expect(MAX_DENSITY).toBe(2);
    expect(backingSize(420, 760, 3)).toEqual({ w: 840, h: 1520, dpr: 2 });
    expect(backingSize(420, 760, 0)).toEqual({ w: 420, h: 760, dpr: 1 });
    expect(backingSize(420, 760, Number.NaN)).toEqual({ w: 420, h: 760, dpr: 1 });
  });

  it('rounds to whole pixels at a density of 1.25 or 1.5', () => {
    expect(backingSize(333, 201, 1.25)).toEqual({ w: 416, h: 251, dpr: 1.25 });
    expect(backingSize(1001, 667, 1.5)).toEqual({ w: 1502, h: 1001, dpr: 1.5 });
  });
});

describe('fitBacking — sizing the canvas only as its box or the density change', () => {
  it('sizes the canvas and the darkness’s overlay alike, then leaves both be', () => {
    const world = boxed(333, 201);
    const overlay = boxed(0, 0);
    expect(fitBacking(world.canvas, overlay.canvas, 1.25)).toBe(1.25);
    expect([world.canvas.width, world.canvas.height]).toEqual([416, 251]);
    expect([overlay.canvas.width, overlay.canvas.height]).toEqual([416, 251]);
    const [worldSets, overlaySets] = [world.sets(), overlay.sets()];
    for (let frame = 0; frame < 10; frame++) {
      fitBacking(world.canvas, overlay.canvas, 1.25);
    }
    // A canvas sized anew is cleared: a fractional density must not size it every frame.
    expect(world.sets()).toBe(worldSets);
    expect(overlay.sets()).toBe(overlaySets);
  });

  it('sizes them anew once the density changes, a window dragged to another screen', () => {
    const world = boxed(800, 600);
    const overlay = boxed(0, 0);
    fitBacking(world.canvas, overlay.canvas, 1);
    expect(fitBacking(world.canvas, overlay.canvas, 2)).toBe(2);
    expect([world.canvas.width, overlay.canvas.height]).toEqual([1600, 1200]);
  });
});

describe('the sprites at the screen’s density', () => {
  it('bakes at the device pixels a tile asks for: a denser screen, a finer level', () => {
    const tile = 88;
    expect(atlasLevel(tile * 2)).toBeGreaterThan(atlasLevel(tile));
    expect(atlasLevel(tile * 2)).toBeGreaterThanOrEqual(tile * 2 * 0.92);
  });

  it('keeps the sprites of two levels at most, whatever the zooms asked for', () => {
    const atlas = newAtlas(fakeSprites);
    for (const level of [48, 96, 192, 96, 48]) {
      sprite(atlas, level, { floor: 'plain', variant: 0, lit: false });
    }
    expect(atlas.levels.size).toBeLessThanOrEqual(2);
  });
});

import { describe, expect, it } from 'vitest';
import type { CanvasMaker } from '../src/world/atlas.js';
import {
  cutStops,
  drawRadial,
  radialSprite,
  radialSprites,
  SPRITE_LIMITS,
} from '../src/world/render/radial.js';
import { callsOf, fakeCanvas, setsOf, type Entry, type FakeGradient } from './fakeCanvas.js';

/** Sprites on fake canvases, each keeping what was drawn on it. */
function sprites(): { made: ReturnType<typeof radialSprites>; logs: Map<unknown, Entry[]> } {
  const logs = new Map<unknown, Entry[]>();
  const make: CanvasMaker = (width, height) => {
    const canvas = fakeCanvas(width, height, `sprite ${width}x${height}`);
    logs.set(canvas.canvas, canvas.log);
    return canvas.canvas;
  };
  return { made: radialSprites(make), logs };
}

const AMBER_GLOW = [
  [0, [251, 191, 36], 0.5],
  [1, [251, 191, 36], 0],
] as const;

/** The frame a sprite is used in: the cache tells frames apart by identity. */
const frame = {};

describe('radial — glows baked as sprites, copied at whole pixels', () => {
  it('bakes a gradient once for its stops and radius, centred in a square a pixel larger', () => {
    const { made, logs } = sprites();
    const sprite = radialSprite(made, AMBER_GLOW, 20.4, frame);
    expect(radialSprite(made, AMBER_GLOW, 20.4, frame)).toBe(sprite);
    expect([sprite.width, sprite.height]).toEqual([44, 44]);
    const log = logs.get(sprite) ?? [];
    const fill = setsOf(log, 'fillStyle')[0] as FakeGradient;
    expect(fill.args).toEqual([22, 22, 0, 22, 22, 20.4]);
    expect(fill.stops).toEqual([
      [0, 'rgba(251, 191, 36, 0.5)'],
      [1, 'rgba(251, 191, 36, 0)'],
    ]);
    expect(callsOf(log, 'fillRect')).toEqual([[0, 0, 44, 44]]);
    // Another radius, other stops: other sprites.
    expect(radialSprite(made, AMBER_GLOW, 21, frame)).not.toBe(sprite);
    expect(radialSprite(made, cutStops([[0, 1], [1, 0]]), 20.4, frame)).not.toBe(sprite);
  });

  it('copies a glow with its middle on the whole pixel nearest the point, unscaled', () => {
    const { made } = sprites();
    const { ctx, log } = fakeCanvas(800, 600);
    drawRadial(ctx, made, AMBER_GLOW, [150.4, 99.6, 20.4], frame);
    const sprite = radialSprite(made, AMBER_GLOW, 20.4, frame);
    expect(callsOf(log, 'drawImage')).toEqual([[sprite, 150 - 22, 100 - 22]]);
    drawRadial(ctx, made, AMBER_GLOW, [10, 10, 0], frame);
    expect(callsOf(log, 'drawImage')).toHaveLength(1);
  });

  it('lets sprites of earlier frames go past how many it keeps, freeing them', () => {
    const { made } = sprites();
    const first = radialSprite(made, AMBER_GLOW, 1, {});
    for (let r = 2; r < SPRITE_LIMITS.most + 24; r++) {
      radialSprite(made, AMBER_GLOW, r, {});
    }
    expect(made.baked.entries.size).toBe(SPRITE_LIMITS.most);
    expect([first.width, first.height]).toEqual([0, 0]);
    expect(radialSprite(made, AMBER_GLOW, 1, {})).not.toBe(first);
  });

  it('lets sprites of earlier frames go past the pixels it keeps', () => {
    const { made } = sprites();
    // About 1200 px a side, a frame each: four fit in the pixels kept, five do not.
    const first = radialSprite(made, AMBER_GLOW, 600, {});
    for (const r of [601, 602, 603]) {
      radialSprite(made, AMBER_GLOW, r, {});
    }
    expect(made.baked.entries.size).toBe(4);
    radialSprite(made, AMBER_GLOW, 604, {});
    expect(made.baked.entries.size).toBe(4);
    expect(made.baked.entries.has(`${JSON.stringify(AMBER_GLOW)}|600.00`)).toBe(false);
    expect([first.width, first.height]).toEqual([0, 0]);
  });

  it('keeps every sprite the last two frames used, though they pass the pixels it keeps', () => {
    const { made } = sprites();
    const radii = [600, 601, 602, 603, 604];
    const large = radii.map((r) => radialSprite(made, AMBER_GLOW, r, frame));
    const pixels = large.reduce((sum, sprite) => sum + sprite.width * sprite.height, 0);
    expect(pixels).toBeGreaterThan(SPRITE_LIMITS.pixels);
    radialSprite(made, AMBER_GLOW, 10, {});
    expect(made.baked.entries.size).toBe(6);
    expect(large.every((sprite) => sprite.width > 0)).toBe(true);
  });

  it('cuts darkness with black as deep as each stop says', () => {
    expect(cutStops([[0, 0.55], [0.45, 0.3], [1, 0]])).toEqual([
      [0, [0, 0, 0], 0.55],
      [0.45, [0, 0, 0], 0.3],
      [1, [0, 0, 0], 0],
    ]);
  });
});

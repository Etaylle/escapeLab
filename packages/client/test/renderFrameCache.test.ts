import { describe, expect, it } from 'vitest';
import { frameCache, keep, touch, type CacheLimits } from '../src/world/render/frameCache.js';
import { fakeCanvas } from './fakeCanvas.js';

/** A canvas of `side` × `side` px, standing in for a bake or a sprite. */
const square = (side: number): HTMLCanvasElement => fakeCanvas(side, side).canvas;

const itself = (canvas: HTMLCanvasElement): HTMLCanvasElement => canvas;

/** At most three entries, holding at most 100 × 100 px between them. */
const LIMITS: CacheLimits = { most: 3, pixels: 100 * 100 };

/** Each frame a fresh object: the cache tells frames apart by identity. */
const frames = (n: number): object[] => Array.from({ length: n }, () => ({}));

describe('frameCache — canvases kept between frames', () => {
  it('hands back what it keeps, the one used last at the end', () => {
    const cache = frameCache<HTMLCanvasElement>();
    const [first, second] = frames(2) as [object, object];
    const a = square(10);
    keep(cache, ['a', a], first, LIMITS, itself);
    keep(cache, ['b', square(10)], first, LIMITS, itself);
    expect(touch(cache, 'a', second)).toBe(a);
    expect(touch(cache, 'none', second)).toBeUndefined();
    expect([...cache.entries.keys()]).toEqual(['b', 'a']);
  });

  it('lets what earlier frames used go past how many it keeps, freeing the canvases', () => {
    const cache = frameCache<HTMLCanvasElement>();
    const canvases = [10, 10, 10, 10, 10].map(square);
    frames(5).forEach((frame, i) => keep(cache, [`c${i}`, canvases[i]!], frame, LIMITS, itself));
    expect([...cache.entries.keys()]).toEqual(['c2', 'c3', 'c4']);
    expect([canvases[0]?.width, canvases[0]?.height, canvases[1]?.width]).toEqual([0, 0, 0]);
    expect(canvases[2]?.width).toBe(10);
  });

  it('lets what earlier frames used go past the pixels it keeps', () => {
    const cache = frameCache<HTMLCanvasElement>();
    const [one, two, three] = frames(3) as [object, object, object];
    keep(cache, ['wide', square(80)], one, LIMITS, itself);
    keep(cache, ['mid', square(50)], two, LIMITS, itself);
    // 80² + 50² + 40² px pass 100² px: the one the last two frames did not use goes.
    keep(cache, ['small', square(40)], three, LIMITS, itself);
    expect([...cache.entries.keys()]).toEqual(['mid', 'small']);
  });

  it('keeps what the frame being drawn and the one before use, past the limits', () => {
    const cache = frameCache<HTMLCanvasElement>();
    const [one, two, three, four] = frames(4) as [object, object, object, object];
    // One frame's canvases alone pass the limits: none of them goes.
    for (const name of ['a', 'b', 'c', 'd']) {
      keep(cache, [name, square(60)], one, LIMITS, itself);
    }
    expect(cache.entries.size).toBe(4);
    // The next frame draws a new one before it uses those again: they stay all the same.
    keep(cache, ['e', square(10)], two, LIMITS, itself);
    expect(cache.entries.size).toBe(5);
    for (const name of ['a', 'b']) {
      touch(cache, name, two);
    }
    // A frame on, what neither of the last two frames used goes: c and d, used in the first.
    keep(cache, ['f', square(10)], three, LIMITS, itself);
    expect([...cache.entries.keys()]).toEqual(['e', 'a', 'b', 'f']);
    // And of those, the ones used longest ago first, only until the rest fits.
    keep(cache, ['g', square(10)], four, LIMITS, itself);
    expect([...cache.entries.keys()]).toEqual(['b', 'f', 'g']);
  });
});

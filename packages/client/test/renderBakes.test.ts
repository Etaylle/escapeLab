import { describe, expect, it } from 'vitest';
import type { Baked } from '../src/world/baked.js';
import { BAKE_LIMITS, bakedFor, layBake } from '../src/world/render/bakes.js';
import type { Frame } from '../src/world/render/frame.js';
import { callEntries, callsOf, fakeCanvas } from './fakeCanvas.js';
import { frameWith } from './frames.js';

const box = { x: 1, y: 1, w: 2, h: 2 };

/** Draws a square in tile space: what a bake holds. */
const square = (g: CanvasRenderingContext2D): void => g.fillRect(1, 1, 2, 2);

describe('bakes — the light’s bakes, kept by name and what they are of', () => {
  it('bakes once for one thing and grid, again for another thing, into the same canvas', () => {
    const frame = frameWith();
    const sight = { sight: 1 };
    const first = bakedFor(frame, { name: 'lamp', of: sight, box }, square);
    expect(first).not.toBeNull();
    expect(bakedFor(frame, { name: 'lamp', of: sight, box }, square)).toBe(first);
    const other = bakedFor(frame, { name: 'lamp', of: { sight: 2 }, box }, square);
    expect(other).not.toBe(first);
    expect(other?.canvas).toBe(first?.canvas);
    expect(bakedFor(frame, { name: 'none', of: sight, box: null }, square)).toBeNull();
  });

  it('bakes anew for another grid', () => {
    const frame = frameWith();
    const of = 'text';
    const first = bakedFor(frame, { name: 'room', of, box }, square);
    const zoomed = frameWith({ kit: frame.kit, camera: { x: 5, y: 3, scale: 80 } });
    const again = bakedFor(zoomed, { name: 'room', of, box }, square);
    expect(again).not.toBe(first);
    expect(again?.grid.scale).toBe(80);
    // The camera moved by whole pixels: the same grid, the same bake.
    const moved = frameWith({ kit: frame.kit, camera: { x: 6, y: 3, scale: 80 } });
    expect(bakedFor(moved, { name: 'room', of, box }, square)).toBe(again);
  });

  it('lets bakes of earlier frames go past how many it keeps, freeing their canvases', () => {
    const { kit } = frameWith();
    const first = bakedFor(frameWith({ kit }), { name: 'b0', of: 0, box }, square);
    for (let i = 1; i < BAKE_LIMITS.most + 40; i++) {
      bakedFor(frameWith({ kit }), { name: `b${i}`, of: i, box }, square);
    }
    expect(kit.bakes.entries.size).toBe(BAKE_LIMITS.most);
    expect(kit.bakes.entries.has('b0')).toBe(false);
    expect([first?.canvas.width, first?.canvas.height]).toEqual([0, 0]);
  });

  it('keeps the bakes the last two frames used, though they pass the pixels it keeps', () => {
    // 25 tiles at 100 px a tile: 2500 × 2500 px a bake, three past the pixels kept.
    const large = { x: 0, y: 0, w: 25, h: 25 };
    expect(3 * 2500 * 2500).toBeGreaterThan(BAKE_LIMITS.pixels);
    const { kit } = frameWith();
    const lay = (frame: Frame): (Baked | null)[] =>
      ['l0', 'l1', 'l2'].map((name) => bakedFor(frame, { name, of: name, box: large }, square));
    const first = lay(frameWith({ kit }));
    // A frame that bakes something new before it lays the large ones finds them all the same.
    const next = frameWith({ kit });
    bakedFor(next, { name: 'small', of: 0, box }, square);
    lay(next).forEach((baked, i) => expect(baked).toBe(first[i]));
    expect(first[0]?.canvas.width).toBe(2500);
    // Two frames without them, and the one used longest ago goes: the rest fits.
    bakedFor(frameWith({ kit }), { name: 'small', of: 1, box }, square);
    bakedFor(frameWith({ kit }), { name: 'small', of: 2, box }, square);
    expect([...kit.bakes.entries.keys()]).toEqual(['l1', 'l2', 'small']);
    expect(first[0]?.canvas.width).toBe(0);
  });

  it('lays a bake on at whole pixels while the grid holds still', () => {
    const frame = frameWith();
    const { ctx, log } = fakeCanvas(800, 600);
    layBake(ctx, frame, { name: 'sq', of: 1, box }, square);
    const baked = frame.kit.bakes.entries.get('sq')?.baked;
    // The box's corner (1, 1) at 100 px a tile; the world's origin at (-100, 0).
    expect(callsOf(log, 'drawImage')).toEqual([[baked?.canvas, -100 + 100, 0 + 100]]);
    expect(callsOf(log, 'fillRect')).toEqual([]);
  });

  it('draws straight in tile space while the grid moves, keeping no bake', () => {
    const frame: Frame = frameWith({ steady: false });
    const { ctx, log } = fakeCanvas(800, 600);
    layBake(ctx, frame, { name: 'sq', of: 1, box }, square);
    expect(frame.kit.bakes.entries.size).toBe(0);
    const fill = callEntries(log, 'fillRect');
    expect(fill.map((e) => e.args)).toEqual([[1, 1, 2, 2]]);
    expect(callsOf(log, 'setTransform')).toEqual([[100, 0, 0, 100, -100, 0]]);
    // Between a save and a restore: the context is as it was after.
    expect(fill[0]?.depth).toBe(1);
  });
});

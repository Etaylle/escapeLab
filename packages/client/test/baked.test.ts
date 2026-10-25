import { describe, expect, it } from 'vitest';
import { bake, bakeBox, bakeGrid, BAKE_MAX, drawBaked, type Baked } from '../src/world/baked.js';
import type { PixelGrid } from '../src/world/render/grid.js';

const map = { width: 19, height: 7 };

/** What a fake 2D context was asked to do, call by call, with the state it had then. */
type Call = { name: string; args: unknown[]; depth: number; transform: unknown[] };

/** A 2D context that records its calls, and a canvas handing it out. */
function fakeCanvas(width = 0, height = 0): {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  calls: Call[];
} {
  const calls: Call[] = [];
  const state = { depth: 0, transform: [1, 0, 0, 1, 0, 0] as unknown[], saved: [] as unknown[][] };
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push({ name, args, depth: state.depth, transform: state.transform });
    };
  const g = {
    save: () => {
      state.depth += 1;
      state.saved.push(state.transform);
    },
    restore: () => {
      state.depth -= 1;
      state.transform = state.saved.pop() ?? [1, 0, 0, 1, 0, 0];
    },
    setTransform: (...args: unknown[]) => {
      state.transform = args;
      record('setTransform')(...args);
    },
    clearRect: record('clearRect'),
    drawImage: record('drawImage'),
    fillRect: record('fillRect'),
  } as unknown as CanvasRenderingContext2D;
  const canvas = { width, height, getContext: () => g } as unknown as HTMLCanvasElement;
  return { canvas, g, calls };
}

/** A grid of `scale` px a tile, the world's origin at (ox, oy) on the canvas. */
const grid = (scale: number, ox = 0, oy = 0): PixelGrid => ({ scale, ox, oy });

describe('bakeBox — the part of the map a baked light covers', () => {
  it('takes whole tiles round every tile it is given', () => {
    const tiles = [
      { x: 3, y: 2 },
      { x: 7, y: 4 },
      { x: 5, y: 1 },
    ];
    expect(bakeBox(map, tiles, [])).toEqual({ x: 3, y: 1, w: 5, h: 4 });
  });

  it('grows to the whole tiles a round light reaches into, and no further than the map', () => {
    expect(bakeBox(map, [], [{ x: 10.5, y: 1.5, r: 3.2 }])).toEqual({ x: 7, y: 0, w: 7, h: 5 });
    expect(bakeBox(map, [{ x: 17, y: 5 }], [{ x: 10.5, y: 1.5, r: 3.2 }])).toEqual({
      x: 7,
      y: 0,
      w: 11,
      h: 6,
    });
  });

  it('is nothing for nothing to bake, or for a light wholly off the map', () => {
    expect(bakeBox(map, [], [])).toBeNull();
    expect(bakeBox(map, [], [{ x: -9, y: 3, r: 2 }])).toBeNull();
  });
});

describe('bakeGrid — the grid a light is baked on', () => {
  it('is the frame’s, and fewer whole pixels a tile for a box past BAKE_MAX', () => {
    const on = grid(78, 100.25, 3.5);
    expect(bakeGrid({ x: 0, y: 0, w: 19, h: 7 }, on)).toBe(on);
    const huge = bakeGrid({ x: 0, y: 0, w: 300, h: 40 }, on);
    expect(huge.scale * 300).toBeLessThanOrEqual(BAKE_MAX);
    expect(huge).toEqual({ scale: Math.floor(BAKE_MAX / 300), ox: 0, oy: 0 });
  });
});

describe('bake — a light drawn once into a canvas of its own, on the frame’s pixels', () => {
  const box = { x: 7, y: 1, w: 7, h: 4 };

  it('fits the canvas to the box at the grid’s scale and draws in tile space on its pixels', () => {
    const { canvas, g, calls } = fakeCanvas();
    const drawn: Call[] = [];
    // The origin a quarter of a pixel right of a whole one: tile 7 begins at 546.25.
    const on = grid(78, 100.25, 0);
    const baked = bake(
      box,
      on,
      (inside) => {
        expect(inside).toBe(g);
        drawn.push(...calls);
      },
      canvas,
    );
    expect(baked).toEqual({ canvas, box, grid: on, left: 546, top: 78 });
    expect([canvas.width, canvas.height]).toEqual([Math.ceil(14 * 78 + 0.25) - 546, 4 * 78]);
    const transform = drawn.filter((call) => call.name === 'setTransform').at(-1);
    expect(transform?.args).toEqual([78, 0, 0, 78, 0.25 - 546, -78]);
  });

  it('clears a canvas it is given before baking into it again, and keeps its size', () => {
    const { canvas, calls } = fakeCanvas(7 * 78, 4 * 78);
    bake(box, grid(78), () => undefined, canvas);
    expect(calls.find((call) => call.name === 'clearRect')?.args).toEqual([0, 0, 7 * 78, 4 * 78]);
    expect([canvas.width, canvas.height]).toEqual([7 * 78, 4 * 78]);
  });

  it('draws between a save and a restore, so the next bake starts afresh', () => {
    const { canvas, calls } = fakeCanvas();
    bake(box, grid(78), (inside) => inside.fillRect(0, 0, 1, 1), canvas);
    expect(calls.find((call) => call.name === 'fillRect')?.depth).toBe(1);
    bake(box, grid(78), () => undefined, canvas);
    expect(calls.filter((call) => call.name === 'clearRect').at(-1)?.depth).toBe(0);
  });

  it('says what is wrong where a canvas has no 2D context', () => {
    const canvas = { width: 0, height: 0, getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() => bake(box, grid(78), () => undefined, canvas)).toThrow(
      /getContext\("2d"\) returned null/,
    );
  });
});

describe('drawBaked — a baked light over the picture', () => {
  it('copies the bake at whole pixels where it was baked on the frame’s grid', () => {
    const { g, calls } = fakeCanvas();
    const on = grid(78, -120, 40);
    const canvas = fakeCanvas(546, 312).canvas;
    const baked: Baked = { canvas, box: { x: 7, y: 1, w: 7, h: 4 }, grid: on, left: 546, top: 78 };
    drawBaked(g, baked, { scale: 78, ox: -333, oy: 7 });
    const drawn = calls.filter((call) => call.name === 'drawImage');
    expect(drawn).toEqual([
      {
        name: 'drawImage',
        args: [canvas, -333 + 546, 7 + 78],
        depth: 1,
        transform: [1, 0, 0, 1, 0, 0],
      },
    ]);
    // The context is as it was: the copy happened between a save and a restore.
    expect(calls.at(-1)?.depth).toBe(1);
  });

  it('scales a bake to the frame’s grid where it was baked on fewer pixels', () => {
    const { g, calls } = fakeCanvas();
    const baked: Baked = {
      canvas: fakeCanvas(100, 100).canvas,
      box: { x: 0, y: 0, w: 300, h: 40 },
      grid: grid(13),
      left: 0,
      top: 0,
    };
    drawBaked(g, baked, grid(78, -50.5, 20));
    const drawn = calls.find((call) => call.name === 'drawImage');
    expect(drawn?.args).toEqual([baked.canvas, 0, 0]);
    expect(drawn?.transform).toEqual([6, 0, 0, 6, -50.5, 20]);
  });
});

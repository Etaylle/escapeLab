import { describe, expect, it } from 'vitest';
import {
  bake,
  bakeBox,
  bakeScale,
  bakeStep,
  BAKE_MAX,
  BAKE_PX,
  drawBaked,
  type Baked,
} from '../src/world/baked.js';

const map = { width: 19, height: 7 };

/** What a fake 2D context was asked to do, call by call, with the state it had then. */
type Call = { name: string; args: unknown[]; smooth: boolean; depth: number };

/** A 2D context that records its calls, and a canvas handing it out. */
function fakeCanvas(width = 0, height = 0): {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  calls: Call[];
} {
  const calls: Call[] = [];
  const state = { smooth: true, depth: 0 };
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push({ name, args, smooth: state.smooth, depth: state.depth });
    };
  const g = {
    get imageSmoothingEnabled() {
      return state.smooth;
    },
    set imageSmoothingEnabled(on: boolean) {
      state.smooth = on;
    },
    save: () => {
      state.depth += 1;
    },
    restore: () => {
      state.depth -= 1;
    },
    setTransform: record('setTransform'),
    clearRect: record('clearRect'),
    drawImage: record('drawImage'),
    fillRect: record('fillRect'),
  } as unknown as CanvasRenderingContext2D;
  const canvas = { width, height, getContext: () => g } as unknown as HTMLCanvasElement;
  return { canvas, g, calls };
}

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

describe('bakeScale — how fine a light is baked', () => {
  it('bakes BAKE_PX pixels a tile, and a huge box coarser, never past BAKE_MAX', () => {
    expect(bakeScale({ x: 0, y: 0, w: 19, h: 7 })).toBe(BAKE_PX);
    const huge = { x: 0, y: 0, w: 300, h: 40 };
    expect(bakeScale(huge) * huge.w).toBeLessThanOrEqual(BAKE_MAX);
    expect(bakeScale(huge)).toBeGreaterThan(0);
    expect(bakeScale({ x: 0, y: 0, w: 5000, h: 1 })).toBe(1);
  });
});

describe('bakeStep — the steps a changing light is baked in', () => {
  it('rounds to 32ths, ends included', () => {
    expect(bakeStep(0)).toBe(0);
    expect(bakeStep(1)).toBe(1);
    expect(bakeStep(0.51)).toBe(0.5);
    expect(bakeStep(0.3)).toBe(10 / 32);
    expect(bakeStep(0.004)).toBe(0);
  });
});

describe('bake — a light drawn once into a canvas of its own', () => {
  const box = { x: 7, y: 1, w: 7, h: 4 };

  it('sizes the canvas to the box, BAKE_PX a tile, and draws in tile space', () => {
    const { canvas, g, calls } = fakeCanvas();
    const drawn: Call[] = [];
    const baked = bake(box, (inside) => {
      expect(inside).toBe(g);
      drawn.push(...calls);
    }, canvas);
    expect(baked).toEqual({ canvas, box });
    expect([canvas.width, canvas.height]).toEqual([7 * BAKE_PX, 4 * BAKE_PX]);
    const transform = drawn.filter((call) => call.name === 'setTransform').at(-1);
    expect(transform?.args).toEqual([BAKE_PX, 0, 0, BAKE_PX, -7 * BAKE_PX, -1 * BAKE_PX]);
  });

  it('clears a canvas it is given before baking into it again, and keeps its size', () => {
    const { canvas, calls } = fakeCanvas(7 * BAKE_PX, 4 * BAKE_PX);
    bake(box, () => undefined, canvas);
    expect(calls.find((call) => call.name === 'clearRect')?.args).toEqual([
      0,
      0,
      7 * BAKE_PX,
      4 * BAKE_PX,
    ]);
    expect([canvas.width, canvas.height]).toEqual([7 * BAKE_PX, 4 * BAKE_PX]);
  });

  it('draws between a save and a restore, so the next bake starts afresh', () => {
    const { canvas, calls } = fakeCanvas();
    bake(box, (inside) => inside.fillRect(0, 0, 1, 1), canvas);
    expect(calls.find((call) => call.name === 'fillRect')?.depth).toBe(1);
    bake(box, () => undefined, canvas);
    expect(calls.filter((call) => call.name === 'clearRect').at(-1)?.depth).toBe(0);
  });

  it('says what is wrong where a canvas has no 2D context', () => {
    const canvas = { width: 0, height: 0, getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() => bake(box, () => undefined, canvas)).toThrow(/getContext\("2d"\) returned null/);
  });
});

describe('drawBaked — a baked light over the picture', () => {
  it('lays the whole canvas over its box in one draw, unsmoothed, and keeps the smoothing', () => {
    const { g, calls } = fakeCanvas();
    const baked: Baked = { canvas: fakeCanvas(224, 160).canvas, box: { x: 7, y: 0, w: 7, h: 5 } };
    drawBaked(g, baked);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      name: 'drawImage',
      args: [baked.canvas, 7, 0, 7, 5],
      smooth: false,
    });
    expect(g.imageSmoothingEnabled).toBe(true);
  });
});

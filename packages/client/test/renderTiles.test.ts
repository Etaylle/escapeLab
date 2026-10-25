import { describe, expect, it } from 'vitest';
import { artKit } from '../src/world/artKit.js';
import type { Atlas, CanvasMaker } from '../src/world/atlas.js';
import type { Frame } from '../src/world/render/frame.js';
import { gridOf } from '../src/world/render/grid.js';
import { draw } from '../src/world/render/tiles.js';
import { cacheGrid, MAX_AREA, MAX_SIDE } from '../src/world/tileCache.js';
import { callEntries, callsOf, fakeCanvas, strip, type Entry } from './fakeCanvas.js';
import { mapWith } from './fixtures.js';
import { frameWith, kitWith, lightWith, TILES } from './frames.js';

/** A frame whose canvases each keep what was drawn on them, found by the canvas. */
function recorded(parts: Partial<Frame> = {}): { frame: Frame; logs: Map<unknown, Entry[]> } {
  const logs = new Map<unknown, Entry[]>();
  const make: CanvasMaker = (width, height) => {
    const made = fakeCanvas(width, height, `canvas ${width}x${height}`);
    logs.set(made.canvas, made.log);
    return made.canvas;
  };
  const kit = { ...kitWith(), art: artKit(make) };
  return { frame: frameWith({ kit, ...parts }), logs };
}

/** What was drawn on the frame's baked map so far. */
function cacheLog(frame: Frame, logs: Map<unknown, Entry[]>): Entry[] {
  const cache = frame.kit.art.tiles;
  if (cache === null) {
    throw new Error('the frame has no baked map');
  }
  return logs.get(cache.canvas) ?? [];
}

/** Which sprite of the atlas each canvas is, by its key. */
function keysOf(atlas: Atlas): Map<unknown, string> {
  const keys = new Map<unknown, string>();
  for (const sprites of atlas.levels.values()) {
    for (const [key, sprite] of sprites) {
      keys.set(sprite.canvas, key);
    }
  }
  return keys;
}

type Baked = Map<string, { key: string; tall: number }>;

/** The sprites baked into the map, by tile (tile space): `x,y` → its atlas key and height. */
function bakedByTile(frame: Frame, log: readonly Entry[]): Baked {
  const keys = keysOf(frame.kit.art.atlas);
  const baked: Baked = new Map();
  for (const [canvas, x, y, , tall] of callsOf(log, 'drawImage')) {
    baked.set(`${String(x)},${String(y)}`, { key: keys.get(canvas) ?? '?', tall: Number(tall) });
  }
  return baked;
}

/** The floor and wall sprites baked, by tile, the furniture left out. */
function surfaces(baked: Baked): Baked {
  return new Map([...baked].filter(([, { key }]) => !key.startsWith('decor:')));
}

/** The sprites drawn in `log`, by atlas key, with the tile each went on. */
function drawnKeys(frame: Frame, log: readonly Entry[]): [string, number, number][] {
  const keys = keysOf(frame.kit.art.atlas);
  return callsOf(log, 'drawImage').map(([canvas, x, y]) => [
    keys.get(canvas) ?? '?',
    Number(x),
    Number(y),
  ]);
}

/** How many sprites the atlas holds over all its levels. */
const bakedCount = (atlas: Atlas): number =>
  [...atlas.levels.values()].reduce((n, level) => n + level.size, 0);

/** The 10×6 lab 20 tiles wider, all floor beyond its east wall. */
const wide = (): ReturnType<typeof mapWith> =>
  mapWith({ width: 30, height: 6, tiles: TILES.map((row) => row + '.'.repeat(20)) });

describe('tiles — the void, then the map baked whole, copied in one go', () => {
  it('covers the canvas in the black of the void, then draws in tiles as the camera looks', () => {
    const { ctx, log } = fakeCanvas(800, 600);
    draw(ctx, frameWith({ camera: { x: 5, y: 3, scale: 100 } }));
    expect(strip(log.slice(0, 4))).toEqual([
      ['setTransform', [1, 0, 0, 1, 0, 0]],
      ['fillStyle=', '#04070a'],
      ['fillRect', [0, 0, 800, 600]],
      ['setTransform', [100, 0, 0, 100, 400 - 500, 300 - 300]],
    ]);
  });

  it('copies what the camera shows of the baked map at whole pixels, a tile’s margin kept', () => {
    const { frame } = recorded({ map: wide(), camera: { x: 5, y: 3, scale: 100 } });
    const { ctx, log } = fakeCanvas(800, 600);
    draw(ctx, frame);
    // 800 px at 100 a tile over x = 5: tiles 1 to 9 in view, 0 and 10 the margin; all six rows.
    const copy = callEntries(log, 'drawImage');
    expect(copy.map((e) => e.args)).toEqual([
      [frame.kit.art.tiles?.canvas, 0, 0, 1100, 600, 0, 0, 1100, 600],
    ]);
    // The world's origin lies at (-100, 0) on the canvas: the copy is put there, unscaled.
    const at = log.findIndex((e) => e.kind === 'call' && e.name === 'drawImage');
    const moves = strip(log.slice(0, at)).filter((e) => (e as unknown[])[0] === 'setTransform');
    expect(moves.at(-1)).toEqual(['setTransform', [1, 0, 0, 1, -100, 0]]);
    expect(frame.kit.art.tiles?.canvas.width).toBe(30 * 100);
    expect(frame.kit.art.tiles?.canvas.height).toBe(6 * 100);
  });

  it('bakes each floor and wall tile once, in tile space at the frame’s scale, no void', () => {
    const tiles = [...TILES];
    tiles[1] = '#... #...#';
    const { frame, logs } = recorded({ map: mapWith({ width: 10, height: 6, tiles }) });
    draw(fakeCanvas(800, 600).ctx, frame);
    const log = cacheLog(frame, logs);
    const baked = surfaces(bakedByTile(frame, log));
    expect(baked.size).toBe(59);
    expect(callsOf(log, 'drawImage')).toHaveLength(59);
    expect(baked.has('4,1')).toBe(false);
    expect(baked.get('1,1')?.key).toMatch(/^floor:plain:/);
    expect(baked.get('0,0')?.key).toMatch(/^wall:plain:/);
    expect(callsOf(log, 'setTransform').at(-1)).toEqual([100, 0, 0, 100, 0, 0]);
    // The sprites come from the atlas's level for 100 px a tile: 96.
    expect([...frame.kit.art.atlas.levels.keys()]).toEqual([96]);
  });

  it('bakes the floors first and the walls over them, a wall with a face two tiles tall', () => {
    const { frame, logs } = recorded();
    draw(fakeCanvas(800, 600).ctx, frame);
    const log = cacheLog(frame, logs);
    const order = drawnKeys(frame, log).map(([key]) => key);
    const floors = order.flatMap((key, i) => (key.startsWith('floor:') ? [i] : []));
    expect(Math.max(...floors)).toBeLessThan(order.findIndex((key) => key.startsWith('wall:')));
    // The wall at (2,0) looks down on the floor at (2,1): its face, and its shadow below it.
    const baked = bakedByTile(frame, log);
    expect(baked.get('2,0')).toEqual({ key: 'wall:plain:4:dark:dark', tall: 2 });
    // The wall at (0,2) has floor only east of it: a crown, a tile tall.
    expect(baked.get('0,2')).toEqual({ key: 'wall:plain:2:dark:dark', tall: 1 });
  });

  it('bakes a tile in the colours of the power on where the light says, and in a lit room', () => {
    const light = lightWith({ powered: (x, y) => x === 1 && y === 1 });
    const { frame, logs } = recorded({ light, litTiles: new Set(['7,2', '7,0', '8,1']) });
    draw(fakeCanvas(800, 600).ctx, frame);
    const baked = bakedByTile(frame, cacheLog(frame, logs));
    expect(baked.get('1,1')?.key).toMatch(/:lit$/);
    expect(baked.get('7,2')?.key).toMatch(/:lit$/);
    expect(baked.get('2,1')?.key).toMatch(/:dark$/);
    // A wall's crown takes its own light, its face the light of the floor it looks down on.
    expect(baked.get('7,0')?.key).toBe('wall:plain:4:lit:dark');
    expect(baked.get('8,0')?.key).toBe('wall:plain:4:dark:lit');
  });

  it('dresses each room after its label’s kind', () => {
    const labels = [
      { text: 'ARCHIV', x: 2, y: 2, kind: 'archive' as const },
      { text: 'REAKTOR', x: 7, y: 2, kind: 'reactor' as const },
    ];
    // The doorway at (5,2) is a door: each room keeps its floor.
    const doors = [{ id: 'tuer', x: 5, y: 2, open: true }];
    const map = mapWith({ width: 10, height: 6, tiles: TILES, labels, doors });
    const { frame, logs } = recorded({ map });
    draw(fakeCanvas(800, 600).ctx, frame);
    const baked = bakedByTile(frame, cacheLog(frame, logs));
    expect(baked.get('2,3')?.key).toMatch(/^floor:archive:/);
    expect(baked.get('7,3')?.key).toMatch(/^floor:reactor:/);
    expect(baked.get('2,0')?.key).toMatch(/^wall:archive:/);
  });

  it('bakes the wall props into the walls that look down on a floor, never onto a floor', () => {
    const { frame, logs } = recorded();
    draw(fakeCanvas(800, 600).ctx, frame);
    const hung = [...bakedByTile(frame, cacheLog(frame, logs))].filter(([, { key }]) =>
      /^wall:[a-z]+:\d+:(lit|dark):(lit|dark):[a-z]+\d$/.test(key),
    );
    expect(hung.length).toBeGreaterThan(0);
    for (const [tile] of hung) {
      const [x = 0, y = 0] = tile.split(',').map(Number);
      expect(TILES[y]?.charAt(x)).toBe('#');
      expect(TILES[y + 1]?.charAt(x)).toBe('.');
    }
    const { dressing } = frame.kit.art.dressed?.dressed ?? { dressing: null };
    expect(hung).toHaveLength(dressing?.props.length ?? -1);
  });

  it('bakes the furniture light has fallen on over its floor, lit where its tile is', () => {
    const decor = [
      { kind: 'shelf' as const, x: 1, y: 1, variant: 2 },
      { kind: 'barrel' as const, x: 7, y: 3 },
    ];
    const light = lightWith({ shown: (x) => x < 5, powered: (x, y) => x === 1 && y === 1 });
    const map = mapWith({ width: 10, height: 6, tiles: TILES, decor });
    const { frame, logs } = recorded({ map, light });
    draw(fakeCanvas(800, 600).ctx, frame);
    const drawn = drawnKeys(frame, cacheLog(frame, logs));
    expect(drawn.filter(([key]) => key.startsWith('decor'))).toEqual([['decor:shelf:2:lit', 1, 1]]);
    // Last: over its floor, and over the shadow the wall above casts on it.
    expect(drawn.at(-1)).toEqual(['decor:shelf:2:lit', 1, 1]);
  });

  it('bakes nothing again while nothing changes: the next frame only copies', () => {
    const { frame, logs } = recorded();
    draw(fakeCanvas(800, 600).ctx, frame);
    const baked = bakedCount(frame.kit.art.atlas);
    const drawn = cacheLog(frame, logs).length;
    const { ctx, log } = fakeCanvas(800, 600);
    draw(ctx, frame);
    expect(baked).toBeGreaterThan(0);
    expect(bakedCount(frame.kit.art.atlas)).toBe(baked);
    expect(cacheLog(frame, logs)).toHaveLength(drawn);
    expect(callsOf(log, 'drawImage')).toHaveLength(1);
  });

  it('bakes a tile again whose light changed, and the wall above it, in whole pixels', () => {
    const { frame, logs } = recorded();
    draw(fakeCanvas(800, 600).ctx, frame);
    const before = cacheLog(frame, logs).length;
    // The floor at (2,1) lights up: the wall at (2,0) looks down on it, its face and shadow too.
    draw(fakeCanvas(800, 600).ctx, { ...frame, litTiles: new Set(['2,1']) });
    const log = cacheLog(frame, logs).slice(before);
    // Their pixels — the wall's two tiles tall — and one more all round, cleared and clipped to.
    expect(callsOf(log, 'rect')).toEqual([[199, 0, 102, 301]]);
    expect(callsOf(log, 'clearRect')).toEqual([[199, 0, 102, 301]]);
    const drawn = drawnKeys(frame, log);
    expect(drawn).toContainEqual([expect.stringMatching(/^floor:plain:\d+:lit$/), 2, 1]);
    expect(drawn).toContainEqual(['wall:plain:4:dark:lit', 2, 0]);
    // Only the tiles whose sprites reach the box are drawn again, not the whole map.
    expect(drawn.every(([, x, y]) => x <= 4 && y <= 4)).toBe(true);
    // Once baked, the next frame bakes nothing.
    const after = cacheLog(frame, logs).length;
    draw(fakeCanvas(800, 600).ctx, { ...frame, litTiles: new Set(['2,1']) });
    expect(cacheLog(frame, logs)).toHaveLength(after);
  });

  it('bakes furniture coming into sight over its floor, and its floor anew as it goes', () => {
    const decor = [{ kind: 'shelf' as const, x: 1, y: 1, variant: 2 }];
    const map = mapWith({ width: 10, height: 6, tiles: TILES, decor });
    const unseen = lightWith({ shown: () => false });
    const { frame, logs } = recorded({ map, light: unseen });
    draw(fakeCanvas(800, 600).ctx, frame);
    const first = cacheLog(frame, logs).length;
    draw(fakeCanvas(800, 600).ctx, { ...frame, light: lightWith() });
    const seen = drawnKeys(frame, cacheLog(frame, logs).slice(first));
    expect(seen.at(-1)).toEqual(['decor:shelf:2:dark', 1, 1]);
    // A new run: nothing seen yet — the box baked anew without it.
    const second = cacheLog(frame, logs).length;
    draw(fakeCanvas(800, 600).ctx, { ...frame, light: unseen });
    const gone = drawnKeys(frame, cacheLog(frame, logs).slice(second));
    expect(gone.length).toBeGreaterThan(0);
    expect(gone.some(([key]) => key.startsWith('decor'))).toBe(false);
  });

  it('looks at the tiles in view only: one out of view is baked anew as it comes into view', () => {
    const { frame, logs } = recorded({ map: wide(), camera: { x: 5, y: 3, scale: 100 } });
    draw(fakeCanvas(800, 600).ctx, frame);
    const before = cacheLog(frame, logs).length;
    const lit = { ...frame, litTiles: new Set(['20,2']) };
    draw(fakeCanvas(800, 600).ctx, lit);
    expect(cacheLog(frame, logs)).toHaveLength(before);
    draw(fakeCanvas(800, 600).ctx, { ...lit, camera: { x: 20, y: 3, scale: 100 } });
    const drawn = drawnKeys(frame, cacheLog(frame, logs).slice(before));
    expect(drawn).toContainEqual([expect.stringMatching(/^floor:plain:\d+:lit$/), 20, 2]);
  });

  it('bakes the tiles in view anew while the zoom moves, the whole map once it holds still', () => {
    const { frame, logs } = recorded({ map: wide(), camera: { x: 5, y: 3, scale: 100 } });
    draw(fakeCanvas(800, 600).ctx, frame);
    expect(frame.kit.art.tiles?.whole).toBe(true);
    const camera = { x: 5, y: 3, scale: 80 };
    const moving = { ...frame, camera, steady: false, grid: gridOf(camera, 800, 600) };
    const before = cacheLog(frame, logs).length;
    draw(fakeCanvas(800, 600).ctx, moving);
    const zoomed = frame.kit.art.tiles;
    expect(zoomed?.grid.scale).toBe(80);
    expect(zoomed?.whole).toBe(false);
    // 800 px at 80 a tile over x = 5: columns 0 to 11 with the margin, and the one whose edge
    // reaches their last pixel — not all 30.
    const partial = drawnKeys(frame, cacheLog(frame, logs).slice(before));
    expect(Math.max(...partial.map(([, x]) => x))).toBe(12);
    draw(fakeCanvas(800, 600).ctx, { ...moving, steady: true });
    expect(frame.kit.art.tiles?.whole).toBe(true);
    const tiles = TILES.map((row) => row.replace('#....#', '#.....'));
    const map = mapWith({ width: 10, height: 6, tiles });
    draw(fakeCanvas(800, 600).ctx, { ...moving, steady: true, map });
    expect(frame.kit.art.tiles?.dressed).not.toBe(zoomed?.dressed);
  });

  it('bakes a very large map on a very dense screen at fewer whole pixels a tile', () => {
    const on = { scale: 170, ox: 12.5, oy: 3 };
    expect(cacheGrid(27, 17, on)).toBe(on);
    // 60 × 40 tiles at 170 px would pass MAX_SIDE and MAX_AREA: fewer whole pixels a tile hold it.
    const big = cacheGrid(60, 40, on);
    expect(big.scale).toBeLessThan(170);
    expect(Math.max(60, 40) * big.scale).toBeLessThanOrEqual(MAX_SIDE);
    expect(60 * 40 * big.scale * big.scale).toBeLessThanOrEqual(MAX_AREA);
    expect([big.ox, big.oy]).toEqual([0, 0]);
  });
});

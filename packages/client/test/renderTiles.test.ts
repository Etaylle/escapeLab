import { describe, expect, it } from 'vitest';
import type { Atlas } from '../src/world/atlas.js';
import type { Frame } from '../src/world/render/frame.js';
import { draw } from '../src/world/render/tiles.js';
import { callsOf, fakeCanvas, strip, type Entry } from './fakeCanvas.js';
import { mapWith } from './fixtures.js';
import { frameWith, lightWith, TILES } from './frames.js';

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

type Drawn = Map<string, { key: string; tall: unknown }>;

/** The floor and wall sprites drawn, by tile: `x,y` → its atlas key, with its height. */
function spritesByTile(frame: Frame, log: readonly Entry[]): Drawn {
  const keys = keysOf(frame.kit.art.atlas);
  const drawn: Drawn = new Map();
  for (const [canvas, x, y, , tall] of callsOf(log, 'drawImage')) {
    const key = keys.get(canvas) ?? '?';
    if (key.startsWith('floor:') || key.startsWith('wall:')) {
      drawn.set(`${String(x)},${String(y)}`, { key, tall });
    }
  }
  return drawn;
}

/** How many sprites the atlas holds over all its levels. */
const bakedCount = (atlas: Atlas): number =>
  [...atlas.levels.values()].reduce((n, level) => n + level.size, 0);

describe('tiles — the void, then the dressed floor and walls from the atlas', () => {
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

  it('draws every floor and wall tile once, a tile wide, and nothing for the void', () => {
    const tiles = [...TILES];
    tiles[1] = '#... #...#';
    const frame = frameWith({ map: mapWith({ width: 10, height: 6, tiles }) });
    const { ctx, log } = fakeCanvas(800, 600);
    draw(ctx, frame);
    const drawn = spritesByTile(frame, log);
    expect(drawn.size).toBe(59);
    expect(drawn.has('4,1')).toBe(false);
    expect(drawn.get('1,1')?.key).toMatch(/^floor:plain:/);
    expect(drawn.get('0,0')?.key).toMatch(/^wall:plain:/);
    expect(callsOf(log, 'drawImage').every(([, , , w]) => w === 1)).toBe(true);
  });

  it('draws the floors first and the walls over them, a wall with a face two tiles tall', () => {
    const frame = frameWith();
    const { ctx, log } = fakeCanvas(800, 600);
    draw(ctx, frame);
    const keys = keysOf(frame.kit.art.atlas);
    const order = callsOf(log, 'drawImage').map(([canvas]) => keys.get(canvas) ?? '?');
    const floors = order.flatMap((key, i) => (key.startsWith('floor:') ? [i] : []));
    const lastFloor = Math.max(...floors);
    const firstWall = order.findIndex((key) => key.startsWith('wall:'));
    expect(lastFloor).toBeLessThan(firstWall);
    // The wall at (2,0) looks down on the floor at (2,1): its face, and its shadow below it.
    const drawn = spritesByTile(frame, log);
    expect(drawn.get('2,0')).toEqual({ key: 'wall:plain:4:dark:dark', tall: 2 });
    // The wall at (0,2) has floor only east of it: a crown, a tile tall.
    expect(drawn.get('0,2')).toEqual({ key: 'wall:plain:2:dark:dark', tall: 1 });
  });

  it('draws a tile in the colours of the power on where the light says, and in a lit room', () => {
    const light = lightWith({ powered: (x, y) => x === 1 && y === 1 });
    const frame = frameWith({ light, litTiles: new Set(['7,2', '7,0', '8,1']) });
    const { ctx, log } = fakeCanvas(800, 600);
    draw(ctx, frame);
    const drawn = spritesByTile(frame, log);
    expect(drawn.get('1,1')?.key).toMatch(/:lit$/);
    expect(drawn.get('7,2')?.key).toMatch(/:lit$/);
    expect(drawn.get('2,1')?.key).toMatch(/:dark$/);
    // A wall's crown takes its own light, its face the light of the floor it looks down on.
    expect(drawn.get('7,0')?.key).toBe('wall:plain:4:lit:dark');
    expect(drawn.get('8,0')?.key).toBe('wall:plain:4:dark:lit');
  });

  it('dresses each room after its label’s kind', () => {
    const labels = [
      { text: 'ARCHIV', x: 2, y: 2, kind: 'archive' as const },
      { text: 'REAKTOR', x: 7, y: 2, kind: 'reactor' as const },
    ];
    // The doorway at (5,2) is a door: each room keeps its floor.
    const doors = [{ id: 'tuer', x: 5, y: 2, open: true }];
    const map = mapWith({ width: 10, height: 6, tiles: TILES, labels, doors });
    const frame = frameWith({ map });
    const { ctx, log } = fakeCanvas(800, 600);
    draw(ctx, frame);
    const drawn = spritesByTile(frame, log);
    expect(drawn.get('2,3')?.key).toMatch(/^floor:archive:/);
    expect(drawn.get('7,3')?.key).toMatch(/^floor:reactor:/);
    expect(drawn.get('2,0')?.key).toMatch(/^wall:archive:/);
  });

  it('leaves out the tiles beyond the camera’s view, a tile’s margin kept', () => {
    const tiles = TILES.map((row) => row + '.'.repeat(20));
    const map = mapWith({ width: 30, height: 6, tiles });
    const frame = frameWith({ map, camera: { x: 5, y: 3, scale: 100 } });
    const { ctx, log } = fakeCanvas(800, 600);
    // 800 px at 100 a tile over x = 5: tiles 1 to 9 in view, 0 and 10 the margin.
    draw(ctx, frame);
    const columns = [...spritesByTile(frame, log).keys()].map((key) => Number(key.split(',')[0]));
    expect(Math.min(...columns)).toBe(0);
    expect(Math.max(...columns)).toBe(10);
  });

  it('bakes the wall props into the walls that look down on a floor, never onto a floor', () => {
    const frame = frameWith();
    const { ctx, log } = fakeCanvas(800, 600);
    draw(ctx, frame);
    const hung = [...spritesByTile(frame, log)].filter(([, { key }]) =>
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

  it('bakes every sprite once for its zoom level: the next frame bakes none', () => {
    const frame = frameWith();
    draw(fakeCanvas(800, 600).ctx, frame);
    const baked = bakedCount(frame.kit.art.atlas);
    draw(fakeCanvas(800, 600).ctx, frame);
    expect(baked).toBeGreaterThan(0);
    expect(bakedCount(frame.kit.art.atlas)).toBe(baked);
    // 100 device pixels a tile draw from the 96 px level, a hair smaller.
    expect([...frame.kit.art.atlas.levels.keys()]).toEqual([96]);
  });
});

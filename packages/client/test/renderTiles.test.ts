import { describe, expect, it } from 'vitest';
import { draw } from '../src/world/render/tiles.js';
import { callsOf, fakeCanvas, strip } from './fakeCanvas.js';
import { frameWith, lightWith, TILES } from './frames.js';
import { mapWith } from './fixtures.js';

/** The texture names drawn, by tile: `x,y` → the fake canvas's name. */
function texturesByTile(log: ReturnType<typeof fakeCanvas>['log']): Map<string, string> {
  return new Map(
    callsOf(log, 'drawImage').map(([texture, x, y]) => [
      `${String(x)},${String(y)}`,
      (texture as { name: string }).name,
    ]),
  );
}

describe('tiles — the void, then the floor and the walls', () => {
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

  it('draws every floor and wall tile once, a tile big, and nothing for the void', () => {
    const tiles = [...TILES];
    tiles[1] = '#... #...#';
    const { ctx, log } = fakeCanvas(800, 600);
    draw(ctx, frameWith({ map: mapWith({ width: 10, height: 6, tiles }) }));
    const drawn = texturesByTile(log);
    expect(drawn.size).toBe(59);
    expect(drawn.has('4,1')).toBe(false);
    expect(drawn.get('0,0')).toBe('wall');
    expect(drawn.get('1,1')).toBe('floor');
    expect(callsOf(log, 'drawImage').every(([, , , w, h]) => w === 1 && h === 1)).toBe(true);
  });

  it('draws a tile in the colours of the power on where the light says, and in a lit room', () => {
    const light = lightWith({ powered: (x, y) => x === 1 && y === 1 });
    const { ctx, log } = fakeCanvas(800, 600);
    draw(ctx, frameWith({ light, litTiles: new Set(['7,2', '5,0']) }));
    const drawn = texturesByTile(log);
    expect(drawn.get('1,1')).toBe('floorLit');
    expect(drawn.get('7,2')).toBe('floorLit');
    expect(drawn.get('5,0')).toBe('wallLit');
    expect(drawn.get('2,1')).toBe('floor');
    expect(drawn.get('0,0')).toBe('wall');
  });

  it('leaves out the tiles beyond the camera’s view, a tile’s margin kept', () => {
    const tiles = TILES.map((row) => row + '.'.repeat(20));
    const map = mapWith({ width: 30, height: 6, tiles });
    const { ctx, log } = fakeCanvas(800, 600);
    // 800 px at 100 a tile over x = 5: tiles 1 to 9 in view, 0 and 10 the margin.
    draw(ctx, frameWith({ map, camera: { x: 5, y: 3, scale: 100 } }));
    const columns = new Set(callsOf(log, 'drawImage').map(([, x]) => x));
    expect(Math.min(...[...columns].map(Number))).toBe(0);
    expect(Math.max(...[...columns].map(Number))).toBe(10);
  });
});

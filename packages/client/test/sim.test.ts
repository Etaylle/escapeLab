import { describe, expect, it } from 'vitest';
import { newSim, walk } from '../src/world/sim.js';
import { mapWith } from './fixtures.js';
import { TILES } from './frames.js';

/** Walks `frames` frames of 1/60 s holding `key`, from (x, y); where the avatar ends up. */
function walked(
  decor: { kind: 'shelf'; x: number; y: number }[],
  key: string,
  [x, y]: readonly [number, number],
  frames = 60,
): { x: number; y: number } {
  const map = mapWith({ width: 10, height: 6, tiles: TILES, decor });
  const sim = newSim(0);
  Object.assign(sim.self, { x, y });
  sim.keys.add(key);
  for (let i = 0; i < frames; i++) {
    walk(sim, map, 1 / 60, false);
  }
  return { x: sim.self.x, y: sim.self.y };
}

describe('walk — furniture stands in the way like a wall', () => {
  it('walks on over the floor where nothing stands', () => {
    expect(walked([], 'd', [1.5, 3.5]).x).toBeGreaterThan(4);
  });

  it('stops the avatar at a piece of furniture, its body short of the tile', () => {
    const { x } = walked([{ kind: 'shelf', x: 3, y: 3 }], 'd', [1.5, 3.5]);
    expect(x).toBeLessThan(3);
    expect(x).toBeGreaterThan(2.5);
  });

  it('lets the avatar pass beside it, on the next row', () => {
    expect(walked([{ kind: 'shelf', x: 3, y: 3 }], 'd', [1.5, 2.5]).x).toBeGreaterThan(4);
  });
});

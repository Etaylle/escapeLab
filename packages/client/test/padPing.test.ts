import { describe, expect, it } from 'vitest';
import { PING_AHEAD, pingAhead } from '../src/world/padPing.js';
import { mapWith } from './fixtures.js';
import { TILES } from './frames.js';

/**
 * The 10×6 lab of the frames: two rooms side by side, the doorway at (5, 2) between them.
 *
 *   0123456789
 * 0 ##########
 * 1 #....#...#
 * 2 #........#
 * 3 #....#...#
 * 4 #....#...#
 * 5 ##########
 */
const LAB = mapWith({ width: 10, height: 6, tiles: TILES });

describe('pingAhead — where a controller pings', () => {
  it('lands PING_AHEAD tiles along the way the avatar faces, on open floor', () => {
    expect(pingAhead(LAB, { x: 1.5, y: 2.5, facing: 0 })).toEqual({ x: 1.5 + PING_AHEAD, y: 2.5 });
    const down = pingAhead(LAB, { x: 2.5, y: 1.2, facing: Math.PI / 2 });
    expect(down).toEqual({ x: 2.5, y: 3.2 });
  });

  it('lands short of the first wall on the way, and where the avatar stands at one', () => {
    // Facing up from (2.5, 2.5): row 0 is wall, so the ping stops in row 1.
    const up = pingAhead(LAB, { x: 2.5, y: 2.5, facing: -Math.PI / 2 });
    expect(up.y).toBeGreaterThanOrEqual(1);
    expect(up.y).toBeLessThan(1.5);
    expect(pingAhead(LAB, { x: 1.3, y: 2.5, facing: Math.PI })).toEqual({ x: 1, y: 2.5 });
    expect(pingAhead(LAB, { x: 1.05, y: 2.5, facing: Math.PI })).toEqual({ x: 1.05, y: 2.5 });
  });

  it('stops at a shut door and furniture as at a wall, and passes an open door', () => {
    const shut = mapWith({ ...LAB, doors: [{ id: 'tuer', x: 5, y: 2, open: false }] });
    expect(pingAhead(shut, { x: 4.2, y: 2.5, facing: 0 }).x).toBeLessThan(5);
    const open = mapWith({ ...LAB, doors: [{ id: 'tuer', x: 5, y: 2, open: true }] });
    expect(pingAhead(open, { x: 4.2, y: 2.5, facing: 0 }).x).toBeCloseTo(6.2, 9);
    const crate = mapWith({ ...LAB, decor: [{ kind: 'barrel', x: 3, y: 2 }] });
    expect(pingAhead(crate, { x: 1.5, y: 2.5, facing: 0 }).x).toBeLessThan(3);
  });
});

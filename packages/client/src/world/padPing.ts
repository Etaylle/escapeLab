import { walkable } from '@escapelab/core';
import type { WorldMap } from './render/frame.js';

/**
 * Where a controller pings — the D-pad's ◀ in the world (input/padRuntime.ts) — as the mouse
 * pings where it clicks: there is no pointer, so the ping lands on the floor the avatar's lamp
 * points at. Pure.
 */

/** How far ahead of the avatar a controller's ping lands at most, tiles. */
export const PING_AHEAD = 2;
/** How finely the way ahead is walked along for a wall, tiles. */
const STEP = 0.1;

/**
 * The spot a controller pings from `self`: PING_AHEAD tiles along its facing, or short of the
 * first wall, shut door or piece of furniture on the way — where it stands, where one is right
 * in front of it — rounded to a hundredth of a tile, as a click's spot is.
 */
export function pingAhead(
  map: Pick<WorldMap, 'tiles' | 'decor' | 'doors'>,
  self: { x: number; y: number; facing: number },
): { x: number; y: number } {
  const shut = new Set(map.doors.filter((d) => !d.open).map((d) => `${d.x},${d.y}`));
  const dx = Math.cos(self.facing);
  const dy = Math.sin(self.facing);
  let at = { x: self.x, y: self.y };
  for (let i = 1; i * STEP <= PING_AHEAD + 1e-9; i++) {
    const x = self.x + dx * i * STEP;
    const y = self.y + dy * i * STEP;
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (!walkable(map, tx, ty) || shut.has(`${tx},${ty}`)) {
      break;
    }
    at = { x, y };
  }
  return { x: Math.round(at.x * 100) / 100, y: Math.round(at.y * 100) / 100 };
}

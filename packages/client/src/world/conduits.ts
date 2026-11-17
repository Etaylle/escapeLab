import type { ConduitView } from '@escapelab/core';

/**
 * The cable ducts in the floor (core conduits.ts) as the world draws them: each tile of a duct
 * with the sides its channel runs out of, baked with the floor (tileCache.ts, ductArt.ts), and
 * where the start pulse's light stands in one at a moment — a pure function of the times the
 * view carries, so that every screen shows it at the same spot. Pure.
 */

/** The sides a duct's channel runs out of a tile by: north, east, south, west. */
export const DUCT_N = 1;
export const DUCT_E = 2;
export const DUCT_S = 4;
export const DUCT_W = 8;

/** A tile of a duct: where, and the sides its channel leaves it by (DUCT_N … DUCT_W). */
export interface DuctPiece {
  x: number;
  y: number;
  links: number;
}

/** The side of tile `from` that tile `to`, beside it, lies on; 0 for one that is not beside it. */
function sideTo(from: { x: number; y: number }, to: { x: number; y: number }): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) + Math.abs(dy) !== 1) {
    return 0;
  }
  if (dx !== 0) {
    return dx > 0 ? DUCT_E : DUCT_W;
  }
  return dy > 0 ? DUCT_S : DUCT_N;
}

/** Every tile of `conduits`, by its index on a map `width` tiles wide, with its channel's sides. */
export function ductPieces(
  conduits: readonly Pick<ConduitView, 'tiles'>[],
  width: number,
): Map<number, DuctPiece> {
  const pieces = new Map<number, DuctPiece>();
  for (const { tiles } of conduits) {
    tiles.forEach((tile, i) => {
      const before = tiles[i - 1];
      const after = tiles[i + 1];
      const links =
        (before === undefined ? 0 : sideTo(tile, before)) |
        (after === undefined ? 0 : sideTo(tile, after));
      const index = tile.y * width + tile.x;
      const known = pieces.get(index);
      pieces.set(index, { x: tile.x, y: tile.y, links: links | (known?.links ?? 0) });
    });
  }
  return pieces;
}

/** How finely the pulse's light steps along its duct, in tiles: a quarter of one. */
export const PULSE_STEP = 0.25;

/** Where the pulse's light stands, in tiles, and whether it has reached the far end. */
export interface PulseSpot {
  x: number;
  y: number;
  arrived: boolean;
}

/**
 * Where the pulse in `conduit` stands at `now` (epoch ms on the server's clock): from the middle
 * of the tile it leaves from to the middle of the far one between its sending and its arrival,
 * a PULSE_STEP at a time, then at the far end until it dies there; null with no pulse, before
 * its sending and once it has died.
 */
export function pulseSpot(conduit: ConduitView, now: number): PulseSpot | null {
  const { pulse } = conduit;
  if (pulse === null || now < pulse.sentAt || now >= pulse.diesAt) {
    return null;
  }
  const path = pulse.reversed ? [...conduit.tiles].reverse() : conduit.tiles;
  const travel = Math.max(1, pulse.arrivesAt - pulse.sentAt);
  const share = Math.min(1, (now - pulse.sentAt) / travel);
  const along = Math.floor((share * (path.length - 1)) / PULSE_STEP) * PULSE_STEP;
  const at = Math.min(path.length - 1, Math.floor(along));
  const from = path[at];
  const to = path[Math.min(path.length - 1, at + 1)] ?? from;
  if (from === undefined || to === undefined) {
    return null;
  }
  const t = along - at;
  return {
    x: from.x + 0.5 + (to.x - from.x) * t,
    y: from.y + 0.5 + (to.y - from.y) * t,
    arrived: now >= pulse.arrivesAt,
  };
}

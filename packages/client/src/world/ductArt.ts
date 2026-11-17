import { DUCT_E, DUCT_N, DUCT_S, DUCT_W, type DuctPiece } from './conduits.js';
import { INK, inLight, rgba, sink, STEEL } from './palette.js';

/**
 * How a cable duct in the floor looks (conduits.ts), baked with the floor it is let into
 * (tileCache.ts) in the light of its tile: a dark channel from the tile's middle out of every
 * side the duct leaves it by, a steel rim along it and a grating of thin bars across it. Flat
 * and quiet, as the floor's marks are; the pulse's light running in it is the glow pass's.
 */

/** How wide the channel is, and its rim, in tiles. */
const CHANNEL = 0.34;
const RIM = 0.035;
/** How far apart the grating's bars stand, and how thick each is, in tiles. */
const BAR_EVERY = 0.1;
const BAR = 0.022;

/** The channel's arms out of a tile: each side's bit with the box it fills, tile space. */
const ARMS: readonly (readonly [number, readonly [number, number, number, number]])[] = [
  [DUCT_N, [0.5 - CHANNEL / 2, 0, CHANNEL, 0.5 + CHANNEL / 2]],
  [DUCT_S, [0.5 - CHANNEL / 2, 0.5 - CHANNEL / 2, CHANNEL, 0.5 + CHANNEL / 2]],
  [DUCT_W, [0, 0.5 - CHANNEL / 2, 0.5 + CHANNEL / 2, CHANNEL]],
  [DUCT_E, [0.5 - CHANNEL / 2, 0.5 - CHANNEL / 2, 0.5 + CHANNEL / 2, CHANNEL]],
];

/** The boxes the channel fills on a tile whose duct leaves it by `links`; its middle at least. */
function boxesOf(links: number): (readonly [number, number, number, number])[] {
  const arms = ARMS.filter(([bit]) => (links & bit) !== 0).map(([, box]) => box);
  const middle = [0.5 - CHANNEL / 2, 0.5 - CHANNEL / 2, CHANNEL, CHANNEL] as const;
  return arms.length === 0 ? [middle] : arms;
}

/** Bakes the duct `piece` onto the floor of its tile in `g`, tile space, `lit` as its tile is. */
export function drawDuct(g: CanvasRenderingContext2D, piece: DuctPiece, lit: boolean): void {
  const boxes = boxesOf(piece.links);
  g.save();
  g.translate(piece.x, piece.y);
  g.fillStyle = rgba(inLight(sink(STEEL, 0.25), lit), 0.85);
  for (const [x, y, w, h] of boxes) {
    g.fillRect(x - RIM, y - RIM, w + RIM * 2, h + RIM * 2);
  }
  g.fillStyle = rgba(inLight(INK, lit), 0.92);
  for (const [x, y, w, h] of boxes) {
    g.fillRect(x, y, w, h);
  }
  g.fillStyle = rgba(inLight(STEEL, lit), 0.7);
  for (const [x, y, w, h] of boxes) {
    const across = w >= h;
    const length = across ? w : h;
    for (let at = BAR_EVERY / 2; at < length; at += BAR_EVERY) {
      if (across) {
        g.fillRect(x + at, y, BAR, h);
      } else {
        g.fillRect(x, y + at, w, BAR);
      }
    }
  }
  g.restore();
}

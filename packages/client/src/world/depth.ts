import type { DecorKind, ManualKind } from '@escapelab/core';
import type { Box } from './viewport.js';

/**
 * Depth, as Enter the Gungeon and Hotline Miami give it: tall things — the archive's shelves,
 * the server room's racks, a locker, the filing cabinet and the pillars standing free in a room —
 * rise over the tile behind them, so that whoever walks behind one shows only their upper part.
 * Each stands on its own tile as before (nothing walks into it: collision is unchanged) and is
 * drawn RISE taller, its top half a tile over the tile north of it. Whatever stands behind it —
 * a figure, a thing the crew uses — is drawn first and the tall thing's part over it again
 * (render/occluders.ts): the painter's y-sort, done where it matters. Drones fly over
 * everything; shadows stay on the floor. Pure.
 */

/** How far a tall thing rises over the tile north of it, tiles. */
export const RISE = 0.5;
/** How far the filing cabinet rises: a cabinet is a head shorter than a locker. */
export const CABINET_RISE = 0.3;

/** The furniture that stands tall, and how far it rises: the shelves and the racks. */
export function decorRise(kind: DecorKind): number {
  return kind === 'shelf' || kind === 'rack' ? RISE : 0;
}

/** The manual objects that stand tall, and how far each rises: a locker, the filing cabinet. */
export function sourceRise(kind: ManualKind): number {
  if (kind === 'locker') {
    return RISE;
  }
  return kind === 'cabinet' ? CABINET_RISE : 0;
}

/** A tall thing on the map: its tile, how far it rises, and what it is. */
export interface Tall {
  x: number;
  y: number;
  rise: number;
  /** furniture, a manual object or a pillar: how it is drawn again (render/occluders.ts) */
  of: 'decor' | 'source' | 'pillar';
}

/**
 * The part of a tall thing that may stand in front of what is behind it: its tile's width, from
 * its top RISE over the tile north of it down to its tile's middle — below that, nothing
 * behind it reaches, and its foot shadow lies there, which is not drawn twice.
 */
export function hidingBox({ x, y, rise }: Tall): Box {
  return { left: x, top: y - rise, right: x + 1, bottom: y + 0.5 };
}

/**
 * Whether something whose ground lies at `depth` (tiles down the map: a figure's place, a
 * thing's tile middle) stands behind the tall thing `tall`: north of its middle.
 */
export function behind(tall: Tall, depth: number): boolean {
  return depth < tall.y + 0.5;
}

/** Where two boxes overlap; null where they do not. */
function overlap(a: Box, b: Box): Box | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

/** A tall thing standing in front of something, and the box it is drawn again in, over it. */
export interface Hiding {
  tall: Tall;
  clip: Box;
}

/**
 * The tall things of `talls` that hide part of something whose drawing covers `box` and whose
 * ground lies at `depth`: each standing in front of it whose part over the tile behind overlaps
 * its drawing, with that overlap — back to front, so that the nearer is drawn last.
 */
export function hidersOf(talls: readonly Tall[], box: Box, depth: number): Hiding[] {
  const found: Hiding[] = [];
  for (const tall of talls) {
    const clip = behind(tall, depth) ? overlap(hidingBox(tall), box) : null;
    if (clip !== null) {
      found.push({ tall, clip });
    }
  }
  return found.sort((a, b) => a.tall.y - b.tall.y || a.tall.x - b.tall.x);
}

/**
 * What a figure standing at (x, y) covers on the map, tiles: its body from its feet up — the
 * figure is drawn with its feet 0.3 under its place (render/actors.ts) — and its shadow round
 * the feet; its name tag over it is drawn apart, over everything.
 */
export function figureBox(x: number, y: number): Box {
  const feet = y + 0.3;
  return { left: x - 0.55, top: feet - 1, right: x + 0.55, bottom: feet + 0.22 };
}

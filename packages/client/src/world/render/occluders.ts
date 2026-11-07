import { drawManualObject } from '../art.js';
import { dressedFor, spriteFor } from '../artKit.js';
import { atlasLevel, sprite, spriteAt } from '../atlas.js';
import { decorVariant } from '../decor.js';
import { decorRise, hidersOf, RISE, sourceRise, type Hiding, type Tall } from '../depth.js';
import { isPillar } from '../surfaces.js';
import type { Box } from '../viewport.js';
import { inTiles, toScreen, type Frame, type WorldMap } from './frame.js';
import { sourceShows } from './labels.js';
import { sourceLook } from './looks.js';

/**
 * Depth on the world's picture (world/depth.ts): the tall things of a frame — the shelves and
 * racks baked with the floor, the pillars standing free, a locker or the filing cabinet — and,
 * once something standing behind one is drawn, the tall thing's part over it drawn again, cut to
 * where it hides it: the y-sort the painter needs, done only where something stands behind.
 * A tall thing is drawn again only where the world shows it.
 */

/** The tall things of a map, found once a map: its furniture, its sources' places, its pillars. */
const talls = new WeakMap<WorldMap, Tall[]>();

/** The tall things on the frame's map. */
export function tallsOf(frame: Frame): Tall[] {
  const known = talls.get(frame.map);
  if (known !== undefined) {
    return known;
  }
  const { map } = frame;
  const found: Tall[] = [];
  for (const piece of map.decor) {
    const rise = decorRise(piece.kind);
    if (rise > 0) {
      found.push({ x: piece.x, y: piece.y, rise, of: 'decor' });
    }
  }
  for (const manual of map.manuals) {
    const rise = sourceRise(manual.kind);
    if (rise > 0) {
      found.push({ x: manual.x, y: manual.y, rise, of: 'source' });
    }
  }
  const { walls } = dressedFor(frame.kit.art, map, frame.missionId).dressing;
  walls.forEach((mask, i) => {
    const x = i % map.width;
    const y = Math.floor(i / map.width);
    if (map.tiles[y]?.charAt(x) === '#' && isPillar(mask)) {
      found.push({ x, y, rise: RISE, of: 'pillar' });
    }
  });
  talls.set(map, found);
  return found;
}

/** Whether `tall` shows on this frame: furniture and sources where the world shows them. */
function shownNow(frame: Frame, tall: Tall): boolean {
  if (tall.of === 'pillar') {
    return true;
  }
  if (tall.of === 'decor') {
    return frame.light.shown(tall.x, tall.y);
  }
  const manual = frame.map.manuals.find((m) => m.x === tall.x && m.y === tall.y);
  return manual !== undefined && sourceShows(frame, manual);
}

/** Whether the tile (x, y) is drawn in the colours of the power on (render/tiles.ts). */
function litAt(frame: Frame, x: number, y: number): boolean {
  return frame.light.powered(x, y) || frame.litTiles.has(`${x},${y}`);
}

/** Draws the furniture or the pillar `tall` again over `ctx`, tile space, from its sprite. */
function drawSprite(ctx: CanvasRenderingContext2D, frame: Frame, tall: Tall): void {
  const level = atlasLevel(frame.camera.scale);
  const { art } = frame.kit;
  const lit = litAt(frame, tall.x, tall.y);
  if (tall.of === 'decor') {
    const piece = frame.map.decor.find((d) => d.x === tall.x && d.y === tall.y);
    if (piece !== undefined) {
      const spec = { decor: piece.kind, variant: decorVariant(piece), lit };
      const drawn = sprite(art.atlas, level, spec);
      ctx.drawImage(drawn.canvas, tall.x, tall.y - drawn.lift, 1, drawn.tall);
    }
    return;
  }
  const { tiles } = dressedFor(art, frame.map, frame.missionId);
  const sprites = tiles[tall.y * frame.map.width + tall.x];
  if (sprites != null) {
    const below = sprites.face && litAt(frame, tall.x, tall.y + 1);
    const { key, spec } = spriteFor(sprites, lit, below);
    const drawn = spriteAt(art.atlas, level, key, spec);
    ctx.drawImage(drawn.canvas, tall.x, tall.y - drawn.lift, 1, drawn.tall);
  }
}

/** Draws `tall` again over `ctx`, tile space, as the frame drew it the first time. */
function drawAgain(ctx: CanvasRenderingContext2D, frame: Frame, tall: Tall): void {
  if (tall.of !== 'source') {
    drawSprite(ctx, frame, tall);
    return;
  }
  const manual = frame.map.manuals.find((m) => m.x === tall.x && m.y === tall.y);
  if (manual !== undefined) {
    ctx.translate(tall.x + 0.5, tall.y + 0.5);
    drawManualObject(ctx, { ...sourceLook(frame, manual, null), bare: true });
  }
}

/**
 * Clips `ctx` to the box a tall thing is drawn again in, as whole device pixels, less the
 * labels of `keep` — names under things, which stay over it.
 */
function clipTo(ctx: CanvasRenderingContext2D, frame: Frame, box: Box, keep: readonly Box[]) {
  const rect = (b: Box): void => {
    const [left, top] = toScreen(frame, b.left, b.top);
    const [right, bottom] = toScreen(frame, b.right, b.bottom);
    const x = Math.round(left);
    const y = Math.round(top);
    ctx.rect(x, y, Math.round(right) - x, Math.round(bottom) - y);
  };
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath();
  rect(box);
  for (const label of keep) {
    const left = Math.max(box.left, label.left);
    const top = Math.max(box.top, label.top);
    const right = Math.min(box.right, label.right);
    const bottom = Math.min(box.bottom, label.bottom);
    if (right > left && bottom > top) {
      rect({ left, top, right, bottom });
    }
  }
  ctx.clip('evenodd');
}

/**
 * The tall things shown on this frame hiding part of something whose drawing covers `box`
 * (tiles) and whose ground lies at `depth`, each with the part it hides (depth.ts `hidersOf`).
 */
export function hidersNow(frame: Frame, box: Box, depth: number): Hiding[] {
  const shown = tallsOf(frame).filter((tall) => shownNow(frame, tall));
  return hidersOf(shown, box, depth);
}

/**
 * After something whose drawing covers `box` (tiles) and whose ground lies at `depth` is drawn:
 * every tall thing in front of it that hides part of it, drawn again over it within that part,
 * back to front — the labels of `keep` left clear. Returns what hid it.
 */
export function occlude(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  box: Box,
  depth: number,
  keep: readonly Box[] = [],
): Hiding[] {
  const hiding = hidersNow(frame, box, depth);
  for (const { tall, clip } of hiding) {
    ctx.save();
    clipTo(ctx, frame, clip, keep);
    inTiles(ctx, frame);
    drawAgain(ctx, frame, tall);
    ctx.restore();
  }
  return hiding;
}

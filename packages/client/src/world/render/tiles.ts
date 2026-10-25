import { animTime } from '../anim.js';
import { dressedFor } from '../artKit.js';
import { css, VOID } from '../palette.js';
import { powerAt } from '../sources.js';
import { cachedTiles, drawTiles, type TileLight, type TileRange } from '../tileCache.js';
import { drawWallPropMotion, moves } from '../wallProps.js';
import { inTiles, type Frame } from './frame.js';

/**
 * The first pass: the void's black over the whole canvas, then the dressed
 * floor and walls (dress.ts) — what hangs on a wall's face baked into its
 * sprite, the walls' soft shadows over the floor below them — and the
 * furniture light has fallen on, as far as the camera shows them: in one
 * draw from the map baked whole (tileCache.ts), each tile in the colours of
 * the lab with its power on where the frame's light says so, or in a room
 * whose lights are back; then what moves on the walls — a fan turning, a
 * needle twitching, a clock's hands; tile space.
 */

const VOID_COLOUR = css(VOID);

export function draw(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const { w, h } = frame.viewport;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = VOID_COLOUR;
  ctx.fillRect(0, 0, w, h);
  inTiles(ctx, frame);
  const view = viewOf(frame);
  drawSurfaces(ctx, frame, view);
  drawWallMotion(ctx, frame, view);
}

/** The tiles the camera shows, a tile's margin kept: columns x0 to x1, rows y0 to y1. */
function viewOf({ map, camera, viewport }: Frame): TileRange {
  const s = camera.scale;
  return {
    x0: Math.max(0, Math.floor(camera.x - viewport.w / 2 / s) - 1),
    x1: Math.min(map.width - 1, Math.ceil(camera.x + viewport.w / 2 / s) + 1),
    y0: Math.max(0, Math.floor(camera.y - viewport.h / 2 / s) - 1),
    y1: Math.min(map.height - 1, Math.ceil(camera.y + viewport.h / 2 / s) + 1),
  };
}

/** Whether the tile (x, y) is in the colours of the lab with its power on. */
function litAt(frame: Frame, x: number, y: number): boolean {
  return frame.light.powered(x, y) || frame.litTiles.has(`${x},${y}`);
}

/**
 * Floor, walls and furniture as far as the camera shows them, copied in one
 * go from the map baked whole on this frame's grid, brought up to date first.
 */
function drawSurfaces(ctx: CanvasRenderingContext2D, frame: Frame, view: TileRange): void {
  const { art } = frame.kit;
  const dressed = dressedFor(art, frame.map, frame.missionId);
  const light: TileLight = {
    lit: (x, y) => litAt(frame, x, y),
    shown: (x, y) => frame.light.shown(x, y),
  };
  const cache = cachedTiles(art, dressed, frame.map, frame, light, view);
  drawTiles(ctx, cache, frame.grid, view);
}

/** What moves on the walls' faces in view; the still part is in the wall's sprite. */
function drawWallMotion(ctx: CanvasRenderingContext2D, frame: Frame, view: TileRange): void {
  const { dressing } = dressedFor(frame.kit.art, frame.map, frame.missionId);
  const t = animTime(frame.time);
  for (const prop of dressing.props) {
    const out = prop.x < view.x0 || prop.x > view.x1 || prop.y < view.y0 || prop.y > view.y1;
    if (out || !moves(prop.kind)) {
      continue;
    }
    // A prop hangs on the wall's face, in the light of the room it looks into.
    const lit = litAt(frame, prop.x, prop.y + 1);
    const on = powerAt(frame, prop.x, prop.y + 1, prop.room);
    ctx.save();
    ctx.translate(prop.x, prop.y);
    const state = { t, on, now: frame.now, reduced: frame.reduced, lit };
    drawWallPropMotion(ctx, prop.kind, prop.variant, state);
    ctx.restore();
  }
}

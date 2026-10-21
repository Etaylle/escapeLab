import { animTime } from '../anim.js';
import { dressedFor, spriteFor, type TileSprites } from '../artKit.js';
import { atlasLevel, spriteAt } from '../atlas.js';
import { css, VOID } from '../palette.js';
import { powerAt } from '../sources.js';
import { drawWallPropMotion, moves } from '../wallProps.js';
import { inTiles, type Frame } from './frame.js';

/**
 * The first pass: the void's black over the whole canvas, then the dressed
 * floor and walls (dress.ts), as far as the camera shows them, from the
 * sprite atlas (atlas.ts) — what hangs on a wall's face baked into its
 * sprite — in the colours of the lab with its power on where the frame's
 * light says so, or in a room whose lights are back; the walls' soft
 * shadows over the floor below them; then what moves on the walls — a fan
 * turning, a needle twitching, a clock's hands; tile space.
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
interface TileView {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function viewOf({ map, camera, viewport }: Frame): TileView {
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
 * Floor and walls: every floor tile first, then every wall over them, so a
 * wall's shadow falls on the floor below it; nothing for the void.
 */
function drawSurfaces(ctx: CanvasRenderingContext2D, frame: Frame, view: TileView): void {
  const { tiles } = dressedFor(frame.kit.art, frame.map, frame.missionId);
  const { atlas } = frame.kit.art;
  const level = atlasLevel(frame.camera.scale);
  const width = frame.map.width;
  for (const walls of [false, true]) {
    for (let ty = view.y0; ty <= view.y1; ty++) {
      const row = frame.map.tiles[ty] ?? '';
      for (let tx = view.x0; tx <= view.x1; tx++) {
        const sprites: TileSprites | null | undefined = tiles[ty * width + tx];
        if (sprites == null || (row.charAt(tx) === '#') !== walls) {
          continue;
        }
        const below = sprites.face && litAt(frame, tx, ty + 1);
        const { key, spec } = spriteFor(sprites, litAt(frame, tx, ty), below);
        const drawn = spriteAt(atlas, level, key, spec);
        ctx.drawImage(drawn.canvas, tx, ty, 1, drawn.tall);
      }
    }
  }
}

/** What moves on the walls' faces in view; the still part is in the wall's sprite. */
function drawWallMotion(ctx: CanvasRenderingContext2D, frame: Frame, view: TileView): void {
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

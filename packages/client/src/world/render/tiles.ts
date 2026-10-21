import { inTiles, type Frame, type RenderKit } from './frame.js';

/**
 * The first pass: the void's black over the whole canvas, then floor and
 * walls, as far as the camera shows them — in the colours of the lab with
 * its power on where the frame's light says so, or in a room whose lights
 * are back; tile space.
 */

/** The black beyond the lab's walls. */
const VOID = '#04070a';

export function draw(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const { w, h } = frame.viewport;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = VOID;
  ctx.fillRect(0, 0, w, h);
  inTiles(ctx, frame);
  drawTiles(ctx, frame);
}

/** Floor and walls, as far as the canvas shows them; tile space. */
function drawTiles(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const { map, camera, light, litTiles } = frame;
  const { w, h } = frame.viewport;
  const s = camera.scale;
  const x0 = Math.max(0, Math.floor(camera.x - w / 2 / s) - 1);
  const x1 = Math.min(map.width - 1, Math.ceil(camera.x + w / 2 / s) + 1);
  const y0 = Math.max(0, Math.floor(camera.y - h / 2 / s) - 1);
  const y1 = Math.min(map.height - 1, Math.ceil(camera.y + h / 2 / s) + 1);
  for (let ty = y0; ty <= y1; ty++) {
    const row = map.tiles[ty] ?? '';
    for (let tx = x0; tx <= x1; tx++) {
      const lit = light.powered(tx, ty) || litTiles.has(`${tx},${ty}`);
      const texture = textureOf(frame.kit, row.charAt(tx), lit);
      if (texture !== null) {
        ctx.drawImage(texture, tx, ty, 1, 1);
      }
    }
  }
}

/**
 * What a tile is drawn with: floor or wall, in the colours of the power on
 * where `lit`; nothing for the void beyond the walls.
 */
function textureOf(kit: RenderKit, tile: string, lit: boolean): HTMLCanvasElement | null {
  const { floor, wall, floorLit, wallLit } = kit.textures;
  if (tile === '.') {
    return lit ? floorLit : floor;
  }
  if (tile === '#') {
    return lit ? wallLit : wall;
  }
  return null;
}

/**
 * The picture on Ferret vs Ducks' card in the machine's select, drawn by the game's own sprites:
 * its three ducks bobbing over the ferret, on its night ground.
 */
import { drawDuck, drawFerret } from './sprites.js';

export function drawPreview(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  ctx.fillStyle = '#080d11';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 3; i++) drawDuck(ctx, w / 2 - 70 + i * 70, h * 0.36, i * 2, t, 2.4);
  drawFerret(ctx, w / 2, h * 0.78, t, { scale: 2.4, moving: true });
}

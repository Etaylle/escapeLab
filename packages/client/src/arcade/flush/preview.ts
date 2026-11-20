/**
 * The picture on Ferret Flush's card in the machine's select, drawn by the game's own birds: a
 * mallard crossing a dawn sky over the reeds.
 */
import { drawBirds } from './birds.js';
import type { Bird } from './rules.js';

export function drawPreview(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#2d3f6b');
  sky.addColorStop(1, '#f2b48a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#2f4a2c';
  for (let x = 0; x < w; x += 6) ctx.fillRect(x, h * 0.8 - ((x * 7) % 11), 3, h);
  const across = ((t * 0.18) % 1.4) - 0.2;
  const duck: Bird = {
    id: 1,
    type: 'duck',
    kind: 0,
    slot: 0,
    state: 'flying',
    x: across * w,
    y: h * 0.42 + Math.sin(t * 2) * 6,
    age: t,
    heading: -0.15,
    facing: 1,
    flip: 1,
    angle: 0,
  };
  ctx.save();
  ctx.scale(0.55, 0.55);
  duck.x /= 0.55;
  duck.y /= 0.55;
  drawBirds(ctx, (hex) => hex, { birds: [duck] });
  ctx.restore();
}

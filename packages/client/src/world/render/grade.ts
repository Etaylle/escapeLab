import { rgba } from '../palette.js';
import type { Frame } from './frame.js';

/**
 * The colour grade on the Canvas pass (world/grade.ts): the frame's wash laid over the whole
 * picture in one translucent fill — over the picture, the lab's own light and the darkness,
 * under every light added after it (render/light.ts), so that what glows keeps its colour.
 * A grade multiplied or blended in costs the software canvas a full-screen blend, 2.2 ms a frame
 * at 1440 × 670 on a main thread slowed four times; the plain fill costs a tenth of that. The
 * light layer folds the same wash into its light map instead (gl/shaders.ts).
 */
export function drawGrade(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const { rgb, alpha } = frame.grade;
  if (alpha <= 0) {
    return;
  }
  const { w, h } = frame.viewport;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = rgba(rgb, alpha);
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

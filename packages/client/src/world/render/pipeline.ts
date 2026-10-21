import * as actors from './actors.js';
import type { Frame } from './frame.js';
import * as hud from './hud.js';
import * as light from './light.js';
import * as objects from './objects.js';
import * as overlays from './overlays.js';
import * as tiles from './tiles.js';
import * as glow from './glow.js';

/**
 * The world's picture, pass by pass, each over what the one before left:
 * floor and walls, the lab's things, drones and crew, the light, the
 * minimap, and what lies over it all. Every pass draws from the frame alone.
 */
export function drawFrame(ctx: CanvasRenderingContext2D, frame: Frame): void {
  tiles.draw(ctx, frame);
  objects.draw(ctx, frame);
  actors.draw(ctx, frame);
  light.draw(ctx, frame);
  glow.draw(ctx, frame);
  hud.draw(ctx, frame);
  overlays.draw(ctx, frame);
}

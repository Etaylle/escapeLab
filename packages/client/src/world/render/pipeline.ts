import * as actors from './actors.js';
import { profiled, type Frame } from './frame.js';
import * as glow from './glow.js';
import * as hud from './hud.js';
import * as light from './light.js';
import * as objects from './objects.js';
import * as overlays from './overlays.js';
import * as tiles from './tiles.js';

/**
 * The world's picture, pass by pass, each over what the one before left:
 * floor and walls, the lab's things, drones and crew, what glows and moves
 * — under the light where the WebGL layer lights the frame, so that its
 * light map shades it — the light, over it what glows and moves where the
 * Canvas pass lights it, the minimap, and what lies over it all. Every pass
 * draws from the frame alone; each is timed where the page asked for the
 * profile (profile.ts).
 */
export function drawFrame(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const { kit } = frame;
  profiled(kit, 'tiles', ctx, () => tiles.draw(ctx, frame));
  profiled(kit, 'objects', ctx, () => objects.draw(ctx, frame));
  profiled(kit, 'actors', ctx, () => actors.draw(ctx, frame));
  profiled(kit, 'glow', ctx, () => glow.under(ctx, frame));
  profiled(kit, 'light', ctx, () => light.draw(ctx, frame));
  profiled(kit, 'glow', ctx, () => glow.draw(ctx, frame));
  profiled(kit, 'hud', ctx, () => hud.draw(ctx, frame));
  profiled(kit, 'overlays', ctx, () => overlays.draw(ctx, frame));
}

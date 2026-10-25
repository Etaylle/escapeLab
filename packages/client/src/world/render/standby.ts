import { bakeBox } from '../baked.js';
import { pulseAt } from '../gl/pack.js';
import { rgba } from '../palette.js';
import { standbySources, type LightSource } from '../sources.js';
import { layBake } from './bakes.js';
import { clipOf, shutKey } from './clips.js';
import type { Frame } from './frame.js';

/**
 * The lights asleep in the dark — a screen's standby dot, a rack's LEDs, a
 * generator's standby lamp in a room without power (world/sources.ts) —
 * each with a small soft glow in its colour round it, where it can see,
 * over the darkness on either way of the light (render/light.ts): the room
 * reads as asleep, not dead. The glows are baked together for the lights
 * the world shows (bakes.ts) — where they overlap, the brighter one counts,
 * so that a row of racks glows like one, not like twelve — and laid on in
 * one go, breathing slowly, as the light layer lets them breathe (gl/sources.ts).
 */

/** How far a standby light's glow reaches, in tiles. */
export const STANDBY_REACH = 2.4;
/** The slow breath every standby light takes: its period, and how far it dims at the bottom. */
export const STANDBY_BREATH = { periodMs: 3200, depth: 0.3 } as const;
/** How strongly a standby glow's colour is added in its middle, part of the way out, at its rim. */
const STOPS = [
  [0, 0.2],
  [0.3, 0.06],
  [1, 0],
] as const;

/**
 * Fills a standby glow round `source` in `g`, tile space, as strong as it
 * glows asleep, where it can see.
 */
function fillGlow(
  g: CanvasRenderingContext2D,
  frame: Frame,
  source: LightSource,
  shut: string,
): void {
  const { x, y } = source;
  const strength = source.standby ?? 0;
  const glow = g.createRadialGradient(x, y, 0, x, y, STANDBY_REACH);
  for (const [offset, alpha] of STOPS) {
    glow.addColorStop(offset, rgba(source.colour, alpha * strength));
  }
  g.save();
  g.clip(clipOf(frame, { x, y, reach: STANDBY_REACH }, shut));
  g.fillStyle = glow;
  g.fillRect(x - STANDBY_REACH, y - STANDBY_REACH, STANDBY_REACH * 2, STANDBY_REACH * 2);
  g.restore();
}

/** The standby lights' glows over the picture, baked for the lights shown and the doors shut. */
export function drawStandby(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const asleep = standbySources(frame);
  if (asleep.length === 0) {
    return;
  }
  const shut = shutKey(frame);
  const of = JSON.stringify([shut, asleep.map((s) => [s.x, s.y, s.colour, s.standby])]);
  const rounds = asleep.map(({ x, y }) => ({ x, y, r: STANDBY_REACH }));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = frame.reduced ? 1 : pulseAt(STANDBY_BREATH, frame.time * 1000);
  layBake(ctx, frame, { name: 'standby', of, box: bakeBox(frame.map, [], rounds) }, (g) => {
    g.globalCompositeOperation = 'lighten';
    for (const source of asleep) {
      fillGlow(g, frame, source, shut);
    }
  });
  ctx.restore();
}

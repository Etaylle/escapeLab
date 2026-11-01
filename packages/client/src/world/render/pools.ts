import { bakeBox } from '../baked.js';
import { rgba } from '../palette.js';
import type { LightSource } from '../sources.js';
import type { BakePart } from './bakes.js';
import { clipOf } from './clips.js';
import type { Frame } from './frame.js';

/**
 * The glow the lab's coloured lights throw over the darkness on the Canvas
 * pass: a soft pool round each light's spot, where it can see. The ones that
 * hold still — no pulse, no flicker — are baked together: by the light pass
 * with the rest of the light that holds still while the world lies in the
 * dark (render/light.ts), else by the glow pass (render/glow.ts), which lays
 * the others at the strength of the moment.
 */

/** How bright a light's glow is at its middle, part of the way out and at its rim. */
const POOL_STOPS = [
  [0, 0.55],
  [0.4, 0.22],
  [1, 0],
] as const;

/** Fills a light's glow round its spot in `g`, tile space, `strength` bright. */
export function fillPool(g: CanvasRenderingContext2D, source: LightSource, strength: number): void {
  const { x, y, reach } = source;
  const glow = g.createRadialGradient(x, y, 0, x, y, reach);
  for (const [offset, alpha] of POOL_STOPS) {
    glow.addColorStop(offset, rgba(source.colour, alpha * strength));
  }
  g.fillStyle = glow;
  g.fillRect(x - reach, y - reach, reach * 2, reach * 2);
}

/** The lights whose glow holds still: no pulse, no flicker. */
export function steadyOf(sources: readonly LightSource[]): LightSource[] {
  return sources.filter((s) => s.pulse === undefined && s.flicker !== true);
}

/**
 * The glows of `steady` as one bake (bakes.ts): baked of the mission, the doors standing as
 * `shut` says and every light, over the box round them, each where it can see.
 */
export function steadyPart(frame: Frame, steady: readonly LightSource[], shut: string): BakePart {
  const lights = steady.map((s) => [s.x, s.y, s.colour, s.reach, s.strength.toFixed(2)]);
  const of = JSON.stringify([frame.missionId, shut, lights]);
  const rounds = steady.map((s) => ({ x: s.x, y: s.y, r: s.reach }));
  const box = steady.length === 0 ? null : bakeBox(frame.map, [], rounds);
  return {
    bake: { name: 'pools', of, box },
    draw: (g) => {
      g.globalCompositeOperation = 'lighter';
      for (const source of steady) {
        g.save();
        g.clip(clipOf(frame, source, shut));
        fillPool(g, source, source.strength);
        g.restore();
      }
    },
  };
}

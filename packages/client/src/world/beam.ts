import type { Sight } from '@escapelab/core';
import { TAU } from './brush.js';
import { smooth } from './ease.js';
import { OWN_BEAM_STOPS, type TintStops } from './light.js';
import { lift, TUNGSTEN, type Rgb } from './palette.js';
import type { FloorKind } from './surfaces.js';

/**
 * A flashlight's beam as a light rather than a flat wedge — the way the torches of Darkwood and
 * Alien: Isolation read: a core along its axis clearing all of the dark and warming what it
 * falls on, flanks clearing less, an edge fading out either way of its half-angle instead of
 * ending at a line; a small glint at the lens in the hand, and on a floor that shines — the
 * lab's lino, the steel of the server room, the reactor and the control room — a faint streak
 * along the beam where it falls. Pure: the Canvas pass bakes the beam (render/beam.ts), the
 * light layer lights its core as a second, narrower beam with a warm tint (gl/sources.ts).
 */

/** How far the beam's edge fades either way of its half-angle, radians. */
export const BEAM_EDGE = 0.14;
/** How far either way of its axis the beam's core reaches, radians. */
export const CORE_HALF = 0.2;
/** How far the core's edge fades either way, radians. */
export const CORE_EDGE = 0.12;
/** How much of the darkness the beam's flanks clear: its core clears all of it. */
export const FLANK = 0.8;
/** The warm light the core lays over what it falls on, at most: a share of its colour. */
export const CORE_GLOW = 0.16;
/**
 * How far along the beam its core's warm light is laid, a share of its reach: beyond, it has
 * faded to a twentieth of its colour, and laying it costs a frame more than it shows.
 */
export const GLOW_REACH = 0.8;
/** The core's warm light: the lamp's tungsten, nearly white. */
export const GLOW_RGB: Rgb = lift(TUNGSTEN, 0.35);
/** The core's warm light along its reach, as your lamp's beam falls off (light.ts). */
export const CORE_TINT: TintStops = OWN_BEAM_STOPS.map(
  ([offset, depth]) => [offset, GLOW_RGB, depth * CORE_GLOW] as const,
);
/** How strongly a lamp somebody else of the crew carries lights, against your own. */
export const CREW_BEAM = 0.85;
/**
 * How far the beam of a lamp somebody else of the crew carries shows, tiles: shorter than
 * yours (frameLight.ts BEAM_REACH), so that cutting it into the dark stays within a frame's
 * budget for an effect on the software canvas (docs/art-bible.md).
 */
export const CREW_REACH = 5;

/** A smooth step down from 1 to 0 across `width` either way of `at`, `a` along the way. */
function fadeOut(a: number, at: number, width: number): number {
  return 1 - smooth((a - (at - width)) / (2 * width));
}

/**
 * How much of its light a beam `half` radians wide either way casts `off` radians off its axis,
 * 0 to 1: all of it in the core, FLANK of it on the flanks, none past its edge — the core lit
 * as a second, narrower beam over the first, as the light layer lights it.
 */
export function beamAcross(off: number, half: number): number {
  const a = Math.abs(off);
  const flank = FLANK * fadeOut(a, half, BEAM_EDGE);
  return 1 - (1 - flank) * (1 - coreAcross(a));
}

/** How much of the core's warm light falls `off` radians off a beam's axis, 0 to 1. */
export function coreAcross(off: number): number {
  return fadeOut(Math.abs(off), CORE_HALF, CORE_EDGE);
}

/** How far either way of its axis a beam `half` radians wide casts any light, radians. */
export function beamSpread(half: number): number {
  return half + BEAM_EDGE;
}

/** How many steps of a turn a beam is baked at: a degree apart. */
export const BEAM_STEPS = 360;

/** The step of a turn nearest `angle`, 0 to BEAM_STEPS - 1. */
export function beamStep(angle: number): number {
  const step = Math.round((angle / TAU) * BEAM_STEPS) % BEAM_STEPS;
  return step < 0 ? step + BEAM_STEPS : step;
}

/** The floors a beam leaves a streak on: lino and steel. */
const GLOSSY: ReadonlySet<FloorKind> = new Set(['lab', 'server', 'reactor', 'control']);

/** Whether a floor of `kind` shines where a beam falls on it. */
export function glossy(kind: FloorKind | undefined): boolean {
  return kind !== undefined && GLOSSY.has(kind);
}

/** The streak on a shining floor: where along the beam it starts and ends, tiles, and how wide. */
export const STREAK = { from: 1.1, to: 4.6, width: 0.34 } as const;
/** How far apart the points lie that the streak's way along the beam is walked in, tiles. */
const STREAK_STEP = 0.25;

/**
 * How far along a beam from (x, y) toward `facing` the floor lies in `sight` without a break,
 * up to `most` tiles: where a streak on it has to end.
 */
export function clearAlong(
  sight: Pick<Sight, 'tiles'>,
  { x, y, facing }: { x: number; y: number; facing: number },
  most: number,
): number {
  const dx = Math.cos(facing);
  const dy = Math.sin(facing);
  for (let d = STREAK_STEP; d <= most; d += STREAK_STEP) {
    const key = `${Math.floor(x + dx * d)},${Math.floor(y + dy * d)}`;
    if (!sight.tiles.has(key)) {
      return d - STREAK_STEP;
    }
  }
  return most;
}

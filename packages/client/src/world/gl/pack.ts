import type { Stops } from '../light.js';
import type { Frame } from '../render/frame.js';
import { MAX_SOURCES, VECS_PER_SOURCE } from './shaders.js';
import type { Light } from './sources.js';

/**
 * The lights as the light pass reads them (`uSources`, shaders.ts): each
 * light's pulse and flicker worked out for this moment, those out of the
 * picture left out, the strongest MAX_SOURCES kept in order of strength,
 * each as VECS_PER_SOURCE vectors —
 *
 *   0  x, y, size (the softness of its shadows; -1 where walls do not stop it), glow reach
 *   1  the glow's depth at its middle, its knee, its depth there; the beam's reach
 *   2  the beam's direction (x, y), the cosine of its outer edge and of its inner one
 *   3  the beam's depth at its middle, its knee, its depth there; how much colour it adds
 *   4  its colour (0 to 1); how much whiter it burns at its middle
 *   5  its tint's knee, its share there, how much whiter there; its share halfway
 */

/** Floats a light takes in `uSources`. */
export const FLOATS_PER_SOURCE = VECS_PER_SOURCE * 4;
/** How far, in radians, a beam's edge fades either side of where the Canvas pass cuts it. */
const BEAM_SOFT = 0.06;
/** How often a flickering light may change, per second. */
const FLICKER_HZ = 14;
/** Below this depth or colour a light changes nothing on an 8-bit canvas: it is left out. */
const FAINT = 0.002;

/** The world the camera shows, in tiles: its left, top, right and bottom edges. */
export interface TileView {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The lights packed for the light pass. */
export interface Packed {
  /** MAX_SOURCES × FLOATS_PER_SOURCE floats; the first `count` lights hold this frame's */
  data: Float32Array;
  count: number;
  /** lights in the picture left out for want of room: the dimmest past MAX_SOURCES */
  dropped: number;
}

/** A falloff as the light pass takes it: the depth at the middle, the knee, the depth there. */
export type Profile = readonly [v0: number, knee: number, vk: number];

/**
 * The falloff of gradient stops (light.ts) as three numbers: stops of
 * three — middle, knee, rim — as they are; stops of two, a straight line
 * from the middle to the rim, with the knee halfway. Throws for any other
 * stops: the light pass knows no other falloff.
 */
export function profileOf(stops: Stops): Profile {
  const [first, second] = stops;
  const rim = stops.at(-1);
  if (first?.[0] !== 0 || rim?.[0] !== 1 || rim[1] !== 0) {
    throw new Error(
      `gl: a light's stops have to run from offset 0 to [1, 0], not ${JSON.stringify(stops)}`,
    );
  }
  if (stops.length === 2) {
    return [first[1], 0.5, first[1] / 2];
  }
  if (stops.length !== 3 || second === undefined) {
    throw new Error(`gl: a light's stops have to be two or three, not ${stops.length}`);
  }
  return [first[1], second[0], second[1]];
}

/**
 * A light's strength `ms` into the run, as share of its full: dipping by
 * `depth` and back over `periodMs` (from full at a quarter period to
 * 1 − depth at three quarters); full without a pulse.
 */
export function pulseAt(pulse: Light['pulse'], ms: number): number {
  if (pulse === undefined) {
    return 1;
  }
  return 1 - (pulse.depth * (1 - Math.sin((2 * Math.PI * ms) / pulse.periodMs))) / 2;
}

/** A number from 0 to 1 that `n` always gives, and its neighbours not. */
function noise(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * How brightly a flickering light burns `ms` into the run, 0.3 to 1: mostly
 * near full, now and then dropping hard — the same for the same moment, and
 * each light (`seed`) on its own.
 */
export function flickerAt(seed: number, ms: number): number {
  const step = Math.floor((ms * FLICKER_HZ) / 1000);
  return noise(step + seed * 0.618) < 0.1 ? 0.3 : 0.85 + 0.15 * noise(step * 1.7 + seed);
}

/** A light's own number, from where it hangs: its flicker does not keep step with another's. */
function seedOf(light: Light): number {
  return Math.round(light.x * 97) * 31 + Math.round(light.y * 89);
}

/** How strongly `light` burns `ms` into the run: its strength, pulse and flicker. */
export function strengthAt(light: Light, ms: number): number {
  const flicker = light.flicker === true ? flickerAt(seedOf(light), ms) : 1;
  return light.strength * pulseAt(light.pulse, ms) * flicker;
}

/** How far a light reaches at most, glow or beam. */
function reachOf(light: Light): number {
  return Math.max(light.glow?.reach ?? 0, light.beam?.reach ?? 0);
}

/** How strong a light is at its brightest this moment: what decides which are kept. */
function peakOf(light: Light, strength: number): number {
  const glow = light.glow === null ? 0 : profileOf(light.glow.stops)[0];
  const beam = light.beam === null ? 0 : profileOf(light.beam.stops)[0];
  return strength * Math.max(glow, beam, light.tint?.amount ?? 0);
}

/** Whether a light's reach touches what the camera shows. */
function inView(light: Light, view: TileView): boolean {
  const r = reachOf(light);
  return (
    light.x + r > view.left &&
    light.x - r < view.right &&
    light.y + r > view.top &&
    light.y - r < view.bottom
  );
}

/** What the camera of `frame` shows, in tiles. */
export function viewOf({ camera, viewport }: Frame): TileView {
  const halfW = viewport.w / 2 / camera.scale;
  const halfH = viewport.h / 2 / camera.scale;
  return {
    left: camera.x - halfW,
    top: camera.y - halfH,
    right: camera.x + halfW,
    bottom: camera.y + halfH,
  };
}

/** A falloff as the light pass reads it, `strength` strong: depth, knee, depth there; or none. */
function falloff(stops: Stops | undefined, strength: number): number[] {
  if (stops === undefined) {
    return [0, 0.5, 0];
  }
  const [v0, knee, vk] = profileOf(stops);
  return [v0 * strength, knee, vk * strength];
}

/** A beam's direction, x and y, and the cosines of its outer and inner edge; a full turn for none. */
function cone(beam: Light['beam']): number[] {
  const facing = beam?.facing ?? 0;
  const half = beam?.halfAngle ?? Math.PI;
  return [
    Math.cos(facing),
    Math.sin(facing),
    Math.cos(Math.min(Math.PI, half + BEAM_SOFT)),
    Math.cos(Math.max(0, half - BEAM_SOFT)),
  ];
}

/** A tint's shape as the light pass reads it: its knee, its share there, how much whiter, halfway. */
function tintShape(tint: Light['tint']): number[] {
  return tint === null ? [0.25, 0, 0, 0] : [tint.knee, tint.atKnee, tint.whiteAtKnee, tint.atHalf];
}

/** Writes `light`, `strength` strong, as the light pass reads it, from float `at` of `data`. */
function write(data: Float32Array, at: number, light: Light, strength: number): void {
  const { glow, beam, tint } = light;
  const [r, g, b] = light.colour;
  data.set(
    [
      ...[light.x, light.y, light.size ?? -1, glow?.reach ?? 0],
      ...falloff(glow?.stops, strength),
      beam?.reach ?? 0,
      ...cone(beam),
      ...falloff(beam?.stops, strength),
      (tint?.amount ?? 0) * strength,
      ...[r / 255, g / 255, b / 255, tint?.white ?? 0],
      ...tintShape(tint),
    ],
    at,
  );
}

/**
 * The lights of `lights` that change the picture `view` shows, `ms` into
 * the run, packed for the light pass — into `into` where given: their
 * pulses and flickers worked out, the faint and those out of the picture
 * left out, the rest by strength, strongest first (ties in their order),
 * at most MAX_SOURCES.
 */
export function packLights(
  lights: readonly Light[],
  ms: number,
  view: TileView,
  into: Float32Array = new Float32Array(MAX_SOURCES * FLOATS_PER_SOURCE),
): Packed {
  const ranked = lights
    .map((light) => ({ light, strength: strengthAt(light, ms) }))
    .map((entry) => ({ ...entry, peak: peakOf(entry.light, entry.strength) }))
    .filter(({ light, peak }) => peak > FAINT && inView(light, view))
    .sort((a, b) => b.peak - a.peak);
  const kept = ranked.slice(0, MAX_SOURCES);
  kept.forEach(({ light, strength }, i) => write(into, i * FLOATS_PER_SOURCE, light, strength));
  return { data: into, count: kept.length, dropped: ranked.length - kept.length };
}

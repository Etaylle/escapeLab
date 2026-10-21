import {
  CREW_GLOW_STOPS,
  DRONE_BEAM_STOPS,
  EMERGENCY_GLOW,
  EMERGENCY_STOPS,
  EMERGENCY_TINT,
  HATCH_TINT,
  objectGlowStops,
  OWN_BEAM_STOPS,
  OWN_GLOW_STOPS,
  SPILL_STOPS,
  spillTint,
  type Lamp,
  type Rgb,
  type Stops,
  type TintStops,
} from '../light.js';
import { ALARM_RED, mixTint, WARM } from '../power.js';
import { objectGlows } from '../render/darkness.js';
import type { Frame } from '../render/frame.js';

/**
 * What the light layer lights, worked out from a frame: the lamps the
 * frame's light names (frameLight.ts) — your flashlight, the crew's lamps,
 * the drones' eyes, the open hatch, a lit room through an open door — the
 * glow of the lab's objects, and the coloured lights of the world in the
 * shape world/sources.ts gives them (`LightSource`). Every falloff is the
 * Canvas pass's own (light.ts's stops), so that both paths light a scene
 * alike. The lit rooms, the powered room and the escape's red are no
 * lights here but the layer's ambient terms (maps.ts, render/darkness.ts).
 */

/**
 * A coloured light in the world, as world/sources.ts lists them: where it
 * hangs, its colour, how far it reaches, how strong it burns, and whether
 * it pulses (its strength dipping by `depth` and back over `periodMs`) or
 * flickers.
 */
export interface LightSource {
  x: number;
  y: number;
  colour: [number, number, number];
  reach: number;
  strength: number;
  pulse?: { periodMs: number; depth: number };
  flicker?: boolean;
}

/** One light as the layer draws it. */
export interface Light {
  x: number;
  y: number;
  /** its colour: of what it adds over the darkness, and of the gleam it gives steel */
  colour: Rgb;
  /** its light all round: how far, and how deep it clears the darkness along the way; or none */
  glow: { reach: number; stops: Stops } | null;
  /** a cone one way: where it points, how wide and how far, its depth along the way; or none */
  beam: { facing: number; halfAngle: number; reach: number; stops: Stops } | null;
  /** what it adds in its colour over the darkness, as the Canvas pass's gradient; null for none */
  tint: Tint | null;
  /** how wide it is, in tiles — the softness of its shadows; null where walls do not stop it */
  size: number | null;
  /** how strong it burns: scales its depth and what it adds — and, pulsing, how it pulses */
  strength: number;
  pulse?: { periodMs: number; depth: number };
  flicker?: boolean;
}

/**
 * What a light adds in its colour over the darkness, as the light pass
 * draws a Canvas gradient of coloured light (light.ts `TintStops`): how
 * much at its middle, then straight lines through its knee and halfway to
 * nothing at its rim — whiter than its colour towards the middle.
 */
export interface Tint {
  /** how strongly its colour is added at its middle */
  amount: number;
  /** where its gradient bends between its middle and halfway, above 0 and below 0.5 */
  knee: number;
  /** the share of `amount` added at the knee, and halfway */
  atKnee: number;
  atHalf: number;
  /** how much whiter than its colour it burns at its middle, and at the knee, 0 to 1 */
  white: number;
  whiteAtKnee: number;
}

/** The lamps the crew carry: a warm white, the tungsten of the art bible. */
const LAMP_WHITE: Rgb = [255, 244, 228];
/** A drone's eye: a cold white. */
const DRONE_WHITE: Rgb = [214, 232, 255];
/** The colour a gradient of coloured light runs out in: its last stop's. */
const tailOf = (stops: TintStops): Rgb => stops.at(-1)?.[1] ?? [255, 255, 255];
/** How the emergency lamps burn (assemble.ts `burn`): 0.7 + 0.3·sin(2.4·t), t in seconds. */
const BURN_PULSE = { periodMs: ((2 * Math.PI) / 2.4) * 1000, depth: 0.6 };

/** How wide each kind of light is, in tiles: the softness of its shadows. */
const SIZE = { lamp: 0.1, drone: 0.08, emergency: 0.15, hatch: 0.45, spill: 0.35 } as const;

/** Everything the layer lights this frame, before any is dropped (pack.ts). */
export function lightsOf(frame: Frame): Light[] {
  return [
    ...lampLights(frame),
    ...droneLights(frame),
    ...colouredSources(frame).map(fromSource),
    ...hatchAndSpills(frame),
    ...glowLights(frame),
  ];
}

/**
 * The coloured lights of the world in world/sources.ts's shape: until the
 * art pass lands, the emergency lamps burning this frame, red, pulsing as
 * the Canvas pass burns them. Once world/sources.ts exists this is its
 * `sourcesOf(frame)`.
 */
export function colouredSources(frame: Frame): LightSource[] {
  return frame.light.lamps.map(({ mount }) => ({
    x: mount.x,
    y: mount.y,
    colour: [...tailOf(EMERGENCY_TINT)],
    reach: EMERGENCY_GLOW,
    strength: 1,
    pulse: BURN_PULSE,
  }));
}

/**
 * A coloured light as the layer draws it: lit as the Canvas pass lights an
 * emergency lamp — a dim glow cut into the darkness, its colour added over
 * it, whiter in the middle — `strength` strong.
 */
export function fromSource(source: LightSource): Light {
  const { x, y, colour, reach, strength } = source;
  return {
    x,
    y,
    colour,
    glow: { reach, stops: EMERGENCY_STOPS },
    beam: null,
    tint: tintOf(EMERGENCY_TINT),
    size: SIZE.emergency,
    strength,
    ...(source.pulse === undefined ? {} : { pulse: source.pulse }),
    ...(source.flicker === undefined ? {} : { flicker: source.flicker }),
  };
}

/** A lamp as the frame's light names it, with the falloff of its glow and of its beam. */
function lampLight(lamp: Lamp, glow: Stops, beam: Stops, colour: Rgb, size: number): Light {
  return {
    x: lamp.x,
    y: lamp.y,
    colour,
    glow: lamp.glow > 0 ? { reach: lamp.glow, stops: glow } : null,
    beam: lamp.beam === null ? null : { ...lamp.beam, stops: beam },
    tint: null,
    size,
    strength: 1,
  };
}

/** Your flashlight, glow and cone, and the lamps the rest of the crew carry. */
function lampLights(frame: Frame): Light[] {
  const { own, crew } = frame.light;
  const yours =
    own === null
      ? []
      : [lampLight(own.lamp, OWN_GLOW_STOPS, OWN_BEAM_STOPS, LAMP_WHITE, SIZE.lamp)];
  const theirs = crew.map(({ lamp }) =>
    lampLight(lamp, CREW_GLOW_STOPS, CREW_GLOW_STOPS, LAMP_WHITE, SIZE.lamp),
  );
  return [...yours, ...theirs];
}

/**
 * The drones: an eye's cone where it looks, with the glimmer round its
 * body; a frozen drone only the glimmer, which walls do not stop.
 */
function droneLights(frame: Frame): Light[] {
  return Object.entries(frame.drones).map(([id, drone]): Light => {
    const beam = frame.light.eyes.get(id)?.lamp.beam ?? null;
    const body = { x: drone.x, y: drone.y, colour: DRONE_WHITE, tint: null, strength: 1 };
    if (beam === null) {
      return { ...body, glow: { reach: 0.9, stops: objectGlowStops(0.5) }, beam: null, size: null };
    }
    return {
      ...body,
      glow: { reach: 1.1, stops: objectGlowStops(0.75) },
      beam: { ...beam, stops: DRONE_BEAM_STOPS },
      size: SIZE.drone,
    };
  });
}

/**
 * The open hatch's green-white light, as far as it stands open, and a lit
 * room's light falling through an open door — warm, turning red with the
 * escape — as far as each stands open.
 */
function hatchAndSpills(frame: Frame): Light[] {
  const lights: Light[] = [];
  const { exit, spills } = frame.light;
  if (exit !== null) {
    const { lamp } = exit.lit;
    lights.push({
      x: lamp.x,
      y: lamp.y,
      colour: tailOf(HATCH_TINT),
      glow: { reach: lamp.glow, stops: objectGlowStops(0.95) },
      beam: null,
      tint: tintOf(HATCH_TINT),
      size: SIZE.hatch,
      strength: exit.open,
    });
  }
  const warm = mixTint(WARM.tint, ALARM_RED.tint, frame.red);
  for (const { lit, open } of spills) {
    const { beam } = lit.lamp;
    lights.push({
      x: lit.lamp.x,
      y: lit.lamp.y,
      colour: warm,
      glow: null,
      beam: beam === null ? null : { ...beam, stops: SPILL_STOPS },
      tint: tintOf(spillTint(warm)),
      size: SIZE.spill,
      strength: open,
    });
  }
  return lights;
}

/** The glow of the lab's objects (render/darkness.ts): no wall stops it, as in the Canvas pass. */
function glowLights(frame: Frame): Light[] {
  return objectGlows(frame).map(({ x, y, radius, strength }) => ({
    x,
    y,
    colour: LAMP_WHITE,
    glow: { reach: radius, stops: objectGlowStops(1) },
    beam: null,
    tint: null,
    size: null,
    strength,
  }));
}

/** What `pick` reads off `stops` at `u`, straight between the stops round it. */
function along(stops: TintStops, u: number, pick: (stop: TintStops[number]) => number): number {
  let before = stops[0];
  for (const stop of stops) {
    if (before !== undefined && u <= stop[0]) {
      const span = stop[0] - before[0];
      const t = span > 0 ? (u - before[0]) / span : 0;
      return pick(before) + (pick(stop) - pick(before)) * t;
    }
    before = stop;
  }
  return before === undefined ? 0 : pick(before);
}

/** How much whiter than `tail` the colour `rgb` is, 0 to 1: its channels' mean way to white. */
function whiteness(rgb: Rgb, tail: Rgb): number {
  const ways = rgb.flatMap((c, i) => {
    const t = tail[i] ?? 255;
    return t < 255 ? [(c - t) / (255 - t)] : [];
  });
  const mean = ways.length === 0 ? 0 : ways.reduce((sum, way) => sum + way, 0) / ways.length;
  return Math.min(1, Math.max(0, mean));
}

/**
 * A Canvas gradient of coloured light as the light pass draws it: its
 * strength at its middle; its knee at its first stop between the middle
 * and halfway (a quarter of the way where none lies there); what it adds
 * at the knee and halfway; how much whiter than its last colour it burns at
 * its middle and at the knee. Throws for stops that do not start at 0.
 */
export function tintOf(stops: TintStops): Tint {
  if (stops[0]?.[0] !== 0) {
    throw new Error(`gl: a tint's stops have to start at offset 0, not ${JSON.stringify(stops)}`);
  }
  const tail = tailOf(stops);
  const knee = stops.find(([offset]) => offset > 0 && offset < 0.5)?.[0] ?? 0.25;
  const alpha = (u: number): number => along(stops, u, ([, , a]) => a);
  const white = (u: number): number => along(stops, u, ([, rgb]) => whiteness(rgb, tail));
  const amount = alpha(0);
  const share = (u: number): number => (amount > 0 ? alpha(u) / amount : 0);
  return {
    amount,
    knee,
    atKnee: share(knee),
    atHalf: share(0.5),
    white: white(0),
    whiteAtKnee: white(knee),
  };
}

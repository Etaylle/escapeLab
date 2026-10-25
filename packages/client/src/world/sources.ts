import { dressedFor } from './artKit.js';
import { EMERGENCY_GLOW } from './light.js';
import {
  AMBER,
  DONE_GREEN,
  EMERGENCY,
  PHOSPHOR,
  REACTOR,
  SERVER_BLUE,
  type Rgb,
} from './palette.js';
import type { Frame } from './render/frame.js';
import { warmUp } from './rooms.js';

/**
 * Every coloured light in the lab this frame, as one list — the single
 * truth both ways of the light draw from: the WebGL light layer lights
 * every one of them (gl/sources.ts), the Canvas pass the emergency lamps
 * (render/light.ts) and the rest over its darkness (render/glow.ts). The
 * emergency lamps' pulsing red while their rooms are dark; the wall
 * screens' phosphor green and the racks' cold blue, faint, in the dark too;
 * the reactor core's pulsing orange; and the amber beacon turning over the
 * hatch through the escape. A light shows where the world shows its spot —
 * seen this run, and while the lab has its power only in the room it
 * lights round you — as objects do. How strongly each burns at a moment,
 * pulse and flicker worked out, is gl/pack.ts's `strengthAt`.
 */

export interface LightSource {
  /** where the light comes from, in tiles */
  x: number;
  y: number;
  colour: [number, number, number];
  /** how far it reaches, in tiles */
  reach: number;
  /** how bright in its middle, 0 to 1 */
  strength: number;
  /** a slow swell: its period, and how far it dims at the bottom of it (0 to 1) */
  pulse?: { periodMs: number; depth: number };
  /** coming on now: it flickers as its room's lights strike */
  flicker?: boolean;
  /**
   * asleep in a room without power — a screen's standby dot, a rack's LEDs,
   * a generator's standby lamp: how strongly it glows over the dark
   * (render/standby.ts), 0 to 1; it breathes on the light layer too
   * (gl/sources.ts). Left out for a light awake
   */
  standby?: number;
}

/** Up to how far a room's power is on for a light in it still to be asleep. */
const ASLEEP = 0.02;
/**
 * How strongly a light asleep glows: a screen's standby dot and a
 * generator's lamp in full, a rack's LEDs less — racks stand in rows, and a
 * row should glow like one rack, not like a lit room.
 */
const SLEEP_GLOW = { single: 1, rack: 0.4 } as const;

/** How the emergency lamps burn: frameLight's `burn`, 0.7 ± 0.3 at 2.4 rad/s, as a pulse. */
const LAMP_PULSE = { periodMs: (2 * Math.PI * 1000) / 2.4, depth: 0.6 } as const;
/** The core's slow beat; the beacon's two beams sweeping past its spot, a turn in 4 s. */
const CORE_PULSE = { periodMs: 2400, depth: 0.4 } as const;
const BEACON_PULSE = { periodMs: 2000, depth: 0.85 } as const;

/** How far in front of a wall's face its light hangs over the floor, in tiles. */
const FACE_INSET = 0.05;

const colourOf = (rgb: Rgb): [number, number, number] => [rgb[0], rgb[1], rgb[2]];

/** Whether the lab has its power: before the blackout, and once a won run lights it all. */
function powered(frame: Frame): boolean {
  return frame.scene.lit || (frame.ending?.lit ?? 0) > 0;
}

/**
 * How far the power is on at tile (x, y), 0 to 1: everywhere with the lab's
 * own power, in a room a station lit as its lights strike, nowhere else.
 */
export function powerAt(frame: Frame, x: number, y: number, room: string | null): number {
  if (powered(frame)) {
    return 1;
  }
  const lit = room === null ? undefined : frame.lit.get(room);
  if (lit === undefined || !frame.litTiles.has(`${x},${y}`)) {
    return 0;
  }
  return warmUp((frame.time - lit.since) * 1000, frame.reduced);
}

/**
 * Whether the world shows a light whose spot is the floor tile (x, y): where
 * it shows its objects; while the lab has its power, only in your room.
 */
export function lightShown(frame: Frame, x: number, y: number): boolean {
  const { light } = frame;
  return light.shown(x, y) && (!frame.scene.lit || frame.spectator || light.powered(x, y));
}

/**
 * The emergency lamps burning now, as the Canvas pass burns them (the
 * frame's light, frameLight.ts): their rooms dark, the lab without its
 * power, none for the audience — at full strength at the top of their pulse.
 */
export function lampSources(frame: Frame): LightSource[] {
  return frame.light.lamps.map(({ mount }) => ({
    x: mount.x,
    y: mount.y,
    colour: colourOf(EMERGENCY),
    reach: EMERGENCY_GLOW,
    strength: 1,
    pulse: { ...LAMP_PULSE },
  }));
}

/** A screen's light: phosphor green, brighter once its room is lit, flickering as it strikes. */
function screenLight(x: number, y: number, on: number): LightSource {
  const source: LightSource = {
    x,
    y,
    colour: colourOf(PHOSPHOR),
    reach: 1.7,
    strength: 0.07 + 0.3 * on,
  };
  if (on <= ASLEEP) {
    return { ...source, standby: SLEEP_GLOW.single };
  }
  return on < 1 ? { ...source, flicker: true } : source;
}

/** A rack's LEDs, running whatever the power: cold blue, asleep in a room without it. */
function rackLight(
  x: number,
  y: number,
  light: { reach: number; strength: number },
  on: number,
): LightSource {
  const source: LightSource = { x, y, colour: colourOf(SERVER_BLUE), ...light };
  return on <= ASLEEP ? { ...source, standby: SLEEP_GLOW.rack } : source;
}

/** A generator's lamp: green while it runs, its amber standby lamp in a room without power. */
function generatorLight(x: number, y: number, on: number): LightSource {
  const colour = colourOf(on > 0.5 ? DONE_GREEN : AMBER);
  const source: LightSource = { x: x + 0.36, y: y - 0.02, colour, reach: 1.2, strength: 0.16 };
  return on <= ASLEEP ? { ...source, standby: SLEEP_GLOW.single } : source;
}

/** The lights on the walls' faces: screens and rack fronts. */
function wallSources(frame: Frame): LightSource[] {
  const { dressing } = dressedFor(frame.kit.art, frame.map, frame.missionId);
  return dressing.props.flatMap((prop): LightSource[] => {
    const fx = prop.x;
    const fy = prop.y + 1;
    if ((prop.kind !== 'screen' && prop.kind !== 'rack') || !lightShown(frame, fx, fy)) {
      return [];
    }
    const x = prop.x + 0.5;
    const y = prop.y + 1 + FACE_INSET;
    const on = powerAt(frame, fx, fy, prop.room);
    if (prop.kind === 'rack') {
      return [rackLight(x, y, { reach: 1.4, strength: 0.24 }, on)];
    }
    return [screenLight(x, y, on)];
  });
}

/** The lights of the furniture: racks, desks' screens, generators' lamps, the reactor's core. */
function decorSources(frame: Frame): LightSource[] {
  const { dressing } = dressedFor(frame.kit.art, frame.map, frame.missionId);
  return frame.map.decor.flatMap((piece): LightSource[] => {
    if (!lightShown(frame, piece.x, piece.y)) {
      return [];
    }
    const x = piece.x + 0.5;
    const y = piece.y + 0.5;
    if (piece.kind === 'core') {
      const pulse = { ...CORE_PULSE };
      return [{ x, y: y - 0.1, colour: colourOf(REACTOR), reach: 3.4, strength: 0.7, pulse }];
    }
    const room = dressing.rooms[piece.y * dressing.width + piece.x] ?? null;
    const on = powerAt(frame, piece.x, piece.y, room);
    if (piece.kind === 'rack') {
      return [rackLight(x, y, { reach: 1.5, strength: 0.28 }, on)];
    }
    if (piece.kind === 'desk') {
      return [screenLight(x, y - 0.25, on)];
    }
    return piece.kind === 'generator' ? [generatorLight(x, y, on)] : [];
  });
}

/** The amber beacon turning over the open hatch while the crew runs for it. */
function beaconSources(frame: Frame): LightSource[] {
  const exit = frame.map.exit;
  if (exit === null || !exit.open || frame.escapeSince === null || frame.red <= 0) {
    return [];
  }
  return [
    {
      x: exit.x + 0.5,
      y: exit.y + 0.5,
      colour: colourOf(AMBER),
      reach: 3.5,
      strength: 0.75,
      pulse: { ...BEACON_PULSE },
    },
  ];
}

/**
 * The lights besides the emergency lamps: what the Canvas light pass adds
 * over the darkness itself (render/glow.ts) — it draws the lamps already.
 */
export function glowSources(frame: Frame): LightSource[] {
  return [...wallSources(frame), ...decorSources(frame), ...beaconSources(frame)];
}

/** Every coloured light of this frame: the emergency lamps, then the rest. */
export function sourcesOf(frame: Frame): LightSource[] {
  return [...lampSources(frame), ...glowSources(frame)];
}

/** The lights asleep in rooms without power this frame, where the world shows them. */
export function standbySources(frame: Frame): LightSource[] {
  return glowSources(frame).filter((source) => source.standby !== undefined);
}

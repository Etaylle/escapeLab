import { CREW_COLORS } from '@escapelab/core';

/**
 * The art bible's palette (docs/art-bible.md): every colour the world's
 * drawing code uses comes from here, as a named token or mixed from them.
 * A 1980s research lab seen from above, in the dark — concrete, painted
 * walls, steel and brass under tungsten light, instruments glowing in
 * phosphor green, server blue and reactor orange. The signal colours are
 * the game's language and keep their meaning everywhere: teal is what is up
 * and who you are, blue is reading, amber is attention, green is done or out,
 * red is alarm. No other module of the world writes a colour literal; a test
 * greps for that.
 */

/** A colour as red, green and blue, each 0 to 255. */
export type Rgb = readonly [number, number, number];

// ── materials, as the lab's tungsten light shows them ──────────────────────

/** Concrete floor: a warm grey. */
export const CONCRETE: Rgb = [96, 91, 82];
/** A wall's face, the side toward the camera: painted, darker. */
export const WALL_FACE: Rgb = [70, 72, 72];
/** A wall's crown, its top: lighter than its face, catching the light. */
export const WALL_CROWN: Rgb = [104, 101, 94];
/** Steel: cabinets, desks, racks, frames. */
export const STEEL: Rgb = [92, 104, 116];
/** Brass: plaques, keys, fittings. */
export const BRASS: Rgb = [181, 149, 82];
/** Wood: planks, clipboards, the archive's shelves. */
export const WOOD: Rgb = [132, 92, 56];
/** Linoleum: the lab's clean floor. */
export const LINO: Rgb = [128, 140, 128];
/** Paper. */
export const PAPER: Rgb = [214, 205, 180];
/** Glass and glassware. */
export const GLASS: Rgb = [150, 205, 222];

// ── light ──────────────────────────────────────────────────────────────────

/** Amber warning: doors, stripes, the beacon, a prop calling for attention. */
export const AMBER: Rgb = [251, 191, 36];
/** Phosphor green: screens and their text. */
export const PHOSPHOR: Rgb = [110, 255, 150];
/** Emergency red: the emergency lamps, the escape's siren. */
export const EMERGENCY: Rgb = [255, 52, 52];
/** Cold server blue: rack LEDs and the server room's light. */
export const SERVER_BLUE: Rgb = [72, 160, 255];
/** Reactor orange: the core. */
export const REACTOR: Rgb = [255, 122, 28];
/** Tungsten: the ceiling lights with the power on. */
export const TUNGSTEN: Rgb = [255, 214, 168];

// ── signals: the game's language ───────────────────────────────────────────

/** What is up now, who you are, a plate held. */
export const TEAL: Rgb = [45, 212, 191];
/** Reading: the sources, the carryables. */
export const READ_BLUE: Rgb = [96, 165, 250];
/** Done, and the way out. */
export const DONE_GREEN: Rgb = [74, 222, 128];
/** Alarm. */
export const ALARM: Rgb = [248, 113, 113];

// ── neutrals ───────────────────────────────────────────────────────────────

/** The outline round every prop: near-black. */
export const INK: Rgb = [5, 8, 11];
/** The black beyond the lab's walls. */
export const VOID: Rgb = [4, 7, 10];
/** The darkness itself. */
export const NIGHT: Rgb = [3, 5, 9];
/** A prop's label while it calls for nobody. */
export const LABEL: Rgb = [138, 150, 165];
export const WHITE: Rgb = [255, 255, 255];
export const BLACK: Rgb = [0, 0, 0];

/** The crew's eight colours, as the server hands them out: unchanged. */
export const CREW: readonly string[] = CREW_COLORS;

/** The cold blue the dark lends every material the flashlight finds. */
const NIGHT_TINT: Rgb = [14, 22, 32];

// ── mixing ─────────────────────────────────────────────────────────────────

const clampByte = (v: number): number => Math.min(255, Math.max(0, Math.round(v)));

/** `rgb` as '#rrggbb'. */
export function css(rgb: Rgb): string {
  return `#${rgb.map((c) => clampByte(c).toString(16).padStart(2, '0')).join('')}`;
}

/** `rgb` at `alpha` (0 to 1), as a canvas takes it. */
export function rgba(rgb: Rgb, alpha: number): string {
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${clampByte(rgb[0])}, ${clampByte(rgb[1])}, ${clampByte(rgb[2])}, ${a})`;
}

/** `t` of the way from `a` to `b`. */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** `rgb` lifted `t` of the way to white: a lit edge, a highlight. */
export function lift(rgb: Rgb, t: number): Rgb {
  return mix(rgb, WHITE, t);
}

/** `rgb` sunk `t` of the way to black: a shaded side, a recess. */
export function sink(rgb: Rgb, t: number): Rgb {
  return mix(rgb, BLACK, t);
}

/**
 * A material as the flashlight finds it in the dark: much darker than under
 * the ceiling lights, and colder — the lab is made to be lit by lamps.
 */
export function night(rgb: Rgb): Rgb {
  return mix(sink(rgb, 0.6), NIGHT_TINT, 0.32);
}

/** A material in the light it stands in: the ceiling lights' (`lit`), or the dark's. */
export function inLight(rgb: Rgb, lit: boolean): Rgb {
  return lit ? rgb : night(rgb);
}

/**
 * Parses '#rgb' or '#rrggbb', as the crew's colours come.
 *
 * @throws Error for any other format, naming the accepted ones.
 */
export function parseHex(color: string): Rgb {
  if (!/^#(?:[0-9a-f]{3}){1,2}$/i.test(color)) {
    throw new Error(`palette: colour "${color}" must be '#rgb' or '#rrggbb', e.g. ${css(TEAL)}.`);
  }
  const hex = color.length === 4 ? color.replace(/[0-9a-f]/gi, '$&$&') : color;
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

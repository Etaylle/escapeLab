import { HELD_SCALE, HELD_X, HELD_Y } from '../art.js';
import { TAU } from '../brush.js';
import { smooth } from '../ease.js';
import { LAMP_RAISE, type HeroPlace } from './hero.js';

/**
 * The hand lamp in the hero's hands (menu/hero.ts) and its beam over the lab behind it
 * (lampArt.ts): where its lens is, where the beam points as it sweeps, how far its light
 * reaches, and what the scene's canvas reads of it to lay the beam (`heroLamp`). The beam sweeps
 * slowly to and fro across the menu's side of the stage, one pass in SWEEP_MS, easing at either
 * end, and holds a beat where it points at the menu's item hovered — its light fading out before
 * the menu's column, so that no word of it is ever lit. Under reduced motion it stands still.
 * Pure but for the one lamp the page holds; angles in radians as the canvas turns them, 0 to the
 * right, a quarter turn down; lengths in CSS px.
 */

/** One pass of the beam across its sweep, ms; there and back again is twice as long. */
export const SWEEP_MS = 12_000;
/** How long the beam holds where it points at the menu's item hovered, ms. */
export const BEAT_MS = 1000;
/**
 * The sweep, from the lamp: from a little down the menu's side of the picture to over the
 * menu's top item, the middle a little up from straight across.
 */
export const SWEEP = { low: Math.PI - 0.32, high: Math.PI + 0.48 } as const;
/** Where the beam stands under reduced motion: across toward the menu's middle. */
export const STILL_ANGLE = Math.PI + 0.12;
/** How far the beam's light reaches against the hero's height, before the menu stops it. */
export const REACH_SHARE = 1.45;
/** The steps a beam is drawn at: a degree, and the lamp in the hands every three. */
export const BEAM_STEP = TAU / 360;
export const LAMP_STEP = 3 * BEAM_STEP;

/**
 * The lamp as the hands hold it (lampArt.ts draws it), in its own units before the figure
 * scales a held thing to HELD_SCALE (art.ts): its lens this far ahead of the grip.
 */
export const LENS_AHEAD = 0.21;

/**
 * How far the lamp in a figure's hands turns from straight ahead to point at `angle` on the
 * picture, the figure facing the menu on its left: the art draws the figure turned round, so
 * that its ahead is the picture's left.
 */
export function tiltOf(angle: number): number {
  const turn = Math.PI - angle;
  return Math.atan2(Math.sin(turn), Math.cos(turn));
}

/**
 * Where the lens of the hero's lamp is on the stage, CSS px: in the hands before its chest
 * (art.ts HELD_X, HELD_Y) as far ahead of the grip as LENS_AHEAD, turned by `tilt`, the hero
 * placed as `place` says and its body `bob` figure units up with the breath.
 */
export function lensAt(place: HeroPlace, tilt: number, bob: number): { x: number; y: number } {
  const ahead = HELD_SCALE * LENS_AHEAD;
  const x = HELD_X + ahead * Math.cos(tilt);
  const y = HELD_Y - LAMP_RAISE.up + ahead * Math.sin(tilt) - bob;
  return { x: place.feet.x - x * place.scale, y: place.feet.y + y * place.scale };
}

/**
 * How far the beam reaches from a lens `lensX` from the stage's left: REACH_SHARE of the hero's
 * height `tall`, and never over the menu's column, which ends `menuRight` from the left.
 */
export function reachOf(tall: number, lensX: number, menuRight: number): number {
  return Math.max(0, Math.min(REACH_SHARE * tall, lensX - menuRight));
}

/** The beam's angle `run` of the way to and fro across its sweep, 0 to 2, easing at either end. */
export function sweepAngle(run: number): number {
  const u = ((run % 2) + 2) % 2;
  const across = smooth(u < 1 ? u : 2 - u);
  return SWEEP.low + (SWEEP.high - SWEEP.low) * across;
}

/** The beam's sweep as it goes: how far it has come, the frame before, a beat it holds. */
export interface Sweep {
  /** how far to and fro it has come, 0 to 2 (sweepAngle) */
  run: number;
  /** the frame before, ms; null before the first */
  last: number | null;
  /** the beat it holds: where it points, and until when, ms; null while it sweeps */
  hold: { angle: number; until: number } | null;
  /** where it points while it is turned to a place of the menu's (`aimSweep`); null else */
  aim: number | null;
}

/** A sweep at its start, at the bottom of its range. */
export function newSweep(): Sweep {
  return { run: 0, last: null, hold: null, aim: null };
}

/** How fast the beam turns to the place of the menu's item attended, radians a second. */
export const AIM_RATE = 0.9;

/**
 * How far along its sweep (0 to 2) the beam points at `angle`, held within the sweep: on the
 * pass it was on at `run`, up its range or back down.
 */
export function runAt(angle: number, run: number): number {
  const share = (withinSweep(angle) - SWEEP.low) / (SWEEP.high - SWEEP.low);
  let [low, high] = [0, 1];
  for (let k = 0; k < 24; k++) {
    const mid = (low + high) / 2;
    [low, high] = smooth(mid) < share ? [mid, high] : [low, mid];
  }
  return run < 1 ? low : 2 - low;
}

/**
 * Where the beam of `s` points at `now` while it is turned to a place of the menu's
 * (places.ts) that shows at `angle` from the lens: on toward it, AIM_RATE at most, and held
 * there, its sweep's clock standing meanwhile; let go, the sweep goes on from there (`stepSweep`).
 */
export function aimSweep(s: Sweep, now: number, angle: number): number {
  const dt = s.last === null ? 0 : Math.max(0, now - s.last);
  s.last = now;
  s.hold = null;
  const from = s.aim ?? sweepAngle(s.run);
  const to = withinSweep(angle);
  const step = (AIM_RATE * dt) / 1000;
  s.aim = Math.abs(to - from) <= step ? to : from + Math.sign(to - from) * step;
  return s.aim;
}

/** Whether a beam turning from `before` to `after` comes to `target` on the way, or onto it. */
function passes(before: number, after: number, target: number): boolean {
  return (before < target && after >= target) || (before > target && after <= target);
}

/** `angle` held within the sweep: what the beam can point at on its way. */
export function withinSweep(angle: number): number {
  return Math.min(SWEEP.high, Math.max(SWEEP.low, angle));
}

/**
 * Where the beam of `s` points at `now` (ms): on along its sweep since the frame before, and
 * holding still for BEAT_MS where it comes to `target` — the menu's item hovered, its angle from
 * the lens held within the sweep; null for none. Its clock stands while it holds, so that it
 * goes on from there after the beat.
 */
export function stepSweep(s: Sweep, now: number, target: number | null): number {
  const dt = s.last === null ? 0 : Math.max(0, now - s.last);
  s.last = now;
  if (s.aim !== null) {
    s.run = runAt(s.aim, s.run);
    s.aim = null;
  }
  if (s.hold !== null) {
    if (now < s.hold.until) {
      return s.hold.angle;
    }
    s.hold = null;
  }
  const before = sweepAngle(s.run);
  s.run = (s.run + dt / SWEEP_MS) % 2;
  const after = sweepAngle(s.run);
  if (target !== null && passes(before, after, withinSweep(target))) {
    s.hold = { angle: withinSweep(target), until: now + BEAT_MS };
    return s.hold.angle;
  }
  return after;
}

/**
 * The lamp the hero holds as the scene's canvas lays its beam (lampArt.ts): its lens in the
 * window, CSS px; where the beam points; how far its light reaches, CSS px; how far it is on,
 * 0 to 1, flickering as it does once a minute; how far it flares as an item is taken, 0 to 1.
 */
export interface HeroLamp {
  x: number;
  y: number;
  angle: number;
  reach: number;
  on: number;
  flare: number;
}

/** The steps the lamp's light and flare are laid at: two lamps a step apart lay one beam. */
const LIGHT_STEPS = 20;

/** The lamp the page holds now — the menu's hero has one — and who listens for it. */
let held: HeroLamp | null = null;
const listeners = new Set<() => void>();
/** Whether the menu's lab stands at night, its lamp the light in it (`holdNight`). */
let night = false;

/**
 * Whether the menu's lab stands at night, its lights out and the hero's lamp the light in it
 * (scene.ts `nightTo`): from the first frame a hero stands on the stage until the stage leaves
 * it no room — not while the menu is only covered by a page, or gone for the lobby, which lights
 * its scene of its own (stage.ts).
 */
export function labAtNight(): boolean {
  return night;
}

/** The lab at night (`dark`) or lit; every listener hears of it where it changes. */
export function holdNight(dark: boolean): void {
  if (night === dark) {
    return;
  }
  night = dark;
  for (const listener of [...listeners]) {
    listener();
  }
}

/** The lamp the hero holds now; null while no hero stands on the stage. */
export function heroLamp(): HeroLamp | null {
  return held;
}

/** `light` (0 to 1) at the nearest of LIGHT_STEPS steps. */
export const lightStep = (light: number): number => Math.round(light * LIGHT_STEPS) / LIGHT_STEPS;

/**
 * The beam `lamp` lays, as a key: its lens's pixel, its reach, the step it points at, how far it
 * is on and flares — two lamps with one key lay the same beam; `none` for no lamp.
 */
export function lampKey(lamp: HeroLamp | null): string {
  if (lamp === null) {
    return 'none';
  }
  const [x, y, reach, step] = [lamp.x, lamp.y, lamp.reach, lamp.angle / BEAM_STEP].map(Math.round);
  return `${x},${y} ${reach} ${step} ${lightStep(lamp.on)} ${lightStep(lamp.flare)}`;
}

/**
 * The hero holds `lamp` now — null: no lamp, the hero gone — and every listener hears of it
 * where its beam would look otherwise than before.
 */
export function holdLamp(lamp: HeroLamp | null): void {
  const same = lampKey(held) === lampKey(lamp);
  held = lamp;
  if (same) {
    return;
  }
  for (const listener of [...listeners]) {
    listener();
  }
}

/** Tells `changed` whenever the beam the lamp lays, or the night, changes; returns its stop. */
export function watchLamp(changed: () => void): () => void {
  listeners.add(changed);
  return () => {
    listeners.delete(changed);
  };
}

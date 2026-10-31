import { hashTile, TAU } from './brush.js';

/**
 * The bible's motion rule as a clock: the lab's ambient motion — fans,
 * scrolling screens, blinking LEDs, the core's pulse, steam and dust — moves
 * slowly and in small steps, updated at most ANIM_HZ times a second however
 * fast the frames come, and nothing in it outruns a walking crew member but
 * the sparks of a short. And the life of the lab's things on that clock, all
 * of it pure: how a screen's tube flickers and its roll bar drifts, how a
 * rack's LEDs blink, an oscilloscope's trace, a cable swinging after the
 * blackout, a ceiling fan spinning up and coasting down, a sheet of paper
 * fluttering in its draught.
 */

/** How often a second the ambient motion and the particles step. */
export const ANIM_HZ = 15;

/** How fast the crew walks, tiles a second (sim.ts): nothing ambient moves faster. */
export const WALK_SPEED = 4.2;

/** The step of the animation clock at sim time `time` (s): it counts ANIM_HZ a second. */
export function animTick(time: number): number {
  return Math.floor(time * ANIM_HZ);
}

/** The animation clock at sim time `time` (s), s: `time` held still between two steps. */
export function animTime(time: number): number {
  return animTick(time) / ANIM_HZ;
}

/** A thing's own number from its tile: its flicker and its blinking out of step with the rest. */
export function propSeed(x: number, y: number): number {
  return x * 131 + y * 7919;
}

/** A share of 1 from a hash: the same `seed`, `n` and `salt`, the same share. */
function share(seed: number, n: number, salt: number): number {
  return (hashTile(seed, n, salt) % 10_000) / 10_000;
}

// ── a screen's tube ──────────────────────────────────────────────────────────

/** How bright a CRT burns at the least between its dips, and at the bottom of a dip. */
export const CRT_LOW = 0.92;
export const CRT_DIP = 0.82;
/** How often a step of the clock dips a tube. */
const DIP_ODDS = 0.06;

/**
 * How brightly the tube of the screen `seed` burns at the animation clock `t` (s), as share of
 * its full: wavering between CRT_LOW and full, now and then dipping to CRT_DIP — a light
 * blinking, which reduced motion keeps — stepped with the clock, each screen out of step.
 */
export function crtFlicker(t: number, seed: number): number {
  const step = Math.round(t * ANIM_HZ);
  if (share(seed, step, 31) < DIP_ODDS) {
    return CRT_DIP;
  }
  return CRT_LOW + (1 - CRT_LOW) * share(seed, step, 37);
}

/** How long a CRT's roll bar takes to drift down the screen once, s. */
export const ROLL_S = 3.4;

/**
 * Where the roll bar of the screen `seed` lies at the clock `t` (s), 0 (top) to 1 (bottom),
 * drifting down once every ROLL_S; null under reduced motion, where nothing scrolls.
 */
export function rollAt(t: number, seed: number, reduced: boolean): number | null {
  if (reduced) {
    return null;
  }
  const u = t / ROLL_S + share(seed, 0, 41);
  return u - Math.floor(u);
}

// ── a rack's LEDs ──────────────────────────────────────────────────────────

/**
 * How a rack's LED blinks — none of it says how a service is doing: lit steady, a heartbeat's
 * double blink, the flutter of disk activity, a slow blink, or one light chasing along a row.
 */
export const LED_PATTERNS = ['steady', 'heartbeat', 'activity', 'slow', 'chase'] as const;
export type LedPattern = (typeof LED_PATTERNS)[number];

/** The pattern the LED `id` blinks in: its own, the same every run. */
export function ledPattern(id: number): LedPattern {
  return LED_PATTERNS[hashTile(0x1ed, id, 3) % LED_PATTERNS.length] ?? 'steady';
}

/** A heartbeat's cycle, s, and its two blinks as shares of it: [from, to). */
const HEARTBEAT_S = 1.2;
const BEATS = [
  [0, 0.12],
  [0.24, 0.36],
] as const;

/**
 * Whether the LED `id`, `k`th in its row, is lit at the animation clock `t` (s) as its pattern
 * blinks: the clock alone says, so a rack tells nothing of the run.
 */
export function ledLit(id: number, k: number, t: number): boolean {
  const step = Math.round(t * ANIM_HZ);
  switch (ledPattern(id)) {
    case 'steady':
      return true;
    case 'heartbeat': {
      const u = (t / HEARTBEAT_S + share(id, 0, 5)) % 1;
      return BEATS.some(([from, to]) => u >= from && u < to);
    }
    case 'activity': {
      const burst = Math.floor(step / 9);
      return share(id, burst, 7) < 0.55 && share(id, step, 11) < 0.6;
    }
    case 'slow':
      return Math.floor(t + share(id, 0, 13) * 2) % 2 === 0;
    case 'chase':
      return Math.floor(t * 3) % 3 === k % 3;
  }
}

// ── an oscilloscope ────────────────────────────────────────────────────────

/**
 * The trace of the oscilloscope `seed` at `u` across its screen (0 to 1), at the clock `t`
 * (s): a wave of its own frequency travelling across, beating slowly, with a little noise —
 * from -1 to 1. Under reduced motion the caller holds `t` at 0: the trace stands still.
 */
export function scopeTrace(u: number, t: number, seed: number): number {
  const cycles = 1.5 + share(seed, 0, 17) * 2;
  const travel = t * (0.6 + share(seed, 0, 19) * 0.6);
  const beat = 0.65 + 0.35 * Math.sin(t * 0.9 + seed);
  const noise = (share(seed, Math.round(u * 40) + Math.round(t * ANIM_HZ) * 41, 23) - 0.5) * 0.12;
  return Math.max(-1, Math.min(1, beat * Math.sin(TAU * (u * cycles - travel)) + noise));
}

// ── a cable swinging after the blackout ────────────────────────────────────

/** How long a loose cable swings after the blackout's thunk, ms; its first swing, radians. */
export const SWING_MS = 3000;
export const SWING = 0.32;
/** One swing there and back, ms, and how fast it dies away. */
const SWING_PERIOD_MS = 900;
const SWING_DECAY_MS = 1000;

/**
 * How far a loose cable hangs off plumb `ms` after the blackout's thunk, radians: knocked by
 * the thunk, swinging there and back and dying away within SWING_MS; plumb before it, after
 * it, and under reduced motion.
 */
export function cableSwing(ms: number | null, reduced: boolean): number {
  if (ms === null || reduced || ms < 0 || ms >= SWING_MS) {
    return 0;
  }
  const fade = 1 - ms / SWING_MS;
  return SWING * Math.exp(-ms / SWING_DECAY_MS) * fade * Math.sin((TAU * ms) / SWING_PERIOD_MS);
}

// ── a ceiling fan ──────────────────────────────────────────────────────────

/**
 * A ceiling fan at full speed, radians a second — its blades' tips well slower than a walking
 * crew member — and how long it takes to spin up or to coast down, s.
 */
export const FAN_SPEED = 5;
export const FAN_SPIN_UP = 1.4;
export const FAN_COAST = 3.5;

/** A fan's turn: where its blades stand, radians, and how fast it turns, radians a second. */
export interface FanSpin {
  angle: number;
  speed: number;
}

/** A fan's turn kept from frame to frame, and the animation clock it was stepped to, s. */
export interface FanState extends FanSpin {
  at: number;
}

/**
 * The fan `spin` a step of `dt` seconds later with its room's power `power` (0 to 1): speeding
 * up toward FAN_SPEED × power, or coasting down without it, the blades turning on as fast as
 * it turns. Under reduced motion it stands still.
 */
export function spinFan(spin: FanSpin, power: number, dt: number, reduced: boolean): FanSpin {
  if (reduced) {
    return { angle: spin.angle, speed: 0 };
  }
  const step = Math.max(0, dt);
  const target = FAN_SPEED * Math.max(0, Math.min(1, power));
  const tau = target > spin.speed ? FAN_SPIN_UP : FAN_COAST;
  const speed = target + (spin.speed - target) * Math.exp(-step / tau);
  const angle = (spin.angle + ((spin.speed + speed) / 2) * step) % TAU;
  return { angle, speed };
}

/**
 * How far the corner of a sheet under a fan turning at `speed` (radians a second) lifts at the
 * clock `t` (s), 0 to 1: lying flat under a fan at rest, fluttering more the faster it turns.
 */
export function paperFlutter(speed: number, t: number, seed: number): number {
  const draught = Math.min(1, Math.max(0, speed / FAN_SPEED));
  const flutter = 0.5 + 0.5 * Math.sin(t * 7.3 + seed) * Math.sin(t * 2.9 + seed * 0.5);
  return draught * (0.35 + 0.65 * flutter);
}

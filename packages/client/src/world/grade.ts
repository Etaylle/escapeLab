import { smooth } from './ease.js';
import { lift, mix, SERVER_BLUE, sink, STEEL, TUNGSTEN, type Rgb } from './palette.js';

/**
 * A colour grade for each phase of a run — the way Alien: Isolation turns its corridors cold
 * when the power fails and Dead Cells keeps a scene's colours in one key: the lab with its power
 * warm and clean, the blackout a cool blue-grey, the escape as it is — its siren red stays its
 * own — and a run won bright. A grade is a wash: a colour laid over the picture at a strength,
 * once a frame over the whole world, under the light added over it, so that what glows keeps
 * its colour — the emergency lamps' red above all. From one phase to the next the grade turns
 * over GRADE_TURN_MS, under reduced motion as well: a cross-fade, nothing moving. Pure: the
 * Canvas pass lays it as one fill (render/grade.ts), the light layer folds it into its light
 * map (gl/lightLayer.ts).
 */

/** The phases of a run a grade belongs to. */
export type GradePhase = 'normal' | 'blackout' | 'escape' | 'won';

/** A wash: a colour laid over the picture at `alpha`, 0 to 1. */
export interface Wash {
  rgb: Rgb;
  alpha: number;
}

/** How long one grade takes to turn into the next, ms. */
export const GRADE_TURN_MS = 1500;

/**
 * Each phase's grade. A wash of a middle tone shifts the picture's colour more than its
 * brightness: the lab with its power a warm mid-tone, faint, so that its blacks stay clean; the
 * blackout a dark blue-grey, its shadows cold and its light dimmed; a run won near white.
 */
export const GRADES: Readonly<Record<GradePhase, Wash>> = {
  normal: { rgb: sink(TUNGSTEN, 0.25), alpha: 0.05 },
  blackout: { rgb: sink(mix(STEEL, SERVER_BLUE, 0.3), 0.3), alpha: 0.1 },
  escape: { rgb: STEEL, alpha: 0 },
  won: { rgb: lift(TUNGSTEN, 0.55), alpha: 0.12 },
};

/** What decides a frame's phase. */
export interface PhaseOf {
  /** the lab has its power: the cold open has not run yet (coldOpen.ts) */
  powered: boolean;
  /** the escape has begun on this screen and its red has come (escape.ts) */
  escaping: boolean;
  /** the run is won and its end plays on this screen (finale.ts) */
  won: boolean;
}

/** The phase a frame stands in: won, escaping, with the power on, or in the blackout. */
export function gradePhase({ powered, escaping, won }: PhaseOf): GradePhase {
  if (won) {
    return 'won';
  }
  if (escaping) {
    return 'escape';
  }
  return powered ? 'normal' : 'blackout';
}

/** `t` of the way from wash `a` to wash `b`: their colours mixed as far as each lies on. */
export function blend(a: Wash, b: Wash, t: number): Wash {
  const alpha = a.alpha + (b.alpha - a.alpha) * t;
  if (alpha <= 0) {
    return { rgb: b.rgb, alpha: 0 };
  }
  const channel = (i: 0 | 1 | 2): number =>
    (a.rgb[i] * a.alpha * (1 - t) + b.rgb[i] * b.alpha * t) / alpha;
  return { rgb: [channel(0), channel(1), channel(2)], alpha };
}

/** A grade turning: the phase it turns into, the wash it turns from, and since when, ms. */
export interface GradeTurn {
  phase: GradePhase;
  from: Wash;
  since: number;
}

/** The wash of `turn` at `now`, ms: eased in and out over GRADE_TURN_MS. */
export function washOf(turn: GradeTurn, now: number): Wash {
  return blend(turn.from, GRADES[turn.phase], smooth((now - turn.since) / GRADE_TURN_MS));
}

/**
 * The grade at `now` (ms) for a frame in `phase`, turning from where `turn` stood: a new turn
 * where the phase changed — from the wash of the moment — the same where it did not, a first
 * one in the phase's own grade. Returns the turn to keep and its wash now.
 */
export function gradeAt(
  turn: GradeTurn | null,
  phase: GradePhase,
  now: number,
): { turn: GradeTurn; wash: Wash } {
  if (turn === null) {
    const first = { phase, from: GRADES[phase], since: now };
    return { turn: first, wash: GRADES[phase] };
  }
  if (turn.phase === phase) {
    return { turn, wash: washOf(turn, now) };
  }
  const next = { phase, from: washOf(turn, now), since: now };
  return { turn: next, wash: next.from };
}

/** What a colour `rgb` comes out as under `wash`: as the Canvas pass's fill lays it. */
export function washed(rgb: Rgb, wash: Wash): Rgb {
  return mix(rgb, wash.rgb, wash.alpha);
}

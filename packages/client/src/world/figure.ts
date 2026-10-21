import { hashTile, TAU } from './brush.js';
import { smooth } from './ease.js';
import type { CarryableKind } from './hazards.js';

/**
 * A crew member's pose from what they do and what the run does around them —
 * pure, so that the world, the lobby and the title cards stand their figures
 * alike (art.ts's drawScientist draws it):
 *
 *   standing   the body breathes, a pixel up and down every 3 s; after 2 s
 *              standing still the figure looks round, a glance of 1.6 s to
 *              one side every 4 to 7 s
 *   speaking   a light sweeps across the visor every 0.6 s, the body bobbing
 *              2 px in its rhythm
 *   carrying   both arms forward, the item held before the chest
 *   an alarm   a flinch: squashed, a 4 px hop stretched and back down within
 *              200 ms, the arms flung out and lowered within 400 ms
 *   won        a jump every 1.6 s, the arms up and waving, the shadow shrinking
 *              under the figure as it rises
 *   lost       slumped: the body sagged 2 px and bowed, the visor dimmed, the
 *              arms down
 *   ready      in the lobby: a wave of the arm for 1.8 s
 *
 * Lengths are in tiles — PX is a pixel at the art's 64 px a tile — angles in
 * radians, times in ms. Every crew member runs each loop at an offset of
 * their own (figurePhase), so no two breathe, glance or jump in step. The art
 * bible's motion rule holds: slow and small, nothing faster than a walking
 * figure but the flinch. Under reduced motion every pose holds its resting
 * frame: a figure carrying still holds the item, one celebrating holds its
 * arms up, and nothing else moves.
 */

/** How the crew stands: playing, celebrating a run won, slumped over one lost. */
export type FigureMood = 'play' | 'celebrate' | 'slump';

/** What a crew member does and what happens round them, as the pose follows it. */
export interface FigureState {
  moving: boolean;
  /** where the figure faces, radians: 0 right, PI/2 toward the viewer */
  facing: number;
  /** what it carries, by kind; null for empty hands */
  carrying: CarryableKind | null;
  speaking: boolean;
  /** how long ago the last alarm came in on this screen, ms; null for none */
  alarmAgoMs: number | null;
  /** how long ago the player said they were ready, ms — the lobby's wave; null for none */
  readyAgoMs: number | null;
  mood: FigureMood;
  /** the figure's clock, ms */
  t: number;
  /** how long the figure has stood still, ms; 0 while it walks */
  idleMs: number;
  /** the figure's own offset into every loop, 0 to 1 (figurePhase) */
  phase: number;
  /** the player asked for less motion: every pose holds its resting frame */
  reduced: boolean;
}

/**
 * The arms, each an angle from hanging straight down, toward the figure's
 * front positive. Hanging, they stay behind the body, out of sight; raised
 * or reaching they show past its outline.
 */
export interface Arms {
  /** the arm at the body's front, under the visor */
  front: number;
  /** the arm at its back, by the pack; holding, it reaches forward from beside the front one */
  back: number;
}

/** How a crew member stands in one frame. */
export interface FigurePose {
  /** how far the whole figure is off the ground, tiles: a hop, a jump */
  rise: number;
  /** how far the body rides up over its legs, tiles: breathing, speaking; below 0 it sags */
  bob: number;
  /** squash and stretch about the feet: the height times this, the width divided by it */
  stretch: number;
  /** how far the figure bows forward, radians */
  bow: number;
  /** where the figure looks, radians: its facing, turned by a glance */
  look: number;
  /** the arms; null leaves them hanging at the sides, out of sight, as a figure stands */
  arms: Arms | null;
  /** both hands hold what is carried before the chest */
  holding: boolean;
  /** the light sweeping across the visor, 0 (its back) to 1 (its front); null while silent */
  shimmer: number | null;
  /** how far the visor is dimmed, 0 to 1 */
  dim: number;
  /** the foot shadow's size: 1 with both feet on the ground, smaller in the air */
  shadow: number;
}

/** A pixel of the art at 64 px a tile (art bible: the 2 px outline). */
export const PX = 1 / 64;

/** Breathing: one breath, ms, and how far the body rises and falls with it. */
export const BREATH_MS = 3000;
export const BREATH = PX;

/** How long a figure stands still before it looks round, ms. */
export const IDLE_LOOK_MS = 2000;
/**
 * The glances: one in every slot of GLANCE_SLOT_MS, starting up to
 * GLANCE_JITTER_MS into it — one every 4 to 7 s — each GLANCE_MS long,
 * turning the look GLANCE to one side and back.
 */
export const GLANCE_SLOT_MS = 5500;
export const GLANCE_JITTER_MS = 1500;
export const GLANCE_MS = 1600;
const GLANCE_TURN_MS = 500;
export const GLANCE = 1.1;

/** Speaking: the visor's light sweeps once every SHIMMER_MS, the body bobbing TALK_BOB with it. */
export const SHIMMER_MS = 600;
export const TALK_BOB = 2 * PX;

/** The flinch at an alarm: its arms out this long, ms; the hop within HOP_MS, HOP high. */
export const FLINCH_MS = 400;
export const HOP_MS = 200;
export const HOP = 4 * PX;
/** The squash before the hop, ms, and how far it squashes and then stretches. */
const FLINCH_SQUASH_MS = 50;
const FLINCH_SQUASH = 0.14;
const FLINCH_STRETCH = 0.12;
/** How fast the arms fly out at an alarm, ms. */
const STARTLE_MS = 60;

/** Won: one jump every JUMP_MS, JUMP high at its top. */
export const JUMP_MS = 1600;
export const JUMP = 10 * PX;
/** Where in the jump's loop (0 to 1) the crouch ends, the flight ends and the landing settles. */
const CROUCH_END = 0.12;
const FLIGHT_END = 0.62;
const LAND_END = 0.76;
const JUMP_SQUASH = 0.12;
const JUMP_STRETCH = 0.1;

/** Lost: how far the body sags, the figure bows and the visor dims. */
export const SAG = 2 * PX;
const SLUMP_BOW = 0.09;
const SLUMP_DIM = 0.6;

/** The lobby: a wave of the arm this long after the player says they are ready, ms. */
export const WAVE_MS = 1800;
/** How long the waving arm takes to come up, and to go down again, ms. */
const WAVE_RAISE_MS = 400;
/** One wag of the waving hand, ms. */
const WAG_MS = 500;

/** The arms' poses: holding before the chest, raised in a cheer, waving, flung out in a flinch. */
const HOLD: Arms = { front: 1.35, back: 1.45 };
const CHEER = 2.5;
const CHEER_WAG = 0.15;
const WAVE = 2.45;
const WAVE_WAG = 0.15;
const STARTLE = 1.8;

/** How far the shadow shrinks at the top of a jump, as a share of its size. */
const SHADOW_SHRINK = 0.45;

/** The number of 32-bit values: a hash over it is a share of 1. */
const UINT32 = 2 ** 32;

/**
 * A crew member's own offset into every loop, 0 to 1, from their player id
 * (FNV-1a): the same id, the same offset, on every screen.
 */
export function figurePhase(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  }
  return (h >>> 0) / UINT32;
}

/** Where a figure stands at rest, facing `facing`: on its feet, still, its arms down. */
export function restingPose(facing: number): FigurePose {
  return {
    rise: 0,
    bob: 0,
    stretch: 1,
    bow: 0,
    look: facing,
    arms: null,
    holding: false,
    shimmer: null,
    dim: 0,
    shadow: 1,
  };
}

/** How `s` stands this frame. */
export function figurePose(s: FigureState): FigurePose {
  const body = s.reduced ? stillBody(s) : bodyOf(s);
  return {
    ...body,
    look: s.facing + glanceOf(s),
    arms: armsOf(s),
    holding: s.carrying !== null,
    shimmer: s.speaking && !s.reduced ? loopAt(s.t, SHIMMER_MS, s.phase) : null,
    dim: s.mood === 'slump' ? SLUMP_DIM : 0,
    shadow: 1 - (SHADOW_SHRINK * body.rise) / JUMP,
  };
}

/** The body's part of a pose: off the ground, over its legs, squashed or stretched, bowed. */
type Body = Pick<FigurePose, 'rise' | 'bob' | 'stretch' | 'bow'>;

const STILL: Body = { rise: 0, bob: 0, stretch: 1, bow: 0 };
const SLUMPED: Body = { rise: 0, bob: -SAG, stretch: 1, bow: SLUMP_BOW };

/** The body under reduced motion: still, a slumped figure in its slump. */
function stillBody(s: FigureState): Body {
  return s.mood === 'slump' ? SLUMPED : STILL;
}

/** The body moving: the jump, the slump, the flinch, the speaking bob or the breath. */
function bodyOf(s: FigureState): Body {
  if (s.mood === 'celebrate') {
    return { ...jumpAt(loopAt(s.t, JUMP_MS, s.phase)), bob: 0, bow: 0 };
  }
  if (s.mood === 'slump') {
    return SLUMPED;
  }
  if (flinching(s)) {
    return { ...flinchAt(s.alarmAgoMs ?? 0), bob: 0, bow: 0 };
  }
  if (s.speaking) {
    const beat = 0.5 - 0.5 * Math.cos(TAU * loopAt(s.t, SHIMMER_MS, s.phase));
    return { ...STILL, bob: TALK_BOB * beat };
  }
  if (s.moving) {
    return STILL;
  }
  return { ...STILL, bob: BREATH * Math.sin(TAU * loopAt(s.t, BREATH_MS, s.phase)) };
}

/** Whether an alarm came in recently enough for the figure to flinch at it. */
function flinching(s: FigureState): boolean {
  return s.alarmAgoMs !== null && s.alarmAgoMs >= 0 && s.alarmAgoMs <= FLINCH_MS;
}

/** How far into a loop of `period` ms the clock `t` stands for a figure at `phase`, 0 to 1. */
function loopAt(t: number, period: number, phase: number): number {
  const u = t / period + phase;
  return u - Math.floor(u);
}

/**
 * The jump `u` into its loop (0 to 1): a crouch, squashed; the flight, a
 * parabola JUMP high, stretched while it is fast; the landing, squashed and
 * settling; then a moment on the ground.
 */
export function jumpAt(u: number): Pick<FigurePose, 'rise' | 'stretch'> {
  if (u < CROUCH_END) {
    return { rise: 0, stretch: 1 - JUMP_SQUASH * smooth(u / CROUCH_END) };
  }
  if (u < FLIGHT_END) {
    const s = (u - CROUCH_END) / (FLIGHT_END - CROUCH_END);
    return { rise: JUMP * 4 * s * (1 - s), stretch: 1 + JUMP_STRETCH * Math.abs(1 - 2 * s) };
  }
  if (u < LAND_END) {
    const s = (u - FLIGHT_END) / (LAND_END - FLIGHT_END);
    return { rise: 0, stretch: 1 - JUMP_SQUASH * (1 - smooth(s)) };
  }
  return { rise: 0, stretch: 1 };
}

/**
 * The flinch `ms` after an alarm: squashed for FLINCH_SQUASH_MS, then a hop
 * HOP high, stretched out of the squash and easing back as it lands by
 * HOP_MS; on its feet again after.
 */
export function flinchAt(ms: number): Pick<FigurePose, 'rise' | 'stretch'> {
  if (ms < FLINCH_SQUASH_MS) {
    return { rise: 0, stretch: 1 - FLINCH_SQUASH * smooth(ms / FLINCH_SQUASH_MS) };
  }
  if (ms < HOP_MS) {
    const s = (ms - FLINCH_SQUASH_MS) / (HOP_MS - FLINCH_SQUASH_MS);
    return { rise: HOP * Math.sin(Math.PI * s), stretch: 1 + FLINCH_STRETCH * (1 - s) };
  }
  return { rise: 0, stretch: 1 };
}

/** The arms: holding, cheering, waving or flung out; null where they hang out of sight. */
function armsOf(s: FigureState): Arms | null {
  if (s.carrying !== null) {
    return HOLD;
  }
  if (s.mood === 'celebrate') {
    return cheerAt(s.reduced ? 0 : loopAt(s.t, JUMP_MS, s.phase), s.reduced);
  }
  if (s.reduced || s.mood === 'slump') {
    return null;
  }
  if (s.readyAgoMs !== null && s.readyAgoMs >= 0 && s.readyAgoMs < WAVE_MS) {
    return waveAt(s.readyAgoMs);
  }
  return flinching(s) ? startleAt(s.alarmAgoMs ?? 0) : null;
}

/** Both arms up, wagging twice a jump `u` into its loop; held still under reduced motion. */
function cheerAt(u: number, still: boolean): Arms {
  const wag = still ? 0 : CHEER_WAG * Math.sin(2 * TAU * u);
  return { front: CHEER + wag, back: -(CHEER - wag) };
}

/** The front arm raised and wagging `ms` into the wave, rising at its start, sinking at its end. */
function waveAt(ms: number): Arms {
  const down = ms - (WAVE_MS - WAVE_RAISE_MS);
  const up = smooth(ms / WAVE_RAISE_MS) * (1 - smooth(down / WAVE_RAISE_MS));
  return { front: up * (WAVE + WAVE_WAG * Math.sin((TAU * ms) / WAG_MS)), back: 0 };
}

/** Both arms flung out at once `ms` after an alarm and lowered again by FLINCH_MS. */
function startleAt(ms: number): Arms {
  const up = smooth(ms / STARTLE_MS) * (1 - smooth((ms - HOP_MS) / (FLINCH_MS - HOP_MS)));
  return { front: STARTLE * up, back: -STARTLE * up };
}

/**
 * The glance the look turns by `s.t`: none while the figure walks, plays no
 * longer or moves less (reduced motion); otherwise, once it has stood still
 * for IDLE_LOOK_MS before a glance begins, a turn of GLANCE to one side and
 * back over GLANCE_MS, one in each slot of GLANCE_SLOT_MS.
 */
function glanceOf(s: FigureState): number {
  if (s.reduced || s.moving || s.mood !== 'play') {
    return 0;
  }
  const seed = Math.floor(s.phase * UINT32);
  const t = s.t + s.phase * GLANCE_SLOT_MS;
  const slot = Math.floor(t / GLANCE_SLOT_MS);
  const into = t - slot * GLANCE_SLOT_MS - (hashTile(seed, slot, 0) % GLANCE_JITTER_MS);
  if (into < 0 || into >= GLANCE_MS || s.idleMs - into < IDLE_LOOK_MS) {
    return 0;
  }
  const side = hashTile(seed, slot, 1) % 2 === 0 ? 1 : -1;
  return side * GLANCE * turnedAt(into);
}

/** How far a glance `ms` in has turned, 0 to 1: turning out, holding, turning back. */
function turnedAt(ms: number): number {
  const back = ms - (GLANCE_MS - GLANCE_TURN_MS);
  return smooth(ms / GLANCE_TURN_MS) * (1 - smooth(back / GLANCE_TURN_MS));
}

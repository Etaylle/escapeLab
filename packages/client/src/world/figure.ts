import type { PartKind } from '@escapelab/core';
import { hashTile, TAU } from './brush.js';
import { smooth } from './ease.js';

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
 *   walking    the legs swing in a cycle tied to the ground covered (strideAt,
 *              gaitStep), the arms swinging against them, the body a pixel up
 *              as they pass, leaning into the way it walks; the lamp in its
 *              hands sways with the step (handLamp)
 *   at a console  both hands up on the panel, tapping at it
 *   reading    holding the sheet before the chest, the head bowed over it
 *   turning    round to face the other side of the picture: in TURN_STEPS
 *              steps through the side toward the camera, not at once (turnOf)
 *
 * Lengths are in tiles — PX is a pixel at the art's 64 px a tile — angles in
 * radians, times in ms. Every crew member runs each loop at an offset of
 * their own (figurePhase), so no two breathe, glance or jump in step. The art
 * bible's motion rule holds: slow and small, nothing faster than a walking
 * figure but the flinch. Under reduced motion every pose holds its resting
 * frame: a figure carrying still holds the item, one celebrating holds its
 * arms up, one at a console or reading holds that pose — its arms still —
 * and nothing else moves: no swing, no tapping, no turn but at once.
 */

/** How the crew stands: playing, celebrating a run won, slumped over one lost. */
export type FigureMood = 'play' | 'celebrate' | 'slump';

/** What a crew member is busy with where they stand: at a console, reading a sheet; or nothing. */
export type FigureTask = 'console' | 'reading' | null;

/** What a crew member does and what happens round them, as the pose follows it. */
export interface FigureState {
  moving: boolean;
  /** where the figure faces, radians: 0 right, PI/2 toward the viewer */
  facing: number;
  /** what it carries, by kind; null for empty hands */
  carrying: PartKind | null;
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
  /** the walk cycle, 0 to 1 (strideAt): the arms swing in it */
  walk: number;
  /** what it is busy with where it stands */
  task: FigureTask;
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
export const HOLD: Arms = { front: 1.35, back: 1.45 };
/** How far the arms swing either way of hanging as the figure walks, radians. */
export const ARM_SWING = 0.5;
/** Both hands up on a console's panel, and how far they tap at it, at TAP_MS a tap. */
const CONSOLE: Arms = { front: 2.0, back: 2.1 };
const TAP = 0.08;
const TAP_MS = 260;
/** Holding a sheet to read it, the head bowed over it and turned down toward it. */
const READ: Arms = { front: 1.2, back: 1.3 };
export const READ_BOW = 0.07;
export const READ_TILT = 0.7;
const CHEER = 2.5;
const CHEER_WAG = 0.15;
const WAVE = 2.45;
const WAVE_WAG = 0.15;
const STARTLE = 1.8;

/** How far the shadow shrinks at the top of a jump, as a share of its size. */
const SHADOW_SHRINK = 0.45;

/**
 * The walk: one cycle of the legs — two steps, a footfall each — every GAIT_CYCLE tiles walked,
 * so the legs keep pace with the ground whatever the speed: a sprint swings them as much
 * faster as it runs, a partner easing in slows them as it slows. Standing, the legs stand at
 * HIP_X either side of the middle; walking, the hips draw in to WALK_HIP and each foot swings
 * STRIDE ahead of its hip and as far behind — past the other foot, so the legs truly take
 * turns leading — lifting STEP_LIFT at most as it swings forward. The body rides a pixel higher
 * while the legs pass each other than at full stride (WALK_BOB), and leans LEAN into the way it
 * walks — as far as that way runs across the picture: a figure walking up or down the screen
 * does not tilt.
 */
export const GAIT_CYCLE = 1.75;
export const HIP_X = 0.12;
export const WALK_HIP = 0.025;
export const STRIDE = 0.125;
export const STEP_LIFT = 0.035;
export const WALK_BOB = PX;
export const LEAN = 0.06;

/** Where one foot is in the walk: across the figure (facing right, tiles) and off the ground. */
export interface Foot {
  x: number;
  lift: number;
}

/** The legs in one frame of the walk, and how far the body rides up over them (negative: up). */
export interface Stride {
  /** the leg at the figure's front, the one its visor looks past */
  front: Foot;
  /** the leg at its back, by the pack: half a cycle behind the front one */
  back: Foot;
  bob: number;
}

/** Both feet on the ground under the hips, the body down: a figure standing. */
export const STANDING: Stride = {
  front: { x: HIP_X, lift: 0 },
  back: { x: -HIP_X, lift: 0 },
  bob: 0,
};

/** The walk cycle `phase` (0 to 1) on from where it stood, `tiles` further on. */
export function gaitStep(phase: number, tiles: number): number {
  const next = phase + Math.max(0, tiles) / GAIT_CYCLE;
  return next - Math.floor(next);
}

/**
 * The legs `phase` (0 to 1) into the walk cycle: the front foot swings forward lifted and walks
 * back planted, the back foot half a cycle behind it; at a quarter the front foot leads, at
 * three quarters the back one, the body highest as they pass each other (phase 0 and 0.5) and
 * lowest with both planted wide. A figure standing stands on both feet.
 */
export function strideAt(phase: number, moving: boolean): Stride {
  if (!moving) {
    return STANDING;
  }
  const theta = phase * TAU;
  const swing = Math.sin(theta) * STRIDE;
  const raise = Math.cos(theta) * STEP_LIFT;
  return {
    front: { x: WALK_HIP + swing, lift: Math.max(0, raise) },
    back: { x: -WALK_HIP - swing, lift: Math.max(0, -raise) },
    bob: -Math.abs(Math.cos(theta)) * WALK_BOB,
  };
}

/** How far a figure walking toward `facing` leans into it, radians: by how far it runs sideways. */
export function leanOf(facing: number, moving: boolean): number {
  return moving ? LEAN * Math.abs(Math.cos(facing)) : 0;
}

/**
 * The flashlight in a figure's hands: before its chest toward where it faces — HAND_AHEAD
 * across the picture, less up or down it, as the view is foreshortened — riding the body's bob,
 * and swaying with the step, SWAY either way of the facing once a stride. A figure standing,
 * or one asked to move less, holds it still before it.
 */
export const HAND_AHEAD = 0.16;
export const HAND_DEPTH = 0.1;
export const SWAY = 0.035;
/** How far the lamp's light rocks across the beam with the step, tiles. */
export const SWAY_SIDE = 0.012;

/** Where the light a figure carries comes from, and where it points. */
export interface HandLamp {
  x: number;
  y: number;
  facing: number;
}

/** The lamp in the hands of a figure at (x, y) facing `facing`, `phase` into its walk. */
export function handLamp(
  at: { x: number; y: number; facing: number; moving: boolean },
  phase: number,
  reduced: boolean,
): HandLamp {
  const { facing } = at;
  const swaying = at.moving && !reduced;
  const theta = phase * TAU;
  const sway = swaying ? Math.sin(theta) : 0;
  const bob = swaying ? strideAt(phase, true).bob : 0;
  const side = SWAY_SIDE * sway;
  return {
    x: at.x + Math.cos(facing) * HAND_AHEAD - Math.sin(facing) * side,
    y: at.y + Math.sin(facing) * HAND_DEPTH + Math.cos(facing) * side + bob,
    facing: facing + SWAY * sway,
  };
}

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
  const reading = readingOf(s);
  return {
    ...body,
    bow: body.bow + (reading ? READ_BOW : 0),
    look: s.facing + (reading ? readTilt(s.facing) : glanceOf(s)),
    arms: armsOf(s),
    holding: s.carrying !== null || reading,
    shimmer: s.speaking && !s.reduced ? loopAt(s.t, SHIMMER_MS, s.phase) : null,
    dim: s.mood === 'slump' ? SLUMP_DIM : 0,
    shadow: 1 - (SHADOW_SHRINK * body.rise) / JUMP,
  };
}

/** Whether `s` reads a sheet: standing still at one, its hands free, the run still on. */
function readingOf(s: FigureState): boolean {
  return s.task === 'reading' && s.carrying === null && !s.moving && s.mood === 'play';
}

/** How far a figure reading turns its look down over the sheet, staying on its side. */
function readTilt(facing: number): number {
  return Math.cos(facing) < 0 ? -READ_TILT : READ_TILT;
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

/**
 * The arms: holding, cheering, at a console or reading, waving, flung out or swinging as the
 * figure walks; null where they hang out of sight.
 */
function armsOf(s: FigureState): Arms | null {
  if (s.carrying !== null) {
    return HOLD;
  }
  if (s.mood === 'celebrate') {
    return cheerAt(s.reduced ? 0 : loopAt(s.t, JUMP_MS, s.phase), s.reduced);
  }
  const task = taskArms(s);
  if (task !== null || s.reduced || s.mood === 'slump') {
    return task;
  }
  return movingArms(s);
}

/** The arms moving on their own: waving ready, flung out at an alarm, swinging as it walks. */
function movingArms(s: FigureState): Arms | null {
  if (s.readyAgoMs !== null && s.readyAgoMs >= 0 && s.readyAgoMs < WAVE_MS) {
    return waveAt(s.readyAgoMs);
  }
  if (flinching(s)) {
    return startleAt(s.alarmAgoMs ?? 0);
  }
  return s.moving ? swingAt(s.walk) : null;
}

/**
 * The arms at a task, standing still in a run still on: both hands up on a console's panel,
 * tapping at it out of step — held still under reduced motion — or holding a sheet to read.
 */
function taskArms(s: FigureState): Arms | null {
  if (s.moving || s.mood !== 'play') {
    return null;
  }
  if (readingOf(s)) {
    return READ;
  }
  if (s.task !== 'console') {
    return null;
  }
  const tap = s.reduced ? 0 : TAP * Math.sin(TAU * loopAt(s.t, TAP_MS, s.phase));
  return { front: CONSOLE.front + tap, back: CONSOLE.back - tap };
}

/** The arms `walk` into the walk cycle: each swinging against the leg on its side. */
export function swingAt(walk: number): Arms {
  const swing = ARM_SWING * Math.sin(TAU * walk);
  return { front: -swing, back: swing };
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

/** How long a figure takes to turn round to face the other side of the picture, ms. */
export const TURN_MS = 150;
/** In how many steps it turns. */
export const TURN_STEPS = 3;

/** A figure turning round: the way it showed itself facing before, the way it faces, since when. */
export interface Turn {
  from: number;
  to: number;
  /** when the turn began, ms by the figure's clock */
  since: number;
}

/** The side of the picture a figure facing `facing` shows itself to: 1 its right, -1 its left. */
export function sideOf(facing: number): 1 | -1 {
  return Math.cos(facing) < 0 ? -1 : 1;
}

/** `a` - `b` as the way round from `b` to `a`, -PI to PI. */
function turnBy(a: number, b: number): number {
  const d = a - b;
  return Math.atan2(Math.sin(d), Math.cos(d));
}

/**
 * The way the figure in `turn` shows itself facing at `now`, ms: TURN_STEPS steps from where it
 * faced to where it faces, the shorter way round — through the side toward the camera where
 * both are as short — and where it faces once TURN_MS is past.
 */
export function shownFacing(turn: Turn, now: number): number {
  const t = (now - turn.since) / TURN_MS;
  if (t >= 1) {
    return turn.to;
  }
  let by = turnBy(turn.to, turn.from);
  if (Math.abs(Math.abs(by) - Math.PI) < 1e-9) {
    // Straight round either way: through the side toward the camera, the bottom of the picture.
    by = Math.sin(turn.from + Math.PI / 2) >= 0 ? Math.PI : -Math.PI;
  }
  const step = Math.min(TURN_STEPS, Math.floor(Math.max(0, t) * TURN_STEPS) + 1);
  return turn.from + (by * step) / TURN_STEPS;
}

/**
 * The turn a figure facing `facing` is in at `now`, ms, after `turn`: a new one, from the way
 * it shows itself facing now, where it came to face the other side of the picture; else the
 * same, following its facing. None to watch for a figure first seen, or under reduced motion.
 */
export function turnOf(turn: Turn | null, facing: number, now: number, reduced: boolean): Turn {
  if (turn === null || reduced) {
    return { from: facing, to: facing, since: now - TURN_MS };
  }
  if (sideOf(facing) !== sideOf(turn.to)) {
    return { from: shownFacing(turn, now), to: facing, since: now };
  }
  return turn.to === facing ? turn : { ...turn, to: facing };
}

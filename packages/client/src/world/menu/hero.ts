import { BEAM_MS } from '../coldOpen.js';
import {
  figurePose,
  gaitStep,
  HOLD,
  shownFacing,
  TURN_MS,
  type FigurePose,
} from '../figure.js';
import { smooth } from '../ease.js';
import { SHOT_WIDE } from '../intro/shot.js';
import { tileCss } from '../viewport.js';

/**
 * The hero (docs/art-bible.md „The hero"): the player's own crew figure standing large at the
 * right of the menu's stage, in front of the drifting lab, facing the menu at three quarters —
 * breathing, glancing round now and then, a light across its visor while the microphone sends,
 * waving as a new name settles. Pure: how large it stands and where (heroPlace), and how it
 * stands at a moment (heroPose). Lengths in CSS pixels, but where tiles are said: a figure unit
 * is a tile of the art (art.ts draws a figure 0.85 of one tall), a scene tile one of the lab
 * drifting behind the menu as the drift frames a lab that fills the window (heroTile).
 */

/** The hero's height against the stage's, before the scene's tiles hold it in. */
export const HERO_SHARE = 0.42;
/** The fewest and the most scene tiles the hero stands tall. */
export const HERO_TILES = { least: 4, most: 6 } as const;
/** How tall a figure stands, feet to the top of its dome and its outline, in figure units. */
export const FIGURE_TALL = 0.855;
/**
 * The box round the feet that every pose of the hero stays within, figure units: its front —
 * the menu's side, on the left, where the lamp in its hands points and its lens glints — its
 * back with the pack and its drop shadow (heroArt.ts), its dome with a breath to spare, and the
 * shadow under its feet. Measured off the poses drawn, the lamp turned across its whole sweep:
 * 0.64, 0.38, 0.89 and 0.11.
 */
export const HERO_BOX = { front: 0.65, back: 0.39, top: 0.9, bottom: 0.12 } as const;
/** Where the hero faces: toward the menu on its left, three quarters to the viewer. */
export const HERO_FACING = Math.PI - 0.55;
/**
 * How far of a figure's glance the hero turns: the art turns a figure round whose look crosses
 * the picture's up-and-down line, and the hero's glances stay on the menu's side of it.
 */
export const GLANCE_SHARE = 0.45;
/**
 * The steps a glance turns in, radians: five out and five back, as the art turns a figure round
 * in steps (figure.ts TURN_STEPS) — each step draws the hero anew, a turn moving smoothly would
 * draw it on every frame.
 */
export const GLANCE_STEP = 0.1;
/** What the hero keeps clear of the menu's column, the profile and the stage's edge, CSS px. */
export const CLEAR = 12;
/** Where along the stage the hero's feet stand where it has the room: the right third's middle. */
export const RIGHT_THIRD = 5 / 6;

type Spot = { x: number; y: number };

/** A box of whole CSS pixels in the stage: its corner and its size. */
export interface StageBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** What the hero is placed by: the stage and what stands on it, CSS px. */
export interface StageFacts {
  /** the stage's box, the menu's, CSS px */
  w: number;
  h: number;
  /** the window's width and height: the scene behind the stage fills it, its tile follows it */
  windowW: number;
  windowH: number;
  /** a phone, held sideways or upright: the profile's figure stands for the hero */
  phone: boolean;
  /** the stage's padding at the bottom: the floor the hero stands on */
  padBottom: number;
  /** the window's safe areas at the right and the bottom: a notch, a home bar */
  safeRight: number;
  safeBottom: number;
  /** where the menu's column ends, from the stage's left: the items, the lead line, the card */
  menuRight: number;
  /** where the widest panel over the menu ends, from the stage's left */
  panelRight: number;
  /** where the profile ends, from the stage's top */
  chipBottom: number;
}

/** The narrowest window the hero stands in, CSS px: below it the profile's figure stands for it. */
export const SMALLEST_WINDOW = 900;
/** The smallest the hero stands, scene tiles: smaller than this it is left out. */
export const FEWEST_TILES = 1;

/** Where and how large the hero stands on the stage. */
export interface HeroPlace {
  /** CSS px a figure unit */
  scale: number;
  /** where its feet stand in the stage, CSS px */
  feet: Spot;
  /** its canvas's box in the stage: every pose within it */
  box: StageBox;
  /** how tall it stands in scene tiles */
  tiles: number;
}

/** `value` as the nearest of the steps `step` apart. */
export function stepped(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/**
 * A scene tile in CSS px for a window `windowH` tall: SHOT_WIDE of a run's tile there, as the
 * drift frames a lab that fills the window — not the zoom it gives a lab too small for that to
 * cover the window (menu/drift.ts `sceneShot`), which leaves the hero's size as it is.
 */
export function heroTile(windowH: number): number {
  return tileCss({ height: windowH, bar: 0, touch: false }) * SHOT_WIDE;
}

/** How tall the hero stands on a stage `h` tall in a window `windowH` tall, CSS px. */
export function heroTall(h: number, windowH: number): number {
  const tile = heroTile(windowH);
  const share = HERO_SHARE * h;
  return Math.min(HERO_TILES.most * tile, Math.max(HERO_TILES.least * tile, share));
}

/**
 * The room the stage `f` leaves the hero, CSS px: across, from where its box may start resting
 * to where it may end stepped aside — clear of the menu's column resting, of the widest panel
 * stepped half a tile aside (STEP_TILES), of the stage's edge and its safe area — and down, from
 * the profile to the floor the stage's padding and its safe area leave.
 */
function roomOf(f: StageFacts): { left: number; right: number; floor: number; step: number } {
  const step = STEP_TILES * heroTile(f.windowH);
  const left = Math.max(f.menuRight + CLEAR, f.panelRight + CLEAR - step);
  const right = f.w - Math.max(CLEAR, f.safeRight) - step;
  const floor = f.h - Math.max(f.padBottom, f.safeBottom);
  return { left, right, floor, step };
}

/** What the hero's box gives up to whole pixels at either side, CSS px: one at most. */
const ROUNDING = 1;

/** The most CSS px a figure unit the room `room` on the stage `f` leaves the hero. */
function scaleIn(f: StageFacts, room: ReturnType<typeof roomOf>): number {
  const across = (room.right - room.left - 2 * ROUNDING) / (HERO_BOX.front + HERO_BOX.back);
  const down = (room.floor - (f.chipBottom + CLEAR)) / (HERO_BOX.top + HERO_BOX.bottom);
  return Math.min(heroTall(f.h, f.windowH) / FIGURE_TALL, across, down);
}

/**
 * Where the hero stands on the stage `f` and how large: as tall as heroTall says — or as the
 * room beside the menu, the widest panel and under the profile allows (roomOf) — its feet in the
 * right third's middle, held inside that room, its shadow on the floor. Null where it is left
 * out: a window narrower than SMALLEST_WINDOW, a phone, no room for FEWEST_TILES of it.
 */
export function heroPlace(f: StageFacts): HeroPlace | null {
  const room = roomOf(f);
  const scale = scaleIn(f, room);
  const tiles = (FIGURE_TALL * scale) / heroTile(f.windowH);
  if (f.phone || f.windowW < SMALLEST_WINDOW || !(tiles >= FEWEST_TILES)) {
    return null;
  }
  const least = room.left + ROUNDING + HERO_BOX.front * scale;
  const most = room.right - ROUNDING - HERO_BOX.back * scale;
  const x = Math.min(most, Math.max(least, f.w * RIGHT_THIRD));
  const y = room.floor - HERO_BOX.bottom * scale;
  const left = Math.floor(x - HERO_BOX.front * scale);
  const top = Math.floor(y - HERO_BOX.top * scale);
  const box = {
    left,
    top,
    width: Math.ceil(x + HERO_BOX.back * scale) - left,
    height: Math.ceil(y + HERO_BOX.bottom * scale) - top,
  };
  return { scale, feet: { x, y }, box, tiles };
}

/** How long the hero takes to walk in from the stage's right edge on the first menu of a page. */
export const WALK_IN_MS = 1200;
/** How long after it has stopped the click comes and its lamp comes on, ms. */
export const CLICK_AFTER_MS = 350;
/** How long its lamp takes to come on after the click: as the cold open's lamps (coldOpen.ts). */
export const LAMP_ON_MS = BEAM_MS;
/** The whole entrance, from the first step to the lamp on, ms. */
export const ENTRANCE_MS = WALK_IN_MS + CLICK_AFTER_MS + LAMP_ON_MS;
/** Where a hero walking in faces: straight along its way, to the menu's side. */
const WALKING_FACING = Math.PI;

/** How the hero moves at a moment: where it stands, whether it walks, where it faces. */
export interface HeroMotion {
  /** how far right of its place it stands, figure units */
  offset: number;
  moving: boolean;
  /** how far into the walk cycle its legs are, 0 to 1 (figure.ts gaitStep) */
  walk: number;
  facing: number;
  /** where its head is turned to look, radians: at what the player attends to; null for round */
  look: number | null;
}

/** The hero standing in its place, facing the menu. */
export const STANDING_STILL: HeroMotion = {
  offset: 0,
  moving: false,
  walk: 0,
  facing: HERO_FACING,
  look: null,
};

/** How far the hero's head turns toward what the player attends to: a little, not all the way. */
export const LOOK_SHARE = 0.6;
/** Where its head is, from its feet, figure units: up, and ahead to the menu's side. */
export const HEAD = { ahead: 0.13, up: 0.6 } as const;
/** How far it keeps its look from turning it round: the picture's up-and-down line, radians. */
const LOOK_MARGIN = 0.12;

/** `a` - `b` the short way round, -PI to PI. */
function turnBy(a: number, b: number): number {
  const d = a - b;
  return Math.atan2(Math.sin(d), Math.cos(d));
}

/**
 * Where the hero's head is, on the stage, CSS px: placed `place`, standing `offset` figure units
 * right of its place.
 */
export function headAt(place: HeroPlace, offset: number): Spot {
  const { feet, scale } = place;
  return { x: feet.x + (offset - HEAD.ahead) * scale, y: feet.y - HEAD.up * scale };
}

/**
 * Where the hero looks to look at `angle` (from its head, the picture's way round), facing
 * `facing`: LOOK_SHARE of the way from its facing, and never so far that the art would turn it
 * round — its look kept on the menu's side of the picture's up-and-down line.
 */
export function lookToward(angle: number, facing: number): number {
  const look = facing + LOOK_SHARE * turnBy(angle, facing);
  return Math.min(1.5 * Math.PI - LOOK_MARGIN, Math.max(0.5 * Math.PI + LOOK_MARGIN, look));
}

/** How far aside the hero steps as a panel opens over the menu: half a scene tile. */
export const STEP_TILES = 0.5;
/** How long the step takes, ms: as long as a panel takes to slide in (menu.css). */
export const STEP_MS = 200;

/** A step aside as it goes: from where, to where, figure units right of the place, since when. */
export interface Step {
  from: number;
  to: number;
  /** when it began, ms by the page's clock */
  since: number;
}

/**
 * How the hero steps aside `step` at `now`: walking from `step.from` to `step.to` over STEP_MS,
 * easing in and out, its legs in their cycle as far as the ground it covers, facing as it does;
 * standing where it came to after. Under reduced motion it stands there at once.
 */
export function steppingAt(
  step: Step,
  now: number,
  reduced: boolean,
): Omit<HeroMotion, 'facing' | 'look'> {
  const u = reduced ? 1 : Math.min(1, Math.max(0, (now - step.since) / STEP_MS));
  const covered = (step.to - step.from) * smooth(u);
  return {
    offset: step.from + covered,
    moving: u < 1,
    walk: gaitStep(0, Math.abs(covered)),
  };
}

/**
 * Where the hero turns to as the menu goes for the lobby: away toward the lab behind it — up the
 * picture, a little to the menu's side, keeping the art's side — as the doors close.
 */
export const AWAY_FACING = 1.5 * Math.PI - 0.35;

/** The hero `ms` into its entrance: how it moves, whether the click has come, its lamp. */
export interface Entrance {
  motion: HeroMotion;
  /** the click of the cold open has come: its lamp comes on */
  clicked: boolean;
  /** how far its lamp is on, 0 to 1 */
  lamp: number;
  /** the entrance is over: the hero stands in its place, its lamp on */
  done: boolean;
}

/**
 * The hero `ms` into its entrance on the first menu of a page, walking in from `from` figure
 * units right of its place — beyond the stage's right edge — over WALK_IN_MS: at a walk as it
 * comes in, slowing to a stop, its legs' cycle tied to the ground covered (figure.ts gaitStep),
 * facing along its way and turning to the menu in the art's steps as it stops (shownFacing).
 * CLICK_AFTER_MS after the stop the cold open's click comes, and the lamp comes on over
 * LAMP_ON_MS.
 */
export function entranceAt(ms: number, from: number): Entrance {
  if (ms < WALK_IN_MS) {
    const u = Math.max(0, ms) / WALK_IN_MS;
    const covered = from * (1 - (1 - u) * (1 - u));
    const turning = { from: WALKING_FACING, to: HERO_FACING, since: WALK_IN_MS - TURN_MS };
    const facing = ms < turning.since ? WALKING_FACING : shownFacing(turning, ms);
    const walk = gaitStep(0, covered);
    const motion = { offset: from - covered, moving: true, walk, facing, look: null };
    return { motion, clicked: false, lamp: 0, done: false };
  }
  const lit = (ms - WALK_IN_MS - CLICK_AFTER_MS) / LAMP_ON_MS;
  const lamp = Math.min(1, Math.max(0, lit));
  return { motion: STANDING_STILL, clicked: lit >= 0, lamp, done: lamp >= 1 };
}

/** What the hero's pose follows besides the clock. */
export interface HeroCues {
  /** its own offset into its loops (figure.ts figurePhase of the pass's id) */
  phase: number;
  /** the microphone is on and sends: a light sweeps across the visor */
  speaking: boolean;
  /** when the name last settled anew, by the page's clock, ms; null for never */
  waveAt: number | null;
  /** the player asked for less motion: one still pose */
  reduced: boolean;
}

/**
 * How the hero stands at `now`, up since `since` (ms, the page's clock), moving as `motion` says:
 * as a figure standing in the lobby does (figure.ts) — breathing, glancing round once it has stood
 * a while, its visor lit while it speaks, waving as a name settles — facing the menu, its glances
 * kept to the menu's side, the hand lamp (menu/lamp.ts) held before its chest in both hands, the
 * front one raised from it to wave; walking, its legs in their cycle, the lamp held still. Under
 * reduced motion it holds one still pose.
 */
export function heroPose(
  cues: HeroCues,
  [now, since]: readonly [number, number],
  motion: HeroMotion = STANDING_STILL,
): FigurePose {
  const pose = figurePose({
    moving: motion.moving,
    facing: motion.facing,
    carrying: null,
    speaking: cues.speaking,
    alarmAgoMs: null,
    readyAgoMs: cues.waveAt === null ? null : now - cues.waveAt,
    mood: 'play',
    t: now - since,
    idleMs: now - since,
    phase: cues.phase,
    walk: motion.walk,
    task: null,
    reduced: cues.reduced,
  });
  const waving = motion.moving ? 0 : (pose.arms?.front ?? 0);
  const glance = stepped((pose.look - motion.facing) * GLANCE_SHARE, GLANCE_STEP);
  return {
    ...pose,
    look: motion.look ?? motion.facing + glance,
    arms: { front: Math.max(HOLD.front, waving), back: HOLD.back },
    holding: true,
  };
}

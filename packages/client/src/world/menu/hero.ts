import { figurePose, HOLD, type FigurePose } from '../figure.js';
import { SHOT_WIDE } from '../intro/shot.js';
import { tileCss } from '../viewport.js';

/**
 * The hero (docs/art-bible.md „The hero"): the player's own crew figure standing large at the
 * right of the menu's stage, in front of the drifting lab, facing the menu at three quarters —
 * breathing, glancing round now and then, a light across its visor while the microphone sends,
 * waving as a new name settles. Pure: how large it stands and where (heroPlace), and how it
 * stands at a moment (heroPose). Lengths in CSS pixels, but where tiles are said: a figure unit
 * is a tile of the art (art.ts draws a figure 0.85 of one tall), a scene tile one of the lab
 * drifting behind the menu (menu/drift.ts `sceneShot`).
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
  /** the window's height: the scene behind the stage fills the window, its tile follows it */
  windowH: number;
  /** the stage's padding at the bottom: the floor the hero stands on */
  padBottom: number;
  /** where the menu's column ends, from the stage's left: the items, the lead line, the card */
  menuRight: number;
  /** where the profile ends, from the stage's top */
  chipBottom: number;
}

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

/** A scene tile in CSS px for a window `windowH` tall, as the menu's lab is framed (drift.ts). */
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
 * The most CSS px a figure unit the stage leaves the hero: between the menu's column and the
 * stage's right edge, and between the profile and the floor, CLEAR kept from each.
 */
function roomFor(f: StageFacts): number {
  const across = (f.w - CLEAR - (f.menuRight + CLEAR)) / (HERO_BOX.front + HERO_BOX.back);
  const down = (f.h - f.padBottom - (f.chipBottom + CLEAR)) / (HERO_BOX.top + HERO_BOX.bottom);
  return Math.min(across, down);
}

/**
 * Where the hero stands on the stage `f` and how large: as tall as heroTall says — or as the
 * room beside the menu and under the profile allows — its feet in the right third's middle,
 * held inside that room, its shadow on the floor the stage's padding leaves. Null where there
 * is no room for it at all.
 */
export function heroPlace(f: StageFacts): HeroPlace | null {
  const scale = Math.min(heroTall(f.h, f.windowH) / FIGURE_TALL, roomFor(f));
  if (!(scale > 0)) {
    return null;
  }
  const least = f.menuRight + CLEAR + HERO_BOX.front * scale;
  const most = f.w - CLEAR - HERO_BOX.back * scale;
  const x = Math.min(most, Math.max(least, f.w * RIGHT_THIRD));
  const y = f.h - f.padBottom - HERO_BOX.bottom * scale;
  const left = Math.floor(x - HERO_BOX.front * scale);
  const top = Math.floor(y - HERO_BOX.top * scale);
  const box = {
    left,
    top,
    width: Math.ceil(x + HERO_BOX.back * scale) - left,
    height: Math.ceil(y + HERO_BOX.bottom * scale) - top,
  };
  const tiles = (FIGURE_TALL * scale) / heroTile(f.windowH);
  return { scale, feet: { x, y }, box, tiles };
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
 * How the hero stands at `now`, up since `since` (ms, the page's clock): as a figure standing
 * in the lobby does (figure.ts) — breathing, glancing round once it has stood a while, its visor
 * lit while it speaks, waving as a name settles — facing the menu, its glances kept to the
 * menu's side, the hand lamp (menu/lamp.ts) held before its chest in both hands, the front one
 * raised from it to wave. Under reduced motion it holds one still pose.
 */
export function heroPose(cues: HeroCues, now: number, since: number): FigurePose {
  const pose = figurePose({
    moving: false,
    facing: HERO_FACING,
    carrying: null,
    speaking: cues.speaking,
    alarmAgoMs: null,
    readyAgoMs: cues.waveAt === null ? null : now - cues.waveAt,
    mood: 'play',
    t: now - since,
    idleMs: now - since,
    phase: cues.phase,
    walk: 0,
    task: null,
    reduced: cues.reduced,
  });
  const waving = pose.arms?.front ?? 0;
  return {
    ...pose,
    look: HERO_FACING + stepped((pose.look - HERO_FACING) * GLANCE_SHARE, GLANCE_STEP),
    arms: { front: Math.max(HOLD.front, waving), back: HOLD.back },
    holding: true,
  };
}

import { heroPlace, heroTile, type HeroPlace, type StageFacts } from '../src/world/menu/hero.js';
import { heroCanvas } from '../src/world/menu/heroArt.js';
import {
  entranceRun,
  stillReactions,
  type EntranceRun,
  type HeroLook,
  type HeroPainting,
  type HeroProbe,
} from '../src/world/menu/heroStage.js';
import { newSweep } from '../src/world/menu/lamp.js';
import { fakeCanvas } from './fakeCanvas.js';

/**
 * The menu's hero on a fake page, for the tests of its stage (world/menu/heroStage.ts): the stage
 * at 1440 × 820 as menu.css lays it out, and the painting a hero's loop paints on.
 */

/** The menu's stage at 1440 × 820, under the top bar's 60 px. */
export const DESKTOP_STAGE: StageFacts = {
  w: 1440,
  h: 760,
  windowW: 1440,
  windowH: 820,
  phone: false,
  padBottom: 32.8,
  safeRight: 0,
  safeBottom: 0,
  menuRight: 512,
  panelRight: 832,
  chipBottom: 115,
};

/** Where the hero stands on `facts`, there by the test's word. */
export function placedOn(facts: StageFacts): HeroPlace {
  const place = heroPlace(facts);
  if (place === null) {
    throw new Error(`no hero on ${JSON.stringify(facts)}`);
  }
  return place;
}

/** What the menu hands the hero as it first comes up: nothing open, nothing first, staying. */
export const PLAIN_LOOK: HeroLook = {
  color: '#2dd4bf',
  speaking: false,
  waveAt: null,
  panel: false,
  card: false,
  leaving: false,
};

/** What a test may set of a painting: the motion, the menu's look, its entrance, its canvas. */
export interface PaintingAsked {
  reduced?: boolean;
  look?: Partial<HeroLook>;
  entrance?: EntranceRun;
  canvas?: HTMLCanvasElement | null;
}

/** A hero's painting on fake canvases, standing at 1440 × 820, the stage at (0, 60). */
export function painting(asked: PaintingAsked = {}): HeroPainting {
  const hero = heroCanvas(fakeCanvas(0, 0, 'hero').canvas, (w, h) => fakeCanvas(w, h).canvas);
  if (hero === null) {
    throw new Error('no hero canvas');
  }
  const reduced = asked.reduced ?? false;
  return {
    hero,
    standing: {
      place: placedOn(DESKTOP_STAGE),
      at: { x: 0, y: 60 },
      menuRight: DESKTOP_STAGE.menuRight,
      stageW: DESKTOP_STAGE.w,
      tile: heroTile(DESKTOP_STAGE.windowH),
    },
    look: { current: { ...PLAIN_LOOK, ...asked.look } },
    attends: { current: null },
    sweep: newSweep(),
    probe: { laid: 0, drawn: { legs: 0, upper: 0 } } as HeroProbe,
    entrance: asked.entrance ?? entranceRun(false, () => null),
    react: stillReactions(),
    phase: 0.3,
    reduced: () => reduced,
    canvas: asked.canvas ?? null,
  };
}

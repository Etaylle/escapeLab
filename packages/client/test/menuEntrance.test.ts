import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOORS_FRESH_MS, DOORS_KEY } from '../src/screens/DoorWipe.js';
import { GAIT_CYCLE, HOLD } from '../src/world/figure.js';
import {
  CLICK_AFTER_MS,
  ENTRANCE_MS,
  entranceAt,
  HERO_FACING,
  heroPlace,
  heroPose,
  heroTile,
  LAMP_ON_MS,
  STEP_TILES,
  WALK_IN_MS,
  type StageFacts,
} from '../src/world/menu/hero.js';
import { FakePath2D } from './fakeCanvas.js';
import { painting } from './heroPage.js';
import { storage } from './page.js';

/**
 * The hero's entrance (world/menu/hero.ts `entranceAt`, heroStage.ts): on the first menu of a
 * page it walks in from the stage's right edge over 1.2 s, its legs in their cycle, stops, and
 * after the cold open's click its lamp comes on; back from the lobby, under reduced motion and on
 * every later menu of the page it stands there from the start, its lamp on.
 */

/** The menu's stage at 1440 × 820. */
const DESKTOP: StageFacts = {
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

const PLACE = (() => {
  const place = heroPlace(DESKTOP);
  if (place === null) throw new Error('no hero at 1440 × 820');
  return place;
})();

/** How far right of its place the hero starts: its box beyond the stage's right edge. */
const FROM = (DESKTOP.w - PLACE.box.left) / PLACE.scale;

describe('entranceAt — the walk in, the click, the lamp', () => {
  it('walks in over 1.2 s from beyond the stage’s edge, slowing to a stop in its place', () => {
    expect(WALK_IN_MS).toBe(1200);
    const at = (ms: number) => entranceAt(ms, FROM).motion;
    expect(at(0)).toMatchObject({ offset: FROM, moving: true, facing: Math.PI });
    expect(at(WALK_IN_MS / 2).offset).toBeLessThan(FROM / 2);
    expect(at(WALK_IN_MS - 1).offset).toBeLessThan(0.01);
    expect(at(WALK_IN_MS)).toMatchObject({ offset: 0, moving: false, facing: HERO_FACING });
    const steps = Array.from({ length: 36 }, (_, i) => at((i * WALK_IN_MS) / 36).offset);
    const moved = steps.slice(1).map((offset, i) => (steps[i] ?? 0) - offset);
    expect(moved.every((step, i) => i === 0 || step <= (moved[i - 1] ?? 0) + 1e-12)).toBe(true);
  });

  it('swings its legs as far through their cycle as the ground it has covered', () => {
    for (const ms of [100, 400, 700, 1000]) {
      const { offset, walk } = entranceAt(ms, FROM).motion;
      const cycles = (FROM - offset) / GAIT_CYCLE;
      expect(walk).toBeCloseTo(cycles - Math.floor(cycles), 9);
    }
  });

  it('turns from its way to the menu as it stops, in the art’s steps', () => {
    const turning = [1040, 1060, 1110, 1160].map((ms) => entranceAt(ms, FROM).motion.facing);
    expect(turning[0]).toBe(Math.PI);
    expect(new Set(turning.slice(1)).size).toBe(3);
    expect(entranceAt(WALK_IN_MS, FROM).motion.facing).toBe(HERO_FACING);
  });

  it('keeps the lamp in both hands as it walks: a wave waits for it to stand', () => {
    const walking = entranceAt(WALK_IN_MS / 2, FROM).motion;
    const cues = { phase: 0.3, speaking: false, waveAt: 4400, reduced: false };
    expect(heroPose(cues, [5000, 0], walking).arms).toEqual(HOLD);
    expect(heroPose(cues, [5000, 0]).arms?.front).toBeGreaterThan(HOLD.front);
  });

  it('clicks a moment after it has stopped, and its lamp comes on as the cold open’s do', () => {
    const click = WALK_IN_MS + CLICK_AFTER_MS;
    expect(entranceAt(click - 1, FROM)).toMatchObject({ clicked: false, lamp: 0, done: false });
    expect(entranceAt(click, FROM)).toMatchObject({ clicked: true, lamp: 0, done: false });
    expect(entranceAt(click + LAMP_ON_MS / 2, FROM).lamp).toBeCloseTo(0.5, 9);
    expect(entranceAt(ENTRANCE_MS, FROM)).toMatchObject({ clicked: true, lamp: 1, done: true });
  });
});

/** A canvas element of the stage's, its box as the hero puts it there, its style's writes told. */
function stageCanvas(): HTMLCanvasElement & { style: Record<string, string>; written: number } {
  const canvas = { hidden: true, written: 0, style: {} };
  canvas.style = new Proxy<Record<string, string>>(
    {},
    {
      set: (style, side: string, value: string) => {
        canvas.written += 1;
        style[side] = value;
        return true;
      },
    },
  );
  return canvas as unknown as HTMLCanvasElement & {
    style: Record<string, string>;
    written: number;
  };
}

/**
 * The hero's painter on a fake page — its modules fresh, as a page loaded anew has them — walking
 * in where `walks`, held as `held` says.
 */
async function stage(walks: boolean, reduced = false, held: () => number | null = () => null) {
  const { entranceRun, heroPainter } = await import('../src/world/menu/heroStage.js');
  const lamps = await import('../src/world/menu/lamp.js');
  const canvas = stageCanvas();
  const entrance = entranceRun(walks, held);
  let clicks = 0;
  entrance.click = () => (clicks += 1);
  const on = painting({ reduced, entrance, canvas });
  const paint = heroPainter(on, 0);
  return { on, paint, canvas, clicks: () => clicks, lamp: () => lamps.heroLamp() };
}

describe('the hero’s entrance on the stage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('Path2D', FakePath2D);
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    vi.stubGlobal('location', { search: '' });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('walks in on a canvas widened to the stage’s edge, then stands in its box', async () => {
    const { on, paint, canvas } = await stage(true);
    paint(1000);
    expect(canvas.style['left']).toBe(`${PLACE.box.left}px`);
    expect(canvas.style['width']).toBe(`${DESKTOP.w - PLACE.box.left}px`);
    // Walking, it is drawn whole on every frame: no layer laid yet.
    for (let now = 1000; now < 1000 + WALK_IN_MS; now += 1000 / 30) paint(now);
    expect(on.hero.drawn).toEqual({ legs: 0, upper: 0 });
    paint(1000 + WALK_IN_MS + 50);
    // Standing, it covers its box and the room to step aside into: half a scene tile.
    const room = Math.ceil(STEP_TILES * heroTile(DESKTOP.windowH));
    expect(canvas.style['width']).toBe(`${PLACE.box.width + room}px`);
    expect(on.hero.drawn).toEqual({ legs: 1, upper: 1 });
  });

  it('puts its canvas on a box anew only where its box changes, not on every frame', async () => {
    const { paint, canvas } = await stage(true);
    for (let now = 0; now < ENTRANCE_MS + 1000; now += 1000 / 30) paint(now);
    // Its four sides once widened for the walk in, and once on its box and the room beside it.
    expect(canvas.written).toBe(8);
  });

  it('holds its lamp off until the click, which sounds once, and then on', async () => {
    const { paint, clicks, lamp } = await stage(true);
    for (let now = 0; now < WALK_IN_MS + CLICK_AFTER_MS - 50; now += 1000 / 30) paint(now);
    expect(lamp()?.on).toBe(0);
    expect(clicks()).toBe(0);
    for (let now = WALK_IN_MS + CLICK_AFTER_MS; now <= ENTRANCE_MS + 500; now += 1000 / 30) {
      paint(now);
    }
    expect(lamp()?.on).toBe(1);
    expect(clicks()).toBe(1);
  });

  it('stands there from the start, its lamp on, where it does not walk in', async () => {
    const { on, paint, clicks, lamp } = await stage(false);
    paint(0);
    expect(lamp()?.on).toBe(1);
    expect(on.probe.entrance).toEqual({ walks: false, ms: null, done: true });
    expect(clicks()).toBe(0);
  });

  it('stands there at once as the player asks for less motion while it walks in', async () => {
    let reduced = false;
    const { on, paint, lamp } = await stage(true);
    on.reduced = () => reduced;
    paint(0);
    paint(300);
    expect(lamp()?.on).toBe(0);
    reduced = true;
    paint(330);
    expect(lamp()?.on).toBe(1);
    expect(on.probe.entrance.done).toBe(true);
  });

  it('holds where the walkthrough holds it, and goes on from there once let go', async () => {
    let held: number | null = 600;
    const { on, paint } = await stage(true, false, () => held);
    for (let now = 0; now < 3000; now += 1000 / 30) paint(now);
    expect(on.probe.entrance).toEqual({ walks: true, ms: 600, done: false });
    held = null;
    paint(3000);
    expect(on.probe.entrance.ms).toBeCloseTo(600, 9);
    paint(3300);
    expect(on.probe.entrance.ms).toBeCloseTo(900, 9);
  });

  it('is never over while the walkthrough holds it, wherever it holds it', async () => {
    let held: number | null = ENTRANCE_MS + 100;
    const { on, paint } = await stage(true, false, () => held);
    for (let now = 0; now < 1000; now += 1000 / 30) paint(now);
    expect(on.probe.entrance.done).toBe(false);
    held = 300;
    paint(1100);
    expect(on.probe.entrance).toEqual({ walks: true, ms: 300, done: false });
  });

  it('walks in on the first menu of a page alone: not once a hero has stood there', async () => {
    const { walksIn } = await import('../src/world/menu/heroStage.js');
    expect(walksIn(false, false)).toBe(true);
    expect(walksIn(true, false)).toBe(false);
    expect(walksIn(false, true)).toBe(false);
    // The modules as the page has them: the first hero to paint spends the entrance.
    const page = await stage(false);
    const { walksIn: later } = await import('../src/world/menu/heroStage.js');
    expect(later(false, false)).toBe(true);
    page.paint(0);
    expect(later(false, false)).toBe(false);
  });
});

describe('a page come back from the lobby through the doors', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** The tab, its doors' note made `ago` ms before now (none for null), as a fresh page has it. */
  async function tab(ago: number | null) {
    const kept = new Map(ago === null ? [] : [[DOORS_KEY, String(Date.now() - ago)]]);
    vi.stubGlobal('window', { sessionStorage: storage(kept) });
    const { cameBack } = await import('../src/screens/MenuHero.js');
    return { kept, cameBack };
  }

  it('finds the hero there from the start, asked once as its first menu comes up', async () => {
    const { kept, cameBack } = await tab(900);
    expect(cameBack()).toBe(true);
    // The doors open on the menu and their note goes with them: the page's answer stays.
    kept.delete(DOORS_KEY);
    expect(cameBack()).toBe(true);
  });

  it('lets the hero walk in on a page opened anew, or come back too late', async () => {
    expect((await tab(null)).cameBack()).toBe(false);
    vi.resetModules();
    expect((await tab(DOORS_FRESH_MS + 50)).cameBack()).toBe(false);
  });
});

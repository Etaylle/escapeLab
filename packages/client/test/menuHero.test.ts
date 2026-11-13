import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drawScientist } from '../src/world/art.js';
import { figurePhase, type FigurePose } from '../src/world/figure.js';
import {
  CLEAR,
  FIGURE_TALL,
  GLANCE_STEP,
  HERO_BOX,
  HERO_FACING,
  heroPlace,
  heroPose,
  heroTall,
  heroTile,
  STANDING_STILL,
  type HeroCues,
  type HeroPlace,
  type StageFacts,
} from '../src/world/menu/hero.js';
import { heroCanvas, paintHero, type HeroCanvas } from '../src/world/menu/heroArt.js';
import { heroPainter, type HeroPainting } from '../src/world/menu/heroStage.js';
import { holdLamp } from '../src/world/menu/lamp.js';
import { runScene, type SceneHost } from '../src/world/menu/loop.js';
import { callEntries, callsOf, fakeCanvas, FakePath2D, type Entry } from './fakeCanvas.js';
import { painting } from './heroPage.js';

/**
 * The hero on the menu's stage (world/menu/hero.ts, heroArt.ts, screens/MenuHero.tsx): as tall
 * as the stage says, in scene tiles held between four and six; never over the menu's column or
 * the profile; alive but for reduced motion, which holds one still pose; laid from two layers,
 * so that its breath draws no figure anew; and a loop that asks no frames while it is hidden.
 */

/** The menu's stage in a window `w` × `h`, as menu.css lays it out at 1440 × 820 and 1280 × 720. */
function stage(w: number, h: number): StageFacts {
  const pad = Math.min(80, Math.max(20, w * 0.05));
  const top = Math.min(60, Math.max(22, h * 0.06));
  return {
    w,
    h: h - 60,
    windowW: w,
    windowH: h,
    phone: false,
    padBottom: Math.min(40, Math.max(18, h * 0.04)),
    safeRight: 0,
    safeBottom: 0,
    menuRight: pad + 440,
    panelRight: pad + Math.min(w - 2 * pad, 760),
    chipBottom: top + 66,
  };
}

const DESKTOP = stage(1440, 820);
const LAPTOP = stage(1280, 720);

/** The hero's place, there by the test's word. */
function placed(f: StageFacts): HeroPlace {
  const place = heroPlace(f);
  if (place === null) {
    throw new Error(`no hero on ${JSON.stringify(f)}`);
  }
  return place;
}

const ANNA: HeroCues = { phase: figurePhase('p1'), speaking: false, waveAt: null, reduced: false };

describe('heroPlace — how large the hero stands, and where', () => {
  it('stands about five scene tiles tall at 1440 × 820 and at 1280 × 720', () => {
    expect(placed(DESKTOP).tiles).toBeGreaterThan(4.8);
    expect(placed(DESKTOP).tiles).toBeLessThan(5.2);
    expect(placed(LAPTOP).tiles).toBeGreaterThan(4.8);
    expect(placed(LAPTOP).tiles).toBeLessThan(5.2);
    expect(placed(DESKTOP).scale * FIGURE_TALL).toBeCloseTo(heroTall(DESKTOP.h, 820), 6);
  });

  it('grows with the stage’s height, held between four and six scene tiles', () => {
    let before = 0;
    // From 600 px of window up the lab is framed as on a laptop (viewport.ts tileCss).
    for (let h = 600; h <= 2200; h += 20) {
      const tall = heroTall(h - 60, h);
      expect(tall).toBeGreaterThanOrEqual(before);
      before = tall;
    }
    for (let h = 420; h <= 2200; h += 20) {
      const tiles = heroTall(h - 60, h) / heroTile(h);
      expect(tiles).toBeGreaterThan(4 - 1e-9);
      expect(tiles).toBeLessThan(6 + 1e-9);
    }
    expect(heroTall(2140, 2200) / heroTile(2200)).toBeCloseTo(6, 6);
    expect(heroTall(360, 420) / heroTile(420)).toBeCloseTo(4, 6);
  });

  it('stands its feet in the right third’s middle, on the floor the stage’s padding leaves', () => {
    const place = placed(DESKTOP);
    expect(place.feet.x).toBeCloseTo((DESKTOP.w * 5) / 6, 6);
    const shadow = place.feet.y + HERO_BOX.bottom * place.scale;
    expect(shadow).toBeCloseTo(DESKTOP.h - DESKTOP.padBottom, 6);
  });

  it('keeps clear of the menu’s column, the profile and the stage’s edge', () => {
    for (const f of [DESKTOP, LAPTOP, { ...DESKTOP, w: 1100 }, { ...LAPTOP, chipBottom: 400 }]) {
      const { box } = placed(f);
      expect(box.left).toBeGreaterThanOrEqual(Math.floor(f.menuRight + CLEAR));
      expect(box.top).toBeGreaterThanOrEqual(Math.floor(f.chipBottom + CLEAR));
      expect(box.left + box.width).toBeLessThanOrEqual(Math.ceil(f.w - CLEAR));
    }
  });

  it('shrinks to the room beside the menu, and stands nowhere without any', () => {
    const narrow = placed({ ...DESKTOP, w: 1100 });
    expect(narrow.scale).toBeLessThan(placed(DESKTOP).scale);
    expect(heroPlace({ ...DESKTOP, w: DESKTOP.menuRight + 2 * CLEAR })).toBeNull();
  });
});

describe('heroPose — alive, but for reduced motion', () => {
  it('breathes, and glances round on the menu’s side once it has stood a while', () => {
    const poses = Array.from({ length: 1600 }, (_, i) => heroPose(ANNA, [i * 10, 0]));
    expect(new Set(poses.map((pose) => pose.bob.toFixed(4))).size).toBeGreaterThan(10);
    const glances = poses.map((pose) => pose.look - HERO_FACING);
    expect(Math.max(...glances.map(Math.abs))).toBeGreaterThan(0.3);
    // Its look never crosses the picture's up-and-down line: the hero never turns round.
    expect(poses.every((pose) => Math.cos(pose.look) < 0)).toBe(true);
    // It glances in steps, each drawing it anew: never between them.
    const steps = glances.map((glance) => glance / GLANCE_STEP);
    expect(steps.every((step) => Math.abs(step - Math.round(step)) < 1e-9)).toBe(true);
  });

  it('lights its visor while the microphone sends, and waves as a name settles', () => {
    expect(heroPose({ ...ANNA, speaking: true }, [5000, 0]).shimmer).not.toBeNull();
    expect(heroPose(ANNA, [5000, 0]).shimmer).toBeNull();
    expect(heroPose({ ...ANNA, waveAt: 4400 }, [5000, 0]).arms?.front).toBeGreaterThan(1.5);
    expect(heroPose({ ...ANNA, waveAt: 1000 }, [5000, 0]).arms?.front).toBe(1.35);
  });

  it('holds the lamp before its chest in both hands, the front one raised from it to wave', () => {
    const standing = heroPose(ANNA, [5000, 0]);
    expect(standing.holding).toBe(true);
    expect(standing.arms).toEqual({ front: 1.35, back: 1.45 });
    const waving = heroPose({ ...ANNA, waveAt: 4400 }, [5000, 0]);
    expect(waving.holding).toBe(true);
    expect(waving.arms?.front).toBeGreaterThan(2);
    expect(waving.arms?.back).toBe(1.45);
  });

  it('holds one still pose under reduced motion, whatever happens', () => {
    const still = heroPose({ ...ANNA, reduced: true }, [0, 0]);
    for (const now of [500, 3700, 9100, 22_000]) {
      const cues = { ...ANNA, reduced: true, speaking: true, waveAt: now - 300 };
      expect(heroPose(cues, [now, 0])).toEqual(still);
    }
    expect(still.look).toBe(HERO_FACING);
    expect(still.bob).toBe(0);
  });
});

/** The hero's canvas on a fake page, what it is asked recorded; its layers fake canvases too. */
function fakeHero(): { hero: HeroCanvas; log: Entry[] } {
  const shown = fakeCanvas(0, 0, 'hero');
  const hero = heroCanvas(shown.canvas, (w, h) => fakeCanvas(w, h, 'layer').canvas);
  if (hero === null) throw new Error('no hero canvas');
  return { hero, log: shown.log };
}

/** A pose of the hero standing, `bob` tiles up. */
const posed = (bob: number): FigurePose => ({ ...heroPose(ANNA, [0, 0]), bob });

/** The lamp in the hero's hands, straight ahead and alight. */
const LAMP = { tilt: 0, on: 1 };

/** A frame of the hero standing in `place`, its canvas on its place's box. */
const standingIn = (place: HeroPlace) => ({ place, box: place.box, motion: STANDING_STILL });

describe('paintHero — laid from two layers, the breath drawing no figure anew', () => {
  beforeEach(() => {
    vi.stubGlobal('Path2D', FakePath2D);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('draws each layer once, then only copies them as the breath lifts the body', () => {
    const { hero, log } = fakeHero();
    const place = placed(DESKTOP);
    const frame = { ...standingIn(place), pose: posed(0), color: '#2dd4bf', dpr: 1, lamp: LAMP };
    expect(paintHero(hero, frame)).toBe(true);
    expect(hero.drawn).toEqual({ legs: 1, upper: 1 });
    const lift = 1 / place.scale;
    expect(paintHero(hero, { ...frame, pose: posed(0.4 * lift) })).toBe(false);
    expect(paintHero(hero, { ...frame, pose: posed(3 * lift) })).toBe(true);
    expect(hero.drawn).toEqual({ legs: 1, upper: 1 });
    const copies = callsOf(log, 'drawImage');
    expect(copies.at(-1)?.slice(1)).toEqual([0, -3]);
    // The legs cover their band of the canvas only, from over their tops to its foot.
    expect(copies.at(-2)?.slice(1)).toEqual([0, hero.legs.top]);
    expect(hero.legs.top).toBeGreaterThan(hero.canvas.height / 2);
    expect(hero.legs.top + hero.legs.canvas.height).toBe(hero.canvas.height);
    expect(hero.upper.canvas.height).toBeLessThan(hero.canvas.height);
  });

  it('draws the upper layer anew as the look turns, and both as the colour changes', () => {
    const { hero } = fakeHero();
    const at = standingIn(placed(DESKTOP));
    const frame = { ...at, pose: posed(0), color: '#2dd4bf', dpr: 1, lamp: LAMP };
    paintHero(hero, frame);
    paintHero(hero, { ...frame, pose: { ...posed(0), look: HERO_FACING + 0.2 } });
    expect(hero.drawn).toEqual({ legs: 1, upper: 2 });
    paintHero(hero, { ...frame, color: '#f472b6' });
    expect(hero.drawn).toEqual({ legs: 2, upper: 3 });
    paintHero(hero, { ...frame, color: '#f472b6', lamp: { tilt: 0.1, on: 1 } });
    expect(hero.drawn).toEqual({ legs: 2, upper: 4 });
  });

  it('sizes its canvas to its box at the stage’s density', () => {
    const { hero } = fakeHero();
    const place = placed(LAPTOP);
    paintHero(hero, { ...standingIn(place), pose: posed(0), color: '#2dd4bf', dpr: 2, lamp: LAMP });
    expect(hero.canvas.width).toBe(place.box.width * 2);
    expect(hero.canvas.height).toBe(place.box.height * 2);
  });
});

describe('drawScientist — a figure’s legs and the rest as layers of their own', () => {
  beforeEach(() => {
    vi.stubGlobal('Path2D', FakePath2D);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** What drawing `layer` of a standing figure asks of a fresh context. */
  function layer(which: 'all' | 'legs' | 'upper'): Entry[] {
    const { ctx, log } = fakeCanvas();
    const pose = heroPose(ANNA, [0, 0]);
    const opts = { color: '#2dd4bf', name: '', facing: HERO_FACING, moving: false, walkPhase: 0 };
    const look = { isYou: false, connected: true, pose, named: false };
    drawScientist(ctx, { ...opts, ...look, layer: which });
    return log;
  }

  it('lays the shadow with the legs alone, and the body and its visor with the rest alone', () => {
    const fills = (log: Entry[]): number => callEntries(log, 'fill').length;
    // The shadow is a soft ellipse: a unit circle scaled to its size (brush.ts softEllipse).
    const shadows = (log: Entry[]): number =>
      callsOf(log, 'arc').filter(([x, y, r]) => x === 0 && y === 0 && r === 1).length;
    expect(shadows(layer('all'))).toBe(1);
    expect(shadows(layer('legs'))).toBe(1);
    expect(shadows(layer('upper'))).toBe(0);
    expect(fills(layer('legs')) + fills(layer('upper'))).toBe(fills(layer('all')) + 4);
  });

  it('cuts the legs out of the rest’s outline, as their fills cover it in the whole figure', () => {
    const cuts = callEntries(layer('upper'), 'fill').filter((e) => e.op === 'destination-out');
    expect(cuts).toHaveLength(4);
    const legCuts = callEntries(layer('all'), 'fill').filter((e) => e.op === 'destination-out');
    expect(legCuts).toHaveLength(0);
  });
});

/** A page for the hero's loop: frames that run when the test says, a canvas shown or hidden. */
function page(): { host: SceneHost; show: (shown: boolean) => void; tick: (now: number) => void } {
  const waiting = new Map<number, (now: number) => void>();
  let next = 1;
  let seen: ((shown: boolean) => void) | null = null;
  return {
    host: {
      frame: (run) => {
        waiting.set(next, run);
        return next++;
      },
      cancel: (handle) => {
        waiting.delete(handle);
      },
      watch: (report) => {
        seen = report;
        return () => {
          seen = null;
        };
      },
    },
    show: (shown) => seen?.(shown),
    tick: (now) => {
      const due = [...waiting.values()];
      waiting.clear();
      for (const run of due) run(now);
    },
  };
}

/** What the hero's painter needs, on a fake page, standing at 1440 × 820. */
const paintingOf = (reduced: boolean): HeroPainting => painting({ reduced });

describe('heroPainter — the hero’s loop', () => {
  beforeEach(() => {
    vi.stubGlobal('Path2D', FakePath2D);
    vi.stubGlobal('window', { devicePixelRatio: 1 });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    holdLamp(null);
  });

  it('asks no frames while its canvas is hidden, and paints once it shows', () => {
    const p = page();
    const on = paintingOf(false);
    const paint = heroPainter(on, 0);
    let painted = 0;
    runScene((now) => {
      painted += 1;
      return paint(now);
    }, p.host);
    for (let now = 0; now < 1000; now += 1000 / 60) p.tick(now);
    expect(painted).toBe(0);
    p.show(true);
    for (let now = 1000; now < 2000; now += 1000 / 60) p.tick(now);
    expect(painted).toBeGreaterThan(25);
    expect(painted).toBeLessThanOrEqual(31);
    p.show(false);
    const before = painted;
    for (let now = 2000; now < 3000; now += 1000 / 60) p.tick(now);
    expect(painted).toBe(before);
  });

  it('holds still under reduced motion: one picture, then no more frames asked', () => {
    const p = page();
    const on = paintingOf(true);
    let painted = 0;
    const paint = heroPainter(on, 0);
    runScene((now) => {
      painted += 1;
      return paint(now);
    }, p.host);
    p.show(true);
    for (let now = 0; now < 2000; now += 1000 / 60) p.tick(now);
    expect(painted).toBe(1);
    expect(on.probe.laid).toBe(1);
  });

  it('stops asking frames where the stage leaves the hero no room', () => {
    const on = paintingOf(false);
    on.standing.place = null;
    expect(heroPainter(on, 0)(100)).toBe(false);
    expect(on.probe.laid).toBe(0);
  });
});

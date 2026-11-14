import { vi } from 'vitest';
import { heroPlace, heroTile, type HeroPlace, type StageFacts } from '../src/world/menu/hero.js';
import { heroCanvas } from '../src/world/menu/heroArt.js';
import {
  entranceRun,
  startHero,
  stillReactions,
  type EntranceRun,
  type HeroLook,
  type HeroPainting,
  type HeroProbe,
  type HeroRun,
} from '../src/world/menu/heroStage.js';
import { newSweep } from '../src/world/menu/lamp.js';
import type { SceneHost } from '../src/world/menu/loop.js';
import { fakeCanvas, FakePath2D } from './fakeCanvas.js';

/**
 * The menu's hero on a fake page, for the tests of its stage (world/menu/heroStage.ts): the stage
 * at 1440 × 820 as menu.css lays it out, the painting a hero's loop paints on, and a page to start
 * a hero on as the menu does (`heroOnPage`).
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

/** A page for a hero's loop: frames that run when the test says, a canvas shown or hidden. */
export function framesPage(): {
  host: SceneHost;
  show: (shown: boolean) => void;
  tick: (now: number) => void;
} {
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

/** The top bar over the menu's stage, CSS px. */
const TOP_BAR = 60;

/** A box at `left`, `top`, `width` × `height` in the window, as getBoundingClientRect has it. */
function rect(left: number, top: number, width: number, height: number) {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

/** `value` held between `lo` and `hi`, as CSS `clamp()` holds it. */
const clamp = (lo: number, value: number, hi: number): number => Math.min(hi, Math.max(lo, value));

/**
 * An item of a fake menu — `item` its id (MainMenu.tsx `data-item`), null for a run's card — in
 * the menu's column, `top` down the window: what the hero reads of what the player attends to.
 * The tests stub `Element` and `HTMLElement` with it.
 */
export class FakeItem {
  readonly dataset: Record<string, string>;
  private readonly box: ReturnType<typeof rect>;

  constructor(item: string | null, top: number) {
    this.dataset = item === null ? {} : { item };
    this.box = rect(72, top, 440, 46);
  }

  closest(selector: string): FakeItem | null {
    const own = this.dataset['item'] === undefined ? '.bound' : '.menu-item';
    return selector.includes(own) ? this : null;
  }

  getBoundingClientRect() {
    return this.box;
  }
}

type Listener = (event: { target: unknown }) => void;

/** What listens on a fake target, by the type of event it waits for. */
function listening() {
  const byType = new Map<string, Set<Listener>>();
  return {
    add: (type: string, listener: Listener): void => {
      byType.set(type, (byType.get(type) ?? new Set()).add(listener));
    },
    remove: (type: string, listener: Listener): void => {
      byType.get(type)?.delete(listener);
    },
    fire: (type: string, target: unknown = null): void => {
      for (const listener of [...(byType.get(type) ?? [])]) listener({ target });
    },
  };
}

/** A hero started on a fake page as the menu starts it (startHero). */
export interface HeroOnPage {
  run: HeroRun;
  /** its canvas on the stage */
  canvas: HTMLCanvasElement & { hidden: boolean };
  /** the canvases it made for its layers, in order */
  made: HTMLCanvasElement[];
  /** what the walkthrough reads of it (`window.__escapelab.hero`) */
  probe: () => HeroProbe;
  /** the window resized to `w` × `h`: the stage measured anew */
  resize: (w: number, h: number) => void;
  /** an event of `type` on the stage, `target` what it happened to */
  fire: (type: string, target?: unknown) => void;
  /** the page's frames, for `ms` at 60 a second */
  play: (ms: number) => void;
}

/**
 * The menu's hero started on a fake page in a window `w` × `h` — the stage under the top bar laid
 * out as menu.css lays it out, its menu's column and its profile, `focused` the element in the
 * focus — under `?trace=1`, standing there from the start, its canvas shown. Stubs the page's
 * globals: `vi.unstubAllGlobals()` after.
 */
export function heroOnPage(w: number, h: number, focused: FakeItem | null = null): HeroOnPage {
  const size = { w, h };
  const pad = (): number => clamp(20, 0.05 * size.w, 80);
  const chip = (): ReturnType<typeof rect> =>
    rect(size.w - pad() - 260, TOP_BAR + clamp(22, 0.06 * size.h, 60), 260, 66);
  const [onWindow, onStage] = [listening(), listening()];
  const parts: Record<string, unknown> = {
    '.menu-body': { getBoundingClientRect: () => rect(pad(), TOP_BAR + 200, 440, 400) },
    '.profile-chip': { getBoundingClientRect: chip },
  };
  const stage = {
    getBoundingClientRect: () => rect(0, TOP_BAR, size.w, size.h - TOP_BAR),
    querySelector: (selector: string) => parts[selector] ?? null,
    addEventListener: onStage.add,
    removeEventListener: onStage.remove,
  };
  const canvas = Object.assign(fakeCanvas(0, 0, 'hero').canvas, {
    parentElement: stage,
    hidden: true,
    style: {},
  });
  const made: HTMLCanvasElement[] = [];
  vi.stubGlobal('Path2D', FakePath2D);
  vi.stubGlobal('Element', FakeItem);
  vi.stubGlobal('HTMLElement', FakeItem);
  vi.stubGlobal('location', { search: '?trace=1' });
  vi.stubGlobal('window', {
    get innerWidth() {
      return size.w;
    },
    get innerHeight() {
      return size.h;
    },
    devicePixelRatio: 1,
    matchMedia: () => ({ matches: false }),
    addEventListener: onWindow.add,
    removeEventListener: onWindow.remove,
  });
  vi.stubGlobal('document', {
    activeElement: focused,
    createElement: () => {
      const layer = fakeCanvas(0, 0, `layer ${made.length}`).canvas;
      made.push(layer);
      return layer;
    },
  });
  vi.stubGlobal('getComputedStyle', () => ({
    paddingLeft: `${pad()}px`,
    paddingRight: `${pad()}px`,
    paddingBottom: `${clamp(18, 0.04 * size.h, 40)}px`,
    marginRight: '0px',
    marginBottom: '0px',
    getPropertyValue: (name: string) => (name === '--menu-panel-w' ? '760px' : ''),
  }));
  const frames = framesPage();
  const look = { current: PLAIN_LOOK };
  const motion = { reduced: () => false, watch: () => () => undefined };
  const run = startHero(canvas, [look, 'p1', false], frames.host, motion);
  if (run === null) {
    throw new Error('no hero started');
  }
  frames.show(true);
  let clock = performance.now();
  return {
    run,
    canvas,
    made,
    probe: () => (window as unknown as { __escapelab: { hero: HeroProbe } }).__escapelab.hero,
    resize: (width, height) => {
      Object.assign(size, { w: width, h: height });
      onWindow.fire('resize');
    },
    fire: onStage.fire,
    play: (ms) => {
      for (const end = clock + ms; clock < end; clock += 1000 / 60) frames.tick(clock);
    },
  };
}

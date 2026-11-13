import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FIGURE_FRAME_MS,
  figurePainter,
  figureStateOf,
  runFigure,
  type FigureHost,
  type FigureLook,
  type FigureProbe,
} from '../src/screens/CrewFigure.js';
import { figurePhase, figurePose, IDLE_LOOK_MS } from '../src/world/figure.js';
import { fakeCanvas, FakePath2D } from './fakeCanvas.js';

/**
 * A page for a figure's loop: frames that run when the test says, and a
 * canvas the test shows and hides.
 */
function page() {
  const waiting = new Map<number, (now: number) => void>();
  let next = 1;
  let seen: ((shown: boolean) => void) | null = null;
  const host: FigureHost = {
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
  };
  return {
    host,
    waiting,
    show: (shown: boolean) => seen?.(shown),
    watched: () => seen !== null,
    /** Runs the frames due now, at `now`. */
    tick: (now: number) => {
      const due = [...waiting.values()];
      waiting.clear();
      for (const run of due) {
        run(now);
      }
    },
  };
}

/** Frames of a 60 Hz screen from `from` for `ms`. */
function sixtyHz(p: ReturnType<typeof page>, from: number, ms: number): void {
  for (let now = from; now < from + ms; now += 1000 / 60) {
    p.tick(now);
  }
}

const ANNA: FigureLook = {
  color: '#2dd4bf',
  facing: 'front',
  isYou: true,
  connected: true,
  mood: 'play',
  speaking: false,
  phase: figurePhase('p1'),
};

describe('runFigure — a figure moves only while it shows', () => {
  it('paints nothing until the canvas shows, then no more than 30 times a second', () => {
    const p = page();
    const painted: number[] = [];
    runFigure((now) => painted.push(now) > 0, p.host);
    sixtyHz(p, 0, 500);
    expect(painted).toEqual([]);
    p.show(true);
    sixtyHz(p, 1000, 2000);
    expect(painted.length).toBeGreaterThanOrEqual(58);
    expect(painted.length).toBeLessThanOrEqual(61);
    for (let i = 1; i < painted.length; i++) {
      expect((painted[i] ?? 0) - (painted[i - 1] ?? 0)).toBeGreaterThan(FIGURE_FRAME_MS - 1);
    }
  });

  it('stops its loop while the canvas is hidden and starts it again when it shows', () => {
    const p = page();
    let painted = 0;
    runFigure(() => (painted += 1) > 0, p.host);
    p.show(true);
    sixtyHz(p, 0, 500);
    const before = painted;
    p.show(false);
    expect(p.waiting.size).toBe(0);
    sixtyHz(p, 500, 2000);
    expect(painted).toBe(before);
    p.show(true);
    sixtyHz(p, 2500, 500);
    expect(painted).toBeGreaterThan(before);
  });

  it('keeps one loop when told twice it shows, and stops for good when the figure goes', () => {
    const p = page();
    const loop = runFigure(() => true, p.host);
    p.show(true);
    p.show(true);
    expect(p.waiting.size).toBe(1);
    loop.stop();
    expect(p.waiting.size).toBe(0);
    expect(p.watched()).toBe(false);
    loop.wake();
    expect(p.waiting.size).toBe(0);
  });

  it('asks no frames once the figure holds still, and one loop again when woken', () => {
    const p = page();
    let painted = 0;
    const loop = runFigure(() => (painted += 1) < 0, p.host);
    p.show(true);
    sixtyHz(p, 0, 500);
    expect(painted).toBe(1);
    expect(p.waiting.size).toBe(0);
    loop.wake();
    loop.wake();
    expect(p.waiting.size).toBe(1);
    sixtyHz(p, 500, 500);
    expect(painted).toBe(2);
    p.show(false);
    loop.wake();
    expect(p.waiting.size).toBe(0);
  });
});

/** A figure's canvas 60 × 70 CSS pixels, and what its painter reads. */
function figureCanvas() {
  const { canvas, ctx, log } = fakeCanvas(0, 0, 'figure');
  Object.assign(canvas, { clientWidth: 60, clientHeight: 70 });
  const look = { current: ANNA };
  const probe: FigureProbe = { color: '', mood: 'play', rise: 0, glance: 0 };
  return { on: { canvas, ctx, look, waveAt: { current: null }, probe }, log };
}

describe('figurePainter — what a figure’s loop paints', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    vi.stubGlobal('Path2D', FakePath2D);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('paints a figure under reduced motion once, and again only as what it shows changes', () => {
    const { on, log } = figureCanvas();
    const paint = figurePainter(on, 0, true);
    expect(paint(0)).toBe(false);
    const once = log.length;
    expect(once).toBeGreaterThan(0);
    expect(paint(1000)).toBe(false);
    expect(log.length).toBe(once);
    on.look.current = { ...ANNA, connected: false };
    expect(paint(2000)).toBe(false);
    const twice = log.length;
    expect(twice).toBeGreaterThan(once);
    Object.assign(on.canvas, { clientWidth: 80 });
    paint(3000);
    expect(log.length).toBeGreaterThan(twice);
  });

  it('paints a figure frame after frame under full motion, and says it moves on', () => {
    const { on, log } = figureCanvas();
    const paint = figurePainter(on, 0, false);
    expect(paint(0)).toBe(true);
    const once = log.length;
    expect(paint(FIGURE_FRAME_MS)).toBe(true);
    expect(log.length).toBeGreaterThan(once);
    expect(on.probe.color).toBe(ANNA.color);
  });
});

describe('figureStateOf — a figure in the lobby or on a title card', () => {
  it('stands still since it came up, so it looks round after a while', () => {
    const state = figureStateOf(ANNA, 9000, null, false);
    expect(state).toMatchObject({
      moving: false,
      carrying: null,
      alarmAgoMs: null,
      readyAgoMs: null,
      t: 9000,
      idleMs: 9000,
      facing: Math.PI / 2,
    });
    const looks = Array.from({ length: 1200 }, (_, i) =>
      figurePose(figureStateOf(ANNA, i * 10, null, false)).look,
    );
    expect(looks.slice(0, IDLE_LOOK_MS / 10).every((look) => look === Math.PI / 2)).toBe(true);
    expect(looks.some((look) => Math.abs(look - Math.PI / 2) > 0.5)).toBe(true);
  });

  it('faces the middle of the row or out of the room, as its place says', () => {
    expect(figureStateOf({ ...ANNA, facing: 'right' }, 0, null, false).facing).toBeCloseTo(0.55);
    expect(figureStateOf({ ...ANNA, facing: 'left' }, 0, null, false).facing).toBeCloseTo(
      Math.PI - 0.55,
    );
  });

  it('waves as its player says ready, and holds still under reduced motion', () => {
    expect(figurePose(figureStateOf(ANNA, 5000, 600, false)).arms?.front).toBeGreaterThan(1.5);
    expect(figurePose(figureStateOf(ANNA, 5000, null, false)).arms).toBeNull();
    expect(figurePose(figureStateOf(ANNA, 5000, 600, true)).arms).toBeNull();
  });

  it('jumps on a won card and slumps on a lost one', () => {
    const won = Array.from({ length: 160 }, (_, i) =>
      figurePose(figureStateOf({ ...ANNA, mood: 'celebrate' }, i * 10, null, false)),
    );
    expect(Math.max(...won.map((pose) => pose.rise))).toBeGreaterThan(0.1);
    expect(won.every((pose) => (pose.arms?.front ?? 0) > Math.PI / 2)).toBe(true);
    const lost = figurePose(figureStateOf({ ...ANNA, mood: 'slump' }, 4000, null, false));
    expect(lost.dim).toBeGreaterThan(0);
    expect(lost.bob).toBeLessThan(0);
  });

  it('puts a light across the visor of whoever speaks in the lobby', () => {
    const speaking = figurePose(figureStateOf({ ...ANNA, speaking: true }, 100, null, false));
    expect(speaking.shimmer).not.toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import {
  FIGURE_FRAME_MS,
  figureStateOf,
  runFigure,
  type FigureHost,
  type FigureLook,
} from '../src/screens/CrewFigure.js';
import { figurePhase, figurePose, IDLE_LOOK_MS } from '../src/world/figure.js';

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
    runFigure((now) => painted.push(now), p.host);
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
    runFigure(() => (painted += 1), p.host);
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
    const stop = runFigure(() => undefined, p.host);
    p.show(true);
    p.show(true);
    expect(p.waiting.size).toBe(1);
    stop();
    expect(p.waiting.size).toBe(0);
    expect(p.watched()).toBe(false);
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

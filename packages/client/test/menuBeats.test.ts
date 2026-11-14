import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { figurePhase } from '../src/world/figure.js';
import {
  FLARE_MS,
  flareAt,
  FLICKER,
  FLICKER_EVERY_MS,
  FLICKER_STEP_MS,
  flickerAt,
  HERO_FACING,
  heroPose,
  heroTile,
  STEP_MS,
  STEP_TILES,
  TOWARD_MS,
} from '../src/world/menu/hero.js';
import { heroCanvas, VISOR_GLOW } from '../src/world/menu/heroArt.js';
import { heroPainter } from '../src/world/menu/heroStage.js';
import { heroLamp, holdLamp, lightStep } from '../src/world/menu/lamp.js';
import { GLINT } from '../src/world/menu/lampArt.js';
import { holdPlace } from '../src/world/menu/places.js';
import { rgba } from '../src/world/palette.js';
import { fakeCanvas, FakeGradient, FakePath2D, type Entry } from './fakeCanvas.js';
import { DESKTOP_STAGE, painting, placedOn } from './heroPage.js';

/**
 * The hero's beats (world/menu/hero.ts, heroStage.ts): its lamp flaring as an item of the menu is
 * taken, a half step toward the menu as one leaves the menu — no further than the menu's column
 * lets it —, the flicker of its lamp once a minute, a look round every 6 to 10 s, its visor
 * catching the glow of the item it looks at; none of it under reduced motion.
 */

const PLACE = placedOn(DESKTOP_STAGE);
/** Half a scene tile in figure units: how far the hero steps toward the menu. */
const STEP = (STEP_TILES * heroTile(DESKTOP_STAGE.windowH)) / PLACE.scale;

/** Paints with `paint` at 30 frames a second from `from` for `ms`; returns where it stopped. */
function run(paint: (now: number) => boolean, from: number, ms: number): number {
  let now = from;
  for (; now < from + ms; now += 1000 / 30) paint(now);
  return now;
}

beforeEach(() => {
  vi.stubGlobal('Path2D', FakePath2D);
  vi.stubGlobal('window', { devicePixelRatio: 1, innerWidth: 1440, innerHeight: 820 });
});

afterEach(() => {
  vi.unstubAllGlobals();
  holdLamp(null);
  holdPlace(null);
});

/** A painting whose layers' drawings are kept in `logs`. */
function logged(
  asked: Parameters<typeof painting>[0] = {},
): { on: ReturnType<typeof painting>; logs: Entry[][] } {
  const on = painting(asked);
  const logs: Entry[][] = [];
  const hero = heroCanvas(fakeCanvas(0, 0, 'hero').canvas, (w, h) => {
    const made = fakeCanvas(w, h);
    logs.push(made.log);
    return made.canvas;
  });
  if (hero === null) throw new Error('no hero canvas');
  on.hero = hero;
  return { on, logs };
}

/** The gradients `logs` filled with, those whose first stop is `colour`. */
const fillsOf = (logs: Entry[][], colour: string): FakeGradient[] =>
  logs
    .flat()
    .flatMap((e) =>
      e.kind === 'set' && e.name === 'fillStyle' && e.value instanceof FakeGradient ? [e.value] : [],
    )
    .filter((gradient) => gradient.stops[0]?.[1] === colour);

describe('the lamp’s flare as an item is taken', () => {
  it('rises in a moment and dies away by FLARE_MS', () => {
    expect(flareAt(-1)).toBe(0);
    expect(flareAt(0)).toBe(0);
    expect(flareAt(60)).toBeCloseTo(1, 9);
    expect(flareAt(FLARE_MS / 2)).toBeGreaterThan(0.2);
    expect(flareAt(FLARE_MS)).toBe(0);
  });

  it('draws the lamp in the hero’s hands anew as it flares, its glint grown as far again', () => {
    const { on, logs } = logged({ look: { taken: { at: 1000, toward: false } } });
    const paint = heroPainter(on, 0);
    paint(900);
    const upper = on.hero.drawn.upper;
    const reach = (): number => Number(fillsOf(logs, GLINT.middle).at(-1)?.args[5]);
    expect(reach()).toBeCloseTo(GLINT.reach, 9);
    paint(1060);
    expect(on.hero.drawn.upper).toBe(upper + 1);
    expect(reach()).toBeCloseTo(2 * GLINT.reach, 9);
  });

  it('flares the lamp the hero holds out, and never under reduced motion', () => {
    for (const reduced of [false, true]) {
      const on = painting({ reduced, look: { taken: { at: 1000, toward: false } } });
      const paint = heroPainter(on, 0);
      paint(1060);
      expect(heroLamp()?.flare).toBe(reduced ? 0 : 1);
      paint(1000 + FLARE_MS);
      expect(heroLamp()?.flare).toBe(0);
    }
  });
});

describe('the half step toward the menu', () => {
  it('steps half a tile toward the menu as an item leaves it, and back after TOWARD_MS', () => {
    const on = painting({ look: { taken: { at: 500, toward: true } } });
    const paint = heroPainter(on, 0);
    const now = run(paint, 500, STEP_MS + 100);
    expect(on.react.stepped).toBeCloseTo(-STEP, 9);
    expect(on.probe.step).toBeCloseTo(-1, 9);
    run(paint, now, TOWARD_MS);
    expect(on.react.stepped).toBeCloseTo(0, 9);
  });

  it('takes no step for an item that opens a panel, nor under reduced motion', () => {
    for (const [reduced, toward] of [
      [false, false],
      [true, true],
    ] as const) {
      const on = painting({ reduced, look: { taken: { at: 0, toward } } });
      run(heroPainter(on, 0), 0, STEP_MS + 100);
      expect(on.react.stepped).toBe(0);
    }
  });

  it('steps no further than the menu’s column lets it, and widens its canvas for the step', () => {
    const canvas = { style: {}, hidden: false } as unknown as HTMLCanvasElement;
    const on = painting({ look: { taken: { at: 0, toward: true } }, canvas });
    on.standing.menuRight = PLACE.box.left - 12 - 10;
    run(heroPainter(on, 0), 0, STEP_MS + 100);
    expect(on.react.stepped).toBeCloseTo(-10 / PLACE.scale, 9);
    const left = parseFloat((canvas.style as { left?: string }).left ?? 'NaN');
    expect(left).toBe(PLACE.box.left - Math.ceil(STEP * PLACE.scale));
  });
});

describe('the beat the walkthrough holds', () => {
  it('stops the hero’s clock as long after an item is taken: mid-step, its lamp flared', () => {
    const on = painting({ look: { taken: { at: 1000, toward: true } }, beatHeld: () => 110 });
    run(heroPainter(on, 0), 1000, 1000);
    expect(heroLamp()?.flare).toBe(lightStep(flareAt(110)));
    expect(on.react.stepped).toBeLessThan(-0.3 * STEP);
    expect(on.react.stepped).toBeGreaterThan(-0.8 * STEP);
  });
});

describe('the flicker once a minute', () => {
  it('comes never in the first half minute, then once a minute, step by step', () => {
    const phase = 0.4;
    // A flicker begins at a dip after a while of steady light: it catches once within itself.
    const dips: number[] = [];
    let lastDip = Number.NEGATIVE_INFINITY;
    for (let t = 0; t < 3 * FLICKER_EVERY_MS; t += FLICKER_STEP_MS / 2) {
      if (flickerAt(t, phase, false) < 1) {
        if (t - lastDip > 2000) dips.push(t);
        lastDip = t;
      }
    }
    expect(dips[0]).toBeGreaterThanOrEqual(30_000);
    const gaps = dips.slice(1).map((t, i) => t - (dips[i] ?? 0));
    expect(gaps).toHaveLength(2);
    // Read off a grid of half a step: each start lies within half a step of where it is.
    for (const gap of gaps) expect(Math.abs(gap - 60_000)).toBeLessThanOrEqual(FLICKER_STEP_MS);
    const start = dips[0] ?? 0;
    const steps = FLICKER.map((_, k) => flickerAt(start + k * FLICKER_STEP_MS + 1, phase, false));
    expect(steps).toEqual([...FLICKER]);
  });

  it('dips the light of the lamp the hero holds out, and never under reduced motion', () => {
    // Its phase at 0, the first flicker begins at 30 s.
    expect(flickerAt(30_000 + 1, 0, false)).toBe(FLICKER[0]);
    expect(flickerAt(30_000 + 1, 0, true)).toBe(1);
    for (const reduced of [false, true]) {
      const on = painting({ reduced });
      on.phase = 0;
      const paint = heroPainter(on, 0);
      paint(30_000 + 1);
      expect(heroLamp()?.on).toBe(reduced ? 1 : FLICKER[0]);
      paint(31_000);
      expect(heroLamp()?.on).toBe(1);
    }
  });
});

describe('the look round every 6 to 10 s', () => {
  it('glances once in every 6 to 10 s, slower than a crew member does', () => {
    const cues = { phase: figurePhase('p1'), speaking: false, waveAt: null, reduced: false };
    const starts: number[] = [];
    let turned = false;
    for (let now = 0; now < 120_000; now += 50) {
      const glance = heroPose(cues, [now, 0]).look !== HERO_FACING;
      if (glance && !turned) starts.push(now);
      turned = glance;
    }
    const gaps = starts.slice(1).map((t, i) => t - (starts[i] ?? 0));
    expect(gaps.length).toBeGreaterThan(10);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(6000 - 100);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(10_000 + 100);
  });
});

describe('the visor catching the glow of the item looked at', () => {
  /** Whether `logs` filled anything with the visor's glow. */
  const glowed = (logs: Entry[][]): boolean =>
    fillsOf(logs, rgba(VISOR_GLOW.rgb, VISOR_GLOW.alpha)).length > 0;

  it('glows while an item is attended, and not without', () => {
    const { on, logs } = logged();
    const paint = heroPainter(on, 0);
    run(paint, 0, 200);
    expect(glowed(logs)).toBe(false);
    on.attends.current = { id: 'join', x: 300, y: 300 };
    run(paint, 200, 200);
    expect(glowed(logs)).toBe(true);
  });

  it('catches nothing under reduced motion', () => {
    const { on, logs } = logged({ reduced: true });
    on.attends.current = { id: 'join', x: 300, y: 300 };
    run(heroPainter(on, 0), 0, 200);
    expect(glowed(logs)).toBe(false);
  });
});

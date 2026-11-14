import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drawScientist, type FigureLayer } from '../src/world/art.js';
import { figurePhase, HOLD, type FigurePose } from '../src/world/figure.js';
import { HERO_FACING, heroPose, STANDING_STILL, type HeroCues } from '../src/world/menu/hero.js';
import { heroCanvas, paintHero, type HeroCanvas } from '../src/world/menu/heroArt.js';
import { callEntries, fakeCanvas, FakePath2D, type Entry } from './fakeCanvas.js';
import { DESKTOP_STAGE, placedOn } from './heroPage.js';

/**
 * The light across the hero's visor while the microphone sends (world/menu/heroArt.ts, art.ts
 * FigureLayer `shimmer`): laid over the hero's layers frame after frame, where the upper layer
 * would hold it, no layer drawn anew for it — but drawn within the upper layer while the front
 * hand waves, which passes before the visor, over the light.
 */

/** A 2D transform as a context keeps it: a, b, c, d, e, f. */
type Matrix = readonly [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** The transform `m` with `n` applied within it, as a context applies a transform. */
function within(m: Matrix, n: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const [a2, b2, c2, d2, e2, f2] = n;
  return [
    a * a2 + c * b2,
    b * a2 + d * b2,
    a * c2 + c * d2,
    b * c2 + d * d2,
    a * e2 + c * f2 + e,
    b * e2 + d * f2 + f,
  ];
}

/** A point `x`, `y` of a path where it falls on the canvas under `m`. */
const onCanvas = (m: Matrix, x = 0, y = 0): number[] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

/** A drawing replayed: its transform, those it saved, its path, its clip, the lights found. */
interface Replay {
  m: Matrix;
  kept: Matrix[];
  path: number[][];
  clip: number[][] | null;
  lights: number[][][][];
}

/** What each call of a context does to a replay; a call not here changes nothing of it. */
const REPLAY: Record<string, (r: Replay, args: number[]) => void> = {
  save: (r) => {
    r.kept.push(r.m);
  },
  restore: (r) => {
    r.m = r.kept.pop() ?? IDENTITY;
    r.clip = null;
  },
  setTransform: (r, [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0]) => {
    r.m = [a, b, c, d, e, f];
  },
  translate: (r, [x = 0, y = 0]) => {
    r.m = within(r.m, [1, 0, 0, 1, x, y]);
  },
  scale: (r, [x = 1, y = 1]) => {
    r.m = within(r.m, [x, 0, 0, y, 0, 0]);
  },
  rotate: (r, [turn = 0]) => {
    r.m = within(r.m, [Math.cos(turn), Math.sin(turn), -Math.sin(turn), Math.cos(turn), 0, 0]);
  },
  beginPath: (r) => {
    r.path = [];
  },
  moveTo: (r, [x, y]) => {
    r.path.push(onCanvas(r.m, x, y));
  },
  lineTo: (r, [x, y]) => {
    r.path.push(onCanvas(r.m, x, y));
  },
  arcTo: (r, [x1, y1, x2, y2]) => {
    r.path.push(onCanvas(r.m, x1, y1), onCanvas(r.m, x2, y2));
  },
  clip: (r) => {
    r.clip = r.path;
  },
  fill: (r) => {
    if (r.clip !== null) r.lights.push([r.clip, r.path]);
  },
};

/**
 * The light across the visor in a recorded drawing — the outline it is clipped to and the band
 * filled within it, as points where they fall on the canvas — replayed from the transforms the
 * drawing asked for: a figure's drawing clips nothing else.
 */
function lightsIn(log: readonly Entry[]): number[][][][] {
  const replay: Replay = { m: IDENTITY, kept: [], path: [], clip: null, lights: [] };
  for (const entry of log) {
    if (entry.kind === 'call') REPLAY[entry.name]?.(replay, entry.args as number[]);
  }
  return replay.lights;
}

/** `actual` lights falling where `expected` ones do, to a billionth of a pixel. */
function expectSameLights(actual: number[][][][], expected: number[][][][]): void {
  const [got, wanted] = [actual.flat(3), expected.flat(3)];
  expect(actual).toHaveLength(expected.length);
  expect(got).toHaveLength(wanted.length);
  got.forEach((value, i) => expect(value).toBeCloseTo(wanted[i] ?? Number.NaN, 9));
}

/** Anna's cues as the menu hands them, her microphone sending. */
const SPEAKING: HeroCues = { phase: figurePhase('p1'), speaking: true, waveAt: null, reduced: false };

const PLACE = placedOn(DESKTOP_STAGE);
/** The hero's feet on its canvas and a figure unit, device px, at density 1 (heroArt.ts). */
const ANCHOR = {
  x: Math.round(PLACE.feet.x - PLACE.box.left),
  y: Math.round(PLACE.feet.y - PLACE.box.top),
  s: PLACE.scale,
};

/**
 * What drawing `layer` of the hero in `pose` asks of a fresh context, its feet at ANCHOR — its
 * name with it where `named`, as the world draws a figure's.
 */
function drawn(layer: FigureLayer, pose: FigurePose, named = false): Entry[] {
  const { ctx, log } = fakeCanvas();
  ctx.setTransform(ANCHOR.s, 0, 0, ANCHOR.s, ANCHOR.x, ANCHOR.y);
  const figure = { color: '#2dd4bf', name: 'Anna', facing: HERO_FACING, moving: false, walkPhase: 0 };
  drawScientist(ctx, { ...figure, isYou: false, connected: true, named, pose, layer });
  return log;
}

/** How far the breath lifts the upper layer of the hero in `pose`, whole device px. */
const liftOf = (pose: FigurePose): number => Math.round(pose.bob * ANCHOR.s);

/**
 * The light of `pose` where the hero's canvas would show it from an upper layer holding it: as
 * that layer draws it, the breath left out, and lifted with the layer as the canvas lays it.
 */
function heldByLayer(pose: FigurePose): number[][][][] {
  const lift = liftOf(pose);
  const lights = lightsIn(drawn('upper', { ...pose, bob: 0 }));
  return lights.map((light) => light.map((path) => path.map(([x = 0, y = 0]) => [x, y - lift])));
}

/** The hero's canvas on a fake page, what it and each of its layers are asked recorded. */
function fakeHero(): { hero: HeroCanvas; log: Entry[]; layers: Entry[][] } {
  const shown = fakeCanvas(0, 0, 'hero');
  const layers: Entry[][] = [];
  const hero = heroCanvas(shown.canvas, (w, h) => {
    const made = fakeCanvas(w, h, `layer ${layers.length}`);
    layers.push(made.log);
    return made.canvas;
  });
  if (hero === null) throw new Error('no hero canvas');
  return { hero, log: shown.log, layers };
}

/** A frame of the hero standing in its place at 1440 × 820, posed `pose`. */
const frameOf = (pose: FigurePose) => ({
  place: PLACE,
  box: PLACE.box,
  motion: STANDING_STILL,
  pose,
  color: '#2dd4bf',
  dpr: 1,
  lamp: { tilt: 0, on: 1 },
});

describe('the light across the hero’s visor', () => {
  beforeEach(() => {
    vi.stubGlobal('Path2D', FakePath2D);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('crosses it frame after frame over the layers, no layer drawn anew for it', () => {
    const { hero, log } = fakeHero();
    const speaking = heroPose(SPEAKING, [5000, 0]);
    // Its body riding up with its words, 2 to 6 px over its legs.
    const poses = [0.1, 0.3, 0.5, 0.7, 0.9].map((shimmer, i) => {
      return { ...speaking, shimmer, bob: (2 + i) / ANCHOR.s };
    });
    for (const pose of poses) expect(paintHero(hero, frameOf(pose))).toBe(true);
    expect(hero.drawn).toEqual({ legs: 1, upper: 1 });
    const laid = lightsIn(log);
    expect(laid).toHaveLength(poses.length);
    // Each falls where an upper layer holding it would show it, lifted with the breath.
    poses.forEach((pose, i) => expectSameLights(laid.slice(i, i + 1), heldByLayer(pose)));
  });

  it('goes as the microphone stops sending, again without a layer drawn anew', () => {
    const { hero, log } = fakeHero();
    const speaking = heroPose(SPEAKING, [5000, 0]);
    paintHero(hero, frameOf(speaking));
    const before = lightsIn(log).length;
    expect(paintHero(hero, frameOf({ ...speaking, shimmer: null }))).toBe(true);
    expect(lightsIn(log)).toHaveLength(before);
    expect(hero.drawn).toEqual({ legs: 1, upper: 1 });
  });

  it('is drawn within the upper layer, under the hand, while the front hand waves', () => {
    const { hero, log, layers } = fakeHero();
    const waving = heroPose({ ...SPEAKING, waveAt: 4400 }, [5000, 0]);
    expect(waving.arms?.front ?? 0).toBeGreaterThan(HOLD.front);
    expect(waving.shimmer).not.toBeNull();
    paintHero(hero, frameOf(waving));
    expect(lightsIn(log)).toEqual([]);
    const upper = layers[1] ?? [];
    expectSameLights(lightsIn(upper), lightsIn(drawn('upper', { ...waving, bob: 0 })));
    // The hand that holds the lamp is filled last, over the light.
    const at = (name: string): number[] =>
      upper.flatMap((e, i) => (e.kind === 'call' && e.name === name ? [i] : []));
    expect(Math.max(...at('fill'))).toBeGreaterThan(Math.max(...at('clip')));
  });

  it('is a layer of its own that lays nothing but that light, where the whole figure lays it', () => {
    const speaking = { ...heroPose(SPEAKING, [5000, 0]), bob: 0.02, shimmer: 0.4 };
    const light = drawn('shimmer', speaking, true);
    expect(callEntries(light, 'fill')).toHaveLength(1);
    expect(callEntries(light, 'stroke')).toHaveLength(0);
    expect(callEntries(light, 'fillText')).toHaveLength(0);
    expectSameLights(lightsIn(light), lightsIn(drawn('all', speaking, true)));
    expect(callEntries(drawn('shimmer', { ...speaking, shimmer: null }), 'fill')).toEqual([]);
  });
});

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMission } from '@escapelab/core';
import type { PixelBox } from '../src/world/menu/drift.js';
import type { RestBaker, SceneBake } from '../src/world/menu/scene.js';
import type { StageMotion } from '../src/world/menu/stage.js';
import { parkedDrones, sceneViewOf } from '../src/world/menu/view.js';
import { callEntries, fakeCanvas, FakePath2D, type Entry, type FakeCanvas } from './fakeCanvas.js';

/** Blackout as GET /missions/blackout answers it. */
const BLACKOUT: unknown = JSON.parse(
  readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8'),
);

/** The canvases the page has made, in order: the bake's, its overlay, what its kit made. */
let made: HTMLCanvasElement[] = [];
/** What each of them has drawn, in the same order. */
let drawnOn: Entry[][] = [];

/** A page for the scene in node: canvases that record what they draw, no observers, the tab up. */
function stubPage(): void {
  made = [];
  drawnOn = [];
  vi.stubGlobal('Path2D', FakePath2D);
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('location', { search: '' });
  vi.stubGlobal('devicePixelRatio', 1);
  vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => BLACKOUT }));
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    createElement: () => {
      const { canvas, log } = fakeCanvas(300, 150, `made ${made.length}`);
      made.push(canvas);
      drawnOn.push(log);
      return canvas;
    },
  });
}

/** The page's animation frames and its clock, run by hand at 60 Hz. */
function framesByHand(): { run: (ms: number) => void; pending: () => number } {
  let clock = 1000;
  let queued = new Map<number, FrameRequestCallback>();
  let next = 1;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => {
    queued.set(next, run);
    return next++;
  });
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => queued.delete(handle));
  return {
    run: (ms) => {
      for (let n = Math.round((ms * 60) / 1000); n > 0; n -= 1) {
        clock += 1000 / 60;
        const due = [...queued.values()];
        queued = new Map();
        for (const frame of due) frame(clock);
      }
    },
    pending: () => queued.size,
  };
}

/** The menu's canvas, 160 × 90 CSS pixels on the page — or as large as `size` says. */
function sceneCanvas([width, height]: readonly [number, number] = [160, 90]): FakeCanvas {
  const scene = fakeCanvas(300, 150, 'scene');
  Object.assign(scene.canvas, { clientWidth: width, clientHeight: height });
  return scene;
}

/** Blackout's lab as the scene shows it. */
function blackoutLab() {
  const mission = parseMission(BLACKOUT);
  return { missionId: 'blackout', view: sceneViewOf(mission), drones: parkedDrones(mission) };
}

/** The canvas the scene copied last: with no lamp held and a frame of the drift, its bake. */
const lastCopied = (scene: FakeCanvas): HTMLCanvasElement | undefined =>
  callEntries(scene.log, 'drawImage').at(-1)?.args[0] as HTMLCanvasElement | undefined;

/** The canvases of the page that hold pixels still, largest first. */
const heldCanvases = (): HTMLCanvasElement[] =>
  made
    .filter((canvas) => canvas.width * canvas.height > 0)
    .sort((a, b) => b.width * b.height - a.width * a.height);

/** Motion as the test sets it, and whoever listens to its changes. */
function motionByHand(reduced: boolean): StageMotion & {
  set: (reduce: boolean) => void;
  heard: () => boolean;
} {
  let reduce = reduced;
  const listeners = new Set<() => void>();
  return {
    reduced: () => reduce,
    watch: (changed) => {
      listeners.add(changed);
      return () => listeners.delete(changed);
    },
    set: (to) => {
      reduce = to;
      listeners.forEach((changed) => changed());
    },
    heard: () => listeners.size > 0,
  };
}

/** How many times `scene` has copied a bake onto itself. */
const copies = (scene: FakeCanvas): number => callEntries(scene.log, 'drawImage').length;

/** The size of `canvas`: 0 × 0 once it is freed. */
const sizeOf = (canvas: HTMLCanvasElement): [number, number] => [canvas.width, canvas.height];

/** Lets the lab's fetch and its bake come through. */
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Fails the test: `what` is not there. */
function fail(what: string): never {
  throw new Error(`no ${what}`);
}

/** `value`, where it is there; the test fails, naming `what`, where it is not. */
const present = <T>(value: T | null | undefined, what: string): T => value ?? fail(what);

/** The canvas of `bake`'s first piece, the drift's. */
const driftCanvasOf = (bake: SceneBake): HTMLCanvasElement =>
  present(bake.pieces[0]?.canvas, 'drift piece');

/** Steps `baker` until no piece of its rest waits: how many steps that took. */
function stepsOf(baker: RestBaker): number {
  let steps = 1;
  while (baker.step()) steps += 1;
  return steps;
}

/** What `canvas` has drawn. */
const drawnBy = (canvas: HTMLCanvasElement): Entry[] => drawnOn[made.indexOf(canvas)] ?? [];

/** The pixels of `box`. */
const areaOf = (box: { width: number; height: number }): number => box.width * box.height;

/** How many pixels `a` and `b` share. */
function sharedBy(a: PixelBox, b: PixelBox): number {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return Math.max(0, w) * Math.max(0, h);
}

beforeEach(() => {
  vi.resetModules();
  stubPage();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a bake of the scene', () => {
  it('frees every canvas its kit made on the way, the map baked whole among them', async () => {
    const { bakeScene } = await import('../src/world/menu/scene.js');
    const lab = blackoutLab();
    const bake = bakeScene(lab, 160, 90, 1);
    const map = lab.view.map;
    if (bake === null || map === null) {
      throw new Error('blackout baked no scene');
    }
    expect(made.length).toBeGreaterThan(10);
    const held = made.filter((canvas) => canvas.width * canvas.height > 0);
    // Beside the drift's piece, only the ceiling's light is left: one pixel a tile (power.ts).
    expect(held.map(sizeOf)).toEqual([sizeOf(driftCanvasOf(bake)), [map.width, map.height]]);
  });

  it('bakes the drift’s box first, as it did before it had places, the rest to fill the box', async () => {
    const { bakeScene } = await import('../src/world/menu/scene.js');
    const { driftBox, sceneShot } = await import('../src/world/menu/drift.js');
    const lab = blackoutLab();
    const bake = present(bakeScene(lab, 1440, 820, 1), 'bake');
    const [first, ...rest] = bake.pieces;
    const drift = driftBox(sceneShot(present(lab.view.map, 'map'), 1440, 820, 1), 1440, 820);
    expect(first?.box).toEqual(drift);
    expect(sizeOf(driftCanvasOf(bake))).toEqual([drift.width, drift.height]);
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.every(({ canvas }) => canvas === null)).toBe(true);
    // The pieces lie side by side, none over another, and fill the box between them.
    const sum = bake.pieces.reduce((all, { box }) => all + areaOf(box), 0);
    expect(sum).toBe(areaOf(bake.box));
    const shared = bake.pieces.flatMap((a, i) =>
      bake.pieces.slice(i + 1).map((b) => sharedBy(a.box, b.box)),
    );
    expect(shared).toEqual(shared.map(() => 0));
    expect(rest.every(({ box }) => areaOf(box) <= 1024 * 1024)).toBe(true);
  });

  it('bakes the rest a piece a step with one kit, at night where the bake is', async () => {
    const { bakeScene, nightTo, placeReady, restBaker } = await import(
      '../src/world/menu/scene.js'
    );
    const lab = blackoutLab();
    const bake = present(bakeScene(lab, 1440, 820, 1), 'bake');
    nightTo(bake, true);
    expect(placeReady(bake, 'handbook')).toBe(false);
    expect(stepsOf(restBaker(lab, bake, 1))).toBe(bake.pieces.length - 1);
    expect(bake.pieces.every(({ canvas }) => canvas !== null)).toBe(true);
    expect(placeReady(bake, 'handbook')).toBe(true);
    // Each piece baked after the night fell was sunk as it came.
    const rest = bake.pieces.slice(1).map(({ canvas }) => drawnBy(present(canvas, 'piece')));
    const sunk = rest.map((log) => callEntries(log, 'fillRect').at(-1)?.op);
    expect(sunk).toEqual(rest.map(() => 'source-atop'));
    // The kit let go once none waits: the pieces hold pixels, and the ceiling's light each kit
    // keeps, one pixel a tile (power.ts) — the drift's kit's and the rest's.
    const map = present(lab.view.map, 'map');
    const others = heldCanvases().filter((canvas) => !bake.pieces.some((p) => p.canvas === canvas));
    expect(others.map(sizeOf)).toEqual([0, 1].map(() => [map.width, map.height]));
  });

  it('reads the dark round the lab off the piece that holds it, once that is baked', async () => {
    const { bakeScene, driftCorner, pastBake, restBaker } = await import(
      '../src/world/menu/scene.js'
    );
    const lab = blackoutLab();
    const bake = present(bakeScene(lab, 1440, 820, 1), 'bake');
    // At the middle of the box's side past the lab — the left, as far past as every side
    // here —, not its corner; the drift's piece holds none of it.
    expect(bake.dark).toEqual({ at: { x: 0, y: Math.floor(bake.box.height / 2) }, colour: null });
    stepsOf(restBaker(lab, bake, 1));
    // The fake canvas reads it black.
    expect(bake.dark?.colour).toBe('#000000');
    const size = [bake.box.width, bake.box.height] as const;
    const past = (corner: { x: number; y: number }) => pastBake(corner, size, [1440, 820]);
    // The Archiv, in the lab's corner, looks past the bake's tile of dark; the Flur does not.
    expect(past(present(bake.spots['handbook'], 'Archiv')).length).toBeGreaterThan(0);
    expect(past(present(bake.spots['join'], 'Flur'))).toEqual([]);
    const drifting = [0, 0.5, 1].map((progress) => past(driftCorner(bake, progress)));
    expect(drifting).toEqual([[], [], []]);
    // A lab without places drifts within itself: no dark baked, none read.
    expect(bakeScene({ ...lab, missionId: 'other' }, 1440, 820, 1)?.dark).toBeNull();
  });

  it('keeps its kit for the rest where asked, bakes the rest with it, and lets it go', async () => {
    const { bakeScene, freeBake, letKitGo, restBaker } = await import('../src/world/menu/scene.js');
    const lab = blackoutLab();
    // Kept: the map baked whole and the sprites hold pixels beside the drift's piece and the
    // ceiling's light, until let go.
    const kept = present(bakeScene(lab, 1440, 820, 1, true), 'bake');
    expect(heldCanvases().length).toBeGreaterThan(2);
    letKitGo(kept);
    expect(heldCanvases()).toHaveLength(2);
    freeBake(kept);
    // The rest baked with the kept kit makes fewer canvases than with a kit of its own.
    const madeByRest = (keep: boolean): number => {
      const bake = present(bakeScene(lab, 1440, 820, 1, keep), 'bake');
      const before = made.length;
      stepsOf(restBaker(lab, bake, 1));
      freeBake(bake);
      return made.length - before;
    };
    expect(madeByRest(true)).toBeLessThan(madeByRest(false));
    // Freed, a bake lets the kit it kept go too: of what it made, only its ceiling's light holds.
    const before = made.length;
    freeBake(present(bakeScene(lab, 1440, 820, 1, true), 'bake'));
    const map = present(lab.view.map, 'map');
    const still = made.slice(before).filter((canvas) => canvas.width * canvas.height > 0);
    expect(still.map(sizeOf)).toEqual([[map.width, map.height]]);
  });

  it('frees what it made where the box is too large to bake', async () => {
    const { bakeScene } = await import('../src/world/menu/scene.js');
    expect(bakeScene(blackoutLab(), 20_000, 12_000, 1)).toBeNull();
    expect(made.length).toBeGreaterThan(0);
    expect(made.map(sizeOf)).toEqual(made.map(() => [0, 0]));
  });
});

describe('the scene on its canvas', () => {
  it('asks no frames while it has no lab, and draws once one is baked', async () => {
    const { openStage } = await import('../src/world/menu/stage.js');
    const page = framesByHand();
    const scene = sceneCanvas();
    const stage = openStage(scene.canvas, motionByHand(false));
    page.run(100);
    expect(page.pending()).toBe(0);
    stage.show('blackout');
    await settled();
    expect(page.pending()).toBe(1);
    page.run(500);
    expect(copies(scene)).toBeGreaterThan(10);
    expect(page.pending()).toBe(1);
    stage.close();
  });

  it('draws its still under reduced motion, then asks no frames until the motion changes', async () => {
    const { openStage } = await import('../src/world/menu/stage.js');
    const page = framesByHand();
    const scene = sceneCanvas();
    const motion = motionByHand(true);
    const stage = openStage(scene.canvas, motion);
    stage.show('blackout');
    await settled();
    // The lab comes in over 600 ms, its still then drawn once.
    page.run(1000);
    const drawn = copies(scene);
    expect(drawn).toBeGreaterThan(10);
    expect(page.pending()).toBe(0);
    page.run(2000);
    expect(copies(scene)).toBe(drawn);
    motion.set(false);
    page.run(500);
    expect(copies(scene)).toBeGreaterThan(drawn + 10);
    expect(page.pending()).toBe(1);
    stage.close();
    expect(motion.heard()).toBe(false);
  });

  it('frees its canvas and its bake as it closes, and asks no frames after', async () => {
    const { openStage } = await import('../src/world/menu/stage.js');
    const page = framesByHand();
    const scene = sceneCanvas();
    const stage = openStage(scene.canvas, motionByHand(false));
    stage.show('blackout');
    await settled();
    page.run(100);
    const bake = lastCopied(scene);
    if (bake === undefined) {
      throw new Error('the scene baked nothing');
    }
    expect(sizeOf(scene.canvas)).toEqual([160, 90]);
    expect(sizeOf(bake)).not.toEqual([0, 0]);
    stage.close();
    expect([sizeOf(scene.canvas), sizeOf(bake)]).toEqual([
      [0, 0],
      [0, 0],
    ]);
    expect(page.pending()).toBe(0);
  });
});

/** A corner of the bake a frame copied it from. */
type Corner = readonly [number, number];

/** The corners the frames drawn in `scene` since entry `from` of its log copied `bake` from. */
const corners = (scene: FakeCanvas, bake: HTMLCanvasElement, from: number): Corner[] =>
  callEntries(scene.log.slice(from), 'drawImage')
    .filter(({ args }) => args[0] === bake)
    .map(({ args }) => [-Number(args[1]), -Number(args[2])] as const);

/** How far apart the corners `a` and `b` lie. */
const gap = ([ax, ay]: Corner, [bx, by]: Corner): number => Math.hypot(ax - bx, ay - by);

/** The farthest `path` gets from its first corner, and its longest step between two frames. */
function spanOf([first, ...path]: Corner[]): { far: number; step: number } {
  const start = present(first, 'corner');
  const far = Math.max(0, ...path.map((corner) => gap(corner, start)));
  const { step } = path.reduce(
    (on, corner) => ({ last: corner, step: Math.max(on.step, gap(corner, on.last)) }),
    { last: start, step: 0 },
  );
  return { far, step };
}

/**
 * The stage over Blackout's lab — or mission `missionId`'s, here with Blackout's map — at
 * 1440 × 820 after its lab has come in, things moving less or not: `bake` the canvas of its
 * drift's piece, the one its frames of the drift copy.
 */
async function staged(reduced: boolean, missionId = 'blackout') {
  const { openStage } = await import('../src/world/menu/stage.js');
  const places = await import('../src/world/menu/places.js');
  const page = framesByHand();
  const scene = sceneCanvas([1440, 820]);
  const motion = motionByHand(reduced);
  const stage = openStage(scene.canvas, motion);
  stage.show(missionId);
  await settled();
  page.run(1000);
  const bake = lastCopied(scene);
  if (bake === undefined) throw new Error('the scene baked nothing');
  return { page, scene, stage, bake, places };
}

/**
 * Runs `page`'s frames, a frame at a time, and lets each step the scene asks for of its rest's
 * baking come between them, as the browser's tasks come between its frames.
 */
async function framesAndSteps(page: ReturnType<typeof framesByHand>, frames = 12): Promise<void> {
  for (let i = 0; i < frames; i += 1) {
    page.run(1000 / 60);
    await settled();
  }
}

/** The sizes of the rest's pieces of Blackout's bake at 1440 × 820, as `w×h`. */
async function restSizes(): Promise<Set<string>> {
  const { bakeScene, freeBake } = await import('../src/world/menu/scene.js');
  const bake = bakeScene(blackoutLab(), 1440, 820, 1);
  if (bake === null) throw new Error('blackout baked no scene');
  freeBake(bake);
  return new Set(bake.pieces.slice(1).map(({ box }) => `${box.width}x${box.height}`));
}

/** How many canvases of the page hold pixels at one of `sizes`: the rest's pieces baked. */
const restBaked = (sizes: Set<string>): number =>
  made.filter((canvas) => canvas.width > 0 && sizes.has(`${canvas.width}x${canvas.height}`)).length;

describe('the kit a bake keeps', () => {
  it('is let go once a while has passed with nothing asking for the rest, as on a phone', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { openStage } = await import('../src/world/menu/stage.js');
      const page = framesByHand();
      const scene = sceneCanvas([1440, 820]);
      const stage = openStage(scene.canvas, motionByHand(false));
      stage.show('blackout');
      await vi.advanceTimersByTimeAsync(0);
      page.run(100);
      const kept = heldCanvases().length;
      await vi.advanceTimersByTimeAsync(4000);
      expect(heldCanvases()).toHaveLength(kept);
      await vi.advanceTimersByTimeAsync(1500);
      expect(heldCanvases().length).toBeLessThan(kept);
      stage.close();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the scene’s places', () => {
  it('bakes the drift’s piece alone while no lamp burns and no place is asked for', async () => {
    const sizes = await restSizes();
    const { page, stage, places } = await staged(false);
    await framesAndSteps(page);
    expect(restBaked(sizes)).toBe(0);
    // A place asked for, as a phone's focus moving asks: the rest is baked, piece by piece.
    places.holdPlace('handbook');
    await framesAndSteps(page);
    expect(restBaked(sizes)).toBeGreaterThan(0);
    stage.close();
  });

  it('bakes the rest after the first frames once the hero’s lamp is on', async () => {
    const sizes = await restSizes();
    const { page, stage } = await staged(false);
    const lamps = await import('../src/world/menu/lamp.js');
    lamps.holdLamp({ x: 1200, y: 600, angle: Math.PI, reach: 300, on: 0, flare: 0 });
    await framesAndSteps(page);
    // Not while the lamp is still off, the hero walking in.
    expect(restBaked(sizes)).toBe(0);
    lamps.holdLamp({ x: 1200, y: 600, angle: Math.PI, reach: 300, on: 1, flare: 0 });
    await framesAndSteps(page);
    expect(restBaked(sizes)).toBeGreaterThan(0);
    lamps.holdLamp(null);
    stage.close();
  });

  it('tells the hero’s lamp the place it goes to once its pieces are baked, none after', async () => {
    const { page, stage, places } = await staged(false);
    places.holdPlace('handbook');
    page.run(1000 / 60);
    expect(places.placeShown()).toBeNull();
    await framesAndSteps(page);
    expect(places.placeShown()).toBe('handbook');
    places.holdPlace(null);
    page.run(100);
    expect(places.placeShown()).toBeNull();
    places.holdPlace('handbook');
    await framesAndSteps(page);
    stage.close();
    expect(places.placeShown()).toBeNull();
    places.holdPlace(null);
  });

  it('tells the hero’s lamp no place in a lab without places, which drifts for every item', async () => {
    const { page, stage, places } = await staged(false, 'systemcheck');
    places.holdPlace('handbook');
    await framesAndSteps(page);
    page.run(500);
    expect(places.placeShown()).toBeNull();
    stage.close();
    places.holdPlace(null);
  });

  it('starts its camera anew with each bake: a lab come in shows its drift at once', async () => {
    const { page, scene, stage, bake, places } = await staged(false);
    places.holdPlace('handbook');
    await framesAndSteps(page, 8);
    page.run(2500);
    const [there] = corners(scene, bake, 0).slice(-1);
    // Another mission's lab, without places: the camera goes to its drift.
    stage.show('systemcheck');
    await settled();
    const from = scene.log.length;
    page.run(300);
    const next = present(lastCopied(scene), 'the lab come in');
    expect(next).not.toBe(bake);
    const coming = corners(scene, next, from);
    expect(spanOf([present(there, 'corner'), present(coming[0], 'corner')]).far).toBeGreaterThan(40);
    expect(spanOf(coming).step).toBeLessThan(5);
    stage.close();
    places.holdPlace(null);
  });

  it('travels to the place held over 1.2 to 2 s, holds it, and travels back', async () => {
    const { page, scene, stage, bake, places } = await staged(false);
    const from = scene.log.length;
    places.holdPlace('handbook');
    // The camera sets out once the pieces the place shows are baked, a frame after the last of
    // them: within these frames, the travel then under way for a few of them.
    await framesAndSteps(page, 8);
    page.run(1000);
    const early = corners(scene, bake, from).at(-1);
    page.run(1200);
    const going = corners(scene, bake, from);
    const there = going.at(-1);
    expect(early).not.toEqual(there);
    const { far, step } = spanOf(going);
    expect(far).toBeGreaterThan(40);
    // Eased: no frame jumps on the way.
    expect(step).toBeLessThan(far / 20);
    const held = scene.log.length;
    page.run(500);
    const holding = corners(scene, bake, held);
    expect(holding.length).toBeGreaterThan(5);
    expect(holding).toEqual(holding.map(() => there));
    const back = scene.log.length;
    places.holdPlace(null);
    page.run(300);
    const leaving = corners(scene, bake, back);
    expect(spanOf([present(there, 'corner'), ...leaving]).step).toBeLessThan(far / 20);
    expect(spanOf(leaving).far).toBeGreaterThan(0);
    stage.close();
  });
});

describe('the scene’s places under reduced motion and behind the lobby', () => {
  it('cuts to a place under reduced motion, and asks no frames once there', async () => {
    const { page, scene, stage, bake, places } = await staged(true);
    expect(page.pending()).toBe(0);
    const [still] = corners(scene, bake, 0).slice(-1);
    const from = scene.log.length;
    places.holdPlace('settings');
    expect(page.pending()).toBe(1);
    // Nothing is drawn while the place's pieces wait to be baked; once they are in, one cut.
    page.run(1000 / 60);
    expect(corners(scene, bake, from)).toEqual([]);
    await framesAndSteps(page);
    page.run(500);
    const cut = corners(scene, bake, from);
    expect(cut).toHaveLength(1);
    expect(cut[0]).not.toEqual(still);
    expect(page.pending()).toBe(0);
    stage.close();
  });

  it('stands at night with no hero on the stage, as on a phone, sunk once', async () => {
    const { page, stage, bake } = await staged(false);
    const sinks = (): string[] =>
      callEntries(drawnBy(bake), 'fillRect').flatMap(({ op }) => (op === 'source-atop' ? [op] : []));
    expect(sinks()).toHaveLength(1);
    page.run(1000);
    expect(sinks()).toHaveLength(1);
    stage.close();
  });

  it('shows the drift lit behind the lobby, cut there and back under the doors', async () => {
    const { page, scene, stage, bake, places } = await staged(false);
    places.holdPlace('history');
    await framesAndSteps(page);
    page.run(2500);
    const [there] = corners(scene, bake, 0).slice(-1);
    const baked = drawnBy(bake);
    const sunk = baked.length;
    stage.lobby(true);
    const from = scene.log.length;
    page.run(300);
    const behind = corners(scene, bake, from);
    // A cut to the drift, which goes on drifting a pixel or two a frame.
    expect(spanOf([present(there, 'corner'), present(behind[0], 'corner')]).far).toBeGreaterThan(40);
    expect(spanOf(behind).step).toBeLessThan(5);
    // Lit for the lobby: the bake added back onto itself.
    const relit = callEntries(baked.slice(sunk), 'drawImage');
    expect(relit.length).toBeGreaterThan(0);
    expect(relit.every((e) => e.op === 'lighter' && e.args[0] === bake)).toBe(true);
    const out = scene.log.length;
    stage.lobby(false);
    page.run(100);
    expect(corners(scene, bake, out)[0]).toEqual(there);
    stage.close();
  });
});

describe('the scene’s labs', () => {
  it('asks for a lab anew after it could not be had, and once a page once it was', async () => {
    const { sceneLab } = await import('../src/world/menu/scene.js');
    const asked = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ ok: false, json: async () => null })
      .mockResolvedValue({ ok: true, json: async () => BLACKOUT });
    vi.stubGlobal('fetch', asked);
    // The server down, then answering with an error: nothing to be had either time.
    expect(await sceneLab('blackout')).toBeNull();
    expect(await sceneLab('blackout')).toBeNull();
    const lab = await sceneLab('blackout');
    expect(lab?.missionId).toBe('blackout');
    expect(await sceneLab('blackout')).toBe(lab);
    expect(asked).toHaveBeenCalledTimes(3);
  });
});

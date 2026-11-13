import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseMission, type Mission } from '@escapelab/core';
import { coverZoom } from '../src/world/assemble.js';
import { SHOT_WIDE } from '../src/world/intro/shot.js';
import {
  DRIFT_MS,
  driftAt,
  driftBox,
  driftOffset,
  fadeAt,
  SCENE_FADE_MS,
  sceneShot,
} from '../src/world/menu/drift.js';
import {
  browserSceneHost,
  runScene,
  SCENE_FRAME_MS,
  type SceneHost,
} from '../src/world/menu/loop.js';
import {
  needsPaint,
  paintShow,
  showBake,
  type SceneBake,
  type SceneShow,
} from '../src/world/menu/scene.js';
import { parkedDrones, sceneViewOf } from '../src/world/menu/view.js';
import { tileCss } from '../src/world/viewport.js';
import { callEntries, fakeCanvas } from './fakeCanvas.js';

const mission = (id: string): Mission =>
  parseMission(
    JSON.parse(readFileSync(new URL(`../../../missions/${id}.json`, import.meta.url), 'utf8')),
  );

const blackout = mission('blackout');

describe('the scene’s lab', () => {
  const view = sceneViewOf(blackout);
  const map = view.map;

  it('is a run of the mission begun for its least crew, its power on', () => {
    expect(view.phase).toBe('playing');
    expect(view.missionId).toBe('blackout');
    expect(view.lights.out).toBe(false);
    expect(view.players).toHaveLength(blackout.players.min);
    expect(map?.width).toBe(36);
  });

  it('glimpses every console, source and note in the lit lab, naming none of them', () => {
    expect(map?.stations).toHaveLength(blackout.map.stations.length);
    expect(map?.manuals).toHaveLength(blackout.map.manuals.length);
    expect(map?.notes).toHaveLength(blackout.map.notes.length);
    const found = [...(map?.manuals ?? []), ...(map?.notes ?? [])].filter((it) => it.found);
    expect(found).toEqual([]);
  });

  it('parks every drone over its first waypoint, facing east, awake but still', () => {
    const parked = parkedDrones(blackout);
    expect(Object.keys(parked)).toEqual(blackout.map.drones.map((drone) => drone.id));
    for (const drone of blackout.map.drones) {
      const start = drone.waypoints[0];
      expect(parked[drone.id]).toMatchObject({
        x: (start?.x ?? 0) + 0.5,
        y: (start?.y ?? 0) + 0.5,
        facing: 0,
        alerted: false,
        frozen: false,
      });
    }
  });

  it('lights a mission that starts in the dark as well', () => {
    const tutorial = sceneViewOf(mission('systemcheck'));
    expect(tutorial.lights.out).toBe(false);
    expect(tutorial.map?.stations.length).toBeGreaterThan(0);
  });
});

describe('the drift', () => {
  it('runs from the reactor end to the spawn and back in DRIFT_MS', () => {
    expect(driftAt(0, false)).toBe(0);
    expect(driftAt(DRIFT_MS / 2, false)).toBe(1);
    expect(driftAt(DRIFT_MS, false)).toBe(0);
    expect(driftAt(DRIFT_MS / 4, false)).toBeCloseTo(0.5);
    expect(driftAt(DRIFT_MS * 1.25, false)).toBeCloseTo(0.5);
  });

  it('rests a moment at either end, easing out of one and into the other', () => {
    const step = 100;
    const atEnd = driftAt(step, false) - driftAt(0, false);
    const midway = driftAt(DRIFT_MS / 4 + step, false) - driftAt(DRIFT_MS / 4, false);
    expect(atEnd).toBeLessThan(midway / 20);
  });

  it('stands still at the reactor end under reduced motion', () => {
    for (const ms of [0, 1234, DRIFT_MS / 2, 99_999]) {
      expect(driftAt(ms, true)).toBe(0);
    }
  });

  it('brings a mission picked anew in over SCENE_FADE_MS', () => {
    expect(fadeAt(1000, 1000)).toBe(0);
    expect(fadeAt(1000, 1000 + SCENE_FADE_MS / 2)).toBeCloseTo(0.5);
    expect(fadeAt(1000, 1000 + SCENE_FADE_MS)).toBe(1);
    expect(fadeAt(1000, 99_999)).toBe(1);
  });
});

describe('the scene’s shot', () => {
  const map = sceneViewOf(blackout).map;
  if (map === null) {
    throw new Error('the scene has no map');
  }
  const [w, h] = [1440, 820];
  const shot = sceneShot(map, w, h, 1);

  it('frames the lab as the opening does: a little wider than play, never past its walls', () => {
    const play = tileCss({ height: h, bar: 0, touch: false });
    expect(shot.scale).toBeCloseTo(Math.max(coverZoom(map, w, h), play * SHOT_WIDE));
    expect(shot.scale).toBeGreaterThanOrEqual(coverZoom(map, w, h));
  });

  it('runs from the reactor end towards the spawn, both ends inside the lab', () => {
    const half = { x: w / 2 / shot.scale, y: h / 2 / shot.scale };
    for (const end of [shot.from, shot.to]) {
      expect(end.x).toBeGreaterThanOrEqual(half.x - 1e-9);
      expect(end.x).toBeLessThanOrEqual(map.width - half.x + 1e-9);
      expect(end.y).toBeGreaterThanOrEqual(half.y - 1e-9);
      expect(end.y).toBeLessThanOrEqual(map.height - half.y + 1e-9);
    }
    // Blackout's reactor lies east, its spawn west: the shot crosses the lab.
    expect(shot.from.x).toBeGreaterThan(shot.to.x);
  });

  it('bakes the box the drift shows and copies every frame from inside it', () => {
    const box = driftBox(shot, w, h);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.left + box.width).toBeLessThanOrEqual(Math.ceil(map.width * shot.scale));
    for (let progress = 0; progress <= 1; progress += 0.05) {
      const at = driftOffset(shot, box, w, h, progress);
      expect(Number.isInteger(at.x) && Number.isInteger(at.y)).toBe(true);
      expect(at.x).toBeGreaterThanOrEqual(0);
      expect(at.y).toBeGreaterThanOrEqual(0);
      expect(at.x + w).toBeLessThanOrEqual(box.width);
      expect(at.y + h).toBeLessThanOrEqual(box.height);
    }
    const there = driftOffset(shot, box, w, h, 0);
    const back = driftOffset(shot, box, w, h, 1);
    expect(there.x - back.x).toBe(
      Math.round(shot.from.x * shot.scale - w / 2) - Math.round(shot.to.x * shot.scale - w / 2),
    );
  });
});

/** A fake page for the scene's loop: its animation frames run by hand, its showing set by hand. */
function fakeHost(): {
  host: SceneHost;
  run: (ms: number) => void;
  show: (shown: boolean) => void;
} {
  let queued: ((now: number) => void)[] = [];
  let seen: ((shown: boolean) => void) | null = null;
  let now = 0;
  const host: SceneHost = {
    frame: (run) => {
      queued.push(run);
      return queued.length;
    },
    cancel: () => {
      queued = [];
    },
    watch: (tell) => {
      seen = tell;
      tell(true);
      return () => {
        seen = null;
      };
    },
  };
  return {
    host,
    // Runs the animation frames of the next `ms` at 60 Hz.
    run: (ms) => {
      for (let n = Math.round((ms * 60) / 1000); n > 0; n -= 1) {
        now += 1000 / 60;
        const due = queued;
        queued = [];
        for (const frame of due) frame(now);
      }
    },
    show: (shown) => seen?.(shown),
  };
}

describe('the scene’s loop', () => {
  it('draws 30 frames a second on a 60 Hz screen, and records every frame', () => {
    const page = fakeHost();
    const painted: number[] = [];
    const frames: number[] = [];
    const stop = runScene((now) => painted.push(now), page.host, (ms) => frames.push(ms));
    page.run(1000);
    expect(painted).toHaveLength(30);
    expect(frames).toHaveLength(59);
    for (const [i, at] of painted.entries()) {
      if (i > 0) expect(at - (painted[i - 1] ?? 0)).toBeGreaterThanOrEqual(SCENE_FRAME_MS - 1);
    }
    stop();
  });

  it('draws nothing while it does not show, and goes on once it does again', () => {
    const page = fakeHost();
    let painted = 0;
    const frames: number[] = [];
    const stop = runScene(() => (painted += 1), page.host, (ms) => frames.push(ms));
    page.run(500);
    const before = painted;
    page.show(false);
    page.run(2000);
    expect(painted).toBe(before);
    page.show(true);
    page.run(500);
    expect(painted).toBeGreaterThan(before + 10);
    // The time hidden is no frame of the scene's.
    expect(Math.max(...frames)).toBeLessThan(20);
    stop();
    const after = painted;
    page.run(500);
    expect(painted).toBe(after);
  });
});

describe('the browser’s side of the loop', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stops while the tab is hidden', () => {
    let visibility = 'visible';
    const listeners = new Set<() => void>();
    vi.stubGlobal('document', {
      get visibilityState() {
        return visibility;
      },
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    });
    vi.stubGlobal('IntersectionObserver', undefined);
    const told: boolean[] = [];
    const stop = browserSceneHost({} as HTMLCanvasElement).watch((shown) => told.push(shown));
    visibility = 'hidden';
    listeners.forEach((listener) => listener());
    visibility = 'visible';
    listeners.forEach((listener) => listener());
    expect(told).toEqual([true, false, true]);
    stop();
    expect(listeners.size).toBe(0);
  });
});

/** A bake for a canvas 100 × 50 of the scene's lab, its box twice as wide. */
function bakeOf(name: string): SceneBake {
  return {
    canvas: fakeCanvas(200, 50, name).canvas,
    shot: { from: { x: 3, y: 1 }, to: { x: 1, y: 1 }, scale: 50 },
    box: { left: 0, top: 0, width: 200, height: 50 },
    w: 100,
    h: 50,
  };
}

const noShow = (): SceneShow => ({ bake: null, from: null, since: 0, drawn: null });

describe('what the scene draws', () => {
  it('fades its first lab in over nothing, then copies it alone, once a frame', () => {
    const { ctx, log } = fakeCanvas(100, 50);
    const show = noShow();
    const first = bakeOf('first');
    showBake(show, first, 0, true);
    paintShow(ctx, show, SCENE_FADE_MS / 2, 0, false);
    expect(callEntries(log, 'clearRect')).toHaveLength(1);
    const half = callEntries(log, 'drawImage');
    expect(half.map((call) => call.alpha)).toEqual([0.5]);
    log.length = 0;
    paintShow(ctx, show, SCENE_FADE_MS, 0, false);
    expect(callEntries(log, 'clearRect')).toHaveLength(0);
    expect(callEntries(log, 'drawImage').map((call) => call.alpha)).toEqual([1]);
  });

  it('brings a mission picked anew in over the one before', () => {
    const { ctx, log } = fakeCanvas(100, 50);
    const show = noShow();
    const before = bakeOf('before');
    const next = bakeOf('next');
    showBake(show, before, 0, false);
    showBake(show, next, 1000, true);
    paintShow(ctx, show, 1000 + SCENE_FADE_MS / 4, 0, false);
    const drawn = callEntries(log, 'drawImage');
    const names = drawn.map((call) => (call.args[0] as { name: string }).name);
    expect(names).toEqual(['before', 'next']);
    expect(drawn.map((call) => call.alpha)).toEqual([1, 0.25]);
    paintShow(ctx, show, 1000 + SCENE_FADE_MS, 0, false);
    expect(show.from).toBeNull();
  });

  it('copies the bake as far along the shot as the drift has come', () => {
    const { ctx, log } = fakeCanvas(100, 50);
    const show = noShow();
    showBake(show, bakeOf('lab'), 0, false);
    paintShow(ctx, show, 0, 0, false);
    paintShow(ctx, show, 1, DRIFT_MS / 2, false);
    const [there, back] = callEntries(log, 'drawImage').map((call) => call.args[1]);
    // At the reactor end the frame starts 100 px in, at the spawn at the box's left edge.
    expect([there, back]).toEqual([-100, -0]);
  });

  it('draws a still lab once under reduced motion, and again only for a new one', () => {
    const show = noShow();
    expect(needsPaint(show, 0, true)).toBe(false);
    showBake(show, bakeOf('lab'), 0, false);
    expect(needsPaint(show, 0, true)).toBe(true);
    paintShow(fakeCanvas(100, 50).ctx, show, 0, 0, true);
    expect(needsPaint(show, 10_000, true)).toBe(false);
    expect(needsPaint(show, 10_000, false)).toBe(true);
    showBake(show, bakeOf('next'), 10_000, true);
    expect(needsPaint(show, 10_000 + SCENE_FADE_MS / 2, true)).toBe(true);
  });

  it('comes in over nothing where the lab before was baked for another size', () => {
    const show = noShow();
    showBake(show, bakeOf('small'), 0, false);
    const larger = { ...bakeOf('large'), w: 120 };
    showBake(show, larger, 10, true);
    expect(show.from).toBeNull();
  });
});

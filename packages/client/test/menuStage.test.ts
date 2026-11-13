import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMission } from '@escapelab/core';
import type { StageMotion } from '../src/world/menu/stage.js';
import { parkedDrones, sceneViewOf } from '../src/world/menu/view.js';
import { callEntries, fakeCanvas, FakePath2D, type FakeCanvas } from './fakeCanvas.js';

/** Blackout as GET /missions/blackout answers it. */
const BLACKOUT: unknown = JSON.parse(
  readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8'),
);

/** The canvases the page has made, in order: the bake's, its overlay, what its kit made. */
let made: HTMLCanvasElement[] = [];

/** A page for the scene in node: canvases that record what they draw, no observers, the tab up. */
function stubPage(): void {
  made = [];
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
      const { canvas } = fakeCanvas(300, 150, `made ${made.length}`);
      made.push(canvas);
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

/** The menu's canvas, 160 × 90 CSS pixels on the page. */
function sceneCanvas(): FakeCanvas {
  const scene = fakeCanvas(300, 150, 'scene');
  Object.assign(scene.canvas, { clientWidth: 160, clientHeight: 90 });
  return scene;
}

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
    const mission = parseMission(BLACKOUT);
    const lab = { missionId: 'blackout', view: sceneViewOf(mission), drones: parkedDrones(mission) };
    const bake = bakeScene(lab, 160, 90, 1);
    const map = lab.view.map;
    if (bake === null || map === null) {
      throw new Error('blackout baked no scene');
    }
    expect(made.length).toBeGreaterThan(10);
    const held = made.filter((canvas) => canvas.width * canvas.height > 0);
    // Beside the bake, only the ceiling's light is left: one pixel a tile (power.ts).
    expect(held.map(sizeOf)).toEqual([sizeOf(bake.canvas), [map.width, map.height]]);
  });

  it('frees what it made where the box is too large to bake', async () => {
    const { bakeScene } = await import('../src/world/menu/scene.js');
    const mission = parseMission(BLACKOUT);
    const lab = { missionId: 'blackout', view: sceneViewOf(mission), drones: parkedDrones(mission) };
    expect(bakeScene(lab, 20_000, 12_000, 1)).toBeNull();
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
    const [bake] = made;
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

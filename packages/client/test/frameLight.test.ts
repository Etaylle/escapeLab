import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { frameLight, ownLamp, type LightScene } from '../src/world/frameLight.js';
import { newSim, type Sim } from '../src/world/sim.js';
import { FakePath2D } from './fakeCanvas.js';
import { mapWith } from './fixtures.js';
import { TILES } from './frames.js';

const MAP = mapWith({ width: 10, height: 6, tiles: TILES });

/** The dark lab with you in it, nobody else, no drone, no lamp on a wall. */
function sceneOf(sim: Sim): LightScene {
  return {
    map: MAP,
    sim,
    drones: {},
    spectator: false,
    run: 1,
    now: 0,
    hatch: 0,
    mounts: [],
    clips: new WeakMap(),
    reduced: false,
  };
}

/** Your light walking east at (x, 2.5), `phase` into your walk, in the dark. */
function walkingAt(scene: LightScene, x: number, phase: number) {
  Object.assign(scene.sim.self, { x, y: 2.5, facing: 0, moving: true });
  scene.sim.walkPhase = phase;
  return frameLight(scene, false, false).own;
}

describe('frameLight — your flashlight in the dark', () => {
  beforeEach(() => {
    vi.stubGlobal('Path2D', FakePath2D);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps its sight as you pace back over the same ground, however your step sways it', () => {
    const scene = sceneOf(newSim(0));
    const there = walkingAt(scene, 3.25, 0.1);
    walkingAt(scene, 3.5, 0.3);
    const back = walkingAt(scene, 3.25, 0.65);
    // The same sight and clip, taken once: pacing costs no sight a frame.
    expect(back?.sight).toBe(there?.sight);
    expect(back?.clip).toBe(there?.clip);
    // The lamp in your hands swayed meanwhile, and the light is laid from it.
    expect(back?.lamp).not.toEqual(there?.lamp);
    expect(back?.lamp).toEqual(ownLamp(scene.sim, false));
  });

  it('takes a sight anew only where you stand somewhere new', () => {
    const scene = sceneOf(newSim(0));
    const here = walkingAt(scene, 3.25, 0.1);
    const further = walkingAt(scene, 3.75, 0.1);
    expect(further?.sight).not.toBe(here?.sight);
  });
});

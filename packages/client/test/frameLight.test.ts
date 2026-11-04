import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LAMP_HALF_ANGLE, LAMP_REACH } from '@escapelab/core';
import { frameLight, ownLamp, type LightScene } from '../src/world/frameLight.js';
import { lightCensus } from '../src/world/render/census.js';
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
    census: lightCensus(),
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
    // The same sight and clip, taken once: pacing costs no sight a frame, and the census says so.
    expect(back?.sight).toBe(there?.sight);
    expect(back?.clip).toBe(there?.clip);
    expect(scene.census.sights).toBe(2);
    // The lamp in your hands swayed meanwhile, and the light is laid from it.
    expect(back?.lamp).not.toEqual(there?.lamp);
    expect(back?.lamp).toEqual(ownLamp(scene.sim, false));
  });

  it('takes a sight anew only where you stand somewhere new', () => {
    const scene = sceneOf(newSim(0));
    const here = walkingAt(scene, 3.25, 0.1);
    const further = walkingAt(scene, 3.75, 0.1);
    expect(further?.sight).not.toBe(here?.sight);
    expect(scene.census.sights).toBe(2);
    walkingAt(scene, 3.75, 0.4);
    expect(scene.census.sights).toBe(2);
  });

  it('shines its beam 7.5 tiles, further than its cone finds things, and as wide', () => {
    const scene = sceneOf(newSim(0));
    // Facing east down the lab's open row: its far end lies 7 tiles ahead.
    const own = walkingAt(scene, 1.5, 0.1);
    expect(own?.lamp.beam).toMatchObject({ reach: 7.5, halfAngle: LAMP_HALF_ANGLE });
    expect(LAMP_REACH).toBeLessThan(7.5);
    // Its light falls that far: what lies out there shows, its name only once the lamp finds it.
    expect(own?.sight.tiles.has('8,2')).toBe(true);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LAMP_HALF_ANGLE, LAMP_REACH } from '@escapelab/core';
import { CREW_REACH } from '../src/world/beam.js';
import { handLamp } from '../src/world/figure.js';
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

describe('frameLight — the lamps the rest of the crew carry', () => {
  beforeEach(() => {
    vi.stubGlobal('Path2D', FakePath2D);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** The dark lab with you at its west end facing north, Ben at (x, 2.5) facing `facing`. */
  function withBen(x: number, facing: number, moving = false): LightScene {
    const sim = newSim(0);
    Object.assign(sim.self, { x: 1.5, y: 1.5, facing: -Math.PI / 2, moving: false });
    sim.others.set('p2', { x, y: 2.5, facing, moving, rx: x, ry: 2.5, phase: 0.3 });
    return sceneOf(sim);
  }

  it('gives their lamp a beam where they face, as wide as yours, CREW_REACH long', () => {
    const [ben] = frameLight(withBen(7.5, Math.PI), false, false).crew;
    expect(ben?.lamp.beam).toMatchObject({ reach: CREW_REACH, halfAngle: LAMP_HALF_ANGLE });
    expect(ben?.lamp.beam?.facing).toBeCloseTo(Math.PI, 12);
    // Its light reaches across the lab, beyond their glow: tiles their figure is nowhere near.
    expect(ben?.sight.tiles.has('3,2')).toBe(true);
  });

  it('lays their beam from their hands as they walk, its sight from where they stand', () => {
    const scene = withBen(6.5, Math.PI, true);
    const [ben] = frameLight(scene, false, false).crew;
    const other = scene.sim.others.get('p2') ?? withBenOther();
    const at = { x: 6.5, y: 2.5, facing: Math.PI, moving: true };
    const hand = handLamp(at, other.phase, false);
    const lamp = ben?.lamp;
    expect([lamp?.x, lamp?.y, lamp?.beam?.facing]).toEqual([hand.x, hand.y, hand.facing]);
    // The same standing place a frame later: the same sight, however the lamp swayed.
    scene.sim.others.set('p2', { ...other, phase: 0.6 });
    const [again] = frameLight(scene, false, false).crew;
    expect(again?.sight).toBe(ben?.sight);
    expect(again?.lamp).not.toEqual(lamp);
  });

  it('shows what their beam falls on to you too: a seen light, as theirs to them', () => {
    // A corridor 14 tiles long: you at its west end facing the wall, Ben at its east end.
    const corridor = mapWith({
      width: 16,
      height: 5,
      tiles: ['################', ...Array(3).fill('#..............#'), '################'],
    });
    const scene = { ...withBen(14.5, Math.PI), map: corridor };
    const alone = { ...sceneOf(newSim(0)), map: corridor };
    Object.assign(alone.sim.self, { x: 1.5, y: 1.5, facing: -Math.PI / 2, moving: false });
    // (10, 2) lies four tiles west of Ben, at his beam's tip, beyond his glow and far from you.
    expect(frameLight(alone, false, false).shown(10, 2)).toBe(false);
    expect(frameLight(scene, false, false).shown(10, 2)).toBe(true);
  });
});

/** Ben standing still at (6.5, 2.5), facing west. */
function withBenOther() {
  return { x: 6.5, y: 2.5, facing: Math.PI, moving: false, rx: 6.5, ry: 2.5, phase: 0 };
}

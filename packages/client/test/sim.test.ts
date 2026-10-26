import { describe, expect, it } from 'vitest';
import {
  follow,
  followServer,
  LEAD_TILES,
  newSim,
  SPRINT_KEY,
  walk,
  type Footfall,
  type Sim,
} from '../src/world/sim.js';
import { clampCamera } from '../src/world/viewport.js';
import { mapWith } from './fixtures.js';
import { TILES } from './frames.js';

/** Walks `frames` frames of 1/60 s holding `key`, from (x, y); where the avatar ends up. */
function walked(
  decor: { kind: 'shelf'; x: number; y: number }[],
  key: string,
  [x, y]: readonly [number, number],
  frames = 60,
): { x: number; y: number } {
  const map = mapWith({ width: 10, height: 6, tiles: TILES, decor });
  const sim = newSim(0);
  Object.assign(sim.self, { x, y });
  sim.keys.add(key);
  for (let i = 0; i < frames; i++) {
    walk(sim, map, 1 / 60, false);
  }
  return { x: sim.self.x, y: sim.self.y };
}

describe('walk — furniture stands in the way like a wall', () => {
  it('walks on over the floor where nothing stands', () => {
    expect(walked([], 'd', [1.5, 3.5]).x).toBeGreaterThan(4);
  });

  it('stops the avatar at a piece of furniture, its body short of the tile', () => {
    const { x } = walked([{ kind: 'shelf', x: 3, y: 3 }], 'd', [1.5, 3.5]);
    expect(x).toBeLessThan(3);
    expect(x).toBeGreaterThan(2.5);
  });

  it('lets the avatar pass beside it, on the next row', () => {
    expect(walked([{ kind: 'shelf', x: 3, y: 3 }], 'd', [1.5, 2.5]).x).toBeGreaterThan(4);
  });
});

/** The lab's open middle row, (1,2) to (8,2): room to run a second east. */
const OPEN = mapWith({ width: 10, height: 6, tiles: TILES });

/** `frames` frames of 1/60 s east from (1.5, 2.5) with `held` held: how far, and each footfall. */
function ran(held: string[], frames = 60, locked = false) {
  const sim = newSim(0);
  Object.assign(sim.self, { x: 1.5, y: 2.5 });
  for (const key of held) {
    sim.keys.add(key);
  }
  const falls: Footfall[] = [];
  const at: number[] = [];
  for (let i = 0; i < frames; i++) {
    const fall = walk(sim, OPEN, 1 / 60, locked);
    if (fall !== null) {
      falls.push(fall);
    }
    at.push(sim.self.x);
  }
  return { tiles: sim.self.x - 1.5, falls, at, sim };
}

describe('walk — the sprint', () => {
  it('runs 1.3 times the walk with Shift held, for as long as it is held', () => {
    expect(ran(['d']).tiles).toBeCloseTo(4.2, 6);
    const sprint = ran(['d', SPRINT_KEY]);
    expect(sprint.tiles).toBeCloseTo(4.2 * 1.3, 6);
    // No stamina: the second half second as fast as the first.
    const half = (sprint.at[29] ?? 0) - 1.5;
    expect((sprint.at[59] ?? 0) - (sprint.at[29] ?? 0)).toBeCloseTo(half, 6);
  });

  it('lands its footfalls faster at a sprint, each told a sprint’s', () => {
    const walking = ran(['d']).falls;
    const sprinting = ran(['d', SPRINT_KEY]).falls;
    expect(sprinting.length).toBeGreaterThan(walking.length);
    expect(new Set(walking)).toEqual(new Set(['walk']));
    expect(new Set(sprinting)).toEqual(new Set(['sprint']));
    // A footfall every half tile run, at either pace, counted for the walkthrough's probe.
    expect(ran(['d', SPRINT_KEY]).sim.footfalls).toBe(sprinting.length);
  });

  it('swings the legs as much faster as it runs', () => {
    const phaseAfter = (held: string[]): number => ran(held, 12).sim.walkPhase;
    expect(phaseAfter(['d', SPRINT_KEY])).toBeCloseTo(phaseAfter(['d']) * 1.3, 9);
  });

  it('moves nothing on Shift alone, nor while input is locked', () => {
    const still = ran([SPRINT_KEY]);
    expect(still.tiles).toBe(0);
    expect(still.falls).toEqual([]);
    expect(still.sim.self.moving).toBe(false);
    expect(ran(['d', SPRINT_KEY], 60, true).tiles).toBe(0);
  });
});

/** Follows for `seconds` in frames of 1/60 s, the bar at no reach. */
function follows(sim: Sim, seconds: number, reduced = false): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    follow(sim, 1 / 60, 0, reduced);
  }
}

/** A world whose avatar stands at (5, 3), walking `facing` (radians) or standing. */
function walking(facing: number, moving = true): Sim {
  const sim = newSim(0);
  Object.assign(sim.self, { x: 5, y: 3, facing, moving });
  sim.cam = { x: 5, y: 3 };
  return sim;
}

describe('follow — the camera leads the walk', () => {
  it('looks up to 0.6 tiles ahead the way the avatar walks, eased in over about 300 ms', () => {
    const sim = walking(0);
    follows(sim, 0.1);
    const early = sim.lead.x;
    follows(sim, 0.2);
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(sim.lead.x);
    // 300 ms in: 95 % of the way, eased, not jumped.
    expect(sim.lead.x).toBeGreaterThan(0.94 * LEAD_TILES);
    expect(sim.lead.x).toBeLessThan(LEAD_TILES);
    follows(sim, 2);
    expect(sim.lead.x).toBeCloseTo(0.6, 6);
    expect(sim.lead.y).toBeCloseTo(0, 9);
  });

  it('settles back as the avatar stands', () => {
    const sim = walking(Math.PI / 2);
    follows(sim, 2);
    expect(sim.lead.y).toBeCloseTo(0.6, 6);
    sim.self.moving = false;
    follows(sim, 0.3);
    expect(sim.lead.y).toBeLessThan(0.06 * LEAD_TILES);
    follows(sim, 2);
    expect(Math.hypot(sim.lead.x, sim.lead.y)).toBeCloseTo(0, 6);
  });

  it('leads a diagonal walk no further than straight ahead', () => {
    const sim = walking(Math.PI / 4);
    follows(sim, 3);
    expect(Math.hypot(sim.lead.x, sim.lead.y)).toBeCloseTo(0.6, 6);
    expect(sim.lead.x).toBeCloseTo(sim.lead.y, 9);
  });

  it('puts the camera ahead of the avatar by its lead', () => {
    const sim = walking(Math.PI);
    follows(sim, 4);
    expect(sim.cam.x).toBeCloseTo(5 - 0.6, 4);
    expect(sim.cam.y).toBeCloseTo(3, 6);
  });

  it('leads nowhere where the player asked for less motion', () => {
    const sim = walking(0);
    follows(sim, 2, true);
    expect(sim.lead).toEqual({ x: 0, y: 0 });
    expect(sim.cam.x).toBeCloseTo(5, 6);
  });

  it('keeps the frame’s clamp: at the lab’s edge the lead looks past no wall', () => {
    const sim = walking(0);
    Object.assign(sim.self, { x: 9.5 });
    follows(sim, 4);
    expect(sim.cam.x).toBeGreaterThan(9.5);
    const lens = { scale: 100, w: 800, h: 600, top: 0, lift: 0 };
    expect(clampCamera(OPEN, sim.cam, lens).x).toBe(10 - 4);
  });

  it('starts a new run with no lead', () => {
    const sim = walking(0);
    follows(sim, 1);
    followServer(sim, { run: 7, players: {} }, OPEN, 'p1', 7);
    expect(sim.lead).toEqual({ x: 0, y: 0 });
  });
});

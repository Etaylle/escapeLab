import { describe, expect, it } from 'vitest';
import {
  follow,
  followServer,
  LEAD_TILES,
  newSim,
  walk,
  type Footfall,
  type Sim,
} from '../src/world/sim.js';
import type { Held } from '../src/input/bindings.js';
import { clampCamera } from '../src/world/viewport.js';
import { mapWith } from './fixtures.js';
import { TILES } from './frames.js';

/** Walks `frames` frames of 1/60 s holding `move`, from (x, y); where the avatar ends up. */
function walked(
  decor: { kind: 'shelf'; x: number; y: number }[],
  move: Held,
  [x, y]: readonly [number, number],
  frames = 60,
): { x: number; y: number } {
  const map = mapWith({ width: 10, height: 6, tiles: TILES, decor });
  const sim = newSim(0);
  Object.assign(sim.self, { x, y });
  sim.keys.add(move);
  for (let i = 0; i < frames; i++) {
    walk(sim, map, 1 / 60, false);
  }
  return { x: sim.self.x, y: sim.self.y };
}

describe('walk — furniture stands in the way like a wall', () => {
  it('walks on over the floor where nothing stands', () => {
    expect(walked([], 'right', [1.5, 3.5]).x).toBeGreaterThan(4);
  });

  it('stops the avatar at a piece of furniture, its body short of the tile', () => {
    const { x } = walked([{ kind: 'shelf', x: 3, y: 3 }], 'right', [1.5, 3.5]);
    expect(x).toBeLessThan(3);
    expect(x).toBeGreaterThan(2.5);
  });

  it('lets the avatar pass beside it, on the next row', () => {
    expect(walked([{ kind: 'shelf', x: 3, y: 3 }], 'right', [1.5, 2.5]).x).toBeGreaterThan(4);
  });
});

/** A corridor north to south with a door at (2,3), shut: the plate it waits for let go. */
const DOORWAY = mapWith({
  width: 5,
  height: 7,
  tiles: ['#####', '#...#', '#...#', '##.##', '#...#', '#...#', '#####'],
  doors: [{ id: 'tuer', x: 2, y: 3, open: false }],
});

/**
 * An avatar at `y` on the corridor's middle column, the server having it at `kept` by its
 * positions, the page having last sent `sent`, walking `move` for half a second: where it ends.
 */
function fromDoor(y: number, kept: number, move: Held, sent = kept): number {
  const sim = newSim(0);
  Object.assign(sim.self, { x: 2.5, y });
  sim.streamed = [{ x: 2.5, y: sent, at: 0 }];
  sim.serverSpot = { x: 2.5, y: kept };
  sim.keys.add(move);
  for (let i = 0; i < 30; i++) {
    walk(sim, DOORWAY, 1 / 60, false);
  }
  return sim.self.y;
}

describe('walk — a door shut on a walker', () => {
  it('lets out either way a walker the server had in the doorway as it shut', () => {
    expect(fromDoor(3.4, 3.35, 'down')).toBeGreaterThan(4.5);
    expect(fromDoor(3.4, 3.35, 'up')).toBeLessThan(2.5);
  });

  it('takes one the server still had before the door back that way, never through', () => {
    expect(fromDoor(3.2, 2.9, 'down')).toBeLessThan(4);
    expect(fromDoor(3.2, 2.9, 'up')).toBeLessThan(2.5);
  });

  it('takes one whose step in the server refused back, though the page sent it in', () => {
    // the door shut on the server before the step into it came: it kept the walker before it
    expect(fromDoor(3.4, 2.9, 'down', 3.4)).toBeLessThan(4);
    expect(fromDoor(3.4, 2.9, 'up', 3.4)).toBeLessThan(2.5);
  });

  it('keeps where the server has the avatar by its positions of this run, none of another', () => {
    const sim = newSim(0);
    const kept = { x: 2.5, y: 2.9, facing: 0, moving: false, t: null, rt: 0 };
    followServer(sim, { run: 5, players: { p1: kept } }, DOORWAY, 'p1', 5);
    expect(sim.serverSpot).toEqual({ x: 2.5, y: 2.9 });
    followServer(sim, { run: 4, players: { p1: kept } }, DOORWAY, 'p1', 5);
    expect(sim.serverSpot).toBeNull();
  });

  it('lets a body the door shut on from outside step back, its centre never in', () => {
    expect(fromDoor(2.85, 2.85, 'up')).toBeLessThan(2.5);
    expect(fromDoor(2.85, 2.85, 'down')).toBeLessThan(3);
  });

  it('stops a walker coming up to it, the body short of the doorway', () => {
    const y = fromDoor(1.5, 1.5, 'down');
    expect(y).toBeLessThanOrEqual(3 - 0.28);
    expect(y).toBeGreaterThan(3 - 0.28 - 0.08);
  });
});

/** A room over a corridor, joined by a one-tile opening at (4,3). */
const OPENING = mapWith({
  width: 9,
  height: 7,
  tiles: [
    '#########',
    '#.......#',
    '#.......#',
    '####.####',
    '#.......#',
    '#.......#',
    '#########',
  ],
});

/** Walking `held` for `frames` frames from (x, y): where the avatar ends, and its sim. */
function walkedFrom(
  map: typeof OPENING,
  held: Held[],
  [x, y]: readonly [number, number],
  frames = 40,
) {
  const sim = newSim(0);
  Object.assign(sim.self, { x, y });
  for (const move of held) {
    sim.keys.add(move);
  }
  const sounds: (string | null)[] = [];
  for (let i = 0; i < frames; i++) {
    sounds.push(walk(sim, map, 1 / 60, false));
  }
  return { at: { x: sim.self.x, y: sim.self.y }, sim, sounds };
}

describe('walk — a body caught on the edge of an opening is nudged into it', () => {
  it('passes a one-tile opening up to 0.3 tiles of its body over the edge, either side', () => {
    for (const off of [0, 0.22, -0.22, 0.3, -0.3, 0.45, -0.45, 0.51, -0.51]) {
      const { at } = walkedFrom(OPENING, ['up'], [4.5 + off, 4.6]);
      expect(at.y, `offset ${off}`).toBeLessThan(2.5);
      // through the opening, nudged across no further than its body overlapped the edge
      expect(Math.abs(at.x - 4.5), `offset ${off}`).toBeLessThanOrEqual(0.22 + 1e-9);
      const nudged = Math.abs(at.x - (4.5 + off));
      const overlap = Math.max(0, Math.abs(off) - 0.22);
      expect(nudged, `offset ${off}`).toBeLessThanOrEqual(overlap + 0.011);
    }
  });

  it('stops dead against the wall where more than 0.3 tiles of the body overlaps it', () => {
    for (const off of [0.6, -0.6]) {
      const { at } = walkedFrom(OPENING, ['up'], [4.5 + off, 4.6]);
      expect(at.y).toBeGreaterThan(3);
      expect(at.x).toBeCloseTo(4.5 + off, 9);
    }
  });

  it('never nudges against the way the player leans: up and right slides on along the wall', () => {
    const { at } = walkedFrom(OPENING, ['up', 'right'], [4.9, 4.6], 20);
    expect(at.y).toBeGreaterThan(3);
    expect(at.x).toBeGreaterThan(4.9);
  });

  it('still funnels a slant into the opening', () => {
    const { at } = walkedFrom(OPENING, ['up', 'left'], [5.2, 4.6]);
    expect(at.y).toBeLessThan(3);
  });
});

describe('walk — against a wall', () => {
  it('stops the steps and the legs, and bumps once a push', () => {
    const { sim, sounds } = walkedFrom(OPENING, ['up'], [2.5, 4.6], 120);
    expect(sounds.filter((sound) => sound === 'bump')).toHaveLength(1);
    const steps = sim.footfalls;
    const legs = sim.walkPhase;
    for (let i = 0; i < 120; i++) {
      walk(sim, OPENING, 1 / 60, false);
    }
    expect(sim.footfalls).toBe(steps);
    expect(sim.walkPhase).toBe(legs);
    expect(sim.bumps).toBe(1);
    // let go and push again: another bump
    sim.keys.clear();
    walk(sim, OPENING, 1 / 60, false);
    sim.keys.add('up');
    expect(walk(sim, OPENING, 1 / 60, false)).toBe('bump');
    expect(sim.bumps).toBe(2);
  });

  it('keeps the steps to the ground covered while sliding along it', () => {
    const { sim, sounds } = walkedFrom(OPENING, ['up', 'right'], [1.5, 4.3], 60);
    expect(sounds).not.toContain('bump');
    expect(sim.footfalls).toBeGreaterThan(0);
  });
});

describe('walk — walking means covering ground', () => {
  it('walks while it covers ground and stands once a wall holds it, the key still down', () => {
    const map = mapWith({ width: 10, height: 6, tiles: TILES });
    const sim = newSim(0);
    Object.assign(sim.self, { x: 7.5, y: 2.5 });
    sim.keys.add('right');
    walk(sim, map, 1 / 60, false);
    expect(sim.self.moving).toBe(true);
    for (let i = 0; i < 60; i++) {
      walk(sim, map, 1 / 60, false);
    }
    expect(sim.self.x).toBeCloseTo(8.72, 1);
    expect(sim.self.moving).toBe(false);
    // and it faces the wall it pushes against
    expect(sim.self.facing).toBe(0);
  });

  it('walks along a wall it is pushed against slantwise', () => {
    const map = mapWith({ width: 10, height: 6, tiles: TILES });
    const sim = newSim(0);
    Object.assign(sim.self, { x: 6.5, y: 1.3 });
    sim.keys.add('up');
    sim.keys.add('right');
    walk(sim, map, 1 / 60, false);
    expect(sim.self.moving).toBe(true);
  });
});

/** The lab's open middle row, (1,2) to (8,2): room to run a second east. */
const OPEN = mapWith({ width: 10, height: 6, tiles: TILES });

/** `frames` frames of 1/60 s east from (1.5, 2.5) with `held` held: how far, and each footfall. */
function ran(held: Held[], frames = 60, locked = false) {
  const sim = newSim(0);
  Object.assign(sim.self, { x: 1.5, y: 2.5 });
  for (const move of held) {
    sim.keys.add(move);
  }
  const falls: Footfall[] = [];
  const at: number[] = [];
  for (let i = 0; i < frames; i++) {
    const fall = walk(sim, OPEN, 1 / 60, locked);
    if (fall === 'walk' || fall === 'sprint') {
      falls.push(fall);
    }
    at.push(sim.self.x);
  }
  return { tiles: sim.self.x - 1.5, falls, at, sim };
}

describe('walk — the sprint', () => {
  it('runs 1.3 times the walk with Shift held, for as long as it is held', () => {
    expect(ran(['right']).tiles).toBeCloseTo(4.2, 6);
    const sprint = ran(['right', 'sprint']);
    expect(sprint.tiles).toBeCloseTo(4.2 * 1.3, 6);
    // No stamina: the second half second as fast as the first.
    const half = (sprint.at[29] ?? 0) - 1.5;
    expect((sprint.at[59] ?? 0) - (sprint.at[29] ?? 0)).toBeCloseTo(half, 6);
  });

  it('lands its footfalls faster at a sprint, each told a sprint’s', () => {
    const walking = ran(['right']).falls;
    const sprinting = ran(['right', 'sprint']).falls;
    expect(sprinting.length).toBeGreaterThan(walking.length);
    expect(new Set(walking)).toEqual(new Set(['walk']));
    expect(new Set(sprinting)).toEqual(new Set(['sprint']));
    // A footfall every half tile run, at either pace, counted for the walkthrough's probe.
    expect(ran(['right', 'sprint']).sim.footfalls).toBe(sprinting.length);
  });

  it('swings the legs as much faster as it runs', () => {
    const phaseAfter = (held: Held[]): number => ran(held, 12).sim.walkPhase;
    expect(phaseAfter(['right', 'sprint'])).toBeCloseTo(phaseAfter(['right']) * 1.3, 9);
  });

  it('moves nothing on Shift alone, nor while input is locked', () => {
    const still = ran(['sprint']);
    expect(still.tiles).toBe(0);
    expect(still.falls).toEqual([]);
    expect(still.sim.self.moving).toBe(false);
    expect(ran(['right', 'sprint'], 60, true).tiles).toBe(0);
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

  it('starts a new run facing as the server has the avatar: east on a fresh spawn', () => {
    const sim = walking(Math.PI / 2);
    follows(sim, 1);
    followServer(sim, { run: 7, players: {} }, OPEN, 'p1', 7);
    expect(sim.self.facing).toBe(0);
    const kept = { x: 3.5, y: 2.5, facing: Math.PI, moving: false, t: null, rt: 0 };
    followServer(sim, { run: 8, players: { p1: kept } }, OPEN, 'p1', 8);
    expect(sim.self.facing).toBe(Math.PI);
  });
});

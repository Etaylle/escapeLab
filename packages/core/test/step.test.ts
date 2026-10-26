import { describe, expect, it } from 'vitest';
import { applyAction, initialState, parseMission, stepAllowed } from '../src/index.js';
import type { Action, GameState, Mission } from '../src/index.js';
import {
  MAX_STEP,
  SPRINT_FACTOR,
  STEP_MARGIN,
  UPDATES_PER_SECOND,
  WALK_SPEED,
} from '../src/map.js';

/**
 * Two rooms split by a wall at x=4, with a door at (4,2) that opens only
 * while the plate (2,3) is held, and a pillar at (6,3) in the east room with
 * floor all around it.
 *
 *   012345678
 * 0 #########
 * 1 #...#...#
 * 2 #.......#   door (4,2)
 * 3 #...#.#.#   plate (2,3); pillar (6,3)
 * 4 #...#...#
 * 5 #########
 */
const fixture: Mission = parseMission({
  id: 'schritt',
  title: 'Schritt-Test',
  story: { intro: 'i', win: 'w', lose: 'l' },
  players: { min: 2, max: 2 },
  timeLimitSec: 300,
  puzzles: [{ type: 'button-sync', id: 'only', title: 'Einziges' }],
  map: {
    tiles: ['#########', '#...#...#', '#.......#', '#...#.#.#', '#...#...#', '#########'],
    spawns: [
      { x: 1, y: 1 },
      { x: 3, y: 1 },
    ],
    doors: [{ id: 'tuer', x: 4, y: 2, opensBy: { kind: 'plate', plateId: 'platte' } }],
    plates: [{ id: 'platte', x: 2, y: 3, label: 'HALTEN' }],
    stations: [{ puzzleId: 'only', x: 1, y: 4 }],
  },
});

const T0 = 1_000_000;

const shut: GameState = (
  [
    { type: 'player-join', playerId: 'p1', name: 'Anna' },
    { type: 'player-join', playerId: 'p2', name: 'Ben' },
    { type: 'set-ready', playerId: 'p2', ready: true },
    { type: 'start-mission', playerId: 'p1', at: T0, seed: 1 },
  ] satisfies Action[]
).reduce(applyAction, initialState(fixture));
const held = applyAction(shut, { type: 'set-occupancy', plates: ['platte'], panels: [] });

/** A step from one spot to another, in tiles, with the doors as `state` has them. */
function step(state: GameState, from: [number, number], to: [number, number]): boolean {
  return stepAllowed(fixture.map, state, { x: from[0], y: from[1] }, { x: to[0], y: to[1] });
}

describe('stepAllowed', () => {
  it('takes straight walks over the floor, up to MAX_STEP tiles at once', () => {
    expect(step(shut, [1.5, 1.5], [2.5, 1.5])).toBe(true);
    expect(step(shut, [1.5, 1.5], [1.5 + MAX_STEP, 1.5])).toBe(true);
    expect(step(shut, [1.5, 2.5], [1.5, 2.5])).toBe(true);
    expect(step(shut, [1.5, 1.5], [1.5 + MAX_STEP + 0.01, 1.5])).toBe(false);
  });

  it('refuses a step into a wall, and through one that both ends lie beside', () => {
    expect(step(shut, [3.5, 1.5], [4.5, 1.5])).toBe(false);
    expect(step(shut, [3.6, 3.5], [5.0, 3.5])).toBe(false);
  });

  it('takes a diagonal step past a wall corner, but not one that cuts across it', () => {
    // The pillar's top-left corner sits at (6,3): this step keeps off it …
    expect(step(shut, [5.6, 3.3], [6.3, 2.6])).toBe(true);
    // … this one runs through the pillar's corner for half a tile.
    expect(step(shut, [5.7, 3.7], [6.7, 2.7])).toBe(false);
  });

  it('passes a plate door only while its plate is held', () => {
    expect(step(shut, [3.5, 2.5], [5.0, 2.5])).toBe(false);
    expect(step(held, [3.5, 2.5], [5.0, 2.5])).toBe(true);
  });

  it('lets whoever a door shut on step out of it, but not on into the wall', () => {
    expect(step(shut, [4.5, 2.5], [5.5, 2.5])).toBe(true);
    expect(step(shut, [4.5, 2.5], [4.5, 1.5])).toBe(false);
  });
});

describe('the step guard and the sprint', () => {
  /** One update's step at `factor` times the walk, about 12 updates a second, in tiles. */
  const stepAt = (factor: number): number => (WALK_SPEED * factor) / UPDATES_PER_SECOND;

  it('bounds a step by what a sprint at 12 updates a second needs, plus the old margin', () => {
    expect(SPRINT_FACTOR).toBe(1.3);
    expect(stepAt(SPRINT_FACTOR)).toBeCloseTo(0.455, 9);
    expect(MAX_STEP).toBeCloseTo(0.455 + 1.15, 9);
    // The walk's bound was 1.5: its step of 0.35 and the same margin.
    expect(stepAt(1) + STEP_MARGIN).toBeCloseTo(1.5, 9);
    expect(MAX_STEP - (stepAt(1) + STEP_MARGIN)).toBeCloseTo(stepAt(SPRINT_FACTOR - 1), 9);
  });

  it('takes a sprinted step, and a sprint’s burst after some lag, over open floor', () => {
    expect(step(shut, [1.5, 2.5], [1.5 + stepAt(SPRINT_FACTOR), 2.5])).toBe(true);
    expect(step(shut, [1.5, 2.5], [1.5 + stepAt(SPRINT_FACTOR) + STEP_MARGIN, 2.5])).toBe(true);
    expect(step(shut, [1.5, 2.5], [1.5 + 1.6, 2.5])).toBe(true);
  });

  it('refuses a jump at twice the walk — its burst, or two sprint bounds at once', () => {
    const doubled = stepAt(2) + STEP_MARGIN;
    expect(doubled).toBeCloseTo(1.85, 9);
    expect(doubled).toBeGreaterThan(MAX_STEP);
    // Over the open floor of the middle row: only the length can refuse it.
    expect(step(shut, [1.5, 2.5], [1.5 + doubled, 2.5])).toBe(false);
    expect(step(shut, [1.5, 2.5], [1.5 + 2 * MAX_STEP, 2.5])).toBe(false);
    // The same jump split in two sprinted bursts goes, each within the bound.
    expect(step(shut, [1.5, 2.5], [1.5 + doubled / 2, 2.5])).toBe(true);
  });

  it('keeps checking every 0.2 tiles along the way: a sprint’s burst cannot cut a pillar', () => {
    // Within the bound, but through the pillar at (6,3) for half a tile …
    expect(Math.hypot(1.1, 1.1)).toBeLessThanOrEqual(MAX_STEP);
    expect(step(shut, [5.5, 3.9], [6.6, 2.8])).toBe(false);
    // … while the same burst a row up, over the floor beside it, goes.
    expect(step(shut, [5.5, 2.9], [6.6, 1.8])).toBe(true);
  });
});

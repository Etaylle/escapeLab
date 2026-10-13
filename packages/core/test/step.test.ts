import { describe, expect, it } from 'vitest';
import { applyAction, initialState, parseMission, stepAllowed } from '../src/index.js';
import type { Action, GameState, Mission } from '../src/index.js';
import { MAX_STEP } from '../src/map.js';

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

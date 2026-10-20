import { describe, expect, it } from 'vitest';
import { applyAction, parseMission, viewFor, viewForSpectator } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { standing, started, T0 } from './lab.js';

/**
 * A corridor lab with two stations where the whole crew presses, (3,1) and
 * (5,1), and the hatch at its east end.
 *
 *   0123456789
 * 0 ##########
 * 1 #..1.2...#   spawns (1,1) and (1,2)
 * 2 #.......E#   the hatch (8,2)
 * 3 ##########
 */
const mission = parseMission({
  id: 'ausgang',
  title: 'Ausgang',
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  radio: { escape: 'Raus hier.' },
  players: { min: 2, max: 2 },
  puzzles: [
    { type: 'button-sync', id: 'eins', title: 'Eins' },
    { type: 'button-sync', id: 'zwei', title: 'Zwei' },
  ],
  map: {
    tiles: ['##########', '#........#', '#........#', '##########'],
    spawns: [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
    ],
    stations: [
      { puzzleId: 'eins', x: 3, y: 1 },
      { puzzleId: 'zwei', x: 5, y: 1 },
    ],
    exit: { x: 8, y: 2 },
  },
});

/** The whole crew at the armed station, switched on, everyone presses at `at`. */
function solveNext(state: GameState, at: number): GameState {
  const def = state.mission.puzzles[state.currentPuzzleIndex];
  if (def === undefined) {
    throw new Error('solveNext: every station is solved');
  }
  const here = standing(state, { stations: { [def.id]: ['p1', 'p2'] } });
  const open = applyAction(here, { type: 'interact', playerId: 'p1', at });
  return ['p1', 'p2'].reduce(
    (next, playerId) =>
      applyAction(next, { type: 'puzzle-input', playerId, at, input: { press: true } }),
    open,
  );
}

const SOLVED_AT = T0 + 20_000;
const running = started(mission);
const escaping = solveNext(solveNext(running, T0 + 10_000), SOLVED_AT);

/** The hatch as player `p1`, player `p2` and the audience see it. */
const hatches = (state: GameState) => [
  viewFor(state, 'p1').map?.exit,
  viewFor(state, 'p2').map?.exit,
  viewForSpectator(state).map?.exit,
];

describe('the hatch before the escape', () => {
  it('stays shut, unlocked at no moment, with nobody on it', () => {
    for (const exit of hatches(running)) {
      expect(exit).toEqual({ x: 8, y: 2, open: false, openedAt: null, atExit: [] });
    }
  });

  it('counts nobody on it while it is shut, whatever the room reports', () => {
    const early = standing(running, { exit: ['p1'] });
    expect(early.presence.exit).toEqual([]);
    expect(hatches(early).every((exit) => exit?.atExit.length === 0)).toBe(true);
  });
});

describe('the escape phase', () => {
  it('opens the hatch with the last solve and says when, to the crew and the audience', () => {
    expect(escaping.phase).toBe('playing');
    for (const exit of hatches(escaping)) {
      expect(exit).toEqual({ x: 8, y: 2, open: true, openedAt: SOLVED_AT, atExit: [] });
    }
    expect(escaping.events.slice(-2)).toEqual([
      { at: SOLVED_AT, kind: 'escape', label: 'Notausgang entriegelt', seconds: null },
      { at: SOLVED_AT, kind: 'radio', label: 'Raus hier.', seconds: null },
    ]);
  });

  it('ticks off who stands on the hatch, as the room counts them, for every viewer', () => {
    const one = standing(escaping, { exit: ['p2'] });
    expect(hatches(one).map((exit) => exit?.atExit)).toEqual([['p2'], ['p2'], ['p2']]);
    const both = standing(one, { exit: ['p2', 'p1', 'p2'] });
    expect(both.presence.exit).toEqual(['p1', 'p2']);
    expect(hatches(both).map((exit) => exit?.atExit)).toEqual([
      ['p1', 'p2'],
      ['p1', 'p2'],
      ['p1', 'p2'],
    ]);
    const off = standing(both, { exit: ['p1'] });
    expect(viewFor(off, 'p2').map?.exit?.atExit).toEqual(['p1']);
  });

  it('changes nothing else: the room still says when everybody is out', () => {
    const atStation = standing(escaping, { stations: { zwei: ['p1'] }, exit: ['p1', 'p2'] });
    expect(atStation.phase).toBe('playing');
    expect(atStation.presence.stations).toEqual({ zwei: ['p1'] });
    expect(viewFor(atStation, 'p1').presence.stationId).toBe('zwei');
    expect(viewFor(atStation, 'p1').map?.exit?.openedAt).toBe(SOLVED_AT);
    const won = applyAction(atStation, { type: 'escaped', at: SOLVED_AT + 5000 });
    expect(won.phase).toBe('won');
    expect(viewFor(won, 'p1').map).toBeNull();
  });

  it('starts the next run with nobody on the hatch', () => {
    const won = applyAction(standing(escaping, { exit: ['p1', 'p2'] }), {
      type: 'escaped',
      at: SOLVED_AT + 5000,
    });
    const ready = applyAction(won, { type: 'set-ready', playerId: 'p2', ready: true });
    const again = applyAction(ready, { type: 'rematch', playerId: 'p1', at: T0 + 1e6, seed: 3 });
    expect(again.presence.exit).toEqual([]);
    expect(viewFor(again, 'p1').map?.exit).toEqual({
      x: 8,
      y: 2,
      open: false,
      openedAt: null,
      atExit: [],
    });
  });
});

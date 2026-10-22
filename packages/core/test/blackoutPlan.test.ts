import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyAction, stationKey, viewFor } from '../src/index.js';
import type { Action, GameState, Move, PuzzleInput } from '../src/index.js';
import {
  blackoutMission,
  blackoutPlan,
  PINNED_SEED,
  playBlackout,
  type BlackoutPlan,
} from './blackoutPlan.js';
import { lightsOut, standing, started, T0 } from './lab.js';

/**
 * tools/shots.mjs plays Blackout to the won card on a pinned seed with the
 * answers tools/fixtures/blackout-plan.json carries; these tests keep that
 * file the solvers' own and prove its answers win, so that the harness can
 * guard each instance in the browser against it.
 */

const fixture = JSON.parse(
  readFileSync(new URL('../../../tools/fixtures/blackout-plan.json', import.meta.url), 'utf8'),
) as BlackoutPlan;

/** Blackout on the pinned seed with the crew at the Serverraum's consoles, switched on. */
function serverraumOpen(): GameState {
  const mission = blackoutMission();
  let state = standing(lightsOut(started(mission, PINNED_SEED)), { signSeen: ['p1', 'p2'] });
  // The three stations before it, as the reducer has them solved: straight to the Serverraum.
  state = { ...state, currentPuzzleIndex: 3 };
  const here = standing(state, {
    stations: {
      subsysteme: ['p1'],
      [stationKey({ puzzleId: 'subsysteme', console: 'b' })]: ['p2'],
    },
  });
  return applyAction(here, { type: 'interact', playerId: 'p1', at: T0 + 1000 });
}

const input = (move: Move<PuzzleInput>, at: number): Action => ({
  type: 'puzzle-input',
  playerId: move.by === 'partner' ? 'p2' : 'p1',
  at,
  input: move.input,
});

describe('Blackout on the harness’s pinned seed', () => {
  it('is won through the reducer by the solvers, without an alarm', () => {
    const { state } = playBlackout();
    expect(state.currentPuzzleIndex).toBe(state.mission.puzzles.length);
    expect(state.penaltySeq).toBe(0);
  });

  it('carries the solvers’ own walkthrough in tools/fixtures/blackout-plan.json', () => {
    // Regenerate the file from `blackoutPlan()` when Blackout or one of its modules changes.
    expect(fixture).toEqual(blackoutPlan());
    expect(fixture).toMatchObject({ mission: 'blackout', seed: PINNED_SEED });
  });

  it('opens the Serverraum on the pinned table, the pinned moves solving it alarm-free', () => {
    let state = serverraumOpen();
    const terminal = viewFor(state, 'p1').puzzle;
    expect(terminal?.kind === 'servers' ? terminal.rows : null).toEqual(fixture.subsysteme.rows);
    fixture.subsysteme.moves.forEach((move, i) => {
      state = applyAction(state, input(move, T0 + 2000 + i * 500));
    });
    expect(state.penaltySeq).toBe(0);
    expect(state.currentPuzzleIndex).toBe(4);
  });

  it('pins every station’s answer to what its instance asks: the cut, the keys, the dial', () => {
    const mission = blackoutMission();
    const circuit = mission.puzzles[1];
    const signal = mission.puzzles[2];
    expect([circuit?.type, signal?.type, mission.puzzles[4]?.type]).toEqual([
      'circuit',
      'signal',
      'morse',
    ]);
    // The serial ends even: every round cuts the highest voltage the meter reads.
    expect(Number(fixture.serial.at(-1)) % 2).toBe(0);
    for (const { readings, cut } of fixture.notstrom.rounds) {
      const live = readings.map((volts) => volts ?? -1);
      expect(cut).toBe(live.indexOf(Math.max(...live)));
    }
    // Stage by stage the direction swaps, console a sending first.
    expect(fixture.signalkette.stages.map((stage) => stage.sends)).toEqual(['a', 'b', 'a', 'b']);
    expect(fixture.signalkette.stages.every((s) => s.keys.length === s.sequence.length)).toBe(true);
    expect(fixture.reaktorstart).toEqual({ presses: 2, windowMs: 2000 });
  });

  it('lights the pinned pattern at the radio panel; the pinned turns and a send solve it', () => {
    const mission = blackoutMission();
    const cabinet = mission.map.manuals.find((m) => m.puzzleIds.includes('frequenz'));
    if (cabinet === undefined) {
      throw new Error('Blackout keeps the radio panel’s tables in a cabinet');
    }
    const started5 = standing(lightsOut(started(mission, PINNED_SEED)), { signSeen: ['p1', 'p2'] });
    // The four stations before it, as the reducer has them solved, and the cabinet unlocked.
    const opened = { ...started5, currentPuzzleIndex: 4, opened: [cabinet.id] };
    const here = standing(opened, {
      stations: { frequenz: ['p1'] },
      manuals: { [cabinet.id]: ['p2'] },
    });
    let state = applyAction(here, { type: 'interact', playerId: 'p1', at: T0 + 1000 });
    const lamp = viewFor(state, 'p1').puzzle;
    expect(lamp?.kind === 'morse' ? [lamp.pattern, lamp.dial] : null).toEqual([
      fixture.frequenz.pattern,
      fixture.frequenz.dial,
    ]);
    const tune = Math.sign(fixture.frequenz.turns);
    const moves: Move<PuzzleInput>[] = [
      ...Array.from({ length: Math.abs(fixture.frequenz.turns) }, () => ({
        by: 'operator' as const,
        input: { tune } as PuzzleInput,
      })),
      { by: 'operator', input: { transmit: true } },
    ];
    moves.forEach((move, i) => {
      state = applyAction(state, input(move, T0 + 2000 + i * 500));
    });
    expect(state.penaltySeq).toBe(0);
    expect(state.currentPuzzleIndex).toBe(5);
  });
});

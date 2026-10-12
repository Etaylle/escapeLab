import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyAction, initialState, parseMission, viewFor } from '../src/index.js';
import type { Action, GameState, Mission } from '../src/index.js';
import { wiringModule } from '../src/puzzles/wiring.js';

// Puzzle-logic tests run without the tile map (stations would gate activation);
// the map flow itself is covered in map.test.ts.
const mission: Mission = parseMission({
  ...JSON.parse(readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8')),
  map: undefined,
});

const T0 = 1_000_000;

function run(actions: Action[], from?: GameState): GameState {
  return actions.reduce(applyAction, from ?? initialState(mission));
}

function started(seed = 42): GameState {
  return run([
    { type: 'player-join', playerId: 'p1', name: 'Anna' },
    { type: 'player-join', playerId: 'p2', name: 'Ben' },
    { type: 'select-role', playerId: 'p1', roleId: 'anleitung' },
    { type: 'select-role', playerId: 'p2', roleId: 'steuerpult' },
    { type: 'set-ready', playerId: 'p2', ready: true },
    { type: 'start-mission', playerId: 'p1', at: T0, seed },
  ]);
}

describe('keypad puzzle', () => {
  /** Fast-forward through the wiring puzzle: cut the wire its solver picks from the views. */
  function atKeypad(seed = 42): GameState {
    const state = started(seed);
    const def = mission.puzzles[0];
    const view = viewFor(state, 'p2');
    if (def?.type !== 'wiring' || view.puzzle?.kind !== 'wiring') {
      throw new Error('expected wiring first');
    }
    const [move] = wiringModule.solve(def, { steuerpult: view.puzzle }, view.edgework);
    return applyAction(state, {
      type: 'puzzle-input',
      playerId: 'p2',
      at: T0 + 1000,
      input: move?.input,
    });
  }

  function inputGrid(state: GameState) {
    const puzzle = viewFor(state, 'p2').puzzle;
    if (puzzle?.kind !== 'keypad' || puzzle.grid === null) {
      throw new Error('expected the input keypad view');
    }
    return puzzle.grid;
  }

  it('solves when the code is entered in order', () => {
    let state = atKeypad();
    const def = mission.puzzles[1];
    if (def?.type !== 'keypad') {
      throw new Error('expected keypad second');
    }
    for (const symbol of def.code) {
      const idx = inputGrid(state).findIndex((k) => k.symbol === symbol);
      state = applyAction(state, {
        type: 'puzzle-input',
        playerId: 'p2',
        at: T0 + 2000,
        input: { keyIndex: idx },
      });
    }
    expect(state.currentPuzzleIndex).toBe(2);
    expect(state.penaltySeq).toBe(0);
  });

  it('resets progress and costs time on a wrong key', () => {
    let state = atKeypad();
    const def = mission.puzzles[1];
    if (def?.type !== 'keypad') {
      throw new Error('expected keypad second');
    }
    const first = def.code[0];
    const wrongIdx = inputGrid(state).findIndex((k) => k.symbol !== first);
    const okIdx = inputGrid(state).findIndex((k) => k.symbol === first);
    const before = state.deadlineAt ?? 0;
    state = run(
      [
        { type: 'puzzle-input', playerId: 'p2', at: T0 + 2000, input: { keyIndex: okIdx } },
        { type: 'puzzle-input', playerId: 'p2', at: T0 + 3000, input: { keyIndex: wrongIdx } },
      ],
      state,
    );
    expect(state.deadlineAt).toBe(before - def.penaltySec * 1000);
    const view = viewFor(state, 'p2').puzzle;
    if (view?.kind === 'keypad') {
      expect(view.progress).toBe(0);
    }
    expect(state.penaltySeq).toBe(1);
  });

  it('hides the grid from the manual role but shows progress', () => {
    const state = atKeypad();
    const annaPuzzle = viewFor(state, 'p1').puzzle;
    if (annaPuzzle?.kind !== 'keypad') {
      throw new Error('expected keypad view');
    }
    expect(annaPuzzle.grid).toBeNull();
    expect(annaPuzzle.codeLength).toBe(4);
  });
});

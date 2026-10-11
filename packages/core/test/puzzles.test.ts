import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyAction, initialState, parseMission, viewFor } from '../src/index.js';
import type { Action, GameState, Mission } from '../src/index.js';

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

/** The wires as the cutter sees them, from the view (never from private state). */
function cutterWires(state: GameState) {
  const puzzle = viewFor(state, 'p2').puzzle;
  if (puzzle?.kind !== 'wiring' || puzzle.wires === null) {
    throw new Error('expected the cutter wiring view');
  }
  return puzzle.wires;
}

const pairMatches = (w: { left: string; right: string }, [a, b]: readonly [string, string]) =>
  (w.left === a && w.right === b) || (w.left === b && w.right === a);

describe('wiring puzzle', () => {
  it('lays out targets and decoys deterministically per seed', () => {
    const wires = cutterWires(started(7));
    expect(wires).toHaveLength(5);
    expect(wires).toEqual(cutterWires(started(7)));
    expect(wires).not.toEqual(cutterWires(started(8)));
  });

  it('solves after cutting both target pairs in order', () => {
    let state = started();
    const def = mission.puzzles[0];
    if (def?.type !== 'wiring') {
      throw new Error('expected wiring first');
    }
    for (const target of def.pairsToCut) {
      const wire = cutterWires(state).find((w) => pairMatches(w, target));
      expect(wire).toBeDefined();
      state = applyAction(state, {
        type: 'puzzle-input',
        playerId: 'p2',
        at: T0 + 1000,
        input: { wireId: wire?.id ?? '' },
      });
    }
    expect(state.currentPuzzleIndex).toBe(1);
    expect(state.penaltySeq).toBe(0);
  });

  it('punishes a wrong cut with a time penalty and keeps the wire intact', () => {
    const state = started();
    const def = mission.puzzles[0];
    if (def?.type !== 'wiring') {
      throw new Error('expected wiring first');
    }
    const decoy = cutterWires(state).find(
      (w) => !def.pairsToCut.some((t) => pairMatches(w, t)),
    );
    const before = state.deadlineAt ?? 0;
    const after = applyAction(state, {
      type: 'puzzle-input',
      playerId: 'p2',
      at: T0 + 1000,
      input: { wireId: decoy?.id ?? '' },
    });
    expect(after.deadlineAt).toBe(before - def.penaltySec * 1000);
    expect(after.penaltySeq).toBe(1);
    expect(after.lastPenaltySec).toBe(def.penaltySec);
    expect(cutterWires(after).every((w) => !w.cut)).toBe(true);
    expect(after.phase).toBe('playing');
  });

  it('cutting the second pair first is wrong (order matters)', () => {
    const state = started();
    const def = mission.puzzles[0];
    if (def?.type !== 'wiring') {
      throw new Error('expected wiring first');
    }
    const second = def.pairsToCut[1];
    const wire = cutterWires(state).find((w) => second !== undefined && pairMatches(w, second));
    const after = applyAction(state, {
      type: 'puzzle-input',
      playerId: 'p2',
      at: T0 + 1000,
      input: { wireId: wire?.id ?? '' },
    });
    expect(after.penaltySeq).toBe(1);
  });

  it('loses when a penalty eats the remaining time', () => {
    const state = started();
    const def = mission.puzzles[0];
    if (def?.type !== 'wiring') {
      throw new Error('expected wiring first');
    }
    const decoy = cutterWires(state).find(
      (w) => !def.pairsToCut.some((t) => pairMatches(w, t)),
    );
    const nearDeadline = (state.deadlineAt ?? 0) - def.penaltySec * 1000 + 1000;
    const after = applyAction(state, {
      type: 'puzzle-input',
      playerId: 'p2',
      at: nearDeadline,
      input: { wireId: decoy?.id ?? '' },
    });
    expect(after.phase).toBe('lost');
  });

  it('rejects cuts from the wrong role and hides the layout from it', () => {
    const state = started();
    expect(() =>
      applyAction(state, {
        type: 'puzzle-input',
        playerId: 'p1',
        at: T0 + 1,
        input: { wireId: 'w0' },
      }),
    ).toThrow(/Schaltschrank/);
    const annaPuzzle = viewFor(state, 'p1').puzzle;
    expect(annaPuzzle?.kind).toBe('wiring');
    if (annaPuzzle?.kind === 'wiring') {
      expect(annaPuzzle.wires).toBeNull();
    }
  });

  it('prints the rules for the manual role only, leaving the cut order to the mission text', () => {
    const state = started();
    const def = mission.puzzles[0];
    if (def?.type !== 'wiring') {
      throw new Error('expected wiring first');
    }
    const printed = JSON.stringify(viewFor(state, 'p1').puzzle?.manual);
    expect(printed).toContain(`−${def.penaltySec} s`);
    expect(viewFor(state, 'p2').puzzle?.manual).toBeNull();
    // Where the mission splits the cut order between roles, the manual must not undo that.
    for (const symbol of def.pairsToCut.flat()) {
      expect(printed).not.toContain(symbol);
    }
  });
});

describe('keypad puzzle', () => {
  /** Fast-forward through the wiring puzzle. */
  function atKeypad(seed = 42): GameState {
    let state = started(seed);
    const def = mission.puzzles[0];
    if (def?.type !== 'wiring') {
      throw new Error('expected wiring first');
    }
    for (const target of def.pairsToCut) {
      const wire = cutterWires(state).find((w) => pairMatches(w, target));
      state = applyAction(state, {
        type: 'puzzle-input',
        playerId: 'p2',
        at: T0 + 1000,
        input: { wireId: wire?.id ?? '' },
      });
    }
    return state;
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

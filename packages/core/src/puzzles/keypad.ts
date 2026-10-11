import type { KeypadPuzzleDef } from '../mission.js';
import { shuffle, type Rng } from '../rng.js';

export interface KeypadState {
  type: 'keypad';
  /** keypad layout, shuffled per game */
  grid: string[];
  /** how many code symbols were entered correctly so far */
  progress: number;
  lastWrongIndex: number | null;
}

export function initKeypad(def: KeypadPuzzleDef, rng: Rng): KeypadState {
  return { type: 'keypad', grid: shuffle(def.gridSymbols, rng), progress: 0, lastWrongIndex: null };
}

export interface KeypadResult {
  state: KeypadState;
  solved: boolean;
  /** true when the wrong key was pressed — progress resets, an alarm fires */
  penalty: boolean;
}

export function pressKey(def: KeypadPuzzleDef, state: KeypadState, keyIndex: number): KeypadResult {
  const symbol = state.grid[keyIndex];
  if (symbol === undefined) {
    return { state, solved: false, penalty: false };
  }
  if (symbol !== def.code[state.progress]) {
    return {
      state: { ...state, progress: 0, lastWrongIndex: keyIndex },
      solved: false,
      penalty: true,
    };
  }
  const progress = state.progress + 1;
  return {
    state: { ...state, progress, lastWrongIndex: null },
    solved: progress >= def.code.length,
    penalty: false,
  };
}

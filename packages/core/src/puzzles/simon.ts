import type { SimonPuzzleDef } from '../mission.js';
import { shuffle, type Rng } from '../rng.js';

export const SIMON_COLORS = ['rot', 'gruen', 'blau', 'gelb'] as const;
export type SimonColor = (typeof SIMON_COLORS)[number];

/**
 * Frequency match: the display role watches a flashing color sequence, the
 * legend role holds the color→symbol mapping, and the display role must
 * press the mapped symbols in order. Wrong press: reset + penalty.
 */
export interface SimonState {
  type: 'simon';
  /** flashing sequence, visible to the display role */
  sequence: SimonColor[];
  /** color→symbol mapping, visible to the legend role */
  mapping: Record<SimonColor, string>;
  /** symbol buttons in panel order (shuffled per game) */
  buttonOrder: string[];
  progress: number;
  lastWrongIndex: number | null;
}

export function initSimon(def: SimonPuzzleDef, rng: Rng): SimonState {
  const sequence: SimonColor[] = [];
  while (sequence.length < def.sequenceLength) {
    const color = SIMON_COLORS[Math.floor(rng() * SIMON_COLORS.length)] ?? 'rot';
    // Avoid immediate repeats — they are hard to count when flashing.
    if (sequence[sequence.length - 1] !== color) {
      sequence.push(color);
    }
  }
  const shuffledSymbols = shuffle(def.buttonSymbols, rng);
  const mapping = {} as Record<SimonColor, string>;
  SIMON_COLORS.forEach((color, i) => {
    mapping[color] = shuffledSymbols[i] ?? def.buttonSymbols[i] ?? '?';
  });
  return {
    type: 'simon',
    sequence,
    mapping,
    buttonOrder: shuffle(def.buttonSymbols, rng),
    progress: 0,
    lastWrongIndex: null,
  };
}

export interface SimonResult {
  state: SimonState;
  solved: boolean;
  penalty: boolean;
}

export function pressSimon(state: SimonState, buttonIndex: number): SimonResult {
  const symbol = state.buttonOrder[buttonIndex];
  const expectedColor = state.sequence[state.progress];
  if (symbol === undefined || expectedColor === undefined) {
    return { state, solved: false, penalty: false };
  }
  if (symbol !== state.mapping[expectedColor]) {
    return {
      state: { ...state, progress: 0, lastWrongIndex: buttonIndex },
      solved: false,
      penalty: true,
    };
  }
  const progress = state.progress + 1;
  return {
    state: { ...state, progress, lastWrongIndex: null },
    solved: progress >= state.sequence.length,
    penalty: false,
  };
}

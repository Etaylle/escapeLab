import type { SwitchesPuzzleDef } from '../mission.js';
import { shuffle, type Rng } from '../rng.js';

/**
 * Switch bank: the panel role sees toggles in shuffled order; the target
 * role sees which symbols must be ON. Toggling is free — committing a wrong
 * configuration costs time.
 */
export interface SwitchesState {
  type: 'switches';
  /** switch symbols in panel order (shuffled per game) */
  order: string[];
  on: boolean[];
  /** symbols that must be ON (chosen per game) */
  target: string[];
  lastResult: 'wrong' | null;
}

export function initSwitches(def: SwitchesPuzzleDef, rng: Rng): SwitchesState {
  const order = shuffle(def.symbols, rng);
  const target = shuffle(def.symbols, rng).slice(0, def.onCount).sort();
  return {
    type: 'switches',
    order,
    on: order.map(() => false),
    target,
    lastResult: null,
  };
}

export function toggleSwitch(state: SwitchesState, index: number): SwitchesState {
  if (index < 0 || index >= state.on.length) {
    return state;
  }
  const on = state.on.map((v, i) => (i === index ? !v : v));
  return { ...state, on, lastResult: null };
}

export interface SwitchesResult {
  state: SwitchesState;
  solved: boolean;
  penalty: boolean;
}

export function commitSwitches(state: SwitchesState): SwitchesResult {
  const onSymbols = state.order.filter((_, i) => state.on[i] === true).sort();
  const correct =
    onSymbols.length === state.target.length &&
    onSymbols.every((s, i) => s === state.target[i]);
  if (!correct) {
    return { state: { ...state, lastResult: 'wrong' }, solved: false, penalty: true };
  }
  return { state: { ...state, lastResult: null }, solved: true, penalty: false };
}

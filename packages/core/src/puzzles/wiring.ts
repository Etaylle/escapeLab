import type { WiringPuzzleDef } from '../mission.js';
import { shuffle, type Rng } from '../rng.js';

const WIRE_COLORS = ['#f87171', '#60a5fa', '#fbbf24', '#34d399', '#c084fc', '#f472b6'];

export interface Wire {
  id: string;
  color: string;
  left: string;
  right: string;
  cut: boolean;
}

export interface WiringState {
  type: 'wiring';
  wires: Wire[];
  /** how many of def.pairsToCut are already cut, in order */
  cutsDone: number;
  lastWrongWireId: string | null;
}

/** Lay out target and decoy pairs in a shuffled order with random end-swap and colors. */
export function initWiring(def: WiringPuzzleDef, rng: Rng): WiringState {
  const pairs = shuffle([...def.pairsToCut, ...def.decoyPairs], rng);
  const wires = pairs.map(([a, b], idx): Wire => {
    const swapped = rng() < 0.5;
    return {
      id: `w${idx}`,
      color: WIRE_COLORS[Math.floor(rng() * WIRE_COLORS.length)] ?? '#8b98a5',
      left: swapped ? b : a,
      right: swapped ? a : b,
      cut: false,
    };
  });
  return { type: 'wiring', wires, cutsDone: 0, lastWrongWireId: null };
}

export interface WiringResult {
  state: WiringState;
  solved: boolean;
  /** true when the cut was wrong — the wire stays intact, an alarm fires */
  penalty: boolean;
}

const samePair = (wire: Wire, [a, b]: [string, string]): boolean =>
  (wire.left === a && wire.right === b) || (wire.left === b && wire.right === a);

export function cutWire(def: WiringPuzzleDef, state: WiringState, wireId: string): WiringResult {
  const wire = state.wires.find((w) => w.id === wireId);
  if (wire === undefined || wire.cut) {
    // Stale click (already cut / unknown id): ignore without penalty.
    return { state, solved: false, penalty: false };
  }
  const expected = def.pairsToCut[state.cutsDone];
  if (expected === undefined || !samePair(wire, expected)) {
    return {
      state: { ...state, lastWrongWireId: wire.id },
      solved: false,
      penalty: true,
    };
  }
  const wires = state.wires.map((w) => (w.id === wire.id ? { ...w, cut: true } : w));
  const cutsDone = state.cutsDone + 1;
  return {
    state: { type: 'wiring', wires, cutsDone, lastWrongWireId: null },
    solved: cutsDone >= def.pairsToCut.length,
    penalty: false,
  };
}

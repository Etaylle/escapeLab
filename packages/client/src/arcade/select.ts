/**
 * The machine's game select, without the page: its games in order, which is chosen by a key, and
 * the game played last, kept in this browser (guarded: a refused or broken store means none).
 */
import type { Store } from './scores.js';

export type GameId = 'ducks' | 'flush';
export const GAME_IDS: readonly GameId[] = ['ducks', 'flush'];
export const LAST_KEY = 'escapelab-arcade-last';

/** The card a key moves to from `at`: ← and → step round, 1 and 2 jump; null for other keys. */
export function selectStep(at: number, code: string): number | null {
  const count = GAME_IDS.length;
  const step = ARROWS[code];
  if (step !== undefined) return (at + step + count) % count;
  const digit = /^(?:Digit|Numpad)([1-9])$/.exec(code)?.[1];
  const index = Number(digit) - 1;
  return index < count ? index : null;
}

/** How far an arrow moves the light: on to the next card, or back to the one before. */
const ARROWS: Readonly<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/** The game played last on this browser; the first where none is kept. */
export function lastGame(storage: Store | null): GameId {
  try {
    const kept = storage?.getItem(LAST_KEY) ?? null;
    return GAME_IDS.find((id) => id === kept) ?? 'ducks';
  } catch {
    // A store that refuses: no memory, the first game.
    return 'ducks';
  }
}

/** Keeps `id` as the game played last; nothing where the store refuses. */
export function rememberGame(storage: Store | null, id: GameId): void {
  try {
    storage?.setItem(LAST_KEY, id);
  } catch {
    // A store that refuses keeps nothing: the select starts on the first game next time.
  }
}

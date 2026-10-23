import { useEffect, useState } from 'react';
import type { Difficulty, MissionInfo, Phase } from '@escapelab/core';
import { localStore } from './notes.js';

/**
 * A device's first run. Until it has seen a run won, a room it opens starts on „entspannt" —
 * a crew new to the lab gets more time and no alarm limit — and the join screen points at the
 * tutorial. The browser keeps the flag; where it keeps nothing, every run counts as the first.
 */

/** Where the browser keeps it, set by the first run this device saw won. */
export const WON_KEY = 'escapelab.won';

/** The lobby's line under the levels while the first-run default stands. */
export const FIRST_RUN_LINE = 'Erster Einsatz: entspannt vorgewählt — ohne Alarmlimit, mehr Zeit.';

/** On the tutorial's card of the join screen, until this device has won a run. */
export const FIRST_RUN_HINT = 'Erster Einsatz? Hier starten';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** Whether this device has seen a run won; false where the browser keeps nothing. */
export function hasWon(store: Pick<Store, 'getItem'> | null): boolean {
  try {
    return store?.getItem(WON_KEY) === '1';
  } catch {
    return false;
  }
}

/** Remembers a run won on this device; where the browser refuses, the next run counts as first. */
export function markWon(store: Pick<Store, 'setItem'> | null): void {
  try {
    store?.setItem(WON_KEY, '1');
  } catch (err) {
    console.warn(`[escapelab] the won run is not remembered: ${String(err)}`);
  }
}

/** The difficulty a room this device opens starts on. */
export function firstDifficulty(won: boolean): Difficulty {
  return won ? 'normal' : 'entspannt';
}

/** The tutorial among the missions: the one whose title says so. */
export function isTutorial(mission: Pick<MissionInfo, 'title'>): boolean {
  return /^Tutorial\b/.test(mission.title);
}

/** Whether this device has seen a run won, read as the screen comes up. */
export function useWon(): boolean {
  const [won] = useState(() => hasWon(localStore()));
  return won;
}

/** Remembers on this device a run its player saw won (`phase`, of the player's view). */
export function useWonMark(phase: Phase | null): void {
  useEffect(() => {
    if (phase === 'won') {
      markWon(localStore());
    }
  }, [phase]);
}

import { useEffect, useRef } from 'react';

/**
 * The browser's back button in a run opens the run's menu (menuLayer.ts) instead of leaving the
 * page: as the run starts, the page stands one step deeper in its history — the same address, a
 * state of its own (`GUARD`); back from that step, the menu opens and the step is taken again,
 * so that the next back opens it as well. Once the run is over, or left, the step goes back where
 * it still stands on top. Closing the tab stays what it always was: a drop.
 */

/** The mark of the history's step a run stands on. */
export const GUARD = 'escapelabRun';

/** The page's history as the guard uses it. */
export interface GuardedHistory {
  readonly state: unknown;
  pushState(data: unknown, unused: string): void;
  back(): void;
}

/** The window as the guard uses it: its history, and its `popstate` as the history steps back. */
export interface GuardedWindow {
  readonly history: GuardedHistory;
  addEventListener(type: 'popstate', listener: () => void): void;
  removeEventListener(type: 'popstate', listener: () => void): void;
}

/** Whether a history state is the run's step (`GUARD`). */
export function guarded(state: unknown): boolean {
  return typeof state === 'object' && state !== null && GUARD in state;
}

/**
 * Stands the page on the run's step of its history, and opens the menu (`onBack`) whenever the
 * history steps back from it, taking the step again. Returns what lets go of it: the step taken
 * back where it still stands on top.
 */
export function guardHistory(win: GuardedWindow, onBack: () => void): () => void {
  const step = (): void => win.history.pushState({ [GUARD]: true }, '');
  if (!guarded(win.history.state)) {
    step();
  }
  const onPop = (): void => {
    if (!guarded(win.history.state)) {
      step();
      onBack();
    }
  };
  win.addEventListener('popstate', onPop);
  return () => {
    win.removeEventListener('popstate', onPop);
    if (guarded(win.history.state)) {
      win.history.back();
    }
  };
}

/** The back button guarded while `on`, a run on: it opens the menu by `onBack` (`guardHistory`). */
export function useHistoryGuard(on: boolean, onBack: () => void): void {
  const latest = useRef(onBack);
  latest.current = onBack;
  useEffect(() => (on ? guardHistory(window, () => latest.current()) : undefined), [on]);
}

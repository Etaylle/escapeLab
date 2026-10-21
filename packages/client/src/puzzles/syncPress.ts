import { useEffect, useState } from 'react';
import type { PuzzleView } from '@escapelab/core';

/**
 * syncPress.ts: what a sync station's view says of the presses — the window, this player's own
 * press with its expiry, the partners' — for the main switch (LeverPanel), the mushroom button
 * (ButtonSyncPanel) and their coach lines (coach.ts). Pure but for the hook at the end.
 */

type SyncView = Extract<PuzzleView, { kind: 'button-sync' }>;

/** A press of this player's that runs out: when it came, and when its window shuts (epoch ms). */
export interface OwnPress {
  at: number;
  expiresAt: number;
}

/** A sync station's presses, as its panel and coach line read them. */
export interface SyncPress {
  /** how close together the crew has to press, ms; null where order and spacing do not count */
  windowMs: number | null;
  /** this player's press while the view counts it and its window runs; null otherwise */
  press: OwnPress | null;
  /** how many partners' presses are in */
  partners: number;
  /** this player's press ran out of its window: the server dropped it */
  expired: boolean;
}

/**
 * The presses of a sync station's view: its window, this player's own press — where it runs
 * out, at a station with a window — the partners' presses in, the view counting how many and
 * saying whether any is, and whether this player's last press ran out.
 */
export function syncPress(view: SyncView): SyncPress {
  const { press } = view;
  const others = Math.max(0, view.pressedCount - (view.youPressed ? 1 : 0));
  return {
    windowMs: view.windowMs,
    press:
      press === null || press.expiresAt === null ? null : { at: press.at, expiresAt: press.expiresAt },
    partners: view.partnerPressed ? Math.max(1, others) : 0,
    expired: view.lastResult === 'expired',
  };
}

/** A window in seconds as the plate and the coach print it: „2", „2,5". */
export function secondsText(ms: number): string {
  return String(Math.round(ms / 100) / 10).replace('.', ',');
}

/** This player's press at a station, as it stands at a moment. */
export interface OwnPressState {
  /** in: the press counts — or every press is in and the station done */
  down: boolean;
  /** the press while it counts, for its window to drain; null without one */
  ring: OwnPress | null;
  /** the press ran out of its window: up again, to press anew */
  expired: boolean;
}

/**
 * This player's press at `now` (epoch ms): in while it counts — out again the moment its
 * window shuts, whether or not the server has said so yet, since a press past its window
 * counts no more — and in for good once every press is.
 */
export function ownPressAt(view: SyncView, sync: SyncPress, now: number): OwnPressState {
  if (view.pressedCount >= view.requiredCount) {
    return { down: true, ring: null, expired: false };
  }
  const ranOut = sync.press !== null && now >= sync.press.expiresAt;
  const down = view.youPressed && !ranOut;
  return { down, ring: down ? sync.press : null, expired: !down && (sync.expired || ranOut) };
}

/** Renders again at `at` (epoch ms) — as a press's window shuts — and returns the render's time. */
export function useNowUntil(at: number | null): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    const wait = at === null ? 0 : at - Date.now();
    if (wait <= 0) {
      return undefined;
    }
    const timer = setTimeout(() => setTick((tick) => tick + 1), wait);
    return () => clearTimeout(timer);
  }, [at]);
  return Date.now();
}

import { useEffect, useRef } from 'react';
import type { PuzzleView } from '@escapelab/core';
import { serverNow } from '../clock.js';
import type { DeviceCrew } from './Device.js';
import { countTick } from './sounds.js';
import {
  countChangeAt,
  countDigit,
  countLine,
  countOf,
  syncPress,
  tickDue,
  useNowUntil,
  type SyncCount,
} from './syncPress.js';

/**
 * SyncCount.tsx: the count a sync station shows every page at it from the first press of its
 * window, after Portal 2's co-op countdown — a way for the crew to keep in step: the same digit
 * on every page from the server's clock, whose press opened the window, and a tick each whole
 * second. The presses' own expiry stays the rule (core buttonSync.ts); the count only shows it.
 */

type SyncView = Extract<PuzzleView, { kind: 'button-sync' }>;

/** A sync station's count at the moment its panel renders, server time. */
export interface SyncMoment {
  now: number;
  count: SyncCount | null;
}

/** The earlier of two moments, either of which may be none. */
function earliest(a: number | null, b: number | null): number | null {
  if (a === null) {
    return b;
  }
  return b === null ? a : Math.min(a, b);
}

/**
 * The count of a sync station's view at the server's time now. The panel renders again as each
 * whole second of the window begins and as it shuts — and as this player's own press runs out —
 * and, worked at a console (`audible`), ticks each whole second once; the audience hears none.
 */
export function useSyncCount(puzzle: SyncView, audible: boolean): SyncMoment {
  const count = countOf(puzzle);
  const read = serverNow();
  const shuts = syncPress(puzzle).press?.expiresAt ?? null;
  const own = shuts !== null && shuts > read ? shuts : null;
  const next = count === null ? null : countChangeAt(count, read);
  const now = useNowUntil(earliest(own, next));
  useCountTicks(count, now, audible);
  return { now, count };
}

/** Sounds the count's tick due at `now` (`tickDue`): once each whole second of its window. */
function useCountTicks(count: SyncCount | null, now: number, audible: boolean): void {
  const heard = useRef<number | null>(null);
  const from = count?.from ?? null;
  const until = count?.until ?? null;
  useEffect(() => {
    if (from === null || until === null || !audible) {
      return;
    }
    const due = tickDue({ from, until }, now, heard.current);
    if (due !== null) {
      heard.current = due;
      countTick();
    }
  }, [from, until, now, audible]);
}

/**
 * The count beside the station's control, in a dark window of its own: whose press opened the
 * window — „Anna hat gezogen —" — and in large digits the whole seconds it has left as each
 * begins. Nothing without a count, nor once its window has shut.
 */
export function SyncCountDisplay({
  moment,
  style,
  crew,
}: {
  moment: SyncMoment;
  style: SyncView['style'];
  crew: DeviceCrew | null;
}) {
  const { count, now } = moment;
  const digit = count === null ? null : countDigit(count, now);
  if (count === null || digit === null) {
    return null;
  }
  const name = crew?.mates.find((mate) => mate.id === count.by)?.name ?? null;
  return (
    <div className="sync-count" role="timer">
      <span className="sync-count-by">{countLine(style, name)}</span>
      <span className="sync-count-digit">{digit}</span>
    </div>
  );
}

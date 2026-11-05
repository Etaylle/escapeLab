import { useSyncExternalStore } from 'react';
import { TOUCH } from '../world/interact.js';

/**
 * A phone held sideways folds the HUD into one row over the world (Game.tsx `StageTop`,
 * HudRow.tsx): the objective bar and the crew strip, which together took a third of its 390 px,
 * become a row a fingertip's 44 px tall (styles/pwa.css) — the stations' LEDs over the goal in
 * one line, or the line on the air in its place, the crew as coloured dots, the Laborkennung's
 * value, the clock and the alarms, and the buttons. The crew strip under the world goes, so the
 * world's canvas takes the height it gave up. Pure but for `useHudRow`.
 */

/** How tall a window may stand at most and still fold its HUD into the row, CSS px. */
export const ROW_MAX_HEIGHT = 500;

/** A window as the folding rule reads it: its size, CSS px, and whether a finger steers it. */
export interface HudWindow {
  width: number;
  height: number;
  coarse: boolean;
}

/**
 * Whether a window folds the HUD into the row: one under a finger, held sideways — wider than
 * tall — and ROW_MAX_HEIGHT tall or less, as every rule for a phone held sideways in the
 * stylesheets reads it (`(pointer: coarse) and (orientation: landscape) and (max-height:
 * 500px)`). A window with keys keeps the bar and the strip at any height.
 */
export function foldsHud({ width, height, coarse }: HudWindow): boolean {
  return coarse && width > height && height <= ROW_MAX_HEIGHT;
}

/** Re-renders on every resize and as the primary pointer changes. */
function watchWindow(onChange: () => void): () => void {
  const pointer = window.matchMedia(TOUCH);
  window.addEventListener('resize', onChange);
  pointer.addEventListener('change', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
    pointer.removeEventListener('change', onChange);
  };
}

/** Whether this window folds the HUD into the row now (`foldsHud`); never on the server. */
export function useHudRow(): boolean {
  return useSyncExternalStore(
    watchWindow,
    () =>
      foldsHud({
        width: window.innerWidth,
        height: window.innerHeight,
        coarse: window.matchMedia(TOUCH).matches,
      }),
    () => false,
  );
}

/** How long a crew member's tag shows in the row after it changed, ms. */
export const TAG_SHOWN_MS = 3000;

/** What the row keeps of each crew member's tag, by id: what it said, and since when (ms). */
export type TagMemory = ReadonlyMap<string, { said: string; since: number }>;

/** A crew member's tag as the row reads it: who, and what it says now. */
export interface TagNow {
  id: string;
  said: string;
}

/**
 * The crew's tags at `now` (ms) against what the row kept of them (`memory`): the memory to keep
 * and whose tag shows — each one's for TAG_SHOWN_MS after it changed, and no longer. A crew
 * member first seen has changed nothing: their tag stays hidden until it does.
 */
export function freshTags(
  memory: TagMemory,
  crew: readonly TagNow[],
  now: number,
): { memory: TagMemory; shown: ReadonlySet<string> } {
  const kept = new Map<string, { said: string; since: number }>();
  const shown = new Set<string>();
  for (const { id, said } of crew) {
    const before = memory.get(id);
    const since =
      before === undefined ? Number.NEGATIVE_INFINITY : before.said === said ? before.since : now;
    kept.set(id, { said, since });
    if (now - since < TAG_SHOWN_MS) {
      shown.add(id);
    }
  }
  return { memory: kept, shown };
}

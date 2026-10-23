import { useContext, useEffect, useRef, useState } from 'react';
import { useMedia } from '../hooks.js';
import { NotepadContext } from '../noting.js';
import { REDUCED_MOTION } from '../world/finale.js';

/**
 * Putting things down instead of closing windows: a source read on the spot — a book, a
 * clipboard, a terminal, a wall chart, a locker's pages, a note of the last crew — has no
 * window's ✕. Its foot says how to put it down, „[E] Weglegen" (a book: „[E] Zuklappen");
 * E, Esc or a step away (W A S D) do it, and on a touch screen a tab at the board's edge. The
 * sheet then slides down out of view in PUT_DOWN_MS — a book shuts as it goes — with a soft
 * clack, and the player walks on at once.
 */

/** How long a sheet takes to slide down out of view, ms; styles/putdown.css times it so. */
export const PUT_DOWN_MS = 220;

/** The keys that put a sheet down: E, as it was picked up, and a step, W A S D. */
export const PUT_DOWN_KEYS = ['e', 'w', 'a', 's', 'd'] as const;

/** What lies over the world: a station's device, a source's pages, a note of the last crew. */
export type Over = 'station' | 'reading' | 'note';

/**
 * The keys besides Esc that put away what lies over the world: E and a step put down what
 * was read; at a device — whose controls they may work — none, Esc steps back from it.
 */
export function putDownKeys(over: Over | null): readonly string[] {
  return over === 'reading' || over === 'note' ? PUT_DOWN_KEYS : [];
}

/** The verb a source is put down with: a book is shut, everything else laid down. */
export type PutDownVerb = 'Zuklappen' | 'Weglegen';

/** What a sheet still held while it slides away keeps of the last open one. */
export interface PutDownState<T> {
  /** the open sheet as last seen; null once it is put down */
  last: T | null;
  /** the sheet on its way down; null once it is gone, or while one is open */
  held: T | null;
}

/**
 * The hold after a render with `item` open (null: put down, or walked away from): an open one
 * is kept as the last, and one gone from it is held on its way down — not under reduced
 * motion (`still`), where it just goes.
 */
export function putDownStep<T>(
  kept: PutDownState<T>,
  item: T | null,
  still: boolean,
): PutDownState<T> {
  if (item !== null) {
    return { last: item, held: null };
  }
  if (kept.last !== null) {
    return { last: null, held: still ? null : kept.last };
  }
  return kept;
}

/** A sheet over the world, open or on its way down (`leaving`). */
export interface Shown<T> {
  item: T;
  leaving: boolean;
}

/**
 * What lies over the world as it is put down: `item` while it is open; once it closed — put
 * down, or walked away from — the last of it for PUT_DOWN_MS, leaving, then nothing. As it
 * goes, `sound` plays for it once, under reduced motion too. `sound` stays the same function.
 */
export function usePutDown<T>(item: T | null, sound: (last: T) => void): Shown<T> | null {
  const still = useMedia(REDUCED_MOTION);
  const kept = useRef<PutDownState<T>>({ last: null, held: null });
  kept.current = putDownStep(kept.current, item, still);
  const held = kept.current.held;
  const [, release] = useState(0);
  useEffect(() => {
    if (held === null) {
      return undefined;
    }
    const timer = setTimeout(() => {
      kept.current = { ...kept.current, held: null };
      release((n) => n + 1);
    }, PUT_DOWN_MS);
    return () => clearTimeout(timer);
  }, [held]);
  usePutDownSound(item, sound);
  if (item !== null) {
    return { item, leaving: false };
  }
  return held === null ? null : { item: held, leaving: true };
}

/** `sound` for the sheet that was open, once, as it is put down. */
function usePutDownSound<T>(item: T | null, sound: (last: T) => void): void {
  const latest = useRef<T | null>(null);
  if (item !== null) {
    latest.current = item;
  }
  const open = item !== null;
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open && latest.current !== null) {
      sound(latest.current);
    }
    wasOpen.current = open;
  }, [open, sound]);
}

/**
 * The foot of a sheet read on the spot: „[E] Weglegen" — a book's „[E] Zuklappen" — where
 * there are keys, a tab at the board's edge on a touch screen (styles/putdown.css shows one of
 * them), and beside the tab the notepad's, where no N key is. Either puts it down.
 */
export function PutDown({ verb, onPutDown }: { verb: PutDownVerb; onPutDown: () => void }) {
  const hand = useContext(NotepadContext);
  return (
    <div className="put-down">
      <button type="button" className="put-down-caption" onClick={onPutDown}>
        {`[E] ${verb}`}
      </button>
      <div className="put-down-tabs">
        <button type="button" className="put-down-tab" onClick={onPutDown}>
          {verb}
        </button>
        {hand !== null && (
          <button type="button" className="put-down-tab put-down-tab--notes" onClick={hand.toggle}>
            Notizen
          </button>
        )}
      </div>
    </div>
  );
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { sessionStore } from '../editor/session.js';

/**
 * The door wipe between the menu and the lobby (styles/menu.css): two leaves of the lab's sliding
 * doors — steel lit from the top, an amber light strip and two chevrons at the seam, as the world
 * draws a door (world/art.ts `drawDoor`) — close over the screen left in CLOSE_MS, that screen
 * held on meanwhile, and open on the next in OPEN_MS. Leaving the lobby loads the page anew
 * (ws.ts `leaveRoom`): the doors shut over the lobby first (`closeDoorsThen`), stay shut while
 * the page goes, and the page loaded opens them on the menu — the tab's sessionStorage carries
 * the word. Under reduced motion the screens cut, and every other change of screen — the run's
 * start, its end, the audience's — cuts as it always did.
 */

/** Where the window is, as the wipe tells the screens apart. */
export type Place = 'menu' | 'lobby' | 'elsewhere';

/**
 * The doors: closing over the screen left, shut while the page loads anew, opening on the next;
 * null while none stand.
 */
export type Doors = 'closing' | 'shut' | 'opening' | null;

/** How long the doors take to close over the screen left, and to open on the next, ms. */
export const CLOSE_MS = 170;
export const OPEN_MS = 210;

/** Where the tab notes that its doors shut as the page went, for the page loaded next. */
export const DOORS_KEY = 'escapelab.doors';
/** How long that note holds, ms: the seat given up and the page loaded anew within it. */
export const DOORS_FRESH_MS = 10_000;

/** The wipe as it stands: where the window is, the doors, what showed as they began to close. */
export interface Wipe<T> {
  place: Place;
  doors: Doors;
  /** what the screen showed as the doors began to close, held on until they open; else null */
  held: { value: T } | null;
  /** what runs once the doors have shut, where they stay shut; else null */
  after: (() => void) | null;
}

/** The window standing at `place`, no doors in it. */
const standing = <T,>(place: Place): Wipe<T> => ({ place, doors: null, held: null, after: null });

/** Whether the window going from `from` to `to` wipes: from the menu to the lobby, or back. */
export function wipes(from: Place, to: Place): boolean {
  return from !== to && from !== 'elsewhere' && to !== 'elsewhere';
}

/**
 * The wipe once the window is at `place`: as the menu and the lobby trade places the doors begin
 * to close over what showed (`last`) — over what they already hold, where they are closing — and
 * things moving less (`reduced`) or any other change of place cut. Shut, the doors stay so.
 */
export function wipeTo<T>(wipe: Wipe<T>, place: Place, last: T, reduced: boolean): Wipe<T> {
  if (place === wipe.place) {
    return wipe;
  }
  if (wipe.doors === 'shut') {
    return { ...wipe, place };
  }
  if (reduced || !wipes(wipe.place, place)) {
    return standing(place);
  }
  return { place, doors: 'closing', held: wipe.held ?? { value: last }, after: null };
}

/** The doors closing over what shows (`last`) where the window stands, `after` run once shut. */
export function closedOver<T>(wipe: Wipe<T>, last: T, after: () => void): Wipe<T> {
  return { place: wipe.place, doors: 'closing', held: wipe.held ?? { value: last }, after };
}

/**
 * The wipe's next step as its doors arrive: closed, they open on the window's screen — or stay
 * shut, where something waits on them; open, they are gone.
 */
export function wipeOn<T>(wipe: Wipe<T>): Wipe<T> {
  if (wipe.doors === 'closing' && wipe.after !== null) {
    return { ...wipe, doors: 'shut', after: null };
  }
  if (wipe.doors === 'closing') {
    return { place: wipe.place, doors: 'opening', held: null, after: null };
  }
  return wipe.doors === 'opening' ? standing(wipe.place) : wipe;
}

/**
 * Whether the page before shut its doors as it went, by the tab's note `mark` (ms since the
 * epoch): less than DOORS_FRESH_MS before `now` — a page come back from the lobby.
 */
export function doorsFresh(mark: number | null, now: number): boolean {
  return mark !== null && now >= mark && now - mark < DOORS_FRESH_MS;
}

/**
 * The wipe a page starts with at `place`: its doors opening where the page before shut them as
 * it went (`doorsFresh`); else none.
 */
export function bootWipe<T>(
  place: Place,
  mark: number | null,
  now: number,
  reduced: boolean,
): Wipe<T> {
  const wipe: Wipe<T> = standing(place);
  return doorsFresh(mark, now) && !reduced ? { ...wipe, doors: 'opening' } : wipe;
}

/** When the page before shut its doors, by the tab's note; null without one. */
export function doorsMark(): number | null {
  try {
    const mark = Number(sessionStore()?.getItem(DOORS_KEY) ?? NaN);
    return Number.isFinite(mark) ? mark : null;
  } catch {
    return null;
  }
}

/** Notes in the tab that its doors shut now (`at`), or forgets it (null). */
export function noteDoors(at: number | null): void {
  try {
    const store = sessionStore();
    if (at === null) {
      store?.removeItem(DOORS_KEY);
    } else {
      store?.setItem(DOORS_KEY, String(at));
    }
  } catch {
    // Deliberately silent: without the note the page loaded next opens without doors.
  }
}

/** The mounted wipe's way to shut its doors before something runs; null while none is. */
let closer: ((after: () => void) => void) | null = null;

/**
 * Shuts the doors over the window, then runs `after` — leaving the lobby, which loads the page
 * anew under them; at once where no wipe is mounted, or things move less.
 */
export function closeDoorsThen(after: () => void): void {
  if (closer === null) {
    after();
  } else {
    closer(after);
  }
}

/**
 * The door wipe over `value` — what the screens are drawn from — as the window goes to `place`:
 * while the doors close or stand shut, the value from before they began; else `value` as it is.
 * `reduced`: the screens cut.
 */
export function useDoorWipe<T>(
  value: T,
  place: Place,
  reduced: boolean,
): { value: T; doors: Doors } {
  const [wipe, setWipe] = useState(() => bootWipe<T>(place, doorsMark(), Date.now(), reduced));
  // The value of the last screen drawn before any doors closed: what they close over.
  const last = useRef(value);
  const next = wipeTo(wipe, place, last.current, reduced);
  if (next !== wipe) {
    // Stored from the render, as React has it: this render is redone at once with it.
    setWipe(next);
  }
  useLayoutEffect(() => {
    if (next.held === null) {
      last.current = value;
    }
  });
  useEffect(() => noteDoors(null), []);
  useEffect(() => {
    if (wipe.doors !== 'closing' && wipe.doors !== 'opening') {
      return undefined;
    }
    const timer = setTimeout(
      () => {
        if (wipe.after !== null) {
          noteDoors(Date.now());
          wipe.after();
        }
        setWipe((current) => wipeOn(current));
      },
      wipe.doors === 'closing' ? CLOSE_MS : OPEN_MS,
    );
    return () => clearTimeout(timer);
  }, [wipe]);
  useEffect(() => {
    closer = (after) =>
      reduced ? after() : setWipe((current) => closedOver(current, last.current, after));
    return () => {
      closer = null;
    };
  }, [reduced]);
  return { value: next.held === null ? value : next.held.value, doors: next.doors };
}

/** Chevrons pointing to the seam, as on the world's doors. */
function Chevrons() {
  return (
    <svg className="door-chevrons" viewBox="0 0 64 56" aria-hidden="true">
      <path d="M10 8 L28 28 L10 48 M34 8 L52 28 L34 48" />
    </svg>
  );
}

/** The doors over the window while they move or stand shut; nothing while they stand open. */
export function DoorWipe({ doors }: { doors: Doors }) {
  if (doors === null) {
    return null;
  }
  return (
    <div className={`door-wipe door-wipe--${doors}`} aria-hidden="true">
      <div className="door-leaf door-leaf--left">
        <Chevrons />
      </div>
      <div className="door-leaf door-leaf--right">
        <Chevrons />
      </div>
    </div>
  );
}

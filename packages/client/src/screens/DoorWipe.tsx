import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { sessionStore } from '../editor/session.js';

/**
 * The door wipe before every change of the menu (styles/menu.css): two leaves of the lab's sliding
 * doors — steel lit from the top, an amber light strip and two chevrons at the seam, as the world
 * draws a door (world/art.ts `drawDoor`) — close over the screen left, that screen held on
 * meanwhile, and open on the next. The lab's doors (`door`, CLOSE_MS and OPEN_MS) stand between the
 * menu and the lobby, both ways, between the menu and a run it goes back to, and before the editor
 * and back; a short shutter of the same leaves (`shutter`, SHUTTER_MS) before a page of the menu's
 * — the booklet, the Bestenliste, „Meine Einsätze", the settings — and on the way back. Taken from
 * the menu, a change waits a beat first (BEAT_MS: the hero steps toward the menu and its lamp
 * flares, screens/MenuHero.tsx) before its leaves close. Leaving the lobby loads the page anew
 * (ws.ts `leaveRoom`): the doors shut over the lobby first (`closeDoorsThen`), stay shut while the
 * page goes, and the page loaded opens them on the menu — the tab's sessionStorage carries the
 * word. Under reduced motion the screens cut, and every other change of screen — the run's start,
 * its end, the audience's — cuts as it always did.
 */

/** Where the window is, as the wipe tells the screens apart. */
export type Place = 'menu' | 'lobby' | 'run' | 'elsewhere';

/**
 * The doors: a beat before they close over the menu left for a page or the editor, closing over
 * the screen left, shut while the page loads anew, opening on the next; null while none stand.
 */
export type Doors = 'beat' | 'closing' | 'shut' | 'opening' | null;

/** Which leaves close: the lab's doors, or the short shutter of the same art before a page. */
export type WipeKind = 'door' | 'shutter';

/** Whether `doors` close over the screen left or stand shut over it: the screen is going. */
export function doorsGoing(doors: Doors): boolean {
  return doors === 'closing' || doors === 'shut';
}

/** How long the doors take to close over the screen left, and to open on the next, ms. */
export const CLOSE_MS = 170;
export const OPEN_MS = 210;
/** How long the shutter before a page takes to close and to open, ms: 180 ms in all. */
export const SHUTTER_MS = { close: 80, open: 100 } as const;
/** How long the beat before a change taken from the menu lasts: its hero's step and flare, ms. */
export const BEAT_MS = 100;

/** How long each kind of leaves closes and opens, ms. */
export const WIPE_MS: Readonly<Record<WipeKind, { close: number; open: number }>> = {
  door: { close: CLOSE_MS, open: OPEN_MS },
  shutter: SHUTTER_MS,
};

/** Where the tab notes that its doors shut as the page went, for the page loaded next. */
export const DOORS_KEY = 'escapelab.doors';
/** How long that note holds, ms: the seat given up and the page loaded anew within it. */
export const DOORS_FRESH_MS = 10_000;

/** The wipe as it stands: where the window is, the doors, what showed as they began to close. */
export interface Wipe<T> {
  place: Place;
  doors: Doors;
  /** the leaves that move: the lab's doors or the shutter */
  kind: WipeKind;
  /** what the screen showed as the doors began to close, held on until they open; else null */
  held: { value: T } | null;
  /** what runs once the leaves have shut; else null */
  after: (() => void) | null;
  /** whether they stay shut once `after` has run: the page loads anew under them */
  stays: boolean;
}

/** The window standing at `place`, no doors in it. */
const standing = <T,>(place: Place): Wipe<T> => ({
  place,
  doors: null,
  kind: 'door',
  held: null,
  after: null,
  stays: false,
});

/**
 * Whether the window going from `from` to `to` wipes: from the menu to the lobby and back, and
 * from the menu to a run it goes back to.
 */
export function wipes(from: Place, to: Place): boolean {
  const way = `${from} ${to}`;
  return way === 'menu lobby' || way === 'lobby menu' || way === 'menu run';
}

/**
 * The wipe once the window is at `place`: as the menu and the lobby trade places, or the menu
 * goes back to a run, the doors begin to close over what showed (`last`) — over what they already
 * hold, where they are closing — and things moving less (`reduced`) or any other change of place
 * cut. Shut, the doors stay so.
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
  const held = wipe.held ?? { value: last };
  return { place, doors: 'closing', kind: 'door', held, after: null, stays: false };
}

/** The doors closing over what shows (`last`) where the window stands, `after` run once shut. */
export function closedOver<T>(wipe: Wipe<T>, last: T, after: () => void): Wipe<T> {
  const held = wipe.held ?? { value: last };
  return { place: wipe.place, doors: 'closing', kind: 'door', held, after, stays: true };
}

/**
 * The leaves of `kind` closing over what shows (`last`) after a beat — a change taken from the
 * menu (`beat`) — `after` run once they have shut, then opening on what it brought.
 */
export function wipedThen<T>(
  wipe: Wipe<T>,
  last: T,
  after: () => void,
  [kind, beat]: readonly [WipeKind, boolean],
): Wipe<T> {
  const held = wipe.held ?? { value: last };
  const doors = beat ? 'beat' : 'closing';
  return { place: wipe.place, doors, kind, held, after, stays: false };
}

/**
 * The wipe's next step as its doors arrive: the beat over, they close; closed, they open on the
 * window's screen — or stay shut, where the page loads anew under them; open, they are gone.
 */
export function wipeOn<T>(wipe: Wipe<T>): Wipe<T> {
  if (wipe.doors === 'beat') {
    return { ...wipe, doors: 'closing' };
  }
  if (wipe.doors === 'closing') {
    return closedOn(wipe);
  }
  return wipe.doors === 'opening' ? standing(wipe.place) : wipe;
}

/** The step of `wipe`'s doors once closed: shut, where the page loads anew under them, else open. */
function closedOn<T>(wipe: Wipe<T>): Wipe<T> {
  return wipe.after !== null && wipe.stays
    ? { ...wipe, doors: 'shut', after: null }
    : { ...wipe, doors: 'opening', held: null, after: null };
}

/** How long `wipe`'s doors take to come to their next step, ms; null where they stand. */
export function stepMs(wipe: Pick<Wipe<unknown>, 'doors' | 'kind'>): number | null {
  const { doors, kind } = wipe;
  if (doors === 'beat') {
    return BEAT_MS;
  }
  if (doors === 'closing' || doors === 'opening') {
    return doors === 'closing' ? WIPE_MS[kind].close : WIPE_MS[kind].open;
  }
  return null;
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

/** How a mounted wipe is asked to close over the window: its leaves, a beat first, staying shut. */
export interface WipeAsk {
  kind: WipeKind;
  beat: boolean;
  stays: boolean;
}

/** The mounted wipe's way to close over the window before something runs; null while none is. */
let closer: ((after: () => void, ask: WipeAsk) => void) | null = null;

/** Closes the mounted wipe's leaves as `ask` says, then runs `after`; at once where none is. */
function closeThen(after: () => void, ask: WipeAsk): void {
  if (closer === null) {
    after();
  } else {
    closer(after, ask);
  }
}

/**
 * Shuts the doors over the window, then runs `after` — leaving the lobby, which loads the page
 * anew under them; at once where no wipe is mounted, or things move less.
 */
export function closeDoorsThen(after: () => void): void {
  closeThen(after, { kind: 'door', beat: false, stays: true });
}

/**
 * A change of the menu's to the editor, a page of its own, or back (`after`): the lab's doors
 * close over the window — after the hero's beat where it is taken from the menu (`beat`) — and
 * open on what it brought; at once where no wipe is mounted, or things move less.
 */
export function doorsThen(after: () => void, beat = false): void {
  closeThen(after, { kind: 'door', beat, stays: false });
}

/**
 * A page of the menu's opened, or put away (`after`): the short shutter closes over the window —
 * after the hero's beat where it is taken from the menu (`beat`) — and opens on it; at once where
 * no wipe is mounted, or things move less.
 */
export function shutterThen(after: () => void, beat = false): void {
  closeThen(after, { kind: 'shutter', beat, stays: false });
}

/**
 * What runs as the leaves of `wipe` have closed, at `now` (ms since the epoch): what they closed
 * over to run, where there is something — the tab noted first that its doors shut where they
 * stay shut, the page loading anew under them (`noteDoors`), and only there.
 */
export function runShut<T>(wipe: Wipe<T>, now: number): void {
  if (wipe.doors === 'closing' && wipe.after !== null) {
    if (wipe.stays) noteDoors(now);
    wipe.after();
  }
}

/**
 * How the mounted wipe closes over the window as it is asked (`closer`): where things move less
 * (`reduced`), it runs what is asked at once — the screens cut —; else it sets its leaves going
 * over what the last screen drawn showed (`last`), as the ask says.
 */
export function closerOf<T>(
  reduced: boolean,
  last: { readonly current: T },
  setWipe: (to: (current: Wipe<T>) => Wipe<T>) => void,
): (after: () => void, ask: WipeAsk) => void {
  return (after, ask) => {
    if (reduced) {
      after();
      return;
    }
    setWipe((current) =>
      ask.stays
        ? closedOver(current, last.current, after)
        : wipedThen(current, last.current, after, [ask.kind, ask.beat]),
    );
  };
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
): { value: T; doors: Doors; kind: WipeKind } {
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
    const ms = stepMs(wipe);
    if (ms === null) {
      return undefined;
    }
    const timer = setTimeout(() => {
      runShut(wipe, Date.now());
      setWipe((current) => wipeOn(current));
    }, ms);
    return () => clearTimeout(timer);
  }, [wipe]);
  useEffect(() => {
    closer = closerOf(reduced, last, setWipe);
    return () => {
      closer = null;
    };
  }, [reduced]);
  const shown = next.held === null ? value : next.held.value;
  return { value: shown, doors: next.doors, kind: next.kind };
}

/** Chevrons pointing to the seam, as on the world's doors. */
function Chevrons() {
  return (
    <svg className="door-chevrons" viewBox="0 0 64 56" aria-hidden="true">
      <path d="M10 8 L28 28 L10 48 M34 8 L52 28 L34 48" />
    </svg>
  );
}

/**
 * The leaves over the window while they move or stand shut, the shutter's a little quicker;
 * nothing during the beat before them, nor while they stand open.
 */
export function DoorWipe({ doors, kind = 'door' }: { doors: Doors; kind?: WipeKind }) {
  if (doors === null || doors === 'beat') {
    return null;
  }
  return (
    <div className={`door-wipe door-wipe--${doors} door-wipe--${kind}`} aria-hidden="true">
      <div className="door-leaf door-leaf--left">
        <Chevrons />
      </div>
      <div className="door-leaf door-leaf--right">
        <Chevrons />
      </div>
    </div>
  );
}

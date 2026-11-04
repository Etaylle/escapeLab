import { useEffect, useState } from 'react';
import type { PuzzleView } from '@escapelab/core';
import { serverNow } from '../clock.js';

/**
 * syncPress.ts: what a sync station's view says of the presses — the window, this player's own
 * press with its expiry, the partners', and the count every page at the station shows from the
 * window's first press — for the main switch (LeverPanel), the mushroom button
 * (ButtonSyncPanel), their count (SyncCount.tsx) and their coach lines (coach.ts). Pure but for
 * the hook at the end.
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

/**
 * The count every page at a sync station shows from the first live press of its window: whose
 * press opened it, and from when until when the window runs — epoch ms, on the server's clock.
 */
export interface SyncCount {
  by: string;
  from: number;
  until: number;
}

/**
 * The count of a sync station's view: from its first live press over the window — the same on
 * every page, which reads the presses alike. None without a window or a press, and none once
 * every press is in: the station solves, with no count of its own.
 */
export function countOf(view: SyncView): SyncCount | null {
  const [first] = view.presses;
  if (view.windowMs === null || first === undefined || view.pressedCount >= view.requiredCount) {
    return null;
  }
  return { by: first.by, from: first.at, until: first.at + view.windowMs };
}

const SECOND_MS = 1000;

/** The whole seconds of the window gone by at `now`; none before its first press. */
function secondsGone(count: Pick<SyncCount, 'from'>, now: number): number {
  return Math.floor(Math.max(0, now - count.from) / SECOND_MS);
}

/**
 * The digit the count shows at `now` (server time): the whole seconds the window has left as
 * each of its whole seconds begins — over 3.5 s that is 3, 2 and 1, a second each, and 0 for
 * the half second left — and null once it has shut. A page whose reading of the server's clock
 * lags behind the press shows the first digit.
 */
export function countDigit(count: SyncCount, now: number): number | null {
  if (now >= count.until) {
    return null;
  }
  const whole = Math.floor((count.until - count.from) / SECOND_MS);
  return Math.max(0, whole - secondsGone(count, now));
}

/** The next moment after `now` the count changes: its next whole second, or its end; null after. */
export function countChangeAt(count: SyncCount, now: number): number | null {
  if (now >= count.until) {
    return null;
  }
  return Math.min(count.until, count.from + (secondsGone(count, now) + 1) * SECOND_MS);
}

/**
 * How late a page may still sound the tick of a second begun: the view telling it of a press
 * comes a moment after the press, a timer a moment after its time. Later than this, the page
 * waits for the next second, where it ticks with every other page.
 */
export const TICK_LATE_MS = 250;

/**
 * The tick due at `now` (server time) over a count, `heard` being the last one this page
 * sounded, by the moment it stands for: the whole second of the window `now` lies in, unless it
 * was heard or began more than TICK_LATE_MS ago; null otherwise, and once the window shut.
 * Every page ticks at the same moments, on the server's clock.
 */
export function tickDue(
  count: Pick<SyncCount, 'from' | 'until'>,
  now: number,
  heard: number | null,
): number | null {
  if (now >= count.until) {
    return null;
  }
  const second = count.from + secondsGone(count, now) * SECOND_MS;
  return second === heard || now - second > TICK_LATE_MS ? null : second;
}

/**
 * What a crew member's tag reads while their press at the open sync station waits for the
 * others' — „zieht" at the main switch, „drückt" at a button — so that a partner not at the
 * station yet knows to hurry: from the view every player gets of the station, wherever they
 * stand. Null once the press has run out at `now` (server time), once every press is in, and
 * at any other station.
 */
export function pressingWord(view: PuzzleView | null, playerId: string, now: number): string | null {
  if (view?.kind !== 'button-sync' || view.pressedCount >= view.requiredCount) {
    return null;
  }
  const press = view.presses.find((each) => each.by === playerId);
  const live = press !== undefined && (view.windowMs === null || now < press.at + view.windowMs);
  if (!live) {
    return null;
  }
  return view.style === 'lever' ? 'zieht' : 'drückt';
}

/**
 * What the count says of the press that opened its window, by the station's look: „Anna hat
 * gezogen —" at the main switch, „Ben hat gedrückt —" at a button; „Gezogen —" where the
 * crew no longer names its owner.
 */
export function countLine(style: SyncView['style'], name: string | null): string {
  if (style === 'lever') {
    return name === null ? 'Gezogen —' : `${name} hat gezogen —`;
  }
  return name === null ? 'Gedrückt —' : `${name} hat gedrückt —`;
}

/**
 * Renders again at `at` (epoch ms on the server's clock, clock.ts), a moment to come as the
 * render reads the clock — as a press's window shuts, as the count's next second begins — and
 * returns the render's time on that clock. A timer that fires before the server's clock reads
 * `at`, as a fresh reading of it may make one, waits on for the rest; a moment past by the
 * time the render is on screen renders again at once.
 */
export function useNowUntil(at: number | null): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (at === null) {
      return undefined;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wake = (): void => {
      const wait = at - serverNow();
      if (wait > 0) {
        timer = setTimeout(wake, wait);
      } else {
        setTick((tick) => tick + 1);
      }
    };
    wake();
    return () => clearTimeout(timer);
  }, [at]);
  return serverNow();
}

/** The earlier of two moments, either of which may be none. */
export function earliest(a: number | null, b: number | null): number | null {
  if (a === null) {
    return b;
  }
  return b === null ? a : Math.min(a, b);
}

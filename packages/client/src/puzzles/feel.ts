/**
 * feel.ts: the kit every device shares beyond showing its view — what a press does and how a
 * change is told from a mere new copy of the view.
 *
 * A control goes down under the pointer (its CSS) with its sound; a key's press shows the
 * same 80 ms; a press the server refuses shakes with a dull buzz as its refusal comes in;
 * the control pressed just before an alarm shakes too, without the buzz — the alarm has its
 * own sound. The server stays the truth: nothing here holds an input back or shows anything
 * it has not said — a change plays once it has come in, compared with the view before it
 * (`useChange`).
 */
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { SIMON_COLORS, type PuzzleView, type SimonColor } from '@escapelab/core';
import {
  buttonThunk,
  dialDetent,
  keyClick,
  leverPull,
  mushroomStomp,
  probeClick,
  rejectBuzz,
  simonTone,
  toggleClack,
} from './sounds.js';

/** How long a key's press shows: the 80 ms a finger's would. */
export const PRESS_MS = 80;
/** How long a refused control shakes. */
export const REJECT_MS = 160;
/** How long after a press an alarm is still that press's fault. */
export const BLAME_MS = 1500;
/** Under `prefers-reduced-motion: reduce`, the longest anything moves, in ms. */
export const CALM_MS = 120;
/** How long a colour key sounds its tone as it goes down, in s. */
const PRESS_TONE_SECONDS = 0.25;

/** Whether the window asks for reduced motion; without a window, nothing asks. */
export function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** How long something that takes `ms` moves here: CALM_MS at most where motion is reduced. */
export function motionMs(ms: number, reduced: boolean = reducedMotion()): number {
  return reduced ? Math.min(ms, CALM_MS) : ms;
}

/** Custom properties for an element's style, as CSS reads them: `--i`, `--x`. */
export function cssVars(vars: Readonly<Record<`--${string}`, string | number>>): CSSProperties {
  return vars as CSSProperties;
}

// --- presses ------------------------------------------------------------------------------

/** The parts of a control the kit touches: its classes, its `data-` attributes, its layout. */
export interface Control {
  readonly classList: Pick<DOMTokenList, 'add' | 'remove'>;
  readonly dataset: DOMStringMap;
  getBoundingClientRect(): unknown;
}

const isSimonColour = (value: string | undefined): value is SimonColor =>
  SIMON_COLORS.some((colour) => colour === value);

/** The sounds a control can make going down, by its `data-feel`; a click for anything else. */
const PRESS_SOUNDS: Readonly<Record<string, () => void>> = {
  clack: toggleClack,
  thunk: buttonThunk,
  stomp: mushroomStomp,
  pull: leverPull,
  probe: probeClick,
  detent: dialDetent,
  none: () => undefined,
};

/**
 * What a control sounds like going down, as its `data-feel` says: `clack` a toggle, `thunk`
 * a big button, `stomp` the mushroom, `pull` the main switch's lever, `probe` a meter's key,
 * `detent` a dial's step, `tone` a colour key with its colour in `data-tone`, `none` where the
 * device makes its own sound; a click for every other control.
 */
export function pressSound(control: Control): void {
  const { feel, tone } = control.dataset;
  if (feel === 'tone') {
    if (isSimonColour(tone)) {
      simonTone(tone, PRESS_TONE_SECONDS);
    }
    return;
  }
  (PRESS_SOUNDS[feel ?? ''] ?? keyClick)();
}

const flashes = new WeakMap<Control, Map<string, ReturnType<typeof setTimeout>>>();

/** Shows `className` on `control` for `ms` — from its start again where it still shows. */
export function flash(control: Control, className: string, ms: number): void {
  const timers = flashes.get(control) ?? new Map<string, ReturnType<typeof setTimeout>>();
  flashes.set(control, timers);
  clearTimeout(timers.get(className));
  control.classList.remove(className);
  // Reading the layout in between makes the browser start the animation over.
  control.getBoundingClientRect();
  control.classList.add(className);
  const off = setTimeout(() => {
    control.classList.remove(className);
    timers.delete(className);
  }, ms);
  timers.set(className, off);
}

/** A refused control: it shakes for REJECT_MS, with a dull buzz where the device is heard. */
export function reject(control: Control, audible: boolean): void {
  flash(control, 'feel-reject', REJECT_MS);
  if (audible) {
    rejectBuzz();
  }
}

/** A press as the kit keeps it: the control, and when its click went out (ms). */
export interface Press {
  control: Control;
  at: number;
}

/** How a click came: from a key rather than a pointer, and whether the device is heard. */
export interface PressWay {
  keyboard: boolean;
  audible: boolean;
}

/**
 * A control's click — the press that goes out. One from a key shows the control down for
 * PRESS_MS and sounds as a pointer's did going down. Returns the press, for a refusal or an
 * alarm that comes in right after it.
 */
export function pressed(control: Control, way: PressWay, at: number): Press {
  if (way.keyboard) {
    flash(control, 'feel-pressed', PRESS_MS);
    if (way.audible) {
      pressSound(control);
    }
  }
  return { control, at };
}

/**
 * The control a refusal or an alarm at `now` (ms) blames: one pressed within BLAME_MS
 * before it, if any.
 */
export function blamed(last: Press | null, now: number): Control | null {
  return last !== null && now - last.at <= BLAME_MS ? last.control : null;
}

/**
 * Whether more refusals have come in (`now`) than a device has answered (`seen`): the
 * server said no to something since — the last press, as `blamed` tells.
 */
export function refusedSince(seen: number, now: number): boolean {
  return now > seen;
}

/**
 * Blames the press a refusal answers, every time the server's count of them (`refusals`,
 * ws.ts) goes up while the device is open — those from before it opened excepted.
 */
export function useRefusalBlame(refusals: number, blame: () => void): void {
  const seen = useRef(refusals);
  useEffect(() => {
    if (refusedSince(seen.current, refusals)) {
      blame();
    }
    seen.current = refusals;
  }, [refusals, blame]);
}

/** The working button an event landed on, or inside of; none for anything else. */
function controlAt(target: EventTarget): HTMLButtonElement | null {
  if (typeof Element === 'undefined' || !(target instanceof Element)) {
    return null;
  }
  const button = target.closest('button');
  return button === null || button.disabled ? null : button;
}

/** What a device's face takes presses with: every control in it, by one listener each. */
export interface PressHandlers {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onClick: (event: MouseEvent<HTMLElement>) => void;
}

/** Shakes the control a refusal or an alarm blames; with the buzz unless `buzz` is false. */
export type Blame = (buzz?: boolean) => void;

/**
 * The kit's press feel for every control inside an element: the sound as it goes down, a
 * key's PRESS_MS, nothing heard unless `audible`. `blame` shakes the control pressed last,
 * if that was BLAME_MS ago at most: a refusal or an alarm right after a press is that
 * press's fault — a refusal with the buzz, an alarm without it, since one alarm makes one
 * sound. Both stay the same for the element's life.
 */
export function usePressFeel(audible: boolean): { handlers: PressHandlers; blame: Blame } {
  const now = useRef({ audible });
  now.current = { audible };
  const last = useRef<Press | null>(null);
  const [kit] = useState(() => ({
    handlers: {
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        const control = event.button === 0 ? controlAt(event.target) : null;
        if (control !== null && now.current.audible) {
          pressSound(control);
        }
      },
      onClick: (event: MouseEvent<HTMLElement>) => {
        const control = controlAt(event.target);
        if (control !== null) {
          const way = { keyboard: event.detail === 0, ...now.current };
          last.current = pressed(control, way, performance.now());
        }
      },
    },
    blame: (buzz = true) => {
      const control = blamed(last.current, performance.now());
      last.current = null;
      if (control !== null) {
        reject(control, now.current.audible && buzz);
      }
    },
  }));
  return kit;
}

// --- changes ------------------------------------------------------------------------------

/**
 * One change at an open device: the view before it and after it, whether an alarm came in
 * with it, and how many changes the device has seen since it opened — a key that starts
 * what a change plays over again.
 */
export interface Change<V> {
  before: V;
  after: V;
  alarm: boolean;
  seq: number;
}

/** A view's fields that tell where people stand, not what the device does — and its rules. */
const AROUND = new Set(['backup', 'here', 'manual']);

/** What a view shows of the device itself, to compare: who stands where left out. */
export function deviceState(view: PuzzleView): string {
  return JSON.stringify(view, (key, value: unknown) => (AROUND.has(key) ? undefined : value));
}

/** What a device has seen: its view as it last changed, the run's alarms, the last change. */
export interface Seen<V> {
  view: V;
  state: string;
  alarms: number;
  change: Change<V> | null;
}

/** A device that has seen nothing happen yet: open on `view`, the run at `alarms`. */
export function opened<V extends PuzzleView>(view: V, alarms: number): Seen<V> {
  return { view, state: deviceState(view), alarms, change: null };
}

/**
 * What a device has seen once `view` comes in with the run at `alarms`: the same where
 * neither its state nor the alarms moved on — a new copy of the view is no change — else the
 * change from the view it saw last.
 */
export function seeing<V extends PuzzleView>(seen: Seen<V>, view: V, alarms: number): Seen<V> {
  const state = deviceState(view);
  if (state === seen.state && alarms === seen.alarms) {
    return seen;
  }
  const change: Change<V> = {
    before: seen.view,
    after: view,
    alarm: alarms > seen.alarms,
    seq: (seen.change?.seq ?? 0) + 1,
  };
  return { view, state, alarms, change };
}

/**
 * The latest change at an open device, kept until the next one: none before its view or the
 * run's alarms first move on — a device that opens shows its state, not how it got there.
 */
export function useChange<V extends PuzzleView>(view: V, alarms: number): Change<V> | null {
  const [seen, setSeen] = useState(() => opened(view, alarms));
  const next = seeing(seen, view, alarms);
  if (next !== seen) {
    setSeen(next);
  }
  return next.change;
}

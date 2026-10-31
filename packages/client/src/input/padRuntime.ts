import { useEffect, useRef, useSyncExternalStore } from 'react';
import { addProbes } from '../probes.js';
import { getSettings, isRebinding } from '../settings.js';
import { isPadSlot, padActionOf, type PadAction, type PadSlot } from './bindings.js';
import { noteDevice, watchKeyboard } from './device.js';
import { activate, menuScope, moveFocus } from './focus.js';
import {
  AT_REST,
  directionOf,
  NO_STEER,
  padStateOf,
  pressedSince,
  releasedSince,
  STANDARD_BUTTONS,
  steerOf,
  type Direction,
  type GamepadLike,
  type PadButton,
  type PadFamily,
  type PadState,
  type Steer,
} from './pad.js';

/**
 * The controller at work: polled once an animation frame while one is connected (the Gamepad
 * API has no events for presses), its presses turned into what the keys do. In the world the
 * stick and the D-pad walk (`padSteer`, read by the world's step) and R1 sprints; A/✕ works
 * what is in front — it sends Space, which skips the opening too —, B/○ puts down, X/□ opens
 * the notepad and Y/△ the minimap, each by the key bound to it, so that every screen hears the
 * controller as it hears the keys. Over a dialog the D-pad or a flick of the stick moves between
 * its controls, A presses one and B steps back (Esc); a book turns its pages left and right.
 * L1 talks while held, Start opens the settings, Select the Einsatzinfo. With `?fakepad=1` the
 * walkthrough plays a controller of its own through `window.__escapelab.pad`.
 */

/** How long a direction held over a dialog waits before it repeats, and then between steps. */
const REPEAT_AFTER_MS = 380;
const REPEAT_EVERY_MS = 140;

/** What the controller reaches past the keys: the settings, which Start opens. */
export interface PadHooks {
  onSettings: () => void;
}

/** A controller of the walkthrough's: its buttons and stick set from the page's probe. */
class FakePad implements GamepadLike {
  readonly id = 'Fake Controller (STANDARD GAMEPAD Vendor: 045e)';
  connected = false;
  buttons = STANDARD_BUTTONS.map(() => ({ pressed: false, value: 0 }));
  axes = [0, 0, 0, 0];

  set(button: PadButton, down: boolean): void {
    const i = STANDARD_BUTTONS.indexOf(button);
    const now = { pressed: down, value: down ? 1 : 0 };
    this.buttons = this.buttons.map((it, j) => (j === i ? now : it));
    this.connected = true;
  }

  lean(x: number, y: number): void {
    this.axes = [x, y, 0, 0];
    this.connected = true;
  }
}

interface Runtime {
  hooks: PadHooks;
  fake: FakePad | null;
  last: PadState;
  raf: number | null;
  /** keys held down on the page for a button held — L1's talk key — by that button */
  holding: Map<PadButton, string>;
  /** a direction held over a dialog: which, and when it steps again */
  repeat: { dir: Direction; at: number } | null;
  /** the settings wait for a button to remap: it goes there instead of acting */
  capture: ((slot: PadSlot | null) => void) | null;
}

let rt: Runtime | null = null;

/** The controller as the settings' live test shows it. */
export interface PadLive {
  connected: boolean;
  family: PadFamily;
  held: ReadonlySet<PadButton>;
  stick: { x: number; y: number };
}

const NO_PAD: PadLive = {
  connected: false,
  family: 'xbox',
  held: new Set(),
  stick: { x: 0, y: 0 },
};
let live: PadLive = NO_PAD;
const liveListeners = new Set<() => void>();

/** Whether two looks at the controller show the same. */
function sameLive(a: PadLive, b: PadLive): boolean {
  return (
    a.connected === b.connected &&
    a.family === b.family &&
    a.stick.x === b.stick.x &&
    a.stick.y === b.stick.y &&
    a.held.size === b.held.size &&
    [...a.held].every((button) => b.held.has(button))
  );
}

/** The live test told where the controller shows something new. */
function setLive(next: PadLive): void {
  if (sameLive(live, next)) {
    return;
  }
  live = next;
  for (const listener of liveListeners) {
    listener();
  }
}

/** The controller in use: the walkthrough's, or the first connected one. */
function connectedPad(): GamepadLike | null {
  if (rt?.fake != null) {
    return rt.fake.connected ? rt.fake : null;
  }
  const pads =
    typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function'
      ? navigator.getGamepads()
      : [];
  return pads.find((pad): pad is Gamepad => pad !== null && pad.connected) ?? null;
}

/** The named keys as KeyboardEvent carries them; the bindings keep every key lower-cased. */
const EVENT_KEYS: Readonly<Record<string, string>> = {
  escape: 'Escape',
  enter: 'Enter',
  shift: 'Shift',
  tab: 'Tab',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
};

/** A key's name as KeyboardEvent carries it: V stays v, f2 is F2, escape is Escape. */
function eventKey(name: string): string {
  if ([...name].length === 1) {
    return name;
  }
  return EVENT_KEYS[name] ?? name.toUpperCase();
}

/** A key going `type` on the page, where the focus is: as every listener hears a real one. */
function sendKey(type: 'keydown' | 'keyup', name: string): void {
  const target = document.activeElement ?? document.body;
  const init = { key: eventKey(name), bubbles: true, cancelable: true };
  target.dispatchEvent(new KeyboardEvent(type, init));
}

/** A key pressed and let go. */
function tap(name: string): void {
  sendKey('keydown', name);
  sendKey('keyup', name);
}

/** A key held down for as long as `button` is: let go with it (`letGo`). */
function hold(button: PadButton, name: string): void {
  if (rt !== null && !rt.holding.has(button)) {
    rt.holding.set(button, name);
    sendKey('keydown', name);
  }
}

function letGo(button: PadButton): void {
  const name = rt?.holding.get(button);
  if (rt !== null && name !== undefined) {
    rt.holding.delete(button);
    sendKey('keyup', name);
  }
}

/** A main action in the world: by its bound key — A/✕ by Space, which skips the opening too. */
function inWorld(action: PadAction): void {
  tap(action === 'interact' ? ' ' : getSettings().keys[action]);
}

/** A main action over a dialog: A presses the control in the focus, B steps back. */
function overDialog(action: PadAction, scope: Element): void {
  if (action === 'interact') {
    activate(scope);
  } else if (action === 'drop') {
    tap('escape');
  } else if (action === 'notes') {
    tap(getSettings().keys.notes);
  }
}

/** A button pressed: the fixed ones, then the main actions as the settings bind them. */
function pressIn(button: PadButton): void {
  const { keys, pad } = getSettings();
  if (button === 'start') {
    rt?.hooks.onSettings();
  } else if (button === 'select') {
    tap(keys.info);
  } else if (button === 'l1') {
    hold(button, keys.talk);
  } else {
    // R1 and the D-pad steer (`padSteer`); a button no main action sits on does nothing.
    const action = padActionOf(pad, button);
    if (action === null) {
      return;
    }
    const scope = menuScope(document);
    if (scope === null) {
      inWorld(action);
    } else {
      overDialog(action, scope);
    }
  }
}

/** One step towards `dir` over a dialog: a book turns its pages, elsewhere the focus moves. */
function menuStep(scope: Element, dir: Direction): void {
  if (scope.classList.contains('reading-modal') && (dir === 'left' || dir === 'right')) {
    tap(dir === 'left' ? 'arrowleft' : 'arrowright');
    return;
  }
  moveFocus(scope, dir);
}

/** The D-pad or the stick held over a dialog: a step now, then again after a while. */
function steerMenu(state: PadState, now: number): void {
  if (rt === null) {
    return;
  }
  const dir = directionOf(state);
  const scope = dir === null ? null : menuScope(document);
  if (dir === null || scope === null) {
    rt.repeat = null;
    return;
  }
  const same = rt.repeat?.dir === dir;
  if (same && rt.repeat !== null && now < rt.repeat.at) {
    return;
  }
  rt.repeat = { dir, at: now + (same ? REPEAT_EVERY_MS : REPEAT_AFTER_MS) };
  menuStep(scope, dir);
}

/** The settings wait for a button: the first one pressed goes there, a slot or nothing. */
function captured(pressed: readonly PadButton[]): void {
  const [first] = pressed;
  if (rt?.capture == null || first === undefined) {
    return;
  }
  const done = rt.capture;
  rt.capture = null;
  done(isPadSlot(first) ? first : null);
}

/** Whether the stick leans past its dead zone. */
const leaning = (state: PadState): boolean => state.stick.x !== 0 || state.stick.y !== 0;

/** One poll: the live test told, the device noted, the presses carried out. */
function poll(now: number): void {
  if (rt === null) {
    return;
  }
  const pad = connectedPad();
  const next = pad === null ? AT_REST : padStateOf(pad);
  const before = rt.last;
  rt.last = next;
  const pressed = pressedSince(before, next);
  const released = releasedSince(before, next);
  // A press, or the stick coming out of its dead zone, turns the prompts to the controller.
  if (pressed.length > 0 || (leaning(next) && !leaning(before))) {
    noteDevice('pad', next.family);
  }
  setLive({ connected: pad !== null, family: next.family, held: next.held, stick: next.stick });
  released.forEach(letGo);
  if (rt.capture !== null) {
    captured(pressed);
  } else if (!isRebinding()) {
    pressed.forEach(pressIn);
    steerMenu(next, now);
  }
}

/** Whether there is a controller to poll: the walkthrough's once used, or one connected. */
function polling(): boolean {
  return rt !== null && connectedPad() !== null;
}

/** Polls once an animation frame for as long as there is a controller. */
function run(): void {
  if (rt === null || rt.raf !== null) {
    return;
  }
  const frame = (now: number): void => {
    poll(now);
    if (rt !== null) {
      rt.raf = polling() ? requestAnimationFrame(frame) : null;
    }
  };
  rt.raf = requestAnimationFrame(frame);
}

/** Where the walkthrough's probe reaches its controller. */
export interface PadProbe {
  press(button: PadButton): void;
  release(button: PadButton): void;
  /** pressed for `ms`, then let go */
  tap(button: PadButton, ms?: number): Promise<void>;
  /** the left stick leant so far, -1 to 1 each way */
  lean(x: number, y: number): void;
}

function probeOf(fake: FakePad): PadProbe {
  return {
    press: (button) => {
      fake.set(button, true);
      run();
    },
    release: (button) => fake.set(button, false),
    tap: async (button, ms = 120) => {
      fake.set(button, true);
      run();
      await new Promise((resolve) => setTimeout(resolve, ms));
      fake.set(button, false);
    },
    lean: (x, y) => {
      fake.lean(x, y);
      run();
    },
  };
}

/**
 * Starts listening for controllers, and for the keyboard that turns the prompts back to keys;
 * `?fakepad=1` in `search` brings the walkthrough's controller. Returns what stops it all.
 */
export function startPad(hooks: PadHooks, search: string): () => void {
  const fake = new URLSearchParams(search).get('fakepad') === '1' ? new FakePad() : null;
  rt = { hooks, fake, last: AT_REST, raf: null, holding: new Map(), repeat: null, capture: null };
  const stopKeys = watchKeyboard();
  window.addEventListener('gamepadconnected', run);
  const dropProbe = fake === null ? null : addProbes({ pad: probeOf(fake) });
  run();
  return () => {
    if (rt?.raf != null) {
      cancelAnimationFrame(rt.raf);
    }
    for (const button of [...(rt?.holding.keys() ?? [])]) {
      letGo(button);
    }
    window.removeEventListener('gamepadconnected', run);
    stopKeys();
    dropProbe?.();
    rt = null;
    setLive(NO_PAD);
  };
}

/** The controller for the app's life: started once, Start opening the settings by `onSettings`. */
export function usePad(onSettings: () => void): void {
  const latest = useRef(onSettings);
  latest.current = onSettings;
  useEffect(() => startPad({ onSettings: () => latest.current() }, location.search), []);
}

/**
 * Where the controller steers the avatar this frame — the D-pad, else the stick past its dead
 * zone — and whether R1 sprints; nothing without a controller, or while the settings wait for a
 * key or a button. The world's lock (a panel, the pause) holds the avatar anyway.
 */
export function padSteer(): Steer {
  if (rt === null || rt.capture !== null || isRebinding()) {
    return NO_STEER;
  }
  return { ...steerOf(rt.last), sprint: rt.last.held.has('r1') };
}

/**
 * The next button pressed goes to `onButton` instead of acting: the button a main action can sit
 * on, or null for any other — the remap called off. Returns what stops waiting.
 */
export function capturePadButton(onButton: (slot: PadSlot | null) => void): () => void {
  if (rt !== null) {
    rt.capture = onButton;
  }
  return () => {
    if (rt?.capture === onButton) {
      rt.capture = null;
    }
  };
}

function subscribeLive(listener: () => void): () => void {
  liveListeners.add(listener);
  return () => {
    liveListeners.delete(listener);
  };
}

/** The controller as it stands, kept up to date poll by poll: for the settings' live test. */
export function usePadLive(): PadLive {
  return useSyncExternalStore(subscribeLive, () => live, () => NO_PAD);
}

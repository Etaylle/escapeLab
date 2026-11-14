import { useEffect, useRef, useSyncExternalStore } from 'react';
import { typing } from '../hooks.js';
import { addProbes } from '../probes.js';
import { getSettings, isRebinding } from '../settings.js';
import { isPadSlot, padActionOf, type PadAction, type PadSlot } from './bindings.js';
import { noteDevice, watchKeyboard } from './device.js';
import { activate, menuScope, moveFocus } from './focus.js';
import {
  AT_REST,
  directionOf,
  NO_STEER,
  PAD_CHAT,
  PAD_PING,
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
 * stick walks (`padSteer`, read by the world's step) and R1 sprints; A/✕ works what is in
 * front — it sends Space, which skips the opening too —, B/○ puts down, X/□ opens the notepad
 * and Y/△ the minimap, each by the key bound to it, so that every screen hears the controller as
 * it hears the keys; the D-pad's ◀ pings where the avatar looks (`onPadPing`, the world's) and
 * its ▶ opens the quick chat by the chat key. Over a dialog — the quick chat's wheel among them
 * (input/focus.ts) — the D-pad or a flick of the stick moves between its controls, A presses
 * one and B steps back (Esc); a book turns its pages left and right. L1 talks while held —
 * straight to the voice (`onPadTalk`), so that it talks at a prompt holding the keys too —, Start
 * opens the room's menu — off any room the settings — or closes it again (menuLayer.ts), Select
 * the Einsatzinfo. With `?fakepad=1` the walkthrough plays a
 * controller of its own through `window.__escapelab.pad`. Only a controller of the standard
 * mapping is read: another one's buttons and axes would mean something else.
 */

/** How long a direction held over a dialog waits before it repeats, and then between steps. */
const REPEAT_AFTER_MS = 380;
const REPEAT_EVERY_MS = 140;

/** What the controller reaches past the keys: the menus, which Start opens and closes. */
export interface PadHooks {
  onStart: () => void;
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
  /** keys held down on the page for a button held — A on a control made to be held — by it */
  holding: Map<PadButton, string>;
  /** L1 is held down: the voice talks until it is let go */
  talking: boolean;
  /** a direction held over a dialog: which, and when it steps again */
  repeat: { dir: Direction; at: number } | null;
  /**
   * a direction is held that the world took — the stick walking, the D-pad's ◀ or ▶ — : a dialog
   * that comes up under it waits for it to be let go, so that it does not run on through the
   * dialog's controls
   */
  walking: boolean;
  /** the settings wait for a button to remap: it goes there instead of acting */
  capture: ((slot: PadSlot | null) => void) | null;
}

let rt: Runtime | null = null;

/** The world's ping for the D-pad's ◀, while a world that pings is up; null else. */
let worldPing: (() => void) | null = null;

/**
 * The D-pad's ◀ pings by `ping` in the world from now on — where the avatar looks, as the world
 * that registers it says. Returns what takes it off again.
 */
export function onPadPing(ping: () => void): () => void {
  worldPing = ping;
  return () => {
    if (worldPing === ping) {
      worldPing = null;
    }
  };
}

/** The voice's way to talk, for L1, while a voice is up; null else. */
let padTalk: ((held: boolean) => void) | null = null;

/**
 * L1 talks by `talk` from now on — held down `talk(true)`, let go `talk(false)` — straight to the
 * voice and not by the talk key, which a prompt holding the keyboard would type (the
 * Serverraum's terminal, hooks.ts `claimKeys`). Returns what takes it off again.
 */
export function onPadTalk(talk: (held: boolean) => void): () => void {
  padTalk = talk;
  return () => {
    if (padTalk === talk) {
      padTalk = null;
    }
  };
}

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

/** The controller in use: the walkthrough's, or the first connected one of the standard mapping. */
function connectedPad(): GamepadLike | null {
  if (rt?.fake != null) {
    return rt.fake.connected ? rt.fake : null;
  }
  const pads =
    typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function'
      ? navigator.getGamepads()
      : [];
  return (
    pads.find(
      (pad): pad is Gamepad => pad !== null && pad.connected && pad.mapping === 'standard',
    ) ?? null
  );
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

/**
 * A key going `type` on the page, where the focus is: as every listener hears a real one. A
 * controller types nothing, so a text field in the focus lets go of it first — else the key
 * would only type there, and the notepad, say, would never close.
 */
function sendKey(type: 'keydown' | 'keyup', name: string): void {
  if (typing()) {
    (document.activeElement as HTMLElement).blur();
  }
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
  if (button === 'l1') {
    talk(false);
  }
  const name = rt?.holding.get(button);
  if (rt !== null && name !== undefined) {
    rt.holding.delete(button);
    sendKey('keyup', name);
  }
}

/** L1 held down or let go: the voice talks for as long as it is held (`onPadTalk`). */
function talk(held: boolean): void {
  if (rt !== null && rt.talking !== held) {
    rt.talking = held;
    padTalk?.(held);
  }
}

/** A main action in the world: by its bound key — A/✕ by Space, which skips the opening too. */
function inWorld(action: PadAction): void {
  tap(action === 'interact' ? ' ' : getSettings().keys[action]);
}

/**
 * A's press over a dialog, by `button`: a control made to be held (`data-pad="hold"`, the
 * button module's face) is held for as long as the button is, by Space; any other is pressed.
 */
function pressInDialog(scope: Element, button: PadButton): void {
  const focused = document.activeElement as HTMLElement | null;
  if (focused !== null && scope.contains(focused) && focused.dataset['pad'] === 'hold') {
    hold(button, ' ');
  } else {
    activate(scope);
  }
}

/** A main action over a dialog, by `button`: A presses the control in the focus, B steps back. */
function overDialog(action: PadAction, scope: Element, button: PadButton): void {
  if (action === 'interact') {
    pressInDialog(scope, button);
  } else if (action === 'drop') {
    tap('escape');
  } else if (action === 'notes') {
    tap(getSettings().keys.notes);
  }
}

/**
 * The D-pad's ◀ or ▶ in the world: ◀ pings (`onPadPing`), ▶ opens the quick chat by its key.
 * Over a dialog the D-pad is the dialog's (`steerMenu`).
 */
function inWorldDpad(button: typeof PAD_PING | typeof PAD_CHAT): void {
  if (menuScope(document) !== null) {
    return;
  }
  if (button === PAD_PING) {
    worldPing?.();
  } else {
    tap(getSettings().keys.chat);
  }
}

/** A button pressed: the fixed ones, then the main actions as the settings bind them. */
function pressIn(button: PadButton): void {
  const { keys, pad } = getSettings();
  if (button === 'start') {
    rt?.hooks.onStart();
  } else if (button === 'select') {
    tap(keys.info);
  } else if (button === 'l1') {
    talk(true);
  } else if (button === PAD_PING || button === PAD_CHAT) {
    inWorldDpad(button);
  } else {
    // R1 sprints (`padSteer`); a button no main action sits on does nothing.
    const action = padActionOf(pad, button);
    if (action === null) {
      return;
    }
    const scope = menuScope(document);
    if (scope === null) {
      inWorld(action);
    } else {
      overDialog(action, scope, button);
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

/**
 * The direction the D-pad or the stick holds over a dialog, and the dialog; null where none is
 * held, where the world takes it — there the stick walks, the D-pad pings or opens the quick
 * chat —, or while one held in the world is still held.
 */
function heldOverDialog(
  runtime: Runtime,
  state: PadState,
): { dir: Direction; scope: Element } | null {
  const dir = directionOf(state);
  const scope = dir === null ? null : menuScope(document);
  if (dir === null || scope === null) {
    runtime.repeat = null;
    runtime.walking = dir !== null;
    return null;
  }
  return runtime.walking ? null : { dir, scope };
}

/**
 * Whether `dir`, held, steps now: at once, again after REPEAT_AFTER_MS, then every
 * REPEAT_EVERY_MS.
 */
function stepDue(runtime: Runtime, dir: Direction, now: number): boolean {
  const { repeat } = runtime;
  const same = repeat !== null && repeat.dir === dir;
  if (same && now < repeat.at) {
    return false;
  }
  runtime.repeat = { dir, at: now + (same ? REPEAT_EVERY_MS : REPEAT_AFTER_MS) };
  return true;
}

/**
 * The D-pad or the stick held over a dialog: a step now, then again after a while — but not
 * while a direction that walked in the world is still held.
 */
function steerMenu(state: PadState, now: number): void {
  if (rt === null) {
    return;
  }
  const held = heldOverDialog(rt, state);
  if (held !== null && stepDue(rt, held.dir, now)) {
    menuStep(held.scope, held.dir);
  }
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

/** A press, or the stick coming out of its dead zone, turns the prompts to the controller. */
function noteUse(before: PadState, next: PadState, pressed: readonly PadButton[]): void {
  if (pressed.length > 0 || (leaning(next) && !leaning(before))) {
    noteDevice('pad', next.family);
  }
}

/** What the presses do: go to the settings' remap, call off their wait for a key, or act. */
function actOn(runtime: Runtime, pressed: readonly PadButton[], next: PadState, now: number): void {
  if (runtime.capture !== null) {
    captured(pressed);
  } else if (isRebinding()) {
    // The keys' table waits for a key, which no button gives: any button calls it off (Esc).
    if (pressed.length > 0) {
      tap('escape');
    }
  } else {
    pressed.forEach(pressIn);
    steerMenu(next, now);
  }
}

/** One poll: the live test told, the device noted, the presses carried out. */
function poll(now: number): void {
  if (rt === null) {
    return;
  }
  const pad = connectedPad();
  const next = pad === null ? AT_REST : padStateOf(pad, getSettings().deadzone / 100);
  const before = rt.last;
  rt.last = next;
  const pressed = pressedSince(before, next);
  noteUse(before, next, pressed);
  setLive({ connected: pad !== null, family: next.family, held: next.held, stick: next.stick });
  releasedSince(before, next).forEach(letGo);
  actOn(rt, pressed, next, now);
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
  rt = {
    hooks,
    fake,
    last: AT_REST,
    raf: null,
    holding: new Map(),
    talking: false,
    repeat: null,
    walking: false,
    capture: null,
  };
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
    talk(false);
    window.removeEventListener('gamepadconnected', run);
    stopKeys();
    dropProbe?.();
    rt = null;
    setLive(NO_PAD);
  };
}

/** The controller for the app's life: started once, Start doing what `onStart` does. */
export function usePad(onStart: () => void): void {
  const latest = useRef(onStart);
  latest.current = onStart;
  useEffect(() => startPad({ onStart: () => latest.current() }, location.search), []);
}

/**
 * Where the controller steers the avatar this frame — the stick past its dead zone — and whether
 * R1 sprints; nothing without a controller, while the settings wait for a key or a button, or
 * while a dialog is open over the world — the settings, the info, the quick chat's wheel —
 * where the stick moves between controls instead. The world's own lock holds the avatar anyway.
 */
export function padSteer(): Steer {
  if (rt === null || rt.capture !== null || isRebinding()) {
    return NO_STEER;
  }
  const steer = steerOf(rt.last);
  if ((steer.x !== 0 || steer.y !== 0) && menuScope(document) !== null) {
    return NO_STEER;
  }
  return { ...steer, sprint: rt.last.held.has('r1') };
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

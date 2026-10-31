import { useSyncExternalStore } from 'react';
import type { PadFamily } from './pad.js';

/**
 * What the player steers with right now — the keyboard or a controller — by what they used
 * last: a controller's press or lean (input/padRuntime.ts) turns every prompt to its buttons,
 * a key pressed turns them back (input/glyphs.ts). The page's root carries it as
 * `data-input`, so that the stylesheets can mark the control a controller has the focus on.
 */

export type InputDevice = 'keys' | 'pad';

export interface DeviceState {
  device: InputDevice;
  /** the controller's buttons as printed, of the one used last */
  family: PadFamily;
}

let state: DeviceState = { device: 'keys', family: 'xbox' };
const listeners = new Set<() => void>();

/** What the player steers with now. */
export function inputDevice(): DeviceState {
  return state;
}

/** The player used `device` — a controller of `family`: the prompts follow where it changed. */
export function noteDevice(device: InputDevice, family: PadFamily = state.family): void {
  if (state.device === device && state.family === family) {
    return;
  }
  state = { device, family };
  if (typeof document !== 'undefined') {
    document.documentElement.dataset['input'] = device;
  }
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** What the player steers with, kept up to date. */
export function useInputDevice(): DeviceState {
  return useSyncExternalStore(subscribe, inputDevice, inputDevice);
}

/**
 * A real key pressed — not one a controller's press sends on (`isTrusted` false) — turns the
 * prompts back to the keys. Returns what stops listening.
 */
export function watchKeyboard(): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.isTrusted) {
      noteDevice('keys');
    }
  };
  window.addEventListener('keydown', onKey, true);
  return () => window.removeEventListener('keydown', onKey, true);
}

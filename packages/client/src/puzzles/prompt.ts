import { claimKeys, typing } from '../hooks.js';
import { inputDevice } from '../input/device.js';
import { menuScope } from '../input/focus.js';

/**
 * A prompt at a device and the keyboard — the Serverraum's terminal (ServersPanel.tsx). The
 * prompt takes the focus as the terminal opens and keeps it after every command and every key
 * of the terminal's own; while it is up, every printable key typed on the keyboard goes to it
 * wherever the focus went — a click elsewhere in the panel loses nothing —, the talk key with
 * them, so that V types like any letter (the mouse and the controller talk there). Esc steps
 * back as at every device: it is nobody's key here. Where the pointer is a finger the prompt
 * takes the focus only when touched, as the screen's own keyboard would cover the terminal; on
 * a controller the D-pad moves the focus itself.
 */

/** A key going down, as far as the prompt reads it. */
export type PromptKey = Pick<
  KeyboardEvent,
  'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'isComposing' | 'isTrusted'
>;

/**
 * Whether a key types a character: one printable character from the keyboard — not one a
 * controller's press sends on (`isTrusted` false, as input/device.ts reads it) — with no Strg,
 * Alt or Cmd held and no word being composed.
 */
export function printable(e: PromptKey): boolean {
  const plain = !e.altKey && !e.ctrlKey && !e.metaKey && !e.isComposing;
  return e.isTrusted && plain && [...e.key].length === 1;
}

/**
 * Whether a key going down while the prompt is up goes to it from wherever the focus is: a
 * printable one, while no text field has the keyboard — the prompt types it itself, the
 * notepad keeps its own — and the prompt is not `covered` (another dialog over it, or its own
 * stepped back from or solved).
 */
export function strayKey(e: PromptKey, typingNow: boolean, covered: boolean): boolean {
  return printable(e) && !typingNow && !covered;
}

/** Whether the pointer is a finger. */
function fingered(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}

/**
 * Whether the prompt takes the focus by itself: where the keys and a mouse steer — not under a
 * finger, where the screen's keyboard would come up over the terminal, nor on a controller,
 * whose D-pad moves the focus between the controls itself.
 */
export function takesFocus(): boolean {
  return inputDevice().device === 'keys' && !fingered();
}

/** The prompt takes the keyboard back after a command or a key of the device's (`takesFocus`). */
export function keepFocus(field: Pick<HTMLElement, 'focus'> | null): void {
  if (field !== null && takesFocus()) {
    field.focus();
  }
}

/**
 * Whether keys typed elsewhere stay away from the prompt: its device is inert — stepped back
 * from, or solved — or another dialog lies over it (the settings, the Einsatzinfo).
 */
function coveredOver(field: HTMLElement): boolean {
  if (field.closest('[inert]') !== null) {
    return true;
  }
  const top = menuScope(document);
  return top !== null && !top.contains(field);
}

/**
 * The prompt holds the keyboard from now on: `field` takes the focus where it takes it at all
 * (`takesFocus`), and every key typed elsewhere (`strayKey`) goes to it instead — `type` puts it
 * at the end of the line —, the field taking the focus with it and no other listener hearing
 * the key: not the world's, not the notepad's N. While it holds the keyboard the talk key types
 * (hooks.ts `claimKeys`). Returns what lets go.
 */
export function holdKeys(field: HTMLElement, type: (text: string) => void): () => void {
  keepFocus(field);
  const release = claimKeys();
  const onKey = (e: KeyboardEvent): void => {
    if (!strayKey(e, typing(), coveredOver(field))) {
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    field.focus();
    type(e.key);
  };
  // Capturing on the window: ahead of all but the voice's listener, which stands back (claimKeys).
  window.addEventListener('keydown', onKey, true);
  return () => {
    window.removeEventListener('keydown', onKey, true);
    release();
  };
}

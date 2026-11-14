import { getSettings, useSettings, type GlyphChoice } from '../settings.js';
import {
  keyName,
  type InputAction,
  type KeyBindings,
  type PadAction,
  type PadBindings,
} from './bindings.js';
import { inputDevice, useInputDevice, type InputDevice } from './device.js';
import { PAD_CHAT, PAD_GLYPHS, type PadButton, type PadFamily } from './pad.js';

/**
 * What every prompt names a control by: the key bound to it, or — where a controller was used
 * last — its button as the controller prints it. No prompt names a key of its own; a test reads
 * every screen's text for one.
 */

/**
 * What a prompt asks for: an action, or one of the steps every screen shares — stepping back
 * (Esc), putting a sheet down, skipping the opening, turning a book's page, opening the menu
 * over a room (Esc with nothing open, a controller's Start).
 */
export type Prompt = InputAction | 'close' | 'putDown' | 'skip' | 'pageBack' | 'pageOn' | 'menu';

/** What the glyph depends on: the bindings, and the device used last. */
export interface GlyphSource {
  keys: KeyBindings;
  pad: PadBindings;
  device: InputDevice;
  family: PadFamily;
}

/**
 * The fixed buttons of a controller, by what they do; the stick walks, so the four ways to walk
 * have none.
 */
const PAD_FIXED: Readonly<Partial<Record<Prompt, PadButton>>> = {
  sprint: 'r1',
  talk: 'l1',
  info: 'select',
  chat: PAD_CHAT,
  pageBack: 'dleft',
  pageOn: 'dright',
  menu: 'start',
};

/** The prompts worked by one of the controller's main actions, on the button bound to it. */
const BY_PAD_ACTION: Partial<Record<Prompt, PadAction>> = {
  interact: 'interact',
  skip: 'interact',
  drop: 'drop',
  close: 'drop',
  putDown: 'drop',
  notes: 'notes',
  minimap: 'minimap',
};

/** The controller's button for `prompt`; none where the controller has none (the ways to walk). */
function padButtonOf(prompt: Prompt, pad: PadBindings): PadButton | null {
  const action = BY_PAD_ACTION[prompt];
  return action === undefined ? (PAD_FIXED[prompt] ?? null) : pad[action];
}

/**
 * The key for `prompt` under `keys`: the shared steps' keys whatever is bound — Esc steps back
 * and opens the menu, Space skips, the arrows turn a page — and a sheet is put down with the key
 * that works things.
 */
function keyOf(prompt: Prompt, keys: KeyBindings): string {
  switch (prompt) {
    case 'putDown':
      return keys.interact;
    case 'close':
    case 'menu':
      return 'escape';
    case 'skip':
      return ' ';
    case 'pageBack':
      return 'arrowleft';
    case 'pageOn':
      return 'arrowright';
    default:
      return keys[prompt];
  }
}

/**
 * The glyph a prompt shows for `prompt`: the controller's button on a controller, where it has
 * one; else the key's name.
 */
export function glyphOf(prompt: Prompt, source: GlyphSource): string {
  if (source.device === 'pad') {
    const button = padButtonOf(prompt, source.pad);
    if (button !== null) {
      return PAD_GLYPHS[source.family][button];
    }
  }
  return keyName(keyOf(prompt, source.keys));
}

/**
 * Which buttons the prompts name: the kind the settings choose (Steuerung, „Controller-Symbole"),
 * or — „Automatisch" — the kind the controller used last reports itself as (`reported`).
 */
export function familyOf(choice: GlyphChoice, reported: PadFamily): PadFamily {
  return choice === 'auto' ? reported : choice;
}

/** What the glyphs depend on now: the bindings, the device used last, its symbols as chosen. */
function sourceOf(
  settings: { keys: KeyBindings; pad: PadBindings; glyphs: GlyphChoice },
  used: { device: InputDevice; family: PadFamily },
): GlyphSource {
  const { keys, pad, glyphs } = settings;
  return { keys, pad, device: used.device, family: familyOf(glyphs, used.family) };
}

/** The glyph for `prompt` now, by the settings and the device used last: for drawn text. */
export function glyph(prompt: Prompt): string {
  return glyphOf(prompt, sourceOf(getSettings(), inputDevice()));
}

/** What the glyphs depend on, kept up to date with the settings and the device used last. */
export function useGlyphSource(): GlyphSource {
  return sourceOf(useSettings(), useInputDevice());
}

/** The glyph for `prompt`, kept up to date with the settings and the device used last. */
export function useGlyph(prompt: Prompt): string {
  return glyphOf(prompt, useGlyphSource());
}

/** Whether a controller was used last: then prompts name its buttons, touch screen or not. */
export function usePadUsed(): boolean {
  return useInputDevice().device === 'pad';
}

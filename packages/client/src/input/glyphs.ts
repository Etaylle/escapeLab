import { getSettings, useSettings } from '../settings.js';
import { keyName, type InputAction, type KeyBindings, type PadBindings } from './bindings.js';
import { inputDevice, useInputDevice, type InputDevice } from './device.js';
import { PAD_GLYPHS, type PadButton, type PadFamily } from './pad.js';

/**
 * What every prompt names a control by: the key bound to it, or — where a controller was used
 * last — its button as the controller prints it. No prompt names a key of its own; a test reads
 * every screen's text for one.
 */

/**
 * What a prompt asks for: an action, or one of the steps every screen shares — stepping back
 * (Esc), putting a sheet down, skipping the opening, turning a book's page.
 */
export type Prompt = InputAction | 'close' | 'putDown' | 'skip' | 'pageBack' | 'pageOn';

/** What the glyph depends on: the bindings, and the device used last. */
export interface GlyphSource {
  keys: KeyBindings;
  pad: PadBindings;
  device: InputDevice;
  family: PadFamily;
}

/** The fixed buttons of a controller, by what they do. */
const PAD_FIXED: Readonly<Partial<Record<Prompt, PadButton>>> = {
  up: 'dup',
  down: 'ddown',
  left: 'dleft',
  right: 'dright',
  sprint: 'r1',
  talk: 'l1',
  info: 'select',
  pageBack: 'dleft',
  pageOn: 'dright',
};

/** The controller's button for `prompt`; none where the controller has none (the quick chat). */
function padButtonOf(prompt: Prompt, pad: PadBindings): PadButton | null {
  switch (prompt) {
    case 'interact':
    case 'skip':
      return pad.interact;
    case 'drop':
    case 'close':
    case 'putDown':
      return pad.drop;
    case 'notes':
    case 'minimap':
      return pad[prompt];
    default:
      return PAD_FIXED[prompt] ?? null;
  }
}

/**
 * The key for `prompt` under `keys`: the shared steps' keys whatever is bound — Esc steps back,
 * Space skips, the arrows turn a page — and a sheet is put down with the key that works things.
 */
function keyOf(prompt: Prompt, keys: KeyBindings): string {
  switch (prompt) {
    case 'putDown':
      return keys.interact;
    case 'close':
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

/** The glyph for `prompt` now, by the settings and the device used last: for drawn text. */
export function glyph(prompt: Prompt): string {
  const { keys, pad } = getSettings();
  return glyphOf(prompt, { keys, pad, ...inputDevice() });
}

/** The glyph for `prompt`, kept up to date with the settings and the device used last. */
export function useGlyph(prompt: Prompt): string {
  const { keys, pad } = useSettings();
  const { device, family } = useInputDevice();
  return glyphOf(prompt, { keys, pad, device, family });
}

/** Whether a controller was used last: then prompts name its buttons, touch screen or not. */
export function usePadUsed(): boolean {
  return useInputDevice().device === 'pad';
}

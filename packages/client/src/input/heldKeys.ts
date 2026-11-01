import { keyPlace, type Held } from './bindings.js';

/** A key going down or up, as far as holding cares: where it sits, and its name. */
type KeyAt = Pick<KeyboardEvent, 'code' | 'key'>;

/**
 * The keys held down for a step or the sprint, each by where it sits (`keyPlace`): a key is let
 * go where it went down, whatever Shift or a new binding made of its name meanwhile, and an
 * action two keys hold (W and ↑) stays held until both are up.
 */
export class HeldKeys {
  private readonly byPlace = new Map<string, Held>();

  /** The key `e` went down holding `action`. */
  press(e: KeyAt, action: Held): void {
    this.byPlace.set(keyPlace(e), action);
  }

  /** The key `e` came up: the action it held, where no other key holds it still; else null. */
  release(e: KeyAt): Held | null {
    const place = keyPlace(e);
    const action = this.byPlace.get(place);
    if (action === undefined) {
      return null;
    }
    this.byPlace.delete(place);
    return [...this.byPlace.values()].includes(action) ? null : action;
  }

  /** Every key let go at once: the window lost, where no key comes back up. */
  clear(): void {
    this.byPlace.clear();
  }
}

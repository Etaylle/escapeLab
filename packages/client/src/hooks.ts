import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
} from 'react';
import { serverNow } from './clock.js';

/** The wall clock, read again every `intervalMs`. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/**
 * The server's clock as this page reads it (clock.ts), read again every `intervalMs`: what
 * counts down to a moment the server set counts by it.
 */
export function useServerNow(intervalMs: number): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** A text field has the keyboard: keys type there and steer nothing else. */
export function typing(): boolean {
  const el = document.activeElement;
  return el !== null && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/** The prompts holding the keyboard now, one token each. */
const claims = new Set<symbol>();

/**
 * A prompt holds the keyboard while it is up — the Serverraum's terminal: every printable key
 * typed goes there wherever the focus is, the talk key with them (voice/useVoice.ts). Returns
 * what lets go of it again.
 */
export function claimKeys(): () => void {
  const claim = Symbol('prompt');
  claims.add(claim);
  return () => {
    claims.delete(claim);
  };
}

/** Whether a prompt holds the keyboard now (`claimKeys`). */
export function keysClaimed(): boolean {
  return claims.size > 0;
}

/**
 * Calls `onKey` with the key, lower-cased, when one of `keys` goes down —
 * not while typing, not on auto-repeat, not with a modifier the browser owns.
 */
export function useKeys(keys: readonly string[], onKey: (key: string) => void): void {
  const handler = useRef(onKey);
  handler.current = onKey;
  const wanted = keys.join(' ');
  useEffect(() => {
    const listened = new Set(wanted.split(' '));
    const onDown = (e: KeyboardEvent): void => {
      const key = e.key.toLowerCase();
      if (!listened.has(key) || e.altKey || e.ctrlKey || e.metaKey || typing()) {
        return;
      }
      // The key is the game's, auto-repeat too: F5 bound to the notepad reloads nothing.
      e.preventDefault();
      if (!e.repeat) {
        handler.current(key);
      }
    };
    window.addEventListener('keydown', onDown);
    return () => window.removeEventListener('keydown', onDown);
  }, [wanted]);
}

/** Whether the window matches a media query, kept up to date; false without a window. */
export function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** How far a swipe has to travel, in CSS px, and how much more sideways than up or down. */
const SWIPE_PX = 40;
const SWIPE_SLANT = 1.5;

/**
 * Pointer handlers that read a horizontal swipe as a page turn: towards the
 * left is forwards (1), towards the right back (-1). Taps and vertical drags
 * turn nothing.
 */
export function useSwipe(onSwipe: (dir: 1 | -1) => void): {
  onPointerDown: (e: PointerEvent) => void;
  onPointerUp: (e: PointerEvent) => void;
  onPointerCancel: () => void;
} {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (e) => {
      start.current = { x: e.clientX, y: e.clientY };
    },
    onPointerUp: (e) => {
      const from = start.current;
      start.current = null;
      if (from === null) {
        return;
      }
      const dx = e.clientX - from.x;
      const dy = e.clientY - from.y;
      if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > SWIPE_SLANT * Math.abs(dy)) {
        onSwipe(dx < 0 ? 1 : -1);
      }
    },
    onPointerCancel: () => {
      start.current = null;
    },
  };
}

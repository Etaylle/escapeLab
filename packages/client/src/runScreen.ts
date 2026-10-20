import { useEffect } from 'react';
import { useMedia } from './hooks.js';

/**
 * A phone's screen while a run is on: all of it, sideways, and awake.
 *
 * Browsers grant fullscreen only inside a gesture, so the run's first touch
 * asks for it — for the whole page, not the stage alone: the station panels,
 * the book, the HUD and the overlays lie beside `.stage`, and a fullscreen
 * element shows nothing outside itself. Once fullscreen, the screen locks to
 * landscape where the browser can. A wake lock keeps the screen on until the
 * run ends or the page hides, and comes back with the page. Every part is
 * optional: iPhones have no fullscreen, desktops no orientation lock, a
 * battery saver refuses the wake lock — and the run plays the same.
 */

/** What decides whether a tap takes the page fullscreen. */
export interface FullscreenCheck {
  /** a run is on: phase playing, map present */
  running: boolean;
  /** the main pointer is a finger, as on a phone */
  coarsePointer: boolean;
  /** this tap is a touch, not a mouse or pen */
  touch: boolean;
  /** the browser lets the page go fullscreen at all */
  fullscreenEnabled: boolean;
  /** something is fullscreen already */
  fullscreen: boolean;
  /** this run asked once since the page last came into view: who left fullscreen stays out */
  asked: boolean;
}

/** Whether this tap should ask for fullscreen now. */
export function shouldGoFullscreen(check: FullscreenCheck): boolean {
  return (
    check.running &&
    check.coarsePointer &&
    check.touch &&
    check.fullscreenEnabled &&
    !check.fullscreen &&
    !check.asked
  );
}

/** What a refused request leaves behind: nothing, see the module's comment. */
function refused(): undefined {
  return undefined;
}

/** Whether anything is fullscreen; a browser without the API leaves the property undefined. */
function fullscreenNow(): boolean {
  return (document.fullscreenElement ?? null) !== null;
}

/** lib.dom lost `lock` (only some browsers have it), so it is declared here. */
interface LockableOrientation {
  lock?: (orientation: 'landscape') => Promise<void>;
  unlock(): void;
}

/** The landscape lock of one run: `lock` where the browser can, `release` undoes only that. */
function landscape(): { lock: () => void; release: () => void } {
  const orientation = (screen as { orientation?: LockableOrientation }).orientation;
  let held = false;
  let over = false;
  return {
    lock: () => {
      if (orientation?.lock === undefined) {
        return;
      }
      orientation.lock('landscape').then(() => {
        held = true;
        // The run may have ended while the lock was on its way.
        if (over) {
          orientation.unlock();
        }
      }, refused);
    },
    release: () => {
      over = true;
      if (held) {
        orientation?.unlock();
      }
    },
  };
}

/** Keeps the screen on while the page shows, until `release`. */
function keepAwake(): { release: () => void } {
  let sentinel: WakeLockSentinel | null = null;
  let over = false;
  const acquire = (): void => {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') {
      return;
    }
    navigator.wakeLock.request('screen').then((granted) => {
      if (over) {
        granted.release().catch(refused);
      } else {
        sentinel = granted;
      }
    }, refused);
  };
  const drop = (): void => {
    sentinel?.release().catch(refused);
    sentinel = null;
  };
  // The browser drops the lock when the page hides; it is ours to take again.
  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') {
      acquire();
    } else {
      drop();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  acquire();
  return {
    release: () => {
      over = true;
      document.removeEventListener('visibilitychange', onVisibility);
      drop();
    },
  };
}

/**
 * Fullscreen on the run's first touch, landscape, and the screen kept on,
 * while `running` on a coarse pointer. Leaving the page (another app, the
 * lock screen) ends fullscreen without asking, so the first touch after the
 * page shows again asks once more.
 */
export function useRunScreen(running: boolean): void {
  const coarsePointer = useMedia('(pointer: coarse)');
  useEffect(() => {
    if (!running || !coarsePointer) {
      return undefined;
    }
    const turn = landscape();
    const awake = keepAwake();
    let asked = false;
    const onTap = (event: PointerEvent): void => {
      const check: FullscreenCheck = {
        running,
        coarsePointer,
        touch: event.pointerType === 'touch',
        // Undefined, not false, where the browser lacks the API altogether.
        fullscreenEnabled: document.fullscreenEnabled === true,
        fullscreen: fullscreenNow(),
        asked,
      };
      if (shouldGoFullscreen(check)) {
        asked = true;
        const page = document.documentElement;
        page.requestFullscreen({ navigationUI: 'hide' }).then(turn.lock, refused);
      }
    };
    const onShow = (): void => {
      if (document.visibilityState === 'visible') {
        asked = false;
      }
    };
    // Still fullscreen from the run before: only the lock is missing.
    if (fullscreenNow()) {
      turn.lock();
    }
    window.addEventListener('pointerup', onTap, true);
    document.addEventListener('visibilitychange', onShow);
    return () => {
      window.removeEventListener('pointerup', onTap, true);
      document.removeEventListener('visibilitychange', onShow);
      awake.release();
      turn.release();
    };
  }, [running, coarsePointer]);
}

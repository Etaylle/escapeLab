import { useEffect } from 'react';
import { useMedia } from './hooks.js';

/**
 * A phone's screen for a run: all of it, sideways, and awake.
 *
 * Browsers grant fullscreen only inside a gesture. The lobby's start or ready
 * press asks for it (`fullscreenForRun`), so the run opens fullscreen; the
 * run's first touch asks where that did not happen — a reload mid-run, a
 * press by mouse. The whole page goes fullscreen, not the stage alone: the
 * station panels, the book, the HUD and the overlays lie beside `.stage`, and
 * a fullscreen element shows nothing outside itself. Once a run is on and the
 * page fullscreen, the screen locks to landscape where the browser can; the
 * lobby stays as the phone is held. A wake lock keeps the screen on until the
 * run ends or the page hides, and comes back with the page.
 *
 * Fullscreen and the orientation lock work over plain http, the way the game
 * is played on a LAN (in Android's browsers; iPhones have neither). The wake
 * lock needs a secure origin and is simply absent over http. Every part is
 * optional, and a refusal stays quiet: the run plays the same.
 */

/** The main pointer is a finger: the media query the stylesheets show the touch pad by. */
const COARSE = '(pointer: coarse)';

/** What decides whether a gesture takes the page fullscreen. */
export interface FullscreenCheck {
  /** the gesture belongs to a run: the lobby's start or ready press, or a touch during one */
  forRun: boolean;
  /** the main pointer is a finger, as on a phone */
  coarsePointer: boolean;
  /** the gesture came from a finger, not a mouse or pen */
  touch: boolean;
  /** the browser lets the page go fullscreen at all */
  fullscreenEnabled: boolean;
  /** something is fullscreen already */
  fullscreen: boolean;
  /** asked already since the run began or the page came back: who left fullscreen stays out */
  asked: boolean;
}

/** Whether this gesture should ask for fullscreen now. */
export function shouldGoFullscreen(check: FullscreenCheck): boolean {
  return (
    check.forRun &&
    check.coarsePointer &&
    check.touch &&
    check.fullscreenEnabled &&
    !check.fullscreen &&
    !check.asked
  );
}

/** Whether a gesture — a click, a pointer let go — came from a finger on the screen. */
export function touchOf(gesture: object): boolean {
  return 'pointerType' in gesture && gesture.pointerType === 'touch';
}

/** What a refused request leaves behind: nothing, see the module's comment. */
function refused(): undefined {
  return undefined;
}

/** Whether anything is fullscreen; a browser without the API leaves the property undefined. */
function fullscreenNow(): boolean {
  return (document.fullscreenElement ?? null) !== null;
}

/** The check for `gesture`, with the document's fullscreen as it is now. */
function checkFor(
  gesture: object,
  run: Pick<FullscreenCheck, 'forRun' | 'coarsePointer' | 'asked'>,
): FullscreenCheck {
  return {
    ...run,
    touch: touchOf(gesture),
    // Undefined, not false, where the browser lacks the API altogether.
    fullscreenEnabled: document.fullscreenEnabled === true,
    fullscreen: fullscreenNow(),
  };
}

/** The whole page fullscreen, the browser's bars hidden; true once granted. */
function goFullscreen(): Promise<boolean> {
  return document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(
    () => true,
    () => false,
  );
}

/**
 * The lobby's start or ready press: on a phone, the run it leads into opens
 * fullscreen. Landscape waits for the run (`useRunScreen`). A press by mouse,
 * or where the browser has no fullscreen, changes nothing.
 *
 * @param press the click's native event, which tells a finger from a mouse
 */
export function fullscreenForRun(press: object): void {
  const coarsePointer = window.matchMedia(COARSE).matches;
  if (shouldGoFullscreen(checkFor(press, { forRun: true, coarsePointer, asked: false }))) {
    void goFullscreen();
  }
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

/** Keeps the screen on while the page shows, until `release`; nothing over plain http. */
function keepAwake(): { release: () => void } {
  let sentinel: WakeLockSentinel | null = null;
  let over = false;
  const acquire = (): void => {
    // Only a secure origin has `navigator.wakeLock`.
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
 * While `running` on a coarse pointer: landscape where the page is
 * fullscreen, fullscreen on the run's first touch where it is not, and the
 * screen kept on. Leaving the page (another app, the lock screen) ends
 * fullscreen without asking, so the first touch after it shows again asks
 * once more.
 */
export function useRunScreen(running: boolean): void {
  const coarsePointer = useMedia(COARSE);
  useEffect(() => {
    if (!running || !coarsePointer) {
      return undefined;
    }
    const turn = landscape();
    const awake = keepAwake();
    let asked = false;
    const onTap = (event: PointerEvent): void => {
      if (shouldGoFullscreen(checkFor(event, { forRun: running, coarsePointer, asked }))) {
        asked = true;
        goFullscreen().then((granted) => {
          if (granted) {
            turn.lock();
          }
        });
      }
    };
    const onShow = (): void => {
      if (document.visibilityState === 'visible') {
        asked = false;
      }
    };
    // Fullscreen since the lobby's press, or the run before: only the lock is missing.
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

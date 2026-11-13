/**
 * The menu's scene at work (world/menu/scene.ts): an animation loop that draws it no more than
 * 30 times a second while it shows and moves, and not at all while it does not show — its tab
 * hidden, or its canvas out of the window, as under the Bestenliste — or stands still, its
 * still drawn under reduced motion. Every animation frame's length is told to `record`, for
 * the walkthrough's frame window (frameTrace.ts), a frame drawn or not.
 */

/** The shortest the scene goes between two drawings, ms: no more than 30 a second. */
export const SCENE_FRAME_MS = 1000 / 30;
/** A frame of a 60 Hz screen may come this much early and still count as the next. */
const FRAME_SLACK_MS = 1;

/** What the scene's loop needs of the page; the scene hands it the browser's. */
export interface SceneHost {
  /** asks for the next animation frame, as requestAnimationFrame does */
  frame: (run: (now: number) => void) => number;
  cancel: (handle: number) => void;
  /**
   * reports whether the scene shows — its tab shown and its canvas in the window — now and on
   * every change; returns the stop
   */
  watch: (seen: (shown: boolean) => void) => () => void;
}

/** The scene's loop at work: what starts it again once it has stood still, and its end. */
export interface SceneLoop {
  /** asks for frames again — a lab baked, the motion changed — wherever the scene shows */
  wake(): void;
  stop(): void;
}

/**
 * Runs the scene: while it shows, an animation loop calls `paint` no more than 30 times a
 * second and tells `record` how long each frame took. `paint` says whether anything still
 * moves: once nothing does — no lab yet, or its still drawn under reduced motion — the loop
 * asks no more frames until it is woken. Hidden, the loop stops too, and starts again when
 * the scene shows; the time hidden or still is not counted as a frame.
 */
export function runScene(
  paint: (now: number) => boolean,
  host: SceneHost,
  record: (ms: number) => void = () => undefined,
): SceneLoop {
  let handle: number | null = null;
  let shown = false;
  let last = Number.NEGATIVE_INFINITY;
  let prev: number | null = null;
  const start = (): void => {
    if (shown && handle === null) {
      handle = host.frame(tick);
    }
  };
  const tick = (now: number): void => {
    handle = null;
    if (prev !== null) {
      record(now - prev);
    }
    prev = now;
    const due = now - last >= SCENE_FRAME_MS - FRAME_SLACK_MS;
    if (due) {
      last = now;
    }
    if (!due || paint(now)) {
      start();
    }
    if (handle === null) {
      prev = null;
    }
  };
  const halt = (): void => {
    if (handle !== null) {
      host.cancel(handle);
      handle = null;
    }
    prev = null;
  };
  const unwatch = host.watch((seen) => {
    shown = seen;
    if (seen) {
      start();
    } else {
      halt();
    }
  });
  return {
    wake: start,
    stop: () => {
      unwatch();
      shown = false;
      halt();
    },
  };
}

/**
 * The browser's frames, and whether the scene shows: its document not hidden, and `canvas` in
 * the window (an IntersectionObserver; shown where there is none to ask).
 */
export function browserSceneHost(canvas: HTMLCanvasElement): SceneHost {
  return {
    frame: (run) => requestAnimationFrame(run),
    cancel: (handle) => cancelAnimationFrame(handle),
    watch: (seen) => {
      let inView = true;
      const tell = (): void => seen(inView && document.visibilityState !== 'hidden');
      const observer =
        typeof IntersectionObserver === 'undefined'
          ? null
          : new IntersectionObserver((entries) => {
              inView = entries.at(-1)?.isIntersecting === true;
              tell();
            });
      observer?.observe(canvas);
      document.addEventListener('visibilitychange', tell);
      tell();
      return () => {
        observer?.disconnect();
        document.removeEventListener('visibilitychange', tell);
      };
    },
  };
}

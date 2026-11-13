/**
 * The menu's scene at work (world/menu/scene.ts): an animation loop that draws it no more than
 * 30 times a second while it shows, and not at all while it does not — its tab hidden, or its
 * canvas out of the window, as under the Bestenliste. Every animation frame's length is told
 * to `record`, for the walkthrough's frame window (frameTrace.ts), a frame drawn or not.
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

/**
 * Runs the scene: while it shows, an animation loop calls `paint` no more than 30 times a
 * second and tells `record` how long each frame took; hidden, the loop stops, and it starts
 * again when the scene shows, the time hidden not counted as a frame. Returns what stops it
 * for good.
 */
export function runScene(
  paint: (now: number) => void,
  host: SceneHost,
  record: (ms: number) => void = () => undefined,
): () => void {
  let handle: number | null = null;
  let last = Number.NEGATIVE_INFINITY;
  let prev: number | null = null;
  const tick = (now: number): void => {
    handle = host.frame(tick);
    if (prev !== null) {
      record(now - prev);
    }
    prev = now;
    if (now - last >= SCENE_FRAME_MS - FRAME_SLACK_MS) {
      last = now;
      paint(now);
    }
  };
  const halt = (): void => {
    if (handle !== null) {
      host.cancel(handle);
      handle = null;
    }
    prev = null;
  };
  const unwatch = host.watch((shown) => {
    if (!shown) {
      halt();
    } else if (handle === null) {
      handle = host.frame(tick);
    }
  });
  return () => {
    unwatch();
    halt();
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

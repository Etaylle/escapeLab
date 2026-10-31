/**
 * The camera leaning in on a station: as its panel opens over the world the
 * camera zooms in PANEL_ZOOM times over ZOOM_MS, eased out, and back out as
 * the panel shuts — from wherever it stood, should the panel shut before the
 * zoom was done. Under reduced motion the zoom is a cut. Pure: the frame's
 * assembly keeps the zoom from frame to frame (assemble.ts `aim`).
 */

/** How far the camera zooms in on a station whose panel is open. */
export const PANEL_ZOOM = 1.08;
/** How long the zoom takes, in or out, ms. */
export const ZOOM_MS = 200;

/** The zoom under way: from what, to what, since when (ms on the clock the caller keeps). */
export interface Zoom {
  from: number;
  to: number;
  since: number;
}

/** No zoom: the camera as it frames the world without a panel. */
export const NO_ZOOM: Zoom = { from: 1, to: 1, since: -Infinity };

/** A move `u` of the way along (0 to 1), eased out: quick to start, settling softly. */
export function easeOut(u: number): number {
  const t = Math.min(1, Math.max(0, u));
  return 1 - (1 - t) ** 3;
}

/** The zoom `zoom` stands at `now`: all the way where reduced motion asks for a cut. */
export function zoomAt(zoom: Zoom, now: number, reduced: boolean): number {
  if (reduced) {
    return zoom.to;
  }
  return zoom.from + (zoom.to - zoom.from) * easeOut((now - zoom.since) / ZOOM_MS);
}

/**
 * The zoom with a panel open or not (`open`) at `now`: the one under way while it heads that
 * way already, else a new one from where the camera stands now.
 */
export function zoomToward(zoom: Zoom, open: boolean, now: number, reduced: boolean): Zoom {
  const to = open ? PANEL_ZOOM : 1;
  if (zoom.to === to) {
    return zoom;
  }
  return { from: zoomAt(zoom, now, reduced), to, since: now };
}

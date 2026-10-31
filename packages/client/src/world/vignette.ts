/**
 * The red edge of the clock's last minute and of the whole escape: an element over the
 * world's canvas and under everything else on it (GameWorld.tsx RedEdge), an inset glow that
 * breathes by its opacity alone (finale.css), which the compositor does without painting
 * anything anew. Measured on a software compositor (`SHOTS_SOFTWARE_GL`), such an edge costs
 * nothing once nothing on the page blurs what lies behind it — no stage screen may
 * (css.test.ts) — where the same edge blended into the canvas every frame cost the escape a
 * frame step on a slowed machine. It breathes with the pressure (`vignettePressure`): calmly
 * as the last minute begins, quicker in its last twenty seconds, quickest through the escape.
 */

/** The edge comes up this long before the deadline, ms. */
const LAST_MINUTE_MS = 60_000;
/** The last stretch of the clock, where the edge breathes quicker, ms. */
const LAST_STRETCH_MS = 20_000;

/** How hard the red edge breathes: the last minute, its last stretch, the escape. */
export type VignettePressure = 'minute' | 'stretch' | 'escape';

/**
 * Whether the red edge shows: in the clock's last minute and all through
 * the escape (`escaping`) — never on a run without a clock, and no more once
 * the run's end plays on this screen (`ending`).
 */
export function vignetteShown(
  deadlineAt: number | null,
  now: number,
  escaping: boolean,
  ending: boolean,
): boolean {
  return !ending && deadlineAt !== null && (escaping || deadlineAt - now < LAST_MINUTE_MS);
}

/**
 * How hard the red edge breathes at `now`, where it shows (vignetteShown): through the
 * escape hardest, in the clock's last LAST_STRETCH_MS harder, else as the last minute begins;
 * null where it does not show.
 */
export function vignettePressure(
  deadlineAt: number | null,
  now: number,
  escaping: boolean,
  ending: boolean,
): VignettePressure | null {
  if (!vignetteShown(deadlineAt, now, escaping, ending) || deadlineAt === null) {
    return null;
  }
  if (escaping) {
    return 'escape';
  }
  return deadlineAt - now < LAST_STRETCH_MS ? 'stretch' : 'minute';
}

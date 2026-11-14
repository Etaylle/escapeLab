/**
 * The walkthrough's timing checks, judged by what each page recorded on its own clock rather
 * than by when the walkthrough looked (tools/shots.mjs): under load a screenshot or a read comes
 * late, while what the page drew and when it drew it stays the game's. Pure.
 */

/**
 * What a page noted of the meter's needle held mid-swing (shots.mjs `holdNeedle`), ms on its
 * clock from the hold's start: when the probe went down, when the swing began — its own start
 * time — and how long the swing runs; null for what never came.
 *
 * @typedef {{ pressed: number | null, swung: number | null, length: number | null }} NeedleHold
 */

/**
 * The verdict on meter-swing.png: the needle, standing at `from` (°) as a reading came in that
 * turns it to `target`, swung — the page held its swing `holdMs` into it (`hold`, null where the
 * page kept none) — and was read at `at` before the shot and `after` it. It has to have swung,
 * held still through the shot and stood on its way there, or swinging past it. Its faults, and
 * the log's words: when the swing began after the probe on the page's clock, and where it stood.
 *
 * @param {{ from: number, target: number, at: number, after: number,
 *   hold: NeedleHold | null, holdMs: number }} swing
 * @returns {{ faults: string[], text: string }}
 */
export function swingVerdict({ from, target, at, after, hold, holdMs }) {
  const way = `from ${from}° to ${target.toFixed(1)}°`;
  if (hold?.swung == null) {
    return {
      faults: [`the needle never swung ${way}: no turn ran on it`],
      text: `!! the needle at ${at}°, no swing ${way}`,
    };
  }
  const moved = Math.abs(after - at) > 0.5;
  const onItsWay = Math.abs(at - from) > 1 && Math.abs(at - target) > 1;
  const faults = [
    moved ? `the needle moved under the shot, from ${at}° to ${after}°` : null,
    onItsWay ? null : `the needle stood at ${at}°, not on its way ${way}`,
  ].filter((fault) => fault !== null);
  return { faults, text: swingText({ hold, holdMs, way, at, after, moved, onItsWay }) };
}

/** A held swing in the log's words (swingVerdict). */
function swingText({ hold, holdMs, way, at, after, moved, onItsWay }) {
  const began =
    hold.pressed === null
      ? `${Math.round(hold.swung)} ms into the hold, no probe seen`
      : `${Math.round(hold.swung - hold.pressed)} ms after the probe`;
  return (
    `its ${Math.round(hold.length ?? 0)}-ms swing began ${began} on the page's clock; held ` +
    `${holdMs} ms in, the needle at ${at}° on its way ${way}` +
    (moved ? ` — !! ${after}° once shot` : '') +
    (onItsWay ? '' : ' — !! not swinging')
  );
}

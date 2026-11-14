/**
 * The walkthrough's timing checks, judged by what each page recorded on its own clock rather
 * than by when the walkthrough looked (tools/shots.mjs): under load a screenshot or a read comes
 * late, while what the page drew and when it drew it stays the game's. Pure.
 */

/**
 * What a page's strip watch noted at a sync station (shots.mjs `watchStrip`), ms on the page's
 * clock from the watch's start: when the strip first showed the station done, and when the
 * page's own press went down; null for what never came.
 *
 * @typedef {{ done: number | null, pressed: number | null }} StripSeen
 */

/**
 * The verdict on a sync station's strip, as each player's page noted it (`seen` null where the
 * page kept no watch): who saw it stand still, and when each page showed the station done after
 * its own press, in the log's words — „Anna 48 ms after the press, Ben never".
 *
 * @param {Array<{ name: string, seen: StripSeen | null }>} pages
 * @returns {{ stuck: string[], text: string }}
 */
export function stripVerdict(pages) {
  const stuck = pages.filter(({ seen }) => seen?.done == null).map(({ name }) => name);
  const text = pages.map(({ name, seen }) => `${name} ${stripText(seen)}`).join(', ');
  return { stuck, text };
}

/** When one page's strip showed the station done, in words (stripVerdict). */
function stripText(seen) {
  if (seen?.done == null) {
    return 'never';
  }
  return seen.pressed === null
    ? `${Math.round(seen.done)} ms into the watch, no press seen`
    : `${Math.round(seen.done - seen.pressed)} ms after the press`;
}

/**
 * What a page noted of the meter's needle held mid-swing (shots.mjs `holdNeedle`), ms on its
 * clock from the hold's start: when the probe went down, when the swing began — its turn's style
 * changing after the press, so never before it — and how long the swing runs; null for what
 * never came.
 *
 * @typedef {{ pressed: number | null, swung: number | null, length: number | null }} NeedleHold
 */

/**
 * The verdict on meter-swing.png: the needle, standing at `from` (°) as a reading came in that
 * turns it to `target`, swung — the page held its swing `holdMs` into it (`hold`, null where the
 * page kept none) — and was read at `at` before the shot and `after` it. It has to have swung,
 * held still through the shot and stood on its way there, or swinging past it. Its faults, and
 * the log's words: when the swing began after the probe, on the page's clock, and where it
 * stood.
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
  const began = Math.round(hold.swung - hold.pressed);
  return (
    `its ${Math.round(hold.length ?? 0)}-ms swing began ${began} ms after the probe, on the ` +
    `page's clock; held ${holdMs} ms in, the needle at ${at}° on its way ${way}` +
    (moved ? ` — !! ${after}° once shot` : '') +
    (onItsWay ? '' : ' — !! not swinging')
  );
}

/**
 * Whether a figure held in `pose` for its shot (shots.mjs `figureShot`) — `found` as the page
 * held it, `after` as the figures' probe gave it once shot, null where it was gone — still
 * stood so: in the pose, its `mood` and its `key` `least` or more either way, and as held, no
 * frame having moved it under the shot.
 *
 * @param {{ mood: string, rise: number, glance: number }} found
 * @param {{ mood: string, rise: number, glance: number } | null} after
 * @param {{ mood: string, key: 'rise' | 'glance', least: number }} pose
 * @returns {boolean}
 */
export function figureHeld(found, after, { mood, key, least }) {
  return (
    after !== null &&
    after.mood === mood &&
    Math.abs(after[key]) >= least &&
    after[key] === found[key]
  );
}

/**
 * Whether your figure's walk held in `stride` for its shot (shots.mjs `strideShot`) — `held` as
 * the page held it, `after` as the graphics probe gave it once shot, null without one — still
 * stood there: walking, its phase `from` to `to`, and as held, no frame having moved it.
 *
 * @param {{ phase: number, moving: boolean }} held
 * @param {{ phase: number, moving: boolean } | null} after
 * @param {{ from: number, to: number }} stride
 * @returns {boolean}
 */
export function strideHeld(held, after, { from, to }) {
  return (
    after !== null &&
    after.moving &&
    after.phase >= from &&
    after.phase <= to &&
    after.phase === held.phase
  );
}

/**
 * Why no nudge of the Leitstelle's is left to wait for at the station that is up, or null where
 * one is: the run's `events` (the view's log, server time) since the station came up — the last
 * solve, or `startedAt` before the first — hold a nudge for each of the `lines` the mission gives
 * it (null: not known, so one is waited for). A walkthrough slowed by load lets the station stand
 * quiet long enough on its way there for every one to go out; the reason names when each came.
 *
 * @param {Array<{ at: number, kind: string }>} events
 * @param {number | null} lines
 * @param {number} startedAt
 * @returns {string | null}
 */
export function nudgesSpent(events, lines, startedAt) {
  const solves = events.filter((event) => event.kind === 'puzzle').map((event) => event.at);
  const since = solves.length === 0 ? startedAt : Math.max(...solves);
  const given = events.filter((event) => event.kind === 'nudge' && event.at >= since);
  if (lines === null || given.length < lines) {
    return null;
  }
  const times = given.map((nudge) => `${((nudge.at - since) / 1000).toFixed(1)} s`).join(' and ');
  return (
    `the Leitstelle's ${lines} lines on the station up all came before the walkthrough waited, ` +
    `${times} after it came up: none left to shoot`
  );
}

/**
 * What a phone showed of its open device (shots.mjs `deviceReach`): how far it scrolls, px; its
 * controls shown; those under a fingertip's 44 px either way and those cut off, in words.
 *
 * @typedef {{ scroll: number, controls: number, small: string[], cut: string[] }} DeviceSeen
 */

/**
 * The verdict on a device a phone shows sideways (`seen`, measured once its animations ended or
 * the wait ran out — `settled`, shots.mjs `deviceSettled`: how long it waited on the page's
 * clock, and the animations still running then): no control shown, a device that scrolls, a
 * control under 44 px or cut off is a fault. Where animations still ran, a control measured
 * short is not judged — the panel's rise may still have scaled it — and why names the wait.
 *
 * @param {DeviceSeen} seen
 * @param {{ waited: number, still: string[] }} settled
 * @returns {{ faults: string[], unjudged: string | null }}
 */
export function deviceVerdict(seen, settled) {
  const rising = settled.still.length > 0;
  const faults = [
    seen.controls === 0 ? 'no control shown' : null,
    seen.scroll > 1 ? `it scrolls ${seen.scroll}px` : null,
    seen.small.length > 0 && !rising ? `${seen.small.join(', ')} under 44 px` : null,
    seen.cut.length > 0 ? `${seen.cut.join(', ')} cut off` : null,
  ].filter((fault) => fault !== null);
  return { faults, unjudged: rising ? shortUnjudged(seen.small, settled) : null };
}

/** Why controls measured short while the device still moved go unjudged; null for none. */
function shortUnjudged(small, { waited, still }) {
  return small.length === 0
    ? null
    : `${small.join(', ')} measured under 44 px while ${still.join(', ')} still ran, ` +
        `${waited} ms into the wait on the page's clock: not judged`;
}

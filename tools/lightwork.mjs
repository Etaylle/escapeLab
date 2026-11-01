/**
 * The walkthrough's line on what the world's light worked out anew over a window of frames —
 * the sights taken and the bakes made, as the page's census counts them
 * (`window.__escapelab.lightWork`, client world/render/census.ts). A lamp on the move takes a
 * sight a frame — the host's own as it paces, each drone's as it flies — and nothing is baked
 * while the light holds still: a window that bakes, or takes more sights than it has lamps on
 * the move, shows here in CI's log before it shows in the frames.
 */

/**
 * The census of a window as text: sights a frame by percentile, how many in all over how many
 * frames drawn, and the bakes made.
 *
 * @param {{ frames: number, sights: { p50: number, p95: number, max: number, total: number },
 *   bakes: number } | null} work the page's census for the window; null for a page without one
 * @returns {string} the line's text
 */
export function lightWorkText(work) {
  if (work === null || work === undefined) {
    return '!! no census: the page keeps none under ?trace=1';
  }
  const { frames, sights, bakes } = work;
  return (
    `sights a frame p50 ${sights.p50} · p95 ${sights.p95} · max ${sights.max} ` +
    `(${sights.total} over ${frames} frames drawn); bakes ${bakes}`
  );
}

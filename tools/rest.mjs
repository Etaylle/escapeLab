/**
 * When the Paketfilter drill's second wave meets its emergency (tools/shots.mjs `heldForRest`):
 * pure, for the harness and its test.
 */

/** How soon after the held second wave runs again its emergency is to fall, s. */
export const REST_LEAD_S = 2;
/**
 * How far into the second wave its emergency may fall, by the wave's own clock, s: its first
 * packets on the lines, the wave far from its end (each packet falls ten seconds).
 */
export const REST_INTO_WAVE_S = 12;

/**
 * Whether the second wave, `elapsedS` into its run with the emergency `dueS` away, has to be
 * held — its Sperrpult's player stepping off — for `holdS` s, so that the emergency falls
 * REST_LEAD_S after it runs again; or runs on, the emergency falling `intoS` into it — also
 * where it is no further off than the lead, as no hold brings it sooner.
 */
export function restTiming(elapsedS, dueS, into = REST_INTO_WAVE_S) {
  const intoS = elapsedS + dueS;
  if (intoS <= into || dueS <= REST_LEAD_S) {
    return { hold: false, intoS, holdS: 0 };
  }
  return { hold: true, intoS, holdS: dueS - REST_LEAD_S };
}

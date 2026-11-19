/**
 * How far a Serverraum has come through a plan's moves, read from its terminal's log alone: the
 * walkthrough asks after an emergency cut the station short (shots.mjs `playServerraum`), since
 * the station is back with what was done at it — a move sent as the emergency came may have
 * been taken or not, and only the station knows.
 */

/**
 * The line a move of an alarm-free plan leaves in the terminal's log (core servers.ts): a
 * switch thrown at the rack, a start, a restart.
 */
export function lineOfMove({ input }) {
  if ('power' in input) {
    return `${input.power}: Strom ${input.on ? 'an' : 'aus'}`;
  }
  return input.cmd === 'restart' ? `${input.service} neu gestartet` : `${input.service} läuft`;
}

/**
 * How many of `moves`, from the first on, the station has taken, by its `log` — the last lines
 * of it, each with its count `n` from 1 over the whole run. Lines no move leaves (a crash) are
 * passed over. A log still whole says it outright; one cut at its head has to end on one run
 * of the plan's lines alone, or this throws, naming what it saw: nothing is guessed.
 */
export function movesTaken(moves, log) {
  const planned = moves.map(lineOfMove);
  const seen = log.map((line) => line.text).filter((text) => planned.includes(text));
  const fits = (taken) => seen.every((text, i) => planned[taken - seen.length + i] === text);
  const whole = log.length === 0 || log[0].n === 1;
  const counts = whole
    ? [seen.length]
    : planned.map((_, i) => i + 1).filter((taken) => taken >= seen.length);
  const possible = counts.filter(fits);
  if (possible.length !== 1) {
    throw new Error(
      `the log (${seen.join(' | ') || 'no line of the plan'}) fits ${possible.length} places ` +
        `in the plan (${planned.join(' | ')})`,
    );
  }
  return possible[0];
}

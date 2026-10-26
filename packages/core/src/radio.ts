import type { Mission } from './mission.js';

/**
 * When mission control is heard: over the lab's loudspeakers while the intro keeps the power
 * on (`pa`), then on the radio — as the clock starts, while a station stays quiet, as it is
 * solved, as the hatch unlocks.
 */
export type RadioMoment = 'pa' | 'start' | 'nudge' | 'solved' | 'escape';

/** One line mission control can say, and when. */
export interface RadioLine {
  readonly text: string;
  readonly when: RadioMoment;
  /** the station a nudge or a solve's line belongs to; null for the others */
  readonly puzzleId: string | null;
}

/**
 * Every line mission control can say in `mission`, in the order a run hears them: the intro's
 * announcement over the loudspeakers (`intro.pa`, played by each screen while the power is
 * on), then on the air `radio.start` as the clock starts (actions.ts, `logRadio`), for each
 * station the nudges `nudge` sends while it stays quiet and the line its solve brings, and
 * `radio.escape` as the hatch unlocks. A line said twice is listed twice.
 */
export function radioLines(mission: Mission): RadioLine[] {
  const { start, escape } = mission.radio;
  const lines: RadioLine[] = (mission.intro?.pa ?? []).map((text) => ({
    text,
    when: 'pa',
    puzzleId: null,
  }));
  if (start !== undefined) {
    lines.push({ text: start, when: 'start', puzzleId: null });
  }
  for (const puzzle of mission.puzzles) {
    for (const text of puzzle.nudges) {
      lines.push({ text, when: 'nudge', puzzleId: puzzle.id });
    }
    if (puzzle.onSolved !== undefined) {
      lines.push({ text: puzzle.onSolved, when: 'solved', puzzleId: puzzle.id });
    }
  }
  if (escape !== undefined) {
    lines.push({ text: escape, when: 'escape', puzzleId: null });
  }
  return lines;
}

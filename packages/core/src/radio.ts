import type { Mission } from './mission.js';

/**
 * When a line comes over the air: as the clock starts, while a station stays quiet, as it is
 * solved, as the hatch unlocks.
 */
export type RadioMoment = 'start' | 'nudge' | 'solved' | 'escape';

/** One line mission control can put on the air, and when. */
export interface RadioLine {
  readonly text: string;
  readonly when: RadioMoment;
  /** the station a nudge or a solve's line belongs to; null for the start and the escape */
  readonly puzzleId: string | null;
}

/**
 * Every line mission control can put on the air in `mission`, in the order a run hears them:
 * `radio.start` as the clock starts (actions.ts, `logRadio`), then for each station the nudges
 * `nudge` sends while it stays quiet and the line its solve brings, and `radio.escape` as the
 * hatch unlocks. A line said twice is listed twice.
 */
export function radioLines(mission: Mission): RadioLine[] {
  const { start, escape } = mission.radio;
  const lines: RadioLine[] = [];
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

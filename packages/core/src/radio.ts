import type { Mission } from './mission.js';

/**
 * When a line is heard: over the lab's loudspeakers while the intro keeps the power on (`pa`),
 * then on the radio — as the clock starts, while a station stays quiet, as it is solved, as the
 * hatch unlocks — and over the loudspeakers again, on their emergency power, as an emergency
 * starts (`announce`).
 */
export const RADIO_MOMENTS = ['pa', 'start', 'nudge', 'solved', 'escape', 'announce'] as const;
export type RadioMoment = (typeof RADIO_MOMENTS)[number];

/**
 * Who says a line: the plant's announcement system over its loudspeakers (`pa`), a building's
 * voice, or mission control's operator on the radio (`operator`), a person on the night shift.
 */
export type Speaker = 'pa' | 'operator';

/** The moments the plant's loudspeakers speak at; the operator speaks at every other. */
const PA_MOMENTS: ReadonlySet<RadioMoment> = new Set(['pa', 'announce']);

/** Who speaks at `moment`. */
export function speakerOf(moment: RadioMoment): Speaker {
  return PA_MOMENTS.has(moment) ? 'pa' : 'operator';
}

/** One line that can be heard in a run: what it says, when, and who says it. */
export interface RadioLine {
  readonly text: string;
  readonly when: RadioMoment;
  /** the station a nudge or a solve's line belongs to; null for the others */
  readonly puzzleId: string | null;
  readonly speaker: Speaker;
}

/** The line `text` heard at `when`, said by whoever speaks then. */
const lineOf = (text: string, when: RadioMoment, puzzleId: string | null = null): RadioLine => ({
  text,
  when,
  puzzleId,
  speaker: speakerOf(when),
});

/**
 * Every line that can be heard in `mission`, in the order a run hears them: the intro's
 * announcement over the loudspeakers (`intro.pa`, played by each screen while the power is
 * on), then on the air `radio.start` as the clock starts (actions.ts, `logRadio`), for each
 * station the nudges `nudge` sends while it stays quiet and the line its solve brings, and
 * `radio.escape` as the hatch unlocks; then what answers the run as it goes, whenever it
 * comes: the loudspeakers' message as an emergency starts (`map.sabotage.announce`). A line
 * said twice is listed twice.
 */
export function radioLines(mission: Mission): RadioLine[] {
  const { start, escape } = mission.radio;
  const lines = (mission.intro?.pa ?? []).map((text) => lineOf(text, 'pa'));
  if (start !== undefined) {
    lines.push(lineOf(start, 'start'));
  }
  for (const puzzle of mission.puzzles) {
    lines.push(...puzzle.nudges.map((text) => lineOf(text, 'nudge', puzzle.id)));
    if (puzzle.onSolved !== undefined) {
      lines.push(lineOf(puzzle.onSolved, 'solved', puzzle.id));
    }
  }
  if (escape !== undefined) {
    lines.push(lineOf(escape, 'escape'));
  }
  const announce = mission.map.sabotage?.announce;
  if (announce !== undefined) {
    lines.push(lineOf(announce, 'announce'));
  }
  return lines;
}

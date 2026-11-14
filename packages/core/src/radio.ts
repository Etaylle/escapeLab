import type { Mission } from './mission.js';

/**
 * When a line is heard: over the lab's loudspeakers while the intro keeps the power on (`pa`),
 * then on the radio — as the clock starts, while a station stays quiet, as it is solved, as the
 * hatch unlocks — and over the loudspeakers again, on their emergency power, as an emergency
 * starts (`announce`). The operator answers what the run does besides: an emergency as it
 * starts and as it ends, cleared in time or missed; the run's first alarm; the clock, with five
 * minutes, two and one left; and the run's end, won or lost, which the end card plays.
 */
export const RADIO_MOMENTS = [
  'pa',
  'start',
  'nudge',
  'solved',
  'escape',
  'announce',
  'emergency',
  'cleared',
  'missed',
  'alarm',
  'clock',
  'won',
  'lost',
] as const;
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

/** The clock's calls, the earliest first: the mission's line for each, and the time left then, s. */
export const CLOCK_CALLS = [
  { key: 'fiveMinutes', sec: 300 },
  { key: 'twoMinutes', sec: 120 },
  { key: 'lastMinute', sec: 60 },
] as const;

/**
 * How late a call may still be made, ms: a call the clock passed by more — a penalty jumped it
 * past, or a room was taken up again after it — goes unsaid, and never twice.
 */
export const CLOCK_LATE_MS = 15_000;

/** A run won, by the time it left: five minutes or more, a minute or more, less. */
export const WON_BANDS = ['plenty', 'tight', 'lastMinute'] as const;
export type WonBand = (typeof WON_BANDS)[number];

/** The band of a run won with `leftMs` on the clock. */
export function wonBand(leftMs: number): WonBand {
  if (leftMs >= 300_000) {
    return 'plenty';
  }
  return leftMs >= 60_000 ? 'tight' : 'lastMinute';
}

/** What lost a run: its time ran out, its alarms reached the limit, or it was called off. */
export const LOST_CAUSES = ['time', 'alarms', 'abandoned'] as const;
export type LostCause = (typeof LOST_CAUSES)[number];

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

/** The lines of `said` the mission has, each heard at its moment, in their order. */
const linesOf = (said: readonly (readonly [string | undefined, RadioMoment])[]): RadioLine[] =>
  said.flatMap(([text, when]) => (text === undefined ? [] : [lineOf(text, when)]));

/**
 * The run's story as it is heard: the intro's announcement over the loudspeakers, the start,
 * for each station its nudges and the line its solve brings, the escape.
 */
function storyLines(mission: Mission): RadioLine[] {
  const pa = (mission.intro?.pa ?? []).map((text) => lineOf(text, 'pa'));
  const stations = mission.puzzles.flatMap((puzzle) => [
    ...puzzle.nudges.map((text) => lineOf(text, 'nudge', puzzle.id)),
    ...(puzzle.onSolved === undefined ? [] : [lineOf(puzzle.onSolved, 'solved', puzzle.id)]),
  ]);
  const { start, escape } = mission.radio;
  return [...pa, ...linesOf([[start, 'start']]), ...stations, ...linesOf([[escape, 'escape']])];
}

/**
 * What answers the run as it goes, whenever it comes: the loudspeakers' message as an emergency
 * starts and the operator's line on it, its end cleared and missed, the first alarm, the
 * clock's calls, and the last word on a run won, by its time left, and lost, by its cause.
 */
function answerLines(mission: Mission): RadioLine[] {
  const { emergency, alarm, clock, won, lost } = mission.radio;
  return linesOf([
    [mission.map.sabotage?.announce, 'announce'],
    [emergency?.start, 'emergency'],
    [emergency?.cleared, 'cleared'],
    [emergency?.missed, 'missed'],
    [alarm, 'alarm'],
    ...CLOCK_CALLS.map(({ key }) => [clock?.[key], 'clock'] as const),
    ...WON_BANDS.map((band) => [won?.[band], 'won'] as const),
    ...LOST_CAUSES.map((cause) => [lost?.[cause], 'lost'] as const),
  ]);
}

/**
 * Every line that can be heard in `mission`: the run's story in the order a run hears it — the
 * intro's announcement over the loudspeakers (`intro.pa`, played by each screen while the power
 * is on), then on the air `radio.start` as the clock starts (actions.ts, `logRadio`), for each
 * station the nudges `nudge` sends while it stays quiet and the line its solve brings, and
 * `radio.escape` as the hatch unlocks — then what answers the run as it goes (`answerLines`). A
 * line said twice is listed twice.
 */
export function radioLines(mission: Mission): RadioLine[] {
  return [...storyLines(mission), ...answerLines(mission)];
}

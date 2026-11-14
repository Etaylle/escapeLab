import { z } from 'zod';
import type { Mission } from './mission.js';
import { mulberry32 } from './rng.js';

/**
 * A line as a mission writes it: one text, or two or three to choose from, so that a run hears
 * one take and a rematch most often another (`pickLine`). Each text is its own recording.
 */
export type Line = string | readonly string[];

/** A line in a mission file: a text, or a list of two or three, none of them empty. */
export const lineSchema = z.union([z.string().min(1), z.array(z.string().min(1)).min(2).max(3)]);

/** Every text `line` may say, in its order. */
export function variantsOf(line: Line): readonly string[] {
  return typeof line === 'string' ? [line] : line;
}

/**
 * The text a run says of `line` at `key` — its place in the mission: `solved:<station>`,
 * `clock:lastMinute`, … — the `occurrence`-th time it comes in the run (an emergency's lines
 * come once for each emergency): the first from the run's `seed` and the key, an FNV-1a hash of
 * it mixed into the seed, so that one seed always picks the same and another most often other
 * takes; each later occurrence the next text in turn, so that a run repeats none before it must.
 */
export function pickLine(line: Line, seed: number, key: string, occurrence = 0): string {
  const texts = variantsOf(line);
  let hash = 0x811c9dc5;
  for (const char of key) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  const first = Math.floor(mulberry32((seed ^ hash) >>> 0)() * texts.length);
  return texts[(first + occurrence) % texts.length] ?? '';
}

/**
 * When a line is heard: over the lab's loudspeakers while the intro keeps the power on (`pa`),
 * then on the radio — as the clock starts, while a station stays quiet, as it is solved, as the
 * hatch unlocks — and over the loudspeakers again, on their emergency power, as an emergency
 * starts (`announce`). The operator answers what the run does besides: an emergency as it
 * starts and as it ends, cleared in time or missed; the run's first alarm; the clock, with five
 * minutes, two and one left; and the run's end, won or lost, which the end card plays. Before
 * a run, in the lobby, the operator makes a radio check once the whole crew stands ready
 * (`lobby`, the Funkprobe).
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
  'lobby',
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

/**
 * How the operator says a line, by the moment it comes at: the run's first alarm and an emergency
 * missed tense, the clock pressing, an emergency urgent as it starts and relieved as it is
 * cleared, a run won warm and a run lost quiet, the lobby's Funkprobe calm. The run's story — the
 * start, the stations, the escape — and the plant's loudspeakers have none: they speak as they
 * always spoke. The voice script asks ElevenLabs for a mood by an audio tag beside the words
 * (scripts/voice.ts `MOOD_TAGS`), never in the words a subtitle shows.
 */
export const MOODS = {
  alarm: 'tense',
  clock: 'pressing',
  emergency: 'urgent',
  cleared: 'relieved',
  missed: 'tense',
  won: 'warm',
  lost: 'quiet',
  lobby: 'calm',
} as const satisfies Partial<Record<RadioMoment, string>>;
export type Mood = (typeof MOODS)[keyof typeof MOODS];

/** How the operator says a line at `moment` (MOODS); null where it has no mood of its own. */
export function moodOf(moment: RadioMoment): Mood | null {
  return (MOODS as Partial<Record<RadioMoment, Mood>>)[moment] ?? null;
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

/** One line that can be heard in a run: what it says, when, who says it, and how. */
export interface RadioLine {
  readonly text: string;
  readonly when: RadioMoment;
  /** the station a nudge or a solve's line belongs to; null for the others */
  readonly puzzleId: string | null;
  readonly speaker: Speaker;
  /** how the operator says it (MOODS); null for a line said as every line was */
  readonly mood: Mood | null;
}

/**
 * Every text of `line` heard at `when`, each said by whoever speaks then, as the moment wants it
 * said, and each its own recording; none where the mission has no such line.
 */
const textsOf = (
  line: Line | undefined,
  when: RadioMoment,
  puzzleId: string | null = null,
): RadioLine[] =>
  line === undefined
    ? []
    : variantsOf(line).map((text) => ({
        text,
        when,
        puzzleId,
        speaker: speakerOf(when),
        mood: moodOf(when),
      }));

/** Every text of the lines of `said` the mission has, each heard at its moment, in their order. */
const linesOf = (said: readonly (readonly [Line | undefined, RadioMoment])[]): RadioLine[] =>
  said.flatMap(([line, when]) => textsOf(line, when));

/**
 * The run's story as it is heard: the intro's announcement over the loudspeakers, the start,
 * for each station its nudges and the line its solve brings, the escape.
 */
function storyLines(mission: Mission): RadioLine[] {
  const pa = (mission.intro?.pa ?? []).flatMap((text) => textsOf(text, 'pa'));
  const stations = mission.puzzles.flatMap((puzzle) => [
    ...puzzle.nudges.flatMap((line) => textsOf(line, 'nudge', puzzle.id)),
    ...textsOf(puzzle.onSolved, 'solved', puzzle.id),
  ]);
  const { start, escape } = mission.radio;
  return [...pa, ...textsOf(start, 'start'), ...stations, ...textsOf(escape, 'escape')];
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
 * `radio.escape` as the hatch unlocks — then what answers the run as it goes (`answerLines`),
 * and last the lobby's Funkprobe before a run (`radio.lobby`, view.ts `radioCheck`). Every text
 * of a line with several is listed, in its order, as the run may pick any (`pickLine`); a line
 * said twice is listed twice.
 */
export function radioLines(mission: Mission): RadioLine[] {
  const lobby = textsOf(mission.radio.lobby, 'lobby');
  return [...storyLines(mission), ...answerLines(mission), ...lobby];
}

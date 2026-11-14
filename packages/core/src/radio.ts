import { z } from 'zod';
import type { Mission } from './mission.js';
import { pickOf } from './rng.js';

/**
 * A line as a mission writes it: one text, or two or three to choose from, so that a run hears
 * one take and a rematch most often another (`pickLine`). Each text is its own recording, and
 * may carry ElevenLabs' audio tags for its delivery (`shownText`).
 */
export type Line = string | readonly string[];

/**
 * An audio tag in a line as written: a direction in square brackets — „[sighs]", „[exhales]" —
 * that the voice script hands ElevenLabs with the words and that nobody reads (`shownText`).
 */
const AUDIO_TAG = /\s*\[[^[\]]+\]\s*/g;

/** Punctuation that closes up to the word before it, where a tag stood between them. */
const CLOSING = /^[,.!?;:]/;

/**
 * A line as it is shown and spoken of — on the objective bar, in the Einsatzprotokoll, in the
 * lobby — its audio tags taken out with the space around them: a tag at either end leaves
 * nothing, one between two words a single space, one before a comma or a stop none. The
 * recording is found by this text, said by whoever speaks it; only its render hears the tags.
 */
export function shownText(text: string): string {
  const spaced = text.replace(AUDIO_TAG, (tag: string, at: number, whole: string) => {
    const rest = whole.slice(at + tag.length);
    return at === 0 || rest === '' || CLOSING.test(rest) ? '' : ' ';
  });
  return spaced.replace(/ {2,}/g, ' ').trim();
}

/** A text of a line: something to say once its audio tags are taken out. */
const textSchema = z
  .string()
  .min(1)
  .refine((text) => shownText(text) !== '', 'Ein Funkspruch nur aus Regieanweisungen sagt nichts.');

/** A line in a mission file: a text, or a list of two or three, none of them empty. */
export const lineSchema = z.union([textSchema, z.array(textSchema).min(2).max(3)]);

/** Every text `line` may say, in its order. */
export function variantsOf(line: Line): readonly string[] {
  return typeof line === 'string' ? [line] : line;
}

/**
 * The text a run says of `line` at `key` — its place in the mission: `solved:<station>`,
 * `clock:lastMinute`, … — the `occurrence`-th time it comes in the run (an emergency's lines
 * come once for each emergency): the first from the run's `seed` and the key (rng.ts `pickOf`),
 * so that one seed always picks the same and another most often other takes; each later
 * occurrence the next text in turn, so that a run repeats none before it must. As written, its
 * audio tags with it.
 */
export function pickLine(line: Line, seed: number, key: string, occurrence = 0): string {
  return pickOf(variantsOf(line), seed, key, occurrence) ?? '';
}

/**
 * When a line is heard: over the lab's loudspeakers while the intro keeps the power on (`pa`),
 * then on the radio — as the clock starts, while a station stays quiet, as it is solved, as the
 * hatch unlocks — and over the loudspeakers again, on their emergency power, as an emergency
 * starts (`announce`). The radio answers what the run does besides: an emergency as it starts
 * and as it ends, cleared in time or missed; the run's first alarm; the clock, with five
 * minutes, two and one left; and the run's end, won or lost, which the end card plays. Before
 * a run, in the lobby, the Leitstelle makes a radio check once the whole crew stands ready
 * (`lobby`, the Funkprobe). Who speaks at each: `roleOf`.
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
 * Who says a line, as a part of the cast (cast.ts): the plant's announcement system over its
 * loudspeakers (`pa`), a building's voice; the Leitstelle on duty on the radio (`operator`), a
 * person on the night shift; or the Schichtleitung (`lead`), a second voice that cuts in on the
 * radio when it gets serious.
 */
export const ROLES = ['pa', 'operator', 'lead'] as const;
export type Role = (typeof ROLES)[number];

/**
 * Who speaks at each moment: the loudspeakers the announcement and the plant's message on an
 * emergency; the Schichtleitung the clock's calls and the last word on a run lost; the
 * Leitstelle every other line — the story, the nudges, the answers, the debriefing of a run won
 * and the lobby's Funkprobe.
 */
const ROLE_AT: Readonly<Record<RadioMoment, Role>> = {
  pa: 'pa',
  start: 'operator',
  nudge: 'operator',
  solved: 'operator',
  escape: 'operator',
  announce: 'pa',
  emergency: 'operator',
  cleared: 'operator',
  missed: 'operator',
  alarm: 'operator',
  clock: 'lead',
  won: 'operator',
  lost: 'lead',
  lobby: 'operator',
};

/** The role that speaks at `moment`. */
export function roleOf(moment: RadioMoment): Role {
  return ROLE_AT[moment];
}

/**
 * Who said a line in a run: the role, and the person of the night's cast who fills it
 * (cast.ts `castOf`) — by their id in the roster, never their voice.
 */
export interface Speaker {
  readonly role: Role;
  readonly person: string;
}

/**
 * How a line on the radio is said, by the moment it comes at: the run's first alarm and an
 * emergency missed tense, the clock pressing, an emergency urgent as it starts and relieved as
 * it is cleared, a run won warm and a run lost quiet, the lobby's Funkprobe calm — whoever of
 * the cast says it. The run's story — the start, the stations, the escape — and the plant's
 * loudspeakers have none: they speak as they always spoke. The voice script asks ElevenLabs for
 * a mood by an audio tag beside the words (scripts/voice.ts `MOOD_TAGS`), never in the words a
 * subtitle shows.
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

/** How a line at `moment` is said (MOODS); null where it has no mood of its own. */
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

/**
 * One line that can be heard in a run: what it says — as shown, its audio tags taken out — when,
 * which role says it, and how.
 */
export interface RadioLine {
  readonly text: string;
  readonly when: RadioMoment;
  /** the station a nudge or a solve's line belongs to; null for the others */
  readonly puzzleId: string | null;
  readonly role: Role;
  /** how it is said (MOODS); null for a line said as every line was */
  readonly mood: Mood | null;
}

/**
 * Every text of `line` heard at `when`, each as shown, said by the role that speaks then, as the
 * moment wants it said, and each its own recording; none where the mission has no such line.
 */
const textsOf = (
  line: Line | undefined,
  when: RadioMoment,
  puzzleId: string | null = null,
): RadioLine[] =>
  line === undefined
    ? []
    : variantsOf(line).map((text) => ({
        text: shownText(text),
        when,
        puzzleId,
        role: roleOf(when),
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

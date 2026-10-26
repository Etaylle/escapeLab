import { FLICKER_MS } from '../coldOpen.js';
import { smooth } from '../ease.js';

/**
 * The run's opening on one screen, as a small state machine on this screen's clock. Pure: every
 * moment follows from when the sequence began here, when this player skipped it and when the
 * view with the lights out arrived.
 *
 * A mission with an intro (Blackout):
 *
 *   0–1.5 s     card   black, and the location card: the plant, the wing, the shift and its time
 *   1.5 s on    shot   the world fades in with the power on between two black bars; the camera
 *                      runs slowly from the reactor end to this player's spawn while the plant's
 *                      loudspeakers make their announcement (pa.ts), subtitled in the lower bar,
 *                      which offers the skip: Space, or a tap
 *   skipped     free   the camera back on the avatar, the bars gone, the lit lab to walk in; the
 *                      announcement goes on as the room's sound until the lights fail. The skip
 *                      the crew's last watcher makes puts the lights out at once: that film runs
 *                      on to meet them, and cuts to the beat as they go
 *   lights out  beat   the shot cuts to the spawn, the breaker's thunk, the lights die and the
 *                      title lands on that frame: it holds 1.5 s and dissolves, the bars retract
 *                      and control returns. A player who had skipped sees the lights fail as ever
 *                      (coldOpen.ts) and the title land at the bang.
 *
 * A mission without one shows the card with the mission's name as its title, 2.5 s or until
 * skipped; nothing else changes. Under reduced motion nothing pans and nothing slides: the
 * camera stays on the spawn, the bars and the title fade in and out (intro.css).
 */

/** The location card on black, ms from the start of the sequence on this screen. */
export const CARD_MS = 1500;
/** The card of a mission without an intro: its name, then the run as ever. */
export const NAME_CARD_MS = 2500;
/** How long the card takes to come up, and to go again before its end, ms. */
export const CARD_FADE_MS = 250;
/** The world fades in with the power on after the card, over this long. */
export const FADE_IN_MS = 1000;
/** The shot comes to rest on the spawn this long before the lights are due to fail. */
export const SHOT_HOLD_MS = 3000;
/** The shortest the shot runs, however soon the lights are due. */
export const MIN_PAN_MS = 4000;
/** The bars slide in and out over this long (intro.css). */
export const BARS_MS = 400;
/**
 * How long the film runs on after the skip that ends the intro for the whole crew, ms, to meet
 * the lights going out; where they have not gone by then, it was a skip like any other.
 */
export const CLOSING_MS = 1500;
/** The title holds this long from the bang … */
export const TITLE_HOLD_MS = 1500;
/** … then dissolves over this long. */
export const TITLE_FADE_MS = 700;
/** The announcement's first line starts here, ms into the sequence: the lab has faded in. */
export const PA_FROM_MS = 3000;
/** The pause between two lines of the announcement. */
export const PA_GAP_MS = 800;
/** A line without a recording yet is timed at this many ms a word. */
export const PA_PACE_MS = 450;
/** A sentence's subtitle stays this long after its line has ended. */
export const SUBTITLE_LINGER_MS = 400;
/**
 * The lights fail by themselves this long past the length of the whole announcement: with the
 * card, the fade and the pauses before it, that falls into the last line, which the blackout
 * cuts off (missions/blackout.json `intro.lightsSec`).
 */
export const LIGHTS_AFTER_SPEECH_MS = 4000;

/** Where the opening stands on this screen (see the module's comment). */
export type IntroPhase = 'card' | 'shot' | 'free' | 'beat' | 'done';

/** The opening as this screen lives it: everything else follows from these four. */
export interface IntroCue {
  /** when the sequence began on this screen, epoch ms by its own clock */
  readonly since: number;
  /** seconds until the lights fail by themselves; null for a mission's name card alone */
  readonly lightsSec: number | null;
  /** when this player skipped it, epoch ms; null while watching */
  readonly skippedAt: number | null;
  /** whether that skip was the last the crew present needed: the lights go out on it */
  readonly closing: boolean;
  /** when the view with the lights out arrived on this screen, epoch ms; null while they burn */
  readonly outAt: number | null;
}

/**
 * Whether the shot was still running here when the lights went out — never skipped, or the
 * skip that put them out (CLOSING_MS): then it cuts.
 */
export function cutIn(cue: IntroCue): boolean {
  const { outAt, skippedAt } = cue;
  if (outAt === null) {
    return false;
  }
  return (
    skippedAt === null || skippedAt > outAt || (cue.closing && outAt - skippedAt <= CLOSING_MS)
  );
}

/** Whether a skip that ended the intro still waits for the lights to go out at `now`. */
function closingAt(cue: IntroCue, now: number): boolean {
  return cue.closing && cue.skippedAt !== null && now < cue.skippedAt + CLOSING_MS;
}

/**
 * The bang on this screen, epoch ms: as the lights-out arrives where the shot ran, after the
 * flicker of the lights failing as ever for a player who had skipped; null while they burn.
 */
export function bangAt(cue: IntroCue): number | null {
  if (cue.outAt === null || cue.lightsSec === null) {
    return null;
  }
  return cutIn(cue) ? cue.outAt : cue.outAt + FLICKER_MS;
}

/** Where the opening stands at `now` (epoch ms). */
export function introPhase(cue: IntroCue, now: number): IntroPhase {
  if (cue.lightsSec === null) {
    return cue.skippedAt === null && now < cue.since + NAME_CARD_MS ? 'card' : 'done';
  }
  const bang = bangAt(cue);
  if (bang !== null) {
    return cutIn(cue) && now < bang + TITLE_HOLD_MS + BARS_MS ? 'beat' : 'done';
  }
  if (cue.skippedAt !== null && !closingAt(cue, now)) {
    return 'free';
  }
  return now < cue.since + CARD_MS ? 'card' : 'shot';
}

/** Whether the phase belongs to a mission's intro playing as a film: card, shot or beat. */
function filming(cue: IntroCue, phase: IntroPhase): boolean {
  return cue.lightsSec !== null && (phase === 'card' || phase === 'shot' || phase === 'beat');
}

/**
 * Whether this screen shows the world as a film at `now`: no HUD over it, no minimap, no marks,
 * nobody of the crew moving it — the card, the shot and the beat of a mission's intro.
 */
export function filmed(cue: IntroCue, now: number): boolean {
  return filming(cue, introPhase(cue, now));
}

/** Whether the lab shows lit whole: through the card and the shot, before anybody has skipped. */
export function litWhole(cue: IntroCue, now: number): boolean {
  const phase = introPhase(cue, now);
  return cue.lightsSec !== null && (phase === 'card' || phase === 'shot');
}

/**
 * Where the shot stands at `now`: 0 at the reactor end, 1 on the spawn, eased — reaching it
 * SHOT_HOLD_MS before the lights are due; null where the camera follows the avatar. Under
 * reduced motion it never pans: it stands on the spawn.
 */
export function shotProgress(cue: IntroCue, now: number, reduced: boolean): number | null {
  const phase = introPhase(cue, now);
  if (cue.lightsSec === null || (phase !== 'card' && phase !== 'shot')) {
    return null;
  }
  if (reduced) {
    return 1;
  }
  const pan = Math.max(MIN_PAN_MS, cue.lightsSec * 1000 - CARD_MS - SHOT_HOLD_MS);
  return smooth((now - cue.since - CARD_MS) / pan);
}

/** How much of the location card shows at `now`, 0 to 1: up over CARD_FADE_MS, gone by its end. */
export function cardAt(cue: IntroCue, now: number): number {
  if (introPhase(cue, now) !== 'card') {
    return 0;
  }
  const length = cue.lightsSec === null ? NAME_CARD_MS : CARD_MS;
  const t = now - cue.since;
  return Math.max(0, Math.min(1, t / CARD_FADE_MS, (length - t) / CARD_FADE_MS));
}

/** How far black covers the world at `now`: whole through the card, lifting over FADE_IN_MS. */
export function blackAt(cue: IntroCue, now: number): number {
  const phase = introPhase(cue, now);
  if (phase === 'card') {
    return 1;
  }
  if (phase !== 'shot') {
    return 0;
  }
  return Math.min(1, Math.max(0, 1 - (now - cue.since - CARD_MS) / FADE_IN_MS));
}

/** Whether the bars stand in the picture: through the card, the shot and the beat's title. */
export function barsIn(cue: IntroCue, now: number): boolean {
  const phase = introPhase(cue, now);
  if (phase === 'beat') {
    const bang = bangAt(cue);
    return bang !== null && now < bang + TITLE_HOLD_MS;
  }
  return filming(cue, phase);
}

/** Whether the lower bar offers the skip: through the shot, from the card's end, 1.5 s in. */
export function hintShown(cue: IntroCue, now: number): boolean {
  return introPhase(cue, now) === 'shot' && cue.skippedAt === null;
}

/** Whether Space or a tap skips at `now`: in the shot of an intro, on a mission's name card. */
export function skippable(cue: IntroCue, now: number): boolean {
  const phase = introPhase(cue, now);
  return cue.lightsSec === null ? phase === 'card' : hintShown(cue, now);
}

/** How much of the title shows at `now`, 0 to 1: whole from the bang, dissolving after its hold. */
export function titleAt(cue: IntroCue, now: number): number {
  const bang = bangAt(cue);
  if (bang === null || now < bang) {
    return 0;
  }
  const past = now - bang - TITLE_HOLD_MS;
  return past <= 0 ? 1 : Math.max(0, 1 - past / TITLE_FADE_MS);
}

/**
 * The next moment after `now` at which the opening changes by itself — a phase, the black, the
 * bars, the title — epoch ms; null once nothing more will. A screen draws its DOM anew then.
 */
export function nextChange(cue: IntroCue, now: number): number | null {
  const bang = bangAt(cue);
  const moments =
    cue.lightsSec === null
      ? [cue.since + NAME_CARD_MS]
      : [
          cue.since + CARD_MS,
          cue.since + CARD_MS + FADE_IN_MS,
          ...(cue.skippedAt === null ? [] : [cue.skippedAt + BARS_MS]),
          ...(cue.closing && cue.skippedAt !== null ? [cue.skippedAt + CLOSING_MS] : []),
          ...(bang === null
            ? []
            : [
                bang,
                bang + TITLE_HOLD_MS,
                bang + TITLE_HOLD_MS + BARS_MS,
                bang + TITLE_HOLD_MS + TITLE_FADE_MS,
              ]),
        ];
  const ahead = moments.filter((at) => at > now);
  return ahead.length === 0 ? null : Math.min(...ahead);
}

/** A line of the announcement in its place: what it says, from when and how long, ms. */
export interface ScheduledLine {
  readonly text: string;
  /** ms into the sequence */
  readonly at: number;
  readonly ms: number;
}

const wordsIn = (text: string): number =>
  text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

/**
 * The announcement laid out on the sequence's clock: the first line PA_FROM_MS in, each next
 * PA_GAP_MS after the one before has ended. A line is as long as its recording (`ms`, from the
 * voice manifest), or PA_PACE_MS a word while it has none.
 */
export function paSchedule(lines: readonly { text: string; ms: number | null }[]): ScheduledLine[] {
  let at = PA_FROM_MS;
  return lines.map(({ text, ms }) => {
    const length = ms ?? wordsIn(text) * PA_PACE_MS;
    const line = { text, at, ms: length };
    at += length + PA_GAP_MS;
    return line;
  });
}

/**
 * The subtitle `msIn` ms into the sequence: the sentence of the line being said, a line's time
 * shared among its sentences by their length, the last one kept SUBTITLE_LINGER_MS; null
 * between lines.
 */
export function subtitleAt(schedule: readonly ScheduledLine[], msIn: number): string | null {
  const line = schedule.find(
    (each) => msIn >= each.at && msIn < each.at + each.ms + SUBTITLE_LINGER_MS,
  );
  if (line === undefined) {
    return null;
  }
  const sentences = line.text.split(/(?<=[.!?])\s+/);
  const total = sentences.reduce((sum, sentence) => sum + sentence.length, 0);
  let end = line.at;
  for (const sentence of sentences) {
    end += (line.ms * sentence.length) / total;
    if (msIn < end) {
      return sentence;
    }
  }
  return sentences.at(-1) ?? null;
}

/**
 * When the lights fail by themselves for an announcement of lines `ms` long, s: the whole of it
 * and LIGHTS_AFTER_SPEECH_MS, to a tenth — `intro.lightsSec` of the mission that says it.
 */
export function lightsSecFor(ms: readonly number[]): number {
  const speech = ms.reduce((sum, each) => sum + each, 0);
  return Math.round((speech + LIGHTS_AFTER_SPEECH_MS) / 100) / 10;
}

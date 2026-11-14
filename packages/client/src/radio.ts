import {
  inService,
  NUDGED,
  personOf,
  roleOf,
  speakingFor,
  type RadioMoment,
  type Role,
  type RunEvent,
  type Speaker,
} from '@escapelab/core';
import type { VoiceLine } from './world/radioVoice.js';

/**
 * How long a line stays on the air at least — a line spoken longer stays while it speaks
 * (`noticeMs`); the banner's fade is set to match (ui.css, Game.tsx).
 */
export const BANNER_MS = 7000;
/** The same on a touch screen, where the bar covers more of a small world. */
export const BANNER_MS_COARSE = 4000;
/**
 * How long the plant's message stays up at least, on any screen: a few words of a building
 * system, read at a glance, which the operator's line after it does not wait 7 s for.
 */
export const PA_BANNER_MS = 3000;
/** How long the note that the sign was read stays up; its fade in ui.css matches. */
export const SIGN_NOTE_MS = 3500;

/**
 * Lines older than this are history, not news: a reconnect or a late join
 * must not replay what the crew heard a while ago.
 */
export const NEWS_MS = 10_000;

/** A revealed note goes on the air under the last shift's name, not mission control's. */
export const LAST_SHIFT = 'Notiz der letzten Schicht';

/** What the run report and the radio strip call the plant's message over its loudspeakers. */
export const ANNOUNCED = 'Durchsage';

/**
 * Whether a line is the plant's: its loudspeakers' message on their emergency power, as an
 * emergency starts (core radio.ts `roleOf`).
 */
export function fromPlant(event: RunEvent): boolean {
  return event.kind === 'radio' && event.moment !== undefined && roleOf(event.moment) === 'pa';
}

/**
 * Whether a line is mission control's: a scripted one, or one it sent unasked because the
 * station that is up stayed quiet (a nudge).
 */
export function fromControl(event: RunEvent): boolean {
  return (event.kind === 'radio' || event.kind === 'nudge') && !fromPlant(event);
}

/**
 * Who says a line on the air: the role and the person its event names (core cast.ts
 * `speakerAt`); a line of a run kept before the cast, the role that speaks it now and its first
 * person in service — Helmut, who said them then, while the Schichtleitung has no voice.
 */
export function speakerOf(event: RunEvent): Speaker {
  if (event.speaker !== undefined) return event.speaker;
  const role = speakingFor(event.moment === undefined ? 'operator' : roleOf(event.moment));
  return { role, person: inService(role)[0]?.id ?? '' };
}

/** A line on the air as the voice is asked for it: its words, said by whoever says them. */
export function voiceLineOf(event: RunEvent): VoiceLine {
  return { text: event.label, person: speakerOf(event).person };
}

/**
 * Whether a line is the last word on a run, won or lost: the end card says it after its sting
 * (world/endTheme.ts), never the objective bar.
 */
export function endsRun(event: RunEvent): boolean {
  return event.moment === 'won' || event.moment === 'lost';
}

/**
 * What goes on the air: mission control's lines, the plant's, and the notes the crew revealed —
 * but the last word on the run, which the end card has.
 */
function onAir(event: RunEvent): boolean {
  return (fromControl(event) || fromPlant(event) || event.kind === 'hint') && !endsRun(event);
}

/**
 * How lines on the air rank against each other (`withNews`): the run's story — the start, a
 * solve's line, the escape — and a note the crew asked for, highest; the calls — the first
 * alarm, the clock, an emergency and the plant's message on it — below them; a nudge lowest.
 */
export const RANKS = { nudge: 0, call: 1, story: 2 } as const;

/** The moments of the calls, which rank between the story and a nudge. */
const CALLS: ReadonlySet<RadioMoment> = new Set([
  'announce',
  'emergency',
  'cleared',
  'missed',
  'alarm',
  'clock',
]);

/** How `event` ranks on the air (RANKS); a line kept from before moments were noted, as story. */
export function rankOf(event: RunEvent): number {
  if (event.kind === 'nudge') {
    return RANKS.nudge;
  }
  return event.moment !== undefined && CALLS.has(event.moment) ? RANKS.call : RANKS.story;
}

/**
 * Whether a line on the air is spoken: mission control's are, over the radio (world/
 * radioVoice.ts), and the plant's over its loudspeakers (world/pa.ts), where a recording of it
 * exists; a note of the last shift is read, never heard.
 */
export function voiced(event: RunEvent): boolean {
  return fromControl(event) || fromPlant(event);
}

/**
 * A line of the run report as the Einsatzprotokoll prints it: a nudge says that mission
 * control spoke up — „Leitstelle meldet sich: …" — the plant's message that it is one —
 * „Durchsage: …" — every other line its own words.
 */
export function reportLine(event: RunEvent): string {
  if (event.kind === 'nudge') {
    return `${NUDGED}: ${event.label}`;
  }
  return fromPlant(event) ? `${ANNOUNCED}: ${event.label}` : event.label;
}

/** What the banner calls each role: the plant's loudspeakers, the desk, the shift's lead. */
const ROLE_BANNER: Readonly<Record<Role, string>> = {
  pa: 'DURCHSAGE',
  operator: 'LEITSTELLE',
  lead: 'SCHICHTLEITUNG',
};

/**
 * Who a line on the air is from, as the banner names them: the plant's loudspeakers by what
 * they are, the radio by its role and the person of the night's cast — „LEITSTELLE · MARTA",
 * „SCHICHTLEITUNG · KESSLER" — and a note by the last shift.
 */
export function bannerFrom(event: RunEvent): string {
  if (event.kind === 'hint') {
    return LAST_SHIFT;
  }
  const { role, person } = speakerOf(event);
  const name = personOf(person)?.name;
  if (role === 'pa' || name === undefined) return ROLE_BANNER[role];
  return `${ROLE_BANNER[role]} · ${name.toLocaleUpperCase('de-DE')}`;
}

/** What the radio strip calls whoever is on the radio: the desk, or the shift's lead. */
export function radioName(event: RunEvent): string {
  return speakerOf(event).role === 'lead' ? 'Schichtleitung' : 'Leitstelle';
}

/**
 * The icon beside a line of the run: the last shift's note for theirs — one
 * asked for, or one found on a wall and read — the radio for the rest.
 */
export function airIcon(event: RunEvent): 'note' | 'radio' {
  return event.kind === 'hint' || event.kind === 'note' ? 'note' : 'radio';
}

/**
 * Lines on the air among the events after the first `seen`, oldest first.
 * The run report only grows while a run lasts, so a count is enough to tell
 * old from new; `now` (epoch ms, compared with the server's `at`) weeds out
 * lines that are new to this client but old news to the crew.
 */
export function radioNews(events: readonly RunEvent[], seen: number, now: number): RunEvent[] {
  return events.slice(seen).filter((event) => onAir(event) && now - event.at <= NEWS_MS);
}

/**
 * What the objective bar carries under the goal, one at a time: a line on the air — not
 * before `notBefore`, epoch ms by this client's clock, and once up for `upMs` — or the note
 * that the sign was read.
 */
export type Notice =
  | { kind: 'line'; event: RunEvent; notBefore: number; upMs?: number }
  | { kind: 'sign' };

/** How long a line on the air waits after the solve it comes with, ms: the win is seen first. */
export const AFTER_SOLVE_MS = 1000;

/**
 * Whether the events after the first `seen` hold a station solved: the lines that come with it
 * wait AFTER_SOLVE_MS, so that the device's sweep, its chord and the room's light come first.
 */
export function followsSolve(events: readonly RunEvent[], seen: number): boolean {
  return events.slice(seen).some((event) => event.kind === 'puzzle');
}

/** A line in the bar's queue. */
type LineNotice = Extract<Notice, { kind: 'line' }>;

/**
 * Whether the queued `notice` stays ahead of a fresh line of `rank`: it outranks the line, or
 * both are calls — a call waits for the one before it, so that it never speaks over it.
 */
const staysAhead = (notice: LineNotice, rank: number): boolean => {
  const its = rankOf(notice.event);
  return its > rank || (its === rank && rank === RANKS.call);
};

/**
 * The bar's queue once fresh lines came in, none on the air before `notBefore`. Each fresh line
 * drops the queued lines it outranks, the one on the air included, and waits behind the rest
 * (`staysAhead`): a call — an alarm, the clock, an emergency — cuts a nudge short but waits for
 * a line of the run's story and for another call; a line of the story replaces the older lines
 * of the story as the newer news, and a nudge an older nudge. The note that the sign was read
 * waits behind them all, a note up now included, which comes back once they are said. The radio
 * never waits for the note.
 */
export function withNews(
  queue: readonly Notice[],
  news: readonly RunEvent[],
  notBefore = 0,
): Notice[] {
  let lines = queue.filter((notice): notice is LineNotice => notice.kind === 'line');
  for (const event of news) {
    const rank = rankOf(event);
    const ahead = lines.filter((notice) => staysAhead(notice, rank));
    lines = [...ahead, { kind: 'line', event, notBefore }];
  }
  return [...lines, ...queue.filter((notice) => notice.kind === 'sign')];
}

/**
 * How long a notice stays up; `coarse` for a touch screen. A line spoken for `airMs` — over the
 * radio (radioVoice.ts `airtimeMs`) or the loudspeakers (pa.ts `announce`) — stays while it
 * speaks, however long that is; the plant's message at least PA_BANNER_MS.
 */
export function noticeMs(notice: Notice, coarse: boolean, airMs: number | null = null): number {
  if (notice.kind === 'sign') {
    return SIGN_NOTE_MS;
  }
  if (fromPlant(notice.event)) {
    return Math.max(PA_BANNER_MS, airMs ?? 0);
  }
  return Math.max(coarse ? BANNER_MS_COARSE : BANNER_MS, airMs ?? 0);
}

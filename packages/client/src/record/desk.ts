import type { RecordLine } from './lines.js';

/**
 * The /record page's state, as a machine of its own so that it is tested without a browser:
 * the lines, the one on screen, and where its take stands. A take is recorded (the microphone
 * opening, then rolling), trimmed, listened to, taken again or saved; moving to another line
 * waits until nothing is under way, and drops a take not saved.
 */

/** A take: the WAV that goes to the server, an address to play it from, how long it speaks. */
export interface Take {
  readonly wav: Blob;
  readonly url: string;
  readonly ms: number;
}

/** Where the line on screen stands. */
export type Phase =
  | { readonly kind: 'idle' }
  /** the microphone is being opened */
  | { readonly kind: 'arming' }
  /** rolling since `since`, on the page's clock (ms) */
  | { readonly kind: 'recording'; readonly since: number }
  /** the take is being trimmed and written */
  | { readonly kind: 'processing' }
  | { readonly kind: 'review'; readonly take: Take }
  | { readonly kind: 'saving'; readonly take: Take }
  | { readonly kind: 'saved' }
  /** something went wrong; a take that was there still is */
  | { readonly kind: 'failed'; readonly take: Take | null; readonly error: string };

export interface Desk {
  readonly lines: readonly RecordLine[];
  readonly index: number;
  readonly phase: Phase;
}

export type DeskEvent =
  | { readonly kind: 'go'; readonly index: number }
  | { readonly kind: 'record' }
  | { readonly kind: 'rolling'; readonly at: number }
  | { readonly kind: 'stop' }
  | { readonly kind: 'took'; readonly take: Take }
  | { readonly kind: 'save' }
  | { readonly kind: 'saved'; readonly ms: number }
  | { readonly kind: 'fail'; readonly error: string };

const IDLE: Phase = { kind: 'idle' };

/** The desk for `lines`, on the first line no person has spoken yet. */
export function openDesk(lines: readonly RecordLine[]): Desk {
  return { lines, index: Math.max(0, lines.findIndex((line) => !line.human)), phase: IDLE };
}

/** Whether something is under way that moving to another line would cut short. */
export function busy(phase: Phase): boolean {
  const kind = phase.kind;
  return kind === 'arming' || kind === 'recording' || kind === 'processing' || kind === 'saving';
}

/** The take the phase holds; null where it holds none. */
export function takeOf(phase: Phase): Take | null {
  return 'take' in phase ? phase.take : null;
}

type EventOf<K extends DeskEvent['kind']> = Extract<DeskEvent, { kind: K }>;
type Step<K extends DeskEvent['kind']> = (desk: Desk, event: EventOf<K>) => Desk;

const into = (desk: Desk, phase: Phase): Desk => ({ ...desk, phase });

/** The line on screen marked as spoken by a person, for `ms`. */
function saved(desk: Desk, ms: number): Desk {
  const spoken = (line: RecordLine): RecordLine => ({ ...line, ms, human: true });
  const lines = desk.lines.map((line, i) => (i === desk.index ? spoken(line) : line));
  return { ...desk, lines, phase: { kind: 'saved' } };
}

/** What each event does, from the phases it has a use in; from any other it changes nothing. */
const STEPS: { readonly [K in DeskEvent['kind']]: Step<K> } = {
  go: (desk, { index }) =>
    busy(desk.phase) || desk.lines.length === 0
      ? desk
      : { ...desk, index: Math.min(Math.max(0, index), desk.lines.length - 1), phase: IDLE },
  record: (desk) => (busy(desk.phase) ? desk : into(desk, { kind: 'arming' })),
  rolling: (desk, { at }) =>
    desk.phase.kind === 'arming' ? into(desk, { kind: 'recording', since: at }) : desk,
  stop: (desk) => (desk.phase.kind === 'recording' ? into(desk, { kind: 'processing' }) : desk),
  took: (desk, { take }) =>
    desk.phase.kind === 'processing' ? into(desk, { kind: 'review', take }) : desk,
  save: (desk) => {
    const take = desk.phase.kind === 'saving' ? null : takeOf(desk.phase);
    return take === null ? desk : into(desk, { kind: 'saving', take });
  },
  saved: (desk, { ms }) => (desk.phase.kind === 'saving' ? saved(desk, ms) : desk),
  fail: (desk, { error }) => into(desk, { kind: 'failed', take: takeOf(desk.phase), error }),
};

/** The desk after `event`. */
export function step(desk: Desk, event: DeskEvent): Desk {
  return (STEPS[event.kind] as (desk: Desk, event: DeskEvent) => Desk)(desk, event);
}

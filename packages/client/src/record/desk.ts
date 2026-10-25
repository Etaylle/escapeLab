import type { RecordLine, Recording } from './lines.js';

/**
 * The /record page's state, as a machine of its own so that it is tested without a browser:
 * the lines, the one on screen, where its take stands, and whether its text was copied. A take
 * is recorded (the microphone opening, then rolling), trimmed, listened to, taken again or
 * saved; a file put on the page goes to the server as it is. Moving to another line waits until
 * nothing is under way, and drops a take not saved.
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
  /** the file `name` is on its way to the server */
  | { readonly kind: 'uploading'; readonly name: string }
  | { readonly kind: 'saved' }
  /** something went wrong; a take that was there still is */
  | { readonly kind: 'failed'; readonly take: Take | null; readonly error: string };

/** Whether the line's text went to the clipboard, or waits marked in a field to be copied. */
export type Copy = 'idle' | 'done' | 'manual';

export interface Desk {
  readonly lines: readonly RecordLine[];
  readonly index: number;
  readonly phase: Phase;
  readonly copy: Copy;
}

export type DeskEvent =
  | { readonly kind: 'go'; readonly index: number }
  | { readonly kind: 'record' }
  | { readonly kind: 'rolling'; readonly at: number }
  | { readonly kind: 'stop' }
  | { readonly kind: 'took'; readonly take: Take }
  | { readonly kind: 'save' }
  | { readonly kind: 'upload'; readonly name: string }
  | { readonly kind: 'saved'; readonly recording: Recording }
  | { readonly kind: 'fail'; readonly error: string }
  | { readonly kind: 'copied'; readonly done: boolean };

const IDLE: Phase = { kind: 'idle' };

/** Whether a line's recording is still the synthetic voice's, or it has none. */
export const unreplaced = (line: RecordLine): boolean =>
  line.recording === null || line.recording.source === 'synthetic';

/** The desk for `lines`, on the first line no person has replaced yet. */
export function openDesk(lines: readonly RecordLine[]): Desk {
  return { lines, index: Math.max(0, lines.findIndex(unreplaced)), phase: IDLE, copy: 'idle' };
}

/** Whether something is under way that moving to another line would cut short. */
export function busy(phase: Phase): boolean {
  return ['arming', 'recording', 'processing', 'saving', 'uploading'].includes(phase.kind);
}

/** The take the phase holds; null where it holds none. */
export function takeOf(phase: Phase): Take | null {
  return 'take' in phase ? phase.take : null;
}

type EventOf<K extends DeskEvent['kind']> = Extract<DeskEvent, { kind: K }>;
type Step<K extends DeskEvent['kind']> = (desk: Desk, event: EventOf<K>) => Desk;

const into = (desk: Desk, phase: Phase): Desk => ({ ...desk, phase });

/** The line on screen with the recording the server kept. */
function saved(desk: Desk, recording: Recording): Desk {
  const kept = (line: RecordLine): RecordLine => ({ ...line, recording });
  const lines = desk.lines.map((line, i) => (i === desk.index ? kept(line) : line));
  return { ...desk, lines, phase: { kind: 'saved' } };
}

/** What each event does, from the phases it has a use in; from any other it changes nothing. */
const STEPS: { readonly [K in DeskEvent['kind']]: Step<K> } = {
  go: (desk, { index }) =>
    busy(desk.phase) || desk.lines.length === 0
      ? desk
      : {
          ...desk,
          index: Math.min(Math.max(0, index), desk.lines.length - 1),
          phase: IDLE,
          copy: 'idle',
        },
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
  upload: (desk, { name }) => (busy(desk.phase) ? desk : into(desk, { kind: 'uploading', name })),
  saved: (desk, { recording }) =>
    desk.phase.kind === 'saving' || desk.phase.kind === 'uploading'
      ? saved(desk, recording)
      : desk,
  fail: (desk, { error }) => into(desk, { kind: 'failed', take: takeOf(desk.phase), error }),
  copied: (desk, { done }) => ({ ...desk, copy: done ? 'done' : 'manual' }),
};

/** The desk after `event`. */
export function step(desk: Desk, event: DeskEvent): Desk {
  return (STEPS[event.kind] as (desk: Desk, event: DeskEvent) => Desk)(desk, event);
}

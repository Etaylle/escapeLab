import type { RunEvent } from '@escapelab/core';
import { fromPlant, noticeMs, voiced, type Notice } from '../radio.js';
import { radioChirp } from './audio.js';
import { announce, stopAnnounce } from './pa.js';
import { sayLine, stopVoice } from './radioVoice.js';

/**
 * The objective bar's notices going up, one at a time (screens/Game.tsx `useNotices`). A line on
 * the air goes up as its sound starts — the plant's message over the loudspeakers (pa.ts
 * `announce`), mission control's over the radio (radioVoice.ts `sayLine`) — and stays up from
 * then while it speaks (radio.ts `noticeMs`), so that the line after it, which waits for it, never
 * speaks over it, however late its recording came: on a phone on mobile data a line's file may
 * still be on its way when its turn comes. A line whose recording has not sounded within
 * VOICE_WAIT_MS goes up without it, and that recording, should it come later, stays unsaid; a
 * line without one goes up at once — the operator's keyed with the radio's chirp, the plant's
 * silent. As a line goes up, what either speaker still says of another line is cut: one line on
 * the air at a time, the plant's or the operator's.
 */

/** How long a line waits for its recording to sound before it goes up without it, ms. */
export const VOICE_WAIT_MS = 3000;

/** How the bar puts a notice up (`airNotice`). */
export interface Airing {
  /** how long the notice waits before it may go up, ms: for its gate, a solve's line after it */
  readonly wait: number;
  /** whether the screen is a touch screen, where a line stays up BANNER_MS_COARSE at least */
  readonly coarse: boolean;
  /** the notice goes up: a line's with how long it stays (`upMs`) */
  readonly show: (notice: Notice) => void;
  /** it has stayed up its time: the next may come */
  readonly done: () => void;
}

/**
 * Puts `notice` up once `airing.wait` has passed — a line as its sound starts, or without it
 * (above) — and tells `airing.done` once it has stayed up its time. Returns how to take it back
 * before then: nothing more of it comes, and a recording of it still on its way stays unsaid.
 */
export function airNotice(notice: Notice, airing: Airing): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  /** the line asked of its speaker and not up yet */
  let asking: RunEvent | null = null;
  const goUp = (air: number | null): void => {
    const up = noticeMs(notice, airing.coarse, air);
    airing.show(notice.kind === 'line' ? { ...notice, upMs: up } : notice);
    timers.push(setTimeout(airing.done, up));
  };
  const settle = (event: RunEvent, air: number | null): void => {
    if (asking !== event) return;
    asking = null;
    if (air === null) unvoiced(event);
    else cutOthers(event);
    goUp(air);
  };
  const ask = (event: RunEvent): void => {
    asking = event;
    timers.push(setTimeout(() => settle(event, null), VOICE_WAIT_MS));
    void voiceOf(event).then((air) => settle(event, air));
  };
  timers.push(
    setTimeout(() => (notice.kind === 'line' ? ask(notice.event) : goUp(null)), airing.wait),
  );
  return () => {
    for (const timer of timers) clearTimeout(timer);
    if (asking !== null) hush();
    asking = null;
  };
}

/** What `event` asks of its speaker: how long it keeps the air once it sounds; null for never. */
function voiceOf(event: RunEvent): Promise<number | null> {
  if (fromPlant(event)) return announce(event.label);
  return voiced(event) ? sayLine(event.label) : Promise.resolve(null);
}

/** Neither speaker says anything more: a line still on the air is cut, one asked for made moot. */
function hush(): void {
  stopVoice();
  stopAnnounce();
}

/** `event` sounds: what the other speaker still says is cut — its own cut its own already. */
function cutOthers(event: RunEvent): void {
  if (fromPlant(event)) stopVoice();
  else stopAnnounce();
}

/**
 * `event` goes up without its voice: nothing else speaks on under it, and mission control's line
 * — or the last shift's note — is keyed with the radio's chirp.
 */
function unvoiced(event: RunEvent): void {
  hush();
  if (!fromPlant(event)) radioChirp();
}

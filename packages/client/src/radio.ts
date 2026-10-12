import type { RunEvent } from '@escapelab/core';

/** How long a line stays on the air; ui.css fades the banner to match. */
export const BANNER_MS = 7000;
/** The same on a touch screen, where the bar covers more of a small world. */
export const BANNER_MS_COARSE = 4000;
/** How long the note that the sign was read stays up; its fade in ui.css matches. */
export const SIGN_NOTE_MS = 3500;

/**
 * Lines older than this are history, not news: a reconnect or a late join
 * must not replay what the crew heard a while ago.
 */
export const NEWS_MS = 10_000;

/** A revealed note goes on the air under the last crew's name, not mission control's. */
export const LAST_CREW = '📝 Notiz der letzten Crew';

/** What goes on the air: mission control's scripted lines and the notes the crew revealed. */
function onAir(event: RunEvent): boolean {
  return event.kind === 'radio' || event.kind === 'hint';
}

/** Who a line on the air is from, as the banner names them. */
export function bannerFrom(event: RunEvent): string {
  return event.kind === 'hint' ? LAST_CREW : '📻 LEITSTELLE';
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

/** What the objective bar carries under the goal, one at a time. */
export type Notice = { kind: 'line'; event: RunEvent } | { kind: 'sign' };

/**
 * The bar's queue once fresh lines came in: they replace the lines still
 * queued, the one on the air included — they are the newer news — but the
 * note that the sign was read keeps its place, ahead of them.
 */
export function withNews(queue: readonly Notice[], news: readonly RunEvent[]): Notice[] {
  return [
    ...queue.filter((notice) => notice.kind === 'sign'),
    ...news.map((event): Notice => ({ kind: 'line', event })),
  ];
}

/** How long a notice stays up; `coarse` for a touch screen. */
export function noticeMs(notice: Notice, coarse: boolean): number {
  if (notice.kind === 'sign') {
    return SIGN_NOTE_MS;
  }
  return coarse ? BANNER_MS_COARSE : BANNER_MS;
}

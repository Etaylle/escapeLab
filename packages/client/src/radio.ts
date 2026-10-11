import type { RunEvent } from '@escapelab/core';

/** How long a mission-control line stays on the air. */
export const BANNER_MS = 7000;

/**
 * Lines older than this are history, not news: a reconnect or a late join
 * must not replay what the crew heard a while ago.
 */
export const NEWS_MS = 10_000;

/** Mission control speaking: scripted radio lines and the hints it hands out. */
export function fromMissionControl(event: RunEvent): boolean {
  return event.kind === 'radio' || event.kind === 'hint';
}

/**
 * Mission-control lines among the events after the first `seen`, oldest
 * first. The run report only grows while a run lasts, so a count is enough
 * to tell old from new; `now` (epoch ms, compared with the server's `at`)
 * weeds out lines that are new to this client but old news to the crew.
 */
export function radioNews(events: readonly RunEvent[], seen: number, now: number): RunEvent[] {
  return events
    .slice(seen)
    .filter((event) => fromMissionControl(event) && now - event.at <= NEWS_MS);
}

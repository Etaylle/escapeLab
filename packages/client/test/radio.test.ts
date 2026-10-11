import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@escapelab/core';
import { NEWS_MS, radioNews } from '../src/radio.js';

const NOW = 1_700_000_000_000;

function event(kind: RunEvent['kind'], msAgo: number, label: string = kind): RunEvent {
  return { at: NOW - msAgo, kind, label, seconds: kind === 'hint' ? 20 : null };
}

const labels = (events: RunEvent[]): string[] => events.map((e) => e.label);

describe('radioNews — which lines get a banner', () => {
  it('picks radio and hint lines after the ones already seen, oldest first', () => {
    const events = [
      event('radio', 9000, 'start'),
      event('puzzle', 3000),
      event('radio', 3000, 'solved'),
      event('hint', 1000, 'tip'),
    ];
    expect(labels(radioNews(events, 1, NOW))).toEqual(['solved', 'tip']);
  });

  it('ignores everything mission control did not say', () => {
    const events = (['puzzle', 'penalty', 'sabotage', 'item', 'escape', 'finish'] as const).map(
      (kind) => event(kind, 500),
    );
    expect(radioNews(events, 0, NOW)).toEqual([]);
  });

  it('does not replay old lines to a client that joins late or reconnects', () => {
    const events = [
      event('radio', 60_000, 'start'),
      event('hint', 11_000, 'old tip'),
      event('radio', 3000, 'fresh'),
    ];
    expect(labels(radioNews(events, 0, NOW))).toEqual(['fresh']);
  });

  it('still counts a line right at the edge of the window', () => {
    expect(radioNews([event('radio', NEWS_MS)], 0, NOW)).toHaveLength(1);
    expect(radioNews([event('radio', NEWS_MS + 1)], 0, NOW)).toHaveLength(0);
  });

  it('has nothing new once every event has been seen', () => {
    const events = [event('radio', 1000), event('hint', 500)];
    expect(radioNews(events, events.length, NOW)).toEqual([]);
  });

  it('takes a line stamped a little ahead of this clock as news', () => {
    expect(radioNews([event('radio', -2000)], 0, NOW)).toHaveLength(1);
  });
});

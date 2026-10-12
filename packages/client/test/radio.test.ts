import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@escapelab/core';
import {
  bannerFrom,
  NEWS_MS,
  noticeMs,
  radioNews,
  withNews,
  type Notice,
} from '../src/radio.js';

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

  it('names mission control on its lines and the last crew on a revealed note', () => {
    expect(bannerFrom(event('radio', 0))).toBe('📻 LEITSTELLE');
    expect(bannerFrom(event('hint', 0))).toBe('📝 Notiz der letzten Crew');
  });
});

describe('the objective bar, one notice at a time', () => {
  const sign: Notice = { kind: 'sign' };
  const line = (label: string): Notice => ({ kind: 'line', event: event('radio', 0, label) });
  const shown = (queue: Notice[]): string[] =>
    queue.map((notice) => (notice.kind === 'sign' ? 'sign' : notice.event.label));

  it('lets fresh lines replace the queued ones, but never the note that the sign was read', () => {
    const queued = withNews([line('old'), sign, line('older')], [event('radio', 0, 'new')]);
    expect(shown(queued)).toEqual(['sign', 'new']);
    expect(queued[0]).toBe(sign);
    expect(shown(withNews([sign], [event('hint', 0, 'tip')]))).toEqual(['sign', 'tip']);
  });

  it('keeps a line up 7 s, 4 s on a touch screen, and the note 3.5 s anywhere', () => {
    expect(noticeMs(line('x'), false)).toBe(7000);
    expect(noticeMs(line('x'), true)).toBe(4000);
    expect(noticeMs(sign, false)).toBe(3500);
    expect(noticeMs(sign, true)).toBe(3500);
  });
});

import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@escapelab/core';
import {
  AFTER_SOLVE_MS,
  airIcon,
  bannerFrom,
  followsSolve,
  fromControl,
  NEWS_MS,
  noticeMs,
  radioNews,
  reportLine,
  voiced,
  withNews,
  type Notice,
} from '../src/radio.js';
import { tickerLine } from '../src/screens/MissionHud.js';

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

  it('names mission control on its lines and the last shift on a revealed note', () => {
    expect(bannerFrom(event('radio', 0))).toBe('LEITSTELLE');
    expect(bannerFrom(event('hint', 0))).toBe('Notiz der letzten Schicht');
  });

  it('puts the last shift’s note by a note asked for or read, the radio beside the rest', () => {
    expect(airIcon(event('hint', 0))).toBe('note');
    expect(airIcon(event('note', 0))).toBe('note');
    for (const kind of ['radio', 'nudge', 'find', 'puzzle', 'penalty'] as const) {
      expect(airIcon(event(kind, 0))).toBe('radio');
    }
  });
});

describe('mission control speaking up unasked (a nudge)', () => {
  const nudge = event('nudge', 500, 'Die Betriebsanleitung liegt im Archiv.');

  it('goes on the air like any of its lines: a banner from the Leitstelle, spoken', () => {
    expect(labels(radioNews([event('puzzle', 900), nudge], 0, NOW))).toEqual([nudge.label]);
    expect(bannerFrom(nudge)).toBe('LEITSTELLE');
    expect(fromControl(nudge)).toBe(true);
    expect(voiced(nudge)).toBe(true);
    expect(voiced(event('hint', 0))).toBe(false);
    // Unasked, it holds nothing back: it follows no solve.
    expect(followsSolve([nudge], 0)).toBe(false);
  });

  it('says in the run report that the Leitstelle spoke up, its line after it', () => {
    expect(reportLine(nudge)).toBe(`Leitstelle meldet sich: ${nudge.label}`);
    expect(reportLine(event('radio', 0, 'Strom weg.'))).toBe('Strom weg.');
  });

  it('reads on the HUD’s radio strip as the Leitstelle’s', () => {
    expect(tickerLine(nudge, undefined, false)).toEqual({
      icon: 'radio',
      text: 'Leitstelle: Die Betriebsanleitung liegt im Archiv.',
    });
  });
});

describe('the objective bar, one notice at a time', () => {
  const sign: Notice = { kind: 'sign' };
  const line = (label: string): Notice => ({
    kind: 'line',
    event: event('radio', 0, label),
    notBefore: 0,
  });
  const shown = (queue: Notice[]): string[] =>
    queue.map((notice) => (notice.kind === 'sign' ? 'sign' : notice.event.label));

  it('lets fresh lines replace the queued ones, but never the note that the sign was read', () => {
    const queued = withNews([line('old'), sign, line('older')], [event('radio', 0, 'new')]);
    expect(shown(queued)).toEqual(['sign', 'new']);
    expect(queued[0]).toBe(sign);
    expect(shown(withNews([sign], [event('hint', 0, 'tip')]))).toEqual(['sign', 'tip']);
  });

  it('holds a line that comes with a solve a second, so the win is seen and heard first', () => {
    const solved = [event('radio', 9000, 'start'), event('puzzle', 0), event('radio', 0, 'next')];
    expect(followsSolve(solved, 1)).toBe(true);
    // A line on its own, or a solve seen before, holds nothing.
    expect(followsSolve(solved, 2)).toBe(false);
    expect(followsSolve([event('radio', 0), event('hint', 0)], 0)).toBe(false);
    expect(AFTER_SOLVE_MS).toBe(1000);
    const held = withNews([], [event('radio', 0, 'next')], NOW + AFTER_SOLVE_MS);
    expect(held).toEqual([{ kind: 'line', event: event('radio', 0, 'next'), notBefore: NOW + 1000 }]);
    expect(withNews([], [event('radio', 0)])[0]).toMatchObject({ notBefore: 0 });
  });

  it('keeps a line up 7 s, 4 s on a touch screen, and the note 3.5 s anywhere', () => {
    expect(noticeMs(line('x'), false)).toBe(7000);
    expect(noticeMs(line('x'), true)).toBe(4000);
    expect(noticeMs(sign, false)).toBe(3500);
    expect(noticeMs(sign, true)).toBe(3500);
  });

  it('keeps a line spoken longer up while it speaks, on any screen; a short one as long', () => {
    expect(noticeMs(line('x'), false, 9400)).toBe(9400);
    expect(noticeMs(line('x'), true, 9400)).toBe(9400);
    expect(noticeMs(line('x'), false, 3100)).toBe(7000);
    expect(noticeMs(line('x'), true, 3100)).toBe(4000);
    expect(noticeMs(line('x'), true, null)).toBe(4000);
    expect(noticeMs(sign, false, 9400)).toBe(3500);
  });
});

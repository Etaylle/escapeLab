import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@escapelab/core';
import {
  AFTER_SOLVE_MS,
  airIcon,
  ANNOUNCED,
  bannerFrom,
  endsRun,
  followsSolve,
  fromControl,
  fromPlant,
  NEWS_MS,
  noticeMs,
  PA_BANNER_MS,
  radioNews,
  RANKS,
  rankOf,
  reportLine,
  voiced,
  withNews,
  type Notice,
} from '../src/radio.js';
import { lastWordOf } from '../src/screens/End.js';
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

describe('mission control’s word that a crew member is gone (a line dropped)', () => {
  const gone = event('away', 500, 'Bens Leitung ist weg.');

  it('goes on the air once, a banner from the Leitstelle, as a call', () => {
    expect(labels(radioNews([event('puzzle', 900), gone], 0, NOW))).toEqual([gone.label]);
    expect(bannerFrom(gone)).toBe('LEITSTELLE');
    expect(airIcon(gone)).toBe('radio');
    expect(fromControl(gone)).toBe(true);
    expect(rankOf(gone)).toBe(RANKS.call);
    // A call waits for the run's story and cuts a nudge short: nothing of the story is dropped.
    const story: Notice = { kind: 'line', event: event('radio', 600, 'Strom weg.'), notBefore: 0 };
    const nudge: Notice = { kind: 'line', event: event('nudge', 700), notBefore: 0 };
    const queue = withNews([story, nudge], [gone]);
    expect(queue.map((notice) => (notice.kind === 'line' ? notice.event.label : ''))).toEqual([
      'Strom weg.',
      gone.label,
    ]);
  });

  it('stands in the run report and on the radio strip as the Leitstelle’s', () => {
    expect(reportLine(gone)).toBe('Bens Leitung ist weg.');
    expect(tickerLine(gone, undefined, false)).toEqual({
      icon: 'radio',
      text: 'Leitstelle: Bens Leitung ist weg.',
    });
  });
});

describe('the plant’s loudspeakers on their emergency power (an emergency’s message)', () => {
  const message: RunEvent = {
    at: NOW - 500,
    kind: 'radio',
    label: 'Störung im Kühlkreislauf. Relaissteuerung auf Handbetrieb.',
    seconds: null,
    moment: 'announce',
  };
  const notice: Notice = { kind: 'line', event: message, notBefore: 0 };

  it('goes on the air as the plant’s, not mission control’s, and is spoken there', () => {
    expect(labels(radioNews([event('sabotage', 500), message], 0, NOW))).toEqual([message.label]);
    expect(fromPlant(message)).toBe(true);
    expect(fromControl(message)).toBe(false);
    expect(voiced(message)).toBe(true);
    expect(bannerFrom(message)).toBe('DURCHSAGE');
    expect(reportLine(message)).toBe(`${ANNOUNCED}: ${message.label}`);
    expect(tickerLine(message, undefined, false)).toEqual({
      icon: 'radio',
      text: `Durchsage: ${message.label}`,
    });
    // The operator's lines stay his, the moment or not.
    const start: RunEvent = { ...event('radio', 0, 'Los.'), moment: 'start' };
    expect([fromPlant(start), fromControl(start), bannerFrom(start)]).toEqual([
      false,
      true,
      'LEITSTELLE',
    ]);
    expect(fromPlant(event('radio', 0))).toBe(false);
  });

  it('stays up while it speaks, 3 s at least on any screen: the operator’s line waits on it', () => {
    expect(PA_BANNER_MS).toBe(3000);
    expect(noticeMs(notice, false)).toBe(3000);
    expect(noticeMs(notice, true, 2100)).toBe(3000);
    expect(noticeMs(notice, false, 4200)).toBe(4200);
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
    expect(shown(queued)).toEqual(['new', 'sign']);
    expect(queued[1]).toBe(sign);
  });

  it('puts the radio on the air first: the note waits behind a line, even one up now', () => {
    // a player spawned at the sign: its note is up as the run's first line comes in
    expect(shown(withNews([sign], [event('radio', 0, 'start')]))).toEqual(['start', 'sign']);
    expect(shown(withNews([sign], [event('hint', 0, 'tip')]))).toEqual(['tip', 'sign']);
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

describe('the operator’s answers on the air, by rank', () => {
  const said = (moment: RunEvent['moment'], label: string): RunEvent => ({
    ...event('radio', 0, label),
    ...(moment === undefined ? {} : { moment }),
  });
  const nudge: RunEvent = { ...event('nudge', 0, 'nudge'), moment: 'nudge' };
  const queued = (...events: RunEvent[]): Notice[] =>
    events.map((e) => ({ kind: 'line', event: e, notBefore: 0 }));
  const shown = (queue: Notice[]): string[] =>
    queue.map((notice) => (notice.kind === 'sign' ? 'sign' : notice.event.label));

  it('ranks the run’s story over the calls, and the calls over a nudge', () => {
    expect(RANKS).toEqual({ nudge: 0, call: 1, story: 2 });
    for (const moment of ['start', 'solved', 'escape'] as const) {
      expect(rankOf(said(moment, moment)), moment).toBe(RANKS.story);
    }
    for (const moment of ['alarm', 'clock', 'emergency', 'cleared', 'missed', 'announce'] as const) {
      expect(rankOf(said(moment, moment)), moment).toBe(RANKS.call);
    }
    expect(rankOf(nudge)).toBe(RANKS.nudge);
    // A line kept from before its moment was noted, and a note asked for: the story's.
    expect(rankOf(event('radio', 0))).toBe(RANKS.story);
    expect(rankOf(event('hint', 0))).toBe(RANKS.story);
  });

  it('lets the clock and an emergency cut a nudge short, never a solve’s line: they wait for it', () => {
    const solved = said('solved', 'solved');
    expect(shown(withNews(queued(solved), [said('clock', 'five')]))).toEqual(['solved', 'five']);
    expect(shown(withNews(queued(solved), [said('emergency', 'emergency')]))).toEqual([
      'solved',
      'emergency',
    ]);
    expect(shown(withNews(queued(nudge), [said('clock', 'five')]))).toEqual(['five']);
    expect(shown(withNews(queued(nudge), [said('alarm', 'alarm')]))).toEqual(['alarm']);
    // The line on the air stays the same notice: nothing cuts it, nothing starts it again.
    const queue = queued(solved);
    expect(withNews(queue, [said('clock', 'five')])[0]).toBe(queue[0]);
  });

  it('never puts a call over another: the plant’s message, then the operator’s, one by one', () => {
    const news = [said('announce', 'Störung.'), said('emergency', 'Relais von Hand.')];
    expect(shown(withNews([], news))).toEqual(['Störung.', 'Relais von Hand.']);
    const behind = withNews(queued(said('clock', 'five')), [said('alarm', 'alarm')]);
    expect(shown(behind)).toEqual(['five', 'alarm']);
    // A nudge waits behind a call and the story alike.
    expect(shown(withNews(queued(said('clock', 'five')), [nudge]))).toEqual(['five', 'nudge']);
  });

  it('lets a line of the story replace the calls and the older story still queued', () => {
    const waiting = queued(said('solved', 'old'), said('clock', 'five'));
    const sign: Notice = { kind: 'sign' };
    expect(shown(withNews([...waiting, sign], [said('escape', 'raus')]))).toEqual(['raus', 'sign']);
  });

  it('keeps the last word on the run off the bar: the end card says it', () => {
    const won = said('won', 'Alle draußen, gute Nacht.');
    const lost = said('lost', 'Die Zellen sind leer.');
    expect([endsRun(won), endsRun(lost), endsRun(said('escape', 'raus'))]).toEqual([
      true,
      true,
      false,
    ]);
    const ended = [event('finish', 100), won];
    expect(radioNews(ended, 0, NOW)).toEqual([]);
    expect(lastWordOf([said('escape', 'raus'), event('finish', 0), won])).toBe(won.label);
    expect(lastWordOf([said('escape', 'raus')])).toBeNull();
  });
});

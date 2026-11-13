import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AccountRun, MissionInfo } from '@escapelab/core';
import { newOnes } from '../src/achievements.js';
import { pagesOf } from '../src/screens/Join.js';
import { MyRunsScreen, MyRunsTable, outcomeText } from '../src/screens/MyRuns.js';
import { takeIn } from '../src/ws.js';
import { page } from './page.js';

const noop = (): void => undefined;

const blackout = { id: 'blackout', title: 'Blackout im Labor' } as MissionInfo;

/** Noon UTC on 13.11.2026, so that the day is the same in every time zone the tests run in. */
const DAY = Date.UTC(2026, 10, 13, 12);

/** A run of Anna's account: won, in 7:42, with Ben, ranked A unless said otherwise. */
function run(parts: Partial<AccountRun> = {}): AccountRun {
  return {
    missionId: 'blackout',
    difficulty: 'normal',
    daily: null,
    outcome: 'won',
    finishedAt: DAY,
    seconds: 462,
    crew: ['Anna', 'Ben'],
    seat: 0,
    rank: 'A',
    ...parts,
  };
}

/** The table's rows as the page shows them, each cell's text. */
function rowsOf(html: string): string[][] {
  const body = html.split('<tbody>')[1] ?? '';
  return [...body.matchAll(/<tr[^>]*>(.*?)<\/tr>/g)].map((row) =>
    [...(row[1] ?? '').matchAll(/<t[hd][^>]*>(.*?)<\/t[hd]>/g)].map((cell) =>
      (cell[1] ?? '').replace(/<[^>]+>/g, ''),
    ),
  );
}

describe('„Meine Einsätze"', () => {
  it('lists each run: mission, day, outcome, time, crew and rank', () => {
    const html = renderToStaticMarkup(
      <MyRunsTable
        mine={{
          runs: [
            run(),
            run({ outcome: 'lost:alarms', rank: null, finishedAt: DAY - 86_400_000, seat: 1 }),
          ],
          total: 2,
        }}
        missions={[blackout]}
      />,
    );
    expect(html).toContain(
      '<th scope="col">Mission</th><th scope="col" class="leader-date">Datum</th>' +
        '<th scope="col">Ausgang</th><th scope="col">Zeit</th><th scope="col">Crew</th>' +
        '<th scope="col">Rang</th>',
    );
    expect(rowsOf(html)).toEqual([
      ['Blackout im LaborNormal', '13.11.2026', 'Geschafft', '7:42', 'Anna, Ben', 'A'],
      [
        'Blackout im LaborNormal',
        '12.11.2026',
        'Notversorgung abgeschaltet',
        '7:42',
        'Anna, Ben',
        '–',
      ],
    ]);
    expect(html).toContain('<span class="my-runs-rank my-runs-rank--a">A</span>');
    // The account's own seat stands out among the crew: Anna's in the first run, Ben's in the next.
    expect(html).toContain('<span class="my-runs-you">Anna</span>, <span>Ben</span>');
    expect(html).toContain('<span>Anna</span>, <span class="my-runs-you">Ben</span>');
    expect(html).not.toContain('my-runs-older');
  });

  it('names the Tagesschicht’s day, leaves a deleted seat out, and counts the older runs', () => {
    const daily = run({ daily: '2026-11-12', crew: ['Anna', '', 'Cleo'], missionId: 'gone' });
    const html = renderToStaticMarkup(
      <MyRunsTable mine={{ runs: [daily], total: 5 }} missions={[blackout]} />,
    );
    expect(rowsOf(html)[0]?.slice(0, 1)).toEqual(['goneNormal · Tagesschicht 12.11.']);
    expect(rowsOf(html)[0]?.[4]).toBe('Anna, Cleo');
    expect(html).toContain('Die letzten 1 von 5 Einsätzen.');
  });

  it('says so where the account played none, and while it waits or failed', () => {
    const none = renderToStaticMarkup(<MyRunsTable mine={{ runs: [], total: 0 }} missions={[]} />);
    expect(none).toContain('Noch kein Einsatz mit diesem Konto.');
    const screen = (loaded: Parameters<typeof MyRunsScreen>[0]['loaded']) =>
      renderToStaticMarkup(
        <MyRunsScreen missions={[]} loaded={loaded} ask={noop} connected back={noop} />,
      );
    expect(screen({ status: 'loading' })).toContain('Lade die Einsätze …');
    const away = 'Das Konto ist gerade nicht erreichbar.';
    expect(screen({ status: 'failed', reason: away })).toContain(
      `Die Einsätze ließen sich nicht laden (${away}).`,
    );
    const ready = screen({ status: 'ready', value: { runs: [], total: 0 } });
    expect(ready).toContain('<h1>Meine Einsätze</h1>');
  });

  it('says how each run ended in the title card’s words', () => {
    const outcomes = ['won', 'lost:time', 'lost:alarms', 'lost:abandoned'] as const;
    expect(outcomes.map(outcomeText)).toEqual([
      'Geschafft',
      'Zeit abgelaufen',
      'Notversorgung abgeschaltet',
      'Einsatz abgebrochen',
    ]);
  });

  it('opens from its menu item', () => {
    const opened: string[] = [];
    const pages = pagesOf(
      { openHandbook: noop, openHistory: noop, openMyRuns: () => opened.push('Meine Einsätze') },
      null,
    );
    pages.myruns?.();
    expect(opened).toEqual(['Meine Einsätze']);
  });

  it('takes in what the server answers, or why it did not', () => {
    const { kept, got } = page();
    takeIn({ kind: 'my-runs', runs: [run()], total: 1 }, kept);
    expect(got.myRuns).toEqual({ status: 'ready', value: { runs: [run()], total: 1 } });
    takeIn({ kind: 'error', message: 'Dieser Ausweis gilt hier nicht.', of: 'my-runs' }, kept);
    expect(got.myRuns).toEqual({ status: 'failed', reason: 'Dieser Ausweis gilt hier nicht.' });
  });
});

describe('a plaque new to the account', () => {
  it('is one the cache does not know, or knows first by this very run', () => {
    const known = { blackout: { 'erste-schicht': 100, 'ohne-alarm': 500 } };
    const earned = ['erste-schicht', 'ohne-alarm', 'ungesehen'] as const;
    expect(newOnes(known, 'blackout', earned, 500)).toEqual(['ohne-alarm', 'ungesehen']);
    expect(newOnes(known, 'blackout', earned)).toEqual(['ungesehen']);
  });
});

import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  DifficultyStats,
  LeaderEntry,
  MissionInfo,
  MissionStanding,
  MissionStats,
} from '@escapelab/core';
import { clock, recordLine, recordParts, winShare } from '../src/runStats.js';
import { HistoryBoard, HistoryScreen } from '../src/screens/History.js';
import { JoinScreen } from '../src/screens/Join.js';
import { Standing, type FinishedRun } from '../src/screens/Standing.js';
import { iconsAsWords, PICTOGRAPH } from './fixtures.js';

const noop = (): void => undefined;
/** Noon UTC: the same day in every time zone the tests run in. */
const DAY = Date.UTC(2026, 9, 20, 12, 0);
/** What stands between a number and its percent sign, so they never part. */
const NBSP = '\u00a0';

function entry(crew: string[], seconds: number, alarms = 0, finishedAt = DAY): LeaderEntry {
  return { crew, crewSize: crew.length === 0 ? 2 : crew.length, seconds, alarms, finishedAt };
}

function level(parts: Partial<DifficultyStats>): DifficultyStats {
  return {
    difficulty: 'normal',
    runs: 0,
    wins: 0,
    bestSeconds: null,
    medianSeconds: null,
    top: [],
    ...parts,
  };
}

const blackout: MissionInfo = {
  id: 'blackout',
  title: 'Blackout im Labor',
  subtitle: 'Für zwei oder drei.',
  players: { min: 2, max: 3 },
  timeLimitSec: 480,
  puzzleCount: 5,
  tiles: [],
};
const tutorial: MissionInfo = {
  id: 'systemcheck',
  title: 'Tutorial: Systemcheck',
  subtitle: 'Zum Warmwerden.',
  players: { min: 2, max: 2 },
  timeLimitSec: 420,
  puzzleCount: 3,
  tiles: [],
};

/** Seven crews out of twelve runs of Blackout on normal, the fastest in 7:42. */
const SEVEN = [
  entry(['Cleo', 'Dan'], 462.4, 1, DAY - 5_000),
  entry(['Eva', 'Finn'], 480, 0, DAY - 4_000),
  entry(['Anna', 'Ben'], 501, 2, DAY),
  entry([], 530, 3, DAY - 9_000),
  entry(['Gil', 'Hanna', 'Ivo'], 555, 0, DAY - 3_000),
  entry(['Jo', 'Kim'], 590, 4, DAY - 2_000),
  entry(['Lu', 'Mo'], 610, 1, DAY - 1_000),
];
const normal = level({
  runs: 12,
  wins: 7,
  bestSeconds: 462.4,
  medianSeconds: 530,
  top: SEVEN,
});

describe('the Bestenliste in words and numbers', () => {
  it('says a time as m:ss, to the second', () => {
    expect([clock(462.4), clock(59.6), clock(0), clock(3600)]).toEqual([
      '7:42',
      '1:00',
      '0:00',
      '60:00',
    ]);
  });

  it('never says 0 % of a mission somebody has won, nor 100 % of one somebody has lost', () => {
    expect(winShare(5, 8)).toBe(`63${NBSP}%`);
    expect(winShare(1, 300)).toBe(`unter 1${NBSP}%`);
    expect(winShare(299, 300)).toBe(`über 99${NBSP}%`);
    expect(winShare(3, 3)).toBe(`100${NBSP}%`);
  });

  it('puts a mission on one line: its best time and how often it is won, over every level', () => {
    expect(recordLine([level({ runs: 8, wins: 5, bestSeconds: 462 })])).toBe(
      `Beste Zeit 7:42 · 63${NBSP}% gewonnen`,
    );
    const both = [
      level({ runs: 3, wins: 1, bestSeconds: 500 }),
      level({ difficulty: 'hart', runs: 1, wins: 1, bestSeconds: 462.4 }),
    ];
    expect(recordLine(both)).toBe(`Beste Zeit 7:42 · 50${NBSP}% gewonnen`);
    expect(recordLine([level({ runs: 3 })])).toBe(`Noch keine Bestzeit · 0${NBSP}% gewonnen`);
    expect(recordLine([])).toBeNull();
  });

  it('halves that line where a card has two short lines for it: the time, then the share', () => {
    expect(recordParts([level({ runs: 8, wins: 5, bestSeconds: 462 })])).toEqual([
      'Beste Zeit 7:42',
      `63${NBSP}% gewonnen`,
    ]);
    expect(recordParts([level({ runs: 3 })])).toEqual([
      'Noch keine Bestzeit',
      `0${NBSP}% gewonnen`,
    ]);
    expect(recordParts([])).toBeNull();
  });
});

describe('the join screen', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function joinScreen(stats: MissionStats[]): string {
    vi.stubGlobal('window', { location: { search: '' } });
    return iconsAsWords(
      renderToStaticMarkup(
        <JoinScreen
          send={noop}
          connected
          missions={[blackout, tutorial]}
          rooms={[]}
          stats={stats}
          openHandbook={noop}
          openHistory={noop}
        />,
      ),
    );
  }

  const cards = (html: string): string[] =>
    html.match(/<button class="mission[ "].*?<\/button>/g) ?? [];

  it('gives a mission that has been played one more line on its card, the others none', () => {
    const played8 = level({ runs: 8, wins: 5, bestSeconds: 462 });
    const [played, fresh] = cards(joinScreen([{ missionId: 'blackout', difficulties: [played8] }]));
    expect(played).toContain(
      `<span class="mission-sub">Für zwei oder drei.</span>` +
        `<span class="mission-record">Beste Zeit 7:42 · 63${NBSP}% gewonnen</span></span>`,
    );
    expect(fresh).not.toContain('mission-record');
  });

  it('leads to the Bestenliste beside the handbook', () => {
    const html = joinScreen([]);
    expect(html).toMatch(/\[book\] Handbuch<\/button><button title="[^"]+">\[podium\] Bestenliste/);
  });
});

/** Anna and Ben, done with Blackout on normal in 8:21 with two alarms. */
function finished(parts: Partial<FinishedRun> = {}): FinishedRun {
  return {
    missionId: 'blackout',
    missionTitle: 'Blackout im Labor',
    difficulty: 'normal',
    won: true,
    crew: ['Anna', 'Ben'],
    seconds: 501,
    alarms: 2,
    finishedAt: DAY,
    ...parts,
  };
}

function standing(run: FinishedRun, place: number | null, groups = [normal]): string {
  const stats: MissionStanding = {
    missionId: 'blackout',
    difficulties: groups,
    place: place === null ? null : { difficulty: 'normal', place },
  };
  return renderToStaticMarkup(<Standing run={run} stats={stats} />);
}

const rowsOf = (html: string): string[] => html.match(/<tr( [^>]*)?><td .*?<\/tr>/g) ?? [];

describe('the end screen', () => {
  it('after a win: the place among every run, and the five fastest with this crew lit', () => {
    const html = standing(finished(), 3);
    expect(html).toContain(
      '<p class="standing-line">Platz 3 von 12 Läufen auf Blackout im Labor · Normal</p>',
    );
    const rows = rowsOf(html);
    expect(rows).toHaveLength(5);
    expect(rows[2]).toBe(
      '<tr class="leader-you" aria-current="true"><td class="leader-place">3</td>' +
        '<th scope="row" class="leader-crew">Anna, Ben</th><td class="leader-time">8:21</td>' +
        '<td class="leader-alarms">2</td></tr>',
    );
    expect(rows.filter((row) => row.includes('leader-you'))).toHaveLength(1);
    expect(html).not.toContain('Datum');
  });

  it('puts a crew past the fifth at the foot of the five, apart from them', () => {
    const late = finished({ seconds: 600, alarms: 1, finishedAt: DAY + 7 });
    const rows = rowsOf(standing(late, 8));
    expect(rows).toHaveLength(6);
    expect(rows[4]).not.toContain('leader-you');
    expect(rows[5]).toBe(
      '<tr class="leader-you leader-apart" aria-current="true"><td class="leader-place">8</td>' +
        '<th scope="row" class="leader-crew">Anna, Ben</th><td class="leader-time">10:00</td>' +
        '<td class="leader-alarms">1</td></tr>',
    );
  });

  it('counts one run as one', () => {
    const first = level({
      runs: 1,
      wins: 1,
      bestSeconds: 501,
      medianSeconds: 501,
      top: [entry(['Anna', 'Ben'], 501, 2)],
    });
    expect(standing(finished(), 1, [first])).toContain('Platz 1 von 1 Lauf auf Blackout');
  });

  it('after a loss: the best time and how often the mission is won, at that difficulty', () => {
    const html = standing(finished({ won: false }), null, [
      level({ difficulty: 'hart', runs: 2, wins: 2, bestSeconds: 300 }),
      normal,
    ]);
    expect(html).toBe(
      '<section class="standing"><h2>Bestenliste</h2><p class="standing-line">' +
        `Blackout im Labor · Normal: Beste Zeit 7:42 · 58${NBSP}% gewonnen</p></section>`,
    );
  });

  it('says nothing of a run the server never counted', () => {
    expect(standing(finished(), null, [])).toBe('');
  });
});

describe('the Bestenliste page', () => {
  const stats: MissionStats[] = [
    {
      missionId: 'abgeschafft',
      difficulties: [level({ runs: 1, wins: 1, bestSeconds: 99, top: [entry(['Alt'], 99)] })],
    },
    { missionId: 'blackout', difficulties: [level({ difficulty: 'entspannt', runs: 2 }), normal] },
  ];

  function board(missionId: string, difficulty: DifficultyStats['difficulty'] = 'normal'): string {
    return renderToStaticMarkup(
      <HistoryBoard
        missions={[blackout, tutorial]}
        stats={stats}
        missionId={missionId}
        selectMission={noop}
        difficulty={difficulty}
        selectDifficulty={noop}
      />,
    );
  }

  it('has a tab per mission, a gone one by its id, and the difficulty to pick', () => {
    const html = board('blackout');
    const tabs = html.match(/<button class="history-tab" aria-pressed="(true|false)">[^<]+/g);
    expect(tabs).toEqual([
      '<button class="history-tab" aria-pressed="true">Blackout im Labor',
      '<button class="history-tab" aria-pressed="false">Tutorial: Systemcheck',
      '<button class="history-tab" aria-pressed="false">abgeschafft',
    ]);
    const levels = html.match(/<button class="history-level" aria-pressed="(true|false)">[^<]+/g);
    expect(levels).toEqual([
      '<button class="history-level" aria-pressed="false">Entspannt',
      '<button class="history-level" aria-pressed="true">Normal',
      '<button class="history-level" aria-pressed="false">Hart',
    ]);
  });

  it('heads the list with its mission, its difficulty and the totals: the median of wins', () => {
    const html = board('blackout');
    expect(html).toContain('<h2>Blackout im Labor · Normal</h2>');
    expect(html).toContain(
      '<dl class="history-totals"><div><dt>Läufe</dt><dd>12</dd></div>' +
        `<div><dt title="7 von 12">Gewonnen</dt><dd>58${NBSP}%</dd></div>` +
        '<div><dt>Beste Zeit</dt><dd>7:42</dd></div>' +
        '<div><dt title="Median der gewonnenen Läufe">Median</dt><dd>8:50</dd></div></dl>',
    );
  });

  it('lists each crew it was given, fastest first, with the day; one without names as such', () => {
    const rows = rowsOf(board('blackout'));
    expect(rows).toHaveLength(7);
    expect(rows[0]).toBe(
      '<tr><td class="leader-place">1</td><th scope="row" class="leader-crew">Cleo, Dan</th>' +
        '<td class="leader-time">7:42</td><td class="leader-alarms">1</td>' +
        '<td class="leader-date">20.10.2026</td></tr>',
    );
    expect(rows[3]).toContain('<th scope="row" class="leader-nameless">ohne Namen (2)</th>');
    expect(rows.some((row) => row.includes('leader-you'))).toBe(false);
  });

  it('says so where nobody has run at that difficulty, and where nobody has escaped', () => {
    expect(board('blackout', 'hart')).toContain('Auf dieser Stufe ist hier noch niemand gelaufen.');
    expect(board('systemcheck')).toContain('Auf dieser Stufe ist hier noch niemand gelaufen.');
    const lost = board('blackout', 'entspannt');
    expect(lost).toContain('<dd>–</dd>');
    expect(lost).toContain('Noch ist keine Crew entkommen.');
    expect(lost).not.toContain('<table');
  });

  it('holds printing until the list is in, and leads back', () => {
    const html = renderToStaticMarkup(
      <HistoryScreen missions={[blackout]} missionId="blackout" selectMission={noop} back={noop} />,
    );
    expect(html).toContain(
      '<button class="link history-back">← Zurück</button><h1>Bestenliste</h1>',
    );
    expect(html).toContain('<button class="primary history-print" disabled="">Drucken</button>');
    expect(html).toContain('Lade Bestenliste …');
  });

  it('draws no emoji', () => {
    expect(board('blackout')).not.toMatch(PICTOGRAPH);
    expect(standing(finished(), 3)).not.toMatch(PICTOGRAPH);
  });
});

describe('the stylesheet', () => {
  const css = readFileSync(new URL('../src/styles/history.css', import.meta.url), 'utf8');

  it('sets a card with its record to four lines that fit its 64px map: 18 + 3 × 15', () => {
    expect(css).toMatch(/\.mission-text:has\(\.mission-record\) \{\s*gap: 0;/);
    expect(css).toMatch(/> \.mission-title \{\s*line-height: 18px;/);
    expect(css).toMatch(/\.mission-record \{\s*line-height: 15px;/);
  });
});

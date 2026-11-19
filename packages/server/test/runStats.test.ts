import { describe, expect, it } from 'vitest';
import type { Difficulty, RunOutcome, RunReport } from '@escapelab/core';
import { parseMission } from '@escapelab/core';
import { readFileSync } from 'node:fs';
import { boardOf, boardsLine, rankingOf, RunStats, TOP_RUNS } from '../src/runStats.js';
import type { RunReportV1 } from '../src/store/store.js';

/** Noon UTC, so that the day is the same in every time zone the tests run in. */
const DAY = Date.UTC(2026, 9, 20, 12, 0);

interface Parts {
  mission?: string;
  difficulty?: Difficulty;
  outcome?: RunOutcome;
  /** from start to finish */
  seconds: number;
  alarms?: number;
  crew?: string[];
  /** when it finished */
  at?: number;
}

/** What a run of either version says, past its names and its room. */
function base(parts: Parts): Omit<RunReport, 'version' | 'crew' | 'roomCode'> {
  const { mission = 'blackout', difficulty = 'normal', outcome = 'won', seconds } = parts;
  const { alarms = 0, at = DAY } = parts;
  return {
    missionId: mission,
    difficulty,
    timeLimitSec: 480,
    alarmLimit: 5,
    crewSize: (parts.crew ?? ['Anna', 'Ben']).length,
    spawns: {},
    startedAt: at - seconds * 1000,
    finishedAt: at,
    outcome,
    stations: [],
    emergencies: { count: 0, failed: 0 },
    // Alarms of two causes, so that the list has to add them up.
    penalties:
      alarms === 0
        ? []
        : [
            { cause: 'Falsche Taste', count: alarms - 1, seconds: 20 },
            { cause: 'Von einer Drohne erfasst', count: 1, seconds: 15 },
          ].filter((penalty) => penalty.count > 0),
    credits: {},
  };
}

/** A run as the server logs it now, played in room QXT4 by Anna and Ben unless named. */
function run(parts: Parts): RunReport {
  return { ...base(parts), version: 2, roomCode: 'QXT4', crew: parts.crew ?? ['Anna', 'Ben'] };
}

/** A run as the server logged it before names were kept. */
function oldRun(parts: Parts): RunReportV1 {
  return { ...base(parts), version: 1 };
}

/** The stats of one mission at one difficulty. */
function statsOf(stats: RunStats, mission = 'blackout', difficulty: Difficulty = 'normal') {
  return stats.mission(mission)?.difficulties.find((d) => d.difficulty === difficulty);
}

describe('the stats index', () => {
  it('knows nothing before the first run', () => {
    const stats = new RunStats();
    expect(stats.runs).toBe(0);
    expect(stats.all()).toEqual([]);
    expect(stats.mission('blackout')).toBeNull();
    expect(stats.placeOf('blackout', DAY)).toBeNull();
  });

  it('counts runs and wins by mission and difficulty: missions by id, the easiest first', () => {
    const stats = new RunStats([
      run({ seconds: 400, difficulty: 'hart' }),
      run({ seconds: 300, at: DAY + 1 }),
      run({ seconds: 480, outcome: 'lost:time', at: DAY + 2 }),
      run({ seconds: 500, mission: 'systemcheck', outcome: 'lost:alarms' }),
      run({ seconds: 600, difficulty: 'entspannt' }),
    ]);
    expect(stats.runs).toBe(5);
    const counted = stats
      .all()
      .map((m) => [m.missionId, m.difficulties.map((d) => [d.difficulty, d.runs, d.wins])]);
    expect(counted).toEqual([
      [
        'blackout',
        [
          ['entspannt', 1, 1],
          ['normal', 2, 1],
          ['hart', 1, 1],
        ],
      ],
      ['systemcheck', [['normal', 1, 0]]],
    ]);
    expect(statsOf(stats, 'systemcheck')).toEqual({
      difficulty: 'normal',
      runs: 1,
      wins: 0,
      bestSeconds: null,
      medianSeconds: null,
      top: [],
    });
  });

  it('takes the best and the median time over the won runs only', () => {
    const times = [420, 300, 360];
    const stats = new RunStats([
      ...times.map((seconds, i) => run({ seconds, at: DAY + i })),
      run({ seconds: 100, outcome: 'lost:alarms', at: DAY + 10 }),
    ]);
    expect(statsOf(stats)).toMatchObject({
      runs: 4,
      wins: 3,
      bestSeconds: 300,
      medianSeconds: 360,
    });
    stats.add(run({ seconds: 500, at: DAY + 20 }));
    expect(statsOf(stats)).toMatchObject({ wins: 4, bestSeconds: 300, medianSeconds: 390 });
  });

  it('times a run by its clock: from the lights going out, the intro left out', () => {
    // Two crews the same 300 s on the clock: one watched its intro for 30 s, one skipped it.
    const watched = { ...run({ seconds: 330, crew: ['Geschaut'] }), lightsOutAt: DAY - 300_000 };
    const skipped = { ...run({ seconds: 302, at: DAY + 1, crew: ['Weiter'] }) };
    const stats = new RunStats([watched, { ...skipped, lightsOutAt: DAY + 1 - 300_000 }]);
    expect(statsOf(stats)?.top.map((entry) => entry.seconds)).toEqual([300, 300]);
    expect(statsOf(stats)).toMatchObject({ bestSeconds: 300, medianSeconds: 300 });
  });

  it('ranks by time, then fewer alarms, then the earlier finish', () => {
    const stats = new RunStats([
      run({ seconds: 300, alarms: 2, at: DAY, crew: ['Zwei'] }),
      run({ seconds: 300, alarms: 1, at: DAY + 1, crew: ['Später'] }),
      run({ seconds: 300, alarms: 1, at: DAY - 1, crew: ['Früher'] }),
      run({ seconds: 299.5, alarms: 4, at: DAY + 2, crew: ['Schnell'] }),
    ]);
    const top = statsOf(stats)?.top ?? [];
    expect(top.map((entry) => entry.crew[0])).toEqual(['Schnell', 'Früher', 'Später', 'Zwei']);
    expect(top[0]).toEqual({
      crew: ['Schnell'],
      crewSize: 1,
      seconds: 299.5,
      alarms: 4,
      finishedAt: DAY + 2,
    });
  });

  it('lists a run logged before names were kept, without names', () => {
    const stats = new RunStats([oldRun({ seconds: 280 }), run({ seconds: 300, at: DAY + 1 })]);
    expect(statsOf(stats)?.top).toEqual([
      { crew: [], crewSize: 2, seconds: 280, alarms: 0, finishedAt: DAY },
      { crew: ['Anna', 'Ben'], crewSize: 2, seconds: 300, alarms: 0, finishedAt: DAY + 1 },
    ]);
  });

  it(`keeps ${TOP_RUNS} crews by name, but every won run for the median and the places`, () => {
    // 25 won runs of 300 to 324 seconds, logged in a scrambled order, and 5 lost ones.
    const won = Array.from({ length: 25 }, (_, i) =>
      run({ seconds: 300 + ((i * 7) % 25), at: DAY + i }),
    );
    const lost = Array.from({ length: 5 }, (_, i) =>
      run({ seconds: 480, outcome: 'lost:time', at: DAY + 100 + i }),
    );
    const stats = new RunStats([...won, ...lost]);
    const normal = statsOf(stats);
    expect(normal).toMatchObject({ runs: 30, wins: 25, bestSeconds: 300, medianSeconds: 312 });
    expect(normal?.top.map((entry) => entry.seconds)).toEqual(
      Array.from({ length: TOP_RUNS }, (_, i) => 300 + i),
    );
    const slowest = won.find((report) => report.finishedAt - report.startedAt === 324_000);
    expect(stats.placeOf('blackout', slowest?.finishedAt ?? 0)).toEqual({
      difficulty: 'normal',
      place: 25,
    });
    expect(stats.placeOf('blackout', lost[0]?.finishedAt ?? 0)).toBeNull();
  });

  it('places a won run among the runs of its own mission and difficulty', () => {
    const stats = new RunStats([
      run({ seconds: 200, difficulty: 'hart', at: DAY }),
      run({ seconds: 300, difficulty: 'hart', at: DAY + 1 }),
      run({ seconds: 100, at: DAY + 2 }),
    ]);
    expect(stats.placeOf('blackout', DAY + 1)).toEqual({ difficulty: 'hart', place: 2 });
    expect(stats.placeOf('blackout', DAY + 2)).toEqual({ difficulty: 'normal', place: 1 });
    expect(stats.placeOf('systemcheck', DAY + 2)).toBeNull();
  });

  it('moves a crew down when a faster one comes in, and lets the eleventh drop off by name', () => {
    const stats = new RunStats(
      Array.from({ length: TOP_RUNS }, (_, i) => run({ seconds: 400 + i, at: DAY + i })),
    );
    const last = DAY + TOP_RUNS - 1;
    expect(stats.placeOf('blackout', last)).toEqual({ difficulty: 'normal', place: TOP_RUNS });
    stats.add(run({ seconds: 100, at: DAY + 50, crew: ['Neu'] }));
    expect(stats.placeOf('blackout', last)).toEqual({ difficulty: 'normal', place: TOP_RUNS + 1 });
    const top = statsOf(stats)?.top ?? [];
    expect(top).toHaveLength(TOP_RUNS);
    expect(top[0]?.crew).toEqual(['Neu']);
    expect(top.some((entry) => entry.finishedAt === last)).toBe(false);
  });

  it('hands out copies: what a caller does with an answer leaves the list as it was', () => {
    const stats = new RunStats([run({ seconds: 300 })]);
    statsOf(stats)?.top[0]?.crew.push('Eindringling');
    statsOf(stats)?.top.pop();
    expect(statsOf(stats)?.top).toEqual([expect.objectContaining({ crew: ['Anna', 'Ben'] })]);
  });
});

const shipped = (id: string) =>
  parseMission(
    JSON.parse(readFileSync(new URL(`../../../missions/${id}.json`, import.meta.url), 'utf8')),
  );
const blackout = shipped('blackout');
const tutorial = shipped('systemcheck');

/** A run of Blackout's chain of today: it names the station it drew at the Wechselplatz. */
const drawing = (station: string, parts: Parts): RunReport => ({
  ...run(parts),
  drawn: { wechsel: station },
});

describe('the Bestenliste of a mission whose stations take turns', () => {
  const ranked = rankingOf(() => [blackout, tutorial]);
  /** One mission's archive at one difficulty: the runs of its earlier chain. */
  const archiveOf = (stats: RunStats, mission = 'blackout') =>
    stats.mission(mission)?.archive?.find((d) => d.difficulty === 'normal');

  it('puts a run on the live board where it names a station of every Wechselplatz now', () => {
    expect(boardOf(blackout, drawing('signalkette', { seconds: 500 }))).toBe('live');
    expect(boardOf(blackout, drawing('notstrom', { seconds: 500 }))).toBe('live');
    // A mission without one asks nothing of its runs.
    expect(boardOf(tutorial, run({ seconds: 300, mission: 'systemcheck' }))).toBe('live');
  });

  it('puts a run that names no draw on the archive: the chain before the Wechselplatz', () => {
    expect(boardOf(blackout, run({ seconds: 300 }))).toBe('archive');
    expect(boardOf(blackout, oldRun({ seconds: 300 }))).toBe('archive');
    // Only the draw's own keys count: an empty draw, or one with inherited keys alone, names none.
    expect(boardOf(blackout, { ...run({ seconds: 300 }), drawn: {} })).toBe('archive');
    const inherited = Object.create({ wechsel: 'notstrom' }) as Record<string, string>;
    expect(boardOf(blackout, { ...run({ seconds: 300 }), drawn: inherited })).toBe('archive');
  });

  it('puts a run that names a draw the mission no longer holds on no board at all', () => {
    // A station the place does not hold, another pool: a chain neither of today nor of before.
    expect(boardOf(blackout, drawing('subsysteme', { seconds: 300 }))).toBe('none');
    const other = { ...run({ seconds: 300 }), drawn: { funk: 'signalkette' } };
    expect(boardOf(blackout, other)).toBe('none');
  });

  it('ranks the older chain among itself on the archive, never on the live board', () => {
    const stats = new RunStats(
      [
        run({ seconds: 300, at: DAY, crew: ['Alt', 'Älter'] }),
        oldRun({ seconds: 280, at: DAY + 1 }),
        run({ seconds: 320, at: DAY + 2, outcome: 'lost:time' }),
        run({ seconds: 200, at: DAY + 3, mission: 'systemcheck' }),
      ],
      ranked,
    );
    expect([stats.runs, stats.archived, stats.unranked]).toEqual([4, 3, 0]);
    // The first day of the new chain: nothing on Blackout's live board, no place for an old run.
    expect(stats.mission('blackout')?.difficulties).toEqual([]);
    expect(stats.placeOf('blackout', DAY)).toBeNull();
    expect(stats.all().map((mission) => mission.missionId)).toEqual(['blackout', 'systemcheck']);
    // On the archive, by the same rules: time, the lost run counted, the nameless one first.
    expect(archiveOf(stats)).toMatchObject({ runs: 3, wins: 2, bestSeconds: 280 });
    expect(archiveOf(stats)?.top.map((entry) => entry.crew)).toEqual([[], ['Alt', 'Älter']]);
    // The first crew of the new chain is first of one, though slower than the old runs.
    stats.add(drawing('frequenz', { seconds: 520, at: DAY + 4, crew: ['Neu', 'Neuer'] }));
    expect(stats.placeOf('blackout', DAY + 4)).toEqual({ difficulty: 'normal', place: 1 });
    expect(statsOf(stats)).toMatchObject({ runs: 1, wins: 1, bestSeconds: 520 });
    expect(statsOf(stats)?.top.map((entry) => entry.crew)).toEqual([['Neu', 'Neuer']]);
    // And never on the archive.
    expect(archiveOf(stats)).toMatchObject({ runs: 3, wins: 2, bestSeconds: 280 });
    expect([stats.runs, stats.archived]).toEqual([5, 3]);
  });

  it('gives a mission without runs of an earlier chain no archive in its answer', () => {
    const stats = new RunStats(
      [drawing('signalkette', { seconds: 540 }), run({ seconds: 200, mission: 'systemcheck' })],
      ranked,
    );
    expect(stats.mission('blackout')).not.toHaveProperty('archive');
    expect(stats.mission('systemcheck')).not.toHaveProperty('archive');
    expect(stats.all().some((mission) => 'archive' in mission)).toBe(false);
    expect(stats.archived).toBe(0);
  });

  it('keeps a run on no board out of both, and keeps it all the same', () => {
    const stats = new RunStats([drawing('subsysteme', { seconds: 300 })], ranked);
    expect([stats.runs, stats.archived, stats.unranked]).toEqual([1, 0, 1]);
    expect(stats.mission('blackout')).toBeNull();
  });

  it('takes a deleted name off the board the run stands on', () => {
    const older = run({ seconds: 300, at: DAY, crew: ['Alt', 'Weg'] });
    const newer = drawing('notstrom', { seconds: 500, at: DAY + 1, crew: ['Neu', 'Weg'] });
    const stats = new RunStats([older, newer], ranked);
    stats.unname(older, 'Weg');
    stats.unname(newer, 'Weg');
    expect(archiveOf(stats)?.top.map((entry) => entry.crew)).toEqual([['Alt']]);
    expect(statsOf(stats)?.top.map((entry) => entry.crew)).toEqual([['Neu']]);
  });

  it('ranks the three draws on one board, a lost run counted with them', () => {
    const stats = new RunStats(
      [
        drawing('signalkette', { seconds: 540, at: DAY }),
        drawing('notstrom', { seconds: 500, at: DAY + 1 }),
        drawing('frequenz', { seconds: 900, at: DAY + 2, outcome: 'lost:time' }),
      ],
      ranked,
    );
    expect(statsOf(stats)).toMatchObject({ runs: 3, wins: 2, bestSeconds: 500 });
    expect(stats.placeOf('blackout', DAY)).toEqual({ difficulty: 'normal', place: 2 });
    expect([stats.archived, stats.unranked]).toEqual([0, 0]);
  });

  it('holds the Tagesschicht to the same rule, day by day: an archive of its own', () => {
    const daily = (report: RunReport): RunReport => ({ ...report, daily: true });
    const stats = new RunStats(
      [
        daily(run({ seconds: 300, at: DAY })),
        daily(drawing('signalkette', { seconds: 560, at: DAY + 1 })),
        // A day before the Wechselplatz: its runs all of the older chain.
        daily(run({ seconds: 310, at: DAY - 86_400_000 })),
        // Off the Tagesschicht: on the main archive, not the day's.
        run({ seconds: 290, at: DAY + 2 }),
      ],
      ranked,
    );
    const [day, before] = stats.daily();
    const board = day?.missions.find((mission) => mission.missionId === 'blackout');
    expect(board?.difficulties.map((d) => [d.runs, d.bestSeconds])).toEqual([[1, 560]]);
    expect(board?.archive?.map((d) => [d.runs, d.bestSeconds])).toEqual([[1, 300]]);
    expect(stats.dailyPlaceOf(day?.day ?? '', 'blackout', DAY)).toBeNull();
    expect(stats.dailyPlaceOf(day?.day ?? '', 'blackout', DAY + 1)).toMatchObject({ place: 1 });
    // The day before stays listed, its board empty, its archive holding its run.
    expect(before?.missions).toMatchObject([{ missionId: 'blackout', difficulties: [] }]);
    expect(before?.missions[0]?.archive?.map((d) => d.bestSeconds)).toEqual([310]);
    expect(archiveOf(stats)?.bestSeconds).toBe(290);
  });

  it('counts a run of a mission nobody knows any more as it always did', () => {
    const stats = new RunStats([run({ seconds: 300, mission: 'custom-weg' })], ranked);
    expect([stats.archived, stats.unranked]).toEqual([0, 0]);
    expect(stats.mission('custom-weg')?.difficulties[0]?.runs).toBe(1);
  });

  it('ranks every run live where no ranking is given: a store opened without one', () => {
    const stats = new RunStats([run({ seconds: 300 })]);
    expect(statsOf(stats)?.runs).toBe(1);
    expect(stats.mission('blackout')).not.toHaveProperty('archive');
    expect([stats.archived, stats.unranked]).toEqual([0, 0]);
  });

  it('says in the start-up log how many runs stand on an archive, and on none', () => {
    expect(boardsLine(new RunStats([run({ seconds: 300 })]))).toBe('the 1 runs kept so far');
    const stats = new RunStats(
      [
        run({ seconds: 300 }),
        drawing('subsysteme', { seconds: 300 }),
        drawing('notstrom', { seconds: 400 }),
      ],
      ranked,
    );
    expect(boardsLine(stats)).toBe(
      "the 3 runs kept so far, 1 of them on an archive: runs of a mission's earlier chain" +
        ', 1 on no board: they name a draw the mission no longer holds',
    );
  });
});

import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Difficulty, RunOutcome, RunReport } from '@escapelab/core';
import type { RunReportV1 } from '../src/runLog.js';
import { loadRunStats, logRun, RunStats, TOP_RUNS } from '../src/runStats.js';

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

describe('loadRunStats', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'escapelab-stats-'));
  });

  it('starts empty where there is no log yet', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(loadRunStats(join(dir, 'runs.jsonl')).runs).toBe(0);
      expect(logged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it('reads a log of both versions, as the server shipped it', () => {
    const fixture = fileURLToPath(new URL('./fixtures/runs.jsonl', import.meta.url));
    const stats = loadRunStats(fixture);
    expect(stats.runs).toBe(7);
    expect(statsOf(stats, 'systemcheck')).toMatchObject({
      runs: 4,
      wins: 2,
      bestSeconds: 300,
      medianSeconds: 330,
      top: [
        { crew: [], seconds: 300, alarms: 1 },
        { crew: ['Anna', 'Ben'], seconds: 360, alarms: 3 },
      ],
    });
    expect(statsOf(stats, 'blackout', 'hart')?.top).toMatchObject([{ crew: ['Cleo', 'Dan'] }]);
  });

  it('leaves out each line that holds no run, and says which', () => {
    const file = join(dir, 'runs.jsonl');
    const good = JSON.stringify(run({ seconds: 300 }));
    writeFileSync(file, `${good}\n{"version":2,\n${good}\n{"version":9}\n`);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(loadRunStats(file).runs).toBe(2);
      expect(logged.mock.calls.map(([line]) => String(line))).toEqual([
        expect.stringMatching(/runs\.jsonl:2: not JSON .*\(the Bestenliste leaves it out\)$/),
        expect.stringMatching(/runs\.jsonl:4: not a run report .*\(the Bestenliste leaves it ou/),
      ]);
    } finally {
      logged.mockRestore();
    }
  });

  it('starts empty, saying why, where the log cannot be read', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      // A directory where the log should be.
      expect(loadRunStats(dir).runs).toBe(0);
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('the Bestenliste starts empty'));
    } finally {
      logged.mockRestore();
    }
  });
});

describe('logRun', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'escapelab-stats-'));
  });

  it('counts each run as it is logged, and never reads the log again', () => {
    const file = join(dir, 'runs.jsonl');
    writeFileSync(file, `${JSON.stringify(run({ seconds: 300 }))}\n`);
    const stats = loadRunStats(file);
    // Whatever else lands in the log afterwards is not counted ...
    appendFileSync(file, `${JSON.stringify(run({ seconds: 100, at: DAY + 1 }))}\n`);
    expect(stats.runs).toBe(1);
    // ... only what goes through the server's own listener, which logs it first.
    logRun(file, stats)(run({ seconds: 200, at: DAY + 2, crew: ['Cleo'] }));
    expect(stats.runs).toBe(2);
    expect(readFileSync(file, 'utf8').trimEnd().split('\n')).toHaveLength(3);
    expect(statsOf(stats)?.top.map((entry) => entry.crew)).toEqual([['Cleo'], ['Anna', 'Ben']]);
  });

  it('leaves a run it could not log out of the stats as well', () => {
    const blocker = join(dir, 'datei');
    writeFileSync(blocker, 'kein Ordner');
    const stats = new RunStats();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      logRun(join(blocker, 'runs.jsonl'), stats)(run({ seconds: 300 }));
      expect(logged).toHaveBeenCalledOnce();
      expect(stats.runs).toBe(0);
    } finally {
      logged.mockRestore();
    }
  });
});

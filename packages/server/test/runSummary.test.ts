import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseRuns } from '../src/runLog.js';
import { formatSummary, summarize } from '../src/runSummary.js';

/**
 * Seven runs: Systemcheck on normal four times (two won, one out of time
 * stuck at the wiring, one stopped by the alarm limit at the Signalprobe),
 * once on entspannt; Blackout on hart twice (one won, one stopped at the
 * Signalkette).
 */
const FIXTURE = fileURLToPath(new URL('./fixtures/runs.jsonl', import.meta.url));
const runs = parseRuns(readFileSync(FIXTURE, 'utf8'), FIXTURE);

/** What `pnpm --filter @escapelab/server runs` prints for the fixture. */
const TABLE = [
  'blackout · hart: 2 runs, 50 % won (1), lost 0 on time and 1 on alarms, median 5:10',
  '  station       reached  solved  median s  median alarms',
  '  notstrom            2       2       110            1.5',
  '  signalkette         2       1        80            0.5',
  '  subsysteme          1       1       150            1.0',
  '  frequenz            1       1        90            0.0',
  '  reaktorstart        1       1        20            0.0',
  '  slowest: subsysteme 150 s, notstrom 110 s, frequenz 90 s',
  '',
  'systemcheck · entspannt: 1 run, 100 % won (1), lost 0 on time and 0 on alarms, median 8:00',
  '  station               reached  solved  median s  median alarms',
  '  init                        1       1        60            0.0',
  '  signalprobe                 1       1       150            3.0',
  '  doppelbestaetigung          1       1       200            2.0',
  '  synchronkalibrierung        1       1        50            0.0',
  '  slowest: doppelbestaetigung 200 s, signalprobe 150 s, init 60 s',
  '',
  'systemcheck · normal: 4 runs, 50 % won (2), lost 1 on time and 1 on alarms, median 5:25',
  '  station               reached  solved  median s  median alarms',
  '  init                        4       4        43            0.0',
  '  signalprobe                 4       3       100            1.5',
  '  doppelbestaetigung          3       2       130            1.0',
  '  synchronkalibrierung        2       2        35            0.0',
  '  slowest: doppelbestaetigung 130 s, signalprobe 100 s, init 43 s',
].join('\n');

describe('summarize', () => {
  it('groups the runs by mission, and by difficulty from the easiest', () => {
    expect(summarize(runs).map((s) => [s.missionId, s.difficulty, s.runs])).toEqual([
      ['blackout', 'hart', 2],
      ['systemcheck', 'entspannt', 1],
      ['systemcheck', 'normal', 4],
    ]);
  });

  it('takes station times over the runs that solved it, alarms over those that got there', () => {
    const normal = summarize(runs).find((s) => s.difficulty === 'normal');
    expect(normal).toMatchObject({ won: 2, lostOnTime: 1, lostOnAlarms: 1, medianSeconds: 325 });
    expect(normal?.stations).toEqual([
      { puzzleId: 'init', reached: 4, solved: 4, medianSeconds: 43, medianAlarms: 0 },
      { puzzleId: 'signalprobe', reached: 4, solved: 3, medianSeconds: 100, medianAlarms: 1.5 },
      {
        puzzleId: 'doppelbestaetigung',
        reached: 3,
        solved: 2,
        medianSeconds: 130,
        medianAlarms: 1,
      },
      {
        puzzleId: 'synchronkalibrierung',
        reached: 2,
        solved: 2,
        medianSeconds: 35,
        medianAlarms: 0,
      },
    ]);
  });

  it('names the three slowest stations, slowest first', () => {
    const slowest = summarize(runs).map((s) => s.slowest.map((station) => station.puzzleId));
    expect(slowest).toEqual([
      ['subsysteme', 'notstrom', 'frequenz'],
      ['doppelbestaetigung', 'signalprobe', 'init'],
      ['doppelbestaetigung', 'signalprobe', 'init'],
    ]);
  });

  it('has nothing to say about no runs', () => {
    expect(summarize([])).toEqual([]);
  });

  it('prints the table a balancing pass reads', () => {
    expect(formatSummary(summarize(runs))).toBe(TABLE);
  });
});

describe('the runs script', () => {
  const server = fileURLToPath(new URL('..', import.meta.url));
  /** The script as pnpm runs it: in the server package, typed from `from`. */
  const runsScript = (args: string[], from = server): string =>
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/runs.ts', ...args], {
      cwd: server,
      env: { ...process.env, INIT_CWD: from, RUNS_LOG: '' },
      encoding: 'utf8',
      stdio: 'pipe',
    });

  it('prints the table for the log it is given, from where the command was typed', () => {
    expect(runsScript(['test/fixtures/runs.jsonl'])).toBe(`${TABLE}\n`);
    expect(runsScript(['fixtures/runs.jsonl'], fileURLToPath(new URL('.', import.meta.url)))).toBe(
      `${TABLE}\n`,
    );
  });

  it('fails naming the path when there is no log', () => {
    expect(() => runsScript(['gibt-es-nicht.jsonl'])).toThrow(
      /\[runs\] no run log at .*gibt-es-nicht\.jsonl/,
    );
  });

  it('takes one log at a time', () => {
    const fixture = 'test/fixtures/runs.jsonl';
    expect(() => runsScript([fixture, fixture])).toThrow(/\[runs\] one run log at a time/);
  });
});

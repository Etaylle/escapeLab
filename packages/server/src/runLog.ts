import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIFFICULTIES, type RunOutcome, type RunReport } from '@escapelab/core';

/**
 * The run log: one line of JSON per finished run, appended, never rewritten
 * — no database. The server writes it and counts it into the Bestenliste,
 * `GET /runs.jsonl` hands it out and `scripts/runs.ts` sums it up.
 */

/** The run log unless RUNS_LOG names another: `data/runs.jsonl` in the server package. */
export const DEFAULT_RUNS_LOG = fileURLToPath(new URL('../data/runs.jsonl', import.meta.url));

/** A report as version 1 wrote it: before the crew's names and the room's code went in. */
export type RunReportV1 = Omit<RunReport, 'version' | 'crew' | 'roomCode'> & { version: 1 };

/** Any report a run log holds: version 1 from before names were kept, version 2 since. */
export type LoggedRun = RunReportV1 | RunReport;

const OUTCOMES: readonly RunOutcome[] = ['won', 'lost:time', 'lost:alarms'];

/**
 * One finished run onto the end of the log; its directory is made on demand.
 * A failed write is logged and dropped: a full disk or a wrong path must
 * never take a room down with it. Returns whether the line was written.
 */
export function appendRun(file: string, report: RunReport): boolean {
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(report)}\n`, 'utf8');
    return true;
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    console.error(
      `[escapelab] run report not written to ${file}: ${why} — point RUNS_LOG at a writable file`,
    );
    return false;
  }
}

/**
 * The runs in the text of a run log, oldest first, and what is wrong with
 * each line that holds none, by its place in `source`; blank lines are
 * skipped. For a reader that goes on past a bad line.
 */
export function readRuns(
  text: string,
  source: string,
): { runs: LoggedRun[]; problems: string[] } {
  const runs: LoggedRun[] = [];
  const problems: string[] = [];
  text.split('\n').forEach((line, i) => {
    if (line.trim() === '') {
      return;
    }
    const where = `${source}:${i + 1}`;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      problems.push(`${where}: not JSON (${why}) — fix or delete that line`);
      return;
    }
    if (isLoggedRun(parsed)) {
      runs.push(parsed);
    } else {
      problems.push(`${where}: not a run report of version 1 or 2 — fix or delete that line`);
    }
  });
  return { runs, problems };
}

/** The runs in the text of a run log, oldest first; throws naming the first line holding none. */
export function parseRuns(text: string, source: string): LoggedRun[] {
  const { runs, problems } = readRuns(text, source);
  if (problems[0] !== undefined) {
    throw new Error(problems[0]);
  }
  return runs;
}

/**
 * The fields the summary and the Bestenliste read, checked; the rest is
 * trusted to the server that wrote it.
 */
function isLoggedRun(value: unknown): value is LoggedRun {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const run = value as Partial<Record<keyof RunReport, unknown>>;
  const all = (fields: (keyof RunReport)[], type: 'string' | 'number'): boolean =>
    fields.every((field) => typeof run[field] === type);
  const common =
    all(['missionId'], 'string') &&
    DIFFICULTIES.some((difficulty) => difficulty === run.difficulty) &&
    OUTCOMES.some((outcome) => outcome === run.outcome) &&
    all(['startedAt', 'finishedAt', 'crewSize'], 'number') &&
    Array.isArray(run.stations) &&
    Array.isArray(run.penalties);
  if (run.version === 1) {
    return common;
  }
  return (
    run.version === 2 &&
    common &&
    typeof run.roomCode === 'string' &&
    Array.isArray(run.crew) &&
    run.crew.every((name) => typeof name === 'string')
  );
}

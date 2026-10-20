import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunReport } from '@escapelab/core';

/**
 * The run log: one line of JSON per finished run, appended, never rewritten
 * — no database. The server writes it, `GET /runs.jsonl` hands it out and
 * `scripts/runs.ts` sums it up.
 */

/** The run log unless RUNS_LOG names another: `data/runs.jsonl` in the server package. */
export const DEFAULT_RUNS_LOG = fileURLToPath(new URL('../data/runs.jsonl', import.meta.url));

/**
 * One finished run onto the end of the log; its directory is made on demand.
 * A failed write is logged and dropped: a full disk or a wrong path must
 * never take a room down with it.
 */
export function appendRun(file: string, report: RunReport): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(report)}\n`, 'utf8');
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    console.error(
      `[escapelab] run report not written to ${file}: ${why} — point RUNS_LOG at a writable file`,
    );
  }
}

/**
 * The runs in the text of a run log, oldest first; blank lines are skipped.
 * Throws naming the first line that is no run report of version 1.
 */
export function parseRuns(text: string, source: string): RunReport[] {
  return text.split('\n').flatMap((line, i) => {
    if (line.trim() === '') {
      return [];
    }
    const where = `${source}:${i + 1}`;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      throw new Error(`${where}: not JSON (${why}) — fix or delete that line`);
    }
    if (!isRunReport(parsed)) {
      throw new Error(`${where}: not a run report of version 1 — fix or delete that line`);
    }
    return [parsed];
  });
}

/** The fields a summary reads, checked; the rest is trusted to the server that wrote it. */
function isRunReport(value: unknown): value is RunReport {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const run = value as Partial<Record<keyof RunReport, unknown>>;
  const all = (fields: (keyof RunReport)[], type: 'string' | 'number'): boolean =>
    fields.every((field) => typeof run[field] === type);
  return (
    run.version === 1 &&
    all(['missionId', 'difficulty', 'outcome'], 'string') &&
    all(['startedAt', 'finishedAt'], 'number') &&
    Array.isArray(run.stations)
  );
}

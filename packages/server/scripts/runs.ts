/**
 * The balancing table: reads a run log — one JSON report per finished run,
 * as the server appends them — and prints per mission and difficulty the
 * runs, the win rate and the median duration, per station the median
 * seconds and alarms, and the three slowest stations.
 * Run with: pnpm --filter @escapelab/server runs [file]
 * Without a file it reads RUNS_LOG, else the server's default log.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_RUNS_LOG, parseRuns } from '../src/runLog.js';
import { formatSummary, summarize } from '../src/runSummary.js';

function fail(message: string): never {
  console.error(`[runs] ${message}`);
  process.exit(1);
}

const [given, ...more] = process.argv.slice(2).filter((arg) => arg !== '--');
if (more.length > 0) {
  fail(`one run log at a time — got ${[given, ...more].join(', ')}`);
}
// pnpm runs this in the server package; a path on the command line is meant from where it
// was typed.
const file =
  given === undefined
    ? process.env['RUNS_LOG'] || DEFAULT_RUNS_LOG
    : resolve(process.env['INIT_CWD'] ?? process.cwd(), given);
if (!existsSync(file)) {
  fail(`no run log at ${file} — name one (runs <file>) or set RUNS_LOG`);
}

let runs: ReturnType<typeof parseRuns>;
try {
  runs = parseRuns(readFileSync(file, 'utf8'), file);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
console.log(runs.length === 0 ? `No runs in ${file} yet.` : formatSummary(summarize(runs)));

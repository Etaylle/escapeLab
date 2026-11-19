import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * The database's migrations, applied by the server itself before it opens the store (store.ts
 * `readyStore`): a Start Command that starts `node` straight, as Render's does, runs no script
 * before it, so the server runs the server package's Prisma CLI — the only one to run it as the
 * server starts: `pnpm run start` runs none before it, for Prisma's own lines name the database's
 * host, and the server's log never does (`shownLines`).
 */

/** The server package, where the Prisma CLI finds the schema and the migrations. */
const SERVER = fileURLToPath(new URL('../..', import.meta.url));
/** The server package's Prisma CLI. */
const PRISMA = fileURLToPath(new URL('../../node_modules/.bin/prisma', import.meta.url));

/** How a run of the Prisma CLI ended: its exit code, and what it said on both streams. */
export interface CliRun {
  code: number | null;
  output: string;
}

/** The server package's Prisma CLI run with `args`, `env` its environment. */
export type RunCli = (args: string[], env: NodeJS.ProcessEnv) => Promise<CliRun>;

/** `RunCli` by the server package's own Prisma CLI. */
export const runPrisma: RunCli = (args, env) =>
  new Promise((resolve, reject) => {
    const cli = spawn(PRISMA, args, {
      cwd: SERVER,
      env: { ...env, CHECKPOINT_DISABLE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const said = (chunk: unknown): void => {
      output += String(chunk);
    };
    cli.stdout.on('data', said);
    cli.stderr.on('data', said);
    cli.once('error', reject);
    cli.once('close', (code) => resolve({ code, output }));
  });

/**
 * DATABASE_URL_UNPOOLED — the direct URL the migrations take, prisma/schema.prisma's
 * `directUrl` — set to DATABASE_URL where it is unset or empty, as the package's `prisma` script
 * sets it: a single direct URL does for both, whatever started the server.
 */
export function defaultDirectUrl(env: NodeJS.ProcessEnv): void {
  const url = env['DATABASE_URL'] ?? '';
  if (url !== '' && (env['DATABASE_URL_UNPOOLED'] ?? '') === '') {
    env['DATABASE_URL_UNPOOLED'] = url;
  }
}

/** A database URL, which the log never shows. */
const DATABASE_URL_SHAPE = /\b(?:postgres(?:ql)?|prisma(?:\+postgres)?):\/\/\S+/gi;

/**
 * The database server as Prisma's connection errors name it — P1000 to P1003, „… database
 * server at `host:5432`", P1002's „at `host`:`5432`" — which the log never shows.
 */
const SERVER_SHAPE = /\bat `[^`]*`(?::`[^`]*`)?/g;

/** The database user as Prisma's errors name it — P1000's credentials, P1010's denial. */
const USER_SHAPE = /\b(credentials for|User) `[^`]*`/g;

/**
 * What the CLI said, line by line, as the log may show it: no empty line, not the line naming
 * the datasource's database and host, and no database URL, server or user.
 */
export function shownLines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('Datasource '))
    .map((line) =>
      line
        .replace(DATABASE_URL_SHAPE, '<database URL>')
        .replace(SERVER_SHAPE, 'at `<host>`')
        .replace(USER_SHAPE, '$1 `<user>`'),
    );
}

/** A pause of `ms` milliseconds. */
export type Wait = (ms: number) => Promise<void>;

const sleep: Wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The pauses before each further attempt where the database cannot be reached (P1001), ms: a
 * Neon compute suspended after 5 idle minutes takes seconds to wake, and the CLI's first
 * connection may time out meanwhile. Four attempts, 14 s of pauses — with the CLI's own up to
 * ~5 s per attempt well under 45 s in all, so a start from sleep stays a short one.
 */
const UNREACHABLE_PAUSES_MS = [2_000, 4_000, 8_000];

/** The only failure worth another attempt: the database server could not be reached. */
const UNREACHABLE = 'P1001';

/** Prisma's error code in what the CLI said, or the exit code where it named none. */
const errorOf = ({ code, output }: CliRun): string =>
  /\bP\d{4}\b/.exec(output)?.[0] ?? `exit code ${code ?? 'none'}`;

/** How an attempt ended, as its line says: `error` null where the migrations applied. */
const outcomeOf = (error: string | null): string => {
  if (error === null) {
    return 'applied';
  }
  return error === UNREACHABLE ? 'database not reachable (P1001)' : error;
};

/** What the migrations' log says, line by line. */
const said = (line: string): void => console.log(`[escapelab] migrate: ${line}`);

/**
 * The last attempt's end: its line (`outcome`) where it is not the first, the CLI's lines, and
 * the rejection where the migrations did not apply.
 */
function lastAttempt(result: CliRun, error: string | null, attempt: number, outcome: string): void {
  if (attempt > 1) {
    said(error === null ? outcome : `${outcome}, giving up`);
  }
  shownLines(result.output).forEach(said);
  if (error !== null) {
    throw new Error(`the migrations did not apply (${error}), as the migrate lines above say`);
  }
}

/**
 * The database's migrations applied (`prisma migrate deploy`), what the CLI said logged line by
 * line (`shownLines`). Where the database cannot be reached (P1001) — a Neon compute waking —
 * it tries again after each of UNREACHABLE_PAUSES_MS, one line per attempt, the CLI's lines of
 * the last attempt only. Rejects, naming Prisma's error code — P3009 for a migration that broke
 * off at once, P1001 after the last attempt (README, „Hosting auf Render") — where they did not
 * apply.
 */
export async function migrate(
  env: NodeJS.ProcessEnv,
  run: RunCli = runPrisma,
  wait: Wait = sleep,
): Promise<void> {
  const attempts = UNREACHABLE_PAUSES_MS.length + 1;
  for (let attempt = 1; ; attempt += 1) {
    const result = await run(['migrate', 'deploy'], env);
    const error = result.code === 0 ? null : errorOf(result);
    const pause = error === UNREACHABLE ? UNREACHABLE_PAUSES_MS[attempt - 1] : undefined;
    const outcome = `attempt ${attempt} of ${attempts}: ${outcomeOf(error)}`;
    if (pause === undefined) {
      lastAttempt(result, error, attempt, outcome);
      return;
    }
    said(`${outcome}, again in ${pause / 1000} s`);
    await wait(pause);
  }
}

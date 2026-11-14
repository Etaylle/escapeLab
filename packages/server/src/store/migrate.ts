import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * The database's migrations, applied by the server itself before it opens the store (store.ts
 * `readyStore`): a Start Command that starts `node` straight, as Render's does, runs no script
 * before it, so the server runs the server package's Prisma CLI as the start script would.
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
 * What the CLI said, line by line, as the log may show it: no empty line, not the line naming
 * the datasource's database and host, and no database URL.
 */
export function shownLines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('Datasource '))
    .map((line) => line.replace(DATABASE_URL_SHAPE, '<database URL>'));
}

/**
 * The database's migrations applied (`prisma migrate deploy`), what the CLI said logged line by
 * line (`shownLines`). Rejects, naming Prisma's error code — P3009 for a migration that broke
 * off, P1001 for a database that cannot be reached (README, „Hosting auf Render") — where they
 * did not apply.
 */
export async function migrate(env: NodeJS.ProcessEnv, run: RunCli = runPrisma): Promise<void> {
  const { code, output } = await run(['migrate', 'deploy'], env);
  for (const line of shownLines(output)) {
    console.log(`[escapelab] migrate: ${line}`);
  }
  if (code !== 0) {
    const error = /\bP\d{4}\b/.exec(output)?.[0] ?? `exit code ${code ?? 'none'}`;
    throw new Error(`the migrations did not apply (${error}), as the migrate lines above say`);
  }
}

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import type { TestProject } from 'vitest/node';

/**
 * The tests' Postgres, where TEST_DATABASE_URL names one the tests may write to: a schema of this
 * run's own, migrated with the committed migrations before the first test (`prisma migrate
 * deploy`, as the server runs it as it starts), dropped after the last; the tests reach it by
 * `inject('postgresUrl')` and empty its tables as they need. Without the variable the store's
 * tests in Postgres are skipped, and one line at the end of the run says so — and how to run
 * them where docker is at hand.
 */

declare module 'vitest' {
  export interface ProvidedContext {
    /** the tests' schema in TEST_DATABASE_URL's database; null without the variable */
    postgresUrl: string | null;
  }
}

const SERVER = fileURLToPath(new URL('..', import.meta.url));
const PRISMA = join(SERVER, 'node_modules', '.bin', 'prisma');
/** How long a database just started gets to answer, ms. */
const ANSWER_MS = 30_000;

/** `base` with its Postgres schema set to `schema`, as Prisma takes it (`?schema=`). */
export function inSchema(base: string, schema: string): string {
  const url = new URL(base);
  url.searchParams.set('schema', schema);
  return url.toString();
}

/**
 * The Prisma CLI run in the server package against `url`, the pooled and the direct URL both —
 * one the shell holds steers it nowhere else: its exit code and what it said.
 */
export function prisma(args: string[], url: string): { status: number | null; output: string } {
  const run = spawnSync(PRISMA, args, {
    cwd: SERVER,
    env: { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: url, CHECKPOINT_DISABLE: '1' },
    encoding: 'utf8',
  });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

/** Resolves once the database at `url` answers; rejects, saying so, after ANSWER_MS. */
async function answers(db: PrismaClient): Promise<void> {
  const until = Date.now() + ANSWER_MS;
  for (;;) {
    try {
      await db.$queryRaw`SELECT 1`;
      return;
    } catch (err) {
      if (Date.now() > until) {
        const why = err instanceof Error ? err.message.replace(/\s+/g, ' ') : String(err);
        throw new Error(`TEST_DATABASE_URL does not answer within ${ANSWER_MS / 1000} s: ${why}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

/** What the run says at its end where it ran no test against Postgres. */
export function skippedLine(dockerAtHand: boolean): string {
  const how = dockerAtHand
    ? 'docker run --rm -d -p 55432:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16 && ' +
      'TEST_DATABASE_URL=postgresql://postgres@localhost:55432/postgres ' +
      'pnpm --filter @escapelab/server test'
    : 'set TEST_DATABASE_URL to a Postgres the tests may write to';
  return `[postgres] TEST_DATABASE_URL unset: the store's tests in Postgres were skipped — ${how}`;
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const base = process.env['TEST_DATABASE_URL'];
  if (base === undefined || base === '') {
    project.provide('postgresUrl', null);
    const docker = spawnSync('docker', ['--version']).status === 0;
    return async () => console.log(skippedLine(docker));
  }
  const schema = `test_${process.pid}_${randomBytes(3).toString('hex')}`;
  const url = inSchema(base, schema);
  const db = new PrismaClient({ datasourceUrl: url });
  await answers(db);
  const deployed = prisma(['migrate', 'deploy'], url);
  if (deployed.status !== 0) {
    await db.$disconnect();
    throw new Error(`the migrations did not apply to the tests' schema:\n${deployed.output}`);
  }
  project.provide('postgresUrl', url);
  return async () => {
    await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await db.$disconnect();
  };
}

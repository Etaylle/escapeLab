import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { openStore } from '../src/store/store.js';
import { inSchema, prisma } from './postgresSetup.js';
import { identityOf } from './storeContract.js';

/**
 * Neon's integration on Render sets two URLs: DATABASE_URL, through Neon's pooler, which the
 * server's queries take, and DATABASE_URL_UNPOOLED, direct, which the migrations take — Prisma's
 * schema engine does not go through PgBouncer. Render may as well set DATABASE_URL alone, a
 * direct one: then it does for both. In TEST_DATABASE_URL's database, each case in schemas of its
 * own; skipped without the variable.
 */

const url = inject('postgresUrl');
const REPO = fileURLToPath(new URL('../../..', import.meta.url));
/** What the committed migrations make in a schema: their tables, and Prisma's own. */
const MIGRATED = [
  '_prisma_migrations',
  'accounts',
  'achievements',
  'identities',
  'run_members',
  'runs',
];

/**
 * The migrations applied as one applies them by hand (`pnpm --filter @escapelab/server prisma
 * migrate deploy`, the package's `prisma` script), `env` the only database variables — none the
 * shell holds: its exit code and what it said.
 */
function deploy(env: Record<string, string>): { status: number | null; output: string } {
  const own = { ...process.env };
  delete own['DATABASE_URL'];
  delete own['DATABASE_URL_UNPOOLED'];
  const run = spawnSync('pnpm', ['--filter', '@escapelab/server', 'prisma', 'migrate', 'deploy'], {
    cwd: REPO,
    env: { ...own, ...env },
    encoding: 'utf8',
  });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

describe.skipIf(url === null)("Neon's two URLs", () => {
  const run = randomBytes(3).toString('hex');
  const made: string[] = [];
  let db: PrismaClient;

  /** A schema of this file's own for `what`, and its URL; dropped after the file. */
  const schemaFor = (what: string): { name: string; url: string } => {
    const name = `urls_${run}_${what}`;
    made.push(name);
    return { name, url: inSchema(url ?? '', name) };
  };

  /** The tables in the schema `name`, by name; none where there is no such schema. */
  const tablesIn = async (name: string): Promise<string[]> => {
    const rows = await db.$queryRawUnsafe<{ table_name: string }[]>(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = $1',
      name,
    );
    return rows.map((row) => row.table_name).sort();
  };

  beforeAll(() => {
    db = new PrismaClient({ datasourceUrl: url ?? '' });
  });

  afterAll(async () => {
    for (const name of made) {
      await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
    }
    await db.$disconnect();
  });

  describe("the migrations' URL", () => {
    it('is DATABASE_URL_UNPOOLED, the direct one, where it is set beside DATABASE_URL', async () => {
      const pooled = schemaFor('pooled');
      const direct = schemaFor('direct');
      const deployed = deploy({ DATABASE_URL: pooled.url, DATABASE_URL_UNPOOLED: direct.url });
      expect(deployed.status, deployed.output).toBe(0);
      expect(await tablesIn(direct.name)).toEqual(MIGRATED);
      expect(await tablesIn(pooled.name)).toEqual([]);
    });

    it('is DATABASE_URL where it stands alone: DATABASE_URL_UNPOOLED unset or empty', async () => {
      for (const [what, unpooled] of [
        ['unset', {}],
        ['empty', { DATABASE_URL_UNPOOLED: '' }],
      ] as const) {
        const only = schemaFor(what);
        const deployed = deploy({ DATABASE_URL: only.url, ...unpooled });
        expect(deployed.status, `${what}: ${deployed.output}`).toBe(0);
        expect(await tablesIn(only.name)).toEqual(MIGRATED);
      }
    });
  });

  describe("the server's URL", () => {
    it('is DATABASE_URL, the pooled one, though DATABASE_URL_UNPOOLED is set', async () => {
      // Only the pooled schema is migrated: a store over the direct one could not read its runs.
      const pooled = schemaFor('server');
      const direct = schemaFor('unmigrated');
      const migrated = prisma(['migrate', 'deploy'], pooled.url);
      expect(migrated.status, migrated.output).toBe(0);
      const env = { DATABASE_URL: pooled.url, DATABASE_URL_UNPOOLED: direct.url };
      const runsLog = join(mkdtempSync(join(tmpdir(), 'escapelab-urls-')), 'runs.jsonl');
      const store = await openStore(env, runsLog);
      try {
        expect(store.kind).toBe('database');
        await store.getOrCreateByIdentity(identityOf('Anna'), { displayName: 'Anna', colour: null });
      } finally {
        await store.close();
      }
      const accounts = await db.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM "${pooled.name}".accounts`,
      );
      expect(accounts).toEqual([{ n: 1 }]);
      expect(await tablesIn(direct.name)).toEqual([]);
    });
  });
});

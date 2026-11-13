import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The database's schema as the committed migrations make it, against a Postgres the tests may
 * write to (TEST_DATABASE_URL): the migrations go into a schema of this run's own, which is
 * dropped after. Without the variable there is nothing to run against.
 */

const SERVER = fileURLToPath(new URL('..', import.meta.url));
const PRISMA = join(SERVER, 'node_modules', '.bin', 'prisma');
const BASE = process.env['TEST_DATABASE_URL'];

/** `base` with its Postgres schema set to `schema`, as Prisma takes it (`?schema=`). */
function inSchema(base: string, schema: string): string {
  const url = new URL(base);
  url.searchParams.set('schema', schema);
  return url.toString();
}

/** The Prisma CLI run in the server package on the database at `url`: its exit code and output. */
function prisma(args: string[], url: string): { status: number | null; output: string } {
  const run = spawnSync(PRISMA, args, {
    cwd: SERVER,
    env: { ...process.env, DATABASE_URL: url, CHECKPOINT_DISABLE: '1' },
    encoding: 'utf8',
  });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

describe.skipIf(BASE === undefined)('the migrations', () => {
  const schema = `test_schema_${randomBytes(4).toString('hex')}`;
  let url = '';
  let db: PrismaClient;

  beforeAll(() => {
    url = inSchema(BASE ?? '', schema);
    db = new PrismaClient({ datasourceUrl: url });
    const deployed = prisma(['migrate', 'deploy'], url);
    expect(deployed.status, deployed.output).toBe(0);
  });

  afterAll(async () => {
    await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await db.$disconnect();
  });

  it('make exactly the schema prisma/schema.prisma describes', () => {
    const args = ['migrate', 'diff', '--from-url', url];
    const diff = prisma([...args, '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'], url);
    // 0: no difference; 2: the schema says more or other than the migrations make.
    expect(diff.status, diff.output).toBe(0);
  });

  it('name every table and column in snake_case', async () => {
    const columns = await db.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
      'SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = $1',
      schema,
    );
    const ours = columns.filter((c) => c.table_name !== '_prisma_migrations');
    expect(new Set(ours.map((c) => c.table_name))).toEqual(
      new Set(['accounts', 'identities', 'runs', 'run_members', 'achievements']),
    );
    const named = ours.flatMap((c) => [c.table_name, c.column_name]);
    expect(named.filter((name) => !/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(name))).toEqual([]);
  });

  it('index every foreign key, by the leading columns of an index', async () => {
    const keys = await db.$queryRawUnsafe<{ tbl: string; name: string; cols: number[] }[]>(
      `SELECT t.relname AS tbl, c.conname AS name, c.conkey::int[] AS cols
         FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE c.contype = 'f' AND n.nspname = $1`,
      schema,
    );
    const indexes = await db.$queryRawUnsafe<{ tbl: string; cols: number[] }[]>(
      `SELECT t.relname AS tbl, i.indkey::int[] AS cols
         FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = $1`,
      schema,
    );
    expect(keys.map((key) => key.name).sort()).toEqual([
      'achievements_account_id_fkey',
      'identities_account_id_fkey',
      'run_members_account_id_fkey',
      'run_members_run_id_fkey',
    ]);
    const leads = (index: { cols: number[] }, cols: number[]): boolean =>
      cols.every((col, i) => index.cols[i] === col);
    const bare = keys.filter(
      (key) => !indexes.some((index) => index.tbl === key.tbl && leads(index, key.cols)),
    );
    expect(bare.map((key) => key.name)).toEqual([]);
  });

  it('index the runs the Bestenliste counts by mission, difficulty and outcome', async () => {
    const defs = await db.$queryRawUnsafe<{ indexdef: string }[]>(
      "SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = 'runs'",
      schema,
    );
    expect(defs.map((d) => d.indexdef).join('\n')).toContain(
      '(mission_id, difficulty, outcome)',
    );
  });
});

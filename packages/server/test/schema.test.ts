import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { prisma } from './postgresSetup.js';

/**
 * The database's schema as the committed migrations make it, in the schema the run migrated in
 * TEST_DATABASE_URL's database (postgresSetup.ts). Without the variable there is nothing to run
 * against.
 */

const url = inject('postgresUrl');

describe.skipIf(url === null)('the migrations', () => {
  const schema = url === null ? '' : (new URL(url).searchParams.get('schema') ?? '');
  let db: PrismaClient;

  beforeAll(() => {
    db = new PrismaClient({ datasourceUrl: url ?? '' });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('make exactly the schema prisma/schema.prisma describes', () => {
    const args = ['migrate', 'diff', '--from-url', url ?? '', '--to-schema-datamodel'];
    const diff = prisma([...args, 'prisma/schema.prisma', '--exit-code'], url ?? '');
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

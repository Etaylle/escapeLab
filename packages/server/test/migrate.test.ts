import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { defaultDirectUrl, migrate, shownLines, type RunCli } from '../src/store/migrate.js';
import { openStore, readyStore, type ReadySteps, type Store } from '../src/store/store.js';
import { inSchema } from './postgresSetup.js';

/**
 * The server migrates the database itself before it opens the store, and so before it listens:
 * Render's Start Command starts `node` straight in packages/server, and no script runs before
 * it. Without a database: the steps spied on, the CLI's answers made up. In TEST_DATABASE_URL's
 * database: the CLI as the server runs it, each case in a schema of its own.
 */

const url = inject('postgresUrl');
const runsLog = (): string => join(mkdtempSync(join(tmpdir(), 'escapelab-migrate-')), 'runs.jsonl');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the direct URL', () => {
  it('is DATABASE_URL where DATABASE_URL_UNPOOLED is unset or empty: one URL does for both', () => {
    for (const unpooled of [{}, { DATABASE_URL_UNPOOLED: '' }]) {
      const env: NodeJS.ProcessEnv = { DATABASE_URL: 'direct', ...unpooled };
      defaultDirectUrl(env);
      expect(env['DATABASE_URL_UNPOOLED']).toBe('direct');
    }
  });

  it('stays as Neon set it, and is none without a database', () => {
    const neon: NodeJS.ProcessEnv = { DATABASE_URL: 'pooled', DATABASE_URL_UNPOOLED: 'direct' };
    defaultDirectUrl(neon);
    expect(neon['DATABASE_URL_UNPOOLED']).toBe('direct');
    const none: NodeJS.ProcessEnv = { DATABASE_URL: '' };
    defaultDirectUrl(none);
    expect('DATABASE_URL_UNPOOLED' in none).toBe(false);
  });
});

describe('the start', () => {
  /** The steps of readying the store, spied on; the migrations end as `migrated` does. */
  const spied = (migrated: () => Promise<void> = async () => undefined) => ({
    migrate: vi.fn<ReadySteps['migrate']>(migrated),
    open: vi.fn<ReadySteps['open']>(async () => ({ kind: 'database' }) as Store),
  });

  it('applies the migrations, its direct URL defaulted, then opens the store', async () => {
    let applied = (): void => undefined;
    const steps = spied(() => new Promise<void>((resolve) => (applied = resolve)));
    const ready = readyStore({ DATABASE_URL: 'direct' }, runsLog(), steps);
    await new Promise((resolve) => setImmediate(resolve));
    expect(steps.migrate).toHaveBeenCalledWith({
      DATABASE_URL: 'direct',
      DATABASE_URL_UNPOOLED: 'direct',
    });
    expect(steps.open).not.toHaveBeenCalled();
    applied();
    await ready;
    expect(steps.open).toHaveBeenCalledTimes(1);
  });

  it('opens no store where the migrations do not apply, and says why', async () => {
    const steps = spied(async () => {
      throw new Error('the migrations did not apply (P3009), as the migrate lines above say');
    });
    await expect(readyStore({ DATABASE_URL: 'direct' }, runsLog(), steps)).rejects.toThrow(
      'the migrations did not apply (P3009)',
    );
    expect(steps.open).not.toHaveBeenCalled();
  });

  it('migrates nothing without a database: the run log and the accounts in memory', async () => {
    const steps = spied();
    await readyStore({ DATABASE_URL: '' }, runsLog(), steps);
    expect(steps.migrate).not.toHaveBeenCalled();
    expect(steps.open).toHaveBeenCalledTimes(1);
  });
});

describe('the migrations as the server applies them', () => {
  /** What the CLI says as it finds every migration applied already. */
  const UP_TO_DATE = [
    'Prisma schema loaded from prisma/schema.prisma',
    'Datasource "db": PostgreSQL database "lab", schema "public" at "ep-quiet-lab.neon.tech"',
    '',
    '2 migrations found in prisma/migrations',
    '',
    'No pending migrations to apply.',
  ].join('\n');

  it('logs what the CLI said line by line, but the line naming database and host', async () => {
    const said = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await migrate({}, async () => ({ code: 0, output: UP_TO_DATE }));
    expect(said.mock.calls.map(([line]) => String(line))).toEqual([
      '[escapelab] migrate: Prisma schema loaded from prisma/schema.prisma',
      '[escapelab] migrate: 2 migrations found in prisma/migrations',
      '[escapelab] migrate: No pending migrations to apply.',
    ]);
  });

  it("rejects naming Prisma's error code where they did not apply", async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const run: RunCli = async () => ({
      code: 1,
      output: 'Error: P3009\n\nmigrate found failed migrations in the target database\n',
    });
    await expect(migrate({}, run)).rejects.toThrow('the migrations did not apply (P3009)');
    const silent: RunCli = async () => ({ code: 1, output: '' });
    await expect(migrate({}, silent)).rejects.toThrow('the migrations did not apply (exit code 1)');
  });

  it('shows no database URL, whatever the CLI said', () => {
    const said = 'Error: P1013: The provided database string is invalid: postgresql://a:b@db/lab x';
    expect(shownLines(said)).toEqual([
      'Error: P1013: The provided database string is invalid: <database URL> x',
    ]);
  });

  it("names no server, port or user where Prisma's connection errors name them", () => {
    const host = 'ep-quiet-lab-123456.eu-central-1.aws.neon.tech';
    const said = [
      `Error: P1001: Can't reach database server at \`${host}:5432\``,
      `Please make sure your database server is running at \`${host}:5432\`.`,
      `Error: P1000: Authentication failed against database server at \`${host}\`, the ` +
        'provided database credentials for `anna` are not valid.',
      `Error: P1002: The database server at \`${host}\`:\`5432\` was reached but timed out.`,
      'Error: P1010: User `anna` was denied access on the database `lab`',
    ].join('\n');
    expect(shownLines(said)).toEqual([
      "Error: P1001: Can't reach database server at `<host>`",
      'Please make sure your database server is running at `<host>`.',
      'Error: P1000: Authentication failed against database server at `<host>`, the provided ' +
        'database credentials for `<user>` are not valid.',
      'Error: P1002: The database server at `<host>` was reached but timed out.',
      'Error: P1010: User `<user>` was denied access on the database `lab`',
    ]);
  });

  it('logs a database it cannot reach without its host or its user (P1001)', async () => {
    const said = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    // Nobody listens on port 1: the CLI as the server runs it fails at once.
    const nowhere = 'postgresql://anna@127.0.0.1:1/lab';
    const env = { ...process.env, DATABASE_URL: nowhere, DATABASE_URL_UNPOOLED: nowhere };
    await expect(migrate(env)).rejects.toThrow('the migrations did not apply (P1001)');
    const lines = said.mock.calls.map(([line]) => String(line));
    expect(lines).toContain(
      "[escapelab] migrate: Error: P1001: Can't reach database server at `<host>`",
    );
    expect(lines.filter((line) => /127\.0\.0\.1|anna|:\/\//.test(line))).toEqual([]);
  });
});

describe.skipIf(url === null)('the migrations in Postgres', () => {
  const run = randomBytes(3).toString('hex');
  const made: string[] = [];
  const host = url === null ? '' : new URL(url).hostname;
  let db: PrismaClient;

  /** A schema of this file's own for `what`, and its URL; dropped after the file. */
  const schemaFor = (what: string): { name: string; url: string } => {
    const name = `mig_${run}_${what}`;
    made.push(name);
    return { name, url: inSchema(url ?? '', name) };
  };

  /** The server's environment with DATABASE_URL alone of the database's variables. */
  const alone = (databaseUrl: string): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: databaseUrl };
    delete env['DATABASE_URL_UNPOOLED'];
    return env;
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

  it('apply over DATABASE_URL alone, saying so, and naming no URL and no host', async () => {
    const said = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const only = schemaFor('only');
    const store = await readyStore(alone(only.url), runsLog());
    await store.close();
    const lines = said.mock.calls.map(([line]) => String(line));
    expect(lines).toContain('[escapelab] migrate: All migrations have been successfully applied.');
    expect(lines.filter((line) => line.includes('://') || line.includes(host))).toEqual([]);
    expect(store.kind).toBe('database');
  });

  it('stop the start where one broke off (P3009): the store is not opened', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const broken = schemaFor('broken');
    const env = alone(broken.url);
    await migrate({ ...env, DATABASE_URL_UNPOOLED: broken.url });
    // As a deploy cut short leaves it: the last migration started, never finished.
    await db.$executeRawUnsafe(
      `UPDATE "${broken.name}"._prisma_migrations SET finished_at = NULL WHERE migration_name =
         (SELECT max(migration_name) FROM "${broken.name}"._prisma_migrations)`,
    );
    const open = vi.fn<ReadySteps['open']>();
    await expect(readyStore(env, runsLog(), { migrate, open })).rejects.toThrow(
      'the migrations did not apply (P3009)',
    );
    expect(open).not.toHaveBeenCalled();
  });

  it('leave the client DATABASE_URL alone to start on: the direct URL is the CLI’s', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const only = schemaFor('client');
    await migrate({ ...alone(only.url), DATABASE_URL_UNPOOLED: only.url });
    const kept = {
      url: process.env['DATABASE_URL'],
      unpooled: process.env['DATABASE_URL_UNPOOLED'],
    };
    process.env['DATABASE_URL'] = only.url;
    delete process.env['DATABASE_URL_UNPOOLED'];
    try {
      // As Prisma reads its environment, and as the store makes its client.
      const client = new PrismaClient();
      try {
        expect(await client.account.count()).toBe(0);
      } finally {
        await client.$disconnect();
      }
      const store = await openStore({ DATABASE_URL: only.url }, runsLog());
      expect(store.kind).toBe('database');
      await store.close();
    } finally {
      for (const [name, value] of [
        ['DATABASE_URL', kept.url],
        ['DATABASE_URL_UNPOOLED', kept.unpooled],
      ] as const) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }
  });
});

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { PostgresStore } from '../src/store/postgres.js';
import type { Store } from '../src/store/store.js';
import {
  DAY,
  finished,
  identityOf,
  reportOf,
  storeContract,
  withAccounts,
} from './storeContract.js';

/**
 * The store in Postgres, in the schema the run migrated in TEST_DATABASE_URL's database
 * (postgresSetup.ts), its tables emptied before every test: the store contract, and what only a
 * database keeps to. Skipped without the variable.
 */

const url = inject('postgresUrl') ?? '';
const schema = url === '' ? '' : (new URL(url).searchParams.get('schema') ?? '');
let db: PrismaClient;
/** Every store a test opened: closed after the suite. */
const opened: Store[] = [];

async function open(): Promise<Store> {
  const store = await PostgresStore.open(url);
  opened.push(store);
  return store;
}

/** A store whose connections go by the name `app` in the database, so that a test finds them. */
async function openNamed(app: string): Promise<Store> {
  const named = new URL(url);
  named.searchParams.set('application_name', app);
  const store = await PostgresStore.open(named.toString());
  opened.push(store);
  return store;
}

/** Every connection named `app` closed by the database, as Neon closes idle ones; then gone. */
async function closeConnections(app: string): Promise<void> {
  const named = `FROM pg_stat_activity WHERE application_name = '${app}'`;
  await db.$queryRawUnsafe(`SELECT pg_terminate_backend(pid) ${named}`);
  await vi.waitFor(async () => {
    expect(await db.$queryRawUnsafe(`SELECT pid ${named}`)).toEqual([]);
  });
}

describe.skipIf(url === '')('the store in Postgres', () => {
  beforeAll(() => {
    db = new PrismaClient({ datasourceUrl: url });
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(
      'TRUNCATE accounts, identities, runs, run_members, achievements CASCADE',
    );
  });

  afterAll(async () => {
    await Promise.all(opened.map((store) => store.close()));
    await db.$disconnect();
  });

  storeContract('Postgres', async () => ({ store: await open(), reopen: open }));

  describe('Postgres alone', () => {
    it('takes a deleted account’s name and deeds off its runs, the runs standing', async () => {
      const store = await open();
      const gone = await store.getOrCreateByIdentity(identityOf('Anna'), {
        displayName: 'Anna',
        colour: null,
      });
      await withAccounts(store, ['Ben']);
      await store.appendRun(finished({ crew: ['Anna', 'Ben'] }, ['Anna', 'Ben']));
      await store.deleteAccount(gone.id);
      const [run] = await store.runs();
      expect(run).toMatchObject({ crew: ['', 'Ben'], crewSize: 2 });
      expect(run?.version === 2 ? Object.keys(run.credits) : []).toEqual(['p2']);
      const top = store.stats().mission('blackout')?.difficulties[0]?.top;
      expect(top?.map((entry) => [entry.crew, entry.crewSize])).toEqual([[['Ben'], 2]]);
      expect((await open()).stats().mission('blackout')?.difficulties[0]?.top[0]?.crew).toEqual([
        'Ben',
      ]);
    });

    it('keeps no name of a seat without an account: one deleted meanwhile, or none', async () => {
      const store = await open();
      const anna = { displayName: 'Anna', colour: null };
      const gone = await store.getOrCreateByIdentity(identityOf('Anna'), anna);
      await withAccounts(store, ['Ben']);
      // Anna's account went while the run was on; Cleo's pass never had one.
      await store.deleteAccount(gone.id);
      await store.appendRun(finished({ crew: ['Anna', 'Ben', 'Cleo'] }, ['Anna', 'Ben', null]));
      const seats = await db.runMember.findMany({ orderBy: { seat: 'asc' } });
      expect(seats.map((s) => [s.seat, s.seatName, s.accountId === null])).toEqual([
        [0, '', true],
        [1, 'Ben', false],
        [2, '', true],
      ]);
      expect(await store.runs()).toMatchObject([{ crew: ['', 'Ben', ''] }]);
      const top = (opened: Store) => opened.stats().mission('blackout')?.difficulties[0]?.top;
      expect(top(store)?.map((entry) => entry.crew)).toEqual([['Ben']]);
      expect(top(await open())?.map((entry) => entry.crew)).toEqual([['Ben']]);
    });

    it('keeps the accounts over a restart', async () => {
      const store = await open();
      const made = await store.getOrCreateByIdentity(identityOf('Anna'), {
        displayName: 'Anna',
        colour: '#2dd4bf',
      });
      await withAccounts(store, ['Ben']);
      await store.appendRun(finished({ at: DAY }, ['Anna', 'Ben']));
      const again = await open();
      const found = await again.getOrCreateByIdentity(identityOf('Anna'), {
        displayName: 'Andere',
        colour: null,
      });
      expect(found).toMatchObject({ id: made.id, displayName: 'Anna', colour: '#2dd4bf' });
      expect((await again.runsOfAccount(made.id, 5)).runs.map(({ run }) => run)).toEqual([
        reportOf({ at: DAY }),
      ]);
    });

    it('makes one account of a pass that arrives twice at once', async () => {
      const store = await open();
      const profile = { displayName: 'Anna', colour: null };
      const both = await Promise.all([
        store.getOrCreateByIdentity(identityOf('Anna'), profile),
        store.getOrCreateByIdentity(identityOf('Anna'), profile),
      ]);
      expect(both[0].id).toBe(both[1].id);
      expect(await db.account.count()).toBe(1);
    });

    it('leaves out a run the database holds that is no report, saying so', async () => {
      const store = await open();
      await store.appendRun(finished({}, [null, null]));
      await db.$executeRawUnsafe(`UPDATE runs SET report = '{"version": 7}'`);
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        expect(await store.runs()).toEqual([]);
        expect(logged).toHaveBeenCalledWith(expect.stringContaining('is no run report — left out'));
      } finally {
        logged.mockRestore();
      }
    });

    it('keeps nothing of a run whose Erfolge cannot be written: the run is one write', async () => {
      const store = await open();
      const made = await store.getOrCreateByIdentity(identityOf('Anna'), {
        displayName: 'Anna',
        colour: null,
      });
      // The last part of the write refused, as a full disk or a lost line would refuse it.
      await db.$executeRawUnsafe(
        `CREATE FUNCTION refuse_erfolg() RETURNS trigger AS $$
         BEGIN RAISE EXCEPTION 'no Erfolg'; END $$ LANGUAGE plpgsql`,
      );
      await db.$executeRawUnsafe(
        'CREATE TRIGGER refuse_erfolg BEFORE INSERT ON achievements ' +
          'FOR EACH ROW EXECUTE FUNCTION refuse_erfolg()',
      );
      try {
        await expect(store.appendRun(finished({}, ['Anna', null]))).rejects.toThrow('no Erfolg');
        expect([await db.run.count(), await db.runMember.count()]).toEqual([0, 0]);
        expect(store.stats().runs).toBe(0);
      } finally {
        await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS refuse_erfolg ON achievements');
        await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS refuse_erfolg()');
      }
      expect(await store.achievements(made.id)).toEqual([]);
    });

    it('keeps a run that ends on a connection the database closed: it asks again', async () => {
      const store = await openNamed('lost-run');
      const made = await store.getOrCreateByIdentity(identityOf('Anna'), {
        displayName: 'Anna',
        colour: null,
      });
      const said = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        await closeConnections('lost-run');
        await store.appendRun(finished({}, ['Anna', null]));
        expect(said).toHaveBeenCalledWith(expect.stringContaining('(P1017): asked again'));
      } finally {
        said.mockRestore();
      }
      expect([await db.run.count(), (await store.runsOfAccount(made.id, 5)).total]).toEqual([1, 1]);
      expect(store.stats().runs).toBe(1);
    });

    it('finds and makes accounts on a connection the database closed: it asks again', async () => {
      const store = await openNamed('lost-account');
      const anna = { displayName: 'Anna', colour: null };
      const made = await store.getOrCreateByIdentity(identityOf('Anna'), anna);
      const said = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        await closeConnections('lost-account');
        expect(await store.findByIdentity(identityOf('Anna'))).toMatchObject({ id: made.id });
        await closeConnections('lost-account');
        const ben = await store.getOrCreateByIdentity(identityOf('Ben'), anna);
        expect(said).toHaveBeenCalledTimes(2);
        expect(await db.account.count()).toBe(2);
        expect(ben.id).not.toBe(made.id);
      } finally {
        said.mockRestore();
      }
    });

    it('says why it does not open where the database cannot be reached', async () => {
      const nowhere = new URL(url);
      nowhere.port = '1';
      await expect(PostgresStore.open(nowhere.toString())).rejects.toThrow(
        /DATABASE_URL names cannot be reached: .* — check the variable$/,
      );
    });

    it('says what to run where the database has no tables yet', async () => {
      const bare = `${schema}_bare`;
      await db.$executeRawUnsafe(`CREATE SCHEMA "${bare}"`);
      try {
        const empty = new URL(url);
        empty.searchParams.set('schema', bare);
        const migrate = 'pnpm --filter @escapelab/server prisma migrate deploy';
        await expect(PostgresStore.open(empty.toString())).rejects.toThrow(
          `are its migrations applied? (${migrate}`,
        );
      } finally {
        await db.$executeRawUnsafe(`DROP SCHEMA "${bare}" CASCADE`);
      }
    });
  });
});

import { Prisma } from '@prisma/client';
import type * as PrismaModule from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Clients,
  IDLE_LIFETIME_S,
  onceMore,
  pooledUrl,
  PostgresStore,
  RETIRING_MS,
  runKeptAlready,
  worthAskingAgain,
} from '../src/store/postgres.js';

/** The URL of every Prisma client made in this file, in order. */
const clients = vi.hoisted((): string[] => []);

vi.mock('@prisma/client', async (importOriginal) => {
  const real = await importOriginal<typeof PrismaModule>();
  class Noted extends real.PrismaClient {
    constructor(options?: Prisma.PrismaClientOptions) {
      clients.push(options?.datasourceUrl ?? '');
      super(options);
    }
  }
  return { ...real, PrismaClient: Noted };
});

/**
 * The store in Postgres asks once more where the connection was lost — Neon closes one idle for 5
 * minutes, and the pool may still hold it — of a fresh client where the database closed it, and
 * never where the database refused the request; its pool lets no connection stand idle long
 * enough for Neon to close it. Without a database: Prisma's errors made as Prisma makes them,
 * and clients that only close.
 */

const VERSION = '6.19.3';
const lost = (code: string, meta?: Record<string, unknown>): Error =>
  new Prisma.PrismaClientKnownRequestError('Server has closed the connection.', {
    code,
    clientVersion: VERSION,
    ...(meta === undefined ? {} : { meta }),
  });

/** A client as the retry sees it: numbered as made, and closing when told. */
interface Fake {
  n: number;
  $disconnect: () => Promise<void>;
}

/** Clients made as fakes, numbered from 1 as they are made. */
function fakes(): { clients: Clients<Fake>; made: Fake[] } {
  const made: Fake[] = [];
  const clients = new Clients(() => {
    const client: Fake = { n: made.length + 1, $disconnect: vi.fn(async () => undefined) };
    made.push(client);
    return client;
  });
  return { clients, made };
}

/** Which of the clients each call of `work` was asked of, by number. */
const askedOf = (work: { mock: { calls: [Fake][] } }): number[] =>
  work.mock.calls.map(([client]) => client.n);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a lost connection', () => {
  it('is one the database closed or that could not be opened, and no refusal', () => {
    expect(worthAskingAgain(lost('P1017'))).toBe(true);
    expect(worthAskingAgain(lost('P1001'))).toBe(true);
    const unreachable = new Prisma.PrismaClientInitializationError('unreachable', VERSION, 'P1002');
    expect(worthAskingAgain(unreachable)).toBe(true);
    expect(worthAskingAgain(lost('P2002'))).toBe(false);
    expect(worthAskingAgain(new Error('Server has closed the connection.'))).toBe(false);
    const bad = new Prisma.PrismaClientInitializationError('bad', VERSION);
    expect(worthAskingAgain(bad)).toBe(false);
  });

  it('is asked about once more of a fresh client where the database closed it', async () => {
    const said = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { clients } = fakes();
    const work = vi.fn<(client: Fake) => Promise<string>>();
    work.mockRejectedValueOnce(lost('P1017')).mockResolvedValueOnce('kept');
    await expect(onceMore(clients, work)).resolves.toBe('kept');
    expect(askedOf(work)).toEqual([1, 2]);
    expect(clients.current.n).toBe(2);
    expect(said).toHaveBeenCalledWith(
      '[escapelab] the database had lost the connection (P1017): asked again',
    );
  });

  it('is asked again of the same client where none opened, or a transaction did not start', async () => {
    const said = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const unreachable = new Prisma.PrismaClientInitializationError('unreachable', VERSION, 'P1002');
    for (const err of [lost('P1001'), unreachable, lost('P2028')]) {
      const { clients } = fakes();
      const work = vi.fn<(client: Fake) => Promise<string>>();
      work.mockRejectedValueOnce(err).mockResolvedValueOnce('kept');
      await expect(onceMore(clients, work)).resolves.toBe('kept');
      // A fresh pool would have to open a connection as well, or wait for a waking Neon.
      expect(askedOf(work)).toEqual([1, 1]);
    }
    expect(said).toHaveBeenCalledWith(
      '[escapelab] the database did not start the transaction in time (P2028): asked again',
    );
  });

  it('is asked about once more only: a second loss stands', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { clients } = fakes();
    const work = vi.fn<(client: Fake) => Promise<string>>().mockRejectedValue(lost('P1017'));
    await expect(onceMore(clients, work)).rejects.toThrow('Server has closed the connection.');
    expect(askedOf(work)).toEqual([1, 2]);
  });

  it('is never what a refusal is taken for: a unique key is not asked about again', async () => {
    const { clients, made } = fakes();
    const work = vi.fn<(client: Fake) => Promise<string>>().mockRejectedValue(lost('P2002'));
    await expect(onceMore(clients, work)).rejects.toMatchObject({ code: 'P2002' });
    expect(askedOf(work)).toEqual([1]);
    expect(made).toHaveLength(1);
  });

  it('renews a client once, however many requests on it lost their connection', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { clients, made } = fakes();
    const lostOnFirst = (client: Fake): Promise<number> =>
      client.n === 1 ? Promise.reject(lost('P1017')) : Promise.resolve(client.n);
    const answers = await Promise.all([1, 2, 3].map(() => onceMore(clients, lostOnFirst)));
    expect(answers).toEqual([2, 2, 2]);
    expect(made).toHaveLength(2);
  });
});

describe('a client replaced by a fresh one', () => {
  it('stays open for the requests still running on it, then closes', () => {
    vi.useFakeTimers();
    // Longer than a run's transaction may wait and then take, 15 s each.
    expect(RETIRING_MS).toBeGreaterThan(30_000);
    const { clients, made } = fakes();
    clients.renew(clients.current);
    vi.advanceTimersByTime(RETIRING_MS - 1);
    expect(made.map((client) => vi.mocked(client.$disconnect).mock.calls.length)).toEqual([0, 0]);
    vi.advanceTimersByTime(1);
    expect(made.map((client) => vi.mocked(client.$disconnect).mock.calls.length)).toEqual([1, 0]);
  });

  it('closes with the store, as the one asked now does, and only once', async () => {
    vi.useFakeTimers();
    const { clients, made } = fakes();
    clients.renew(clients.current);
    clients.renew(clients.current);
    await clients.close();
    vi.advanceTimersByTime(RETIRING_MS);
    expect(made.map((client) => vi.mocked(client.$disconnect).mock.calls.length)).toEqual([
      1, 1, 1,
    ]);
  });

  it('says so where it does not close', async () => {
    vi.useFakeTimers();
    const said = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { clients, made } = fakes();
    vi.mocked(made[0]?.$disconnect ?? vi.fn()).mockRejectedValueOnce(new Error('gone'));
    clients.renew(clients.current);
    await vi.advanceTimersByTimeAsync(RETIRING_MS);
    expect(said).toHaveBeenCalledWith(
      '[escapelab] a replaced database client did not close: gone',
    );
  });
});

describe("the pool's idle lifetime", () => {
  it('stays under the 5 minutes after which Neon closes an idle connection', () => {
    expect(IDLE_LIFETIME_S).toBeLessThan(300);
    const url = new URL(pooledUrl('postgresql://someone@db.example:5432/lab?sslmode=require'));
    expect(url.searchParams.get('max_idle_connection_lifetime')).toBe(String(IDLE_LIFETIME_S));
    expect(url.searchParams.get('sslmode')).toBe('require');
    expect(url.host).toBe('db.example:5432');
  });

  it("is the pool's of the store opened over DATABASE_URL", async () => {
    // Nobody listens on port 1: the store does not open, but its client was made.
    await expect(PostgresStore.open('postgresql://someone@127.0.0.1:1/lab')).rejects.toThrow(
      'cannot be reached',
    );
    const made = new URL(clients.at(-1) ?? 'none:');
    expect(made.searchParams.get('max_idle_connection_lifetime')).toBe(String(IDLE_LIFETIME_S));
  });

  it('is the one the URL sets where it sets one', () => {
    const url = pooledUrl('postgresql://someone@db.example/lab?max_idle_connection_lifetime=5');
    expect(new URL(url).searchParams.getAll('max_idle_connection_lifetime')).toEqual(['5']);
  });

  it("is all a Neon pooled URL gets: its pooler's PgBouncer keeps prepared statements", () => {
    // PgBouncer 1.21 and later keep them in transaction mode, and Prisma advises against
    // `pgbouncer=true` there; Neon's pooler runs 1.24. The URL's own flags stay as Neon gave them.
    const host = 'ep-quiet-lab-123456-pooler.eu-central-1.aws.neon.tech';
    const neon = `postgresql://someone@${host}/lab?sslmode=require&channel_binding=require`;
    const url = new URL(pooledUrl(neon));
    expect(url.host).toBe(host);
    expect([...url.searchParams]).toEqual([
      ['sslmode', 'require'],
      ['channel_binding', 'require'],
      ['max_idle_connection_lifetime', String(IDLE_LIFETIME_S)],
    ]);
  });

  it('refuses a variable that is no URL, naming the variable and not its value', () => {
    expect(() => pooledUrl('not a url')).toThrow(
      'DATABASE_URL is no connection URL — check the variable',
    );
  });
});

describe('a run kept already', () => {
  it('is the unique key on its room and its start, and no other a write runs into', () => {
    const runs = { modelName: 'Run', target: ['room_code', 'started_at'] };
    expect(runKeptAlready(lost('P2002', runs))).toBe(true);
    const turned = { modelName: 'Run', target: ['started_at', 'room_code'] };
    expect(runKeptAlready(lost('P2002', turned))).toBe(true);
    const seat = { modelName: 'RunMember', target: ['run_id', 'seat'] };
    expect(runKeptAlready(lost('P2002', seat))).toBe(false);
    const other = { modelName: 'Run', target: ['id'] };
    expect(runKeptAlready(lost('P2002', other))).toBe(false);
    expect(runKeptAlready(lost('P2002'))).toBe(false);
    expect(runKeptAlready(lost('P1017', runs))).toBe(false);
  });
});

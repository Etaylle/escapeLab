import { Prisma } from '@prisma/client';
import type * as PrismaModule from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  IDLE_LIFETIME_S,
  onceMore,
  pooledUrl,
  PostgresStore,
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
 * minutes, and the pool may still hold it — and never where the database refused the request;
 * its pool lets no connection stand idle long enough for Neon to close it. Without a database:
 * Prisma's errors made as Prisma makes them.
 */

const VERSION = '6.19.3';
const lost = (code: string, meta?: Record<string, unknown>): Error =>
  new Prisma.PrismaClientKnownRequestError('Server has closed the connection.', {
    code,
    clientVersion: VERSION,
    ...(meta === undefined ? {} : { meta }),
  });

afterEach(() => {
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

  it('takes in a transaction that did not start in time, as while Neon wakes', async () => {
    const said = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const work = vi.fn().mockRejectedValueOnce(lost('P2028')).mockResolvedValueOnce('kept');
    await expect(onceMore(work)).resolves.toBe('kept');
    expect(said).toHaveBeenCalledWith(
      '[escapelab] the database did not start the transaction in time (P2028): asked again',
    );
  });

  it('is asked about once more, saying so, and the second answer stands', async () => {
    const said = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const work = vi.fn().mockRejectedValueOnce(lost('P1017')).mockResolvedValueOnce('kept');
    await expect(onceMore(work)).resolves.toBe('kept');
    expect(work).toHaveBeenCalledTimes(2);
    expect(said).toHaveBeenCalledWith(
      '[escapelab] the database had lost the connection (P1017): asked again',
    );
  });

  it('is asked about once more only: a second loss stands', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const work = vi.fn().mockRejectedValue(lost('P1017'));
    await expect(onceMore(work)).rejects.toThrow('Server has closed the connection.');
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('is never what a refusal is taken for: a unique key is not asked about again', async () => {
    const work = vi.fn().mockRejectedValue(lost('P2002'));
    await expect(onceMore(work)).rejects.toMatchObject({ code: 'P2002' });
    expect(work).toHaveBeenCalledTimes(1);
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

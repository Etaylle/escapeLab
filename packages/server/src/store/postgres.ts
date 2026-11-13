import { Prisma, PrismaClient, type Account as AccountRow } from '@prisma/client';
import { NO_CREDITS, runSeconds, type Credits, type RunReport } from '@escapelab/core';
import { RunStats } from '../runStats.js';
import {
  aliasOf,
  checkSecret,
  isLoggedRun,
  sameSecretHash,
  unlockedBy,
  type Account,
  type FinishedRun,
  type LoggedRun,
  type PassIdentity,
  type Profile,
  type SeatedRun,
  type Store,
  type Unlocked,
} from './store.js';

/**
 * The store in Postgres (prisma/schema.prisma), where DATABASE_URL names a database: accounts,
 * runs and Erfolge outlast every restart and deploy. A run's report goes in without what names a
 * person — the crew's names and what each of them did stand in its seats (RunMember) — so that a
 * deleted account takes its name off its runs and leaves them standing. The Bestenliste is
 * counted from every run once, as the store opens, then run by run.
 */

/** A run as the database holds it, with its seats. */
type RunRow = Prisma.RunGetPayload<{ include: { members: true } }>;

/** A report as a run's row keeps it: without the crew's names and what each of them did. */
type StoredReport = Omit<RunReport, 'crew' | 'credits'>;

/** `row`'s account as the store hands it out. */
function accountOf(row: AccountRow): Account {
  return {
    id: row.id,
    displayName: row.displayName,
    colour: row.colour,
    createdAt: row.createdAt.getTime(),
    lastSeenAt: row.lastSeenAt.getTime(),
  };
}

/**
 * The run `row` holds, its report whole again: each seat's name and what it did back in it — a
 * seat whose account was deleted named '' and credited nothing.
 */
function loggedOf(row: RunRow): unknown {
  const bySeat = new Map(row.members.map((member) => [member.seat, member]));
  const crew = Array.from({ length: row.crewSize }, (_, seat) => bySeat.get(seat)?.seatName ?? '');
  const credits = Object.fromEntries(
    row.members.map((member) => [aliasOf(member.seat), member.contributions as unknown]),
  );
  return { ...(row.report as object), crew, credits };
}

/** What an identity row says of its pass: its id, the hash of its secret, its account. */
type Holder = Pick<Prisma.IdentityGetPayload<object>, 'subject' | 'secretHash' | 'accountId'>;

/**
 * The account that held each seat of `run`: the one whose identity is the seat's pass — its id
 * and the hash of its secret both, for an id alone credits nobody — null for a seat without one.
 */
function ownersOf(run: FinishedRun, identities: readonly Holder[]): (string | null)[] {
  const bySubject = new Map(identities.map((identity) => [identity.subject, identity]));
  return run.report.crew.map((_, seat) => {
    const pass = run.passes[seat] ?? null;
    const identity = pass === null ? undefined : bySubject.get(pass.id);
    const shown = identity !== undefined && pass !== null;
    const owned = shown && sameSecretHash(identity.secretHash, pass.secretHash);
    return owned ? identity.accountId : null;
  });
}

/**
 * `report` as the database keeps it: the name of a seat without an account — one deleted while
 * the run went on, or none made — is kept nowhere, for no account could take it off again.
 */
function asKept(report: RunReport, owners: readonly (string | null)[]): RunReport {
  const owned = (seat: number): boolean => (owners[seat] ?? null) !== null;
  return { ...report, crew: report.crew.map((name, seat) => (owned(seat) ? name : '')) };
}

/**
 * `run` written in the transaction `tx` — its row, its seats, the Erfolge it earned each account
 * on its seats — and the account on each seat (`ownersOf`). Rejects with P2002 for a run kept
 * already: the room and the start name it.
 */
async function keep(tx: Prisma.TransactionClient, run: FinishedRun): Promise<(string | null)[]> {
  const ids = run.passes.flatMap((pass) => (pass === null ? [] : [pass.id]));
  const identities = await tx.identity.findMany({
    where: { provider: 'pass', subject: { in: ids } },
  });
  const owners = ownersOf(run, identities);
  await tx.run.create({ data: runRowOf(asKept(run.report, owners), owners) });
  const unlocked = unlockedBy(run.report);
  // Each Erfolg once: one an account earned before keeps the date it was first earned.
  await tx.achievement.createMany({
    data: [...new Set(owners)].flatMap((accountId) =>
      accountId === null
        ? []
        : unlocked.map(({ key, unlockedAt }) => ({
            accountId,
            key,
            unlockedAt: new Date(unlockedAt),
          })),
    ),
    skipDuplicates: true,
  });
  return owners;
}

/**
 * The row a finished run goes in as, `report` as the database keeps it (`asKept`), its seats with
 * it: on each, the account that held it (`owners`).
 */
function runRowOf(report: RunReport, owners: readonly (string | null)[]): Prisma.RunCreateInput {
  const { crew, credits, ...stored } = report;
  const kept: StoredReport = stored;
  return {
    missionId: report.missionId,
    difficulty: report.difficulty,
    seed: report.seed === undefined ? null : BigInt(report.seed),
    roomCode: report.roomCode,
    outcome: report.outcome,
    startedAt: new Date(report.startedAt),
    endedAt: new Date(report.finishedAt),
    durationSec: runSeconds(report),
    crewSize: report.crewSize,
    alarms: report.penalties.reduce((sum, penalty) => sum + penalty.count, 0),
    daily: report.daily === true,
    report: kept as unknown as Prisma.InputJsonObject,
    members: {
      create: crew.map((seatName, seat) => {
        const contributions: Credits = credits[aliasOf(seat)] ?? NO_CREDITS;
        return {
          seat,
          seatName,
          contributions: { ...contributions } as unknown as Prisma.InputJsonObject,
          accountId: owners[seat] ?? null,
        };
      }),
    },
  };
}

/** What `err` says, on one line: Prisma's messages run over several. */
function oneLine(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').trim();
}

/** Whether `err` is a unique key the database already holds: a row made meanwhile. */
function alreadyThere(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Seconds a pooled connection may stand idle before the pool opens a fresh one instead: well
 * under the 5 minutes after which Neon closes an idle connection — the pool would otherwise hand
 * out one the database closed — and the longest a pool stays stuck on a closed connection
 * (Prisma 6.19 retires it only once it has stood idle that long).
 */
export const IDLE_LIFETIME_S = 60;

/**
 * `url` with the pool's idle lifetime (`IDLE_LIFETIME_S`), unless it sets one itself
 * (`max_idle_connection_lifetime`). Throws, naming the variable, for one that is no URL.
 */
export function pooledUrl(url: string): string {
  let pooled: URL;
  try {
    pooled = new URL(url);
  } catch {
    throw new Error('DATABASE_URL is no connection URL — check the variable');
  }
  if (!pooled.searchParams.has('max_idle_connection_lifetime')) {
    pooled.searchParams.set('max_idle_connection_lifetime', String(IDLE_LIFETIME_S));
  }
  return pooled.toString();
}

/**
 * Prisma's codes for a connection lost: P1017, the database closed one the pool still held —
 * Neon closes a connection idle for 5 minutes — P1001 and P1002, none could be opened.
 */
const CONNECTION_LOST: ReadonlySet<string> = new Set(['P1001', 'P1002', 'P1017']);

/** The code of Prisma's that `err` carries; null for none. */
function codeOf(err: unknown): string | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return err.code;
  }
  return err instanceof Prisma.PrismaClientInitializationError ? (err.errorCode ?? null) : null;
}

/** Whether `err` says the connection was lost: asked again, the request may well go through. */
export function connectionLost(err: unknown): boolean {
  const code = codeOf(err);
  return code !== null && CONNECTION_LOST.has(code);
}

/**
 * `work` done — once more where the connection it went out on was lost (`connectionLost`), on
 * another the pool opens. Anything else, a constraint refused say, is thrown as it came.
 */
export async function onceMore<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (!connectionLost(err)) {
      throw err;
    }
    console.log(`[escapelab] the database had lost the connection (${codeOf(err)}): asked again`);
    return work();
  }
}

export class PostgresStore implements Store {
  readonly description = 'Postgres at DATABASE_URL: accounts, runs and Erfolge outlast a restart';
  readonly kind = 'database';
  private index = new RunStats();

  private constructor(private readonly db: PrismaClient) {}

  /**
   * The store in the database at `url`, its runs counted. Rejects, saying why, where the
   * database cannot be reached.
   */
  static async open(url: string): Promise<PostgresStore> {
    const db = new PrismaClient({ datasourceUrl: pooledUrl(url) });
    const store = new PostgresStore(db);
    try {
      await db.$connect();
    } catch (err) {
      await db.$disconnect();
      throw new Error(
        `the database DATABASE_URL names cannot be reached: ${oneLine(err)} — check the variable`,
      );
    }
    try {
      await store.recount();
    } catch (err) {
      await db.$disconnect();
      throw new Error(
        `the database's runs cannot be read: ${oneLine(err)} — are its migrations applied? ` +
          '(pnpm --filter @escapelab/server prisma migrate deploy, as the start script does)',
      );
    }
    return store;
  }

  /** The Bestenliste counted afresh from every run kept. */
  private async recount(): Promise<void> {
    this.index = new RunStats(await this.runs());
  }

  async appendRun(run: FinishedRun): Promise<void> {
    let owners: (string | null)[];
    try {
      // A run usually ends after minutes without a word to the database: its write is the one
      // most likely to find the connection lost (`onceMore`).
      owners = await onceMore(() => this.db.$transaction((tx) => keep(tx, run)));
    } catch (err) {
      if (!alreadyThere(err)) {
        throw err;
      }
      // The same run once more — a room taken up again from a snapshot made before its end
      // finished it a second time: kept and counted already.
      const { missionId, roomCode } = run.report;
      console.log(`[escapelab] run of ${missionId} in room ${roomCode} kept already`);
      return;
    }
    this.index.add(asKept(run.report, owners));
  }

  async runs(): Promise<LoggedRun[]> {
    const rows = await onceMore(() =>
      this.db.run.findMany({
        include: { members: true },
        orderBy: [{ endedAt: 'asc' }, { id: 'asc' }],
      }),
    );
    return rows.flatMap((row) => this.checked(row));
  }

  stats(): RunStats {
    return this.index;
  }

  async runsOfAccount(
    accountId: string,
    limit: number,
  ): Promise<{ total: number; runs: SeatedRun[] }> {
    const [total, seats] = await onceMore(() =>
      this.db.$transaction([
        this.db.runMember.count({ where: { accountId } }),
        this.db.runMember.findMany({
          where: { accountId },
          include: { run: { include: { members: true } } },
          orderBy: { run: { endedAt: 'desc' } },
          take: limit,
        }),
      ]),
    );
    const runs = seats.flatMap(({ run: row, seat }) =>
      this.checked(row).map((run) => ({ run, seat })),
    );
    return { total, runs };
  }

  getOrCreateByIdentity(identity: PassIdentity, profile: Profile): Promise<Account> {
    return onceMore(() => this.getOrCreate(identity, profile));
  }

  findByIdentity(identity: PassIdentity): Promise<Account | null> {
    return onceMore(() => this.find(identity));
  }

  /** `getOrCreateByIdentity`, asked once. */
  private async getOrCreate(identity: PassIdentity, profile: Profile): Promise<Account> {
    const found = await this.visit(identity);
    if (found !== null) {
      return found;
    }
    try {
      const made = await this.db.account.create({
        data: {
          displayName: profile.displayName,
          colour: profile.colour,
          identities: {
            create: {
              provider: identity.provider,
              subject: identity.subject,
              secretHash: identity.secretHash,
            },
          },
        },
      });
      return accountOf(made);
    } catch (err) {
      // Another request of the same pass made it meanwhile: that one is the pass's account.
      const meanwhile = alreadyThere(err) ? await this.visit(identity) : null;
      if (meanwhile === null) {
        throw err;
      }
      return meanwhile;
    }
  }

  /** `findByIdentity`, asked once. */
  private async find(identity: PassIdentity): Promise<Account | null> {
    const found = await this.db.identity.findUnique({
      where: { provider_subject: { provider: identity.provider, subject: identity.subject } },
      include: { account: true },
    });
    if (found === null) {
      return null;
    }
    checkSecret(found.secretHash, identity.secretHash);
    return accountOf(found.account);
  }

  /** The account `identity` leads into, its visit noted; null where it leads nowhere yet. */
  private async visit(identity: PassIdentity): Promise<Account | null> {
    const found = await this.find(identity);
    if (found === null) {
      return null;
    }
    const account = await this.db.account.update({
      where: { id: found.id },
      data: { lastSeenAt: new Date() },
    });
    return accountOf(account);
  }

  async updateProfile(accountId: string, change: Partial<Profile>): Promise<Account> {
    return accountOf(
      await onceMore(() => this.db.account.update({ where: { id: accountId }, data: change })),
    );
  }

  async achievements(accountId: string): Promise<Unlocked[]> {
    const rows = await onceMore(() => this.db.achievement.findMany({ where: { accountId } }));
    return rows.map((row) => ({ key: row.key, unlockedAt: row.unlockedAt.getTime() }));
  }

  async deleteAccount(accountId: string): Promise<void> {
    // Its identities, Erfolge and seats go with it (onDelete: Cascade); the runs stay. The seats
    // it held, read in the same transaction, take its name off the Bestenliste: no run is read
    // but its own, and none appended meanwhile can be left out of the count.
    const [held] = await onceMore(() =>
      this.db.$transaction([
        this.db.runMember.findMany({
          where: { accountId },
          include: { run: { include: { members: true } } },
        }),
        this.db.account.deleteMany({ where: { id: accountId } }),
      ]),
    );
    for (const { run: row, seatName } of held) {
      for (const run of this.checked(row)) {
        this.index.unname(run, seatName);
      }
    }
  }

  async close(): Promise<void> {
    await this.db.$disconnect();
  }

  /** The run `row` holds, where it is one to count; the log says why where it is not. */
  private checked(row: RunRow): LoggedRun[] {
    const run = loggedOf(row);
    if (isLoggedRun(run)) {
      return [run];
    }
    console.error(`[escapelab] run ${row.id} in the database is no run report — left out`);
    return [];
  }
}

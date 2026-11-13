import { Prisma, PrismaClient, type Account as AccountRow } from '@prisma/client';
import { NO_CREDITS, runSeconds, type Credits, type RunReport } from '@escapelab/core';
import { RunStats } from '../runStats.js';
import {
  checkSecret,
  isLoggedRun,
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

/** The alias a report gives the crew member on `seat`: p1 for the first. */
const aliasOf = (seat: number): string => `p${seat + 1}`;

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

/** The row a finished run goes in as, its seats with it: the account of each pass that has one. */
function runRowOf(
  { report, passes }: FinishedRun,
  accounts: ReadonlyMap<string, string>,
): Prisma.RunCreateInput {
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
        const passId = passes[seat] ?? null;
        const contributions: Credits = credits[aliasOf(seat)] ?? NO_CREDITS;
        return {
          seat,
          seatName,
          contributions: { ...contributions } as unknown as Prisma.InputJsonObject,
          accountId: passId === null ? null : (accounts.get(passId) ?? null),
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

export class PostgresStore implements Store {
  readonly description = 'Postgres at DATABASE_URL: accounts, runs and Erfolge outlast a restart';
  private index = new RunStats();

  private constructor(private readonly db: PrismaClient) {}

  /**
   * The store in the database at `url`, its runs counted. Rejects, saying why, where the
   * database cannot be reached.
   */
  static async open(url: string): Promise<PostgresStore> {
    const db = new PrismaClient({ datasourceUrl: url });
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
    const subjects = run.passes.filter((passId): passId is string => passId !== null);
    await this.db.$transaction(async (tx) => {
      const identities = await tx.identity.findMany({
        where: { provider: 'pass', subject: { in: subjects } },
      });
      const accounts = new Map(identities.map((identity) => [identity.subject, identity.accountId]));
      await tx.run.create({ data: runRowOf(run, accounts) });
    });
    this.index.add(run.report);
  }

  async runs(missionId?: string): Promise<LoggedRun[]> {
    const rows = await this.db.run.findMany({
      where: missionId === undefined ? {} : { missionId },
      include: { members: true },
      orderBy: [{ endedAt: 'asc' }, { id: 'asc' }],
    });
    return rows.flatMap((row) => this.checked(row));
  }

  stats(): RunStats {
    return this.index;
  }

  async runsOfAccount(
    accountId: string,
    limit: number,
  ): Promise<{ total: number; runs: SeatedRun[] }> {
    const [total, seats] = await this.db.$transaction([
      this.db.runMember.count({ where: { accountId } }),
      this.db.runMember.findMany({
        where: { accountId },
        include: { run: { include: { members: true } } },
        orderBy: { run: { endedAt: 'desc' } },
        take: limit,
      }),
    ]);
    const runs = seats.flatMap((seat) => this.checked(seat.run).map((run) => ({ run, seat: seat.seat })));
    return { total, runs };
  }

  async getOrCreateByIdentity(identity: PassIdentity, profile: Profile): Promise<Account> {
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

  async findByIdentity(identity: PassIdentity): Promise<Account | null> {
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
    const found = await this.findByIdentity(identity);
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
    return accountOf(await this.db.account.update({ where: { id: accountId }, data: change }));
  }

  async achievements(accountId: string): Promise<Unlocked[]> {
    const rows = await this.db.achievement.findMany({ where: { accountId } });
    return rows.map((row) => ({ key: row.key, unlockedAt: row.unlockedAt.getTime() }));
  }

  async deleteAccount(accountId: string): Promise<void> {
    // Its identities, Erfolge and seats go with it (onDelete: Cascade); the runs stay.
    await this.db.account.deleteMany({ where: { id: accountId } });
    await this.recount();
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

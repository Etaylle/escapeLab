import { Prisma, PrismaClient, type Account as AccountRow } from '@prisma/client';
import { GameError, NO_CREDITS, runSeconds, type Credits, type RunReport } from '@escapelab/core';
import { RunStats } from '../runStats.js';
import {
  aliasOf,
  checkSecret,
  HAS_LOGIN,
  isLoggedRun,
  LoginTaken,
  PARKED,
  sameSecretHash,
  unlockedBy,
  type Account,
  type FinishedRun,
  type Leaving,
  type LoggedRun,
  type Login,
  type PassIdentity,
  type Profile,
  type SeatedRun,
  type SeatPass,
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

/** Whether `err` is a foreign key to a row gone: an account deleted while a seat was written. */
function accountGone(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003';
}

/** A transaction's client. */
type Tx = Prisma.TransactionClient;

/** The key of the way in of the pass `subject`. */
const passKey = (subject: string): Prisma.IdentityWhereUniqueInput => ({
  provider_subject: { provider: 'pass', subject },
});

/**
 * `pass` led into `accountId` in `tx`, its way in made where it had none; the account it led into
 * before, null for none. Throws GameError for a pass shown with the wrong secret.
 */
async function pointPass(tx: Tx, pass: PassIdentity, accountId: string): Promise<string | null> {
  const found = await tx.identity.findUnique({ where: passKey(pass.subject) });
  if (found === null) {
    await tx.identity.create({ data: { ...pass, accountId } });
    return null;
  }
  checkSecret(found.secretHash, pass.secretHash);
  if (found.accountId === accountId) {
    return null;
  }
  await tx.identity.update({ where: passKey(pass.subject), data: { accountId } });
  return found.accountId;
}

/**
 * The pass of `leaving` signed out in `tx` (`Leaving`): its way in deleted, or kept for its seat
 * alone. The account it led into; null for none. Throws GameError for a pass shown with the
 * wrong secret.
 */
async function leave(tx: Tx, { pass, parked }: Leaving): Promise<string | null> {
  const found = await tx.identity.findUnique({ where: passKey(pass.subject) });
  if (found === null) {
    return null;
  }
  checkSecret(found.secretHash, pass.secretHash);
  await (parked
    ? tx.identity.update({ where: passKey(pass.subject), data: { secretHash: PARKED } })
    : tx.identity.delete({ where: passKey(pass.subject) }));
  return found.accountId;
}

/**
 * Whether the login of `accountId` keeps `checked` in `tx`, its row locked till the end (FOR
 * UPDATE, for which Prisma has no call): a Kennwort changed at once waits for the sign-in, then
 * signs its pass out with the rest (`signOutOthers`); one changed before is seen.
 */
async function stillKept(tx: Tx, accountId: string, checked: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ secret_hash: string | null }[]>`
    SELECT secret_hash FROM identities
    WHERE account_id = ${accountId}::uuid AND provider = 'login'
    FOR UPDATE`;
  return rows[0]?.secret_hash === checked;
}

/**
 * Every pass that leads into `accountId` but `staying` signed out in `tx`, its way in kept under
 * PARKED (store.ts `replaceLoginSecret`) — each row locked first (FOR UPDATE, for which Prisma has
 * no call), so that none moves to another account meanwhile: those passes, with the hashes their
 * ways in kept before.
 */
async function signOutOthers(tx: Tx, accountId: string, staying: string): Promise<SeatPass[]> {
  const others = await tx.$queryRaw<{ subject: string; secret_hash: string }[]>`
    SELECT subject, secret_hash FROM identities
    WHERE account_id = ${accountId}::uuid AND provider = 'pass'
      AND subject <> ${staying} AND secret_hash <> ${PARKED}
    FOR UPDATE`;
  await tx.identity.updateMany({
    where: { provider: 'pass', subject: { in: others.map((row) => row.subject) } },
    data: { secretHash: PARKED },
  });
  return others.map((row) => ({ id: row.subject, secretHash: row.secret_hash }));
}

/**
 * Every account of `left` but `staying` that nothing is left of — no way in, no run, no Erfolg —
 * deleted in `tx`; their ids. Each account's row is locked first (FOR UPDATE, for which Prisma
 * has no call): a run's seat written for it meanwhile is counted once that run is kept, and one
 * written after waits, finds it gone and is written again without it (`PostgresStore.write`).
 */
async function deleteEmpty(
  tx: Tx,
  left: readonly (string | null)[],
  staying: string,
): Promise<string[]> {
  const deleted: string[] = [];
  for (const id of new Set(left)) {
    if (id === null || id === staying) {
      continue;
    }
    await tx.$queryRaw`SELECT id FROM accounts WHERE id = ${id}::uuid FOR UPDATE`;
    const held =
      (await tx.identity.count({ where: { accountId: id } })) +
      (await tx.runMember.count({ where: { accountId: id } })) +
      (await tx.achievement.count({ where: { accountId: id } }));
    if (held === 0) {
      await tx.account.delete({ where: { id } });
      deleted.push(id);
    }
  }
  return deleted;
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
 * Prisma's codes for a request worth asking once more, and what each says happened: P1017, the
 * database closed a connection the pool still held — Neon closes one idle for 5 minutes — P1001
 * and P1002, none could be opened, and P2028, a transaction that did not start in time — a Neon
 * compute waking from its pause while the pool opened a connection.
 */
const ASK_AGAIN: ReadonlyMap<string, string> = new Map([
  ['P1001', 'had lost the connection'],
  ['P1002', 'had lost the connection'],
  ['P1017', 'had lost the connection'],
  ['P2028', 'did not start the transaction in time'],
]);

/**
 * The code of a connection the database closed while the pool held it. Prisma 6.19's pool may go
 * on handing such a connection out — one that had not run the request's statement before — every
 * request failing on it until it has stood idle for its lifetime: asked again, the request goes
 * to a fresh client (`Clients.renew`).
 */
const CLOSED = 'P1017';

/**
 * How long a client replaced by a fresh one (`Clients.renew`) stays open for the requests still
 * running on it, ms: longer than a transaction may wait and take (TRANSACTION).
 */
export const RETIRING_MS = 60_000;

/** What the store needs of a client it lets go of: that it closes. */
interface Closable {
  $disconnect: () => Promise<void>;
}

/**
 * The client the store asks — a Prisma client, with a pool of connections of its own — and the
 * ones it asked before: a client that lost its connections is replaced by a fresh one, and
 * closed once the requests still running on it have had time to end (RETIRING_MS). Never
 * `$disconnect` a client and go on asking it: Prisma 6.19 then throws „Engine is not yet
 * connected" uncaught, which ends the process.
 */
export class Clients<C extends Closable> {
  private client: C;
  /** each client replaced and not closed yet, with the timer that closes it */
  private readonly retiring = new Map<C, ReturnType<typeof setTimeout>>();

  constructor(private readonly make: () => C) {
    this.client = make();
  }

  /** The client to ask now. */
  get current(): C {
    return this.client;
  }

  /** A fresh client in place of `stale`, unless another request has replaced it already. */
  renew(stale: C): void {
    if (stale !== this.client) {
      return;
    }
    this.client = this.make();
    const timer = setTimeout(() => {
      this.retiring.delete(stale);
      stale.$disconnect().catch((err: unknown) => {
        console.error(`[escapelab] a replaced database client did not close: ${oneLine(err)}`);
      });
    }, RETIRING_MS);
    timer.unref();
    this.retiring.set(stale, timer);
  }

  /** Every client closed: the one asked now, and those replaced and not closed yet. */
  async close(): Promise<void> {
    const all = [this.client, ...this.retiring.keys()];
    this.retiring.forEach((timer) => clearTimeout(timer));
    this.retiring.clear();
    await Promise.all(all.map((client) => client.$disconnect()));
  }
}

/** The code of Prisma's that `err` carries; null for none. */
function codeOf(err: unknown): string | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return err.code;
  }
  return err instanceof Prisma.PrismaClientInitializationError ? (err.errorCode ?? null) : null;
}

/** Whether `err` is worth asking again for (`ASK_AGAIN`): the request may well go through. */
export function worthAskingAgain(err: unknown): boolean {
  const code = codeOf(err);
  return code !== null && ASK_AGAIN.has(code);
}

/**
 * `work` asked of the client `clients` hands out — once more where it was worth asking again
 * (`worthAskingAgain`): of a fresh client where the database had closed the connection drawn
 * (CLOSED), of the same one else. Anything else, a constraint refused say, is thrown as it came.
 */
export async function onceMore<C extends Closable, T>(
  clients: Clients<C>,
  work: (client: C) => Promise<T>,
): Promise<T> {
  const asked = clients.current;
  try {
    return await work(asked);
  } catch (err) {
    const code = codeOf(err);
    const what = code === null ? undefined : ASK_AGAIN.get(code);
    if (what === undefined) {
      throw err;
    }
    if (code === CLOSED) {
      clients.renew(asked);
    }
    console.log(`[escapelab] the database ${what} (${code}): asked again`);
    return work(clients.current);
  }
}

/**
 * How long a transaction — a run's, a sign-in's — may wait to start, and then take, ms: a Neon
 * compute waking from its pause takes seconds to open a connection, past Prisma's 2 s to start
 * one (P2028).
 */
const TRANSACTION = { maxWait: 15_000, timeout: 15_000 };

/**
 * How long another instance may go on keeping runs around this one's opening, ms: Render
 * switches to a new instance once it is healthy and sends the old one SIGTERM a minute later,
 * and a run that ended just before the opening may be written just after — five minutes leave
 * room for both.
 */
const OVERLAP_MS = 5 * 60_000;

/** How often a read of the Bestenliste looks for runs another instance kept, at most, ms. */
const LOOK_EVERY_MS = 5_000;

/** A run's key, as the database keeps each run once: its room and its start (`runs_once`). */
const runKeyOf = (roomCode: string, startedAt: number): string => `${roomCode}|${startedAt}`;

/**
 * Whether `err` says the database keeps the run already: the unique key on its room and its
 * start (`runs_once`), and no other a write could run into.
 */
export function runKeptAlready(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') {
    return false;
  }
  const { modelName, target } = (err.meta ?? {}) as { modelName?: unknown; target?: unknown };
  const columns = Array.isArray(target) ? [...(target as unknown[])].sort() : [];
  return modelName === 'Run' && columns.join() === 'room_code,started_at';
}

export class PostgresStore implements Store {
  readonly description = 'Postgres at DATABASE_URL: accounts, runs and Erfolge outlast a restart';
  readonly kind = 'database';
  private index = new RunStats();
  /** every run the Bestenliste counts, by `runKeyOf` */
  private counted = new Set<string>();
  /** when the store opened, which runs kept elsewhere around it are looked for (`lookAround`) */
  private readonly openedAt = Date.now();
  /** when the runs kept elsewhere were last looked for; whether a look is under way, or the last */
  private looked = { at: 0, busy: false, done: false };

  private constructor(private readonly clients: Clients<PrismaClient>) {}

  /**
   * The store in the database at `url`, its runs counted. Rejects, saying why, where the
   * database cannot be reached.
   */
  static async open(url: string): Promise<PostgresStore> {
    const pooled = pooledUrl(url);
    const clients = new Clients(() => new PrismaClient({ datasourceUrl: pooled }));
    const store = new PostgresStore(clients);
    try {
      await clients.current.$connect();
    } catch (err) {
      await clients.close();
      throw new Error(
        `the database DATABASE_URL names cannot be reached: ${oneLine(err)} — check the variable`,
      );
    }
    try {
      await store.recount();
    } catch (err) {
      await clients.close();
      throw new Error(
        `the database's runs cannot be read: ${oneLine(err)} — are its migrations applied? ` +
          '(pnpm --filter @escapelab/server prisma migrate deploy, as the server runs it)',
      );
    }
    return store;
  }

  /** The Bestenliste counted afresh from every run kept. */
  private async recount(): Promise<void> {
    this.index = new RunStats();
    this.counted = new Set();
    for (const run of await this.runs()) {
      this.count(run);
    }
  }

  /**
   * `run` counted into the Bestenliste, its key noted (`counted`) — once: a look for runs kept
   * elsewhere (`lookAround`) may come upon a run this store is just counting itself.
   */
  private count(run: LoggedRun): void {
    if (run.version === 2) {
      const key = runKeyOf(run.roomCode, run.startedAt);
      if (this.counted.has(key)) {
        return;
      }
      this.counted.add(key);
    }
    this.index.add(run);
  }

  async appendRun(run: FinishedRun): Promise<void> {
    const { missionId, roomCode, startedAt } = run.report;
    let owners: (string | null)[];
    try {
      owners = await this.write(run);
    } catch (err) {
      if (!runKeptAlready(err)) {
        throw err;
      }
      // The same run once more — a room taken up again from a snapshot made before its end
      // finished it a second time, or a write that landed while its answer was lost with the
      // connection: kept already, and counted here unless it is not yet.
      console.log(`[escapelab] run of ${missionId} in room ${roomCode} kept already`);
      await this.countKept(roomCode, startedAt);
      return;
    }
    this.count(asKept(run.report, owners));
  }

  /**
   * `run` kept (`keep`), and the account on each of its seats: asked again where the database
   * had lost the connection (`onceMore`), and once more where an account of its crew went while
   * it was written — deleted, or left empty by a sign-in (`deleteEmpty`) — the seats read anew.
   * Nothing is kept twice: a write that failed kept nothing, and the room and the start key it.
   */
  private async write(run: FinishedRun): Promise<(string | null)[]> {
    // A run usually ends after minutes without a word to the database: its write is the one
    // most likely to find the connection lost, or to wait while a paused Neon wakes.
    const once = (): Promise<(string | null)[]> =>
      onceMore(this.clients, (db) => db.$transaction((tx) => keep(tx, run), TRANSACTION));
    try {
      return await once();
    } catch (err) {
      if (!accountGone(err)) {
        throw err;
      }
      const { missionId } = run.report;
      console.log(`[escapelab] an account of the crew of ${missionId} went meanwhile: asked again`);
      return once();
    }
  }

  /** The run the database keeps under `roomCode` and `startedAt` counted, where it is not yet. */
  private async countKept(roomCode: string, startedAt: number): Promise<void> {
    if (this.counted.has(runKeyOf(roomCode, startedAt))) {
      return;
    }
    const row = await onceMore(this.clients, (db) =>
      db.run.findUnique({
        where: { roomCode_startedAt: { roomCode, startedAt: new Date(startedAt) } },
        include: { members: true },
      }),
    );
    for (const run of row === null ? [] : this.checked(row)) {
      this.count(run);
    }
  }

  async runs(): Promise<LoggedRun[]> {
    const rows = await onceMore(this.clients, (db) =>
      db.run.findMany({
        include: { members: true },
        orderBy: [{ endedAt: 'asc' }, { id: 'asc' }],
      }),
    );
    return rows.flatMap((row) => this.checked(row));
  }

  stats(): RunStats {
    this.lookAround();
    return this.index;
  }

  /**
   * Runs another instance kept around this one's opening — the old instance of a deploy, ending
   * its runs while this one already counted them all — looked for in the background as the
   * Bestenliste is read, at most every LOOK_EVERY_MS, and counted from the next read on. Once a
   * look began after the overlap was over (`OVERLAP_MS`), none is needed any more.
   */
  private lookAround(): void {
    const now = Date.now();
    const { at, busy, done } = this.looked;
    if (done || busy || now - at < LOOK_EVERY_MS) {
      return;
    }
    const last = now - this.openedAt > OVERLAP_MS;
    this.looked = { at: now, busy: true, done: false };
    this.countAround().then(
      () => {
        this.looked = { at: now, busy: false, done: last };
      },
      (err: unknown) => {
        this.looked = { at: now, busy: false, done: false };
        console.error(`[escapelab] runs kept by another instance not read: ${oneLine(err)}`);
      },
    );
  }

  /** Every run that ended around this store's opening (`OVERLAP_MS`), not counted yet, counted. */
  private async countAround(): Promise<void> {
    const rows = await onceMore(this.clients, (db) =>
      db.run.findMany({
        where: {
          endedAt: {
            gte: new Date(this.openedAt - OVERLAP_MS),
            lte: new Date(this.openedAt + OVERLAP_MS),
          },
        },
        include: { members: true },
        orderBy: [{ endedAt: 'asc' }, { id: 'asc' }],
      }),
    );
    for (const row of rows) {
      if (!this.counted.has(runKeyOf(row.roomCode, row.startedAt.getTime()))) {
        this.checked(row).forEach((run) => this.count(run));
      }
    }
  }

  async runsOfAccount(
    accountId: string,
    limit: number,
  ): Promise<{ total: number; runs: SeatedRun[] }> {
    const [total, seats] = await onceMore(this.clients, (db) =>
      db.$transaction([
        db.runMember.count({ where: { accountId } }),
        db.runMember.findMany({
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
    return onceMore(this.clients, (db) => this.getOrCreate(db, identity, profile));
  }

  findByIdentity(identity: PassIdentity): Promise<Account | null> {
    return onceMore(this.clients, (db) => this.find(db, identity));
  }

  /** `getOrCreateByIdentity`, asked once of the client `db`. */
  private async getOrCreate(
    db: PrismaClient,
    identity: PassIdentity,
    profile: Profile,
  ): Promise<Account> {
    const found = await this.visit(db, identity);
    if (found !== null) {
      return found;
    }
    try {
      const made = await db.account.create({
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
      const meanwhile = alreadyThere(err) ? await this.visit(db, identity) : null;
      if (meanwhile === null) {
        throw err;
      }
      return meanwhile;
    }
  }

  /** `findByIdentity`, asked once of the client `db`. */
  private async find(db: PrismaClient, identity: PassIdentity): Promise<Account | null> {
    const found = await db.identity.findUnique({
      where: { provider_subject: { provider: identity.provider, subject: identity.subject } },
      include: { account: true },
    });
    if (found === null) {
      return null;
    }
    checkSecret(found.secretHash, identity.secretHash);
    return accountOf(found.account);
  }

  /**
   * The account `identity` leads into, its visit noted, asked of the client `db`; null where it
   * leads nowhere yet.
   */
  private async visit(db: PrismaClient, identity: PassIdentity): Promise<Account | null> {
    const found = await this.find(db, identity);
    if (found === null) {
      return null;
    }
    const account = await db.account.update({
      where: { id: found.id },
      data: { lastSeenAt: new Date() },
    });
    return accountOf(account);
  }

  async updateProfile(accountId: string, change: Partial<Profile>): Promise<Account> {
    return accountOf(
      await onceMore(this.clients, (db) =>
        db.account.update({ where: { id: accountId }, data: change }),
      ),
    );
  }

  async achievements(accountId: string): Promise<Unlocked[]> {
    const rows = await onceMore(this.clients, (db) =>
      db.achievement.findMany({ where: { accountId } }),
    );
    return rows.map((row) => ({ key: row.key, unlockedAt: row.unlockedAt.getTime() }));
  }

  async deleteAccount(accountId: string): Promise<void> {
    // Its identities, Erfolge and seats go with it (onDelete: Cascade); the runs stay. The seats
    // it held, read in the same transaction, take its name off the Bestenliste: no run is read
    // but its own, and none appended meanwhile can be left out of the count.
    const [held] = await onceMore(this.clients, (db) =>
      db.$transaction([
        db.runMember.findMany({
          where: { accountId },
          include: { run: { include: { members: true } } },
        }),
        db.account.deleteMany({ where: { id: accountId } }),
      ]),
    );
    for (const { run: row, seatName } of held) {
      for (const run of this.checked(row)) {
        this.index.unname(run, seatName);
      }
    }
  }

  async loginOf(accountId: string): Promise<Login | null> {
    const row = await onceMore(this.clients, (db) =>
      db.identity.findFirst({ where: { accountId, provider: 'login' } }),
    );
    return row === null ? null : { accountId, subject: row.subject, secretHash: row.secretHash };
  }

  async findLogin(subject: string): Promise<Login | null> {
    const row = await onceMore(this.clients, (db) =>
      db.identity.findUnique({ where: { provider_subject: { provider: 'login', subject } } }),
    );
    return row === null ? null : { accountId: row.accountId, subject, secretHash: row.secretHash };
  }

  async addLogin(accountId: string, subject: string, secretHash: string): Promise<void> {
    try {
      await onceMore(this.clients, (db) =>
        db.$transaction(async (tx) => {
          // The account's row held till the end: a Kennwort set for it at once waits, then
          // finds this one.
          await tx.account.update({ where: { id: accountId }, data: { lastSeenAt: new Date() } });
          if ((await tx.identity.count({ where: { accountId, provider: 'login' } })) > 0) {
            throw new GameError(HAS_LOGIN);
          }
          await tx.identity.create({ data: { provider: 'login', subject, secretHash, accountId } });
        }, TRANSACTION),
      );
    } catch (err) {
      throw alreadyThere(err) ? new LoginTaken() : err;
    }
  }

  replaceLoginSecret(
    accountId: string,
    kept: string,
    next: string,
    staying: string,
  ): Promise<SeatPass[] | null> {
    return onceMore(this.clients, (db) =>
      db.$transaction(async (tx) => {
        const { count } = await tx.identity.updateMany({
          where: { accountId, provider: 'login', secretHash: kept },
          data: { secretHash: next },
        });
        return count === 1 ? signOutOthers(tx, accountId, staying) : null;
      }, TRANSACTION),
    );
  }

  signIn(
    pass: PassIdentity,
    accountId: string,
    leaving: Leaving | null,
    checked: string,
  ): Promise<string[] | null> {
    return onceMore(this.clients, (db) =>
      db.$transaction(async (tx) => {
        if (!(await stillKept(tx, accountId, checked))) {
          return null;
        }
        const left = [await pointPass(tx, pass, accountId)];
        if (leaving !== null) {
          left.push(await leave(tx, leaving));
        }
        return deleteEmpty(tx, left, accountId);
      }, TRANSACTION),
    );
  }

  signOut(leaving: Leaving): Promise<string | null> {
    return onceMore(this.clients, (db) =>
      db.$transaction((tx) => leave(tx, leaving), TRANSACTION),
    );
  }

  async close(): Promise<void> {
    await this.clients.close();
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

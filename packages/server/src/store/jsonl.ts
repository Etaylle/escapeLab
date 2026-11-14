import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameError, type RunReport } from '@escapelab/core';
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
 * The store without a database, as development and CI run: the run log — one line of JSON per
 * finished run, appended, never rewritten, which the Bestenliste counts once at start and then
 * run by run — and the accounts in memory, for as long as the server runs. `GET /runs.jsonl`
 * hands the runs out and `scripts/runs.ts` sums a run log up.
 */

/** The run log unless RUNS_LOG names another: `data/runs.jsonl` in the server package. */
export const DEFAULT_RUNS_LOG = fileURLToPath(new URL('../../data/runs.jsonl', import.meta.url));

/**
 * One finished run onto the end of the log at `file`; its directory is made on demand. Throws,
 * naming the file and what to do, where it cannot be written.
 */
export function appendLine(file: string, report: RunReport): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(report)}\n`, 'utf8');
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new Error(
      `run report not written to ${file}: ${why} — point RUNS_LOG at a writable file`,
    );
  }
}

/**
 * The runs in the text of a run log, oldest first, and what is wrong with each line that holds
 * none, by its place in `source`; blank lines are skipped. For a reader that goes on past a bad
 * line.
 */
export function readRuns(
  text: string,
  source: string,
): { runs: LoggedRun[]; problems: string[] } {
  const runs: LoggedRun[] = [];
  const problems: string[] = [];
  text.split('\n').forEach((line, i) => {
    if (line.trim() === '') {
      return;
    }
    const where = `${source}:${i + 1}`;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      problems.push(`${where}: not JSON (${why}) — fix or delete that line`);
      return;
    }
    if (isLoggedRun(parsed)) {
      runs.push(parsed);
    } else {
      problems.push(`${where}: not a run report of version 1 or 2 — fix or delete that line`);
    }
  });
  return { runs, problems };
}

/** The runs in the text of a run log, oldest first; throws naming the first line holding none. */
export function parseRuns(text: string, source: string): LoggedRun[] {
  const { runs, problems } = readRuns(text, source);
  if (problems[0] !== undefined) {
    throw new Error(problems[0]);
  }
  return runs;
}

/**
 * The runs of the log at `file`, and what is wrong with it: none yet where there is no log; a
 * log that cannot be read is one problem, each line that holds no run another.
 */
function loadRuns(file: string): { runs: LoggedRun[]; problems: string[] } {
  if (!existsSync(file)) {
    return { runs: [], problems: [] };
  }
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return {
      runs: [],
      problems: [`run log ${file} not read: ${why} — point RUNS_LOG at a readable file`],
    };
  }
  return readRuns(text, file);
}

/** An identity's key in memory: its provider and its subject. */
const keyOf = (identity: { provider: string; subject: string }): string =>
  `${identity.provider}:${identity.subject}`;

/** What the key of a pass's way in starts with (`keyOf`): its provider. */
const PASS = 'pass:';

/** What the key of a login in memory starts with (`keyOf`): its provider. */
const LOGIN = 'login:';

/** The key of the login of the Ausweisnummer `subject` in memory (`keyOf`). */
const loginKeyOf = (subject: string): string => `${LOGIN}${subject}`;

/** A run's key in memory: its room and its start, which name it. */
const runKeyOf = (run: RunReport): string => `${run.roomCode}|${run.startedAt}`;

/** A seat's key in memory: its run's (`runKeyOf`), and the seat. */
const seatKeyOf = (run: RunReport, seat: number): string => `${runKeyOf(run)}|${seat}`;

/** `run` with the seats `gone` named '' and credited nothing. */
function withoutSeats<T extends RunReport>(run: T, gone: readonly number[]): T {
  const aliases = new Set(gone.map(aliasOf));
  return {
    ...run,
    crew: run.crew.map((name, seat) => (gone.includes(seat) ? '' : name)),
    credits: Object.fromEntries(
      Object.entries(run.credits).filter(([alias]) => !aliases.has(alias)),
    ),
  };
}

/**
 * The runs in the log at `file`, its accounts in memory. A deleted account's name leaves the
 * runs it played since the server started — in the Bestenliste and in what `runs` hands out —
 * while the log keeps every name it was written with: counted anew from it after a restart.
 */
export class JsonlStore implements Store {
  readonly description: string;
  readonly kind = 'run-log';
  private readonly accounts = new Map<string, Account>();
  /** each identity's account and the hash of its secret, by `keyOf` */
  private readonly identities = new Map<string, { accountId: string; secretHash: string }>();
  /** each account's Erfolge: when each was first earned, by key */
  private readonly earned = new Map<string, Map<string, number>>();
  /**
   * each account's seats in the runs appended since the server started, the oldest first: in
   * the store's own copy of each run, which a deleted account's name leaves
   */
  private readonly seated = new Map<string, SeatedRun[]>();
  /** the seats of accounts deleted since the server started, by `seatKeyOf` */
  private readonly unseated = new Set<string>();

  private constructor(
    private readonly file: string,
    private readonly index: RunStats,
    /** every run in the log, by `runKeyOf`: none is written twice */
    private readonly logged: Set<string>,
  ) {
    this.description =
      `run log ${file}, accounts in memory until the server stops (no DATABASE_URL)`;
  }

  /**
   * The store over the log at `file`, its runs counted once: each line that holds none is
   * reported and left out, and so is a log that cannot be read — the Bestenliste must never keep
   * the server from starting.
   */
  static open(file: string): JsonlStore {
    const { runs, problems } = loadRuns(file);
    for (const problem of problems) {
      console.error(`[escapelab] ${problem} (the Bestenliste leaves it out)`);
    }
    const logged = new Set(runs.flatMap((run) => (run.version === 1 ? [] : [runKeyOf(run)])));
    return new JsonlStore(file, new RunStats(runs), logged);
  }

  async appendRun({ report, passes }: FinishedRun): Promise<void> {
    if (this.logged.has(runKeyOf(report))) {
      // The same run once more — a room taken up again from a snapshot made before its end
      // finished it a second time: kept and counted already.
      console.log(`[escapelab] run of ${report.missionId} in room ${report.roomCode} kept already`);
      return;
    }
    appendLine(this.file, report);
    this.logged.add(runKeyOf(report));
    this.index.add(report);
    const unlocked = unlockedBy(report);
    const kept: RunReport = { ...report, crew: [...report.crew], credits: { ...report.credits } };
    passes.forEach((pass, seat) => {
      const accountId = this.ownerOf(pass);
      if (accountId !== null) {
        const seats = this.seated.get(accountId) ?? [];
        this.seated.set(accountId, [...seats, { run: kept, seat }]);
        this.unlock(accountId, unlocked);
      }
    });
  }

  /**
   * The account whose identity `pass` is — its id and the hash of its secret both, for an id
   * alone credits nobody; null for none.
   */
  private ownerOf(pass: SeatPass | null): string | null {
    const known = pass === null ? undefined : this.identities.get(`${PASS}${pass.id}`);
    const shown = known !== undefined && pass !== null;
    return shown && sameSecretHash(known.secretHash, pass.secretHash) ? known.accountId : null;
  }

  /** `unlocked` earned by `accountId`: each Erfolg it had already keeps its first date. */
  private unlock(accountId: string, unlocked: readonly Unlocked[]): void {
    const earned = this.earned.get(accountId) ?? new Map<string, number>();
    for (const { key, unlockedAt } of unlocked) {
      if (!earned.has(key)) {
        earned.set(key, unlockedAt);
      }
    }
    this.earned.set(accountId, earned);
  }

  async runs(): Promise<LoggedRun[]> {
    const { runs } = loadRuns(this.file);
    return runs.map((run) => this.withoutUnseated(run));
  }

  /** `run` as the store hands it out: the seats of accounts deleted since named ''. */
  private withoutUnseated(run: LoggedRun): LoggedRun {
    if (run.version === 1 || this.unseated.size === 0) {
      return run;
    }
    const gone = run.crew.flatMap((_, seat) =>
      this.unseated.has(seatKeyOf(run, seat)) ? [seat] : [],
    );
    return gone.length === 0 ? run : withoutSeats(run, gone);
  }

  stats(): RunStats {
    return this.index;
  }

  async runsOfAccount(
    accountId: string,
    limit: number,
  ): Promise<{ total: number; runs: SeatedRun[] }> {
    const seats = this.seated.get(accountId) ?? [];
    return { total: seats.length, runs: [...seats].reverse().slice(0, limit) };
  }

  async getOrCreateByIdentity(identity: PassIdentity, profile: Profile): Promise<Account> {
    const known = this.identities.get(keyOf(identity));
    const now = Date.now();
    if (known !== undefined) {
      checkSecret(known.secretHash, identity.secretHash);
      const account = this.account(known.accountId);
      account.lastSeenAt = now;
      return { ...account };
    }
    const account: Account = { id: randomUUID(), ...profile, createdAt: now, lastSeenAt: now };
    this.accounts.set(account.id, account);
    this.identities.set(keyOf(identity), {
      accountId: account.id,
      secretHash: identity.secretHash,
    });
    return { ...account };
  }

  async findByIdentity(identity: PassIdentity): Promise<Account | null> {
    const known = this.identities.get(keyOf(identity));
    if (known === undefined) {
      return null;
    }
    checkSecret(known.secretHash, identity.secretHash);
    return { ...this.account(known.accountId) };
  }

  async updateProfile(accountId: string, change: Partial<Profile>): Promise<Account> {
    const account = this.account(accountId);
    Object.assign(account, change);
    return { ...account };
  }

  async achievements(accountId: string): Promise<Unlocked[]> {
    const earned = [...(this.earned.get(accountId) ?? [])];
    return earned.map(([key, unlockedAt]) => ({ key, unlockedAt }));
  }

  async deleteAccount(accountId: string): Promise<void> {
    this.drop(accountId);
  }

  /** The account of `accountId` gone (`deleteAccount`): its name off its runs, the rest deleted. */
  private drop(accountId: string): void {
    for (const { run, seat } of this.seated.get(accountId) ?? []) {
      this.unseat(run, seat);
    }
    this.accounts.delete(accountId);
    for (const [key, identity] of this.identities) {
      if (identity.accountId === accountId) {
        this.identities.delete(key);
      }
    }
    this.earned.delete(accountId);
    this.seated.delete(accountId);
  }

  async loginOf(accountId: string): Promise<Login | null> {
    return this.loginIn(accountId);
  }

  /** The login of `accountId` (`loginOf`), read at once: a write that checks it awaits nothing. */
  private loginIn(accountId: string): Login | null {
    for (const [key, identity] of this.identities) {
      if (identity.accountId === accountId && key.startsWith(LOGIN)) {
        return { accountId, subject: key.slice(LOGIN.length), secretHash: identity.secretHash };
      }
    }
    return null;
  }

  async findLogin(subject: string): Promise<Login | null> {
    const known = this.identities.get(loginKeyOf(subject));
    return known === undefined ? null : { ...known, subject };
  }

  async addLogin(accountId: string, subject: string, secretHash: string): Promise<void> {
    this.account(accountId);
    if (this.loginIn(accountId) !== null) {
      throw new GameError(HAS_LOGIN);
    }
    if (this.identities.has(loginKeyOf(subject))) {
      throw new LoginTaken();
    }
    this.identities.set(loginKeyOf(subject), { accountId, secretHash });
  }

  async replaceLoginSecret(
    accountId: string,
    kept: string,
    next: string,
    staying: string,
  ): Promise<SeatPass[] | null> {
    const login = this.loginIn(accountId);
    if (login === null || login.secretHash !== kept) {
      return null;
    }
    this.identities.set(loginKeyOf(login.subject), { accountId, secretHash: next });
    const signedOut: SeatPass[] = [];
    for (const [key, known] of this.identities) {
      const id = key.slice(PASS.length);
      const other = key.startsWith(PASS) && id !== staying && known.secretHash !== PARKED;
      if (other && known.accountId === accountId) {
        signedOut.push({ id, secretHash: known.secretHash });
        this.identities.set(key, { accountId, secretHash: PARKED });
      }
    }
    return signedOut;
  }

  async signIn(
    pass: PassIdentity,
    accountId: string,
    leaving: Leaving | null,
    checked: string,
  ): Promise<string[] | null> {
    if (this.loginIn(accountId)?.secretHash !== checked) {
      return null;
    }
    this.account(accountId);
    // Both passes checked before anything changes: a pass refused changes nothing.
    const before = this.shown(pass)?.accountId ?? null;
    const left = leaving === null ? null : this.shown(leaving.pass);
    this.identities.set(keyOf(pass), { accountId, secretHash: pass.secretHash });
    if (leaving !== null) {
      this.leave(leaving);
    }
    return [before, left?.accountId ?? null].flatMap((id) =>
      id !== null && id !== accountId && this.dropIfEmpty(id) ? [id] : [],
    );
  }

  async signOut(leaving: Leaving): Promise<string | null> {
    const known = this.shown(leaving.pass);
    this.leave(leaving);
    return known?.accountId ?? null;
  }

  /**
   * What memory keeps of the way in of `pass`; undefined for none. Throws GameError for a pass
   * shown with the wrong secret.
   */
  private shown(pass: PassIdentity): { accountId: string; secretHash: string } | undefined {
    const known = this.identities.get(keyOf(pass));
    if (known !== undefined) {
      checkSecret(known.secretHash, pass.secretHash);
    }
    return known;
  }

  /** `leaving` signed out: the pass's way in deleted, or kept for its seat alone (`Leaving`). */
  private leave({ pass, parked }: Leaving): void {
    const known = this.identities.get(keyOf(pass));
    if (known === undefined) {
      return;
    }
    if (parked) {
      this.identities.set(keyOf(pass), { accountId: known.accountId, secretHash: PARKED });
    } else {
      this.identities.delete(keyOf(pass));
    }
  }

  /**
   * The account of `accountId` deleted where nothing is left of it — no way in, no run, no
   * Erfolg; whether it was.
   */
  private dropIfEmpty(accountId: string): boolean {
    const ways = [...this.identities.values()].some((known) => known.accountId === accountId);
    const runs = (this.seated.get(accountId) ?? []).length;
    const earned = this.earned.get(accountId)?.size ?? 0;
    if (ways || runs > 0 || earned > 0 || !this.accounts.has(accountId)) {
      return false;
    }
    this.drop(accountId);
    return true;
  }

  /**
   * The name on `seat` of `run`, the store's copy, taken off it: off the Bestenliste, off the
   * runs `runs` hands out, and off the runs of the rest of its crew.
   */
  private unseat(run: LoggedRun, seat: number): void {
    const name = run.version === 1 ? '' : (run.crew[seat] ?? '');
    if (run.version === 1 || name === '') {
      return;
    }
    this.index.unname(run, name);
    Object.assign(run, withoutSeats(run, [seat]));
    this.unseated.add(seatKeyOf(run, seat));
  }

  async close(): Promise<void> {
    // Nothing is held open: every line is written as its run ends.
  }

  /** The account of `accountId`, as kept; throws for one there is none of. */
  private account(accountId: string): Account {
    const account = this.accounts.get(accountId);
    if (account === undefined) {
      throw new Error(`no account ${accountId} in memory — was it deleted meanwhile?`);
    }
    return account;
  }
}

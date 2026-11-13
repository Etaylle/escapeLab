import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunReport } from '@escapelab/core';
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
const keyOf = (identity: Pick<PassIdentity, 'provider' | 'subject'>): string =>
  `${identity.provider}:${identity.subject}`;

/** The runs in the log at `file`, its accounts in memory. */
export class JsonlStore implements Store {
  readonly description: string;
  private readonly accounts = new Map<string, Account>();
  /** each identity's account and the hash of its secret, by `keyOf` */
  private readonly identities = new Map<string, { accountId: string; secretHash: string }>();
  /** each account's Erfolge: when each was first earned, by key */
  private readonly earned = new Map<string, Map<string, number>>();
  /** each account's seats in the runs appended since the server started, the oldest first */
  private readonly seated = new Map<string, SeatedRun[]>();

  private constructor(
    private readonly file: string,
    private readonly index: RunStats,
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
    return new JsonlStore(file, new RunStats(runs));
  }

  async appendRun({ report, passes }: FinishedRun): Promise<void> {
    appendLine(this.file, report);
    this.index.add(report);
    passes.forEach((passId, seat) => {
      const known = passId === null ? undefined : this.identities.get(`pass:${passId}`);
      if (known !== undefined) {
        const seats = this.seated.get(known.accountId) ?? [];
        this.seated.set(known.accountId, [...seats, { run: report, seat }]);
      }
    });
  }

  async runs(missionId?: string): Promise<LoggedRun[]> {
    const { runs } = loadRuns(this.file);
    return missionId === undefined ? runs : runs.filter((run) => run.missionId === missionId);
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
    this.accounts.delete(accountId);
    for (const [key, identity] of this.identities) {
      if (identity.accountId === accountId) {
        this.identities.delete(key);
      }
    }
    this.earned.delete(accountId);
    this.seated.delete(accountId);
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

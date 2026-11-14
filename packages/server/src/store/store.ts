import { createHash, timingSafeEqual } from 'node:crypto';
import {
  achievementsOf,
  DIFFICULTIES,
  GameError,
  type AccountStore,
  type RunOutcome,
  type RunReport,
} from '@escapelab/core';
import type { RunStats } from '../runStats.js';
import { defaultDirectUrl, migrate } from './migrate.js';

/**
 * What the server keeps beyond a room's life: the finished runs — the Bestenliste counts them —
 * and the accounts, reached by the crew passes of their devices and by an Ausweisnummer and its
 * Kennwort, with the Erfolge each earned. One interface, two stores:
 * Postgres where DATABASE_URL names one (postgres.ts), so that both outlast a deploy; else the
 * run log file and accounts in memory (jsonl.ts), as development and CI run.
 */

/** A report as version 1 wrote it: before the crew's names and the room's code went in. */
export type RunReportV1 = Omit<RunReport, 'version' | 'crew' | 'roomCode'> & { version: 1 };

/** Any report a store holds: version 1 from before names were kept, version 2 since. */
export type LoggedRun = RunReportV1 | RunReport;

/**
 * The pass on a seat as its run ended: its id, and the hash of the secret the seat was bound with
 * (`secretHashOf`) — an account is credited with the seat only where both are its identity's.
 */
export interface SeatPass {
  id: string;
  secretHash: string;
}

/** A finished run as a room hands it over: its report and the pass that held each seat. */
export interface FinishedRun {
  report: RunReport;
  /** the pass that held each seat as the run ended, by p1…pn; null for none */
  passes: readonly (SeatPass | null)[];
}

/** A run of an account's, and the seat it held there: 0 for the report's p1. */
export interface SeatedRun {
  run: LoggedRun;
  seat: number;
}

/** A browser's crew pass as a way into an account: its id, and the hash of its secret. */
export interface PassIdentity {
  provider: 'pass';
  subject: string;
  /** `secretHashOf` the pass's secret: the secret itself is never kept */
  secretHash: string;
}

/**
 * An account's way in by its Ausweisnummer and its Kennwort (login.ts), one an account at most:
 * the account, the Ausweisnummer, and the Kennwort's scrypt hash — null for a login that keeps
 * none, which no Kennwort matches.
 */
export interface Login {
  accountId: string;
  subject: string;
  secretHash: string | null;
}

/** A pass a device lets go of as it signs out (`Store.signOut`, `Store.signIn`). */
export interface Leaving {
  pass: PassIdentity;
  /**
   * whether the pass holds a seat (sockets.ts): its way in stays then, kept under PARKED, for
   * that seat alone — so that the seat's run credits the account still; else it is deleted
   */
  parked: boolean;
}

/**
 * What the way in of a pass signed out keeps in place of the hash of its secret — where it holds a
 * seat, or as its account's Kennwort changed on another device: 32 bytes of zeros, the sha256 of
 * no secret anyone could show. The way in stays for the seat's run to credit the account
 * (seats.ts binds the seat to the same), and the pass, shown again, is told it signed out
 * (`PassSignedOut`).
 */
export const PARKED = '0'.repeat(64);

/** What a pass signed out is told where it is shown again (`PassSignedOut`). */
export const SIGNED_OUT_PASS = 'Dieser Dienstausweis ist vom Konto abgemeldet.';

/**
 * Thrown for a pass shown again whose way in is PARKED: it signed out, or its account's Kennwort
 * changed on another device — its device starts anew on a new pass (sockets.ts).
 */
export class PassSignedOut extends GameError {
  constructor() {
    super(SIGNED_OUT_PASS);
  }
}

/** What a Kennwort set for an account that has one already is told. */
export const HAS_LOGIN = 'Dieses Konto hat schon ein Kennwort.';

/** Thrown where an Ausweisnummer just minted is another login's: one more is minted then. */
export class LoginTaken extends Error {
  constructor() {
    super('the Ausweisnummer minted is another login’s — mint another');
  }
}

/** What a player chose: the name they go by, and their crew colour ('#rrggbb') or none yet. */
export interface Profile {
  displayName: string;
  colour: string | null;
}

/** What the game keeps of a player; times in epoch ms. */
export interface Account extends Profile {
  id: string;
  createdAt: number;
  lastSeenAt: number;
}

/** An Erfolg an account earned: „blackout:ohne-alarm", and the end of the run that first did. */
export interface Unlocked {
  key: string;
  unlockedAt: number;
}

export interface Store {
  /** the start-up log's line: which store this is, and what of the game outlasts a restart */
  readonly description: string;
  /** where it keeps the accounts and the runs, as an account's view says it (`AccountStore`) */
  readonly kind: AccountStore;
  /**
   * Keeps a finished run with a seat for each of its crew — the account of each pass that has
   * one — and the Erfolge it earned for each of those accounts (`unlockedBy`), at once: each
   * Erfolg once, dated by the first run that earned it. Counts the run into the stats. Rejects,
   * naming what to fix, where it could not, and keeps nothing of the run then.
   */
  appendRun(run: FinishedRun): Promise<void>;
  /** Every run kept, the oldest first. */
  runs(): Promise<LoggedRun[]>;
  /** The Bestenliste's numbers over every run kept, up to the last one appended. */
  stats(): RunStats;
  /** How many runs `accountId` played, and the newest `limit` of them, the newest first. */
  runsOfAccount(accountId: string, limit: number): Promise<{ total: number; runs: SeatedRun[] }>;
  /**
   * The account `identity` leads into, its last visit noted — or a new one, with `profile`,
   * where it leads nowhere yet. Throws GameError for a pass shown with the wrong secret.
   */
  getOrCreateByIdentity(identity: PassIdentity, profile: Profile): Promise<Account>;
  /**
   * The account `identity` leads into; null where it leads nowhere. Throws GameError for a pass
   * shown with the wrong secret.
   */
  findByIdentity(identity: PassIdentity): Promise<Account | null>;
  /** The account with `change` made to its profile. Throws for an account there is none of. */
  updateProfile(accountId: string, change: Partial<Profile>): Promise<Account>;
  /** The Erfolge `accountId` earned, each once. */
  achievements(accountId: string): Promise<Unlocked[]>;
  /**
   * The account gone, and its identities, its Erfolge and its seats in the runs with it: the
   * runs stay, without its name — in the Bestenliste and in `runs` at once. A run log keeps the
   * names it was written with, and so does the Bestenliste counted from it after a restart.
   */
  deleteAccount(accountId: string): Promise<void>;
  /** The login of `accountId`; null for an account without a Kennwort. */
  loginOf(accountId: string): Promise<Login | null>;
  /** The login of the Ausweisnummer `subject`; null for one no account has. */
  findLogin(subject: string): Promise<Login | null>;
  /**
   * `accountId` gets its login: the Ausweisnummer `subject`, the Kennwort's hash `secretHash`.
   * Rejects with LoginTaken for an Ausweisnummer another login has, with GameError(HAS_LOGIN)
   * for an account that has one — two set at once give it one — and for an account there is none
   * of; nothing is made then.
   */
  addLogin(accountId: string, subject: string, secretHash: string): Promise<void>;
  /**
   * The Kennwort of `accountId`'s login replaced — `kept` the hash it was checked against, `next`
   * the new one — and every pass that leads into the account but `staying`'s signed out at once,
   * its way in kept under PARKED: its device is told so the next time it shows it, and a seat it
   * holds stays the account's (sockets.ts). Returns those passes, each with the hash its way in
   * kept before. Null, changing nothing, where the login keeps `kept` no more — changed
   * meanwhile, or gone.
   */
  replaceLoginSecret(
    accountId: string,
    kept: string,
    next: string,
    staying: string,
  ): Promise<SeatPass[] | null>;
  /**
   * `pass` leads into `accountId` from now on — its way in made where it had none — and the pass
   * `leaving`, where given, signs out (`Leaving`). Every account either of them led into before
   * that nothing is left of — no way in, no run, no Erfolg — is deleted. All in one go, and only
   * where the account's login still keeps `checked`, the hash its Kennwort was checked against: a
   * Kennwort changed at once signs the pass out with the rest (`replaceLoginSecret`), or it signs
   * nobody in. Returns the ids of the accounts deleted; null, changing nothing, where the login
   * keeps `checked` no more — changed meanwhile, or gone. Throws GameError for a pass shown with
   * the wrong secret, changing nothing.
   */
  signIn(
    pass: PassIdentity,
    accountId: string,
    leaving: Leaving | null,
    checked: string,
  ): Promise<string[] | null>;
  /**
   * The pass of `leaving` signs out (`Leaving`); the account it led into stays whole. Returns that
   * account's id; null where the pass led nowhere. Throws GameError for a pass shown with the
   * wrong secret.
   */
  signOut(leaving: Leaving): Promise<string | null>;
  /** Lets go of what the store holds open; first wait for the runs handed over (`Recorder`). */
  close(): Promise<void>;
}

/** The alias a report gives the crew member on `seat`: p1 for the first. */
export const aliasOf = (seat: number): string => `p${seat + 1}`;

/**
 * The Erfolge a finished run earns each account of its crew (core achievements.ts): „mission:
 * plaque", dated by the run's end; none for a run lost.
 */
export function unlockedBy(report: RunReport): Unlocked[] {
  return achievementsOf(report).map((id) => ({
    key: `${report.missionId}:${id}`,
    unlockedAt: report.finishedAt,
  }));
}

/** The hash an identity keeps of a pass's secret: sha256, hex. */
export function secretHashOf(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** What a pass shown with the wrong secret is told: its id leads into an account it is not. */
export const PASS_REFUSED = 'Dieser Ausweis gilt hier nicht.';

/**
 * Whether `shown` is the hash `kept`, compared in constant time so that the answer's timing tells
 * nothing about either; never for an identity that keeps none.
 */
export function sameSecretHash(kept: string | null, shown: string): boolean {
  const digest = (hex: string): Buffer => createHash('sha256').update(hex).digest();
  return kept !== null && timingSafeEqual(digest(kept), digest(shown));
}

/**
 * Whether a run's seat, bound to the hash `seat`, credits the account of the way in of the same
 * pass that keeps `kept`: the same hash — or a seat the server parked for the account (PARKED,
 * which no secret's hash is): its pass signs out that moment, or signed out, and its way in,
 * parked or about to be, is still the account's (sockets.ts parks the seats first).
 */
export function creditsSeat(kept: string | null, seat: string): boolean {
  return seat === PARKED || sameSecretHash(kept, seat);
}

/**
 * Throws unless `shown` is the hash `kept` (`sameSecretHash`): PassSignedOut where `kept` is
 * PARKED, GameError(PASS_REFUSED) else.
 */
export function checkSecret(kept: string | null, shown: string): void {
  if (!sameSecretHash(kept, shown)) {
    throw kept === PARKED ? new PassSignedOut() : new GameError(PASS_REFUSED);
  }
}

const OUTCOMES: readonly RunOutcome[] = ['won', 'lost:time', 'lost:alarms', 'lost:abandoned'];

/**
 * Whether `value` is a run a store can count: the fields the summary and the Bestenliste read,
 * checked; the rest is trusted to the server that wrote it.
 */
export function isLoggedRun(value: unknown): value is LoggedRun {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const run = value as Partial<Record<keyof RunReport, unknown>>;
  // A moment of 1e999 parses as Infinity: no day of the Tagesschicht, no time to rank.
  const finite = (fields: (keyof RunReport)[]): boolean =>
    fields.every((field) => Number.isFinite(run[field]));
  const common =
    typeof run.missionId === 'string' &&
    DIFFICULTIES.some((difficulty) => difficulty === run.difficulty) &&
    OUTCOMES.some((outcome) => outcome === run.outcome) &&
    finite(['startedAt', 'finishedAt', 'crewSize']) &&
    Array.isArray(run.stations) &&
    Array.isArray(run.penalties);
  if (run.version === 1) {
    return common;
  }
  return (
    run.version === 2 &&
    common &&
    typeof run.roomCode === 'string' &&
    Array.isArray(run.crew) &&
    run.crew.every((name) => typeof name === 'string')
  );
}

/**
 * The store the environment names: Postgres at DATABASE_URL — an empty one counts as unset —
 * else the run log at `runsLog` with the accounts in memory. Rejects where the database cannot
 * be reached: a server that would lose what it ought to keep does not start.
 */
export async function openStore(env: NodeJS.ProcessEnv, runsLog: string): Promise<Store> {
  const url = env['DATABASE_URL'];
  if (url === undefined || url === '') {
    const { JsonlStore } = await import('./jsonl.js');
    return JsonlStore.open(runsLog);
  }
  const { PostgresStore } = await import('./postgres.js');
  return PostgresStore.open(url);
}

/** What readying the store takes: the migrations applied, then the store opened. */
export interface ReadySteps {
  migrate: (env: NodeJS.ProcessEnv) => Promise<void>;
  open: (env: NodeJS.ProcessEnv, runsLog: string) => Promise<Store>;
}

/**
 * The store the environment names (`openStore`), the server's first step: where DATABASE_URL
 * names a database, its direct URL defaulted to it (migrate.ts `defaultDirectUrl`) before
 * anything touches Prisma, and its migrations applied (`migrate`) before the store opens — a
 * Start Command of `node` straight, as Render's, starts as `pnpm run start` does. Rejects where
 * the migrations do not apply: the store is not opened then.
 */
export async function readyStore(
  env: NodeJS.ProcessEnv,
  runsLog: string,
  steps: ReadySteps = { migrate, open: openStore },
): Promise<Store> {
  if ((env['DATABASE_URL'] ?? '') !== '') {
    defaultDirectUrl(env);
    await steps.migrate(env);
  }
  return steps.open(env, runsLog);
}

/** What the server hands every finished run to (room.ts `RunListener`), and how it waits. */
export interface Recorder {
  record: (run: FinishedRun) => void;
  /** Resolves once every run handed over so far is kept, or failed to be. */
  settled: () => Promise<void>;
}

/**
 * Every finished run into `store`, as it ends. A run that cannot be kept is logged, saying
 * why, and dropped: a full disk or a database away must never take a room down with it.
 */
export function recordRuns(store: Pick<Store, 'appendRun'>): Recorder {
  const pending = new Set<Promise<void>>();
  return {
    record: (run) => {
      const kept = store
        .appendRun(run)
        .catch((err: unknown) => {
          const why = err instanceof Error ? err.message : String(err);
          console.error(`[escapelab] run of ${run.report.missionId} not kept: ${why}`);
        })
        .finally(() => pending.delete(kept));
      pending.add(kept);
    },
    settled: async () => {
      await Promise.all([...pending]);
    },
  };
}

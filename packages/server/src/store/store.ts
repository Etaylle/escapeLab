import { createHash, timingSafeEqual } from 'node:crypto';
import {
  DIFFICULTIES,
  GameError,
  type RunOutcome,
  type RunReport,
} from '@escapelab/core';
import type { RunStats } from '../runStats.js';

/**
 * What the server keeps beyond a room's life: the finished runs — the Bestenliste counts them —
 * and the accounts, one per crew pass, with the Erfolge each earned. One interface, two stores:
 * Postgres where DATABASE_URL names one (postgres.ts), so that both outlast a deploy; else the
 * run log file and accounts in memory (jsonl.ts), as development and CI run.
 */

/** A report as version 1 wrote it: before the crew's names and the room's code went in. */
export type RunReportV1 = Omit<RunReport, 'version' | 'crew' | 'roomCode'> & { version: 1 };

/** Any report a store holds: version 1 from before names were kept, version 2 since. */
export type LoggedRun = RunReportV1 | RunReport;

/** A finished run as a room hands it over: its report and the pass that held each seat. */
export interface FinishedRun {
  report: RunReport;
  /** the id of the pass that held each seat as the run ended, by p1…pn; null for none */
  passes: readonly (string | null)[];
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
  /**
   * Keeps a finished run with a seat for each of its crew — the account of each pass that has
   * one — and counts it into the stats. Rejects, naming what to fix, where it could not.
   */
  appendRun(run: FinishedRun): Promise<void>;
  /** Every run kept, the oldest first; only those of `missionId` where it is given. */
  runs(missionId?: string): Promise<LoggedRun[]>;
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
   * runs stay, without its name.
   */
  deleteAccount(accountId: string): Promise<void>;
  /** Lets go of what the store holds open; first wait for the runs handed over (`Recorder`). */
  close(): Promise<void>;
}

/** The hash an identity keeps of a pass's secret: sha256, hex. */
export function secretHashOf(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** What a pass shown with the wrong secret is told: its id leads into an account it is not. */
export const PASS_REFUSED = 'Dieser Ausweis gilt hier nicht.';

/**
 * Throws GameError(PASS_REFUSED) unless `shown` is the hash `kept`, compared in constant time
 * so that the answer's timing tells nothing about either.
 */
export function checkSecret(kept: string | null, shown: string): void {
  const digest = (hex: string): Buffer => createHash('sha256').update(hex).digest();
  if (kept === null || !timingSafeEqual(digest(kept), digest(shown))) {
    throw new GameError(PASS_REFUSED);
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

import { describe, expect, it } from 'vitest';
import {
  achievementsOf,
  NO_CREDITS,
  type Difficulty,
  type RunOutcome,
  type RunReport,
} from '@escapelab/core';
import {
  PASS_REFUSED,
  secretHashOf,
  type FinishedRun,
  type PassIdentity,
  type Store,
} from '../src/store/store.js';
import { passFor } from './passes.js';

/**
 * What every store keeps to (src/store/store.ts), whichever it is: the run log with the accounts
 * in memory, or Postgres. Each test opens the store afresh over storage of its own.
 */

/** Noon UTC, so that the day is the same in every time zone the tests run in. */
export const DAY = Date.UTC(2026, 10, 13, 12, 0);

/** What a test asks of a run's report. */
export interface Parts {
  mission?: string;
  difficulty?: Difficulty;
  outcome?: RunOutcome;
  /** from the start to the end */
  seconds?: number;
  crew?: string[];
  /** when it ended */
  at?: number;
}

/** A report as the server writes one, played by Anna and Ben unless named, each credited. */
export function reportOf(parts: Parts = {}): RunReport {
  const { mission = 'blackout', difficulty = 'normal', outcome = 'won', seconds = 300 } = parts;
  const { crew = ['Anna', 'Ben'], at = DAY } = parts;
  const aliases = crew.map((_, i) => `p${i + 1}`);
  return {
    version: 2,
    missionId: mission,
    roomCode: 'QXT4',
    difficulty,
    timeLimitSec: 900,
    alarmLimit: 5,
    crewSize: crew.length,
    crew,
    spawns: Object.fromEntries(aliases.map((alias, i) => [alias, { x: i, y: 1 }])),
    startedAt: at - seconds * 1000,
    lightsOutAt: at - seconds * 1000,
    finishedAt: at,
    outcome,
    stations: [
      {
        puzzleId: 'notlicht',
        type: 'button-sync',
        openedAt: at - seconds * 1000,
        solvedAt: at,
        seconds,
        alarms: 0,
        hints: 0,
      },
    ],
    emergencies: { count: 0, failed: 0 },
    notes: { read: 1, total: 2 },
    drones: 2,
    penalties: [{ cause: 'Falsche Taste', count: 1, seconds: 20 }],
    credits: Object.fromEntries(
      aliases.map((alias, i) => [alias, { ...NO_CREDITS, operated: i + 1, read: 1 }]),
    ),
  };
}

/** The identity of `name`'s browser pass, as the server shows it to a store. */
export function identityOf(name: string, secret = passFor(name).secret): PassIdentity {
  return { provider: 'pass', subject: passFor(name).id, secretHash: secretHashOf(secret) };
}

/** A finished run of `parts`, each seat held by the pass of the name given, or by none. */
export function finished(parts: Parts, holders: readonly (string | null)[]): FinishedRun {
  return {
    report: reportOf(parts),
    passes: holders.map((name) => (name === null ? null : passFor(name).id)),
  };
}

/** A store opened over storage of its own, and how to open another over the same storage. */
export interface Opened {
  store: Store;
  reopen: () => Promise<Store>;
}

const anna = { displayName: 'Anna', colour: '#2dd4bf' };

/** Runs the contract against the store `open` opens, under `name`. */
export function storeContract(name: string, open: () => Promise<Opened>): void {
  describe(`${name}: the runs`, () => {
    it('hands a run back whole, the oldest first, those of one mission where asked', async () => {
      const { store } = await open();
      const first = finished({ at: DAY, crew: ['Anna', 'Ben', 'Cleo'] }, [null, null, null]);
      const second = finished({ mission: 'systemcheck', at: DAY + 1 }, [null, null]);
      await store.appendRun(first);
      await store.appendRun(second);
      expect(await store.runs()).toEqual([first.report, second.report]);
      expect(await store.runs('systemcheck')).toEqual([second.report]);
      expect(await store.runs('nirgends')).toEqual([]);
    });

    it('counts what it keeps into the Bestenliste, and again when opened anew', async () => {
      const { store, reopen } = await open();
      expect(store.stats().runs).toBe(0);
      await store.appendRun(finished({ seconds: 300 }, [null, null]));
      await store.appendRun(finished({ seconds: 280, at: DAY + 1, crew: ['Cleo'] }, [null]));
      await store.appendRun(finished({ outcome: 'lost:time', at: DAY + 2 }, [null, null]));
      const counted = (opened: Store) =>
        opened.stats().mission('blackout')?.difficulties.find((d) => d.difficulty === 'normal');
      expect(counted(store)).toMatchObject({ runs: 3, wins: 2, bestSeconds: 280 });
      expect(counted(store)?.top.map((entry) => entry.crew)).toEqual([['Cleo'], ['Anna', 'Ben']]);
      const again = await reopen();
      expect(again.stats().runs).toBe(3);
      expect(counted(again)).toEqual(counted(store));
    });
  });

  describe(`${name}: the accounts`, () => {
    it('makes an account for a pass the first time, and finds it after', async () => {
      const { store } = await open();
      const made = await store.getOrCreateByIdentity(identityOf('Anna'), anna);
      expect(made).toMatchObject(anna);
      const other = { displayName: 'Andere', colour: null };
      const found = await store.getOrCreateByIdentity(identityOf('Anna'), other);
      expect(found).toMatchObject({ id: made.id, ...anna, createdAt: made.createdAt });
      expect(found.lastSeenAt).toBeGreaterThanOrEqual(made.lastSeenAt);
      const ben = await store.getOrCreateByIdentity(identityOf('Ben'), other);
      expect(ben.id).not.toBe(made.id);
    });

    it('refuses a pass shown with a secret not its own', async () => {
      const { store } = await open();
      await store.getOrCreateByIdentity(identityOf('Anna'), anna);
      const forged = identityOf('Anna', 'f'.repeat(64));
      await expect(store.getOrCreateByIdentity(forged, anna)).rejects.toThrow(PASS_REFUSED);
      await expect(store.findByIdentity(forged)).rejects.toThrow(PASS_REFUSED);
    });

    it('finds the account of a pass without making one', async () => {
      const { store } = await open();
      expect(await store.findByIdentity(identityOf('Anna'))).toBeNull();
      expect(await store.findByIdentity(identityOf('Anna'))).toBeNull();
      const made = await store.getOrCreateByIdentity(identityOf('Anna'), anna);
      const found = await store.findByIdentity(identityOf('Anna'));
      expect(found).toMatchObject({ id: made.id, ...anna });
    });

    it('changes a profile part by part', async () => {
      const { store } = await open();
      const { id } = await store.getOrCreateByIdentity(identityOf('Anna'), anna);
      expect(await store.updateProfile(id, { displayName: 'Anna K.' })).toMatchObject({
        displayName: 'Anna K.',
        colour: anna.colour,
      });
      expect(await store.updateProfile(id, { colour: '#f97316' })).toMatchObject({
        displayName: 'Anna K.',
        colour: '#f97316',
      });
      const found = await store.getOrCreateByIdentity(identityOf('Anna'), anna);
      expect(found).toMatchObject({ displayName: 'Anna K.', colour: '#f97316' });
    });

    it('seats an account in the runs its pass played, the newest first', async () => {
      const { store } = await open();
      const annas = await store.getOrCreateByIdentity(identityOf('Anna'), anna);
      const bens = await store.getOrCreateByIdentity(identityOf('Ben'), anna);
      const crew = ['Anna', 'Cleo', 'Ben'];
      await store.appendRun(finished({ crew, at: DAY }, ['Anna', null, 'Ben']));
      const lost = { crew, at: DAY + 1, outcome: 'lost:time' as const };
      await store.appendRun(finished(lost, ['Anna', null, 'Ben']));
      await store.appendRun(finished({ crew: ['Cleo', 'Dan'], at: DAY + 2 }, ['Cleo', 'Dan']));
      const of = await store.runsOfAccount(annas.id, 10);
      expect(of.total).toBe(2);
      expect(of.runs.map(({ run, seat }) => [run.finishedAt, seat])).toEqual([
        [DAY + 1, 0],
        [DAY, 0],
      ]);
      expect(of.runs[1]?.run).toEqual(reportOf({ crew, at: DAY }));
      expect((await store.runsOfAccount(bens.id, 1)).runs.map(({ seat }) => seat)).toEqual([2]);
      expect((await store.runsOfAccount(bens.id, 1)).total).toBe(2);
    });

    it('links no seat whose pass had no account as the run ended', async () => {
      const { store } = await open();
      await store.appendRun(finished({}, ['Anna', 'Ben']));
      const late = await store.getOrCreateByIdentity(identityOf('Anna'), anna);
      expect(await store.runsOfAccount(late.id, 10)).toEqual({ total: 0, runs: [] });
    });

    it('knows no Erfolge of a new account', async () => {
      const { store } = await open();
      const { id } = await store.getOrCreateByIdentity(identityOf('Anna'), anna);
      expect(await store.achievements(id)).toEqual([]);
    });

    it('unlocks what a won run earns for each account of its crew, each once', async () => {
      const { store } = await open();
      const annas = await store.getOrCreateByIdentity(identityOf('Anna'), anna);
      const bens = await store.getOrCreateByIdentity(identityOf('Ben'), anna);
      const earned = achievementsOf(reportOf()).map((id) => `blackout:${id}`);
      expect(earned.length).toBeGreaterThan(0);
      await store.appendRun(finished({ at: DAY, outcome: 'lost:time' }, ['Anna', null]));
      expect(await store.achievements(annas.id)).toEqual([]);
      await store.appendRun(finished({ at: DAY + 1 }, ['Anna', null]));
      await store.appendRun(finished({ at: DAY + 2, crew: ['Anna'] }, ['Anna']));
      const kept = await store.achievements(annas.id);
      const dated = kept.map(({ key, unlockedAt }) => [key, unlockedAt]);
      expect(dated.sort()).toEqual(earned.map((key) => [key, DAY + 1]).sort());
      // Ben sat in no run, his account earned nothing; the seat no account held, nobody.
      expect(await store.achievements(bens.id)).toEqual([]);
      await store.deleteAccount(annas.id);
      expect(await store.achievements(annas.id)).toEqual([]);
    });

    it('deletes an account with its identity and its seats, and keeps the runs', async () => {
      const { store } = await open();
      const gone = await store.getOrCreateByIdentity(identityOf('Anna'), anna);
      await store.appendRun(finished({}, ['Anna', 'Ben']));
      await store.deleteAccount(gone.id);
      expect(await store.runsOfAccount(gone.id, 10)).toEqual({ total: 0, runs: [] });
      expect(await store.runs()).toHaveLength(1);
      expect(store.stats().runs).toBe(1);
      // The pass is a stranger now: it makes a new account.
      const fresh = await store.getOrCreateByIdentity(identityOf('Anna'), anna);
      expect(fresh.id).not.toBe(gone.id);
      expect(await store.runsOfAccount(fresh.id, 10)).toEqual({ total: 0, runs: [] });
    });
  });
}

import { describe, expect, it, vi } from 'vitest';
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
  type SeatPass,
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

/** The pass of `name`'s browser on a seat, as its room hands it over: its id, its secret's hash. */
export function seatPassOf(name: string): SeatPass {
  const pass = passFor(name);
  return { id: pass.id, secretHash: secretHashOf(pass.secret) };
}

/** A finished run of `parts`, each seat held by the pass of the name given, or by none. */
export function finished(parts: Parts, holders: readonly (string | null)[]): FinishedRun {
  return {
    report: reportOf(parts),
    passes: holders.map((name) => (name === null ? null : seatPassOf(name))),
  };
}

/** A store opened over storage of its own, and how to open another over the same storage. */
export interface Opened {
  store: Store;
  reopen: () => Promise<Store>;
}

const anna = { displayName: 'Anna', colour: '#2dd4bf' };

/**
 * An account for the pass of each of `names`: a seat keeps its name in every store only where an
 * account held it (Postgres keeps none of a seat without one).
 */
export async function withAccounts(store: Store, names: readonly string[]): Promise<void> {
  for (const name of names) {
    await store.getOrCreateByIdentity(identityOf(name), { displayName: name, colour: null });
  }
}

/** Runs the contract against the store `open` opens, under `name`. */
export function storeContract(name: string, open: () => Promise<Opened>): void {
  describe(`${name}: the runs`, () => {
    it('hands every run back whole, the oldest first', async () => {
      const { store } = await open();
      await withAccounts(store, ['Anna', 'Ben', 'Cleo']);
      const first = finished({ at: DAY, crew: ['Anna', 'Ben', 'Cleo'] }, ['Anna', 'Ben', 'Cleo']);
      const second = finished({ mission: 'systemcheck', at: DAY + 1 }, ['Anna', 'Ben']);
      await store.appendRun(first);
      await store.appendRun(second);
      expect(await store.runs()).toEqual([first.report, second.report]);
    });

    it('keeps a run once that ends twice: a room taken up again from a snapshot', async () => {
      const { store, reopen } = await open();
      await withAccounts(store, ['Anna', 'Ben']);
      const run = finished({ at: DAY }, ['Anna', 'Ben']);
      const said = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        await store.appendRun(run);
        await store.appendRun({ ...run, report: { ...run.report } });
        expect(said).toHaveBeenCalledWith('[escapelab] run of blackout in room QXT4 kept already');
      } finally {
        said.mockRestore();
      }
      expect([(await store.runs()).length, store.stats().runs]).toEqual([1, 1]);
      expect((await reopen()).stats().runs).toBe(1);
    });

    it('counts what it keeps into the Bestenliste, and again when opened anew', async () => {
      const { store, reopen } = await open();
      expect(store.stats().runs).toBe(0);
      await withAccounts(store, ['Anna', 'Ben', 'Cleo']);
      await store.appendRun(finished({ seconds: 300 }, ['Anna', 'Ben']));
      await store.appendRun(finished({ seconds: 280, at: DAY + 1, crew: ['Cleo'] }, ['Cleo']));
      await store.appendRun(finished({ outcome: 'lost:time', at: DAY + 2 }, ['Anna', 'Ben']));
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
      await withAccounts(store, ['Cleo']);
      const crew = ['Anna', 'Cleo', 'Ben'];
      await store.appendRun(finished({ crew, at: DAY }, ['Anna', 'Cleo', 'Ben']));
      const lost = { crew, at: DAY + 1, outcome: 'lost:time' as const };
      await store.appendRun(finished(lost, ['Anna', 'Cleo', 'Ben']));
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

    it('credits no account to a seat bound with its pass id and another secret', async () => {
      const { store } = await open();
      const annas = await store.getOrCreateByIdentity(identityOf('Anna'), anna);
      const forged = { id: passFor('Anna').id, secretHash: secretHashOf('f'.repeat(64)) };
      await store.appendRun({ ...finished({}, [null, null]), passes: [forged, null] });
      expect(await store.runsOfAccount(annas.id, 10)).toEqual({ total: 0, runs: [] });
      expect(await store.achievements(annas.id)).toEqual([]);
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

    it('takes a deleted account’s name off its runs at once, wherever they are shown', async () => {
      const { store } = await open();
      const gone = await store.getOrCreateByIdentity(identityOf('Anna'), anna);
      const bens = await store.getOrCreateByIdentity(identityOf('Ben'), anna);
      const daily = finished({ at: DAY + 1 }, ['Anna', 'Ben']);
      await store.appendRun(finished({ at: DAY }, ['Anna', 'Ben']));
      await store.appendRun({ ...daily, report: { ...daily.report, daily: true } });
      await store.deleteAccount(gone.id);
      const runs = await store.runs();
      expect(runs.map((run) => (run.version === 2 ? run.crew : []))).toEqual([
        ['', 'Ben'],
        ['', 'Ben'],
      ]);
      expect(runs.map((run) => (run.version === 2 ? Object.keys(run.credits) : []))).toEqual([
        ['p2'],
        ['p2'],
      ]);
      const top = store.stats().mission('blackout')?.difficulties[0]?.top;
      expect(top?.map((entry) => [entry.crew, entry.crewSize])).toEqual([[['Ben'], 2]]);
      const day = store.stats().daily()[0]?.missions[0]?.difficulties[0]?.top;
      expect(day?.map((entry) => entry.crew)).toEqual([['Ben']]);
      const ofBen = await store.runsOfAccount(bens.id, 5);
      expect(ofBen.runs.map(({ run }) => (run.version === 2 ? run.crew : []))).toEqual([
        ['', 'Ben'],
        ['', 'Ben'],
      ]);
    });
  });
}

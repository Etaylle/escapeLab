import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { achievementsOf, utcDay } from '@escapelab/core';
import {
  AccountDesk,
  accountRunOf,
  byMission,
  MY_RUNS,
  WRONG_LOGIN,
} from '../src/accounts.js';
import { DeriveQueue } from '../src/login.js';
import { JsonlStore } from '../src/store/jsonl.js';
import { LoginTaken, type Profile, type RunReportV1 } from '../src/store/store.js';
import { passFor } from './passes.js';
import { DAY, finished, reportOf } from './storeContract.js';

/** A desk over a store of its own: the run log in a folder of its own, the accounts in memory. */
function desk(): { desk: AccountDesk; store: JsonlStore } {
  const store = JsonlStore.open(join(mkdtempSync(join(tmpdir(), 'escapelab-desk-')), 'runs.jsonl'));
  return { desk: new AccountDesk(store), store };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a run as „Meine Einsätze" lists it', () => {
  it('has the seat, the time on the clock and the grade the end screen gave', () => {
    // 300 s of 900 with one alarm and no note: an A.
    const run = accountRunOf({ run: reportOf({ crew: ['Cleo', 'Anna'], at: DAY }), seat: 1 });
    expect(run).toEqual({
      missionId: 'blackout',
      difficulty: 'normal',
      daily: null,
      outcome: 'won',
      finishedAt: DAY,
      seconds: 300,
      crew: ['Cleo', 'Anna'],
      seat: 1,
      rank: 'A',
    });
  });

  it('names the Tagesschicht’s day, gives a lost run no grade, and an old report no names', () => {
    const daily = { ...reportOf({ outcome: 'lost:alarms' }), daily: true as const };
    expect(accountRunOf({ run: daily, seat: 0 })).toMatchObject({
      daily: utcDay(daily.startedAt),
      outcome: 'lost:alarms',
      rank: null,
    });
    // A report as version 1 wrote it, before names and the room went in.
    const old: Record<string, unknown> = { ...reportOf(), version: 1 };
    delete old['crew'];
    delete old['roomCode'];
    expect(accountRunOf({ run: old as RunReportV1, seat: 0 }).crew).toEqual([]);
  });
});

describe('the Erfolge of an account by mission', () => {
  it('groups them by mission, and leaves out a key that names no plaque', () => {
    expect(
      byMission([
        { key: 'blackout:ohne-alarm', unlockedAt: 1 },
        { key: 'blackout:erste-schicht', unlockedAt: 2 },
        { key: 'systemcheck:erste-schicht', unlockedAt: 3 },
        { key: 'blackout:erfunden', unlockedAt: 4 },
        { key: 'ohne-doppelpunkt', unlockedAt: 5 },
      ]),
    ).toEqual({
      blackout: { 'ohne-alarm': 1, 'erste-schicht': 2 },
      systemcheck: { 'erste-schicht': 3 },
    });
  });
});

describe('the desk', () => {
  it('shows an account its runs and the Erfolge they earned', async () => {
    const { desk: accounts, store } = desk();
    const pass = passFor('Anna');
    await accounts.arrive(pass, { displayName: 'Anna', colour: null });
    await store.appendRun(finished({ at: DAY }, ['Anna', null]));
    const view = (await accounts.arrive(pass, { displayName: 'Andere', colour: null }))?.view;
    const earned = achievementsOf(reportOf());
    expect(view?.runs).toBe(1);
    expect(view?.achievements).toEqual({
      blackout: Object.fromEntries(earned.map((id) => [id, DAY])),
    });
    expect((await accounts.runsOf(pass)).runs.map((run) => run.finishedAt)).toEqual([DAY]);
  });

  it(`lists the newest ${MY_RUNS} runs of an account, and counts them all`, async () => {
    const { desk: accounts, store } = desk();
    const pass = passFor('Anna');
    await accounts.arrive(pass, { displayName: 'Anna', colour: null });
    for (let i = 0; i <= MY_RUNS; i++) {
      await store.appendRun(finished({ at: DAY + i }, ['Anna', null]));
    }
    const { runs, total } = await accounts.runsOf(pass);
    expect(total).toBe(MY_RUNS + 1);
    expect(runs).toHaveLength(MY_RUNS);
    expect(runs[0]?.finishedAt).toBe(DAY + MY_RUNS);
  });

  it('mints the Ausweisnummer anew where the one minted is taken, five times at most', async () => {
    const { desk: accounts, store } = desk();
    const add = store.addLogin.bind(store);
    const tried: string[] = [];
    let taken = 2;
    vi.spyOn(store, 'addLogin').mockImplementation(async (id, subject, hash) => {
      tried.push(subject);
      taken -= 1;
      if (taken >= 0) {
        throw new LoginTaken();
      }
      return add(id, subject, hash);
    });
    const view = await accounts.setPassword(passFor('Anna'), 'Kaltenbrunn 1986');
    expect(tried).toHaveLength(3);
    expect(view.login).toBe(tried[2]);
    // Taken five times in a row: no login is made.
    taken = 5;
    tried.length = 0;
    const ben = accounts.setPassword(passFor('Ben'), 'Kaltenbrunn 1986');
    await expect(ben).rejects.toBeInstanceOf(LoginTaken);
    expect(tried).toHaveLength(5);
    expect((await accounts.arrive(passFor('Ben'), { displayName: '', colour: null }))?.view.login)
      .toBeNull();
  });

  it('settles once every request under way has: a slow one, one behind it', async () => {
    const { desk: accounts, store } = desk();
    // Nothing under way: settled at once.
    await accounts.settled();
    const pass = passFor('Anna');
    await accounts.arrive(pass, { displayName: 'Anna', colour: null });
    // The store takes its time with Anna's colour; her new name waits behind it.
    let answer = (): void => undefined;
    const slow = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const update = store.updateProfile.bind(store);
    const written: Partial<Profile>[] = [];
    vi.spyOn(store, 'updateProfile').mockImplementation(async (id, change) => {
      await slow;
      const account = await update(id, change);
      written.push(change);
      return account;
    });
    void accounts.recolour(pass, '#60a5fa');
    void accounts.rename(pass, 'Anna Berg');
    let settled = false;
    const waited = accounts.settled().then(() => {
      settled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    answer();
    await waited;
    expect(written).toEqual([{ colour: '#60a5fa' }, { displayName: 'Anna Berg' }]);
  });
});

describe('the desk’s Kennwörter', () => {
  it('takes a turn of the server’s for every Kennwort it keeps or checks', async () => {
    const { store } = desk();
    const queue = new DeriveQueue();
    const turns = vi.spyOn(queue, 'run');
    const accounts = new AccountDesk(store, queue);
    const set = await accounts.setPassword(passFor('Anna'), 'Kaltenbrunn 1986');
    expect(turns).toHaveBeenCalledTimes(1);
    // The present one checked, the new one kept.
    await accounts.changePassword(passFor('Anna'), 'Kaltenbrunn 1986', 'Kaltenbrunn 1987');
    expect(turns).toHaveBeenCalledTimes(3);
    await accounts.signIn(passFor('Phone'), set.login ?? '', 'Kaltenbrunn 1987');
    expect(turns).toHaveBeenCalledTimes(4);
  });

  it('signs nobody in whose Kennwort changed between its check and its sign-in', async () => {
    const { desk: accounts, store } = desk();
    const set = await accounts.setPassword(passFor('Anna'), 'Kaltenbrunn 1986');
    const number = set.login ?? '';
    // The store finds the login keeping another Kennwort by the time the pass moves.
    vi.spyOn(store, 'signIn').mockResolvedValue(null);
    const signIn = accounts.signIn(passFor('Phone'), number, 'Kaltenbrunn 1986');
    await expect(signIn).rejects.toThrow(WRONG_LOGIN);
    const login = { typed: number, password: 'Kaltenbrunn 1986', parked: false };
    const switched = accounts.switchAccount(passFor('Anna'), passFor('Eva'), login);
    await expect(switched).rejects.toThrow(WRONG_LOGIN);
  });
});

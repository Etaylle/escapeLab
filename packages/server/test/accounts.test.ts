import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { achievementsOf, utcDay } from '@escapelab/core';
import { AccountDesk, accountRunOf, byMission, MY_RUNS } from '../src/accounts.js';
import { JsonlStore } from '../src/store/jsonl.js';
import type { RunReportV1 } from '../src/store/store.js';
import { passFor } from './passes.js';
import { DAY, finished, reportOf } from './storeContract.js';

/** A desk over a store of its own: the run log in a folder of its own, the accounts in memory. */
function desk(): { desk: AccountDesk; store: JsonlStore } {
  const store = JsonlStore.open(join(mkdtempSync(join(tmpdir(), 'escapelab-desk-')), 'runs.jsonl'));
  return { desk: new AccountDesk(store), store };
}

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
    const view = await accounts.arrive(pass, { displayName: 'Andere', colour: null });
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
});

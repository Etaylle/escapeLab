import { describe, expect, it } from 'vitest';
import {
  applyAction,
  dailyLabel,
  dailySeed,
  initialState,
  isDailyDay,
  runReport,
  utcDay,
  viewFor,
} from '../src/index.js';
import type { Action, GameState, Mission } from '../src/index.js';
import { labMission, openLab, T0 } from './lab.js';

/** A wiring box in a corridor, offering the Tagesschicht; the same lab without it. */
const BOX = [{ type: 'wiring', id: 'kabel', title: 'Kabel' }];
const daily: Mission = { ...labMission(BOX), daily: true };
const plain: Mission = labMission(BOX, 'schlicht');

/** 31 October 2026, 18:00 UTC, and the last and first moments round its midnight. */
const OCT_31 = Date.UTC(2026, 9, 31, 18);
const LAST_MS = Date.UTC(2026, 9, 31, 23, 59, 59, 999);
const NEXT_DAY = LAST_MS + 1;
/** What the server rolls for every run here: the Tagesschicht passes it over. */
const ROLLED = 271_828_182;

function run(state: GameState, actions: Action[]): GameState {
  return actions.reduce(applyAction, state);
}

/** p1 (host) and p2 in a lobby of `mission`, pinned to `roomSeed` where a tester asked for one. */
function lobby(mission: Mission = daily, roomSeed: number | null = null): GameState {
  return run(initialState(mission, roomSeed), [
    { type: 'player-join', playerId: 'p1', name: 'Anna' },
    { type: 'player-join', playerId: 'p2', name: 'Ben' },
  ]);
}

/** The host switches the Tagesschicht on (or off) at `at`, p2 confirms and the host starts. */
function startAt(state: GameState, at: number, on = true): GameState {
  return run(state, [
    { type: 'set-daily', playerId: 'p1', daily: on, at },
    { type: 'set-ready', playerId: 'p2', ready: true },
    { type: 'start-mission', playerId: 'p1', at, seed: ROLLED },
  ]);
}

/** What a run's seed decides: spawns, places, edgework and the box's instance. */
function drawn(state: GameState) {
  return {
    spawns: state.players.map((player) => player.spawn),
    places: state.places,
    edgework: state.edgework,
    box: openLab(state, { at: (state.startedAt ?? T0) + 100 }).puzzleState,
  };
}

describe('utcDay — the day a moment falls on, in UTC', () => {
  it('rolls over at midnight UTC, not a millisecond before', () => {
    expect(utcDay(OCT_31)).toBe('2026-10-31');
    expect(utcDay(LAST_MS)).toBe('2026-10-31');
    expect(utcDay(NEXT_DAY)).toBe('2026-11-01');
    expect(utcDay(Date.UTC(2026, 11, 31, 23, 59, 59, 999))).toBe('2026-12-31');
    expect(utcDay(Date.UTC(2027, 0, 1))).toBe('2027-01-01');
  });

  it('knows the leap days and the days before 1970', () => {
    expect(utcDay(Date.UTC(2028, 1, 29, 12))).toBe('2028-02-29');
    expect(utcDay(Date.UTC(2000, 1, 29))).toBe('2000-02-29');
    expect(utcDay(Date.UTC(2100, 2, 1))).toBe('2100-03-01');
    expect(utcDay(0)).toBe('1970-01-01');
    expect(utcDay(-1)).toBe('1969-12-31');
  });

  it('agrees with the calendar for every day from 1990 to 2060, at every hour', () => {
    const step = 86_400_000 + 3_601_000;
    for (let at = Date.UTC(1990, 0, 1, 7); at < Date.UTC(2060, 0, 1); at += step) {
      expect(utcDay(at)).toBe(new Date(at).toISOString().slice(0, 10));
    }
  });

  it('refuses what is no moment', () => {
    expect(() => utcDay(Number.NaN)).toThrow(/no moment/);
  });
});

describe('dailySeed — one seed a day for every crew', () => {
  it('is the same for every moment of a day, and for every call', () => {
    const seed = dailySeed(utcDay(OCT_31));
    expect(dailySeed(utcDay(Date.UTC(2026, 9, 31)))).toBe(seed);
    expect(dailySeed(utcDay(LAST_MS))).toBe(seed);
    expect(dailySeed('2026-10-31')).toBe(seed);
    // Pinned: a changed hash would change every past Tagesschicht's instance.
    expect([seed, dailySeed('2026-11-01')]).toEqual([1_324_628_848, 1_993_729_491]);
    expect(Number.isInteger(seed) && seed >= 0 && seed <= 0xffff_ffff).toBe(true);
  });

  it('turns over with the day, and repeats no seed within a year', () => {
    expect(dailySeed(utcDay(NEXT_DAY))).not.toBe(dailySeed(utcDay(LAST_MS)));
    const year = Array.from({ length: 366 }, (_, i) =>
      dailySeed(utcDay(Date.UTC(2026, 0, 1) + i * 86_400_000)),
    );
    expect(new Set(year).size).toBe(366);
  });

  it('refuses what is no day', () => {
    expect(() => dailySeed('31.10.2026')).toThrow(/no day/);
    expect(isDailyDay('2026-10-31')).toBe(true);
    for (const wrong of ['2026-13-01', '2026-10-32', '2026-1-1', 'heute', '']) {
      expect(isDailyDay(wrong), wrong).toBe(false);
    }
  });

  it('names the day as the lobby does: 31.10.', () => {
    expect(dailyLabel('2026-10-31')).toBe('31.10.');
    expect(dailyLabel('2027-01-05')).toBe('05.01.');
    expect(() => dailyLabel('morgen')).toThrow(/no day/);
  });
});

describe('the Tagesschicht in a room', () => {
  it('is the host’s switch, in the lobby, for a mission that offers it', () => {
    const on = applyAction(lobby(), { type: 'set-daily', playerId: 'p1', daily: true, at: OCT_31 });
    expect(on.daily).toBe('2026-10-31');
    expect(viewFor(on, 'p2').daily).toEqual({ day: '2026-10-31' });
    expect(viewFor(lobby(), 'p2').daily).toEqual({ day: null });
    expect(viewFor(lobby(plain), 'p1').daily).toBeUndefined();
    const guest: Action = { type: 'set-daily', playerId: 'p2', daily: true, at: OCT_31 };
    expect(() => applyAction(lobby(), guest)).toThrow(/Nur der Host/);
    const none: Action = { type: 'set-daily', playerId: 'p1', daily: true, at: OCT_31 };
    expect(() => applyAction(lobby(plain), none)).toThrow(/keine Tagesschicht/);
    expect(() => applyAction(startAt(lobby(), OCT_31), none)).toThrow(/nur in der Lobby/);
  });

  it('asks everybody to confirm again, as every change of setup does', () => {
    const ready = applyAction(lobby(), { type: 'set-ready', playerId: 'p2', ready: true });
    const on = applyAction(ready, { type: 'set-daily', playerId: 'p1', daily: true, at: OCT_31 });
    expect(on.players.find((p) => p.id === 'p2')?.ready).toBe(false);
  });

  it('plays the day’s seed, the same instance in every room that day', () => {
    const one = startAt(lobby(), OCT_31);
    const other = startAt(lobby(), Date.UTC(2026, 9, 31, 2));
    expect(one.seed).toBe(dailySeed('2026-10-31'));
    expect(drawn(other)).toEqual(drawn(one));
    expect(drawn(startAt(lobby(), OCT_31, false))).not.toEqual(drawn(one));
  });

  it('passes over a tester’s pinned seed, which comes back once it is off', () => {
    const pinned = startAt(lobby(daily, 40), OCT_31);
    expect(pinned.seed).toBe(dailySeed('2026-10-31'));
    const after = run(
      applyAction(pinned, { type: 'time-expired', at: OCT_31 + 700_000 }),
      [{ type: 'back-to-lobby', playerId: 'p1' }],
    );
    // The room's second run plays its pinned seed + 1 again.
    expect(startAt(after, OCT_31 + 800_000, false).seed).toBe(41);
  });

  it('moves on to the day each run starts: a rematch after midnight plays the next', () => {
    const late = startAt(lobby(), LAST_MS - 600_000);
    const over = applyAction(late, { type: 'time-expired', at: LAST_MS - 1000 });
    const next = run(over, [
      { type: 'set-ready', playerId: 'p2', ready: true },
      { type: 'rematch', playerId: 'p1', at: NEXT_DAY + 5000, seed: ROLLED },
    ]);
    expect([late.daily, next.daily]).toEqual(['2026-10-31', '2026-11-01']);
    expect(next.seed).toBe(dailySeed('2026-11-01'));
    expect(viewFor(next, 'p1').daily).toEqual({ day: '2026-11-01' });
  });

  it('goes off with a switch to a mission that offers none', () => {
    const on = applyAction(lobby(), { type: 'set-daily', playerId: 'p1', daily: true, at: OCT_31 });
    const switched = applyAction(on, {
      type: 'switch-mission',
      playerId: 'p1',
      mission: plain,
      difficulty: 'normal',
    });
    expect(switched.daily).toBeNull();
    const over = applyAction(startAt(lobby(), OCT_31), { type: 'time-expired', at: OCT_31 + 1e6 });
    const onward = run(over, [
      { type: 'set-ready', playerId: 'p2', ready: true },
      { type: 'rematch', playerId: 'p1', at: OCT_31 + 2e6, seed: ROLLED, mission: plain },
    ]);
    expect([onward.daily, onward.seed]).toEqual([null, ROLLED]);
  });

  it('marks the report: daily, with the day’s seed — a rolled run’s seed stays out', () => {
    const over = (state: GameState) =>
      runReport(applyAction(state, { type: 'time-expired', at: OCT_31 + 700_000 }), 'QXT4');
    expect(over(startAt(lobby(), OCT_31))).toMatchObject({
      daily: true,
      seed: dailySeed('2026-10-31'),
    });
    const rolled = over(startAt(lobby(), OCT_31, false));
    expect(rolled).not.toHaveProperty('daily');
    expect(rolled).not.toHaveProperty('seed');
  });
});

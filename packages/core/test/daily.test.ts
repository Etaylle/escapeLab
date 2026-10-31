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
import type { Action, DailyStart, GameState, Mission } from '../src/index.js';
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
/** The salt of the server these rooms run on, which alone makes a day's seed. */
const SALT = 'kaltenbrunn-c';
/** Its seeds of 31 October and 1 November 2026. */
const PINNED = [1_679_669_568, 2_082_761_185];

function run(state: GameState, actions: Action[]): GameState {
  return actions.reduce(applyAction, state);
}

/** What the server hands a run starting at `at`: the day its clock has, and the day's seed. */
function dailyAt(at: number): DailyStart {
  const day = utcDay(at);
  return { day, seed: dailySeed(day, SALT) };
}

/** p1 (host) and p2 in a lobby of `mission`, pinned to `roomSeed` where a tester asked for one. */
function lobby(mission: Mission = daily, roomSeed: number | null = null): GameState {
  return run(initialState(mission, roomSeed), [
    { type: 'player-join', playerId: 'p1', name: 'Anna' },
    { type: 'player-join', playerId: 'p2', name: 'Ben' },
  ]);
}

/** The host switches the Tagesschicht on (or off), p2 confirms and the host starts at `at`. */
function startAt(state: GameState, at: number, on = true): GameState {
  return run(state, [
    { type: 'set-daily', playerId: 'p1', daily: on },
    { type: 'set-ready', playerId: 'p2', ready: true },
    { type: 'start-mission', playerId: 'p1', at, seed: ROLLED, daily: dailyAt(at) },
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

describe('dailySeed — one seed a day for every crew, made with the server’s salt', () => {
  it('is the same for every moment of a day, and for every call', () => {
    const seed = dailySeed(utcDay(OCT_31), SALT);
    expect(dailySeed(utcDay(Date.UTC(2026, 9, 31)), SALT)).toBe(seed);
    expect(dailySeed(utcDay(LAST_MS), SALT)).toBe(seed);
    expect(dailySeed('2026-10-31', SALT)).toBe(seed);
    // Pinned: a changed hash would change every past Tagesschicht's instance.
    expect([seed, dailySeed('2026-11-01', SALT)]).toEqual(PINNED);
    expect(Number.isInteger(seed) && seed >= 0 && seed <= 0xffff_ffff).toBe(true);
  });

  it('turns over with the day, and repeats no seed within a year', () => {
    expect(dailySeed(utcDay(NEXT_DAY), SALT)).not.toBe(dailySeed(utcDay(LAST_MS), SALT));
    const year = Array.from({ length: 366 }, (_, i) =>
      dailySeed(utcDay(Date.UTC(2026, 0, 1) + i * 86_400_000), SALT),
    );
    expect(new Set(year).size).toBe(366);
  });

  it('is another seed with another salt: the date alone tells nobody the day’s instance', () => {
    const salts = ['kaltenbrunn-c', 'kaltenbrunn-d', 'a', 'b', SALT.toUpperCase()];
    const seeds = salts.map((salt) => dailySeed('2026-10-31', salt));
    expect(new Set(seeds).size).toBe(salts.length);
    expect(() => dailySeed('2026-10-31', '')).toThrow(/empty salt/);
  });

  it('refuses what is no day', () => {
    expect(() => dailySeed('31.10.2026', SALT)).toThrow(/no day/);
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
    const on = applyAction(lobby(), { type: 'set-daily', playerId: 'p1', daily: true });
    expect([on.dailyOn, on.daily]).toEqual([true, null]);
    expect(viewFor(on, 'p2').daily).toEqual({ on: true, day: null });
    expect(viewFor(lobby(), 'p2').daily).toEqual({ on: false, day: null });
    expect(viewFor(lobby(plain), 'p1').daily).toBeUndefined();
    const guest: Action = { type: 'set-daily', playerId: 'p2', daily: true };
    expect(() => applyAction(lobby(), guest)).toThrow(/Nur der Host/);
    const none: Action = { type: 'set-daily', playerId: 'p1', daily: true };
    expect(() => applyAction(lobby(plain), none)).toThrow(/keine Tagesschicht/);
    expect(() => applyAction(startAt(lobby(), OCT_31), none)).toThrow(/nur in der Lobby/);
  });

  it('asks everybody to confirm again, as any change of setup does; no change, no asking', () => {
    const ready = applyAction(lobby(), { type: 'set-ready', playerId: 'p2', ready: true });
    const on = applyAction(ready, { type: 'set-daily', playerId: 'p1', daily: true });
    expect(on.players.find((p) => p.id === 'p2')?.ready).toBe(false);
    const off: Action = { type: 'set-daily', playerId: 'p1', daily: false };
    expect(applyAction(ready, off)).toBe(ready);
  });

  it('plays the server’s day and seed, the same instance in every room that day', () => {
    const one = startAt(lobby(), OCT_31);
    const other = startAt(lobby(), Date.UTC(2026, 9, 31, 2));
    expect([one.daily, one.seed]).toEqual(['2026-10-31', dailySeed('2026-10-31', SALT)]);
    expect(viewFor(one, 'p2').daily).toEqual({ on: true, day: '2026-10-31' });
    expect(drawn(other)).toEqual(drawn(one));
    const rolled = startAt(lobby(), OCT_31, false);
    expect([rolled.daily, rolled.seed]).toEqual([null, ROLLED]);
    expect(drawn(rolled)).not.toEqual(drawn(one));
  });

  it('will not start on the Tagesschicht where the server handed no day', () => {
    const waiting = run(lobby(), [
      { type: 'set-daily', playerId: 'p1', daily: true },
      { type: 'set-ready', playerId: 'p2', ready: true },
    ]);
    const bare: Action = { type: 'start-mission', playerId: 'p1', at: OCT_31, seed: ROLLED };
    expect(() => applyAction(waiting, bare)).toThrow(/nicht eingerichtet/);
  });

  it('passes over a tester’s pinned seed, which comes back once it is off', () => {
    const pinned = startAt(lobby(daily, 40), OCT_31);
    expect(pinned.seed).toBe(dailySeed('2026-10-31', SALT));
    const after = run(
      applyAction(pinned, { type: 'time-expired', at: OCT_31 + 700_000 }),
      [{ type: 'back-to-lobby', playerId: 'p1' }],
    );
    // Back in the lobby the switch stays on, and names no run's day.
    expect(viewFor(after, 'p1').daily).toEqual({ on: true, day: null });
    // The room's second run plays its pinned seed + 1 again.
    expect(startAt(after, OCT_31 + 800_000, false).seed).toBe(41);
  });

  it('moves on to the day each run starts: a rematch after midnight plays the next', () => {
    const late = startAt(lobby(), LAST_MS - 600_000);
    const over = applyAction(late, { type: 'time-expired', at: LAST_MS - 1000 });
    const at = NEXT_DAY + 5000;
    const next = run(over, [
      { type: 'set-ready', playerId: 'p2', ready: true },
      { type: 'rematch', playerId: 'p1', at, seed: ROLLED, daily: dailyAt(at) },
    ]);
    expect([late.daily, next.daily]).toEqual(['2026-10-31', '2026-11-01']);
    expect(next.seed).toBe(dailySeed('2026-11-01', SALT));
    expect(viewFor(next, 'p1').daily).toEqual({ on: true, day: '2026-11-01' });
  });

  it('goes off with a switch to a mission that offers none', () => {
    const on = applyAction(lobby(), { type: 'set-daily', playerId: 'p1', daily: true });
    const switched = applyAction(on, {
      type: 'switch-mission',
      playerId: 'p1',
      mission: plain,
      difficulty: 'normal',
    });
    expect(switched.dailyOn).toBe(false);
    const over = applyAction(startAt(lobby(), OCT_31), { type: 'time-expired', at: OCT_31 + 1e6 });
    const at = OCT_31 + 2e6;
    const onward = run(over, [
      { type: 'set-ready', playerId: 'p2', ready: true },
      { type: 'rematch', playerId: 'p1', at, seed: ROLLED, daily: dailyAt(at), mission: plain },
    ]);
    expect([onward.dailyOn, onward.daily, onward.seed]).toEqual([false, null, ROLLED]);
  });

  it('marks the report: daily, with the day’s seed — a rolled run’s seed stays out', () => {
    const over = (state: GameState) =>
      runReport(applyAction(state, { type: 'time-expired', at: OCT_31 + 700_000 }), 'QXT4');
    expect(over(startAt(lobby(), OCT_31))).toMatchObject({
      daily: true,
      seed: dailySeed('2026-10-31', SALT),
    });
    const rolled = over(startAt(lobby(), OCT_31, false));
    expect(rolled).not.toHaveProperty('daily');
    expect(rolled).not.toHaveProperty('seed');
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dailySeed,
  parseMission,
  type DailyStats,
  type Mission,
  type MissionStanding,
  type MissionStats,
  type PlayerView,
  type RunOutcome,
  type RunReport,
  type ServerMessage,
} from '@escapelab/core';
import { statsResponse } from '../src/api.js';
import { MissionCatalog } from '../src/missions.js';
import { RoomManager, seedsAllowed } from '../src/roomManager.js';
import { DAILY_DAYS, RunStats } from '../src/runStats.js';

const blackout: Mission = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8')),
);
const shipped = new MissionCatalog(fileURLToPath(new URL('../../../missions', import.meta.url)));

/** 31 October 2026, 18:00 UTC: the day of the walkthrough's Tagesschicht. */
const OCT_31 = Date.UTC(2026, 9, 31, 18);

function collector(): { messages: ServerMessage[]; listen: (m: ServerMessage) => void } {
  const messages: ServerMessage[] = [];
  return { messages, listen: (m) => messages.push(m) };
}

function lastView(messages: ServerMessage[]): PlayerView {
  const last = messages.filter((m) => m.kind === 'view').at(-1);
  if (last?.kind !== 'view') {
    throw new Error('expected at least one view message');
  }
  return last.view;
}

/**
 * Anna (host) and Ben in a Blackout room of `manager`, pinned to `seed` where asked, the
 * Tagesschicht switched on (or not), the run played until its clock runs out. Returns the
 * report the room hands on and the lobby's view of the switch.
 */
function playedOut(manager: RoomManager, reports: RunReport[], daily: boolean, seed = 7) {
  const room = manager.create(blackout, seed);
  const anna = { ...room.join('Anna'), ...collector() };
  const ben = { ...room.join('Ben'), ...collector() };
  room.attach(anna.playerId, anna.listen);
  room.attach(ben.playerId, ben.listen);
  room.act(anna.playerId, { kind: 'set-daily', daily });
  const lobby = lastView(ben.messages).daily;
  room.setReady(ben.playerId, true);
  room.act(anna.playerId, { kind: 'start-mission' });
  vi.advanceTimersByTime(((blackout.intro?.lightsSec ?? 0) + blackout.timeLimitSec + 5) * 1000);
  room.dispose();
  const report = reports.at(-1);
  if (report === undefined) {
    throw new Error('the run never ended');
  }
  return { report, lobby };
}

describe('the Tagesschicht on the server', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: OCT_31 });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('pins the day’s seed without ALLOW_SEED, the switch shown in the lobby', () => {
    const reports: RunReport[] = [];
    const manager = new RoomManager((report) => reports.push(report), seedsAllowed({}));
    const { report, lobby } = playedOut(manager, reports, true);
    expect(lobby).toEqual({ day: '2026-10-31' });
    expect(report).toMatchObject({ daily: true, seed: dailySeed('2026-10-31') });
  });

  it('deals every room the same instance that day', () => {
    const reports: RunReport[] = [];
    const manager = new RoomManager((report) => reports.push(report), seedsAllowed({}));
    const one = playedOut(manager, reports, true).report;
    const other = playedOut(manager, reports, true).report;
    expect(other.spawns).toEqual(one.spawns);
    expect(other.seed).toBe(one.seed);
  });

  it('leaves a room off it to chance, its seed kept to itself', () => {
    const reports: RunReport[] = [];
    const manager = new RoomManager((report) => reports.push(report), seedsAllowed({}));
    const { report, lobby } = playedOut(manager, reports, false);
    expect(lobby).toEqual({ day: null });
    expect(report).not.toHaveProperty('daily');
    expect(report).not.toHaveProperty('seed');
  });

  it('passes over a tester’s pinned seed while it is on', () => {
    const reports: RunReport[] = [];
    const allowed = seedsAllowed({ ALLOW_SEED: '1' });
    const manager = new RoomManager((report) => reports.push(report), allowed);
    expect(playedOut(manager, reports, true, 5).report.seed).toBe(dailySeed('2026-10-31'));
    expect(playedOut(manager, reports, false, 5).report.seed).toBe(5);
  });
});

/** A run as the server logs it: on the Tagesschicht where `daily`, by Anna and Ben. */
function logged(seconds: number, at: number, daily: boolean, outcome: RunOutcome = 'won') {
  const report: RunReport = {
    version: 2,
    missionId: 'blackout',
    roomCode: 'QXT4',
    difficulty: 'normal',
    timeLimitSec: 900,
    alarmLimit: 5,
    crewSize: 2,
    crew: ['Anna', 'Ben'],
    spawns: {},
    startedAt: at - seconds * 1000,
    finishedAt: at,
    outcome,
    stations: [],
    emergencies: { count: 0, failed: 0 },
    penalties: [],
    credits: {},
  };
  return daily ? { ...report, daily: true as const, seed: 1 } : report;
}

const DAY_MS = 86_400_000;

describe('the Tagesschicht in the Bestenliste', () => {
  const stats = new RunStats([
    logged(500, OCT_31, false),
    logged(420, OCT_31 + 1, true),
    logged(380, OCT_31 + 2, true),
    logged(300, OCT_31 + 3, true, 'lost:time'),
    logged(610, OCT_31 - DAY_MS, true),
  ]);
  const ask = (url: string) => statsResponse(stats, shipped, url);

  it('ranks the day’s runs apart from every other, by the day they started on', () => {
    expect(stats.runs).toBe(5);
    const normal = stats.mission('blackout')?.difficulties[0];
    expect([normal?.runs, normal?.bestSeconds]).toEqual([1, 500]);
    const days = stats.daily();
    expect(days.map((day) => day.day)).toEqual(['2026-10-31', '2026-10-30']);
    const today = days[0]?.missions[0]?.difficulties[0];
    expect([today?.runs, today?.wins, today?.bestSeconds]).toEqual([3, 2, 380]);
  });

  it('places a daily run among its day’s runs, and nowhere else', () => {
    expect(stats.dailyPlaceOf('2026-10-31', 'blackout', OCT_31 + 2)).toEqual({
      difficulty: 'normal',
      place: 1,
    });
    expect(stats.placeOf('blackout', OCT_31 + 2)).toBeNull();
    expect(stats.dailyPlaceOf('2026-10-30', 'blackout', OCT_31 + 2)).toBeNull();
  });

  it('keeps the last DAILY_DAYS days, the newest first', () => {
    const many = new RunStats(
      Array.from({ length: DAILY_DAYS + 3 }, (_, i) => logged(400, OCT_31 - i * DAY_MS, true)),
    );
    const days = many.daily();
    expect(days).toHaveLength(DAILY_DAYS);
    expect(days[0]?.day).toBe('2026-10-31');
  });

  it('answers GET /stats/daily, and /stats/:mission with &daily= for a day’s standing', () => {
    expect(ask('/stats')?.body).toEqual(stats.all());
    const daily = ask('/stats/daily');
    expect(daily?.status).toBe(200);
    expect((daily?.body as DailyStats[]).map((day) => day.day)).toEqual([
      '2026-10-31',
      '2026-10-30',
    ]);
    const standing = ask(`/stats/blackout?run=${OCT_31 + 1}&daily=2026-10-31`);
    const body = standing?.body as MissionStanding;
    expect(body.place).toEqual({ difficulty: 'normal', place: 2 });
    expect(body.difficulties[0]?.runs).toBe(3);
    const quiet = ask('/stats/systemcheck?run=1&daily=2026-10-31')?.body as MissionStats;
    expect(quiet).toEqual({ missionId: 'systemcheck', difficulties: [], place: null });
  });

  it('turns away a day written wrong with 400', () => {
    for (const day of ['31.10.2026', '2026-13-01', '']) {
      expect(ask(`/stats/blackout?run=1&daily=${day}`)).toEqual({
        status: 400,
        body: { error: expect.stringContaining('&daily=') },
      });
    }
  });
});

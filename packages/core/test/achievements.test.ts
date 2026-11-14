import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENT_IDS,
  ACHIEVEMENTS,
  achievement,
  achievementsOf,
  applyAction,
  EIGHT_MINUTES_SEC,
  moduleFor,
  viewFor,
  type AchievementId,
  type RunReport,
  type StationReport,
} from '../src/index.js';
import { labMission, openLab, started, T0 } from './lab.js';

/** A station solved in its first try. */
function station(type: string, parts: Partial<StationReport> = {}): StationReport {
  return {
    puzzleId: type,
    type,
    openedAt: T0,
    solvedAt: T0 + 60_000,
    seconds: 60,
    alarms: 0,
    hints: 0,
    ...parts,
  };
}

/**
 * A clean won run of 6:40 from the lights going out, every one of the plaques earned: no
 * alarm, every note read, drones on the map that saw nobody, the Serverraum without a failed
 * command. Each test breaks it in one place.
 */
function clean(parts: Partial<RunReport> = {}): RunReport {
  return {
    version: 2,
    missionId: 'blackout',
    roomCode: 'QXT4',
    difficulty: 'normal',
    timeLimitSec: 900,
    alarmLimit: 5,
    crewSize: 2,
    crew: ['Anna', 'Ben'],
    spawns: { p1: { x: 3, y: 3 }, p2: { x: 1, y: 8 } },
    startedAt: T0,
    lightsOutAt: T0 + 30_000,
    finishedAt: T0 + 30_000 + 400_000,
    outcome: 'won',
    stations: [station('button-sync'), station('servers'), station('morse')],
    emergencies: { count: 1, failed: 0 },
    notes: { read: 3, total: 3 },
    drones: 2,
    penalties: [],
    credits: {},
    ...parts,
  };
}

const DRONE = 'Von einer Drohne erfasst';

/** Whether a report earns the plaque `id`. */
const earns = (id: AchievementId, report: RunReport): boolean =>
  achievementsOf(report).includes(id);

describe('achievementsOf — the seven plaques of a won run', () => {
  it('gives a clean run every plaque, in the order ACHIEVEMENTS lists them', () => {
    expect(achievementsOf(clean())).toEqual([...ACHIEVEMENT_IDS]);
    expect(ACHIEVEMENTS.map((plaque) => plaque.id)).toEqual([...ACHIEVEMENT_IDS]);
  });

  it('gives a lost run none, however clean it was', () => {
    expect(achievementsOf(clean({ outcome: 'lost:time' }))).toEqual([]);
    expect(achievementsOf(clean({ outcome: 'lost:alarms' }))).toEqual([]);
  });

  it('„Ohne Alarm": not one alarm, whatever set it off', () => {
    expect(earns('ohne-alarm', clean())).toBe(true);
    const missed = clean({
      penalties: [{ cause: 'Notfall nicht rechtzeitig behoben', count: 1, seconds: 60 }],
    });
    expect(earns('ohne-alarm', missed)).toBe(false);
  });

  it('„Unter acht Minuten": counted from the lights going out, the intro left out', () => {
    const lightsOutAt = T0 + 30_000;
    const at = (seconds: number) =>
      clean({ lightsOutAt, finishedAt: lightsOutAt + seconds * 1000 });
    expect(earns('unter-acht-minuten', at(EIGHT_MINUTES_SEC - 1))).toBe(true);
    expect(earns('unter-acht-minuten', at(EIGHT_MINUTES_SEC))).toBe(false);
    // 7:50 of play after a 30 s intro is 8:20 from the start: it still counts.
    expect(earns('unter-acht-minuten', at(470))).toBe(true);
  });

  it('„Alle Notizen gelesen": every note of the map read — none to read earns nothing', () => {
    expect(earns('alle-notizen', clean())).toBe(true);
    expect(earns('alle-notizen', clean({ notes: { read: 2, total: 3 } }))).toBe(false);
    expect(earns('alle-notizen', clean({ notes: { read: 0, total: 0 } }))).toBe(false);
    // A report written before the Erfolge says nothing of the notes.
    const older = clean();
    delete older.notes;
    expect(earns('alle-notizen', older)).toBe(false);
  });

  it('„Jede Station im ersten Versuch": no station reported a wrong move', () => {
    expect(earns('erster-versuch', clean())).toBe(true);
    const wrong = clean({
      stations: [station('button-sync'), station('servers'), station('morse', { alarms: 1 })],
    });
    expect(earns('erster-versuch', wrong)).toBe(false);
    // A drone's alarm is no wrong move at a station.
    const seen = clean({ penalties: [{ cause: DRONE, count: 1, seconds: 15 }] });
    expect(earns('erster-versuch', seen)).toBe(true);
  });

  it('„Ungesehen": no drone caught anybody, on a map where drones patrol', () => {
    expect(earns('ungesehen', clean())).toBe(true);
    const caught = clean({ penalties: [{ cause: DRONE, count: 1, seconds: 15 }] });
    expect(earns('ungesehen', caught)).toBe(false);
    expect(earns('ungesehen', clean({ drones: 0 }))).toBe(false);
    // A wrong move elsewhere does not make the crew seen.
    const cut = { cause: 'Falsches Kabel getrennt', count: 1, seconds: 30 };
    expect(earns('ungesehen', clean({ penalties: [cut] }))).toBe(true);
  });

  it('„Stiller Serverraum": no failed command at the Serverraum — none there earns nothing', () => {
    expect(earns('stiller-serverraum', clean())).toBe(true);
    const failed = clean({
      stations: [station('button-sync'), station('servers', { alarms: 2 }), station('morse')],
    });
    expect(earns('stiller-serverraum', failed)).toBe(false);
    // A wrong move at another station leaves the Serverraum still.
    const elsewhere = clean({
      stations: [station('button-sync', { alarms: 1 }), station('servers'), station('morse')],
    });
    expect(earns('stiller-serverraum', elsewhere)).toBe(true);
    const without = clean({ stations: [station('button-sync'), station('morse')] });
    expect(earns('stiller-serverraum', without)).toBe(false);
  });

  it('„Erste Schicht": every won run — that it is the first is the device’s to keep', () => {
    const rough = clean({
      notes: { read: 0, total: 3 },
      stations: [station('button-sync'), station('servers', { alarms: 1 }), station('morse')],
      penalties: [
        { cause: DRONE, count: 4, seconds: 60 },
        { cause: 'Serverraum: kein Strom', count: 1, seconds: 20 },
      ],
      finishedAt: T0 + 30_000 + 880_000,
    });
    expect(achievementsOf(rough)).toEqual(['erste-schicht']);
    expect(earns('erste-schicht', clean({ outcome: 'lost:time' }))).toBe(false);
  });

  it('gives a run its last solve won none of the hatch’s two: there was no hatch to reach', () => {
    const atTheLast = clean({ noHatch: true });
    expect(earns('unter-acht-minuten', atTheLast)).toBe(false);
    expect(earns('erste-schicht', atTheLast)).toBe(false);
    const others = ACHIEVEMENT_IDS.filter((id) => id !== 'unter-acht-minuten');
    expect(achievementsOf(atTheLast)).toEqual(others.filter((id) => id !== 'erste-schicht'));
  });

  it('names every plaque in a few words, without praise', () => {
    for (const id of ACHIEVEMENT_IDS) {
      const { title, line } = achievement(id);
      expect(title.length, id).toBeLessThanOrEqual(32);
      expect(line.length, id).toBeLessThanOrEqual(48);
      expect(`${title} ${line}`, id).not.toMatch(/super|toll|bravo|glückwunsch|klasse|perfekt|!/i);
    }
    expect(() => achievement('nirgends' as AchievementId)).toThrow(/no plaque "nirgends"/);
  });
});

describe('the view of a finished run', () => {
  it('carries the plaques its report earns, and none while it runs', () => {
    const lab = labMission([{ type: 'wiring', id: 'nur', title: 'Nur' }]);
    const open = openLab(started(lab), { at: T0 + 100 });
    expect(viewFor(open, 'p1')).not.toHaveProperty('achievements');
    const box = viewFor(open, 'p1');
    const book = viewFor(open, 'p2');
    const def = lab.puzzles[0];
    if (def === undefined || box.puzzle === null || book.puzzle === null) {
      throw new Error('expected the open box');
    }
    const [move] = moduleFor(def.type).solve(
      def,
      { operator: box.puzzle, reader: book.puzzle },
      box.edgework,
    );
    const won = applyAction(open, {
      type: 'puzzle-input',
      playerId: 'p1',
      at: T0 + 45_000,
      input: move?.input,
    });
    // No notes, no drones, no Serverraum on this map, and no hatch: its last solve won the run.
    const earned = ['ohne-alarm', 'erster-versuch'];
    expect(viewFor(won, 'p1').achievements).toEqual(earned);
    expect(viewFor(won, 'p2').achievements).toEqual(earned);
  });
});

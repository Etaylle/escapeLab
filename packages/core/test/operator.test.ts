import { describe, expect, it } from 'vitest';
import {
  applyAction,
  CLOCK_CALLS,
  CLOCK_LATE_MS,
  clockCallDueAt,
  initialState,
  moodOf,
  MOODS,
  parseMission,
  radioLines,
  viewFor,
  wonBand,
  type Action,
  type GameState,
  type Mission,
  type RunEvent,
} from '../src/index.js';
import { labMission, serverDown, standing, started, T0 } from './lab.js';

/**
 * Mission control's operator answers what a run does, as a person at the desk would: the run's
 * first alarm, the clock with five minutes, two and the last minute left, an emergency as it
 * starts and as it ends, and the run's end — each a line on the air (`radio`) with its moment,
 * said once at its moment and never twice.
 */

const LINES = {
  alarm: 'Alarm bei mir.',
  clock: {
    fiveMinutes: 'Noch fünf Minuten.',
    twoMinutes: 'Noch zwei Minuten.',
    lastMinute: 'Letzte Minute.',
  },
  emergency: { start: 'Notfall, los.', cleared: 'Notfall vorbei.', missed: 'Notfall verpasst.' },
  won: { plenty: 'Viel Zeit übrig.', tight: 'Knapp war das.', lastMinute: 'Gerade noch.' },
  lost: { time: 'Die Zeit ist um.', alarms: 'Zu viele Alarme.', abandoned: 'Abgebrochen.' },
};

const MINUTES_10 = 600_000;

/** Two stations the whole crew presses, ten minutes, an emergency of two valves, every line. */
function operatorMission(extra: object = {}): Mission {
  const lab = labMission(
    [
      { type: 'button-sync', id: 'eins', title: 'Eins' },
      { type: 'button-sync', id: 'zwei', title: 'Zwei' },
    ],
    'leitstand',
  );
  const json = JSON.parse(JSON.stringify(lab));
  return parseMission({
    ...json,
    timeLimitSec: 600,
    radio: { start: 'Los.', ...LINES },
    map: {
      ...json.map,
      sabotage: {
        label: 'KÜHLUNG',
        durationSec: 40,
        penaltySec: 30,
        afterSolved: 0,
        panels: [
          { id: 'links', x: 2, y: 1 },
          { id: 'rechts', x: 2, y: 2 },
        ],
      },
    },
    ...extra,
  });
}

const mission = operatorMission();

/** The lines mission control said after the start, each as moment and words. */
const said = (state: GameState): [string | undefined, string][] =>
  state.events
    .filter((e) => e.kind === 'radio' && e.moment !== 'start')
    .map((e) => [e.moment, e.label]);

const at = (state: GameState, type: 'clock-call' | 'sabotage-start', when: number) =>
  applyAction(state, { type, at: when });

const drone = (state: GameState, when: number, penaltySec = 20): GameState =>
  applyAction(state, { type: 'drone-spotted', at: when, penaltySec, playerId: 'p1' });

/** The station up switched on at `when`, both pressing a second and two later. */
function solve(state: GameState, when: number): GameState {
  const def = state.mission.puzzles[state.currentPuzzleIndex];
  const here = standing(state, { stations: { [def?.id ?? '']: ['p1', 'p2'] } });
  const on = applyAction(here, { type: 'interact', playerId: 'p1', at: when });
  const press = (s: GameState, playerId: string, t: number): GameState =>
    applyAction(s, { type: 'puzzle-input', playerId, at: t, input: { press: true } });
  return press(press(on, 'p1', when + 1000), 'p2', when + 2000);
}

describe('the operator on the run’s first alarm', () => {
  it('says it once, whatever set it off, and nothing on any alarm after it', () => {
    const first = drone(started(mission), T0 + 10_000);
    expect(first.events.slice(-2).map((e) => [e.kind, e.moment ?? null])).toEqual([
      ['penalty', null],
      ['radio', 'alarm'],
    ]);
    expect(first.events.at(-1)).toEqual({
      at: T0 + 10_000,
      kind: 'radio',
      label: LINES.alarm,
      seconds: null,
      moment: 'alarm',
    });
    const more = drone(drone(first, T0 + 20_000), T0 + 30_000);
    expect(said(more)).toEqual([['alarm', LINES.alarm]]);
    expect(more.penaltySeq).toBe(3);
  });

  it('leaves the first alarm to an emergency missed, and to an alarm that loses the run', () => {
    const missed = applyAction(at(started(mission), 'sabotage-start', T0 + 5000), {
      type: 'sabotage-expired',
      at: T0 + 45_000,
    });
    expect(said(missed)).toEqual([
      ['emergency', LINES.emergency.start],
      ['missed', LINES.emergency.missed],
    ]);
    // An alarm after it is the run's second: nothing.
    expect(said(drone(missed, T0 + 50_000))).toEqual(said(missed));
    const strict = operatorMission({ maxAlarms: 1 });
    const lost = drone(started(strict), T0 + 10_000);
    expect(lost.phase).toBe('lost');
    expect(said(lost)).toEqual([['lost', LINES.lost.alarms]]);
  });

  it('stays quiet where the mission has no line for it', () => {
    const quiet = operatorMission({ radio: { start: 'Los.' } });
    expect(said(drone(started(quiet), T0 + 10_000))).toEqual([]);
  });
});

describe('the operator calling the clock', () => {
  it('calls five minutes, two and the last minute as the clock comes down to them, once each', () => {
    let state = started(mission);
    const deadline = T0 + MINUTES_10;
    expect(CLOCK_CALLS.map((call) => call.sec)).toEqual([300, 120, 60]);
    expect(clockCallDueAt(state)).toBe(deadline - 300_000);
    expect(at(state, 'clock-call', deadline - 300_001)).toBe(state);
    for (const [left, key] of [
      [300_000, 'fiveMinutes'],
      [120_000, 'twoMinutes'],
      [60_000, 'lastMinute'],
    ] as const) {
      expect(clockCallDueAt(state)).toBe(deadline - left);
      state = at(state, 'clock-call', deadline - left);
      expect(state.events.at(-1)).toMatchObject({ moment: 'clock', label: LINES.clock[key] });
    }
    expect(clockCallDueAt(state)).toBeNull();
    expect(at(state, 'clock-call', deadline - 1000)).toBe(state);
    expect(said(state).map(([moment]) => moment)).toEqual(['clock', 'clock', 'clock']);
  });

  it('says the call a penalty landed the clock on, within its moment and 15 s', () => {
    // 330 s left; a penalty of 40 s leaves 290: five minutes, 10 s late, still said.
    const jumped = drone(started(mission), T0 + 270_000, 40);
    expect(clockCallDueAt(jumped)).toBeLessThan(T0 + 270_000);
    const called = at(jumped, 'clock-call', T0 + 270_000);
    expect(said(called).at(-1)).toEqual(['clock', LINES.clock.fiveMinutes]);
    expect(CLOCK_LATE_MS).toBe(15_000);
  });

  it('passes by unsaid a call left far behind, and never says two at once', () => {
    // 330 s left; a penalty of 230 s leaves 100: past five minutes and two, 20 s past two.
    const jumped = drone(started(mission), T0 + 270_000, 230);
    const passed = at(jumped, 'clock-call', T0 + 270_000);
    expect(said(passed).filter(([moment]) => moment === 'clock')).toEqual([]);
    expect(passed.clockCalls).toBe(2);
    // The last minute is still to come, at its moment.
    const deadline = passed.deadlineAt ?? 0;
    expect(clockCallDueAt(passed)).toBe(deadline - 60_000);
    const last = at(passed, 'clock-call', deadline - 60_000);
    expect(said(last).filter(([moment]) => moment === 'clock')).toEqual([
      ['clock', LINES.clock.lastMinute],
    ]);
  });

  it('stands still while paused, skips what a short run never has, and needs lines to call', () => {
    const paused = applyAction(started(mission), serverDown(T0 + 1000));
    expect(clockCallDueAt(paused)).toBeNull();
    // Four minutes on the clock: no „five minutes" at the start, two minutes the first call.
    const short = started(operatorMission({ timeLimitSec: 240 }));
    expect(short.clockCalls).toBe(1);
    expect(clockCallDueAt(short)).toBe(T0 + 240_000 - 120_000);
    expect(clockCallDueAt(started(operatorMission({ radio: { start: 'Los.' } })))).toBeNull();
    // Before the lights fail no clock runs, and after the end none.
    const lost = applyAction(started(mission), { type: 'time-expired', at: T0 + MINUTES_10 });
    expect(clockCallDueAt(lost)).toBeNull();
  });
});

describe('the operator on an emergency', () => {
  it('speaks as it starts, after the plant’s message, and as it is cleared', () => {
    const plant = operatorMission();
    const announcing = parseMission({
      ...JSON.parse(JSON.stringify(plant)),
      map: {
        ...JSON.parse(JSON.stringify(plant.map)),
        sabotage: { ...JSON.parse(JSON.stringify(plant.map.sabotage)), announce: 'Störung.' },
      },
    });
    const begun = at(started(announcing), 'sabotage-start', T0 + 5000);
    expect(said(begun)).toEqual([
      ['announce', 'Störung.'],
      ['emergency', LINES.emergency.start],
    ]);
    const cleared = applyAction(begun, { type: 'sabotage-cleared', at: T0 + 20_000 });
    expect(cleared.events.slice(-2).map((e: RunEvent) => [e.kind, e.label])).toEqual([
      ['sabotage', 'Notfall behoben'],
      ['radio', LINES.emergency.cleared],
    ]);
    // Every emergency of the run is answered, each as it starts and ends.
    const again = applyAction(at(cleared, 'sabotage-start', T0 + 200_000), {
      type: 'sabotage-cleared',
      at: T0 + 210_000,
    });
    expect(said(again).filter(([moment]) => moment !== 'announce')).toEqual([
      ['emergency', LINES.emergency.start],
      ['cleared', LINES.emergency.cleared],
      ['emergency', LINES.emergency.start],
      ['cleared', LINES.emergency.cleared],
    ]);
  });

  it('gives a missed one its line, but one whose penalty loses the run the last word', () => {
    const begun = at(started(mission), 'sabotage-start', T0 + 5000);
    const missed = applyAction(begun, { type: 'sabotage-expired', at: T0 + 45_000 });
    expect(said(missed).at(-1)).toEqual(['missed', LINES.emergency.missed]);
    // With 20 s left on the clock its 30 s penalty ends the run.
    const late = at(started(mission), 'sabotage-start', T0 + MINUTES_10 - 30_000);
    const out = applyAction(late, { type: 'sabotage-expired', at: T0 + MINUTES_10 - 20_000 });
    expect(out.phase).toBe('lost');
    expect(said(out).slice(-1)).toEqual([['lost', LINES.lost.time]]);
  });
});

describe('the operator’s last word on a run', () => {
  it('debriefs a run won by the time it left: five minutes or more, a minute or more, less', () => {
    expect([wonBand(300_000), wonBand(299_999), wonBand(60_000), wonBand(59_999)]).toEqual([
      'plenty',
      'tight',
      'tight',
      'lastMinute',
    ]);
    for (const [solvedAt, band] of [
      [T0 + 100_000, 'plenty'],
      [T0 + 400_000, 'tight'],
      [T0 + MINUTES_10 - 30_000, 'lastMinute'],
    ] as const) {
      const won = solve(solve(started(mission), solvedAt - 10_000), solvedAt - 5000);
      expect(won.phase).toBe('won');
      expect(won.events.slice(-2).map((e) => [e.kind, e.label])).toEqual([
        ['finish', 'Alle Systeme online'],
        ['radio', LINES.won[band]],
      ]);
      expect(won.events.at(-1)?.moment).toBe('won');
    }
  });

  it('says it as the crew is out, where the mission has a hatch', () => {
    const hatched = operatorMission({
      map: { ...JSON.parse(JSON.stringify(mission.map)), exit: { x: 3, y: 2 } },
    });
    const open = solve(solve(started(hatched), T0 + 10_000), T0 + 20_000);
    expect(open.phase).toBe('playing');
    expect(said(open).filter(([moment]) => moment === 'won')).toEqual([]);
    const out = applyAction(open, { type: 'escaped', at: T0 + 30_000 });
    expect(out.events.slice(-2).map((e) => [e.kind, e.label])).toEqual([
      ['finish', 'Alle draußen'],
      ['radio', LINES.won.plenty],
    ]);
  });

  it('gives a run lost its word by its cause: the time, the alarms, a crew short', () => {
    const timeUp = applyAction(started(mission), { type: 'time-expired', at: T0 + MINUTES_10 });
    expect(said(timeUp)).toEqual([['lost', LINES.lost.time]]);
    const alarmed = drone(drone(started(operatorMission({ maxAlarms: 2 })), T0 + 1000), T0 + 2000);
    expect(said(alarmed)).toEqual([
      ['alarm', LINES.alarm],
      ['lost', LINES.lost.alarms],
    ]);
    const left = applyAction(started(mission), {
      type: 'abandon',
      playerId: 'p2',
      at: T0 + 5000,
      where: null,
    });
    expect(left.phase).toBe('lost');
    expect(said(left)).toEqual([['lost', LINES.lost.abandoned]]);
    // Each is the run's last line, after the report's own.
    for (const state of [timeUp, alarmed, left]) {
      expect(state.events.at(-2)?.kind).toBe('finish');
    }
  });
});

describe('the operator’s lines in the mission file', () => {
  it('are every one optional, and none empty', () => {
    expect(() => operatorMission({ radio: {} })).not.toThrow();
    const empty = (radio: object) => () => operatorMission({ radio: { start: 'Los.', ...radio } });
    expect(empty({ alarm: '' })).toThrow(/radio\.alarm/);
    expect(empty({ clock: { twoMinutes: '' } })).toThrow(/radio\.clock\.twoMinutes/);
    expect(empty({ won: { plenty: '' } })).toThrow(/radio\.won\.plenty/);
    expect(empty({ lost: { abandoned: '' } })).toThrow(/radio\.lost\.abandoned/);
  });

  it('are listed as the operator’s, after the story, in the order a run can bring them', () => {
    const answers = radioLines(mission).filter((line) => line.when !== 'start');
    expect(answers.map((line) => [line.when, line.text])).toEqual([
      ['emergency', LINES.emergency.start],
      ['cleared', LINES.emergency.cleared],
      ['missed', LINES.emergency.missed],
      ['alarm', LINES.alarm],
      ['clock', LINES.clock.fiveMinutes],
      ['clock', LINES.clock.twoMinutes],
      ['clock', LINES.clock.lastMinute],
      ['won', LINES.won.plenty],
      ['won', LINES.won.tight],
      ['won', LINES.won.lastMinute],
      ['lost', LINES.lost.time],
      ['lost', LINES.lost.alarms],
      ['lost', LINES.lost.abandoned],
    ]);
    expect(answers.every((line) => line.speaker === 'operator' && line.puzzleId === null)).toBe(
      true,
    );
    // Each said as its moment wants it: tense, pressing, urgent, relieved, warm, quiet.
    expect(answers.map((line) => line.mood)).toEqual([
      'urgent',
      'relieved',
      'tense',
      'tense',
      ...['pressing', 'pressing', 'pressing', 'warm', 'warm', 'warm'],
      ...['quiet', 'quiet', 'quiet'],
    ]);
    const story = radioLines(mission).filter((line) => line.when === 'start');
    expect(story.map((line) => line.mood)).toEqual([null]);
    expect([moodOf('nudge'), moodOf('announce'), moodOf('pa'), moodOf('clock')]).toEqual([
      null,
      null,
      null,
      MOODS.clock,
    ]);
  });
});

describe('the lobby’s Funkprobe', () => {
  const PROBES = ['Funkprobe eins.', 'Funkprobe zwei.', 'Funkprobe drei.'];
  const probing = operatorMission({ radio: { start: 'Los.', lobby: PROBES } });

  /** Anna and Ben in the lobby of a room for `of`, Ben ready: Anna, the host, can start. */
  const lobby = (of: Mission): GameState =>
    (
      [
        { type: 'player-join', playerId: 'p1', name: 'Anna' },
        { type: 'player-join', playerId: 'p2', name: 'Ben' },
        { type: 'set-ready', playerId: 'p2', ready: true },
      ] as Action[]
    ).reduce(applyAction, initialState(of));

  it('is in every view of the lobby, the same text for all, and in none in the run', () => {
    const state = lobby(probing);
    const heard = viewFor(state, 'p1').radioCheck;
    expect(PROBES).toContain(heard);
    expect(viewFor(state, 'p2').radioCheck).toBe(heard);
    const run = applyAction(state, { type: 'start-mission', playerId: 'p1', at: T0, seed: 7 });
    expect('radioCheck' in viewFor(run, 'p1')).toBe(false);
    // A mission without one leaves it out.
    expect('radioCheck' in viewFor(lobby(mission), 'p1')).toBe(false);
  });

  it('takes the next text each time the room comes back to its lobby', () => {
    let state = lobby(probing);
    const heard: (string | undefined)[] = [];
    for (let run = 0; run < 4; run++) {
      heard.push(viewFor(state, 'p1').radioCheck);
      const at = T0 + run * 1_000_000;
      const rounds: Action[] = [
        { type: 'start-mission', playerId: 'p1', at, seed: run },
        { type: 'time-expired', at: at + MINUTES_10 },
        { type: 'back-to-lobby', playerId: 'p1' },
        { type: 'set-ready', playerId: 'p2', ready: true },
      ];
      state = rounds.reduce(applyAction, state);
    }
    // Every text once before any comes again.
    expect(new Set(heard.slice(0, 3))).toEqual(new Set(PROBES));
    expect(heard[3]).toBe(heard[0]);
  });

  it('is the operator’s, said calm, listed after every line of the run', () => {
    const lines = radioLines(probing);
    expect(lines.slice(-3)).toEqual(
      PROBES.map((text) => ({
        text,
        when: 'lobby',
        puzzleId: null,
        speaker: 'operator',
        mood: 'calm',
      })),
    );
    expect(lines.filter((line) => line.when === 'lobby')).toHaveLength(3);
  });
});

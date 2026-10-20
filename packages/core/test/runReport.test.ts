import { describe, expect, it } from 'vitest';
import {
  applyAction,
  initialState,
  moduleFor,
  parseMission,
  runReport,
  scaleMission,
  viewFor,
} from '../src/index.js';
import type { Action, Difficulty, GameState, Mission } from '../src/index.js';
import { labMission, openLab, started, T0 } from './lab.js';

/**
 * Two wiring boxes of six wires in a corridor — six, so there is always a
 * wrong one left to cut — one book for both, the sign, a valve at each end of
 * the bottom row and the hatch at the east end. No alarm limit of its own.
 *
 *   01234567890123
 * 0 ##############
 * 1 #...A..B....H#   boxes A (4,1) and B (7,1); hatch (12,1)
 * 2 #.v.......vbs#   spawns (1,1) (1,2); valves (2,2) (10,2); book (11,2); sign (12,2)
 * 3 ##############
 */
const LAB = {
  id: 'protokoll',
  title: 'Protokoll',
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  players: { min: 2, max: 2 },
  puzzles: [
    { type: 'wiring', id: 'erst', title: 'Erst', wires: { min: 6, max: 6 }, hints: ['Oben.'] },
    { type: 'wiring', id: 'dann', title: 'Dann', wires: { min: 6, max: 6 } },
  ],
  map: {
    tiles: ['##############', '#............#', '#............#', '##############'],
    spawns: [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
    ],
    stations: [
      { puzzleId: 'erst', x: 4, y: 1 },
      { puzzleId: 'dann', x: 7, y: 1 },
    ],
    manuals: [
      {
        id: 'buch',
        kind: 'book',
        label: 'HANDBUCH',
        puzzleIds: ['erst', 'dann'],
        spots: [{ x: 11, y: 2 }],
      },
    ],
    edgeworkSign: { x: 12, y: 2 },
    exit: { x: 12, y: 1 },
    sabotage: {
      label: 'KÜHLUNG',
      durationSec: 30,
      penaltySec: 60,
      panels: [
        { id: 'links', x: 2, y: 2 },
        { id: 'rechts', x: 10, y: 2 },
      ],
    },
  },
};
/** The lab with a limit of five alarms, which stands at every difficulty. */
const mission: Mission = parseMission({ ...LAB, maxAlarms: 5 });
/** The lab as written, whose alarm limit comes from the difficulty. */
const unlimited: Mission = parseMission(LAB);

/** Server-style ids and real names: neither may end up in a report. */
const ANNA = 'id-anna-7f3a';
const BEN = 'id-ben-91c2';

/** Anna (host) and Ben start the lab at `difficulty`, the way the lobby scales it. */
function playing(fixture: Mission = mission, difficulty: Difficulty = 'normal'): GameState {
  const actions: Action[] = [
    { type: 'player-join', playerId: ANNA, name: 'Anna' },
    { type: 'player-join', playerId: BEN, name: 'Ben' },
    {
      type: 'switch-mission',
      playerId: ANNA,
      mission: scaleMission(fixture, difficulty),
      difficulty,
    },
    { type: 'set-ready', playerId: BEN, ready: true },
    { type: 'start-mission', playerId: ANNA, at: T0, seed: 7 },
  ];
  return actions.reduce(applyAction, initialState(fixture));
}

/** The armed box switched on with Anna at it and Ben at the book. */
function boxOpen(state: GameState, at: number): GameState {
  return openLab(state, { operator: ANNA, reader: BEN, at });
}

/**
 * Anna cuts at the open box: the wire its rules name, worked out from her
 * view and Ben's alone — or, for a wrong cut, any other wire still whole.
 */
function cut(state: GameState, at: number, right: boolean): GameState {
  const def = state.mission.puzzles[state.currentPuzzleIndex];
  const box = viewFor(state, ANNA);
  const book = viewFor(state, BEN);
  if (def === undefined || box.puzzle?.kind !== 'wiring' || book.puzzle === null) {
    throw new Error('expected an open box with Anna at it and Ben at the book');
  }
  const views = { operator: box.puzzle, reader: book.puzzle };
  const [move] = moduleFor(def.type).solve(def, views, box.edgework);
  const named = (move?.input as { wireId: string } | undefined)?.wireId;
  const wireId = right ? named : box.puzzle.wires?.find((w) => !w.cut && w.id !== named)?.id;
  return applyAction(state, { type: 'puzzle-input', playerId: ANNA, at, input: { wireId } });
}

function run(actions: Action[], from: GameState): GameState {
  return actions.reduce(applyAction, from);
}

describe('runReport', () => {
  it('tells a won run station by station, with every alarm by its cause', () => {
    let state = cut(boxOpen(playing(), T0 + 100), T0 + 1_000, false);
    const noteAt = T0 + 100 + mission.hintDelaySec * 1000;
    state = applyAction(state, { type: 'request-hint', playerId: BEN, at: noteAt });
    state = cut(state, T0 + 60_000, true);
    // Up to the second box: a drone catches Ben, one emergency runs out, one is cleared.
    state = run(
      [
        { type: 'drone-spotted', at: T0 + 61_000, penaltySec: 15, playerId: BEN },
        { type: 'sabotage-start', at: T0 + 62_000 },
        { type: 'sabotage-expired', at: T0 + 92_000 },
        { type: 'sabotage-start', at: T0 + 93_000 },
        { type: 'sabotage-cleared', at: T0 + 95_000 },
      ],
      state,
    );
    state = cut(boxOpen(state, T0 + 100_000), T0 + 130_000, true);
    // On the way out a drone catches Anna: an alarm at no station.
    state = run(
      [
        { type: 'drone-spotted', at: T0 + 135_000, penaltySec: 15, playerId: ANNA },
        { type: 'escaped', at: T0 + 140_000 },
      ],
      state,
    );
    const spawnOf = (id: string) => state.players.find((p) => p.id === id)?.spawn;

    expect(runReport(state)).toEqual({
      version: 1,
      missionId: 'protokoll',
      difficulty: 'normal',
      timeLimitSec: 600,
      alarmLimit: 5,
      crewSize: 2,
      spawns: { p1: spawnOf(ANNA), p2: spawnOf(BEN) },
      startedAt: T0,
      finishedAt: T0 + 140_000,
      outcome: 'won',
      stations: [
        { puzzleId: 'erst', openedAt: T0, solvedAt: T0 + 60_000, seconds: 60, alarms: 1, hints: 1 },
        {
          puzzleId: 'dann',
          openedAt: T0 + 60_000,
          solvedAt: T0 + 130_000,
          seconds: 70,
          alarms: 0,
          hints: 0,
        },
      ],
      emergencies: { count: 2, failed: 1 },
      penalties: [
        { cause: 'Falsches Kabel getrennt', count: 1, seconds: 30 },
        { cause: 'Von einer Drohne erfasst', count: 2, seconds: 30 },
        { cause: 'Notfall nicht rechtzeitig behoben', count: 1, seconds: 60 },
      ],
      credits: {
        p1: { operated: 2, read: 0, found: 0, delivered: 0, alarms: 2, hints: 0 },
        p2: { operated: 0, read: 2, found: 0, delivered: 0, alarms: 1, hints: 1 },
      },
    });
    expect(mission.map.spawns).toContainEqual(spawnOf(ANNA));
    expect(mission.map.spawns).toContainEqual(spawnOf(BEN));
  });

  it('names nobody: the crew is p1…pn in join order, without names or ids', () => {
    const open = boxOpen(playing(), T0 + 100);
    const report = runReport(applyAction(open, { type: 'time-expired', at: T0 + 600_000 }));
    expect(Object.keys(report.credits)).toEqual(['p1', 'p2']);
    expect(Object.keys(report.spawns)).toEqual(['p1', 'p2']);
    expect(JSON.stringify(report)).not.toMatch(/Anna|Ben|id-anna|id-ben/);
  });

  it('is plain JSON', () => {
    const lost = applyAction(playing(), { type: 'time-expired', at: T0 + 600_000 });
    const report = runReport(lost);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it('leaves a run lost on time at the station it got stuck at', () => {
    let state = cut(boxOpen(playing(), T0 + 100), T0 + 1_000, false);
    state = applyAction(state, { type: 'time-expired', at: T0 + 570_000 });
    const report = runReport(state);
    expect(report).toMatchObject({ outcome: 'lost:time', finishedAt: T0 + 570_000 });
    expect(report.stations).toEqual([
      { puzzleId: 'erst', openedAt: T0, solvedAt: null, seconds: null, alarms: 1, hints: 0 },
      { puzzleId: 'dann', openedAt: null, solvedAt: null, seconds: null, alarms: 0, hints: 0 },
    ]);
  });

  it('stops a hard run at its third alarm, with the clock and the limit as played', () => {
    let state = boxOpen(playing(unlimited, 'hart'), T0 + 100);
    for (const at of [T0 + 1_000, T0 + 2_000, T0 + 3_000]) {
      state = cut(state, at, false);
    }
    const report = runReport(state);
    const penaltySec = scaleMission(unlimited, 'hart').puzzles[0]?.penaltySec ?? 0;
    expect(report).toMatchObject({
      difficulty: 'hart',
      timeLimitSec: 480,
      alarmLimit: 3,
      outcome: 'lost:alarms',
      finishedAt: T0 + 3_000,
      penalties: [{ cause: 'Falsches Kabel getrennt', count: 3, seconds: 3 * penaltySec }],
    });
    expect(report.stations[0]?.alarms).toBe(3);
  });

  it('counts a run without an alarm limit as lost on time, whatever the alarms', () => {
    let state = boxOpen(playing(unlimited, 'entspannt'), T0 + 100);
    for (const at of [T0 + 1_000, T0 + 2_000, T0 + 3_000, T0 + 4_000]) {
      state = cut(state, at, false);
    }
    state = applyAction(state, { type: 'time-expired', at: state.deadlineAt ?? T0 });
    expect(runReport(state)).toMatchObject({
      difficulty: 'entspannt',
      timeLimitSec: 810,
      alarmLimit: null,
      outcome: 'lost:time',
    });
  });

  it('wins with the last station where the lab has no hatch', () => {
    const lab = labMission([{ type: 'wiring', id: 'nur', title: 'Nur' }]);
    const open = openLab(started(lab), { at: T0 + 100 });
    const box = viewFor(open, 'p1');
    const book = viewFor(open, 'p2');
    const def = lab.puzzles[0];
    if (def === undefined || box.puzzle === null || book.puzzle === null) {
      throw new Error('expected the open box');
    }
    const views = { operator: box.puzzle, reader: book.puzzle };
    const [move] = moduleFor(def.type).solve(def, views, box.edgework);
    const won = applyAction(open, {
      type: 'puzzle-input',
      playerId: 'p1',
      at: T0 + 45_000,
      input: move?.input,
    });
    expect(runReport(won)).toMatchObject({
      outcome: 'won',
      finishedAt: T0 + 45_000,
      stations: [{ puzzleId: 'nur', openedAt: T0, solvedAt: T0 + 45_000, seconds: 45 }],
    });
  });

  it('refuses a run that is not over', () => {
    expect(() => runReport(initialState(mission))).toThrow(/not over \(phase "lobby"\)/);
    expect(() => runReport(playing())).toThrow(/not over \(phase "playing"\)/);
  });
});

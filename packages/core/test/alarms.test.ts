import { describe, expect, it } from 'vitest';
import {
  applyAction,
  parseMission,
  scaleMission,
  viewFor,
  viewForSpectator,
} from '../src/index.js';
import type { Action, Difficulty, GameState, Mission } from '../src/index.js';
import { labMission, openLab, started, T0 } from './lab.js';

const TOO_MANY = 'Zu viele Alarme — Notversorgung abgeschaltet.';

const lab = labMission([
  {
    type: 'keypad',
    id: 'code',
    title: 'Code',
    penaltySec: 5,
    hints: ['Erst die Spalte.', 'Dann die Reihenfolge.'],
  },
]);

/**
 * A keypad whose wrong key sounds the alarm, its rules and the last shift's
 * notes in the book, and an emergency that sounds it when it runs out. A
 * drone sighting is an action of its own (the patrols are the server's).
 * The mission sets no alarm limit: the difficulty does.
 */
const mission: Mission = parseMission({
  ...JSON.parse(JSON.stringify(lab)),
  map: {
    ...JSON.parse(JSON.stringify(lab.map)),
    sabotage: {
      label: 'KÜHLUNG',
      durationSec: 30,
      penaltySec: 10,
      panels: [
        { id: 'west', x: 1, y: 1 },
        { id: 'ost', x: 9, y: 1 },
      ],
    },
  },
});

/** A run at `difficulty` with the keypad switched on: p1 at it, p2 reading at the book. */
function opened(difficulty: Difficulty): GameState {
  return openLab(started(scaleMission(mission, difficulty)));
}

/** A drone catches p2 at `at`. */
function sighting(at: number, penaltySec = 5): Action {
  return { type: 'drone-spotted', at, penaltySec, playerId: 'p2' };
}

/** `times` drone sightings, a second apart from T0 + 1 s. */
function sighted(state: GameState, times: number): GameState {
  return Array.from({ length: times }, (_, i) => sighting(T0 + 1000 * (i + 1))).reduce(
    applyAction,
    state,
  );
}

/** p1 presses a key the keypad does not want next. */
function wrongKey(state: GameState, at: number): GameState {
  const keypad = state.puzzleState;
  if (keypad?.type !== 'keypad') {
    throw new Error('expected the keypad to be open');
  }
  const next = keypad.order[keypad.keys.filter((key) => key.lit).length];
  const keyIndex = keypad.keys.findIndex((key) => !key.lit && key.glyph !== next);
  return applyAction(state, { type: 'puzzle-input', playerId: 'p1', at, input: { keyIndex } });
}

/** The emergency starts half a minute before `at` and runs out at `at`. */
function emergencyRunsOut(state: GameState, at: number): GameState {
  const running = applyAction(state, { type: 'sabotage-start', at: at - 30_000 });
  return applyAction(running, { type: 'sabotage-expired', at });
}

const AT = T0 + 60_000;

describe('the alarm limit', () => {
  it('loses the run at the fifth alarm on normal, and not before', () => {
    const four = sighted(opened('normal'), 4);
    expect(four.phase).toBe('playing');
    const lost = applyAction(four, sighting(AT));
    expect(lost).toMatchObject({ phase: 'lost', finishedAt: AT, penaltySeq: 5, puzzleState: null });
    expect(lost.events.slice(-2)).toEqual([
      { at: AT, kind: 'penalty', label: 'Von einer Drohne erfasst', seconds: 5 },
      { at: AT, kind: 'finish', label: TOO_MANY, seconds: null },
    ]);
  });

  it('loses it at the third alarm on hart', () => {
    const two = sighted(opened('hart'), 2);
    expect(two.phase).toBe('playing');
    const lost = applyAction(two, sighting(AT));
    expect(lost).toMatchObject({ phase: 'lost', finishedAt: AT, penaltySeq: 3 });
    expect(lost.events.at(-1)?.label).toBe(TOO_MANY);
  });

  it('never ends a run on entspannt, however many alarms', () => {
    const many = sighted(opened('entspannt'), 12);
    expect(many).toMatchObject({ phase: 'playing', penaltySeq: 12 });
    expect(many.events.some((e) => e.kind === 'finish')).toBe(false);
  });

  it.each([
    ['a wrong key at the station', wrongKey],
    ['a drone sighting', (state: GameState, at: number) => applyAction(state, sighting(at))],
    ['an emergency that ran out', emergencyRunsOut],
  ])('counts %s as an alarm towards it', (_, alarm) => {
    const lost = alarm(sighted(opened('hart'), 2), AT);
    expect(lost).toMatchObject({ phase: 'lost', finishedAt: AT, penaltySeq: 3 });
    expect(lost.events.at(-1)).toEqual({ at: AT, kind: 'finish', label: TOO_MANY, seconds: null });
  });

  it('does not count the price of a note', () => {
    const state = sighted(opened('hart'), 2);
    // The station opened at T0 + 100; p2 reads at the book, where the notes lie.
    const delay = state.mission.hintDelaySec * 1000;
    const helped = [1, 2].reduce(
      (next, n) =>
        applyAction(next, { type: 'request-hint', playerId: 'p2', at: T0 + 100 + n * delay }),
      state,
    );
    expect(helped).toMatchObject({ phase: 'playing', hintsUsed: 2, penaltySeq: 2 });
    expect(helped.deadlineAt).toBe((state.deadlineAt ?? 0) - 2 * state.mission.hintCostSec * 1000);
    // The next alarm is still only the third.
    expect(wrongKey(helped, T0 + 100 + 3 * delay).phase).toBe('lost');
  });

  it('names the alarms when the alarm reaching the limit also eats the clock', () => {
    const longerThanTheRun = 10_000;
    const third = applyAction(sighted(opened('hart'), 2), sighting(AT, longerThanTheRun));
    expect(third.events.at(-1)?.label).toBe(TOO_MANY);
    const second = applyAction(sighted(opened('hart'), 1), sighting(AT, longerThanTheRun));
    expect(second.events.at(-1)?.label).toBe('Zeit abgelaufen');
  });

  it('shows the count and the limit to every player and to the audience', () => {
    const state = sighted(opened('hart'), 2);
    expect([
      viewFor(state, 'p1').alarms,
      viewFor(state, 'p2').alarms,
      viewForSpectator(state).alarms,
    ]).toEqual([
      { count: 2, limit: 3 },
      { count: 2, limit: 3 },
      { count: 2, limit: 3 },
    ]);
    expect(viewFor(opened('normal'), 'p1').alarms).toEqual({ count: 0, limit: 5 });
    expect(viewFor(sighted(opened('entspannt'), 1), 'p1').alarms).toEqual({
      count: 1,
      limit: null,
    });
    // Only a scaled mission has a limit; the server scales every one it plays.
    expect(viewFor(openLab(started(mission)), 'p1').alarms).toEqual({ count: 0, limit: null });
  });

  it('ends the run for the whole crew, the reason last in the report', () => {
    const lost = applyAction(sighted(opened('hart'), 2), sighting(AT));
    for (const view of [viewFor(lost, 'p1'), viewFor(lost, 'p2'), viewForSpectator(lost)]) {
      expect(view).toMatchObject({ phase: 'lost', finishedAt: AT, grade: null });
      expect(view.alarms).toEqual({ count: 3, limit: 3 });
      expect(view.events.at(-1)?.label).toBe(TOO_MANY);
    }
    // Nothing more is charged once the run is over.
    expect(applyAction(lost, sighting(AT + 1000))).toBe(lost);
  });

  it('starts a rematch at no alarm under the same limit', () => {
    const lost = applyAction(sighted(opened('hart'), 2), sighting(AT));
    const rematch: Action[] = [
      { type: 'set-ready', playerId: 'p2', ready: true },
      { type: 'rematch', playerId: 'p1', at: AT + 30_000, seed: 8 },
    ];
    const again = rematch.reduce(applyAction, lost);
    expect(again.phase).toBe('playing');
    expect(viewFor(again, 'p1').alarms).toEqual({ count: 0, limit: 3 });
  });
});

import { describe, expect, it } from 'vitest';
import { applyAction, initialState, parseMission, viewFor } from '../src/index.js';
import type { Action, GameState, Mission, RunEvent } from '../src/index.js';
import { standing } from './lab.js';

/** A whole-crew station and a keypad, plus an emergency and a carryable. */
const mission: Mission = parseMission({
  id: 'reporttest',
  title: 'Protokoll-Test',
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  roles: [
    { id: 'anleitung', name: 'Anleitung', description: '' },
    { id: 'steuerpult', name: 'Steuerpult', description: '' },
  ],
  puzzles: [
    { type: 'button-sync', id: 'first', title: 'Erstes' },
    { type: 'keypad', id: 'code', title: 'Code', penaltySec: 20 },
  ],
  map: {
    tiles: ['#########', '#.......#', '#########'],
    spawns: { anleitung: { x: 1, y: 1 }, steuerpult: { x: 7, y: 1 } },
    stations: [
      { puzzleId: 'first', x: 3, y: 1 },
      { puzzleId: 'code', x: 5, y: 1 },
    ],
    manuals: [{ id: 'buch', kind: 'book', x: 6, y: 1, label: 'HANDBUCH', puzzleIds: ['code'] }],
    exit: { x: 7, y: 1 },
    items: [
      { id: 'teil', label: 'TEIL', x: 1, y: 1, deliverTo: { x: 2, y: 1 }, requiredFor: 'code' },
    ],
    sabotage: {
      label: 'KÜHLUNG',
      durationSec: 30,
      penaltySec: 60,
      panels: [
        { id: 'a', x: 1, y: 1 },
        { id: 'b', x: 7, y: 1 },
      ],
    },
  },
});

const T0 = 1_000_000;

function run(actions: Action[], from: GameState): GameState {
  return actions.reduce(applyAction, from);
}

function playing(): GameState {
  return run(
    [
      { type: 'player-join', playerId: 'p1', name: 'Anna' },
      { type: 'player-join', playerId: 'p2', name: 'Ben' },
      { type: 'select-role', playerId: 'p1', roleId: 'anleitung' },
      { type: 'select-role', playerId: 'p2', roleId: 'steuerpult' },
      { type: 'set-ready', playerId: 'p2', ready: true },
      { type: 'start-mission', playerId: 'p1', at: T0, seed: 3 },
    ],
    initialState(mission),
  );
}

const kinds = (events: RunEvent[]): string[] => events.map((e) => e.kind);

/** The whole crew at the first station, switched on and pressed. */
function firstSolved(state: GameState, at: number): GameState {
  return run(
    [
      { type: 'interact', playerId: 'p2', at: at - 1000 },
      { type: 'puzzle-input', playerId: 'p1', at, input: { press: true } },
      { type: 'puzzle-input', playerId: 'p2', at, input: { press: true } },
    ],
    standing(state, { stations: { first: ['p1', 'p2'] } }),
  );
}

describe('run report', () => {
  it('starts empty and records a solved station with its title', () => {
    let state = playing();
    expect(state.events).toEqual([]);
    state = firstSolved(state, T0 + 2000);
    expect(state.events).toEqual([
      { at: T0 + 2000, kind: 'puzzle', label: 'Erstes gelöst', seconds: null },
    ]);
  });

  it('records every penalty with its reason and cost', () => {
    const state = applyAction(playing(), {
      type: 'drone-spotted',
      at: T0 + 5000,
      penaltySec: 15,
    });
    expect(state.events).toEqual([
      {
        at: T0 + 5000,
        kind: 'penalty',
        label: 'Von einer Drohne erfasst',
        seconds: 15,
      },
    ]);
  });

  it('records emergencies, deliveries and the hatch unlocking', () => {
    let state = run(
      [
        { type: 'sabotage-start', at: T0 + 1000 },
        { type: 'sabotage-cleared', at: T0 + 4000 },
        { type: 'pick-item', playerId: 'p1', itemId: 'teil', at: T0 + 5000 },
        { type: 'deliver-item', playerId: 'p1', itemId: 'teil', at: T0 + 6000 },
      ],
      playing(),
    );
    expect(kinds(state.events)).toEqual(['sabotage', 'sabotage', 'item']);
    expect(state.events[2]?.label).toBe('TEIL eingesetzt');

    // Solve both stations: the last one unlocks the exit rather than winning.
    state = firstSolved(state, T0 + 8000);
    state = applyAction(standing(state, { stations: { code: ['p2'] } }), {
      type: 'interact',
      playerId: 'p2',
      at: T0 + 9000,
    });
    const keypad = state.puzzleState;
    if (keypad?.type !== 'keypad') {
      throw new Error('expected the keypad station');
    }
    for (const glyph of keypad.order) {
      state = applyAction(state, {
        type: 'puzzle-input',
        playerId: 'p2',
        at: T0 + 10_000,
        input: { keyIndex: keypad.keys.findIndex((k) => k.glyph === glyph) },
      });
    }
    expect(kinds(state.events).slice(-2)).toEqual(['puzzle', 'escape']);
    expect(state.events.at(-1)?.label).toBe('Notausgang entriegelt');

    state = applyAction(state, { type: 'escaped', at: T0 + 12_000 });
    expect(state.events.at(-1)).toEqual({
      at: T0 + 12_000,
      kind: 'finish',
      label: 'Alle draußen',
      seconds: null,
    });
  });

  it('records the loss when the clock runs out', () => {
    const lost = applyAction(playing(), { type: 'time-expired', at: T0 + 600_000 });
    expect(lost.events.at(-1)).toMatchObject({ kind: 'finish', label: 'Zeit abgelaufen' });
  });

  it('clears the report when a new run starts', () => {
    const afterLoss = run(
      [
        { type: 'time-expired', at: T0 + 600_000 },
        { type: 'back-to-lobby', playerId: 'p1' },
        { type: 'set-ready', playerId: 'p2', ready: true },
        { type: 'start-mission', playerId: 'p1', at: T0 + 700_000, seed: 4 },
      ],
      playing(),
    );
    expect(afterLoss.events).toEqual([]);
  });
});

describe('grades', () => {
  function finished(at: number, penalties: number): GameState {
    let state = playing();
    for (let i = 0; i < penalties; i++) {
      state = applyAction(state, {
        type: 'drone-spotted',
        at: T0 + 1000 + i,
        penaltySec: 1,
      });
    }
    return { ...state, phase: 'won', finishedAt: at };
  }

  it('awards S for a clean run with time to spare', () => {
    expect(viewFor(finished(T0 + 120_000, 0), 'p1').grade?.rank).toBe('S');
  });

  it('drops to A with one alarm, B with a few, C with many', () => {
    expect(viewFor(finished(T0 + 120_000, 1), 'p1').grade?.rank).toBe('A');
    expect(viewFor(finished(T0 + 120_000, 3), 'p1').grade?.rank).toBe('B');
    expect(viewFor(finished(T0 + 120_000, 6), 'p1').grade?.rank).toBe('C');
  });

  it('drops the rank when the crew only just made it', () => {
    expect(viewFor(finished(T0 + 590_000, 0), 'p1').grade?.rank).toBe('B');
  });

  it('gives no grade while playing or after a loss', () => {
    expect(viewFor(playing(), 'p1').grade).toBeNull();
    const lost = applyAction(playing(), { type: 'time-expired', at: T0 + 600_000 });
    expect(viewFor(lost, 'p1').grade).toBeNull();
  });
});

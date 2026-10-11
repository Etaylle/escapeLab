import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  initialState,
  parseMission,
  scaleMission,
  viewFor,
  viewForSpectator,
} from '../src/index.js';
import type { Action, GameState, Mission, RunEvent } from '../src/index.js';

/**
 * Three one-press stations and an exit hatch, with mission control on the
 * radio: two hints for the first station, one for the second, none for the
 * third. Hint price and delay are left at their defaults.
 */
const mission: Mission = parseMission({
  id: 'hinttest',
  title: 'Hinweis-Test',
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  radio: { start: 'Leitstelle hier — wir hören mit.', escape: 'Der Ausgang ist offen, raus da!' },
  roles: [
    { id: 'anleitung', name: 'Anleitung', description: '' },
    { id: 'steuerpult', name: 'Steuerpult', description: '' },
  ],
  puzzles: [
    {
      type: 'button-sync',
      id: 'first',
      title: 'Erstes',
      prompt: '',
      buttons: [{ roleId: 'steuerpult', label: 'A' }],
      hints: ['Nur eine Rolle hat einen Knopf.', 'Das Steuerpult drückt A.'],
      onSolved: 'Erstes System läuft wieder.',
    },
    {
      type: 'button-sync',
      id: 'second',
      title: 'Zweites',
      prompt: '',
      buttons: [{ roleId: 'steuerpult', label: 'B' }],
      hints: ['Wieder das Steuerpult.'],
    },
    {
      type: 'button-sync',
      id: 'third',
      title: 'Drittes',
      prompt: '',
      buttons: [{ roleId: 'steuerpult', label: 'C' }],
    },
  ],
  map: {
    tiles: ['#########', '#.......#', '#########'],
    spawns: { anleitung: { x: 1, y: 1 }, steuerpult: { x: 7, y: 1 } },
    stations: [
      { puzzleId: 'first', x: 2, y: 1 },
      { puzzleId: 'second', x: 4, y: 1 },
      { puzzleId: 'third', x: 6, y: 1 },
    ],
    exit: { x: 3, y: 1 },
  },
});

/** The same puzzles without a map: each one opens the moment the previous is solved. */
const chained: Mission = parseMission({
  ...JSON.parse(JSON.stringify(mission)),
  id: 'hintchain',
  map: undefined,
});

/** The same mission with nothing scripted for the radio. */
const silent: Mission = parseMission({
  ...JSON.parse(JSON.stringify(mission)),
  id: 'hintsilent',
  radio: undefined,
});

const T0 = 1_000_000;
const COST_MS = mission.hintCostSec * 1000;
const DELAY_MS = mission.hintDelaySec * 1000;

function run(actions: Action[], from: GameState): GameState {
  return actions.reduce(applyAction, from);
}

function playing(fixture: Mission = mission): GameState {
  return run(
    [
      { type: 'player-join', playerId: 'p1', name: 'Anna' },
      { type: 'player-join', playerId: 'p2', name: 'Ben' },
      { type: 'select-role', playerId: 'p1', roleId: 'anleitung' },
      { type: 'select-role', playerId: 'p2', roleId: 'steuerpult' },
      { type: 'set-ready', playerId: 'p2', ready: true },
      { type: 'start-mission', playerId: 'p1', at: T0, seed: 1 },
    ],
    initialState(fixture),
  );
}

/** Switch on the armed station. */
function open(state: GameState, at: number): GameState {
  return applyAction(state, { type: 'interact', playerId: 'p2', at });
}

/** Every station here is solved by a single press from the Steuerpult. */
function solve(state: GameState, at: number): GameState {
  return applyAction(state, { type: 'puzzle-input', playerId: 'p2', at, input: { press: true } });
}

function askForHint(state: GameState, at: number): GameState {
  return applyAction(state, { type: 'request-hint', playerId: 'p1', at });
}

const kinds = (events: RunEvent[]): string[] => events.map((e) => e.kind);

describe('hints on request', () => {
  it('holds hints back until the crew has spent a while at the open station', () => {
    expect(() => askForHint(playing(), T0 + DELAY_MS)).toThrow(/kein Rätsel/);
    // The wait starts with the station, not with the mission.
    const state = open(playing(), T0 + 100_000);
    expect(() => askForHint(state, T0 + 100_000 + DELAY_MS - 1)).toThrow(/noch einen Moment/);
    const helped = askForHint(state, T0 + 100_000 + DELAY_MS);
    expect(helped.hintsRevealed).toBe(1);
    expect(viewFor(helped, 'p1').puzzle?.hints.shown).toEqual(['Nur eine Rolle hat einen Knopf.']);
  });

  it('costs exactly the hint price without sounding the alarm', () => {
    const state = open(playing(), T0 + 1000);
    const at = T0 + 1000 + DELAY_MS;
    const helped = askForHint(state, at);
    expect(helped.deadlineAt).toBe((state.deadlineAt ?? 0) - COST_MS);
    expect(helped.penaltySeq).toBe(0);
    expect(helped.lastPenaltySec).toBeNull();
    expect(helped.hintsUsed).toBe(1);
    expect(helped.events.at(-1)).toEqual({
      at,
      kind: 'hint',
      label: 'Nur eine Rolle hat einen Knopf.',
      seconds: mission.hintCostSec,
    });
  });

  it('makes the crew wait between hints and has none past the last one', () => {
    let state = askForHint(open(playing(), T0), T0 + DELAY_MS);
    expect(() => askForHint(state, T0 + 2 * DELAY_MS - 1)).toThrow(/noch einen Moment/);
    state = askForHint(state, T0 + 2 * DELAY_MS);
    expect(viewFor(state, 'p1').puzzle?.hints).toEqual({
      shown: ['Nur eine Rolle hat einen Knopf.', 'Das Steuerpult drückt A.'],
      left: 0,
      readyAt: null,
      costSec: mission.hintCostSec,
    });
    expect(() => askForHint(state, T0 + 10 * DELAY_MS)).toThrow(/Keine weiteren Hinweise/);
  });

  it('starts every station without hints while the run total keeps counting', () => {
    let state = open(playing(), T0);
    state = askForHint(askForHint(state, T0 + DELAY_MS), T0 + 2 * DELAY_MS);
    state = open(solve(state, T0 + 100_000), T0 + 110_000);
    expect(state.hintsRevealed).toBe(0);
    expect(state.hintsUsed).toBe(2);
    expect(viewFor(state, 'p1').puzzle?.hints).toMatchObject({
      shown: [],
      left: 1,
      readyAt: T0 + 110_000 + DELAY_MS,
    });

    state = askForHint(state, T0 + 110_000 + DELAY_MS);
    expect(state.hintsUsed).toBe(3);
    expect(viewFor(state, 'p1').puzzle?.hints.shown).toEqual(['Wieder das Steuerpult.']);

    // The third station has no hints at all.
    state = open(solve(state, T0 + 200_000), T0 + 210_000);
    expect(viewFor(state, 'p1').puzzle?.hints).toMatchObject({ shown: [], left: 0, readyAt: null });
    expect(() => askForHint(state, T0 + 210_000 + DELAY_MS)).toThrow(/Keine weiteren Hinweise/);
  });

  it('restarts the wait with every puzzle when they chain without a map', () => {
    let state = playing(chained);
    expect(() => askForHint(state, T0 + DELAY_MS - 1)).toThrow(/noch einen Moment/);
    state = solve(askForHint(state, T0 + DELAY_MS), T0 + 60_000);
    expect(state.currentPuzzleIndex).toBe(1);
    expect(state.hintsRevealed).toBe(0);
    expect(state.hintReadyAt).toBe(T0 + 60_000 + DELAY_MS);
  });

  it('adds the time spent paused to the wait', () => {
    let state = open(playing(), T0);
    state = applyAction(state, { type: 'set-paused', paused: true, at: T0 + 10_000 });
    expect(() => askForHint(state, T0 + DELAY_MS)).toThrow(/pausiert/);
    state = applyAction(state, { type: 'set-paused', paused: false, at: T0 + 40_000 });
    expect(state.hintReadyAt).toBe(T0 + DELAY_MS + 30_000);
    expect(() => askForHint(state, T0 + DELAY_MS + 29_999)).toThrow(/noch einen Moment/);
    expect(askForHint(state, T0 + DELAY_MS + 30_000).hintsUsed).toBe(1);
  });

  it('loses the mission when a hint eats the time that is left', () => {
    const state = open(playing(), T0 + 500_000);
    // Ten seconds on the clock, and the hint costs twenty.
    const lost = askForHint(state, T0 + 590_000);
    expect(lost.phase).toBe('lost');
    expect(kinds(lost.events).slice(-2)).toEqual(['hint', 'finish']);
    expect(lost.events.at(-1)?.label).toBe('Zeit abgelaufen');
  });
});

describe('mission control on the radio', () => {
  it('opens the run with the start line', () => {
    expect(playing().events).toEqual([
      { at: T0, kind: 'radio', label: 'Leitstelle hier — wir hören mit.', seconds: null },
    ]);
  });

  it('follows a solve with its line and the unlocked hatch with the escape line', () => {
    let state = playing();
    state = solve(open(state, T0 + 1000), T0 + 2000);
    state = solve(open(state, T0 + 3000), T0 + 4000);
    state = solve(open(state, T0 + 5000), T0 + 6000);
    expect(state.events.map((e) => [e.kind, e.label])).toEqual([
      ['radio', 'Leitstelle hier — wir hören mit.'],
      ['puzzle', 'Erstes gelöst'],
      ['radio', 'Erstes System läuft wieder.'],
      ['puzzle', 'Zweites gelöst'],
      ['puzzle', 'Drittes gelöst'],
      ['escape', 'Notausgang entriegelt'],
      ['radio', 'Der Ausgang ist offen, raus da!'],
    ]);
  });

  it('stays silent where the mission scripts nothing', () => {
    expect(playing(silent).events).toEqual([]);
  });

  it('keeps the escape line to itself when there is no hatch to open', () => {
    const state = solve(solve(solve(playing(chained), T0 + 1000), T0 + 2000), T0 + 3000);
    expect(state.phase).toBe('won');
    expect(kinds(state.events)).toEqual(['radio', 'puzzle', 'radio', 'puzzle', 'puzzle', 'finish']);
  });
});

describe('hint views', () => {
  it('shows both roles and the audience the very same hints', () => {
    const state = askForHint(open(playing(), T0), T0 + DELAY_MS);
    const anna = viewFor(state, 'p1');
    const ben = viewFor(state, 'p2');
    const audience = viewForSpectator(state);
    expect(anna.puzzle?.hints.shown).toEqual(['Nur eine Rolle hat einen Knopf.']);
    expect(ben.puzzle?.hints).toEqual(anna.puzzle?.hints);
    expect(audience.panels.map((p) => p.puzzle?.hints)).toEqual([
      anna.puzzle?.hints,
      anna.puzzle?.hints,
    ]);
    expect([anna.hintsUsed, ben.hintsUsed, audience.hintsUsed]).toEqual([1, 1, 1]);
  });

  it('charges the difficulty-scaled price it shows', () => {
    const hard = scaleMission(mission, 'hart');
    const state = open(playing(hard), T0);
    const price = viewFor(state, 'p1').puzzle?.hints.costSec;
    expect(price).toBe(hard.hintCostSec);
    expect(price).toBeGreaterThan(mission.hintCostSec);
    const helped = askForHint(state, T0 + DELAY_MS);
    expect(helped.deadlineAt).toBe((state.deadlineAt ?? 0) - hard.hintCostSec * 1000);
  });
});

describe('grades with hints', () => {
  /** A won run, finished at T0 + 120 s after buying `count` hints at the first station. */
  function wonWith(count: number): GameState {
    let state = open(playing(), T0);
    for (let i = 1; i <= count; i++) {
      state = askForHint(state, T0 + i * DELAY_MS);
    }
    return { ...state, phase: 'won', finishedAt: T0 + 120_000 };
  }

  it('lets one hint turn an otherwise flawless run into an A', () => {
    expect(viewFor(wonWith(0), 'p1').grade?.rank).toBe('S');
    expect(viewFor(wonWith(1), 'p1').grade?.rank).toBe('A');
  });

  it('drops to B with more hints, but no further on hints alone', () => {
    expect(viewFor(wonWith(2), 'p1').grade?.rank).toBe('B');
  });
});

describe('mission control schema', () => {
  it('falls back to the default hint price, delay and no hints', () => {
    expect(mission.hintCostSec).toBe(20);
    expect(mission.hintDelaySec).toBe(45);
    expect(mission.puzzles[2]?.hints).toEqual([]);
    expect(mission.puzzles[2]?.onSolved).toBeUndefined();
    expect(silent.radio).toEqual({});
  });

  it('accepts three hints per puzzle but not four', () => {
    const withHints = (hints: string[]): unknown => ({
      ...JSON.parse(JSON.stringify(mission)),
      puzzles: mission.puzzles.map((p, i) => (i === 0 ? { ...p, hints } : p)),
    });
    expect(() => parseMission(withHints(['1', '2', '3']))).not.toThrow();
    expect(() => parseMission(withHints(['1', '2', '3', '4']))).toThrow(/puzzles\.0\.hints/);
  });

  it('rejects a drone that would only wake once every puzzle is solved', () => {
    const withDrone = (activeAfterSolved: number): unknown => ({
      ...JSON.parse(JSON.stringify(mission)),
      map: {
        ...JSON.parse(JSON.stringify(mission.map)),
        drones: [
          {
            id: 'wache',
            waypoints: [
              { x: 1, y: 1 },
              { x: 7, y: 1 },
            ],
            activeAfterSolved,
          },
        ],
      },
    });
    expect(() => parseMission(withDrone(2))).not.toThrow();
    expect(() => parseMission(withDrone(3))).toThrow(/drone "wache": activeAfterSolved/);
  });

  it('still parses every shipped mission', () => {
    const dir = new URL('../../../missions/', import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const data: unknown = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
      expect(() => parseMission(data), file).not.toThrow();
    }
  });
});

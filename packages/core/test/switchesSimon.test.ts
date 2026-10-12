import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyAction, initialState, moduleFor, parseMission, viewFor } from '../src/index.js';
import type { Action, GameState, Mission } from '../src/index.js';
import { wiringModule } from '../src/puzzles/wiring.js';

const blackoutRaw: unknown = JSON.parse(
  readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8'),
);
// Puzzle-logic tests run without the tile map (stations would gate activation);
// the map flow itself is covered in map.test.ts.
const blackout: Mission = parseMission({ ...(blackoutRaw as object), map: undefined });
const tutorial: Mission = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/systemcheck.json', import.meta.url), 'utf8')),
);
const kettenreaktion: Mission = parseMission(
  JSON.parse(
    readFileSync(new URL('../../../missions/kettenreaktion.json', import.meta.url), 'utf8'),
  ),
);

const T0 = 1_000_000;

function run(actions: Action[], from: GameState): GameState {
  return actions.reduce(applyAction, from);
}

function started(seed = 42): GameState {
  return run(
    [
      { type: 'player-join', playerId: 'p1', name: 'Anna' },
      { type: 'player-join', playerId: 'p2', name: 'Ben' },
      { type: 'select-role', playerId: 'p1', roleId: 'anleitung' },
      { type: 'select-role', playerId: 'p2', roleId: 'steuerpult' },
      { type: 'set-ready', playerId: 'p2', ready: true },
      { type: 'start-mission', playerId: 'p1', at: T0, seed },
    ],
    initialState(blackout),
  );
}

/** Solve puzzles 0 (wiring) and 1 (keypad) to arrive at the switches. */
function atSwitches(seed = 42): GameState {
  let state = started(seed);
  const wiringDef = blackout.puzzles[0];
  const keypadDef = blackout.puzzles[1];
  if (wiringDef?.type !== 'wiring' || keypadDef?.type !== 'keypad') {
    throw new Error('unexpected blackout puzzle order');
  }
  const wiringView = viewFor(state, 'p2');
  if (wiringView.puzzle?.kind !== 'wiring') {
    throw new Error('expected wiring view');
  }
  const [cut] = wiringModule.solve(
    wiringDef,
    { steuerpult: wiringView.puzzle },
    wiringView.edgework,
  );
  state = applyAction(state, {
    type: 'puzzle-input',
    playerId: 'p2',
    at: T0 + 1000,
    input: cut?.input,
  });
  for (const symbol of keypadDef.code) {
    const puzzle = viewFor(state, 'p2').puzzle;
    if (puzzle?.kind !== 'keypad' || puzzle.grid === null) {
      throw new Error('expected keypad view');
    }
    const idx = puzzle.grid.findIndex((k) => k.symbol === symbol);
    state = applyAction(state, {
      type: 'puzzle-input',
      playerId: 'p2',
      at: T0 + 2000,
      input: { keyIndex: idx },
    });
  }
  return state;
}

describe('simon puzzle', () => {
  /** The switch bank's rules read the edgework, so its solver plays it from the two views. */
  function atSimon(seed = 42): GameState {
    let state = atSwitches(seed);
    const def = blackout.puzzles[2];
    if (def?.type !== 'switches') {
      throw new Error('unexpected blackout puzzle order');
    }
    for (let round = 1; state.currentPuzzleIndex === 2 && round <= 10; round++) {
      const anna = viewFor(state, 'p1');
      const ben = viewFor(state, 'p2');
      if (anna.puzzle === null || ben.puzzle === null) {
        throw new Error('expected the switch bank to be open');
      }
      const views = { anleitung: anna.puzzle, steuerpult: ben.puzzle };
      for (const { roleId, input } of moduleFor(def.type).solve(def, views, state.edgework)) {
        const playerId = roleId === 'anleitung' ? 'p1' : 'p2';
        state = applyAction(state, { type: 'puzzle-input', playerId, at: T0 + 5000, input });
      }
    }
    return state;
  }

  it('splits sequence+buttons and legend across the two roles', () => {
    const state = atSimon();
    const anna = viewFor(state, 'p1').puzzle;
    const ben = viewFor(state, 'p2').puzzle;
    if (anna?.kind !== 'simon' || ben?.kind !== 'simon') {
      throw new Error('expected simon views');
    }
    expect(anna.sequence).toBeNull();
    expect(anna.buttons).toBeNull();
    expect(anna.legend).toHaveLength(4);
    expect(ben.sequence?.length).toBe(5);
    expect(ben.buttons).toHaveLength(4);
    expect(ben.legend).toBeNull();
  });

  it('solves when the sequence is translated via the legend', () => {
    let state = atSimon();
    const legend = (() => {
      const v = viewFor(state, 'p1').puzzle;
      return v?.kind === 'simon' ? (v.legend ?? []) : [];
    })();
    const { sequence, buttons } = (() => {
      const v = viewFor(state, 'p2').puzzle;
      return v?.kind === 'simon'
        ? { sequence: v.sequence ?? [], buttons: v.buttons ?? [] }
        : { sequence: [], buttons: [] };
    })();
    for (const color of sequence) {
      const symbol = legend.find((l) => l.color === color)?.symbol;
      const idx = buttons.findIndex((b) => b === symbol);
      state = applyAction(state, {
        type: 'puzzle-input',
        playerId: 'p2',
        at: T0 + 7000,
        input: { buttonIndex: idx },
      });
    }
    expect(state.currentPuzzleIndex).toBe(4);
    expect(state.penaltySeq).toBe(0);
  });

  it('a wrong press resets progress and costs time', () => {
    let state = atSimon();
    const legend = (() => {
      const v = viewFor(state, 'p1').puzzle;
      return v?.kind === 'simon' ? (v.legend ?? []) : [];
    })();
    const { sequence, buttons } = (() => {
      const v = viewFor(state, 'p2').puzzle;
      return v?.kind === 'simon'
        ? { sequence: v.sequence ?? [], buttons: v.buttons ?? [] }
        : { sequence: [], buttons: [] };
    })();
    const right = legend.find((l) => l.color === sequence[0])?.symbol;
    const wrongIdx = buttons.findIndex((b) => b !== right);
    const before = state.deadlineAt ?? 0;
    state = applyAction(state, {
      type: 'puzzle-input',
      playerId: 'p2',
      at: T0 + 7000,
      input: { buttonIndex: wrongIdx },
    });
    expect(state.deadlineAt).toBe(before - 20_000);
    const view = viewFor(state, 'p2').puzzle;
    if (view?.kind === 'simon') {
      expect(view.progress).toBe(0);
    }
  });
});

describe('mission switching & stats', () => {
  it('lets the host switch the lobby mission and resets roles', () => {
    let state = run(
      [
        { type: 'player-join', playerId: 'p1', name: 'Anna' },
        { type: 'player-join', playerId: 'p2', name: 'Ben' },
        { type: 'select-role', playerId: 'p1', roleId: 'anleitung' },
      ],
      initialState(blackout),
    );
    state = applyAction(state, { type: 'switch-mission', playerId: 'p1', mission: tutorial, difficulty: 'normal' });
    expect(state.mission.id).toBe('systemcheck');
    expect(state.players.map((p) => p.roleId)).toEqual([null, null]);
    expect(() =>
      applyAction(state, { type: 'switch-mission', playerId: 'p2', mission: blackout, difficulty: 'normal' }),
    ).toThrow(/Host/);
  });

  it('refuses switching to a mission with fewer roles than players', () => {
    const three = run(
      [
        { type: 'player-join', playerId: 'p1', name: 'Anna' },
        { type: 'player-join', playerId: 'p2', name: 'Ben' },
        { type: 'player-join', playerId: 'p3', name: 'Cleo' },
      ],
      initialState(kettenreaktion),
    );
    expect(() =>
      applyAction(three, { type: 'switch-mission', playerId: 'p1', mission: blackout, difficulty: 'normal' }),
    ).toThrow(/zu viele Spieler/);
  });

  it('records start and finish times for the end-screen stats', () => {
    const lost = applyAction(started(), { type: 'time-expired', at: T0 + 540_000 });
    expect(lost.finishedAt).toBe(T0 + 540_000);
    const view = viewFor(lost, 'p1');
    expect(view.startedAt).toBe(T0);
    expect(view.finishedAt).toBe(T0 + 540_000);
    expect(view.timeLimitSec).toBe(540);
  });

  it('validates the three shipped missions', () => {
    expect(blackout.puzzles).toHaveLength(5);
    expect(tutorial.roles).toHaveLength(2);
    expect(kettenreaktion.roles).toHaveLength(3);
    expect(kettenreaktion.puzzles.some((p) => p.type === 'simon')).toBe(true);
    // Every shipped mission carries a valid tile map with an escape hatch.
    for (const mission of [parseMission(blackoutRaw), kettenreaktion, tutorial]) {
      expect(mission.map).toBeDefined();
      expect(mission.map?.exit).toBeDefined();
    }
  });
});

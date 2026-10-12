import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyAction, GameError, initialState, parseMission, viewFor } from '../src/index.js';
import type { Action, GameState, Mission, PlayerView } from '../src/index.js';

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

const pairMatches = (w: { left: string; right: string }, [a, b]: readonly [string, string]) =>
  (w.left === a && w.right === b) || (w.left === b && w.right === a);

/** PRÜFEN on the switch bank. */
const commit = (playerId: string, at: number): Action => ({
  type: 'puzzle-input',
  playerId,
  at,
  input: { commit: true },
});

/** Solve puzzles 0 (wiring) and 1 (keypad) to arrive at the switches. */
function atSwitches(seed = 42): GameState {
  let state = started(seed);
  const wiringDef = blackout.puzzles[0];
  const keypadDef = blackout.puzzles[1];
  if (wiringDef?.type !== 'wiring' || keypadDef?.type !== 'keypad') {
    throw new Error('unexpected blackout puzzle order');
  }
  for (const target of wiringDef.pairsToCut) {
    const puzzle = viewFor(state, 'p2').puzzle;
    if (puzzle?.kind !== 'wiring' || puzzle.wires === null) {
      throw new Error('expected wiring view');
    }
    const wire = puzzle.wires.find((w) => pairMatches(w, target));
    state = applyAction(state, {
      type: 'puzzle-input',
      playerId: 'p2',
      at: T0 + 1000,
      input: { wireId: wire?.id ?? '' },
    });
  }
  // The keypad deals new keys every run; pressing them in their column's order clears it.
  const keypad = state.puzzleState;
  if (keypad?.type !== 'keypad') {
    throw new Error('expected the keypad');
  }
  for (const glyph of keypad.order) {
    state = applyAction(state, {
      type: 'puzzle-input',
      playerId: 'p2',
      at: T0 + 2000,
      input: { keyIndex: keypad.keys.findIndex((k) => k.glyph === glyph) },
    });
  }
  return state;
}

function switchesViews(state: GameState): { anna: PlayerView; ben: PlayerView } {
  return { anna: viewFor(state, 'p1'), ben: viewFor(state, 'p2') };
}

describe('switches puzzle', () => {
  it('shows the panel only to the panel role and the target only to the target role', () => {
    const { anna, ben } = switchesViews(atSwitches());
    if (anna.puzzle?.kind !== 'switches' || ben.puzzle?.kind !== 'switches') {
      throw new Error('expected switches views');
    }
    expect(anna.puzzle.switches).toBeNull();
    expect(anna.puzzle.target).toHaveLength(3);
    expect(ben.puzzle.switches).toHaveLength(6);
    expect(ben.puzzle.target).toBeNull();
    const targets = anna.puzzle.target ?? [];
    expect(JSON.stringify(ben.puzzle)).not.toContain(JSON.stringify(targets));
  });

  it('toggling is free, committing the right pattern solves', () => {
    let state = atSwitches();
    const target = (() => {
      const v = viewFor(state, 'p1').puzzle;
      return v?.kind === 'switches' ? (v.target ?? []) : [];
    })();
    const panel = (() => {
      const v = viewFor(state, 'p2').puzzle;
      return v?.kind === 'switches' ? (v.switches ?? []) : [];
    })();
    for (const [i, sw] of panel.entries()) {
      if (target.includes(sw.symbol)) {
        state = applyAction(state, {
          type: 'puzzle-input',
          playerId: 'p2',
          at: T0 + 3000,
          input: { switchIndex: i },
        });
      }
    }
    expect(state.penaltySeq).toBe(0);
    state = applyAction(state, commit('p2', T0 + 4000));
    expect(state.currentPuzzleIndex).toBe(3);
    expect(state.penaltySeq).toBe(0);
  });

  it('committing a wrong pattern costs time and keeps the puzzle running', () => {
    const state = atSwitches();
    const before = state.deadlineAt ?? 0;
    const after = applyAction(state, commit('p2', T0 + 3000));
    expect(after.phase).toBe('playing');
    expect(after.currentPuzzleIndex).toBe(2);
    expect(after.deadlineAt).toBe(before - 20_000);
    expect(after.penaltySeq).toBe(1);
  });

  it('only the panel role may toggle or commit', () => {
    const state = atSwitches();
    expect(() =>
      applyAction(state, {
        type: 'puzzle-input',
        playerId: 'p1',
        at: T0 + 1,
        input: { switchIndex: 0 },
      }),
    ).toThrow(GameError);
    expect(() =>
      applyAction(state, commit('p1', T0 + 1)),
    ).toThrow(GameError);
  });
});

describe('simon puzzle', () => {
  function atSimon(seed = 42): GameState {
    let state = atSwitches(seed);
    const target = (() => {
      const v = viewFor(state, 'p1').puzzle;
      return v?.kind === 'switches' ? (v.target ?? []) : [];
    })();
    const panel = (() => {
      const v = viewFor(state, 'p2').puzzle;
      return v?.kind === 'switches' ? (v.switches ?? []) : [];
    })();
    for (const [i, sw] of panel.entries()) {
      if (target.includes(sw.symbol)) {
        state = applyAction(state, {
          type: 'puzzle-input',
          playerId: 'p2',
          at: T0 + 5000,
          input: { switchIndex: i },
        });
      }
    }
    return applyAction(state, commit('p2', T0 + 6000));
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

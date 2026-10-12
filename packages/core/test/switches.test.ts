import { describe, expect, it } from 'vitest';
import { applyAction, GameError, generateEdgework, parseMission, viewFor } from '../src/index.js';
import type { Action, Edgework, GameState, PuzzleContext } from '../src/index.js';
import { switchesModule } from '../src/puzzles/switches.js';
import type {
  Switch,
  SwitchesDef,
  SwitchesInput,
  SwitchesState,
  SwitchesView,
} from '../src/puzzles/switches.js';
import { mulberry32 } from '../src/rng.js';
import {
  AT_BOOK,
  AT_STATION,
  labMission,
  openLab,
  started as startedLab,
  T0,
} from './lab.js';
import { playInstance } from './solveModule.js';

const SEEDS = 300;

const rawDef = { type: 'switches', id: 'bank', title: 'Bank', penaltySec: 12 };
const mission = labMission([rawDef], 'schaltertest', ['pult', 'handbuch', 'zaungast']);
const parsedDef = mission.puzzles[0];
if (parsedDef?.type !== 'switches') {
  throw new Error('expected the switch bank as the only puzzle');
}
const def: SwitchesDef = parsedDef;

/** p1 at the bank, p2 at the book, p3 somewhere else; only p1 has read the sign. */
function started(seed = 7): GameState {
  return openLab(startedLab(mission, seed), { signSeen: ['p1'] });
}

const send = (playerId: string, input: unknown, at = T0 + 1000): Action => ({
  type: 'puzzle-input',
  playerId,
  at,
  input,
});

function switchesView(state: GameState, playerId: string): SwitchesView {
  const puzzle = viewFor(state, playerId).puzzle;
  if (puzzle?.kind !== 'switches') {
    throw new Error('expected a switches view');
  }
  return puzzle;
}

function bankOf(state: GameState): Switch[] {
  const bank = switchesView(state, 'p1').switches;
  if (bank === null) {
    throw new Error('expected the operator to see the bank');
  }
  return bank;
}

/** Plays the crew's moves through the reducer, each from the views as they arrive. */
function solveThroughReducer(from: GameState): GameState {
  let state = from;
  for (let round = 1; state.phase === 'playing' && round <= 10; round++) {
    const views = { operator: switchesView(state, 'p1'), reader: switchesView(state, 'p2') };
    const edgework = viewFor(state, 'p1').edgework;
    for (const { input } of switchesModule.solve(def, views, edgework)) {
      state = applyAction(state, send('p1', input, T0 + round * 1000));
    }
  }
  return state;
}

const ctx = (edgework: Edgework): PuzzleContext => ({
  edgework,
  alarms: 0,
  remainingSec: 600,
  at: T0,
  crew: ['op', 'rd'],
});

function press(state: SwitchesState, input: SwitchesInput, edgework: Edgework) {
  return switchesModule.apply(def, state, input, 'op', ctx(edgework));
}

/** The bank as the solver would leave it: every switch where the rules want it. */
function settled(from: SwitchesState, edgework: Edgework): SwitchesState {
  let state = from;
  for (let guard = 0; guard <= 6; guard++) {
    const viewCtx = { edgework, alarms: 0, crew: ['op', 'rd'] };
    const views = {
      operator: switchesModule.view(def, state, AT_STATION, viewCtx),
      reader: switchesModule.view(def, state, AT_BOOK, viewCtx),
    };
    const [move] = switchesModule.solve(def, views, edgework);
    if (move === undefined || 'check' in move.input) {
      return state;
    }
    state = press(state, move.input, edgework).state;
  }
  throw new Error('the solver kept toggling');
}

function printedTable(): string[][] {
  const table = switchesModule
    .manual(def)
    .flatMap((section) => section.blocks)
    .find((block) => block.kind === 'table');
  if (table?.kind !== 'table') {
    throw new Error('expected a table in the manual');
  }
  return table.rows;
}

/** A switch with the features one row of the printed table names. */
function switchFromRow(row: string[], up: boolean): Switch {
  const [led, marking, star] = row;
  return {
    led: led === 'an',
    red: marking === 'rot' || marking === 'beides',
    blue: marking === 'blau' || marking === 'beides',
    star: star === 'ja',
    up,
  };
}

/** The printed legend, read independently of the module. */
function legendSaysUp(letter: string, lab: Edgework): boolean {
  const rules: Record<string, boolean> = {
    U: true,
    N: false,
    G: Number(lab.serial.slice(-1)) % 2 === 0,
    Z: lab.cells >= 2,
    L: lab.indicators.some((i) => i.id === 'SIG' && i.lit),
  };
  const up = rules[letter];
  if (up === undefined) {
    throw new Error(`unknown letter "${letter}" in the table`);
  }
  return up;
}

function lab(lastDigit: string, cells: number, sig: 'lit' | 'dark' | 'absent'): Edgework {
  return {
    serial: `K7G3A-${lastDigit}`,
    indicators: [
      { id: 'FRQ', lit: true },
      sig === 'absent' ? { id: 'CAR', lit: true } : { id: 'SIG', lit: sig === 'lit' },
      { id: 'NSA', lit: false },
    ],
    cells,
  };
}

describe('switches: the printed rules', () => {
  it('hold one table with every feature combination once and every letter at least twice', () => {
    const rows = printedTable();
    expect(rows).toHaveLength(16);
    const combos = new Set(rows.map(([led, marking, star]) => `${led}/${marking}/${star}`));
    expect(combos.size).toBe(16);
    for (const [led, marking, star] of rows) {
      expect(['an', 'aus']).toContain(led);
      expect(['keine', 'rot', 'blau', 'beides']).toContain(marking);
      expect(['ja', 'nein']).toContain(star);
    }
    const letters = rows.map((row) => row[3] ?? '');
    for (const letter of ['U', 'N', 'G', 'Z', 'L']) {
      expect(letters.filter((l) => l === letter).length, letter).toBeGreaterThanOrEqual(2);
    }
    expect(new Set(letters)).toEqual(new Set(['U', 'N', 'G', 'Z', 'L']));
  });

  it('let no single feature give the letter away', () => {
    const rows = printedTable();
    for (const column of [0, 1, 2]) {
      for (const value of new Set(rows.map((row) => row[column]))) {
        const letters = new Set(rows.filter((row) => row[column] === value).map((row) => row[3]));
        expect(letters.size, `column ${column} = ${value}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('end the legend in a catch-all and name the price of a wrong check', () => {
    const blocks = switchesModule.manual(def).flatMap((section) => section.blocks);
    const legend = blocks.find((block) => block.kind === 'rules');
    expect(legend?.kind === 'rules' ? legend.items.at(-1) : null).toMatch(/^Sonst/);
    expect(JSON.stringify(blocks)).toContain('−12 s');
  });
});

describe('switches: the rules as PRÜFEN enforces them', () => {
  const labs = ['2', '0', '7'].flatMap((digit) =>
    [0, 1, 2, 4].flatMap((cells) =>
      (['lit', 'dark', 'absent'] as const).map((sig) => lab(digit, cells, sig)),
    ),
  );

  it('are exactly the printed table and legend, for every row and every kind of lab', () => {
    const rows = printedTable();
    const alwaysDown = rows.find((row) => row[3] === 'N');
    if (alwaysDown === undefined) {
      throw new Error('expected an N row');
    }
    // Five switches that stay down whatever the lab, beside the one under test.
    const fillers = Array.from({ length: 5 }, () => switchFromRow(alwaysDown, false));
    for (const edgework of labs) {
      for (const row of rows) {
        const up = legendSaysUp(row[3] ?? '', edgework);
        const bank = (testUp: boolean): SwitchesState => ({
          type: 'switches',
          switches: [switchFromRow(row, testUp), ...fillers],
          attempts: 0,
        });
        const label = `${row.join(' ')} in ${JSON.stringify(edgework)}`;
        expect(press(bank(up), { check: true }, edgework).solved, label).toBe(true);
        expect(press(bank(!up), { check: true }, edgework).penalty, label).not.toBeNull();
      }
    }
  });
});

describe('switches: a run', () => {
  it(`is solved from the station's and the book's view, alarm-free, for ${SEEDS} seeds`, () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      // At least one switch goes up and at least one stays down: 1–5 toggles, then PRÜFEN.
      const moves = playInstance(def, seed);
      expect(moves, `seed ${seed}`).toBeGreaterThanOrEqual(2);
      expect(moves, `seed ${seed}`).toBeLessThanOrEqual(6);
    }
  });

  it(`alarms on PRÜFEN with any switch wrong, leaving the bank as set, for ${SEEDS} seeds`, () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const edgework = generateEdgework(mulberry32(seed + 1));
      const start = switchesModule.init(def, mulberry32(seed), ctx(edgework));
      expect(start.switches.every((sw) => !sw.up)).toBe(true);
      const allUp = { ...start, switches: start.switches.map((sw) => ({ ...sw, up: true })) };
      for (const guess of [start, allUp]) {
        expect(press(guess, { check: true }, edgework).penalty, `seed ${seed}`).not.toBeNull();
      }
      const right = settled(start, edgework);
      for (let i = 0; i < 6; i++) {
        const wrong = press(right, { switchIndex: i }, edgework);
        expect(wrong).toMatchObject({ solved: false, penalty: null });
        const checked = press(wrong.state, { check: true }, edgework);
        expect(checked.penalty).toBe('Falsche Schalterstellung');
        expect(checked.solved).toBe(false);
        expect(checked.state).toEqual({ ...wrong.state, attempts: 1 });
      }
      expect(press(right, { check: true }, edgework)).toEqual({
        state: right,
        solved: true,
        penalty: null,
      });
    }
  });

  it('rolls the same bank for the same seed and a different one otherwise', () => {
    expect(bankOf(started(7))).toEqual(bankOf(started(7)));
    expect(bankOf(started(7))).not.toEqual(bankOf(started(8)));
  });

  it('shows the bank at the station, the rules at the book, the edgework to its reader', () => {
    const state = started();
    const operator = viewFor(state, 'p1');
    const manual = viewFor(state, 'p2');
    const bystander = viewFor(state, 'p3');
    expect(switchesView(state, 'p1').switches).toHaveLength(6);
    expect(operator.edgework).toEqual(state.edgework);
    expect(switchesView(state, 'p2')).toMatchObject({ switches: null, attempts: 0 });
    expect(manual.puzzle?.manual).toEqual(switchesModule.manual(def));
    expect(manual.edgework).toBeNull();
    expect(switchesView(state, 'p3')).toMatchObject({ switches: null, manual: null });
    for (const view of [manual, bystander]) {
      expect(JSON.stringify(view)).not.toMatch(/"led"|"star"|"up"/);
    }
  });

  it('toggles exactly the chosen switch, back and forth, for free', () => {
    const state = started();
    const toggled = applyAction(state, send('p1', { switchIndex: 2 }));
    const before = bankOf(state);
    expect(bankOf(toggled)).toEqual(
      before.map((sw, i) => (i === 2 ? { ...sw, up: !sw.up } : sw)),
    );
    expect(bankOf(applyAction(toggled, send('p1', { switchIndex: 2 })))).toEqual(before);
    expect(toggled.penaltySeq).toBe(0);
    expect(toggled.deadlineAt).toBe(state.deadlineAt);
  });

  it('charges a wrong PRÜFEN and keeps the station open; the right one wins', () => {
    const state = started();
    const wrong = applyAction(state, send('p1', { check: true }));
    expect(wrong.phase).toBe('playing');
    expect(wrong.penaltySeq).toBe(1);
    expect(wrong.deadlineAt).toBe((state.deadlineAt ?? 0) - 12_000);
    expect(bankOf(wrong)).toEqual(bankOf(state));
    expect(switchesView(wrong, 'p2').attempts).toBe(1);
    const won = solveThroughReducer(wrong);
    expect(won.phase).toBe('won');
    expect(won.penaltySeq).toBe(1);
  });

  it('lets only a player at the bank toggle or check', () => {
    const state = started();
    for (const playerId of ['p2', 'p3']) {
      expect(() => applyAction(state, send(playerId, { switchIndex: 0 }))).toThrow(GameError);
      expect(() => applyAction(state, send(playerId, { check: true }))).toThrow(
        'Dafür musst du am Pult stehen.',
      );
    }
  });

  it('rejects inputs outside the bank or of another shape', () => {
    const state = started();
    for (const input of [
      { switchIndex: 6 },
      { switchIndex: -1 },
      { switchIndex: 1.5 },
      { check: false },
      { switchIndex: 0, check: true },
      { commit: true },
      {},
    ]) {
      expect(() => applyAction(state, send('p1', input)), JSON.stringify(input)).toThrow(
        /Ungültige Eingabe/,
      );
    }
  });
});

describe('switches: the mission format', () => {
  it('needs only the common fields, and knows no roles any more', () => {
    expect(
      switchesModule.defSchema.parse({ type: 'switches', id: 'bank', title: 'Bank' }),
    ).toMatchObject({ penaltySec: 20, hints: [] });
    expect(() =>
      switchesModule.defSchema.parse({
        type: 'switches',
        id: 'bank',
        title: 'Bank',
        operatorRoleId: 'pult',
      }),
    ).toThrow(/operatorRoleId/);
  });

  it('refuses a map where nobody could read the edgework', () => {
    const blind = JSON.parse(JSON.stringify(mission));
    delete blind.map.edgeworkSign;
    expect(() => parseMission(blind)).toThrow(/"bank" read the edgework, but there is no edgeworkSign/);
  });

  it('cannot be solved without the edgework', () => {
    const state = started();
    const views = { operator: switchesView(state, 'p1'), reader: switchesView(state, 'p2') };
    expect(() => switchesModule.solve(def, views, null)).toThrow(/nobody has read the sign/);
  });
});

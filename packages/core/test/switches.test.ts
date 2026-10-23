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
  SwitchView,
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
const FEATURES = [3, 2] as const;

const rawDef = { type: 'switches', id: 'bank', title: 'Bank', penaltySec: 12 };
const mission = labMission([rawDef], 'schaltertest', 3);
const parsedDef = mission.puzzles[0];
if (parsedDef?.type !== 'switches') {
  throw new Error('expected the switch bank as the only puzzle');
}
/** The mission names no `features`, so the bank has the default three. */
const def: SwitchesDef = parsedDef;

function defOf(features: SwitchesDef['features']): SwitchesDef {
  return switchesModule.defSchema.parse({ ...rawDef, features });
}

/** p1 at the bank, p2 at the book, p3 somewhere else; only p1 has read the sign. */
function started(seed = 7, from = mission): GameState {
  return openLab(startedLab(from, seed), { signSeen: ['p1'] });
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

function bankOf(state: GameState): SwitchView[] {
  const bank = switchesView(state, 'p1').switches;
  if (bank === null) {
    throw new Error('expected the operator to see the bank');
  }
  return bank;
}

/** Plays the crew's moves through the reducer, each from the views as they arrive. */
function solveThroughReducer(from: GameState, bank = def): GameState {
  let state = from;
  for (let round = 1; state.phase === 'playing' && round <= 10; round++) {
    const views = { operator: switchesView(state, 'p1'), reader: switchesView(state, 'p2') };
    const edgework = viewFor(state, 'p1').edgework;
    for (const { input } of switchesModule.solve(bank, views, edgework)) {
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
  console: 'a',
  atConsoles: { a: [], b: [] },
  readers: [],
});

function press(bank: SwitchesDef, state: SwitchesState, input: SwitchesInput, edgework: Edgework) {
  return switchesModule.apply(bank, state, input, 'op', ctx(edgework));
}

/** The bank as the solver would leave it: every switch where the rules want it. */
function settled(bank: SwitchesDef, from: SwitchesState, edgework: Edgework): SwitchesState {
  let state = from;
  for (let guard = 0; guard <= 6; guard++) {
    const viewCtx = { edgework, alarms: 0, crew: ['op', 'rd'], operators: ['op'] };
    const views = {
      operator: switchesModule.view(bank, state, AT_STATION, viewCtx),
      reader: switchesModule.view(bank, state, AT_BOOK, viewCtx),
    };
    const [move] = switchesModule.solve(bank, views, edgework);
    if (move === undefined || 'check' in move.input) {
      return state;
    }
    state = press(bank, state, move.input, edgework).state;
  }
  throw new Error('the solver kept toggling');
}

function printedTable(bank: SwitchesDef): { head: string[]; rows: string[][] } {
  const table = switchesModule
    .manual(bank)
    .flatMap((section) => section.blocks)
    .find((block) => block.kind === 'table');
  if (table?.kind !== 'table') {
    throw new Error('expected a table in the manual');
  }
  return table;
}

/** A switch with the features one row of the printed table names; no Stern column, no star. */
function switchFromRow(row: string[], up: boolean): Switch {
  const [led, marking] = row;
  return {
    led: led === 'an',
    red: marking === 'rot' || marking === 'beides',
    blue: marking === 'blau' || marking === 'beides',
    star: row.length === 4 && row[2] === 'ja',
    up,
  };
}

/** The position a row prints in its last cell. */
const positionOf = (row: string[]): string => row.at(-1) ?? '';

/** A printed position, read independently of the module. */
function rowSaysUp(position: string, lab: Edgework): boolean {
  const rules: Record<string, boolean> = {
    hoch: true,
    runter: false,
    'hoch, wenn die Kennung gerade endet (0, 2, 4, 6, 8)': Number(lab.serial.slice(-1)) % 2 === 0,
    'hoch, wenn mindestens 2 Zellen': lab.cells >= 2,
    'hoch, wenn SIG leuchtet': lab.indicators.some((i) => i.id === 'SIG' && i.lit),
  };
  const up = rules[position];
  if (up === undefined) {
    throw new Error(`unknown position "${position}" in the table`);
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

const KENNUNG = 'hoch, wenn die Kennung gerade endet (0, 2, 4, 6, 8)';

describe('switches: the printed rules', () => {
  it('give three features sixteen rows, every combination once, every position twice', () => {
    const { head, rows } = printedTable(defOf(3));
    expect(head).toEqual(['LED', 'Markierung', 'Stern', 'Stellung']);
    expect(rows).toHaveLength(16);
    const combos = new Set(rows.map(([led, marking, star]) => `${led}/${marking}/${star}`));
    expect(combos.size).toBe(16);
    for (const [led, marking, star] of rows) {
      expect(['an', 'aus']).toContain(led);
      expect(['keine', 'rot', 'blau', 'beides']).toContain(marking);
      expect(['ja', 'nein']).toContain(star);
    }
    const positions = rows.map(positionOf);
    const all = [
      'hoch',
      'runter',
      KENNUNG,
      'hoch, wenn mindestens 2 Zellen',
      'hoch, wenn SIG leuchtet',
    ];
    for (const position of all) {
      expect(positions.filter((p) => p === position).length, position).toBeGreaterThanOrEqual(2);
    }
    expect(new Set(positions)).toEqual(new Set(all));
  });

  it('give two features eight rows, every combination once, one of them with a condition', () => {
    const { head, rows } = printedTable(defOf(2));
    expect(head).toEqual(['LED', 'Markierung', 'Stellung']);
    expect(rows).toHaveLength(8);
    expect(new Set(rows.map(([led, marking]) => `${led}/${marking}`)).size).toBe(8);
    for (const [led, marking] of rows) {
      expect(['an', 'aus']).toContain(led);
      expect(['keine', 'rot', 'blau', 'beides']).toContain(marking);
    }
    const positions = rows.map(positionOf);
    expect(positions.filter((p) => p !== 'hoch' && p !== 'runter')).toEqual([KENNUNG]);
    expect(new Set(positions)).toEqual(new Set(['hoch', 'runter', KENNUNG]));
  });

  it.each(FEATURES)('let no single feature give the position away, with %i features', (n) => {
    const { rows } = printedTable(defOf(n));
    // Two features leave two rows per Markierung, so those two have to differ.
    const least = n === 3 ? 3 : 2;
    for (let column = 0; column < n; column++) {
      for (const value of new Set(rows.map((row) => row[column]))) {
        const positions = new Set(rows.filter((row) => row[column] === value).map(positionOf));
        expect(positions.size, `column ${column} = ${value}`).toBeGreaterThanOrEqual(least);
      }
    }
  });

  it.each(FEATURES)('need no legend: Aufbau and Betrieb name the columns, %i features', (n) => {
    const manual = switchesModule.manual(defOf(n));
    expect(manual.map(({ heading }) => heading)).toEqual([
      'Kippschalterbank, Typ KS-6 (Baujahr 1984)',
      'Aufbau',
      'Betrieb',
      'Stellungstabelle',
      'Aus der Werkstatt',
    ]);
    const paragraph = (heading: string): string =>
      (manual.find((section) => section.heading === heading)?.blocks ?? [])
        .flatMap((block) => (block.kind === 'p' ? [block.text] : []))
        .join(' ');
    const [build, operation] = [paragraph('Aufbau'), paragraph('Betrieb')];
    const text = `${build} ${operation}`;
    const named = ['LED', 'Markierung', 'Stern', 'Stellung'].filter((word) => text.includes(word));
    expect(named).toEqual(printedTable(defOf(n)).head);
    expect(build).toContain('daneben die Taste PRÜFEN');
    expect(operation).toContain('gewertet wird erst PRÜFEN');
    expect(operation).toMatch(
      /zieht 12 Sekunden Einsatzzeit ab; alle Schalter bleiben, wie sie stehen\.$/,
    );
  });

  /** The sign values a log may state, as the labs they leave: the rest stays free. */
  const STATED: Record<string, Edgework[]> = {
    '3 Notstromzellen eingesetzt': ['2', '7'].flatMap((digit) =>
      (['lit', 'dark', 'absent'] as const).map((sig) => lab(digit, 3, sig)),
    ),
    'Kennung endet auf 7': [0, 1, 2, 4].flatMap((cells) =>
      (['lit', 'dark', 'absent'] as const).map((sig) => lab('7', cells, sig)),
    ),
  };

  it.each(FEATURES)('print a log that the table and PRÜFEN bear out, %i features', (n) => {
    const bankDef = defOf(n);
    const log = switchesModule
      .manual(bankDef)
      .flatMap((section) => section.blocks)
      .find((block) => block.kind === 'example');
    const [seen = '', row = '', set = ''] = log?.kind === 'example' ? log.lines : [];
    const sw = new RegExp(
      '^\\d\\d:\\d\\d Schalter (\\d): LED (an|aus), Markierung (\\S+?)' +
        '(?:, (ohne|mit) Stern)?; (.+)\\.$',
    ).exec(seen);
    const cells = /^\d\d:\d\d Zeile (an|aus), ([a-z]+)(?:, (ja|nein))?: (.+)\.$/.exec(row);
    const end = /Schalter (\d) (hoch|bleibt unten), die übrigen nach ihren Zeilen; PRÜFEN/.exec(
      set,
    );
    const labs = STATED[sw?.[5] ?? ''];
    if (sw === null || cells === null || end === null || labs === undefined) {
      throw new Error(`unreadable log: ${JSON.stringify([seen, row, set])}`);
    }
    // The row is the switch's own; the table prints the stated position in it.
    const star = sw[4] === undefined ? [] : [sw[4] === 'mit' ? 'ja' : 'nein'];
    const features = [sw[2] ?? '', sw[3] ?? '', ...star];
    expect([cells[1], cells[2], ...(cells[3] === undefined ? [] : [cells[3]])]).toEqual(features);
    expect(printedTable(bankDef).rows).toContainEqual([...features, cells[4]]);
    // With the other five down on a runter row, PRÜFEN takes the stated end and only that.
    const alwaysDown = printedTable(bankDef).rows.find((r) => positionOf(r) === 'runter') ?? [];
    const at = Number(sw[1]) - 1;
    expect(end[1]).toBe(sw[1]);
    const up = end[2] === 'hoch';
    const bank = (testUp: boolean): SwitchesState => ({
      type: 'switches',
      switches: Array.from({ length: 6 }, (_, i) =>
        switchFromRow(i === at ? [...features, ''] : alwaysDown, i === at && testUp),
      ),
      attempts: 0,
    });
    for (const edgework of labs) {
      expect(press(bankDef, bank(up), { check: true }, edgework).solved).toBe(true);
      expect(press(bankDef, bank(!up), { check: true }, edgework).penalty).not.toBeNull();
    }
  });
});

describe.each(FEATURES)('switches with %i features: the rules as PRÜFEN enforces them', (n) => {
  const bankDef = defOf(n);
  const labs = ['2', '0', '7'].flatMap((digit) =>
    [0, 1, 2, 4].flatMap((cells) =>
      (['lit', 'dark', 'absent'] as const).map((sig) => lab(digit, cells, sig)),
    ),
  );

  it('are exactly the printed table, for every row and every kind of lab', () => {
    const { rows } = printedTable(bankDef);
    const alwaysDown = rows.find((row) => positionOf(row) === 'runter');
    if (alwaysDown === undefined) {
      throw new Error('expected a runter row');
    }
    // Five switches that stay down whatever the lab, beside the one under test.
    const fillers = Array.from({ length: 5 }, () => switchFromRow(alwaysDown, false));
    for (const edgework of labs) {
      for (const row of rows) {
        const up = rowSaysUp(positionOf(row), edgework);
        const bank = (testUp: boolean): SwitchesState => ({
          type: 'switches',
          switches: [switchFromRow(row, testUp), ...fillers],
          attempts: 0,
        });
        const label = `${row.join(' ')} in ${JSON.stringify(edgework)}`;
        expect(press(bankDef, bank(up), { check: true }, edgework).solved, label).toBe(true);
        expect(press(bankDef, bank(!up), { check: true }, edgework).penalty, label).not.toBeNull();
      }
    }
  });
});

describe.each(FEATURES)('switches with %i features: a run', (n) => {
  const bankDef = defOf(n);

  it(`is solved from the station's and the book's view, alarm-free, for ${SEEDS} seeds`, () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      // At least one switch goes up and at least one stays down: 1–5 toggles, then PRÜFEN.
      const moves = playInstance(bankDef, seed);
      expect(moves, `seed ${seed}`).toBeGreaterThanOrEqual(2);
      expect(moves, `seed ${seed}`).toBeLessThanOrEqual(6);
    }
  });

  it(`alarms on PRÜFEN with any switch wrong, leaving the bank as set, for ${SEEDS} seeds`, () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const edgework = generateEdgework(mulberry32(seed + 1));
      const start = switchesModule.init(bankDef, mulberry32(seed), ctx(edgework));
      expect(start.switches.every((sw) => !sw.up)).toBe(true);
      const allUp = { ...start, switches: start.switches.map((sw) => ({ ...sw, up: true })) };
      for (const guess of [start, allUp]) {
        const checked = press(bankDef, guess, { check: true }, edgework);
        expect(checked.penalty, `seed ${seed}`).not.toBeNull();
      }
      const right = settled(bankDef, start, edgework);
      for (let i = 0; i < 6; i++) {
        const wrong = press(bankDef, right, { switchIndex: i }, edgework);
        expect(wrong).toMatchObject({ solved: false, penalty: null });
        const checked = press(bankDef, wrong.state, { check: true }, edgework);
        expect(checked.penalty).toBe('Falsche Schalterstellung');
        expect(checked.solved).toBe(false);
        expect(checked.state).toEqual({ ...wrong.state, attempts: 1 });
      }
      expect(press(bankDef, right, { check: true }, edgework)).toEqual({
        state: right,
        solved: true,
        penalty: null,
      });
    }
  });

  it(`rolls and shows stars only with three features, for ${SEEDS} seeds`, () => {
    let stars = 0;
    for (let seed = 0; seed < SEEDS; seed++) {
      const edgework = generateEdgework(mulberry32(seed + 1));
      const state = switchesModule.init(bankDef, mulberry32(seed), ctx(edgework));
      stars += state.switches.filter((sw) => sw.star).length;
      const viewCtx = { edgework, alarms: 0, crew: ['op', 'rd'], operators: ['op'] };
      const view = switchesModule.view(bankDef, state, AT_STATION, viewCtx);
      expect(view.features).toBe(n);
      expect(view.switches?.every((sw) => 'star' in sw === (n === 3))).toBe(true);
    }
    expect(stars > 0).toBe(n === 3);
  });
});

describe('switches: a run', () => {
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
    expect(switchesView(state, 'p2')).toMatchObject({ features: 3, switches: null, attempts: 0 });
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

  it('shows a bank of two features without stars, over the wire, and wins with it', () => {
    const simple = labMission([{ ...rawDef, features: 2 }], 'schaltertest-zwei', 3);
    const state = started(7, simple);
    const operator = switchesView(state, 'p1');
    expect(operator.features).toBe(2);
    expect(operator.switches).toHaveLength(6);
    expect(JSON.stringify(viewFor(state, 'p1'))).not.toContain('"star"');
    expect(switchesView(state, 'p2')).toMatchObject({ features: 2, switches: null });
    const won = solveThroughReducer(state, defOf(2));
    expect(won.phase).toBe('won');
    expect(won.penaltySeq).toBe(0);
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
    ).toMatchObject({ penaltySec: 20, hints: [], features: 3 });
    expect(() =>
      switchesModule.defSchema.parse({
        type: 'switches',
        id: 'bank',
        title: 'Bank',
        operatorRoleId: 'pult',
      }),
    ).toThrow(/operatorRoleId/);
  });

  it('takes two or three features, nothing else', () => {
    expect(defOf(2).features).toBe(2);
    for (const features of [1, 4, 2.5, '2', null]) {
      expect(
        () => switchesModule.defSchema.parse({ ...rawDef, features }),
        JSON.stringify(features),
      ).toThrow(/features/);
    }
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

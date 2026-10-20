import { describe, expect, it } from 'vitest';
import { applyAction, GameError, parseMission, viewFor, viewForSpectator } from '../src/index.js';
import type { Action, Edgework, GameState, Mission, PuzzleContext, Viewer } from '../src/index.js';
import { mulberry32 } from '../src/rng.js';
import {
  decide,
  WIRE_COLORS,
  wiringModule,
  type WireColor,
  type WiringDef,
  type WiringState,
  type WiringView,
} from '../src/puzzles/wiring.js';
import {
  AT_BOOK,
  AT_STATION,
  AUDIENCE,
  ELSEWHERE,
  labMission,
  openLab,
  started,
  T0,
} from './lab.js';
import { playInstance } from './solveModule.js';

const rawDef = { type: 'wiring', id: 'bruecken', title: 'Brücken', penaltySec: 25 };
const def: WiringDef = wiringModule.defSchema.parse(rawDef);

const mission: Mission = labMission([rawDef], 'kabeltest');

/** A lab where none of the conditions the rules name holds: serial even, FRQ dark, one cell. */
const QUIET: Edgework = {
  serial: 'K7G3B-2',
  indicators: [
    { id: 'FRQ', lit: false },
    { id: 'SIG', lit: true },
    { id: 'CAR', lit: false },
  ],
  cells: 1,
};
const ODD: Edgework = { ...QUIET, serial: 'K7G3B-7' };
const FRQ_LIT: Edgework = {
  ...QUIET,
  indicators: [{ id: 'FRQ', lit: true }, ...QUIET.indicators.slice(1)],
};
const TWO_CELLS: Edgework = { ...QUIET, cells: 2 };

/** Every combination of the lab conditions the printed rules name. */
const LABS: Edgework[] = ['K7G3B-2', 'K7G3B-7'].flatMap((serial) =>
  [false, true].flatMap((frqLit) =>
    [1, 2].map(
      (cells): Edgework => ({
        serial,
        indicators: [{ id: 'FRQ', lit: frqLit }, ...QUIET.indicators.slice(1)],
        cells,
      }),
    ),
  ),
);

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

function colorsOf(spoken: string): WireColor[] {
  return spoken.split(' ').map((word) => {
    const color = WIRE_COLORS.find((c) => c === word);
    if (color === undefined) {
      throw new Error(`"${word}" is not a wire colour`);
    }
    return color;
  });
}

function stateOf(colors: WireColor[]): WiringState {
  return { type: 'wiring', wires: colors.map((color, i) => ({ id: `w${i}`, color, cut: false })) };
}

function viewOf(state: WiringState, viewer: Viewer = AT_STATION): WiringView {
  const ctx = { edgework: QUIET, alarms: 0, crew: ['op', 'rd'], operators: ['op'] };
  return wiringModule.view(def, state, viewer, ctx);
}

/** The crew's next move, from the views at the station and at the book. */
function solveFor(state: WiringState, lab: Edgework | null) {
  return wiringModule.solve(def, { operator: viewOf(state), reader: viewOf(state, AT_BOOK) }, lab);
}

function* allColourings(wireCount: number): Generator<WireColor[]> {
  const base = WIRE_COLORS.length;
  for (let code = 0; code < base ** wireCount; code++) {
    yield Array.from(
      { length: wireCount },
      (_, i) => WIRE_COLORS[Math.floor(code / base ** i) % base] ?? 'rot',
    );
  }
}

/** The printed rule list for one wire count. */
function printedRules(wireCount: number): string[] {
  const block = wiringModule
    .manual(def)
    .find((section) => section.heading === `${wireCount} Kabel`)?.blocks[0];
  if (block?.kind !== 'rules') {
    throw new Error(`no printed rule list for ${wireCount} wires`);
  }
  return block.items;
}

/**
 * Worked by hand from the printed lists: the colours top to bottom, the lab,
 * the rule that decides and the wire (counted from the top) it names.
 */
const CASES = [
  { list: 3, rule: 1, wires: 'rot schwarz schwarz', lab: QUIET, cut: 2,
    text: 'Wenn mehr als ein schwarzes Kabel vorhanden ist, trenne das erste schwarze Kabel.' },
  { list: 3, rule: 2, wires: 'blau schwarz gelb', lab: QUIET, cut: 1,
    text: 'Wenn das letzte Kabel gelb ist, trenne das erste Kabel.' },
  { list: 3, rule: 3, wires: 'rot weiß blau', lab: QUIET, cut: 2,
    text: 'Wenn genau ein rotes Kabel vorhanden ist, trenne das zweite Kabel.' },
  { list: 3, rule: 4, wires: 'blau weiß blau', lab: QUIET, cut: 3,
    text: 'Wenn das erste Kabel blau ist, trenne das letzte blaue Kabel.' },
  { list: 3, rule: 4, wires: 'blau weiß weiß', lab: QUIET, cut: 1,
    text: 'Wenn das erste Kabel blau ist, trenne das letzte blaue Kabel.' },
  { list: 3, rule: 5, wires: 'rot rot blau', lab: QUIET, cut: 3,
    text: 'Andernfalls trenne das letzte Kabel.' },
  { list: 4, rule: 1, wires: 'rot weiß blau schwarz', lab: ODD, cut: 2,
    text: 'Wenn die Laborkennung ungerade endet und kein gelbes Kabel vorhanden ist, ' +
      'trenne das zweite Kabel.' },
  { list: 4, rule: 2, wires: 'weiß gelb weiß rot', lab: ODD, cut: 1,
    text: 'Wenn mehr als ein weißes Kabel vorhanden ist, trenne das erste weiße Kabel.' },
  { list: 4, rule: 3, wires: 'rot weiß blau schwarz', lab: QUIET, cut: 4,
    text: 'Wenn genau ein rotes Kabel vorhanden ist, trenne das letzte Kabel.' },
  { list: 4, rule: 4, wires: 'gelb blau blau gelb', lab: ODD, cut: 1,
    text: 'Wenn kein schwarzes Kabel vorhanden ist, trenne das erste Kabel.' },
  { list: 4, rule: 5, wires: 'gelb schwarz rot rot', lab: QUIET, cut: 3,
    text: 'Andernfalls trenne das dritte Kabel.' },
  { list: 5, rule: 1, wires: 'blau gelb weiß schwarz rot', lab: FRQ_LIT, cut: 5,
    text: 'Wenn die Kontrollleuchte FRQ leuchtet und genau ein blaues Kabel vorhanden ist, ' +
      'trenne das letzte Kabel.' },
  { list: 5, rule: 2, wires: 'blau gelb weiß schwarz rot', lab: QUIET, cut: 3,
    text: 'Wenn das letzte Kabel rot ist, trenne das dritte Kabel.' },
  { list: 5, rule: 3, wires: 'blau blau weiß schwarz weiß', lab: FRQ_LIT, cut: 1,
    text: 'Wenn kein gelbes Kabel vorhanden ist, trenne das erste Kabel.' },
  { list: 5, rule: 4, wires: 'weiß gelb weiß gelb weiß', lab: QUIET, cut: 5,
    text: 'Wenn mehr als ein weißes Kabel vorhanden ist, trenne das letzte weiße Kabel.' },
  { list: 5, rule: 5, wires: 'gelb schwarz rot blau gelb', lab: QUIET, cut: 4,
    text: 'Wenn genau ein schwarzes Kabel vorhanden ist, trenne das vierte Kabel.' },
  { list: 5, rule: 6, wires: 'gelb gelb rot schwarz schwarz', lab: QUIET, cut: 2,
    text: 'Andernfalls trenne das zweite Kabel.' },
  { list: 6, rule: 1, wires: 'gelb rot gelb blau rot gelb', lab: TWO_CELLS, cut: 2,
    text: 'Wenn mindestens 2 Notstromzellen eingesetzt sind und kein weißes Kabel vorhanden ' +
      'ist, trenne das zweite Kabel.' },
  { list: 6, rule: 2, wires: 'gelb rot gelb blau rot gelb', lab: QUIET, cut: 6,
    text: 'Wenn mehr als ein gelbes Kabel vorhanden ist, trenne das letzte gelbe Kabel.' },
  { list: 6, rule: 3, wires: 'weiß rot blau rot schwarz blau', lab: TWO_CELLS, cut: 5,
    text: 'Wenn genau ein schwarzes Kabel vorhanden ist, trenne das schwarze Kabel.' },
  { list: 6, rule: 4, wires: 'blau weiß rot rot gelb blau', lab: TWO_CELLS, cut: 4,
    text: 'Wenn das erste Kabel blau ist, trenne das vierte Kabel.' },
  { list: 6, rule: 5, wires: 'weiß rot blau blau gelb weiß', lab: TWO_CELLS, cut: 3,
    text: 'Wenn genau ein rotes Kabel vorhanden ist, trenne das dritte Kabel.' },
  { list: 6, rule: 6, wires: 'rot rot weiß schwarz schwarz gelb', lab: TWO_CELLS, cut: 1,
    text: 'Andernfalls trenne das erste Kabel.' },
];

describe('wiring rules', () => {
  it.each(CASES)(
    '$list Kabel, Regel $rule: $wires → Kabel $cut',
    ({ list, rule, wires, lab, cut, text }) => {
      expect(printedRules(list)[rule - 1]).toBe(text);
      const state = stateOf(colorsOf(wires));
      // The rule this case was worked out under is the one that decides.
      expect(decide(colorsOf(wires), lab)).toEqual({ rule, wire: cut - 1 });
      const wireId = `w${cut - 1}`;
      expect(solveFor(state, lab)).toEqual([{ by: 'operator', input: { wireId } }]);
      expect(wiringModule.apply(def, state, { wireId }, 'op', ctx(lab))).toMatchObject({
        solved: true,
        penalty: null,
      });
    },
  );

  it('exercises every printed rule in the worked cases', () => {
    for (const wireCount of [3, 4, 5, 6]) {
      const covered = new Set(CASES.filter((c) => c.list === wireCount).map((c) => c.rule));
      expect(covered.size, `${wireCount} Kabel`).toBe(printedRules(wireCount).length);
    }
  });

  it('prints four to six rules per wire count, each list ending in a catch-all', () => {
    for (const wireCount of [3, 4, 5, 6]) {
      const rules = printedRules(wireCount);
      expect(rules.length).toBeGreaterThanOrEqual(4);
      expect(rules.length).toBeLessThanOrEqual(6);
      expect(rules.at(-1)).toMatch(/^Andernfalls trenne das \S+ Kabel\.$/);
      expect(rules.slice(0, -1).filter((r) => !/^Wenn .+, trenne das .+\.$/.test(r))).toEqual([]);
    }
  });

  it('has exactly one right wire for every colouring in every lab, and solve names it', () => {
    const problems: string[] = [];
    const labDependent = new Map<number, number>();
    for (const wireCount of [3, 4, 5, 6]) {
      for (const colors of allColourings(wireCount)) {
        const state = stateOf(colors);
        const rightPerLab = new Set<string>();
        for (const lab of LABS) {
          const verdicts = state.wires.map((wire) =>
            wiringModule.apply(def, state, { wireId: wire.id }, 'op', ctx(lab)),
          );
          const right = state.wires.filter((_, i) => verdicts[i]?.solved === true);
          const [move] = solveFor(state, lab);
          if (
            right.length !== 1 ||
            verdicts.some((v) => v.solved === (v.penalty !== null)) ||
            move?.input.wireId !== right[0]?.id
          ) {
            problems.push(`${colors.join(' ')} in ${JSON.stringify(lab)}`);
          }
          rightPerLab.add(right[0]?.id ?? '');
        }
        if (rightPerLab.size > 1) {
          labDependent.set(wireCount, (labDependent.get(wireCount) ?? 0) + 1);
        }
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
    // The 4-, 5- and 6-wire lists read the lab: some colourings change answer with it.
    for (const wireCount of [4, 5, 6]) {
      expect(labDependent.get(wireCount) ?? 0, `${wireCount} Kabel`).toBeGreaterThan(0);
    }
  });
});

/** The worked example a def's manual prints, line by line. */
function printedExample(wiring: WiringDef): string[] {
  const block = wiringModule
    .manual(wiring)
    .flatMap((section) => section.blocks)
    .find((b) => b.kind === 'example');
  if (block?.kind !== 'example') {
    throw new Error('the manual prints no example');
  }
  return block.lines;
}

/**
 * The sign values an example may state, as what each sets in a lab; the
 * other values stay free. An example that states none holds in every lab.
 */
const STATED: Record<string, (lab: Edgework) => Edgework> = {
  '': (lab) => lab,
  'Kennung endet auf 4.': (lab) => ({ ...lab, serial: 'K7G3B-4' }),
  'FRQ leuchtet nicht.': (lab) => ({
    ...lab,
    indicators: lab.indicators.map((i) => (i.id === 'FRQ' ? { ...i, lit: false } : i)),
  }),
  '1 Notstromzelle eingesetzt.': (lab) => ({ ...lab, cells: 1 }),
};

describe('the printed example', () => {
  it.each([3, 4, 5, 6])('for a box of %i wires or more is worked by the rules', (fewest) => {
    const variant = wiringModule.defSchema.parse({ ...rawDef, wires: { min: fewest, max: 6 } });
    const [seen = '', applied = '', done = ''] = printedExample(variant);
    const wires = /^Gesehen: ([a-zß, ]+)\.(?: (.+))?$/.exec(seen);
    const rule = /^Liste (\d) Kabel: Regel (\d) trifft als erste zu \(.+\)\.$/.exec(applied);
    const cut = /^Getrennt: (das [a-zß ]+ Kabel), Nr\. (\d)\.$/.exec(done);
    const stated = STATED[wires?.[2] ?? ''];
    if (wires === null || rule === null || cut === null || stated === undefined) {
      throw new Error(`unreadable example: ${JSON.stringify([seen, applied, done])}`);
    }
    const colors = colorsOf((wires[1] ?? '').replaceAll(', ', ' '));
    const [ruleNo, wireNo] = [Number(rule[2]), Number(cut[2])];
    // The box the def draws fewest wires for, its list, and the cut that rule names.
    expect([colors.length, Number(rule[1])]).toEqual([fewest, fewest]);
    expect(printedRules(fewest)[ruleNo - 1]).toMatch(new RegExp(`, trenne ${cut[1]}\\.$`));
    for (const lab of LABS.map(stated)) {
      expect(decide(colors, lab), JSON.stringify(lab)).toEqual({ rule: ruleNo, wire: wireNo - 1 });
      const wireId = `w${wireNo - 1}`;
      expect(solveFor(stateOf(colors), lab)).toEqual([{ by: 'operator', input: { wireId } }]);
    }
  });
});

describe('wiring module', () => {
  it('draws three to six wires by default, each in one of the five colours', () => {
    const counts = new Set<number>();
    const colors = new Set<WireColor>();
    for (let seed = 0; seed < 200; seed++) {
      const { wires } = wiringModule.init(def, mulberry32(seed), ctx(QUIET));
      counts.add(wires.length);
      for (const wire of wires) {
        colors.add(wire.color);
      }
      expect(wires.every((w) => !w.cut)).toBe(true);
      expect(new Set(wires.map((w) => w.id)).size).toBe(wires.length);
    }
    expect([...counts].sort()).toEqual([3, 4, 5, 6]);
    expect([...colors].sort()).toEqual([...WIRE_COLORS].sort());
  });

  it('keeps to the wire range of the def, and repeats a run for the same seed', () => {
    const five = wiringModule.defSchema.parse({ ...rawDef, wires: { min: 5, max: 5 } });
    for (let seed = 0; seed < 50; seed++) {
      expect(wiringModule.init(five, mulberry32(seed), ctx(QUIET)).wires).toHaveLength(5);
    }
    const run = (seed: number) => wiringModule.init(def, mulberry32(seed), ctx(QUIET));
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
  });

  it('rejects a wire range outside three to six or upside down', () => {
    expect(def.wires).toEqual({ min: 3, max: 6 });
    const parse = (wires: unknown) => () =>
      parseMission({ ...JSON.parse(JSON.stringify(mission)), puzzles: [{ ...rawDef, wires }] });
    expect(parse({ min: 4, max: 4 })).not.toThrow();
    expect(parse({ min: 2, max: 4 })).toThrow(/puzzles\.0\.wires\.min/);
    expect(parse({ min: 3, max: 7 })).toThrow(/puzzles\.0\.wires\.max/);
    expect(parse({ min: 5, max: 4 })).toThrow(
      /puzzle "bruecken": wires.min \(5\) is above wires.max \(4\)/,
    );
  });

  it('leaves a wrong wire cut, keeps the station open and counts the cut', () => {
    const state = stateOf(colorsOf('rot rot blau'));
    const result = wiringModule.apply(def, state, { wireId: 'w0' }, 'op', ctx(QUIET));
    expect(result.solved).toBe(false);
    expect(result.penalty).toBe('Falsches Kabel getrennt');
    expect(viewOf(result.state).wires?.map((w) => w.cut)).toEqual([true, false, false]);
    expect(viewOf(result.state, AT_BOOK)).toMatchObject({ cutsDone: 1, wireCount: 3 });
  });

  it('ignores a click on a wire that is already cut or not on the panel', () => {
    const state = wiringModule.apply(
      def,
      stateOf(colorsOf('rot rot blau')),
      { wireId: 'w0' },
      'op',
      ctx(QUIET),
    ).state;
    for (const wireId of ['w0', 'w9']) {
      expect(wiringModule.apply(def, state, { wireId }, 'op', ctx(QUIET))).toEqual({
        state,
        solved: false,
        penalty: null,
      });
    }
  });

  it('solves with the right wire even when it is the last one left', () => {
    // "rot rot blau": the 3-wire catch-all names the last wire.
    let state = stateOf(colorsOf('rot rot blau'));
    for (const wireId of ['w0', 'w1']) {
      state = wiringModule.apply(def, state, { wireId }, 'op', ctx(QUIET)).state;
    }
    const [move] = solveFor(state, QUIET);
    expect(move?.input).toEqual({ wireId: 'w2' });
    expect(wiringModule.apply(def, state, { wireId: 'w2' }, 'op', ctx(QUIET)).solved).toBe(true);
  });

  it('shows the wires in order at the station only, and the counts to everyone', () => {
    const state = stateOf(colorsOf('gelb weiß schwarz'));
    expect(viewOf(state)).toEqual({
      kind: 'wiring',
      wires: [
        { id: 'w0', color: 'gelb', cut: false },
        { id: 'w1', color: 'weiß', cut: false },
        { id: 'w2', color: 'schwarz', cut: false },
      ],
      wireCount: 3,
      cutsDone: 0,
    });
    for (const viewer of [AT_BOOK, ELSEWHERE]) {
      expect(viewOf(state, viewer)).toEqual({
        kind: 'wiring',
        wires: null,
        wireCount: 3,
        cutsDone: 0,
      });
    }
    expect(viewOf(state, AUDIENCE).wires).toHaveLength(3);
  });

  it('cannot solve without the view at the station or without the edgework', () => {
    const state = stateOf(colorsOf('rot rot blau'));
    const fromBook = viewOf(state, AT_BOOK);
    expect(() => wiringModule.solve(def, { operator: fromBook, reader: fromBook }, QUIET)).toThrow(
      /operator's view/,
    );
    expect(() => solveFor(state, null)).toThrow(/nobody has read the sign/);
  });

  it('prints the box, one list per wire count, and closes on the penalty of the def', () => {
    const manual = wiringModule.manual(def);
    expect(manual.map((s) => s.heading)).toEqual([
      'Notstrom-Brücken',
      '3 Kabel',
      '4 Kabel',
      '5 Kabel',
      '6 Kabel',
    ]);
    expect(JSON.stringify(manual[0])).toContain('von oben nach unten gezählt');
    expect(manual.flatMap((s) => s.blocks).at(-1)).toEqual({
      kind: 'p',
      text: 'Fehlgriff: Alarm, −25 s. Das Kabel bleibt getrennt.',
    });
  });

  it('is solved from the views alone, without an alarm, for 300 seeds', () => {
    for (let seed = 0; seed < 300; seed++) {
      expect(playInstance(def, seed)).toBe(1);
    }
  });
});

describe('wiring in a run', () => {
  /** Anna (p1) at the box, Ben (p2) at the book; only Anna has read the sign. */
  function opened(seed = 7): GameState {
    return openLab(started(mission, seed), { signSeen: ['p1'] });
  }

  const cut = (playerId: string, wireId: string, at: number): Action => ({
    type: 'puzzle-input',
    playerId,
    at,
    input: { wireId },
  });

  /** The operator's wires and the wire the crew should cut, from the operator's view. */
  function bench(state: GameState) {
    const view = viewFor(state, 'p1');
    if (view.puzzle?.kind !== 'wiring' || view.puzzle.wires === null) {
      throw new Error('expected the operator view of the wires');
    }
    const { wires } = view.puzzle;
    const reader = viewFor(state, 'p2').puzzle;
    if (reader?.kind !== 'wiring') {
      throw new Error('expected the view at the book');
    }
    const [move] = wiringModule.solve(def, { operator: view.puzzle, reader }, view.edgework);
    const right = move?.input.wireId ?? '';
    return { wires, right, wrong: wires.filter((w) => w.id !== right) };
  }

  it('charges a wrong cut once and leaves that wire cut', () => {
    const state = opened();
    const wrong = bench(state).wrong[0]?.id ?? '';
    const after = applyAction(state, cut('p1', wrong, T0 + 1000));
    expect(after.deadlineAt).toBe((state.deadlineAt ?? 0) - 25_000);
    expect(after.penaltySeq).toBe(1);
    expect(after.lastPenaltySec).toBe(25);
    expect(after.phase).toBe('playing');
    expect(bench(after).wires.find((w) => w.id === wrong)?.cut).toBe(true);
    expect(viewFor(after, 'p2').puzzle).toMatchObject({ wires: null, cutsDone: 1 });

    const again = applyAction(after, cut('p1', wrong, T0 + 2000));
    expect(again.penaltySeq).toBe(1);
    expect(again.deadlineAt).toBe(after.deadlineAt);
  });

  it('wins on the right wire, also after every wrong one is gone', () => {
    let state = opened();
    const { right, wrong } = bench(state);
    for (const [i, wire] of wrong.entries()) {
      state = applyAction(state, cut('p1', wire.id, T0 + 1000 * (i + 1)));
    }
    expect(state.penaltySeq).toBe(wrong.length);
    expect(state.phase).toBe('playing');
    state = applyAction(state, cut('p1', right, T0 + 10_000));
    expect(state.phase).toBe('won');
  });

  it('loses when a wrong cut eats the remaining time', () => {
    const state = opened();
    const nearDeadline = (state.deadlineAt ?? 0) - 25_000 + 1000;
    const after = applyAction(state, cut('p1', bench(state).wrong[0]?.id ?? '', nearDeadline));
    expect(after.phase).toBe('lost');
  });

  it('only a player at the box may cut', () => {
    const state = opened();
    const attempt = () => applyAction(state, cut('p2', bench(state).right, T0 + 1000));
    expect(attempt).toThrow(GameError);
    expect(attempt).toThrow('Dafür musst du am Pult stehen.');
  });

  it('gives the wires to the box, the rules to the book, the edgework to who read the sign', () => {
    const state = opened();
    const operator = viewFor(state, 'p1');
    const manual = viewFor(state, 'p2');
    const { wires } = bench(state);
    expect(operator.edgework).toEqual(state.edgework);
    expect(operator.puzzle?.manual).toBeNull();
    expect(manual.edgework).toBeNull();
    expect(manual.puzzle?.manual).toEqual(wiringModule.manual(def));
    expect(manual.puzzle).toMatchObject({ wires: null, wireCount: wires.length, cutsDone: 0 });
    const leaked = JSON.stringify(manual);
    expect(leaked).not.toContain(JSON.stringify(wires));
    expect(leaked).not.toContain('"cut":');
    expect(leaked).not.toContain('"w0"');
    expect(viewForSpectator(state).puzzle).toMatchObject({
      wires,
      manual: wiringModule.manual(def),
    });
  });
});

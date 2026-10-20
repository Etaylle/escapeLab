import { describe, expect, it } from 'vitest';
import {
  applyAction,
  GameError,
  generateEdgework,
  parseMission,
  scaleMission,
  serialLastDigitIsOdd,
  stationKey,
  viewFor,
  viewForSpectator,
} from '../src/index.js';
import type {
  Action,
  ConsoleId,
  Difficulty,
  Edgework,
  GameState,
  ManualBlock,
  Mission,
  Perspectives,
  PuzzleContext,
  Viewer,
} from '../src/index.js';
import { circuitModule, VOLTAGES } from '../src/puzzles/circuit.js';
import type {
  CircuitBoard,
  CircuitDef,
  CircuitInput,
  CircuitState,
  CircuitView,
} from '../src/puzzles/circuit.js';
import { WIRE_COLORS } from '../src/puzzles/wiring.js';
import { mulberry32 } from '../src/rng.js';
import {
  AT_BOOK,
  AT_CONSOLE_B,
  AT_STATION,
  AUDIENCE,
  ELSEWHERE,
  standing,
  started,
  T0,
} from './lab.js';
import { playInstance } from './solveModule.js';

const SEEDS = 300;
const CREW = ['op', 'pt', 'rd'];

/** A lab whose serial ends even: the highest voltage goes first. */
const EVEN: Edgework = {
  serial: 'K7G3B-4',
  indicators: [
    { id: 'FRQ', lit: false },
    { id: 'SIG', lit: true },
    { id: 'CAR', lit: false },
  ],
  cells: 1,
};
/** The same lab with an odd serial: the lowest voltage above 0 V goes first. */
const ODD: Edgework = { ...EVEN, serial: 'K7G3B-7' };

/** A def through the schema, as a mission file's would go; `fields` may be off on purpose. */
function defOf(fields: object = {}): CircuitDef {
  return circuitModule.defSchema.parse({
    type: 'circuit',
    id: 'kasten',
    title: 'Notstrom-Kasten',
    ...fields,
  });
}

type AtConsoles = PuzzleContext['atConsoles'];

/** Both consoles manned: op at console a, pt at console b. */
const MANNED: AtConsoles = { a: ['op'], b: ['pt'] };

/** What a move from console `from` gets to know, with who stands where; null for the setup. */
const ctx = (from: ConsoleId | null, edgework = EVEN, atConsoles = MANNED): PuzzleContext => ({
  edgework,
  alarms: 0,
  remainingSec: 600,
  at: T0,
  crew: CREW,
  console: from,
  atConsoles: from === null ? { a: [], b: [] } : atConsoles,
  readers: [],
});

const deal = (def: CircuitDef, seed: number): CircuitState =>
  circuitModule.init(def, mulberry32(seed), ctx(null));

/**
 * An input from console `from` — by op at a, by pt at b — through the
 * schema, as a client's goes, with who stands where.
 */
function send(
  def: CircuitDef,
  state: CircuitState,
  input: CircuitInput,
  from: ConsoleId,
  edgework = EVEN,
  atConsoles = MANNED,
) {
  const parsed = circuitModule.inputSchema.parse(input);
  const by = from === 'a' ? 'op' : 'pt';
  return circuitModule.apply(def, state, parsed, by, ctx(from, edgework, atConsoles));
}
const cut = (def: CircuitDef, state: CircuitState, index: number, edgework = EVEN) =>
  send(def, state, { cut: index }, 'a', edgework);
const probe = (def: CircuitDef, state: CircuitState, index: number) =>
  send(def, state, { probe: index }, 'b');

/** The operator stands at the station. */
const OP = ['op'];
const seenFrom = (def: CircuitDef, state: CircuitState, viewer: Viewer): CircuitView =>
  circuitModule.view(def, state, viewer, { edgework: EVEN, alarms: 0, crew: CREW, operators: OP });

/** The crew's screens: the box at console a, the meter at console b, the book. */
const views = (def: CircuitDef, state: CircuitState): Perspectives<CircuitView> => ({
  operator: seenFrom(def, state, AT_STATION),
  partner: seenFrom(def, state, AT_CONSOLE_B),
  reader: seenFrom(def, state, AT_BOOK),
});

/** The wiring in place. */
function boardOf(state: CircuitState): CircuitBoard {
  const board = state.boards[state.board];
  if (board === undefined) {
    throw new Error(`no wiring ${state.board} in the state`);
  }
  return board;
}

/** Every wire's voltage now, as the audience sees it. */
function voltagesOf(def: CircuitDef, state: CircuitState): number[] {
  return seenFrom(def, state, AUDIENCE).voltages ?? [];
}

/**
 * The wire the printed rules name, worked out here on its own: the highest
 * voltage, or with an odd serial the lowest above 0 V.
 */
function ruleSays(volts: readonly number[], odd: boolean): number {
  const live = volts.filter((v) => v > 0);
  const wanted = odd ? Math.min(...live) : Math.max(...live);
  return volts.indexOf(wanted);
}

/** A wire the rules do not name. */
const besides = (named: number, count: number): number => (named + 1) % count;

/** Probe every wire at console b. */
function probeAll(def: CircuitDef, state: CircuitState): CircuitState {
  return state.cuts.reduce((s, _, i) => probe(def, s, i).state, state);
}

describe('circuit setup', () => {
  it('takes 4–6 wires, 3 shorts, 30 s and 60 s by default, and refuses what is off', () => {
    expect(defOf()).toMatchObject({
      wires: { min: 4, max: 6 },
      shorts: 3,
      penaltySec: 30,
      burnoutSec: 60,
    });
    for (const fields of [
      { wires: { min: 3, max: 6 } },
      { wires: { min: 4, max: 7 } },
      { wires: { min: 6, max: 5 } },
      { shorts: 1 },
      { shorts: 6 },
      { shorts: 2.5 },
      { burnoutSec: 0 },
      { voltage: 12 },
    ]) {
      expect(() => defOf(fields), JSON.stringify(fields)).toThrow();
    }
    expect(defOf({ wires: { min: 5, max: 5 }, shorts: 5 })).toMatchObject({ shorts: 5 });
  });

  it('wires one more box than the def allows shorts, all of one size, the same for a seed', () => {
    const counts = new Set<number>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const def = defOf({ shorts: 2 + (seed % 4) });
      const state = deal(def, seed);
      expect(deal(def, seed)).toEqual(state);
      const count = state.cuts.length;
      counts.add(count);
      expect(state.boards).toHaveLength(def.shorts + 1);
      expect(state).toMatchObject({ board: 0, probed: null, shorts: 0, lastResult: null });
      expect(state.cuts).toEqual(new Array<boolean>(count).fill(false));
      expect(state.readings).toEqual(new Array<null>(count).fill(null));
      for (const { colours, dead } of state.boards) {
        expect(colours).toHaveLength(count);
        expect(colours.every((c) => WIRE_COLORS.includes(c))).toBe(true);
        expect(dead.filter(Boolean)).toHaveLength(count >= 5 ? 1 : 0);
      }
    }
    expect([...counts].sort()).toEqual([4, 5, 6]);
    for (let seed = 0; seed < 50; seed++) {
      expect(deal(defOf({ wires: { min: 5, max: 5 } }), seed).cuts).toHaveLength(5);
    }
  });

  it('gives every live wire a different voltage in every round, the dead one 0 V', () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      for (const { dead, rounds } of deal(defOf(), seed).boards) {
        const live = dead.filter((d) => !d).length;
        expect(rounds).toHaveLength(live);
        for (const round of rounds) {
          const volts = round.filter((_, i) => dead[i] === false);
          expect(new Set(volts).size).toBe(live);
          expect(volts.every((v) => (VOLTAGES as readonly number[]).includes(v))).toBe(true);
          expect(round.filter((_, i) => dead[i] === true).every((v) => v === 0)).toBe(true);
        }
      }
    }
  });
});

describe('circuit views', () => {
  /** A state with every wire probed: the meter holds this round's readings. */
  const probed = (seed: number) => {
    const def = defOf();
    return { def, state: probeAll(def, deal(def, seed)) };
  };

  it('show the box its wires, never a voltage; the meter its readings, never a colour', () => {
    for (let seed = 0; seed < 50; seed++) {
      const { def, state } = probed(seed);
      const count = state.cuts.length;
      const atA = seenFrom(def, state, AT_STATION);
      const atB = seenFrom(def, state, AT_CONSOLE_B);
      expect(atA).toMatchObject({
        role: 'box',
        wires: boardOf(state).colours.map((colour) => ({ colour, cut: false })),
        count: null,
        readings: null,
        probed: null,
        voltages: null,
        dead: null,
      });
      expect(atB).toMatchObject({
        role: 'meter',
        wires: null,
        count,
        readings: voltagesOf(def, state),
        probed: count - 1,
        voltages: null,
        dead: null,
      });
      const live = count - (count >= 5 ? 1 : 0);
      for (const view of [atA, atB]) {
        expect(view).toMatchObject({ liveLeft: live, shorts: 0, lastResult: null });
      }
      const wireA = JSON.stringify(atA);
      expect(wireA).not.toMatch(/"(readings|voltages|dead)":\[|"count":\d/);
      expect(wireA).not.toMatch(/\b(12|24|48|110|230)\b/);
      const wireB = JSON.stringify(atB);
      expect(wireB).not.toMatch(/"(wires|voltages|dead)":\[|"colour"/);
      for (const colour of WIRE_COLORS) {
        expect(wireB).not.toContain(colour);
      }
    }
  });

  it('show the book and anybody away from the consoles nothing of the box', () => {
    const { def, state } = probed(3);
    for (const away of [AT_BOOK, ELSEWHERE]) {
      expect(seenFrom(def, state, away)).toEqual({
        kind: 'circuit',
        role: null,
        wires: null,
        count: null,
        readings: null,
        probed: null,
        liveLeft: null,
        shorts: null,
        lastResult: null,
        burnoutSec: 60,
        voltages: null,
        dead: null,
      });
    }
  });

  it('show the audience everything: wires, readings, every voltage and the dead wire', () => {
    const { def, state } = probed(4);
    const board = boardOf(state);
    expect(seenFrom(def, state, AUDIENCE)).toMatchObject({
      role: null,
      wires: board.colours.map((colour) => ({ colour, cut: false })),
      count: state.cuts.length,
      readings: state.readings,
      probed: state.cuts.length - 1,
      voltages: board.rounds[0],
      dead: board.dead,
    });
  });
});

describe('circuit inputs', () => {
  it('refuse a cut at the meter and a probe at the box, without an alarm', () => {
    const def = defOf();
    const state = deal(def, 2);
    const named = ruleSays(voltagesOf(def, state), false);
    expect(() => send(def, state, { cut: named }, 'b')).toThrow(GameError);
    expect(() => send(def, state, { cut: named }, 'b')).toThrow('Dieses Pult schneidet nicht.');
    expect(() => send(def, state, { probe: 0 }, 'a')).toThrow(GameError);
    expect(() => send(def, state, { probe: 0 }, 'a')).toThrow('Dieses Pult misst nicht.');
    const nowhere = { ...ctx('a'), console: null };
    expect(() => circuitModule.apply(def, state, { cut: named }, 'x', nowhere)).toThrow(GameError);
  });

  it('refuse a cut, without an alarm, while nobody else stands at the meter', () => {
    const def = defOf();
    const state = probeAll(def, deal(def, 2));
    const named = ruleSays(voltagesOf(def, state), false);
    const cutWith = (atConsoles: AtConsoles) =>
      send(def, state, { cut: named }, 'a', EVEN, atConsoles);
    // The solo walk: op measured at the meter and walked over to the box. Counted at
    // both consoles at once is still nobody else at the meter.
    for (const alone of [{ a: ['op'], b: [] }, { a: ['op'], b: ['op'] }]) {
      expect(() => cutWith(alone), JSON.stringify(alone)).toThrow(GameError);
      expect(() => cutWith(alone)).toThrow('Am Prüfpult steht niemand.');
    }
    // A wrong cut is turned away the same way, before it can short the box.
    const wrong = besides(named, state.cuts.length);
    expect(() => send(def, state, { cut: wrong }, 'a', EVEN, { a: ['op'], b: [] })).toThrow(
      'Am Prüfpult steht niemand.',
    );
    for (const manned of [MANNED, { a: ['op', 'rd'], b: ['op', 'pt'] }]) {
      const taken = cutWith(manned);
      expect(taken.penalty).toBeNull();
      expect(taken.state.cuts[named]).toBe(true);
    }
  });

  it('take a probe at the meter with nobody at the box', () => {
    const def = defOf();
    const state = deal(def, 2);
    const measured = send(def, state, { probe: 1 }, 'b', EVEN, { a: [], b: ['pt'] });
    expect(measured.penalty).toBeNull();
    expect(measured.state.readings[1]).toBe(voltagesOf(def, state)[1]);
  });

  it('refuse a wire the box does not have, and take nothing but a cut or a probe', () => {
    const def = defOf({ wires: { min: 4, max: 4 } });
    const state = deal(def, 1);
    expect(() => cut(def, state, 4)).toThrow('Der Kasten hat nur 4 Kabel.');
    expect(() => probe(def, state, 5)).toThrow('Der Kasten hat nur 4 Kabel.');
    for (const input of [
      { cut: -1 },
      { cut: 6 },
      { probe: 1.5 },
      { probe: '1' },
      { cut: 1, probe: 2 },
      {},
      { wireId: 'w1' },
    ]) {
      expect(circuitModule.inputSchema.safeParse(input).success, JSON.stringify(input)).toBe(false);
    }
    expect(circuitModule.inputSchema.parse({ cut: 5 })).toEqual({ cut: 5 });
    expect(circuitModule.inputSchema.parse({ probe: 0 })).toEqual({ probe: 0 });
  });

  it('measure a wire at the meter: its voltage this round, 0 V once cut, never an alarm', () => {
    const def = defOf();
    const state = deal(def, 5);
    const volts = voltagesOf(def, state);
    const first = probe(def, state, 1);
    expect(first.penalty).toBeNull();
    expect(first.solved).toBe(false);
    expect(first.state.readings[1]).toBe(volts[1]);
    expect(first.state.readings.filter((r) => r !== null)).toHaveLength(1);
    expect(first.state.probed).toBe(1);
    // Measured again in the same round: the same voltage; the display follows the last key.
    const twice = probe(def, probe(def, first.state, 0).state, 1).state;
    expect(twice).toMatchObject({ probed: 1, readings: expect.arrayContaining([volts[1]]) });
    expect(twice.readings[1]).toBe(volts[1]);
    const named = ruleSays(volts, false);
    const after = cut(def, first.state, named);
    expect(after.state.probed).toBeNull();
    expect(probe(def, after.state, named).state.readings[named]).toBe(0);
  });

  it('take the named cut: the wire stays cut, the readings go, the voltages are drawn anew', () => {
    const def = defOf({ wires: { min: 6, max: 6 } });
    const state = probeAll(def, deal(def, 8));
    const named = ruleSays(voltagesOf(def, state), false);
    const result = cut(def, state, named);
    expect(result.penalty).toBeNull();
    expect(result.solved).toBe(false);
    expect(result.state.cuts[named]).toBe(true);
    expect(result.state.readings.every((r) => r === null)).toBe(true);
    const next = boardOf(state).rounds[1] ?? [];
    expect(voltagesOf(def, result.state)).toEqual(next.map((v, i) => (i === named ? 0 : v)));
    expect(seenFrom(def, result.state, AT_CONSOLE_B)).toMatchObject({ liveLeft: 4, shorts: 0 });
  });

  it('take a wrong cut as one short: rewired, everything whole and unread, one alarm', () => {
    const def = defOf();
    let state = deal(def, 6);
    // Two right cuts first, so that the short has something to undo.
    for (let k = 0; k < 2; k++) {
      state = cut(def, state, ruleSays(voltagesOf(def, state), false)).state;
    }
    state = probeAll(def, state);
    const count = state.cuts.length;
    const named = ruleSays(voltagesOf(def, state), false);
    const short = cut(def, state, besides(named, count));
    expect(short.penalty).toBe('Kurzschluss');
    expect(short.solved).toBe(false);
    expect(short.state).toMatchObject({
      board: 1,
      cuts: new Array<boolean>(count).fill(false),
      readings: new Array<null>(count).fill(null),
      probed: null,
      shorts: 1,
      lastResult: 'short',
    });
    expect(voltagesOf(def, short.state)).toEqual(state.boards[1]?.rounds[0]);
    for (const viewer of [AT_STATION, AT_CONSOLE_B]) {
      expect(seenFrom(def, short.state, viewer)).toMatchObject({ shorts: 1, lastResult: 'short' });
    }
    // A probe leaves the warning up; the next right cut clears it.
    const probed = probe(def, short.state, 0).state;
    expect(probed.lastResult).toBe('short');
    const right = cut(def, probed, ruleSays(voltagesOf(def, probed), false));
    expect(right.state.lastResult).toBeNull();
  });

  it('short on a cut wire and on the dead one, as on any wire the rules do not name', () => {
    const def = defOf({ wires: { min: 5, max: 5 } });
    const state = deal(def, 7);
    const dead = boardOf(state).dead.indexOf(true);
    expect(dead).toBeGreaterThanOrEqual(0);
    expect(cut(def, state, dead).penalty).toBe('Kurzschluss');
    const named = ruleSays(voltagesOf(def, state), false);
    const once = cut(def, state, named).state;
    expect(cut(def, once, named)).toMatchObject({ penalty: 'Kurzschluss', state: { shorts: 1 } });
  });

  it('burn the box out from the def’s shorts-th short on, at its own price', () => {
    for (const shorts of [2, 3, 5]) {
      const def = defOf({ shorts, burnoutSec: 75 });
      let state = deal(def, 9);
      const said: [string | null, number | undefined][] = [];
      for (let k = 1; k <= shorts + 3; k++) {
        const named = ruleSays(voltagesOf(def, state), false);
        const result = cut(def, state, besides(named, state.cuts.length));
        said.push([result.penalty, result.penaltySec]);
        state = result.state;
        expect(state).toMatchObject({
          shorts: k,
          board: k % (shorts + 1),
          lastResult: k >= shorts ? 'burnout' : 'short',
        });
      }
      // A short leaves the price to the def's penaltySec; a burnout names its own.
      expect(said).toEqual([
        ...new Array(shorts - 1).fill(['Kurzschluss', undefined]),
        ...new Array(4).fill(['Kasten durchgebrannt', 75]),
      ]);
    }
  });

  it('never name a dead or cut wire, in either lab, on any wiring, in any round', () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const def = defOf();
      const dealt = deal(def, seed);
      for (const lab of [EVEN, ODD]) {
        const odd = serialLastDigitIsOdd(lab);
        for (let board = 0; board < dealt.boards.length; board++) {
          let state: CircuitState = { ...dealt, board };
          let solved = false;
          while (!solved) {
            const volts = voltagesOf(def, state);
            const named = ruleSays(volts, odd);
            expect(boardOf(state).dead[named], `seed ${seed}`).toBe(false);
            expect(state.cuts[named], `seed ${seed}`).toBe(false);
            const result = cut(def, state, named, lab);
            expect(result.penalty, `seed ${seed}`).toBeNull();
            ({ state, solved } = result);
          }
          const live = boardOf(state).dead.filter((d) => !d).length;
          expect(state.cuts.filter(Boolean)).toHaveLength(live);
          expect(boardOf(state).dead.every((d, i) => !d || state.cuts[i] === false)).toBe(true);
        }
      }
    }
  });
});

/** The moves a perfect crew takes for a box of `count`: every uncut wire measured, then a cut. */
function movesFor(count: number): number {
  const live = count - (count >= 5 ? 1 : 0);
  let moves = 0;
  for (let round = 0; round < live; round++) {
    moves += count - round + 1;
  }
  return moves;
}

describe('circuit solver', () => {
  it(`solves ${SEEDS} instances from the consoles' views and the sign, in both labs`, () => {
    expect(circuitModule.usesEdgework).toBe(true);
    const parities = new Set<boolean>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const def = defOf({ shorts: 2 + (seed % 4) });
      // The harness hands this lab to the solver, and the module the same one.
      parities.add(serialLastDigitIsOdd(generateEdgework(mulberry32(seed + 1))));
      expect(playInstance(def, seed), `seed ${seed}`).toBe(movesFor(deal(def, seed).cuts.length));
    }
    expect(parities).toEqual(new Set([false, true]));
  });

  it('waits for the sign, then measures every uncut wire unread this round at once', () => {
    const def = defOf();
    const state = deal(def, 12);
    const count = state.cuts.length;
    expect(circuitModule.solve(def, views(def, state), null)).toEqual([]);
    const all = Array.from({ length: count }, (_, i) => ({ by: 'partner', input: { probe: i } }));
    expect(circuitModule.solve(def, views(def, state), EVEN)).toEqual(all);
    const some = probe(def, probe(def, state, 0).state, 2).state;
    expect(circuitModule.solve(def, views(def, some), EVEN)).toEqual(
      all.filter(({ input }) => input.probe !== 0 && input.probe !== 2),
    );
  });

  it('cuts at the box what the rules name once all is read — a different wire in each lab', () => {
    const def = defOf();
    const state = probeAll(def, deal(def, 13));
    const volts = voltagesOf(def, state);
    for (const lab of [EVEN, ODD]) {
      expect(circuitModule.solve(def, views(def, state), lab)).toEqual([
        { by: 'operator', input: { cut: ruleSays(volts, serialLastDigitIsOdd(lab)) } },
      ]);
    }
    expect(ruleSays(volts, true)).not.toBe(ruleSays(volts, false));
    // After the cut it measures again, and only the wires still whole.
    const named = ruleSays(volts, false);
    const next = cut(def, state, named).state;
    const again = circuitModule.solve(def, views(def, next), EVEN);
    expect(again.map((move) => move.input)).toEqual(
      next.cuts.flatMap((c, i) => (c ? [] : [{ probe: i }])),
    );
  });

  it('needs the box at console a and the meter at console b', () => {
    const def = defOf();
    const state = deal(def, 1);
    const book = seenFrom(def, state, AT_BOOK);
    expect(() => circuitModule.solve(def, { operator: book, reader: book }, EVEN)).toThrow(
      'circuit "kasten": solving needs the box\'s view at console a and the meter\'s at console b',
    );
  });
});

type ExampleBlock = Extract<ManualBlock, { kind: 'example' }>;

function blocksOf(def: CircuitDef): ManualBlock[] {
  return circuitModule.manual(def).flatMap((section) => section.blocks);
}

/** The numbers a phrase lists: „1, 2, 4 und 5" or „1 bis 5", „48, 0, 230, 12 und 110". */
function listed(phrase: string): number[] {
  const range = /^(\d+) bis (\d+)$/.exec(phrase.trim());
  if (range !== null) {
    const [from, to] = [Number(range[1]), Number(range[2])];
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }
  return phrase.split(/, | und /).map((part) => Number(part.trim()));
}

/** What an example line says the meter showed: the wires, counted from 1, and their voltages. */
function measuredIn(line: string): { wires: number[]; volts: number[] } {
  const said = /Kabel ([\d, und bis]+?) zeigen ([\d, und]+) V\.$/.exec(line);
  if (said === null) {
    throw new Error(`"${line}" lists no measurements`);
  }
  return { wires: listed(said[1] ?? ''), volts: listed(said[2] ?? '') };
}

/** The wire an example line says was cut, counted from 1. */
function cutIn(line: string): number {
  const said = /Kabel (\d) getrennt/.exec(line);
  if (said === null) {
    throw new Error(`"${line}" cuts nothing`);
  }
  return Number(said[1]);
}

describe('circuit manual', () => {
  it('prints the drawing, the device, the rules, the example and the penalty in order', () => {
    const def = defOf({ penaltySec: 25, burnoutSec: 75, shorts: 4 });
    const [section, ...more] = circuitModule.manual(def);
    expect(more).toEqual([]);
    expect(section?.heading).toBe('Sicherungskasten und Prüfpult');
    const blocks = section?.blocks ?? [];
    expect(blocks.map((block) => block.kind)).toEqual(['figure', 'p', 'rules', 'example', 'p']);
    expect(blocks[0]).toEqual({
      kind: 'figure',
      of: 'circuit',
      caption: 'Abb. 1 — Sicherungskasten und Prüfpult',
    });
    const device = blocks[1]?.kind === 'p' ? blocks[1].text : '';
    expect(device).toMatch(/^Pult A ist ein Sicherungskasten mit 4 bis 6 Kabeln, von oben /);
    expect(device).toMatch(/; Pult B ist ein Prüfpult, das die Spannung eines Kabels/);
    expect(device).toMatch(/ Nach jedem Schnitt verteilen sich die Spannungen neu\.$/);
    expect(blocks[2]).toEqual({
      kind: 'rules',
      items: [
        'Wenn die Laborkennung gerade endet, trenne jeweils das Kabel mit der höchsten ' +
          'gemessenen Spannung.',
        'Wenn die Laborkennung ungerade endet, trenne jeweils das Kabel mit der niedrigsten ' +
          'gemessenen Spannung über 0 V.',
        'Wenn ein Kabel 0 V zeigt, bleibt es ganz.',
        'Wenn ein Kabel getrennt wurde, gelten nur neue Messungen.',
        'Wenn kein Kabel mehr Spannung zeigt, ist der Kasten gesichert.',
      ],
    });
    expect(blocks.at(-1)).toEqual({
      kind: 'p',
      text:
        'Fehlgriff: Alarm, −25 s. Jeder Fehlgriff ist ein Kurzschluss: Der Kasten wird neu ' +
        'verdrahtet, alle Kabel sind wieder ganz, die Spannungen neu. Ab dem 4. Kurzschluss ' +
        'ist der Kasten durchgebrannt: −75 s je Fehlgriff.',
    });
  });

  it('counts the wires of the def, and hangs on the def alone', () => {
    const exactly = (def: CircuitDef) => blocksOf(def)[1];
    expect(exactly(defOf({ wires: { min: 5, max: 5 } }))).toMatchObject({
      text: expect.stringContaining('Sicherungskasten mit 5 Kabeln,'),
    });
    expect(exactly(defOf({ wires: { min: 4, max: 5 } }))).toMatchObject({
      text: expect.stringContaining('Sicherungskasten mit 4 bis 5 Kabeln,'),
    });
    const def = defOf();
    expect(circuitModule.manual(structuredClone(def))).toEqual(circuitModule.manual(def));
    expect(circuitModule.manual(defOf({ shorts: 2 }))).not.toEqual(circuitModule.manual(def));
  });

  it('works its example the way the station does: two rounds, highest voltage first', () => {
    const def = defOf();
    const boxes = blocksOf(def).filter((block): block is ExampleBlock => block.kind === 'example');
    expect(boxes).toHaveLength(1);
    const [seen, done, again, last] = boxes[0]?.lines ?? [];
    const digit = Number(/^Kennung endet auf (\d)\./.exec(seen ?? '')?.[1]);
    const first = measuredIn(seen ?? '');
    const second = measuredIn(again ?? '');
    expect(first.wires).toEqual([1, 2, 3, 4, 5]);
    expect(first.volts).toHaveLength(5);
    expect(done).toMatch(/^Kennung gerade, höchste Spannung: Kabel \d getrennt; /);
    expect(done).toMatch(/; Kabel \d bleibt mit 0 V ganz\.$/);
    expect(last).toMatch(/^Höchste Spannung nun \d+ V: Kabel \d getrennt\.$/);
    // The box the example shows: its first round as printed, the wire at 0 V dead;
    // in the second round the wire cut in the first no longer reads anything.
    const lab: Edgework = { ...EVEN, serial: `K7G3B-${digit}` };
    expect(serialLastDigitIsOdd(lab)).toBe(false);
    const dead = first.volts.map((v) => v === 0);
    const round2 = first.wires.map((wire) => second.volts[second.wires.indexOf(wire)] ?? 0);
    const dealt = deal(defOf({ wires: { min: 5, max: 5 } }), 1);
    const board: CircuitBoard = {
      colours: boardOf(dealt).colours,
      dead,
      rounds: [first.volts, round2, [12, 0, 24, 48, 230], [110, 0, 12, 24, 48]],
    };
    let state: CircuitState = { ...dealt, boards: [board, ...dealt.boards.slice(1)], board: 0 };
    // Round 1: the meter shows what the example saw; the rules name the wire it cut.
    state = probeAll(def, state);
    expect(state.readings).toEqual(first.volts);
    const [firstCut] = circuitModule.solve(def, views(def, state), lab);
    expect(firstCut).toEqual({ by: 'operator', input: { cut: cutIn(done ?? '') - 1 } });
    expect(Number(/Kabel (\d) bleibt/.exec(done ?? '')?.[1])).toBe(dead.indexOf(true) + 1);
    // The other lab would have cut elsewhere, and that cut is a short here.
    expect(circuitModule.solve(def, views(def, state), ODD)[0]).not.toEqual(firstCut);
    expect(cut(def, state, ruleSays(first.volts, true), lab).penalty).toBe('Kurzschluss');
    state = cut(def, state, cutIn(done ?? '') - 1, lab).state;
    // Round 2: measured anew, the wires still whole show what the example printed.
    const asked = circuitModule.solve(def, views(def, state), lab);
    expect(asked.map((move) => move.input)).toEqual(second.wires.map((w) => ({ probe: w - 1 })));
    for (const wire of second.wires) {
      state = probe(def, state, wire - 1).state;
    }
    expect(second.wires.map((w) => state.readings[w - 1])).toEqual(second.volts);
    expect(Number(/nun (\d+) V/.exec(last ?? '')?.[1])).toBe(Math.max(...second.volts));
    expect(circuitModule.solve(def, views(def, state), lab)).toEqual([
      { by: 'operator', input: { cut: cutIn(last ?? '') - 1 } },
    ]);
    expect(cut(def, state, cutIn(last ?? '') - 1, lab).penalty).toBeNull();
  });
});

/**
 * A corridor lab for a crew of three around the box: console a at (6,1),
 * console b at (13,1), the book between them, the sign at the west end.
 */
function circuitLab(): Mission {
  return parseMission({
    id: 'kastenlabor',
    title: 'Kastenlabor',
    players: { min: 3, max: 3 },
    story: { intro: 'i', win: 'w', lose: 'l' },
    timeLimitSec: 600,
    puzzles: [{ type: 'circuit', id: 'kasten', title: 'Notstrom-Kasten' }],
    map: {
      tiles: ['################', '#..............#', '#..............#', '################'],
      spawns: [
        { x: 1, y: 1 },
        { x: 1, y: 2 },
        { x: 2, y: 1 },
      ],
      stations: [
        { puzzleId: 'kasten', x: 6, y: 1, console: 'a' },
        { puzzleId: 'kasten', x: 13, y: 1, console: 'b' },
      ],
      manuals: [
        {
          id: 'buch',
          kind: 'book',
          label: 'HANDBUCH',
          puzzleIds: ['kasten'],
          spots: [{ x: 9, y: 2 }],
        },
      ],
      edgeworkSign: { x: 2, y: 2 },
      exit: { x: 14, y: 2 },
    },
  });
}

const CONSOLE_B = stationKey({ puzzleId: 'kasten', console: 'b' });

/** Anna (p1) at the box, Ben (p2) at the meter, Cleo (p3) at the book; Anna switches it on. */
function circuitRun(seed = 11, mission = circuitLab()): GameState {
  const here = standing(started(mission, seed), {
    stations: { kasten: ['p1'], [CONSOLE_B]: ['p2'] },
    manuals: { buch: ['p3'] },
    signSeen: ['p1', 'p2', 'p3'],
  });
  return applyAction(here, { type: 'interact', playerId: 'p1', at: T0 + 500 });
}

function circuitOf(state: GameState, playerId: string) {
  const puzzle = viewFor(state, playerId).puzzle;
  if (puzzle?.kind !== 'circuit') {
    throw new Error('expected the circuit station');
  }
  return puzzle;
}

const input = (playerId: string, move: CircuitInput, at = T0 + 1000): Action => ({
  type: 'puzzle-input',
  playerId,
  at,
  input: move,
});

/** The run's lab, which every player here has read off the sign. */
function labOf(state: GameState): Edgework {
  if (state.edgework === null) {
    throw new Error('expected a started run');
  }
  return state.edgework;
}

/** Probe every wire from Ben's meter, then cut a wire the rules do not name from Anna's box. */
function shortIt(state: GameState, at: number): GameState {
  const count = circuitOf(state, 'p2').count ?? 0;
  const measured = Array.from({ length: count }, (_, i) => input('p2', { probe: i }, at)).reduce(
    applyAction,
    state,
  );
  const volts = circuitOf(measured, 'p2').readings?.map((r) => r ?? 0) ?? [];
  const named = ruleSays(volts, serialLastDigitIsOdd(labOf(state)));
  return applyAction(measured, input('p1', { cut: besides(named, count) }, at));
}

describe('circuit in a run', () => {
  it('shows each console its own part over the wire, the book nothing of the box', () => {
    const state = circuitRun();
    expect(circuitOf(state, 'p1')).toMatchObject({ console: 'a', role: 'box', manual: null });
    expect(circuitOf(state, 'p2')).toMatchObject({ console: 'b', role: 'meter', manual: null });
    expect(circuitOf(state, 'p3')).toMatchObject({ console: null, role: null, wires: null });
    expect(circuitOf(state, 'p3').manual).toEqual(circuitModule.manual(defOf()));
    const wire = (playerId: string): string => JSON.stringify(viewFor(state, playerId));
    expect(wire('p1')).toContain('"colour"');
    expect(wire('p1')).not.toMatch(/"(readings|voltages|dead)":\[/);
    expect(wire('p2')).toMatch(/"readings":\[/);
    expect(wire('p2')).not.toMatch(/"(wires|voltages|dead)":\[|"colour"/);
    expect(wire('p3')).not.toMatch(/"(wires|readings|voltages|dead)":\[|"colour"/);
    const watched = viewForSpectator(state).puzzle;
    expect(watched).toMatchObject({ kind: 'circuit', role: null });
    expect(JSON.stringify(watched)).toMatch(/"voltages":\[.*"dead":\[/);
  });

  it('measures at the meter, cuts at the box, and turns away the rest without an alarm', () => {
    const state = circuitRun();
    expect(() => applyAction(state, input('p1', { probe: 0 }))).toThrow('Dieses Pult misst nicht.');
    expect(() => applyAction(state, input('p2', { cut: 0 }))).toThrow(
      'Dieses Pult schneidet nicht.',
    );
    expect(() => applyAction(state, input('p3', { cut: 0 }))).toThrow(GameError);
    const measured = applyAction(state, input('p2', { probe: 0 }));
    expect(circuitOf(measured, 'p2').readings?.[0]).toEqual(expect.any(Number));
    expect(circuitOf(measured, 'p1').wires).toEqual(circuitOf(state, 'p1').wires);
    expect(measured.penaltySeq).toBe(0);
    expect(measured.deadlineAt).toBe(state.deadlineAt);
  });

  it('refuses the solo walk without an alarm, and takes the cut once somebody measures', () => {
    const state = circuitRun();
    // Anna leaves the box for the meter and measures every wire; Ben and Cleo are at the book.
    const atMeter = standing(state, {
      stations: { [CONSOLE_B]: ['p1'] },
      manuals: { buch: ['p2', 'p3'] },
    });
    const count = circuitOf(atMeter, 'p1').count ?? 0;
    const measured = Array.from({ length: count }, (_, i) => input('p1', { probe: i })).reduce(
      applyAction,
      atMeter,
    );
    const volts = circuitOf(measured, 'p1').readings?.map((r) => r ?? 0) ?? [];
    const named = ruleSays(volts, serialLastDigitIsOdd(labOf(state)));
    // She walks back to the box and cuts the wire the rules name: nobody is at the meter now.
    const walked = standing(measured, {
      stations: { kasten: ['p1'] },
      manuals: { buch: ['p2', 'p3'] },
    });
    expect(circuitOf(walked, 'p1')).toMatchObject({ console: 'a', role: 'box' });
    expect(() => applyAction(walked, input('p1', { cut: named }))).toThrow(GameError);
    expect(() => applyAction(walked, input('p1', { cut: named }))).toThrow(
      'Am Prüfpult steht niemand.',
    );
    // Ben steps up to the meter: the same cut counts, and no alarm went off on the way.
    const manned = standing(walked, {
      stations: { kasten: ['p1'], [CONSOLE_B]: ['p2'] },
      manuals: { buch: ['p3'] },
    });
    const taken = applyAction(manned, input('p1', { cut: named }));
    expect(circuitOf(taken, 'p1').wires?.[named]?.cut).toBe(true);
    expect(taken.penaltySeq).toBe(0);
    expect(taken.deadlineAt).toBe(state.deadlineAt);
    expect(taken.credits['p1']?.alarms).toBe(0);
  });

  it('charges a short once, to whoever cut, and rewires the box', () => {
    const state = circuitRun();
    const shorted = shortIt(state, T0 + 1000);
    expect(shorted.penaltySeq).toBe(1);
    expect(shorted.deadlineAt).toBe((state.deadlineAt ?? 0) - 30_000);
    expect(shorted.credits['p1']?.alarms).toBe(1);
    expect(shorted.credits['p2']?.alarms).toBe(0);
    expect(shorted.events.at(-1)).toMatchObject({
      kind: 'penalty',
      label: 'Kurzschluss',
      seconds: 30,
    });
    expect(circuitOf(shorted, 'p2')).toMatchObject({ shorts: 1, lastResult: 'short' });
    expect(circuitOf(shorted, 'p2').readings?.every((r) => r === null)).toBe(true);
    expect(circuitOf(shorted, 'p1').wires?.every((w) => !w.cut)).toBe(true);
  });

  it('charges a burnt-out box its own price from the third short on, one alarm each', () => {
    let state = circuitRun();
    const start = state.deadlineAt ?? 0;
    for (let k = 1; k <= 4; k++) {
      state = shortIt(state, T0 + k * 1000);
    }
    expect(state.penaltySeq).toBe(4);
    expect(state.events.filter((e) => e.kind === 'penalty')).toMatchObject([
      { label: 'Kurzschluss', seconds: 30 },
      { label: 'Kurzschluss', seconds: 30 },
      { label: 'Kasten durchgebrannt', seconds: 60 },
      { label: 'Kasten durchgebrannt', seconds: 60 },
    ]);
    expect(state.deadlineAt).toBe(start - 180_000);
    expect(state.lastPenaltySec).toBe(60);
    expect(state.credits['p1']?.alarms).toBe(4);
    expect(circuitOf(state, 'p1')).toMatchObject({ shorts: 4, lastResult: 'burnout' });
    expect(circuitOf(state, 'p2')).toMatchObject({ shorts: 4, lastResult: 'burnout' });
  });

  it('scales a burnout with the difficulty, like every other penalty', () => {
    const priced = (difficulty: Difficulty) => {
      const [def] = scaleMission(circuitLab(), difficulty).puzzles;
      return def?.type === 'circuit' ? [def.penaltySec, def.burnoutSec] : [];
    };
    expect(priced('entspannt')).toEqual([18, 36]);
    expect(priced('normal')).toEqual([30, 60]);
    expect(priced('hart')).toEqual([42, 84]);
    // A hard run charges the scaled prices, the burnout's as well.
    let state = circuitRun(11, scaleMission(circuitLab(), 'hart'));
    for (let k = 1; k <= 3; k++) {
      state = shortIt(state, T0 + k * 1000);
    }
    const charged = state.events.filter((e) => e.kind === 'penalty').map((e) => e.seconds);
    expect(charged).toEqual([42, 42, 84]);
  });

  it('is solved by the solver from the clients’ views, with both consoles credited', () => {
    let state = circuitRun();
    for (let round = 1; state.currentPuzzleIndex === 0 && round < 100; round++) {
      const seen = {
        operator: circuitOf(state, 'p1'),
        partner: circuitOf(state, 'p2'),
        reader: circuitOf(state, 'p3'),
      };
      const moves = circuitModule.solve(defOf(), seen, viewFor(state, 'p1').edgework);
      state = moves
        .map((move) => input(move.by === 'partner' ? 'p2' : 'p1', move.input, T0 + round * 1000))
        .reduce(applyAction, state);
    }
    expect(state.currentPuzzleIndex).toBe(1);
    expect(state.penaltySeq).toBe(0);
    expect(state.events.some((e) => e.label === 'Notstrom-Kasten gelöst')).toBe(true);
    expect(state.credits['p1']?.operated).toBe(1);
    expect(state.credits['p2']?.operated).toBe(1);
  });
});

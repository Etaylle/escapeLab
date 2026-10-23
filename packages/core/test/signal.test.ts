import { describe, expect, it } from 'vitest';
import {
  applyAction,
  GameError,
  generateEdgework,
  stationKey,
  TOKENS,
  tokenLabel,
  viewFor,
  viewForSpectator,
} from '../src/index.js';
import type {
  Action,
  ConsoleId,
  GameState,
  ManualBlock,
  Mission,
  PuzzleContext,
  SignalToken,
  Viewer,
} from '../src/index.js';
import { WORKSHOP } from '../src/puzzles/printed.js';
import { LEGEND, PATTERN_FIGURE, SIGNAL_PATTERNS, signalModule } from '../src/puzzles/signal.js';
import type {
  LegendRow,
  SignalDef,
  SignalKey,
  SignalState,
  SignalView,
} from '../src/puzzles/signal.js';
import { mulberry32 } from '../src/rng.js';
import {
  AT_BOOK,
  AT_CONSOLE_B,
  AT_STATION,
  AUDIENCE,
  ELSEWHERE,
  consoleLab,
  standing,
  started,
  T0,
} from './lab.js';
import { playInstance } from './solveModule.js';

const SEEDS = 300;
const CREW = ['op', 'pt', 'rd'];
const edgework = generateEdgework(mulberry32(1));
const viewCtx = { edgework, alarms: 0, crew: CREW, operators: ['op', 'pt'] };

function defOf(fields: Partial<SignalDef> = {}): SignalDef {
  return signalModule.defSchema.parse({
    type: 'signal',
    id: 'kette',
    title: 'Signalkette',
    ...fields,
  });
}

type AtConsoles = PuzzleContext['atConsoles'];

/** Both consoles manned: op at console a, pt at console b. */
const MANNED: AtConsoles = { a: ['op'], b: ['pt'] };

/** What a move from console `from` gets to know, with who stands where; null for the setup. */
const ctx = (from: ConsoleId | null, atConsoles = MANNED): PuzzleContext => ({
  edgework,
  alarms: 0,
  remainingSec: 600,
  at: T0,
  crew: CREW,
  console: from,
  atConsoles,
  readers: [],
});

const deal = (def: SignalDef, seed: number): SignalState =>
  signalModule.init(def, mulberry32(seed), ctx(null));

/**
 * An input at console `from` — by op at console a, by pt at console b —
 * through the input schema as a client's would go.
 */
function send(
  def: SignalDef,
  state: SignalState,
  input: unknown,
  from: ConsoleId | null,
  atConsoles = MANNED,
) {
  const parsed = signalModule.inputSchema.parse(input);
  return signalModule.apply(def, state, parsed, from === 'b' ? 'pt' : 'op', ctx(from, atConsoles));
}

/** A press of the sign's own key, at a console without the legend. */
const press = (
  def: SignalDef,
  state: SignalState,
  token: SignalToken,
  from: ConsoleId | null,
  atConsoles = MANNED,
) => send(def, state, { press: token }, from, atConsoles);

/** A press of a key of shapes, at a console with the legend. */
const pressKey = (
  def: SignalDef,
  state: SignalState,
  key: SignalKey,
  from: ConsoleId | null,
  atConsoles = MANNED,
) => send(def, state, { key }, from, atConsoles);

const seenFrom = (def: SignalDef, state: SignalState, viewer: Viewer): SignalView =>
  signalModule.view(def, state, viewer, viewCtx);

/** The crew's views: console a, console b, the book. */
const viewsOf = (def: SignalDef, state: SignalState) => ({
  operator: seenFrom(def, state, AT_STATION),
  partner: seenFrom(def, state, AT_CONSOLE_B),
  reader: seenFrom(def, state, AT_BOOK),
});

/** The sequence the receiving console has to press now, as the sending console shows it. */
function shownSequence(def: SignalDef, state: SignalState): SignalToken[] {
  const sender = [AT_STATION, AT_CONSOLE_B]
    .map((viewer) => seenFrom(def, state, viewer))
    .find((view) => view.role === 'sender');
  if (sender === undefined || sender.sequence === null) {
    throw new Error('expected the sending console to show the sequence');
  }
  return sender.sequence;
}

/** The coloured keys of both consoles, as a def without the legend deals them. */
function gridsOf(state: SignalState): Record<ConsoleId, SignalToken[]> {
  if (state.grids === null) {
    throw new Error('expected the coloured keys of a station without the legend');
  }
  return state.grids;
}

/** The other console. */
const across = (side: ConsoleId): ConsoleId => (side === 'a' ? 'b' : 'a');

/** A sign that is not `token`. */
const besides = (token: SignalToken | undefined): SignalToken =>
  TOKENS.find((other) => other !== token) ?? 'rot-kreis';

const ROWS: readonly LegendRow[] = [1, 2, 3, 4];
type Shape = SignalKey['shape'];
const SHAPES: readonly Shape[] = ['kreis', 'dreieck', 'quadrat'];

/** A console's keys with the legend: 4 rows of the three shapes, row 1 first. */
const ROW_KEYS: SignalKey[] = ROWS.flatMap((row) => SHAPES.map((shape) => ({ row, shape })));

/** A sign's colour and shape, read off its id: „rot-dreieck" is red and a triangle. */
function partsOf(token: SignalToken): [string, Shape] {
  const [colour = '', shape = 'kreis'] = token.split('-') as [string, Shape];
  return [colour, shape];
}

/** The key that stands for `token` at console `side`, looked up in the module's legend. */
function keyAt(token: SignalToken, side: ConsoleId): SignalKey {
  const [colour, shape] = partsOf(token);
  const row = ROWS.find((r) => LEGEND[side][r] === colour);
  if (row === undefined) {
    throw new Error(`no row of console ${side} stands for ${colour}`);
  }
  return { row, shape };
}

/** The stage under way, pressed in full at the receiving console as the solver says. */
function stageThrough(def: SignalDef, state: SignalState): SignalState {
  let now = state;
  for (const { by, input } of signalModule.solve(def, viewsOf(def, now), null)) {
    const result = send(def, now, input, by === 'partner' ? 'b' : 'a');
    expect(result.penalty).toBeNull();
    now = result.state;
  }
  return now;
}

/** Any colour word, as an id or as printed. */
const COLOUR_WORD = /rot|blau|gr(ü|ue)n|gelb/i;

describe('the signs', () => {
  it('are twelve, every colour in every shape, each said as players say it', () => {
    expect(TOKENS).toHaveLength(12);
    expect(new Set(TOKENS).size).toBe(12);
    for (const token of TOKENS) {
      expect(token).toMatch(/^(rot|blau|gruen|gelb)-(kreis|dreieck|quadrat)$/);
    }
    expect(tokenLabel('rot-dreieck')).toBe('rotes Dreieck');
    expect(tokenLabel('blau-kreis')).toBe('blauer Kreis');
    expect(tokenLabel('gruen-quadrat')).toBe('grünes Quadrat');
    expect(tokenLabel('gelb-kreis')).toBe('gelber Kreis');
    expect(new Set(TOKENS.map(tokenLabel)).size).toBe(12);
  });
});

describe('the legend', () => {
  it('gives every console each colour in one row, and no row the same colour at both', () => {
    for (const side of ['a', 'b'] as const) {
      const colours = ROWS.map((row) => LEGEND[side][row]);
      expect([...colours].sort()).toEqual(['blau', 'gelb', 'gruen', 'rot']);
    }
    expect(ROWS.filter((row) => LEGEND.a[row] === LEGEND.b[row])).toEqual([]);
  });

  it('turns each sign into one key at either console, and back', () => {
    for (const side of ['a', 'b'] as const) {
      const keys = TOKENS.map((token) => keyAt(token, side));
      expect(new Set(keys.map(({ row, shape }) => `${row} ${shape}`)).size).toBe(12);
      expect(keys.map(({ row, shape }) => `${LEGEND[side][row]}-${shape}`)).toEqual(TOKENS);
    }
  });
});

describe('signal setup', () => {
  it('takes 4 stages of 4 signs and 20 s by default, 2–6 stages of 3–6 signs at most', () => {
    expect(defOf()).toMatchObject({ stages: 4, length: 4, penaltySec: 20 });
    for (const fields of [{ stages: 1 }, { stages: 7 }, { length: 2 }, { length: 7 }]) {
      expect(() => defOf(fields), JSON.stringify(fields)).toThrow();
    }
    expect(defOf({ stages: 6, length: 3 })).toMatchObject({ stages: 6, length: 3 });
  });

  it('has no legend and no fleeting display by default, either on request', () => {
    expect(defOf()).toMatchObject({ legend: false, fleetingFrom: null });
    expect(defOf({ legend: true, fleetingFrom: 4 })).toMatchObject({
      legend: true,
      fleetingFrom: 4,
    });
    expect(defOf({ stages: 6, fleetingFrom: 1 }).fleetingFrom).toBe(1);
    expect(defOf({ stages: 6, fleetingFrom: 6 }).fleetingFrom).toBe(6);
  });

  it('turns a fleeting display down that starts nowhere or after the last stage', () => {
    const parsed = (fields: object) =>
      signalModule.defSchema.safeParse({ type: 'signal', id: 'kette', title: 'T', ...fields });
    for (const fields of [
      { fleetingFrom: 0 },
      { fleetingFrom: 2.5 },
      { fleetingFrom: '2' },
      { legend: 'ja' },
      { legend: 1 },
    ]) {
      expect(parsed(fields).success, JSON.stringify(fields)).toBe(false);
    }
    const late = parsed({ stages: 3, fleetingFrom: 4 });
    expect(late.success).toBe(false);
    expect(late.error?.issues.map((issue) => [issue.path, issue.message])).toEqual([
      [
        ['fleetingFrom'],
        'puzzle "kette": fleetingFrom (4) is past the last stage (3), so no stage would show ' +
          'its signs one at a time — lower it, or set it to null',
      ],
    ]);
  });

  it('lays all twelve keys out at each console, no sign in the same place at both', () => {
    const sorted = [...TOKENS].sort();
    for (let seed = 0; seed < SEEDS; seed++) {
      const grids = gridsOf(deal(defOf(), seed));
      expect([...grids.a].sort(), `seed ${seed}`).toEqual(sorted);
      expect([...grids.b].sort(), `seed ${seed}`).toEqual(sorted);
      expect(
        grids.a.every((token, i) => grids.b[i] !== token),
        `seed ${seed}`,
      ).toBe(true);
    }
  });

  it('deals no coloured keys with the legend: both consoles have the same rows of shapes', () => {
    for (let seed = 0; seed < 20; seed++) {
      expect(deal(defOf({ legend: true }), seed).grids).toBeNull();
    }
  });

  it('draws a sequence per stage, never the same sign twice in a row, the same for a seed', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const def = defOf({ stages: 2 + (seed % 5), length: 3 + (seed % 4), legend: seed % 2 === 0 });
      const { sequences } = deal(def, seed);
      expect(deal(def, seed).sequences).toEqual(sequences);
      expect(sequences).toHaveLength(def.stages);
      for (const sequence of sequences) {
        expect(sequence).toHaveLength(def.length);
        expect(sequence.every((token, i) => token !== sequence[i - 1])).toBe(true);
        seen.add(sequence.join(' '));
      }
    }
    expect(seen.size).toBeGreaterThan(SEEDS);
  });

  it('starts at stage 1 with console a sending', () => {
    const view = seenFrom(defOf(), deal(defOf(), 1), AT_STATION);
    expect(view).toMatchObject({
      kind: 'signal',
      stage: 1,
      stages: 4,
      length: 4,
      done: 0,
      lastResult: null,
      role: 'sender',
      sends: 'a',
      fleeting: false,
    });
  });
});

describe('signal views', () => {
  it('show the sequence at the sending console only, and each console its own keys', () => {
    const def = defOf();
    for (let seed = 0; seed < 50; seed++) {
      const state = deal(def, seed);
      const grids = gridsOf(state);
      const sequence = state.sequences[0] ?? [];
      const atA = seenFrom(def, state, AT_STATION);
      const atB = seenFrom(def, state, AT_CONSOLE_B);
      expect(atA).toMatchObject({ role: 'sender', sequence, grid: grids.a, grids: null });
      expect(atB).toMatchObject({ role: 'receiver', sequence: null, grid: grids.b });
      expect(atB.grids).toBeNull();
      for (const view of [atA, atB]) {
        expect(view.keys).toBeNull();
      }
      for (const away of [AT_BOOK, ELSEWHERE]) {
        expect(seenFrom(def, state, away)).toMatchObject({
          role: null,
          sequence: null,
          grid: null,
          grids: null,
          keys: null,
        });
      }
      const wire = (viewer: Viewer): string => JSON.stringify(seenFrom(def, state, viewer));
      for (const viewer of [AT_CONSOLE_B, AT_BOOK, ELSEWHERE]) {
        expect(wire(viewer)).not.toContain(JSON.stringify(sequence));
        expect(wire(viewer)).not.toContain('"sequence":[');
      }
      // Nobody but the audience sees the other console's keys.
      expect(wire(AT_STATION)).not.toContain(JSON.stringify(grids.b));
      expect(wire(AT_CONSOLE_B)).not.toContain(JSON.stringify(grids.a));
      for (const viewer of [AT_BOOK, ELSEWHERE]) {
        expect(wire(viewer)).not.toContain(JSON.stringify(grids.a));
        expect(wire(viewer)).not.toContain(JSON.stringify(grids.b));
      }
    }
  });

  it('show the audience both consoles and the sequence, from neither console', () => {
    const def = defOf();
    const state = deal(def, 5);
    expect(seenFrom(def, state, AUDIENCE)).toMatchObject({
      role: null,
      sequence: state.sequences[0],
      grid: null,
      grids: state.grids,
      keys: null,
    });
  });

  it('give the receiving console rows of shapes and not one colour, stage after stage', () => {
    const def = defOf({ legend: true });
    for (let seed = 0; seed < 50; seed++) {
      let state = deal(def, seed);
      for (let stage = 1; stage <= def.stages; stage++) {
        const [sender, receiver] =
          stage % 2 === 1 ? [AT_STATION, AT_CONSOLE_B] : [AT_CONSOLE_B, AT_STATION];
        const taking = seenFrom(def, state, receiver);
        expect(taking).toMatchObject({
          stage,
          role: 'receiver',
          sequence: null,
          grid: null,
          grids: null,
          keys: ROW_KEYS,
        });
        expect(JSON.stringify(taking), `seed ${seed}, stage ${stage}`).not.toMatch(COLOUR_WORD);
        // The sending console still shows coloured signs.
        expect(seenFrom(def, state, sender)).toMatchObject({
          role: 'sender',
          sequence: state.sequences[stage - 1],
          grid: null,
          grids: null,
          keys: ROW_KEYS,
        });
        state = stageThrough(def, state);
      }
    }
  });

  it('show the legend’s keys to the audience too, and nothing of the station away from it', () => {
    const def = defOf({ legend: true });
    const state = deal(def, 5);
    expect(seenFrom(def, state, AUDIENCE)).toMatchObject({
      role: null,
      sequence: state.sequences[0],
      grid: null,
      grids: null,
      keys: ROW_KEYS,
    });
    for (const away of [AT_BOOK, ELSEWHERE]) {
      expect(seenFrom(def, state, away)).toMatchObject({
        role: null,
        sequence: null,
        grid: null,
        grids: null,
        keys: null,
      });
    }
  });

  it('say from which stage on the sending console shows one sign at a time, to everyone', () => {
    for (const fleetingFrom of [null, 1, 3, 5]) {
      const def = defOf({ stages: 5, length: 3, fleetingFrom });
      let state = deal(def, 4);
      for (let stage = 1; stage <= def.stages; stage++) {
        const fleeting = fleetingFrom !== null && stage >= fleetingFrom;
        for (const viewer of [AT_STATION, AT_CONSOLE_B, AT_BOOK, ELSEWHERE, AUDIENCE]) {
          const view = seenFrom(def, state, viewer);
          expect(view, `from ${fleetingFrom}, stage ${stage}`).toMatchObject({ stage, fleeting });
        }
        state = stageThrough(def, state);
      }
    }
  });

  it('swap sides with every stage, all the way through', () => {
    const def = defOf({ stages: 6, length: 3 });
    let state = deal(def, 9);
    for (let stage = 1; stage <= def.stages; stage++) {
      const sends: ConsoleId = stage % 2 === 1 ? 'a' : 'b';
      const atA = seenFrom(def, state, AT_STATION);
      const atB = seenFrom(def, state, AT_CONSOLE_B);
      expect(atA).toMatchObject({ stage, sends });
      expect(atB).toMatchObject({ stage, sends });
      expect(atA.role).toBe(sends === 'a' ? 'sender' : 'receiver');
      expect(atB.role).toBe(sends === 'b' ? 'sender' : 'receiver');
      const sequence = shownSequence(def, state);
      expect(sequence).toEqual(state.sequences[stage - 1]);
      for (const [i, token] of sequence.entries()) {
        const result = press(def, state, token, across(sends));
        expect(result.penalty).toBeNull();
        expect(result.solved).toBe(stage === def.stages && i === sequence.length - 1);
        state = result.state;
      }
    }
  });
});

describe('signal presses', () => {
  it('are refused at the sending console without an alarm, whatever the sign', () => {
    const def = defOf();
    const state = deal(def, 2);
    const right = state.sequences[0]?.[0];
    for (const token of [right ?? 'rot-kreis', besides(right)]) {
      expect(() => press(def, state, token, 'a')).toThrow(GameError);
      expect(() => press(def, state, token, 'a')).toThrow(
        'Dieses Pult sendet — das andere gibt ein.',
      );
    }
    // From stage 2 on console b sends, and it is console b that is refused.
    const second = { ...state, stage: 1 };
    expect(() => press(def, second, second.sequences[1]?.[0] ?? 'rot-kreis', 'b')).toThrow(
      'Dieses Pult sendet — das andere gibt ein.',
    );
    // With the legend as well.
    const legend = defOf({ legend: true });
    const rows = deal(legend, 2);
    const key = keyAt(rows.sequences[0]?.[0] ?? 'rot-kreis', 'a');
    expect(() => pressKey(legend, rows, key, 'a')).toThrow(
      'Dieses Pult sendet — das andere gibt ein.',
    );
  });

  it('are refused from nobody at a console', () => {
    const def = defOf();
    const state = deal(def, 2);
    expect(() => press(def, state, state.sequences[0]?.[0] ?? 'rot-kreis', null)).toThrow(
      'Dafür musst du am Pult stehen.',
    );
  });

  it('are refused, without an alarm, at the receiving console with nobody else sending', () => {
    const def = defOf();
    const state = deal(def, 3);
    const right = state.sequences[0]?.[0] ?? 'rot-kreis';
    // The solo walk: pt read the sequence at console a and walked over to b.
    // Counted at both consoles at once is still nobody else at a.
    for (const alone of [{ a: [], b: ['pt'] }, { a: ['pt'], b: ['pt'] }]) {
      expect(() => press(def, state, right, 'b', alone), JSON.stringify(alone)).toThrow(GameError);
      expect(() => press(def, state, right, 'b', alone)).toThrow(
        'Am sendenden Pult steht niemand.',
      );
    }
    // From stage 2 on console b sends, and it is console b that needs somebody.
    const second = { ...state, stage: 1 };
    const next = second.sequences[1]?.[0] ?? 'rot-kreis';
    expect(() => press(def, second, next, 'a', { a: ['op'], b: [] })).toThrow(
      'Am sendenden Pult steht niemand.',
    );
    expect(press(def, second, next, 'a').state).toMatchObject({ stage: 1, done: 1 });
  });

  it('are taken at the receiving console while somebody else stands at the sending one', () => {
    const def = defOf();
    const state = deal(def, 3);
    const right = state.sequences[0]?.[0] ?? 'rot-kreis';
    for (const manned of [MANNED, { a: ['rd', 'op'], b: ['pt', 'x'] }]) {
      const taken = press(def, state, right, 'b', manned);
      expect(taken.penalty).toBeNull();
      expect(taken.state).toMatchObject({ stage: 0, done: 1, lastResult: null });
    }
  });

  it('take a wrong sign as one alarm and start the stage again, sequence and stage kept', () => {
    const def = defOf();
    let state = deal(def, 4);
    const sequence = state.sequences[0] ?? [];
    for (const token of sequence.slice(0, 2)) {
      state = press(def, state, token, 'b').state;
    }
    expect(state).toMatchObject({ stage: 0, done: 2, lastResult: null });
    const slip = press(def, state, besides(sequence[2]), 'b');
    expect(slip.penalty).toBe('Signalkette: falsches Zeichen');
    expect(slip.solved).toBe(false);
    expect(slip.state).toMatchObject({ stage: 0, done: 0, lastResult: 'wrong' });
    expect(slip.state.sequences).toEqual(state.sequences);
    for (const viewer of [AT_STATION, AT_CONSOLE_B, AT_BOOK]) {
      expect(seenFrom(def, slip.state, viewer)).toMatchObject({ done: 0, lastResult: 'wrong' });
    }
    const again = press(def, slip.state, sequence[0] ?? 'rot-kreis', 'b');
    expect(again.penalty).toBeNull();
    expect(again.state).toMatchObject({ stage: 0, done: 1, lastResult: null });
  });

  it('throw on a stage without a sequence, or once the chain is closed', () => {
    const def = defOf();
    const state = deal(def, 3);
    const lost = { ...state, stage: 1, sequences: state.sequences.slice(0, 1) };
    const missing = 'signal: no sequence for stage 2 of 1';
    expect(() => press(def, lost, 'rot-kreis', 'a')).toThrow(missing);
    expect(() => seenFrom(def, lost, AT_STATION)).toThrow(missing);
    // The last stage pressed in full: the reducer has moved on, nothing may press here.
    const last = def.stages - 1;
    const closed = { ...state, stage: last, done: def.length };
    expect(() => press(def, closed, 'rot-kreis', last % 2 === 0 ? 'b' : 'a')).toThrow(
      `signal: stage ${def.stages} is pressed in full — the chain is closed`,
    );
  });

  it('take nothing but one of the twelve signs, or a row from 1 to 4 and a shape', () => {
    for (const input of [
      { press: 'lila-kreis' },
      { press: 'rot-Kreis' },
      { press: 'rotes Dreieck' },
      { press: 'rot-kreis', twice: true },
      {},
      { wireId: 'w1' },
      { key: { row: 0, shape: 'kreis' } },
      { key: { row: 5, shape: 'kreis' } },
      { key: { row: 1.5, shape: 'kreis' } },
      { key: { row: '1', shape: 'kreis' } },
      { key: { row: 1, shape: 'stern' } },
      { key: { row: 1 } },
      { key: { row: 1, shape: 'kreis', colour: 'rot' } },
      { key: { row: 1, shape: 'kreis' }, press: 'rot-kreis' },
      { key: 'rot-kreis' },
    ]) {
      expect(signalModule.inputSchema.safeParse(input).success, JSON.stringify(input)).toBe(false);
    }
    for (const token of TOKENS) {
      expect(signalModule.inputSchema.parse({ press: token })).toEqual({ press: token });
    }
    for (const key of ROW_KEYS) {
      expect(signalModule.inputSchema.parse({ key })).toEqual({ key });
    }
  });

  it('turn away, without an alarm, a kind of key the console does not have', () => {
    const legend = defOf({ legend: true });
    const rows = deal(legend, 3);
    const right = rows.sequences[0]?.[0] ?? 'rot-kreis';
    // A sign's own key at a console of rows of shapes, even the right sign.
    expect(() => press(legend, rows, right, 'b')).toThrow(GameError);
    expect(() => press(legend, rows, right, 'b')).toThrow(
      'Diese Taste gibt es an diesem Pult nicht.',
    );
    // A key of shapes at a console of coloured keys.
    const plain = defOf();
    const signs = deal(plain, 3);
    for (const key of ROW_KEYS) {
      expect(() => pressKey(plain, signs, key, 'b')).toThrow(
        'Diese Taste gibt es an diesem Pult nicht.',
      );
    }
  });

  it('read a key of shapes through the receiving console’s row of the legend', () => {
    const def = defOf({ legend: true });
    const dealt = deal(def, 8);
    for (const receives of ['a', 'b'] as const) {
      for (const token of TOKENS) {
        // Stage 1 is taken at console b, stage 2 at console a; the stage starts on `token`.
        const stage = receives === 'b' ? 0 : 1;
        const sequences = dealt.sequences.map((sequence) => [token, ...sequence.slice(1)]);
        const state: SignalState = { ...dealt, stage, sequences };
        const right = keyAt(token, receives);
        const taken = pressKey(def, state, right, receives);
        expect(taken.penalty, `${token} at ${receives}`).toBeNull();
        expect(taken.state).toMatchObject({ stage, done: 1, lastResult: null });
        // The same shape in any other row is another colour: an alarm.
        for (const row of ROWS.filter((r) => r !== right.row)) {
          const slip = pressKey(def, state, { row, shape: right.shape }, receives);
          expect(slip.penalty).toBe('Signalkette: falsches Zeichen');
          expect(slip.state).toMatchObject({ stage, done: 0, lastResult: 'wrong' });
        }
        // The other console's row for the colour is the wrong one.
        const elsewhere = keyAt(token, across(receives));
        expect(pressKey(def, state, elsewhere, receives).penalty).toBe(
          'Signalkette: falsches Zeichen',
        );
      }
    }
  });
});

describe('signal solver', () => {
  it.each([
    { legend: false, fleeting: false },
    { legend: true, fleeting: false },
    { legend: false, fleeting: true },
    { legend: true, fleeting: true },
  ])(
    `solves ${SEEDS} instances from the consoles' views, legend $legend, fleeting $fleeting`,
    ({ legend, fleeting }) => {
      // The harness hands the edgework only to modules that read it.
      expect(signalModule.usesEdgework).toBe(false);
      for (let seed = 0; seed < SEEDS; seed++) {
        const stages = 2 + (seed % 5);
        const fleetingFrom = fleeting ? 1 + (seed % stages) : null;
        const def = defOf({ stages, length: 3 + (seed % 4), legend, fleetingFrom });
        expect(playInstance(def, seed), `seed ${seed}`).toBe(def.stages * def.length);
      }
    },
  );

  it('presses at the receiving console what is left of the stage', () => {
    const def = defOf();
    let state = deal(def, 6);
    const first = state.sequences[0] ?? [];
    expect(signalModule.solve(def, viewsOf(def, state), null)).toEqual(
      first.map((token) => ({ by: 'partner', input: { press: token } })),
    );
    state = press(def, state, first[0] ?? 'rot-kreis', 'b').state;
    expect(signalModule.solve(def, viewsOf(def, state), null)).toEqual(
      first.slice(1).map((token) => ({ by: 'partner', input: { press: token } })),
    );
    const second = { ...state, stage: 1, done: 0 };
    expect(signalModule.solve(def, viewsOf(def, second), null)).toEqual(
      (second.sequences[1] ?? []).map((token) => ({ by: 'operator', input: { press: token } })),
    );
  });

  it('presses the keys the legend gives the receiving console, with the legend', () => {
    const def = defOf({ legend: true });
    let state = deal(def, 6);
    const first = state.sequences[0] ?? [];
    expect(signalModule.solve(def, viewsOf(def, state), null)).toEqual(
      first.map((token) => ({ by: 'partner', input: { key: keyAt(token, 'b') } })),
    );
    state = pressKey(def, state, keyAt(first[0] ?? 'rot-kreis', 'b'), 'b').state;
    expect(signalModule.solve(def, viewsOf(def, state), null)).toEqual(
      first.slice(1).map((token) => ({ by: 'partner', input: { key: keyAt(token, 'b') } })),
    );
    const second = { ...state, stage: 1, done: 0 };
    expect(signalModule.solve(def, viewsOf(def, second), null)).toEqual(
      (second.sequences[1] ?? []).map((token) => ({
        by: 'operator',
        input: { key: keyAt(token, 'a') },
      })),
    );
  });

  it('has no move when no view shows the sequence', () => {
    for (const def of [defOf(), defOf({ legend: true })]) {
      const reader = seenFrom(def, deal(def, 6), AT_BOOK);
      expect(signalModule.solve(def, { operator: reader, reader }, null)).toEqual([]);
    }
  });
});

type ExampleBlock = Extract<ManualBlock, { kind: 'example' }>;
type TableBlock = Extract<ManualBlock, { kind: 'table' }>;

/** The log's lines; the page prints exactly one log. */
function logOf(def: SignalDef): string[] {
  const boxes = signalModule
    .manual(def)
    .flatMap((section) => section.blocks)
    .filter((block): block is ExampleBlock => block.kind === 'example');
  expect(boxes).toHaveLength(1);
  return boxes[0]?.lines ?? [];
}

/** The running text of the section under `heading`, paragraph by paragraph. */
const paragraphsUnder = (def: SignalDef, heading: string): string[] =>
  (signalModule.manual(def).find((section) => section.heading === heading)?.blocks ?? []).flatMap(
    (block) => (block.kind === 'p' ? [block.text] : []),
  );

/** The table of the section „Legende"; the page has one with the legend. */
function legendOf(def: SignalDef): TableBlock {
  const section = signalModule.manual(def).find(({ heading }) => heading === 'Legende');
  const tables = (section?.blocks ?? []).filter(
    (block): block is TableBlock => block.kind === 'table',
  );
  const [table, ...more] = tables;
  if (table === undefined || more.length > 0) {
    throw new Error(`expected one table under „Legende", got ${tables.length}`);
  }
  return table;
}

/** The signs a line lists after its colon, read back the way a player would. */
function signsIn(line: string): SignalToken[] {
  const listed = line.slice(line.indexOf(':', 6) + 1).replace(/\.$/, '');
  return listed.split(',').map((label) => {
    const token = TOKENS.find((t) => tokenLabel(t) === label.trim());
    if (token === undefined) {
      throw new Error(`"${label.trim()}" is not a sign`);
    }
    return token;
  });
}

/** A colour as the legend prints it, back to the sign's colour. */
const PRINTED_COLOURS: Record<string, string> = {
  rot: 'rot',
  blau: 'blau',
  grün: 'gruen',
  gelb: 'gelb',
};

/** A pattern as the legend prints it, back to the pattern the consoles draw. */
const PRINTED_PATTERNS: Record<string, string> = {
  glatt: 'plain',
  Punkte: 'dots',
  Streifen: 'stripes',
  Ring: 'ring',
};

/** The legend's colour columns, each with the console it is printed for; its pattern follows. */
const COLOUR_COLUMNS = [
  [1, 'a'],
  [3, 'b'],
] as const;

/** A shape as the page names it, back to the key's shape. */
const PRINTED_SHAPES: Record<string, Shape> = {
  Kreis: 'kreis',
  Dreieck: 'dreieck',
  Quadrat: 'quadrat',
};

/** One key as the page names it, „Dreieck in Zeile 3", read back. */
function keyNamed(name: string): SignalKey {
  const [, noun = '', row = ''] = /^(\S+) in Zeile ([1-4])$/.exec(name.trim()) ?? [];
  const shape = PRINTED_SHAPES[noun];
  if (shape === undefined) {
    throw new Error(`"${name.trim()}" is no key of shapes`);
  }
  return { row: Number(row) as LegendRow, shape };
}

/** The keys a line lists after its colon. */
const keysIn = (line: string): SignalKey[] =>
  line
    .slice(line.indexOf(':', 6) + 1)
    .replace(/\.$/, '')
    .split(',')
    .map(keyNamed);

describe('signal manual: the document', () => {
  it('prints its document: the plate, Zweck, Aufbau, Betrieb, the log and the workshop', () => {
    const def = defOf({ stages: 5, length: 3, penaltySec: 25 });
    const manual = signalModule.manual(def);
    expect(manual.map(({ heading }) => heading)).toEqual([
      'Signalkette, Typ SK-4 (Baujahr 1986)',
      'Aufbau',
      'Betrieb',
      'Aus der Werkstatt',
    ]);
    expect(manual.map(({ blocks }) => blocks.map((block) => block.kind))).toEqual([
      ['p'],
      ['figure', 'p'],
      ['p', 'example'],
      ['p', 'p'],
    ]);
    expect(manual[1]?.blocks[0]).toEqual({
      kind: 'figure',
      of: 'signal',
      caption: 'Abb. 1 — Zwei Signalpulte',
    });
    const [purpose] = paragraphsUnder(def, 'Signalkette, Typ SK-4 (Baujahr 1986)');
    expect(purpose).toContain('Seit dem Umbau hängt das Flurschott an der Kette.');
    const [build] = paragraphsUnder(def, 'Aufbau');
    expect(build).toContain('zwölf Tasten, eine für jedes Zeichen');
    const [operation] = paragraphsUnder(def, 'Betrieb');
    expect(operation).toMatch(/^Die Kette hat fünf Stufen; .* eine Folge von drei Zeichen, /);
    expect(operation).toContain('jedes auf seiner Taste');
    expect(operation).toContain('Fehlquittierung: Die Stufe fällt in die Grundstellung');
    expect(operation).toContain('zieht 25 Sekunden Einsatzzeit ab.');
    expect(JSON.stringify(manual)).not.toMatch(/Legende|nacheinander/);
  });

  it('with the legend: rows of shapes at both consoles, the legend in a section of its own', () => {
    const def = defOf({ stages: 5, length: 3, penaltySec: 25, legend: true });
    const manual = signalModule.manual(def);
    expect(manual.map(({ heading }) => heading)).toEqual([
      'Signalkette, Typ SK-4 (Baujahr 1986)',
      'Aufbau',
      'Betrieb',
      'Legende',
      'Aus der Werkstatt',
    ]);
    const legend = manual[3]?.blocks ?? [];
    expect(legend.map((block) => block.kind)).toEqual(['figure', 'table', 'example']);
    expect(legend[0]).toEqual({
      kind: 'figure',
      of: PATTERN_FIGURE,
      caption: 'Abb. 2 — Farben und Muster',
    });
    const [build] = paragraphsUnder(def, 'Aufbau');
    expect(build).toContain(
      'zwölf grauen Tasten in vier nummerierten Zeilen, je Kreis, Dreieck und Quadrat',
    );
    expect(build).toContain('A und B haben verschiedene, ein alter Verwechslungsschutz.');
    const [operation] = paragraphsUnder(def, 'Betrieb');
    expect(operation).toContain(
      'jedes mit der Taste gleicher Form in der Zeile, die seine Legende der Farbe gibt',
    );
  });

});

describe('signal manual: the legend', () => {
  it('prints the legend the consoles press by, row for row', () => {
    const table = legendOf(defOf({ legend: true }));
    expect(table.head).toEqual(['Zeile', 'Pult A', 'Muster', 'Pult B', 'Muster']);
    expect(table.rows.map(([row]) => row)).toEqual(['1', '2', '3', '4']);
    for (const [column, side] of COLOUR_COLUMNS) {
      const printed = table.rows.map((cells) => PRINTED_COLOURS[cells[column] ?? '']);
      expect(printed, `Pult ${side.toUpperCase()}`).toEqual(ROWS.map((row) => LEGEND[side][row]));
    }
    // Each printed row is the row whose keys the console takes for that colour.
    const def = defOf({ legend: true });
    const dealt = deal(def, 2);
    for (const [column, side] of COLOUR_COLUMNS) {
      for (const cells of table.rows) {
        const row = Number(cells[0]) as LegendRow;
        const token = `${PRINTED_COLOURS[cells[column] ?? '']}-dreieck` as SignalToken;
        const sequences = dealt.sequences.map((sequence) => [token, ...sequence.slice(1)]);
        const state: SignalState = { ...dealt, stage: side === 'b' ? 0 : 1, sequences };
        expect(pressKey(def, state, { row, shape: 'dreieck' }, side).penalty).toBeNull();
      }
    }
  });

  it('names all four patterns in the legend, each beside its colour as the consoles draw it', () => {
    const manual = signalModule.manual(defOf({ legend: true }));
    const table = legendOf(defOf({ legend: true }));
    for (const [column] of COLOUR_COLUMNS) {
      expect(table.head[column + 1]).toBe('Muster');
      for (const cells of table.rows) {
        const colour = PRINTED_COLOURS[cells[column] ?? ''] as keyof typeof SIGNAL_PATTERNS;
        expect(PRINTED_PATTERNS[cells[column + 1] ?? ''], cells.join(' ')).toBe(
          SIGNAL_PATTERNS[colour],
        );
      }
    }
    // Four colours, four patterns: a row is found by either alone.
    const printed = new Set(table.rows.flatMap((cells) => [cells[2], cells[4]]));
    expect(printed).toEqual(new Set(Object.keys(PRINTED_PATTERNS)));
    expect(new Set(Object.values(SIGNAL_PATTERNS)).size).toBe(4);
    // The key is drawn too, beside the table, and like the table holds no answer.
    const figures = manual.flatMap((section) => section.blocks).filter((b) => b.kind === 'figure');
    expect(figures.map((figure) => figure.kind === 'figure' && figure.of)).toEqual([
      'signal',
      PATTERN_FIGURE,
    ]);
  });

});

describe('signal manual: the workshop and the def', () => {
  it('notes from which stage on the display shows the signs one at a time', () => {
    for (const fleetingFrom of [1, 3, 5]) {
      for (const legend of [false, true]) {
        const [display] = paragraphsUnder(defOf({ stages: 5, fleetingFrom, legend }), WORKSHOP);
        expect(display).toBe(
          `Seit dem Umbau zeigt die Anzeige ab Stufe ${fleetingFrom} die Zeichen nur einzeln ` +
            'und kurz (Kondensator, nie ersetzt): merken oder notieren.',
        );
      }
    }
    const [steady] = paragraphsUnder(defOf({ stages: 5 }), WORKSHOP);
    expect(steady).toBe(
      'Kondensator 1994 erneuert: Die Anzeige hält die Folge, bis die Stufe quittiert ist.',
    );
  });

  it('notes without the legend that a key’s place says nothing at the other console', () => {
    expect(paragraphsUnder(defOf(), WORKSHOP)[1]).toBe(
      'A und B sind verschieden bestückt: Am Gegenpult gelten Farbe und Form einer Taste, nie ' +
        'ihre Lage.',
    );
    expect(paragraphsUnder(defOf({ legend: true }), WORKSHOP)).toHaveLength(1);
  });

  it('is the same for every run: it hangs on the def alone', () => {
    const def = defOf();
    expect(signalModule.manual(structuredClone(def))).toEqual(signalModule.manual(def));
    const legend = defOf({ legend: true, fleetingFrom: 2 });
    expect(signalModule.manual(structuredClone(legend))).toEqual(signalModule.manual(legend));
    for (const other of [{ length: 5 }, { legend: true }, { fleetingFrom: 2 }]) {
      expect(signalModule.manual(defOf(other)), JSON.stringify(other)).not.toEqual(
        signalModule.manual(def),
      );
    }
  });

});

describe('signal manual: the log', () => {
  it.each([3, 4, 5, 6])('logs a stage the way the station runs it (%i signs)', (length) => {
    const def = defOf({ length });
    const [shown, acknowledged, turned, ...more] = logOf(def);
    expect(more).toEqual([]);
    const signs = signsIn(shown ?? '');
    expect(signs).toHaveLength(length);
    expect(shown).toMatch(/^06:12 Stufe 1, Pult A zeigt:/);
    expect(acknowledged).toMatch(/^06:13 Pult B quittiert:/);
    expect(signsIn(acknowledged ?? '')).toEqual(signs);
    expect(turned).toBe('06:13 Stufe 1 vollständig, Richtung gewechselt: Pult B zeigt Stufe 2.');
    // The station at stage 1 with the logged sequence: A shows it, B acknowledges it.
    const dealt = deal(def, 1);
    let state: SignalState = { ...dealt, sequences: [signs, ...dealt.sequences.slice(1)] };
    expect(seenFrom(def, state, AT_STATION)).toMatchObject({
      stage: 1,
      role: 'sender',
      sends: 'a',
      sequence: signs,
    });
    for (const token of signs) {
      expect(() => press(def, state, token, 'a')).toThrow(GameError);
      const result = press(def, state, token, 'b');
      expect(result.penalty).toBeNull();
      state = result.state;
    }
    expect(seenFrom(def, state, AT_CONSOLE_B)).toMatchObject({
      stage: 2,
      sends: 'b',
      role: 'sender',
      done: 0,
    });
  });

  it.each([3, 4, 5, 6])('logs a legend mix-up and its cure, as the station does (%i)', (n) => {
    const def = defOf({ length: n, legend: true });
    const [shown, mixedUp, acknowledged, turned, ...more] = logOf(def);
    expect(more).toEqual([]);
    const signs = signsIn(shown ?? '');
    expect(signs).toHaveLength(n);
    expect(shown).toMatch(/^06:12 Stufe 1, Pult A zeigt:/);
    expect(turned).toBe('06:13 Stufe 1 vollständig, Richtung gewechselt: Pult B zeigt Stufe 2.');
    // Line 2: the first sign's key looked up in console a's column, pressed at console b.
    const fault = new RegExp(
      '^06:12 Pult B quittiert (\\S+ in Zeile [1-4]) \\(Spalte A gelesen\\): ' +
        'Fehlquittierung, Alarm, Stufe 1 in Grundstellung\\.$',
    ).exec(mixedUp ?? '');
    if (fault === null) {
      throw new Error(`the log shows no mix-up of the legends: "${mixedUp}"`);
    }
    const wrong = keyNamed(fault[1] ?? '');
    const [first = 'rot-kreis'] = signs;
    const [colourOfFirst, shapeOfFirst] = partsOf(first);
    expect(wrong.shape).toBe(shapeOfFirst);
    expect(PRINTED_COLOURS[legendOf(def).rows[wrong.row - 1]?.[1] ?? '']).toBe(colourOfFirst);
    // At console b that key is a wrong one: an alarm, and the stage back to its start.
    const dealt = deal(def, 1);
    let state: SignalState = { ...dealt, sequences: [signs, ...dealt.sequences.slice(1)] };
    const slip = pressKey(def, state, wrong, 'b');
    expect(slip.penalty).toBe('Signalkette: falsches Zeichen');
    expect(slip.state).toMatchObject({ stage: 0, done: 0, lastResult: 'wrong' });
    // Line 3: the keys console b's column gives, and the station takes them all.
    expect(acknowledged).toMatch(/^06:13 Pult B quittiert:/);
    const keys = keysIn(acknowledged ?? '');
    expect(keys).toHaveLength(n);
    state = slip.state;
    for (const key of keys) {
      expect(() => pressKey(def, state, key, 'a')).toThrow(GameError);
      const result = pressKey(def, state, key, 'b');
      expect(result.penalty, JSON.stringify(key)).toBeNull();
      state = result.state;
    }
    expect(seenFrom(def, state, AT_CONSOLE_B)).toMatchObject({
      stage: 2,
      sends: 'b',
      role: 'sender',
      done: 0,
    });
  });
});

/** Where presence keeps console b of the lab's Signalkette. */
const CONSOLE_B = stationKey({ puzzleId: 'kette', console: 'b' });

/** The console lab with its Signalkette set to `fields`. */
function labWith(fields: Partial<SignalDef>): Mission {
  const lab = consoleLab(3);
  return {
    ...lab,
    puzzles: lab.puzzles.map((def) => (def.type === 'signal' ? { ...def, ...fields } : def)),
  };
}

/**
 * A run of the console lab for three: Anna (p1) at console a, Ben (p2) at
 * console b, Cleo (p3) at the book; Ben switches the station on.
 */
function signalRun(mission = consoleLab(3)): GameState {
  const here = standing(started(mission, 11), {
    stations: { kette: ['p1'], [CONSOLE_B]: ['p2'] },
    manuals: { buch: ['p3'] },
    signSeen: ['p1', 'p2', 'p3'],
  });
  return applyAction(here, { type: 'interact', playerId: 'p2', at: T0 + 500 });
}

function signalOf(state: GameState, playerId: string) {
  const puzzle = viewFor(state, playerId).puzzle;
  if (puzzle?.kind !== 'signal') {
    throw new Error('expected the signal station');
  }
  return puzzle;
}

const pressBy = (playerId: string, token: SignalToken, at = T0 + 1000): Action => ({
  type: 'puzzle-input',
  playerId,
  at,
  input: { press: token },
});

const keyBy = (playerId: string, key: SignalKey, at = T0 + 1000): Action => ({
  type: 'puzzle-input',
  playerId,
  at,
  input: { key },
});

describe('signal in a run', () => {
  it('shows each player their own part, over the wire', () => {
    const state = signalRun();
    const sequence = signalOf(state, 'p1').sequence;
    expect(sequence).toHaveLength(4);
    expect(signalOf(state, 'p1')).toMatchObject({ console: 'a', role: 'sender', manual: null });
    expect(signalOf(state, 'p2')).toMatchObject({ console: 'b', role: 'receiver', sequence: null });
    expect(signalOf(state, 'p3')).toMatchObject({ console: null, role: null, grid: null });
    expect(signalOf(state, 'p3').manual).toEqual(signalModule.manual(defOf()));
    const grids = viewForSpectator(state).puzzle;
    if (grids?.kind !== 'signal' || grids.grids === null) {
      throw new Error('expected the audience to see both consoles');
    }
    for (const playerId of ['p2', 'p3']) {
      expect(JSON.stringify(viewFor(state, playerId))).not.toContain(JSON.stringify(sequence));
    }
    expect(JSON.stringify(viewFor(state, 'p1'))).not.toContain(JSON.stringify(grids.grids.b));
    expect(JSON.stringify(viewFor(state, 'p2'))).not.toContain(JSON.stringify(grids.grids.a));
    expect(JSON.stringify(viewFor(state, 'p3'))).not.toContain(JSON.stringify(grids.grids.a));
    expect(JSON.stringify(viewFor(state, 'p3'))).not.toContain(JSON.stringify(grids.grids.b));
  });

  it('takes the receiving console, turns away the sending one and anybody else', () => {
    const state = signalRun();
    const [first] = signalOf(state, 'p1').sequence ?? [];
    if (first === undefined) {
      throw new Error('expected a sequence at console a');
    }
    expect(() => applyAction(state, pressBy('p1', first))).toThrow(
      'Dieses Pult sendet — das andere gibt ein.',
    );
    expect(() => applyAction(state, pressBy('p3', first))).toThrow(
      'Dafür musst du am Pult stehen.',
    );
    const taken = applyAction(state, pressBy('p2', first));
    expect(signalOf(taken, 'p1')).toMatchObject({ done: 1, lastResult: null });
    expect(taken.penaltySeq).toBe(0);
  });

  it('refuses the solo walk without an alarm, and takes the press once a partner sends', () => {
    const state = signalRun();
    const [first] = signalOf(state, 'p1').sequence ?? [];
    if (first === undefined) {
      throw new Error('expected a sequence at console a');
    }
    // Anna read the sequence at console a and walked over to console b; Ben is at the book.
    const walked = standing(state, {
      stations: { [CONSOLE_B]: ['p1'] },
      manuals: { buch: ['p2', 'p3'] },
    });
    expect(signalOf(walked, 'p1')).toMatchObject({ console: 'b', role: 'receiver' });
    expect(() => applyAction(walked, pressBy('p1', first))).toThrow(GameError);
    expect(() => applyAction(walked, pressBy('p1', first))).toThrow(
      'Am sendenden Pult steht niemand.',
    );
    // Ben steps up to console a: the same press counts, and no alarm went off on the way.
    const manned = standing(walked, {
      stations: { kette: ['p2'], [CONSOLE_B]: ['p1'] },
      manuals: { buch: ['p3'] },
    });
    const taken = applyAction(manned, pressBy('p1', first));
    expect(signalOf(taken, 'p2')).toMatchObject({ role: 'sender', done: 1, lastResult: null });
    expect(taken.penaltySeq).toBe(0);
    expect(taken.deadlineAt).toBe(state.deadlineAt);
    expect(taken.credits['p1']?.alarms).toBe(0);
  });

  it('charges a wrong sign once, to whoever pressed it', () => {
    const state = signalRun();
    const [first] = signalOf(state, 'p1').sequence ?? [];
    const slipped = applyAction(state, pressBy('p2', besides(first)));
    expect(slipped.penaltySeq).toBe(1);
    expect(slipped.deadlineAt).toBe((state.deadlineAt ?? 0) - 20_000);
    expect(slipped.credits['p2']?.alarms).toBe(1);
    expect(slipped.events.at(-1)).toMatchObject({
      kind: 'penalty',
      label: 'Signalkette: falsches Zeichen',
      seconds: 20,
    });
    expect(signalOf(slipped, 'p2')).toMatchObject({ done: 0, lastResult: 'wrong' });
  });

  it('hands the sequence to console b for stage 2, and is solved by the last stage', () => {
    let state = signalRun();
    for (let stage = 1; stage <= 4; stage++) {
      const sender = stage % 2 === 1 ? 'p1' : 'p2';
      const receiver = stage % 2 === 1 ? 'p2' : 'p1';
      const sequence = signalOf(state, sender).sequence ?? [];
      expect(signalOf(state, receiver).sequence).toBeNull();
      state = sequence.reduce(
        (s, token) => applyAction(s, pressBy(receiver, token, T0 + stage * 1000)),
        state,
      );
    }
    expect(state.currentPuzzleIndex).toBe(1);
    expect(state.penaltySeq).toBe(0);
    expect(state.events.some((e) => e.label === 'Signalkette gelöst')).toBe(true);
  });

  it('with the legend: no colour reaches console b, the book prints the legend', () => {
    const state = signalRun(labWith({ legend: true }));
    const sequence = signalOf(state, 'p1').sequence ?? [];
    expect(sequence).toHaveLength(4);
    expect(signalOf(state, 'p2')).toMatchObject({ role: 'receiver', keys: ROW_KEYS, grid: null });
    expect(JSON.stringify(signalOf(state, 'p2'))).not.toMatch(COLOUR_WORD);
    expect(signalOf(state, 'p3').manual?.map(({ heading }) => heading)).toEqual([
      'Signalkette, Typ SK-4 (Baujahr 1986)',
      'Aufbau',
      'Betrieb',
      'Legende',
      'Aus der Werkstatt',
    ]);
    const audience = viewForSpectator(state).puzzle;
    expect(audience).toMatchObject({ sequence, grids: null, keys: ROW_KEYS });
  });

  it('with the legend: takes the keys through it, and turns a sign’s own key away', () => {
    let state = signalRun(labWith({ legend: true }));
    const [first = 'rot-kreis'] = signalOf(state, 'p1').sequence ?? [];
    expect(() => applyAction(state, pressBy('p2', first))).toThrow(
      'Diese Taste gibt es an diesem Pult nicht.',
    );
    for (let stage = 1; stage <= 4; stage++) {
      const [sender, receiver, side] =
        stage % 2 === 1 ? (['p1', 'p2', 'b'] as const) : (['p2', 'p1', 'a'] as const);
      const sequence = signalOf(state, sender).sequence ?? [];
      state = sequence.reduce(
        (s, token) => applyAction(s, keyBy(receiver, keyAt(token, side), T0 + stage * 1000)),
        state,
      );
    }
    expect(state.currentPuzzleIndex).toBe(1);
    expect(state.penaltySeq).toBe(0);
  });
});

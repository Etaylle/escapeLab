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
  PuzzleContext,
  SignalToken,
  Viewer,
} from '../src/index.js';
import { signalModule } from '../src/puzzles/signal.js';
import type { SignalDef, SignalState, SignalView } from '../src/puzzles/signal.js';
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
const viewCtx = { edgework, alarms: 0, crew: CREW };

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
});

const deal = (def: SignalDef, seed: number): SignalState =>
  signalModule.init(def, mulberry32(seed), ctx(null));

/**
 * A press of `token` at console `from` — by op at console a, by pt at
 * console b — through the input schema as a client's would go.
 */
function press(
  def: SignalDef,
  state: SignalState,
  token: SignalToken,
  from: ConsoleId | null,
  atConsoles = MANNED,
) {
  const input = signalModule.inputSchema.parse({ press: token });
  return signalModule.apply(def, state, input, from === 'b' ? 'pt' : 'op', ctx(from, atConsoles));
}

const seenFrom = (def: SignalDef, state: SignalState, viewer: Viewer): SignalView =>
  signalModule.view(def, state, viewer, viewCtx);

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

/** The other console. */
const across = (side: ConsoleId): ConsoleId => (side === 'a' ? 'b' : 'a');

/** A sign that is not `token`. */
const besides = (token: SignalToken | undefined): SignalToken =>
  TOKENS.find((other) => other !== token) ?? 'rot-kreis';

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

describe('signal setup', () => {
  it('takes 4 stages of 4 signs and 20 s by default, 2–6 stages of 3–6 signs at most', () => {
    expect(defOf()).toMatchObject({ stages: 4, length: 4, penaltySec: 20 });
    for (const fields of [{ stages: 1 }, { stages: 7 }, { length: 2 }, { length: 7 }]) {
      expect(() => defOf(fields), JSON.stringify(fields)).toThrow();
    }
    expect(defOf({ stages: 6, length: 3 })).toMatchObject({ stages: 6, length: 3 });
  });

  it('lays all twelve keys out at each console, no sign in the same place at both', () => {
    const sorted = [...TOKENS].sort();
    for (let seed = 0; seed < SEEDS; seed++) {
      const { grids } = deal(defOf(), seed);
      expect([...grids.a].sort(), `seed ${seed}`).toEqual(sorted);
      expect([...grids.b].sort(), `seed ${seed}`).toEqual(sorted);
      expect(
        grids.a.every((token, i) => grids.b[i] !== token),
        `seed ${seed}`,
      ).toBe(true);
    }
  });

  it('draws a sequence per stage, never the same sign twice in a row, the same for a seed', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < SEEDS; seed++) {
      const def = defOf({ stages: 2 + (seed % 5), length: 3 + (seed % 4) });
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
    });
  });
});

describe('signal views', () => {
  it('show the sequence at the sending console only, and each console its own keys', () => {
    const def = defOf();
    for (let seed = 0; seed < 50; seed++) {
      const state = deal(def, seed);
      const sequence = state.sequences[0] ?? [];
      const atA = seenFrom(def, state, AT_STATION);
      const atB = seenFrom(def, state, AT_CONSOLE_B);
      expect(atA).toMatchObject({ role: 'sender', sequence, grid: state.grids.a, grids: null });
      expect(atB).toMatchObject({ role: 'receiver', sequence: null, grid: state.grids.b });
      expect(atB.grids).toBeNull();
      for (const away of [AT_BOOK, ELSEWHERE]) {
        expect(seenFrom(def, state, away)).toMatchObject({
          role: null,
          sequence: null,
          grid: null,
          grids: null,
        });
      }
      const wire = (viewer: Viewer): string => JSON.stringify(seenFrom(def, state, viewer));
      for (const viewer of [AT_CONSOLE_B, AT_BOOK, ELSEWHERE]) {
        expect(wire(viewer)).not.toContain(JSON.stringify(sequence));
        expect(wire(viewer)).not.toContain('"sequence":[');
      }
      // Nobody but the audience sees the other console's keys.
      expect(wire(AT_STATION)).not.toContain(JSON.stringify(state.grids.b));
      expect(wire(AT_CONSOLE_B)).not.toContain(JSON.stringify(state.grids.a));
      for (const viewer of [AT_BOOK, ELSEWHERE]) {
        expect(wire(viewer)).not.toContain(JSON.stringify(state.grids.a));
        expect(wire(viewer)).not.toContain(JSON.stringify(state.grids.b));
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
    });
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

  it('take nothing but one of the twelve signs', () => {
    for (const input of [
      { press: 'lila-kreis' },
      { press: 'rot-Kreis' },
      { press: 'rotes Dreieck' },
      { press: 'rot-kreis', twice: true },
      {},
      { wireId: 'w1' },
    ]) {
      expect(signalModule.inputSchema.safeParse(input).success, JSON.stringify(input)).toBe(false);
    }
    for (const token of TOKENS) {
      expect(signalModule.inputSchema.parse({ press: token })).toEqual({ press: token });
    }
  });
});

describe('signal solver', () => {
  it(`solves ${SEEDS} instances from the consoles' views, without the edgework`, () => {
    // The harness hands the edgework only to modules that read it.
    expect(signalModule.usesEdgework).toBe(false);
    for (let seed = 0; seed < SEEDS; seed++) {
      const def = defOf({ stages: 2 + (seed % 5), length: 3 + (seed % 4) });
      expect(playInstance(def, seed), `seed ${seed}`).toBe(def.stages * def.length);
    }
  });

  it('presses at the receiving console what is left of the stage', () => {
    const def = defOf();
    const views = (state: SignalState) => ({
      operator: seenFrom(def, state, AT_STATION),
      partner: seenFrom(def, state, AT_CONSOLE_B),
      reader: seenFrom(def, state, AT_BOOK),
    });
    let state = deal(def, 6);
    const first = state.sequences[0] ?? [];
    expect(signalModule.solve(def, views(state), null)).toEqual(
      first.map((token) => ({ by: 'partner', input: { press: token } })),
    );
    state = press(def, state, first[0] ?? 'rot-kreis', 'b').state;
    expect(signalModule.solve(def, views(state), null)).toEqual(
      first.slice(1).map((token) => ({ by: 'partner', input: { press: token } })),
    );
    const second = { ...state, stage: 1, done: 0 };
    expect(signalModule.solve(def, views(second), null)).toEqual(
      (second.sequences[1] ?? []).map((token) => ({ by: 'operator', input: { press: token } })),
    );
  });

  it('has no move when no view shows the sequence', () => {
    const def = defOf();
    const reader = seenFrom(def, deal(def, 6), AT_BOOK);
    expect(signalModule.solve(def, { operator: reader, reader }, null)).toEqual([]);
  });
});

type ExampleBlock = Extract<ManualBlock, { kind: 'example' }>;

/** The example box's lines; the manual has exactly one. */
function exampleOf(def: SignalDef): string[] {
  const boxes = signalModule
    .manual(def)
    .flatMap((section) => section.blocks)
    .filter((block): block is ExampleBlock => block.kind === 'example');
  expect(boxes).toHaveLength(1);
  return boxes[0]?.lines ?? [];
}

/** The signs a line lists after its colon, read back the way a player would. */
function signsIn(line: string): SignalToken[] {
  const listed = line.slice(line.indexOf(':') + 1).replace(/\.$/, '');
  return listed.split(',').map((label) => {
    const token = TOKENS.find((t) => tokenLabel(t) === label.trim());
    if (token === undefined) {
      throw new Error(`"${label.trim()}" is not a sign`);
    }
    return token;
  });
}

describe('signal manual', () => {
  it('prints the drawing, the device, the rules, the example and the penalty in order', () => {
    const def = defOf({ stages: 5, length: 3, penaltySec: 25 });
    const [section, ...more] = signalModule.manual(def);
    expect(more).toEqual([]);
    expect(section?.heading).toBe('Signalkette');
    const blocks = section?.blocks ?? [];
    expect(blocks.map((block) => block.kind)).toEqual(['figure', 'p', 'rules', 'example', 'p']);
    expect(blocks[0]).toEqual({
      kind: 'figure',
      of: 'signal',
      caption: 'Abb. 1 — Zwei Signalpulte',
    });
    expect(blocks[1]).toMatchObject({
      kind: 'p',
      text: expect.stringMatching(/^Zwei Pulte, A und B\. .*Folge von 3 Zeichen.*Richtung\.$/),
    });
    expect(blocks.at(-1)).toEqual({ kind: 'p', text: 'Fehlgriff: Alarm, −25 s.' });
    const rules = blocks[2]?.kind === 'rules' ? blocks[2].items : [];
    expect(rules.join(' ')).toContain('Wenn Stufe 5 vollständig gedrückt ist');
    expect(rules.join(' ')).toContain('Wenn alle 3 Zeichen einer Stufe gedrückt sind');
  });

  it('speaks in full conditional sentences, without „du" and without exclamation marks', () => {
    const manual = signalModule.manual(defOf());
    const blocks = manual.flatMap((section) => section.blocks);
    const rules = blocks.flatMap((block) => (block.kind === 'rules' ? block.items : []));
    expect(rules.length).toBeGreaterThan(3);
    for (const rule of rules) {
      expect(rule).toMatch(/^(Wenn |Andernfalls ).*\.$/);
    }
    const text = JSON.stringify(manual);
    expect(text).not.toMatch(/\b(du|dein|dich|dir)\b|!|ansagen|beschreiben/i);
  });

  it('is the same for every run: it hangs on the def alone', () => {
    const def = defOf();
    expect(signalModule.manual(structuredClone(def))).toEqual(signalModule.manual(def));
    expect(signalModule.manual(defOf({ length: 5 }))).not.toEqual(signalModule.manual(def));
  });

  it.each([3, 4, 5, 6])('works its example the way the station does (%i signs)', (length) => {
    const def = defOf({ length });
    const [shown, rule, pressed, next] = exampleOf(def);
    const signs = signsIn(shown ?? '');
    expect(signs).toHaveLength(length);
    expect(signsIn(pressed ?? '')).toEqual(signs);
    expect(shown).toMatch(/^Stufe 1, Pult A zeigt:/);
    expect(rule).toBe('Stufe 1 ist ungerade: Pult A sendet, Pult B empfängt.');
    expect(pressed).toMatch(/^An Pult B gedrückt:/);
    expect(next).toBe('Stufe 2 beginnt; nun sendet Pult B.');
    // The station at stage 1 with the example's sequence: A shows it, B presses it.
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
});

/** Where presence keeps console b of the lab's Signalkette. */
const CONSOLE_B = stationKey({ puzzleId: 'kette', console: 'b' });

/**
 * A run of the console lab for three: Anna (p1) at console a, Ben (p2) at
 * console b, Cleo (p3) at the book; Ben switches the station on.
 */
function signalRun(): GameState {
  const here = standing(started(consoleLab(3), 11), {
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
});

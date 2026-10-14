import { z } from 'zod';
import { fail } from '../errors.js';
import { shuffle, type Rng } from '../rng.js';
import {
  commonDefShape,
  type ConsoleId,
  type ManualBlock,
  type Move,
  type PuzzleModule,
} from './module.js';
import { deviceFigure, penaltyLine, workedExample } from './printed.js';

const COLOURS = ['rot', 'blau', 'gruen', 'gelb'] as const;
const SHAPES = ['kreis', 'dreieck', 'quadrat'] as const;
type Colour = (typeof COLOURS)[number];
type Shape = (typeof SHAPES)[number];
export type SignalToken = `${Colour}-${Shape}`;

/** The twelve signs: every colour in every shape. */
export const TOKENS: readonly SignalToken[] = COLOURS.flatMap((colour) =>
  SHAPES.map((shape): SignalToken => `${colour}-${shape}`),
);

const COLOUR_WORDS: Record<Colour, string> = {
  rot: 'rot',
  blau: 'blau',
  gruen: 'grün',
  gelb: 'gelb',
};
/** A shape's noun, its article and the ending its colour takes: der Kreis, das Dreieck. */
const SHAPE_WORDS: Record<Shape, { noun: string; article: string; ending: string }> = {
  kreis: { noun: 'Kreis', article: 'der', ending: 'er' },
  dreieck: { noun: 'Dreieck', article: 'das', ending: 'es' },
  quadrat: { noun: 'Quadrat', article: 'das', ending: 'es' },
};

/** A sign's colour and shape, read off its id. */
function partsOf(token: SignalToken): { colour: Colour; shape: Shape } {
  const colour = COLOURS.find((c) => token.startsWith(`${c}-`));
  const shape = SHAPES.find((s) => token.endsWith(`-${s}`));
  if (colour === undefined || shape === undefined) {
    throw new Error(`signal: "${token}" is not one of the twelve signs`);
  }
  return { colour, shape };
}

/** A sign as it is said: „rotes Dreieck", „blauer Kreis", „grünes Quadrat". */
export function tokenLabel(token: SignalToken): string {
  const { colour, shape } = partsOf(token);
  const { noun, ending } = SHAPE_WORDS[shape];
  return `${COLOUR_WORDS[colour]}${ending} ${noun}`;
}

/** A row of keys at a console with the legend, numbered from the top. */
export type LegendRow = 1 | 2 | 3 | 4;
const ROWS = [1, 2, 3, 4] as const satisfies readonly LegendRow[];

/**
 * The printed legend: the colour each row of keys stands for, at either
 * console. No row stands for the same colour at both, so only the receiving
 * console's column gives the right row.
 */
export const LEGEND: Readonly<Record<ConsoleId, Readonly<Record<LegendRow, Colour>>>> = {
  a: { 1: 'rot', 2: 'blau', 3: 'gruen', 4: 'gelb' },
  b: { 1: 'gelb', 2: 'gruen', 3: 'rot', 4: 'blau' },
};

/** A key at a console with the legend: the row it sits in and the shape on it, no colour. */
export interface SignalKey {
  row: LegendRow;
  shape: Shape;
}

/** Either console's keys with the legend, row by row: each row the three shapes in order. */
const KEYS: readonly SignalKey[] = ROWS.flatMap((row) => SHAPES.map((shape) => ({ row, shape })));

/** The key that stands for `token` at console `at`: its shape, in the row of its colour. */
function keyFor(token: SignalToken, at: ConsoleId): SignalKey {
  const { colour, shape } = partsOf(token);
  const row = ROWS.find((r) => LEGEND[at][r] === colour);
  if (row === undefined) {
    throw new Error(`signal: the legend of console ${at} has no row for ${colour}`);
  }
  return { row, shape };
}

/** A key as the printed rules name it: „Dreieck in Zeile 3". */
const keyLabel = ({ row, shape }: SignalKey): string =>
  `${SHAPE_WORDS[shape].noun} in Zeile ${row}`;

/**
 * Signalkette: a station with two consoles in different places. The sending
 * console shows a sequence of coloured signs, the receiving console has
 * twelve keys and presses the sequence in order. Console a sends first; the
 * direction swaps with every stage. Without the legend the keys are the
 * twelve signs, laid out differently at either console. With it they are
 * four numbered rows of the three shapes, the same at both and without a
 * colour, and the printed legend says which colour a row stands for at
 * which console. From stage `fleetingFrom` on, the sending console shows
 * the signs one at a time — the view says so, the client cycles them. A
 * wrong sign costs time and starts the stage's input again; a key pressed
 * at the sending console is turned away, without an alarm, and so is one
 * pressed at the receiving console while nobody else stands at the sending
 * one: a single player cannot read there and press here.
 */
const defSchema = z
  .strictObject({
    type: z.literal('signal'),
    ...commonDefShape,
    /** stages to send; the direction swaps after each */
    stages: z.number().int().min(2).max(6).default(4),
    /** signs in every stage's sequence */
    length: z.number().int().min(3).max(6).default(4),
    /** the receiving console has rows of shapes, which the printed legend gives colours */
    legend: z.boolean().default(false),
    /** from this stage on (1-based) the sending console shows one sign at a time; null: never */
    fleetingFrom: z.number().int().min(1).nullable().default(null),
    penaltySec: z.number().int().positive().default(20),
  })
  .superRefine((def, ctx) => {
    if (def.fleetingFrom !== null && def.fleetingFrom > def.stages) {
      ctx.addIssue({
        code: 'custom',
        path: ['fleetingFrom'],
        message:
          `puzzle "${def.id}": fleetingFrom (${def.fleetingFrom}) is past the last stage ` +
          `(${def.stages}), so no stage would show its signs one at a time — lower it, ` +
          'or set it to null',
      });
    }
  });
export type SignalDef = z.infer<typeof defSchema>;

export interface SignalState {
  type: 'signal';
  /** 0-based: stage 0 is sent from console a, and the direction swaps with every stage */
  stage: number;
  /** correct presses so far in this stage */
  done: number;
  /**
   * the twelve signs as each console lays its keys out, row by row: 3 rows
   * of 4; null with the legend, where both consoles have the same rows of shapes
   */
  grids: Record<ConsoleId, SignalToken[]> | null;
  /** each stage's sequence; a sign may come again, never twice in a row */
  sequences: SignalToken[][];
  /** the last press was a wrong sign; the next right one clears it */
  lastResult: 'wrong' | null;
}

const inputSchema = z.union([
  /** a sign's key, at a console without the legend */
  z.strictObject({ press: z.enum(TOKENS) }),
  /** a key of shapes, at a console with the legend */
  z.strictObject({ key: z.strictObject({ row: z.literal(ROWS), shape: z.enum(SHAPES) }) }),
]);
export type SignalInput = z.infer<typeof inputSchema>;

export interface SignalView {
  kind: 'signal';
  /** 1-based, as the printed rules count: stage 1 is sent from console a */
  stage: number;
  stages: number;
  /** signs in every stage's sequence */
  length: number;
  /** correct presses so far in this stage */
  done: number;
  lastResult: 'wrong' | null;
  /** what the viewer's console does this stage; null away from the consoles and for the audience */
  role: 'sender' | 'receiver' | null;
  /** the console that sends this stage */
  sends: ConsoleId;
  /** the sending console shows this stage's signs one at a time; the client cycles them */
  fleeting: boolean;
  /** this stage's sequence — only at the sending console, and for the audience */
  sequence: SignalToken[] | null;
  /** without the legend: the keys of the viewer's own console, row by row — only at a console */
  grid: SignalToken[] | null;
  /** without the legend: the keys of both consoles — only for the audience */
  grids: Record<ConsoleId, SignalToken[]> | null;
  /**
   * with the legend: the keys, row by row, the same at both consoles and
   * without a colour — at a console and for the audience
   */
  keys: SignalKey[] | null;
}

/** The console that sends in (0-based) `stage`: a first, then turn and turn about. */
const sendingConsole = (stage: number): ConsoleId => (stage % 2 === 0 ? 'a' : 'b');

/** The other console. */
const across = (side: ConsoleId): ConsoleId => (side === 'a' ? 'b' : 'a');

/** From stage `fleetingFrom` on, the sending console shows the signs one at a time. */
const fleetingIn = (def: SignalDef, stage: number): boolean =>
  def.fleetingFrom !== null && stage + 1 >= def.fleetingFrom;

/** The sequence of the stage under way; `init` deals one for every stage. */
function sequenceNow(state: SignalState): SignalToken[] {
  const sequence = state.sequences[state.stage];
  if (sequence === undefined) {
    throw new Error(
      `signal: no sequence for stage ${state.stage + 1} of ${state.sequences.length}`,
    );
  }
  return sequence;
}

/**
 * Console b's keys: console a's moved round one random cycle (Sattolo's
 * shuffle), so no sign sits where it sits at console a and a place on one
 * panel says nothing about the other.
 */
function rearranged(grid: readonly SignalToken[], rng: Rng): SignalToken[] {
  const keys = [...grid];
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * i);
    const here = keys[i];
    const there = keys[j];
    if (here !== undefined && there !== undefined) {
      keys[i] = there;
      keys[j] = here;
    }
  }
  return keys;
}

/** One stage's sequence: `length` signs drawn at random, never the same one twice in a row. */
function sequenceOf(length: number, rng: Rng): SignalToken[] {
  const sequence: SignalToken[] = [];
  while (sequence.length < length) {
    const choices = TOKENS.filter((token) => token !== sequence.at(-1));
    const token = choices[Math.floor(rng() * choices.length)];
    if (token === undefined) {
      throw new Error('signal: no sign left to draw');
    }
    sequence.push(token);
  }
  return sequence;
}

/** What a console does in a stage that `sends` sends; null for nobody at a console. */
function roleOf(at: ConsoleId | null, sends: ConsoleId): SignalView['role'] {
  if (at === null) {
    return null;
  }
  return at === sends ? 'sender' : 'receiver';
}

/**
 * The keys a viewer sees: at a console its own, for the audience every
 * console's. The coloured keys differ between the consoles; the rows of
 * shapes, dealt instead of them with the legend, are the same at both.
 */
function keysSeen(
  state: SignalState,
  at: ConsoleId | null,
  audience: boolean,
): Pick<SignalView, 'grid' | 'grids' | 'keys'> {
  const { grids } = state;
  if (grids === null) {
    const seen = at !== null || audience;
    return { grid: null, grids: null, keys: seen ? KEYS.map((key) => ({ ...key })) : null };
  }
  return {
    grid: at === null ? null : [...grids[at]],
    grids: audience ? { a: [...grids.a], b: [...grids.b] } : null,
    keys: null,
  };
}

/**
 * The sign a key pressed at console `at` stands for: a sign's key for
 * itself, a key of shapes for its shape in the colour the legend gives its
 * row there. A kind of key the console does not have is turned away.
 */
function signPressed(def: SignalDef, input: SignalInput, at: ConsoleId): SignalToken {
  if (('key' in input) !== def.legend) {
    fail('Diese Taste gibt es an diesem Pult nicht.');
  }
  return 'key' in input ? `${LEGEND[at][input.key.row]}-${input.key.shape}` : input.press;
}

/** The printed example's sequence: one sign comes again, none twice in a row. */
const EXAMPLE: readonly SignalToken[] = [
  'rot-dreieck',
  'blau-kreis',
  'gelb-quadrat',
  'rot-dreieck',
  'gruen-kreis',
  'blau-quadrat',
];

/** One sign of the example looked up in console b's column of the legend. */
function lookedUp(token: SignalToken): string {
  const { colour, shape } = partsOf(token);
  const { row } = keyFor(token, 'b');
  const said = tokenLabel(token);
  const { article, noun } = SHAPE_WORDS[shape];
  return (
    `${said.charAt(0).toUpperCase()}${said.slice(1)}: In der Legende steht ` +
    `${COLOUR_WORDS[colour]} bei Pult B in Zeile ${row}; gedrückt wird ${article} ${noun} ` +
    `in Zeile ${row}.`
  );
}

/**
 * The worked example: stage 1 as console a shows it and console b presses
 * it — with the legend, its first sign looked up in console b's column.
 */
function exampleLines(def: SignalDef): string[] {
  const signs = EXAMPLE.slice(0, def.length);
  const [first] = signs;
  if (first === undefined) {
    throw new Error(`signal: the printed example has no sign for a length of ${def.length}`);
  }
  const shown = `Stufe 1, Pult A zeigt: ${signs.map(tokenLabel).join(', ')}.`;
  const sends = 'Stufe 1 ist ungerade: Pult A sendet, Pult B empfängt.';
  if (!def.legend) {
    return [
      shown,
      sends,
      `An Pult B gedrückt: ${signs.map(tokenLabel).join(', ')}.`,
      'Stufe 2 beginnt; nun sendet Pult B.',
    ];
  }
  const keys = signs.map((token) => keyLabel(keyFor(token, 'b')));
  return [shown, sends, lookedUp(first), `An Pult B gedrückt: ${keys.join(', ')}.`];
}

/** The printed legend: each row of keys, and the colour it stands for at either console. */
function legendTable(): ManualBlock {
  return {
    kind: 'table',
    head: ['Zeile', 'Pult A', 'Pult B'],
    rows: ROWS.map((row) => [
      String(row),
      COLOUR_WORDS[LEGEND.a[row]],
      COLOUR_WORDS[LEGEND.b[row]],
    ]),
  };
}

/** The device and the task, in three sentences; with the legend the receiver has shapes only. */
function deviceText(def: SignalDef): string {
  const keys = def.legend
    ? `Das sendende Pult zeigt eine Folge von ${def.length} farbigen Zeichen; das ` +
      'empfangende Pult zeigt nur Formen: 12 graue Tasten in 4 nummerierten Zeilen, jede mit ' +
      'Kreis, Dreieck und Quadrat.'
    : `Das sendende Pult zeigt eine Folge von ${def.length} Zeichen, das empfangende Pult ` +
      'trägt die zwölf Zeichen als Tasten.';
  return (
    `Zwei Pulte, A und B. ${keys} Die Folge wird am empfangenden Pult in ihrer Reihenfolge ` +
    'gedrückt; nach jeder Stufe wechselt die Richtung.'
  );
}

/** The rules, one sentence each; the legend and the fleeting display add theirs. */
function ruleLines(def: SignalDef): string[] {
  return [
    'Wenn die Nummer der Stufe ungerade ist, sendet Pult A, und Pult B empfängt.',
    'Wenn die Nummer der Stufe gerade ist, sendet Pult B, und Pult A empfängt.',
    ...(def.legend
      ? [
          'Wenn ein Zeichen gesendet wird, wird am empfangenden Pult die Taste seiner Form in ' +
            'der Zeile gedrückt, die die Legende diesem Pult für seine Farbe nennt.',
        ]
      : []),
    ...(def.fleetingFrom === null
      ? []
      : [
          `Wenn die Stufe ${def.fleetingFrom} erreicht ist, zeigt das sendende Pult die ` +
            'Zeichen nacheinander.',
        ]),
    `Wenn alle ${def.length} Zeichen einer Stufe gedrückt sind, beginnt die nächste Stufe.`,
    `Wenn Stufe ${def.stages} vollständig gedrückt ist, ist die Signalkette geschlossen.`,
    def.legend
      ? 'Wenn eine Taste gedrückt wird, die nicht für das nächste Zeichen der Folge steht, ' +
        'beginnt die Stufe von vorn; die Folge bleibt dieselbe.'
      : 'Wenn ein Zeichen gedrückt wird, das nicht das nächste der Folge ist, beginnt die ' +
        'Stufe von vorn; die Folge bleibt dieselbe.',
    'Wenn am sendenden Pult gedrückt wird, geschieht nichts.',
  ];
}

export const signalModule: PuzzleModule<SignalDef, SignalState, SignalInput, SignalView> = {
  type: 'signal',
  usesEdgework: false,
  wholeCrew: false,
  consoles: 2,
  defSchema,
  inputSchema,

  init(def, rng) {
    const a = def.legend ? null : shuffle(TOKENS, rng);
    return {
      type: 'signal',
      stage: 0,
      done: 0,
      grids: a === null ? null : { a, b: rearranged(a, rng) },
      sequences: Array.from({ length: def.stages }, () => sequenceOf(def.length, rng)),
      lastResult: null,
    };
  },

  apply(def, state, input, playerId, ctx) {
    if (ctx.console === null) {
      fail('Dafür musst du am Pult stehen.');
    }
    const sign = signPressed(def, input, ctx.console);
    const sends = sendingConsole(state.stage);
    if (ctx.console === sends) {
      fail('Dieses Pult sendet — das andere gibt ein.');
    }
    // Reading the sequence at one console and pressing it at the other takes two people.
    if (!ctx.atConsoles[sends].some((id) => id !== playerId)) {
      fail('Am sendenden Pult steht niemand.');
    }
    const sequence = sequenceNow(state);
    const expected = sequence[state.done];
    if (expected === undefined) {
      throw new Error(`signal: stage ${state.stage + 1} is pressed in full — the chain is closed`);
    }
    if (sign !== expected) {
      return {
        state: { ...state, done: 0, lastResult: 'wrong' },
        solved: false,
        penalty: 'Signalkette: falsches Zeichen',
      };
    }
    const done = state.done + 1;
    if (done < sequence.length) {
      return { state: { ...state, done, lastResult: null }, solved: false, penalty: null };
    }
    if (state.stage + 1 < state.sequences.length) {
      return {
        state: { ...state, stage: state.stage + 1, done: 0, lastResult: null },
        solved: false,
        penalty: null,
      };
    }
    return { state: { ...state, done, lastResult: null }, solved: true, penalty: null };
  },

  view(def, state, viewer) {
    const sends = sendingConsole(state.stage);
    const sequence = sequenceNow(state);
    const at = viewer.operating ? viewer.console : null;
    const role = roleOf(at, sends);
    const audience = viewer.playerId === null;
    return {
      kind: 'signal',
      stage: state.stage + 1,
      stages: state.sequences.length,
      length: sequence.length,
      done: state.done,
      lastResult: state.lastResult,
      role,
      sends,
      fleeting: fleetingIn(def, state.stage),
      sequence: role === 'sender' || audience ? [...sequence] : null,
      ...keysSeen(state, at, audience),
    };
  },

  manual(def) {
    const close = [workedExample(exampleLines(def)), penaltyLine(def.penaltySec)];
    const device: ManualBlock[] = [
      deviceFigure('signal', 'Zwei Signalpulte'),
      { kind: 'p', text: deviceText(def) },
      { kind: 'rules', items: ruleLines(def) },
    ];
    if (!def.legend) {
      return [{ heading: 'Signalkette', blocks: [...device, ...close] }];
    }
    return [
      { heading: 'Signalkette', blocks: device },
      { heading: 'Legende', blocks: [legendTable(), ...close] },
    ];
  },

  /**
   * The sending console's view holds the sequence: the rest of it, from the
   * presses done so far, is pressed at the other console — by the operator
   * when console a receives, by the partner when console b does; with the
   * legend each sign as the key the printed legend gives it there.
   */
  solve(def, { operator, partner }) {
    const sending = [operator, partner].find((view) => view?.role === 'sender');
    if (sending === undefined || sending.sequence === null) {
      return [];
    }
    const receives = across(sending.sends);
    const by: Move<SignalInput>['by'] = receives === 'b' ? 'partner' : 'operator';
    return sending.sequence.slice(sending.done).map((token) => ({
      by,
      input: def.legend ? { key: keyFor(token, receives) } : { press: token },
    }));
  },
};

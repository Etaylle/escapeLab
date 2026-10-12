import { z } from 'zod';
import { fail } from '../errors.js';
import { shuffle, type Rng } from '../rng.js';
import { commonDefShape, type ConsoleId, type Move, type PuzzleModule } from './module.js';

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
/** A shape's noun and the ending its colour takes: der Kreis, das Dreieck, das Quadrat. */
const SHAPE_WORDS: Record<Shape, { noun: string; ending: string }> = {
  kreis: { noun: 'Kreis', ending: 'er' },
  dreieck: { noun: 'Dreieck', ending: 'es' },
  quadrat: { noun: 'Quadrat', ending: 'es' },
};

/** A sign as it is said: „rotes Dreieck", „blauer Kreis", „grünes Quadrat". */
export function tokenLabel(token: SignalToken): string {
  const colour = COLOURS.find((c) => token.startsWith(`${c}-`));
  const shape = SHAPES.find((s) => token.endsWith(`-${s}`));
  if (colour === undefined || shape === undefined) {
    throw new Error(`signal: "${token}" is not one of the twelve signs`);
  }
  const { noun, ending } = SHAPE_WORDS[shape];
  return `${COLOUR_WORDS[colour]}${ending} ${noun}`;
}

/**
 * Signalkette: a station with two consoles in different places. The sending
 * console shows a sequence of coloured signs, the receiving console has all
 * twelve signs as keys, laid out differently at either console, and presses
 * the sequence in order. Console a sends first; the direction swaps with
 * every stage. A wrong sign costs time and starts the stage's input again;
 * a key pressed at the sending console is turned away, without an alarm.
 */
const defSchema = z.strictObject({
  type: z.literal('signal'),
  ...commonDefShape,
  /** stages to send; the direction swaps after each */
  stages: z.number().int().min(2).max(6).default(4),
  /** signs in every stage's sequence */
  length: z.number().int().min(3).max(6).default(4),
  penaltySec: z.number().int().positive().default(20),
});
export type SignalDef = z.infer<typeof defSchema>;

export interface SignalState {
  type: 'signal';
  /** 0-based: stage 0 is sent from console a, and the direction swaps with every stage */
  stage: number;
  /** correct presses so far in this stage */
  done: number;
  /** the twelve keys as each console lays them out, row by row: 3 rows of 4 */
  grids: Record<ConsoleId, SignalToken[]>;
  /** each stage's sequence; a sign may come again, never twice in a row */
  sequences: SignalToken[][];
  /** the last press was a wrong sign; the next right one clears it */
  lastResult: 'wrong' | null;
}

const inputSchema = z.strictObject({ press: z.enum(TOKENS) });
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
  /** this stage's sequence — only at the sending console, and for the audience */
  sequence: SignalToken[] | null;
  /** the keys of the viewer's own console, row by row — only at a console */
  grid: SignalToken[] | null;
  /** the keys of both consoles — only for the audience */
  grids: Record<ConsoleId, SignalToken[]> | null;
}

/** The console that sends in (0-based) `stage`: a first, then turn and turn about. */
const sendingConsole = (stage: number): ConsoleId => (stage % 2 === 0 ? 'a' : 'b');

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

/** The printed example's sequence: one sign comes again, none twice in a row. */
const EXAMPLE: readonly SignalToken[] = [
  'rot-dreieck',
  'blau-kreis',
  'gelb-quadrat',
  'rot-dreieck',
  'gruen-kreis',
  'blau-quadrat',
];

export const signalModule: PuzzleModule<SignalDef, SignalState, SignalInput, SignalView> = {
  type: 'signal',
  usesEdgework: false,
  wholeCrew: false,
  consoles: 2,
  defSchema,
  inputSchema,

  init(def, rng) {
    const a = shuffle(TOKENS, rng);
    return {
      type: 'signal',
      stage: 0,
      done: 0,
      grids: { a, b: rearranged(a, rng) },
      sequences: Array.from({ length: def.stages }, () => sequenceOf(def.length, rng)),
      lastResult: null,
    };
  },

  apply(_def, state, input, _playerId, ctx) {
    if (ctx.console === null) {
      fail('Dafür musst du am Pult stehen.');
    }
    if (ctx.console === sendingConsole(state.stage)) {
      fail('Dieses Pult sendet — das andere gibt ein.');
    }
    const sequence = state.sequences[state.stage] ?? [];
    const expected = sequence[state.done];
    if (expected === undefined) {
      return { state, solved: false, penalty: null };
    }
    if (input.press !== expected) {
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

  view(_def, state, viewer) {
    const sends = sendingConsole(state.stage);
    const sequence = state.sequences[state.stage] ?? [];
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
      sequence: role === 'sender' || audience ? [...sequence] : null,
      grid: at === null ? null : [...state.grids[at]],
      grids: audience ? { a: [...state.grids.a], b: [...state.grids.b] } : null,
    };
  },

  manual(def) {
    const signs = EXAMPLE.slice(0, def.length).map(tokenLabel).join(', ');
    return [
      {
        heading: 'Signalkette',
        blocks: [
          { kind: 'figure', of: 'signal', caption: 'Abb. 1 — Zwei Signalpulte' },
          {
            kind: 'p',
            text:
              `Zwei Pulte, A und B. Das sendende Pult zeigt eine Folge von ${def.length} ` +
              'Zeichen, das empfangende Pult trägt die zwölf Zeichen als Tasten. Die Folge ' +
              'wird am empfangenden Pult in ihrer Reihenfolge gedrückt; nach jeder Stufe ' +
              'wechselt die Richtung.',
          },
          {
            kind: 'rules',
            items: [
              'Wenn die Nummer der Stufe ungerade ist, sendet Pult A, und Pult B empfängt.',
              'Andernfalls sendet Pult B, und Pult A empfängt.',
              `Wenn alle ${def.length} Zeichen einer Stufe gedrückt sind, beginnt die ` +
                'nächste Stufe.',
              `Wenn Stufe ${def.stages} vollständig gedrückt ist, ist die Signalkette ` +
                'geschlossen.',
              'Wenn ein Zeichen gedrückt wird, das nicht das nächste der Folge ist, beginnt ' +
                'die Stufe von vorn; die Folge bleibt dieselbe.',
              'Wenn am sendenden Pult gedrückt wird, geschieht nichts.',
            ],
          },
          {
            kind: 'example',
            title: 'Beispiel',
            lines: [
              `Stufe 1, Pult A zeigt: ${signs}.`,
              'Stufe 1 ist ungerade: Pult A sendet, Pult B empfängt.',
              `An Pult B gedrückt: ${signs}.`,
              'Stufe 2 beginnt; nun sendet Pult B.',
            ],
          },
          { kind: 'p', text: `Fehlgriff: Alarm, −${def.penaltySec} s.` },
        ],
      },
    ];
  },

  /**
   * The sending console's view holds the sequence: the rest of it, from the
   * presses done so far, is pressed at the other console — by the operator
   * when console a receives, by the partner when console b does.
   */
  solve(_def, { operator, partner }) {
    const sending = [operator, partner].find((view) => view?.role === 'sender');
    if (sending === undefined || sending.sequence === null) {
      return [];
    }
    const by: Move<SignalInput>['by'] = sending.sends === 'a' ? 'partner' : 'operator';
    return sending.sequence.slice(sending.done).map((press) => ({ by, input: { press } }));
  },
};

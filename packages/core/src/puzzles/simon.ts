import { z } from 'zod';
import { serialHasVowel, type Edgework } from '../edgework.js';
import { commonDefShape, type ManualBlock, type PuzzleModule } from './module.js';
import { deviceFigure, penaltyLine, workedExample } from './printed.js';

export const SIMON_COLORS = ['rot', 'blau', 'gruen', 'gelb'] as const;
export type SimonColor = (typeof SIMON_COLORS)[number];

/**
 * simon puzzle (Frequenz-Abgleich): the panel flashes a color sequence in
 * stages — stage k shows the first k colors — and the operator enters each
 * stage's sequence translated through the printed tables. The alarms so far
 * pick the row; under the `kennung` legend the Laborkennung picks one of two
 * tables, so the translation changes from run to run and after each of the
 * first two alarms, while the `einfach` legend prints one table that changes
 * with the first alarm only. A wrong press costs time and restarts the
 * current stage's input; the stage itself is kept.
 */
const defSchema = z.strictObject({
  type: z.literal('simon'),
  ...commonDefShape,
  sequenceLength: z.number().int().min(3).max(8).default(5),
  /** kennung: two tables by vowel, three alarm rows each; einfach: one table, two alarm rows */
  legend: z.enum(['kennung', 'einfach']).default('kennung'),
  penaltySec: z.number().int().positive().default(20),
});
export type SimonDef = z.infer<typeof defSchema>;

export interface SimonState {
  type: 'simon';
  /** the whole flashing sequence; stage k shows its first k colors */
  sequence: SimonColor[];
  /** 1-based: how many colors the current stage flashes */
  stage: number;
  /** correct presses so far in the current stage */
  progress: number;
  /** the last press was wrong */
  lastWrong: boolean;
}

const inputSchema = z.strictObject({ kind: z.literal('press'), color: z.enum(SIMON_COLORS) });
export type SimonInput = z.infer<typeof inputSchema>;

export interface SimonView {
  kind: 'simon';
  /** what the current stage flashes, in order — only operators see it */
  flashes: SimonColor[] | null;
  /** the color buttons in panel order — only operators have them */
  buttons: SimonColor[] | null;
  /** 1-based: stage k flashes the first k colors */
  stage: number;
  stages: number;
  /** correct presses so far in the current stage */
  progress: number;
  lastWrong: boolean;
  /** alarms so far in this run; they pick the table row, so everyone sees them */
  alarms: number;
}

/** Flashed color → color to press, for one table row. */
type Translation = Readonly<Record<SimonColor, SimonColor>>;
/** One row per alarm count from 0; the last row also holds for every count above it. */
type TranslationTable = readonly Translation[];

/*
 * Every row is a permutation and none is the identity. Within a table the
 * rows differ in every column, so an alarm changes every translation; the
 * two tables differ in every cell, so misreading the Laborkennung shows on
 * the first press. Each color stays itself in exactly one row of the six.
 */
const WITH_VOWEL: TranslationTable = [
  { rot: 'rot', blau: 'gelb', gruen: 'blau', gelb: 'gruen' },
  { rot: 'blau', blau: 'gruen', gruen: 'gelb', gelb: 'rot' },
  { rot: 'gelb', blau: 'rot', gruen: 'gruen', gelb: 'blau' },
];
const WITHOUT_VOWEL: TranslationTable = [
  { rot: 'blau', blau: 'gruen', gruen: 'rot', gelb: 'gelb' },
  { rot: 'gelb', blau: 'rot', gruen: 'blau', gelb: 'gruen' },
  { rot: 'gruen', blau: 'blau', gruen: 'gelb', gelb: 'rot' },
];
/*
 * The `einfach` legend's one table: each row swaps two pairs, so no color
 * stays itself, and the rows differ in every column, so the first alarm
 * changes every translation.
 */
const SIMPLE: TranslationTable = [
  { rot: 'blau', blau: 'rot', gruen: 'gelb', gelb: 'gruen' },
  { rot: 'gruen', blau: 'gelb', gruen: 'rot', gelb: 'blau' },
];

const COLOR_NAMES: Record<SimonColor, string> = {
  rot: 'rot',
  blau: 'blau',
  gruen: 'grün',
  gelb: 'gelb',
};
const ROW_LABELS: Record<SimonDef['legend'], readonly string[]> = {
  kennung: ['0 Alarme', '1 Alarm', '≥ 2 Alarme'],
  einfach: ['0 Alarme', '1 oder mehr Alarme'],
};

/** The worked example by legend: stage 2's two flashes, translated by the printed row. */
const EXAMPLES: Record<SimonDef['legend'], readonly string[]> = {
  kennung: [
    'Gesehen: Stufe 2 blinkt rot, dann grün. Kennung ohne A, E und U; 1 Alarm am Panel.',
    'Tabelle „Ohne Vokal“, Zeile „1 Alarm“: rot ergibt gelb, grün ergibt blau.',
    'Gedrückt: gelb, dann blau.',
  ],
  einfach: [
    'Gesehen: Stufe 2 blinkt rot, dann grün; 0 Alarme am Panel.',
    'Zeile „0 Alarme“: rot ergibt blau, grün ergibt gelb.',
    'Gedrückt: blau, dann gelb.',
  ],
};

/** The table this run translates with: the legend's, under `kennung` by the Laborkennung. */
function tableFor(def: SimonDef, edgework: Edgework | null): TranslationTable {
  if (def.legend === 'einfach') {
    return SIMPLE;
  }
  if (edgework === null) {
    throw new Error(
      `simon "${def.id}": the translation reads the Laborkennung, ` +
        'but nobody has read the sign yet',
    );
  }
  return serialHasVowel(edgework) ? WITH_VOWEL : WITHOUT_VOWEL;
}

/** The color to press for `flashed`: the table's row for the alarms so far. */
function pressFor(table: TranslationTable, flashed: SimonColor, alarms: number): SimonColor {
  const row = table[Math.min(alarms, table.length - 1)];
  if (row === undefined) {
    throw new Error(`simon: no table row for ${alarms} alarms`);
  }
  return row[flashed];
}

function tableBlock(
  label: string,
  table: TranslationTable,
  rowLabels: readonly string[],
): ManualBlock {
  return {
    kind: 'table',
    head: [label, ...SIMON_COLORS.map((color) => COLOR_NAMES[color])],
    rows: table.map((row, i) => [
      rowLabels[i] ?? '',
      ...SIMON_COLORS.map((color) => COLOR_NAMES[row[color]]),
    ]),
  };
}

/** What the legend prints between the device paragraph and the example: its tables. */
function legendBlocks(legend: SimonDef['legend']): ManualBlock[] {
  if (legend === 'einfach') {
    return [tableBlock('Blinkt', SIMPLE, ROW_LABELS.einfach)];
  }
  return [
    {
      kind: 'rules',
      items: [
        'Wenn die Laborkennung ein A, E oder U enthält, gilt die Tabelle „Mit Vokal“.',
        'Andernfalls gilt die Tabelle „Ohne Vokal“.',
      ],
    },
    tableBlock('Mit Vokal', WITH_VOWEL, ROW_LABELS.kennung),
    tableBlock('Ohne Vokal', WITHOUT_VOWEL, ROW_LABELS.kennung),
  ];
}

export const simonModule: PuzzleModule<SimonDef, SimonState, SimonInput, SimonView> = {
  type: 'simon',
  usesEdgework: true,
  wholeCrew: false,
  defSchema,
  inputSchema,

  init(def, rng) {
    const sequence: SimonColor[] = [];
    while (sequence.length < def.sequenceLength) {
      const color = SIMON_COLORS[Math.floor(rng() * SIMON_COLORS.length)] ?? 'rot';
      // Avoid immediate repeats — they are hard to count when flashing.
      if (sequence[sequence.length - 1] !== color) {
        sequence.push(color);
      }
    }
    return { type: 'simon', sequence, stage: 1, progress: 0, lastWrong: false };
  },

  apply(def, state, input, _playerId, ctx) {
    const flashed = state.sequence[state.progress];
    if (flashed === undefined || state.progress >= state.stage) {
      return { state, solved: false, penalty: null };
    }
    if (input.color !== pressFor(tableFor(def, ctx.edgework), flashed, ctx.alarms)) {
      return {
        state: { ...state, progress: 0, lastWrong: true },
        solved: false,
        penalty: 'Falscher Steuerimpuls',
      };
    }
    const progress = state.progress + 1;
    if (progress < state.stage) {
      return { state: { ...state, progress, lastWrong: false }, solved: false, penalty: null };
    }
    if (state.stage < state.sequence.length) {
      return {
        state: { ...state, stage: state.stage + 1, progress: 0, lastWrong: false },
        solved: false,
        penalty: null,
      };
    }
    return { state: { ...state, progress, lastWrong: false }, solved: true, penalty: null };
  },

  view(_def, state, viewer, ctx) {
    return {
      kind: 'simon',
      flashes: viewer.operating ? state.sequence.slice(0, state.stage) : null,
      buttons: viewer.operating ? [...SIMON_COLORS] : null,
      stage: state.stage,
      stages: state.sequence.length,
      progress: state.progress,
      lastWrong: state.lastWrong,
      alarms: ctx.alarms,
    };
  },

  manual(def) {
    const table = def.legend === 'kennung' ? 'In der geltenden Tabelle' : 'In der Tabelle';
    return [
      {
        heading: 'Frequenz-Abgleich',
        blocks: [
          deviceFigure('simon', 'Panel mit Farbtasten'),
          {
            kind: 'p',
            text:
              'Ein Panel mit 4 Farbtasten blinkt eine Farbfolge in Stufen: Stufe 1 zeigt die ' +
              'erste Farbe, Stufe 2 die ersten 2 und so fort bis Stufe ' +
              `${def.sequenceLength}. Jede Stufe wird ganz eingegeben, in der gezeigten ` +
              'Reihenfolge, jede Farbe übersetzt. ' +
              `${table} bestimmt der Alarmstand am Panel die Zeile und die blinkende Farbe ` +
              'die Spalte; das Feld nennt die Taste.',
          },
          ...legendBlocks(def.legend),
          workedExample(EXAMPLES[def.legend]),
          penaltyLine(
            def.penaltySec,
            'Die Stufe beginnt von vorn, mit der Zeile für den neuen Alarmstand.',
          ),
        ],
      },
    ];
  },

  solve(def, { operator }, edgework) {
    const table = tableFor(def, edgework);
    if (operator.flashes === null) {
      throw new Error(`simon "${def.id}": solving needs the operator's view`);
    }
    const flashed = operator.flashes[operator.progress];
    if (flashed === undefined) {
      return [];
    }
    const color = pressFor(table, flashed, operator.alarms);
    return [{ by: 'operator', input: { kind: 'press', color } }];
  },
};

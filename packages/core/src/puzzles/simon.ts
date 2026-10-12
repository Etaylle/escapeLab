import { z } from 'zod';
import { serialHasVowel, type Edgework } from '../edgework.js';
import { fail } from '../errors.js';
import { commonDefShape, type ManualBlock, type PuzzleModule } from './module.js';

export const SIMON_COLORS = ['rot', 'blau', 'gruen', 'gelb'] as const;
export type SimonColor = (typeof SIMON_COLORS)[number];

/**
 * simon puzzle (Frequenz-Abgleich): the panel flashes a color sequence in
 * stages — stage k shows the first k colors — and the operator enters each
 * stage's sequence translated through the printed tables. The Laborkennung
 * picks the table and the alarms so far pick the row, so the translation
 * changes from run to run and after every alarm. A wrong press costs time
 * and restarts the current stage's input; the stage itself is kept.
 */
const defSchema = z.object({
  type: z.literal('simon'),
  ...commonDefShape,
  operatorRoleId: z.string().min(1),
  manualRoleId: z.string().min(1),
  sequenceLength: z.number().int().min(3).max(8).default(5),
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
  /** what the current stage flashes, in order — only the operator sees it */
  flashes: SimonColor[] | null;
  /** the color buttons in panel order — only the operator has them */
  buttons: SimonColor[] | null;
  /** 1-based: stage k flashes the first k colors */
  stage: number;
  stages: number;
  /** correct presses so far in the current stage */
  progress: number;
  lastWrong: boolean;
  /** alarms so far in this run; they pick the table row, so every role sees them */
  alarms: number;
}

/** Flashed color → color to press, for one table row. */
type Translation = Readonly<Record<SimonColor, SimonColor>>;
/** One row per alarm count: 0, 1, 2 or more. */
type TranslationTable = readonly [Translation, Translation, Translation];

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

const COLOR_NAMES: Record<SimonColor, string> = {
  rot: 'rot',
  blau: 'blau',
  gruen: 'grün',
  gelb: 'gelb',
};
const ROW_LABELS = ['0 Alarme', '1 Alarm', '≥ 2 Alarme'] as const;

function rowFor(alarms: number): 0 | 1 | 2 {
  if (alarms <= 0) {
    return 0;
  }
  return alarms === 1 ? 1 : 2;
}

/** The color to press for `flashed` under this run's Laborkennung and alarm count. */
function pressFor(flashed: SimonColor, edgework: Edgework, alarms: number): SimonColor {
  const table = serialHasVowel(edgework) ? WITH_VOWEL : WITHOUT_VOWEL;
  return table[rowFor(alarms)][flashed];
}

function tableBlock(label: string, table: TranslationTable): ManualBlock {
  return {
    kind: 'table',
    head: [label, ...SIMON_COLORS.map((color) => COLOR_NAMES[color])],
    rows: table.map((row, i) => [
      ROW_LABELS[i] ?? '',
      ...SIMON_COLORS.map((color) => COLOR_NAMES[row[color]]),
    ]),
  };
}

export const simonModule: PuzzleModule<SimonDef, SimonState, SimonInput, SimonView> = {
  type: 'simon',
  usesEdgework: true,
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

  apply(def, state, input, roleId, ctx) {
    if (roleId !== def.operatorRoleId) {
      fail('Nur die Rolle am Frequenz-Panel kann Tasten drücken.');
    }
    const flashed = state.sequence[state.progress];
    if (flashed === undefined || state.progress >= state.stage) {
      return { state, solved: false, penalty: null };
    }
    if (input.color !== pressFor(flashed, ctx.edgework, ctx.alarms)) {
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

  view(def, state, roleId, ctx) {
    const isOperator = roleId === def.operatorRoleId;
    return {
      kind: 'simon',
      flashes: isOperator ? state.sequence.slice(0, state.stage) : null,
      buttons: isOperator ? [...SIMON_COLORS] : null,
      stage: state.stage,
      stages: state.sequence.length,
      progress: state.progress,
      lastWrong: state.lastWrong,
      alarms: ctx.alarms,
    };
  },

  manual(def) {
    return [
      {
        heading: 'Frequenz-Abgleich',
        blocks: [
          {
            kind: 'p',
            text:
              'Das Panel blinkt in Stufen: Stufe 1 zeigt eine Farbe, jede weitere Stufe eine ' +
              `mehr, bis ${def.sequenceLength}. Jede Stufe ganz übersetzen und in derselben ` +
              'Reihenfolge tippen. Tabelle „Mit Vokal“, wenn die Laborkennung A, E oder U ' +
              'enthält, sonst „Ohne Vokal“. Zeile nach dem Alarmstand am Panel, Spalte nach ' +
              'der blinkenden Farbe; das Feld nennt die Taste. Falsche Taste: Alarm, ' +
              `−${def.penaltySec} s, die Stufe beginnt von vorn – mit der Zeile für den ` +
              'neuen Alarmstand.',
          },
          tableBlock('Mit Vokal', WITH_VOWEL),
          tableBlock('Ohne Vokal', WITHOUT_VOWEL),
        ],
      },
    ];
  },

  solve(def, views, edgework) {
    if (edgework === null) {
      throw new Error(
        `simon "${def.id}": the translation reads the Laborkennung, but no role sees the edgework`,
      );
    }
    const operator = views[def.operatorRoleId];
    if (operator?.flashes == null) {
      throw new Error(`simon "${def.id}": solving needs the operator's view`);
    }
    const flashed = operator.flashes[operator.progress];
    if (flashed === undefined) {
      return [];
    }
    const color = pressFor(flashed, edgework, operator.alarms);
    return [{ roleId: def.operatorRoleId, input: { kind: 'press', color } }];
  },
};

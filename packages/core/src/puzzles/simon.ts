import { z } from 'zod';
import { fail } from '../errors.js';
import { shuffle } from '../rng.js';
import { commonDefShape, type PuzzleModule } from './module.js';

export const SIMON_COLORS = ['rot', 'gruen', 'blau', 'gelb'] as const;
export type SimonColor = (typeof SIMON_COLORS)[number];

/**
 * simon puzzle: the operator watches a flashing color sequence and owns the
 * symbol buttons; the manual role holds the color→symbol legend (generated
 * per game). Wrong press resets progress and costs time.
 */
const defSchema = z
  .object({
    type: z.literal('simon'),
    ...commonDefShape,
    operatorRoleId: z.string().min(1),
    manualRoleId: z.string().min(1),
    buttonSymbols: z.array(z.string().min(1)).length(4),
    sequenceLength: z.number().int().min(3).max(8).default(5),
    penaltySec: z.number().int().positive().default(20),
  })
  .superRefine((def, ctx) => {
    if (new Set(def.buttonSymbols).size !== def.buttonSymbols.length) {
      ctx.addIssue({ code: 'custom', message: `puzzle "${def.id}": button symbols not unique` });
    }
  });
export type SimonDef = z.infer<typeof defSchema>;

export interface SimonState {
  type: 'simon';
  /** flashing sequence, visible to the operator */
  sequence: SimonColor[];
  /** color→symbol mapping, visible to the manual role */
  mapping: Record<SimonColor, string>;
  /** symbol buttons in panel order (shuffled per game) */
  buttonOrder: string[];
  progress: number;
  lastWrongIndex: number | null;
}

const inputSchema = z.strictObject({ buttonIndex: z.number().int().nonnegative() });
export type SimonInput = z.infer<typeof inputSchema>;

export interface SimonView {
  kind: 'simon';
  /** flashing color sequence — only the operator gets it */
  sequence: string[] | null;
  /** symbol buttons in panel order — only the operator gets them */
  buttons: string[] | null;
  /** color→symbol legend — only the manual role gets it */
  legend: { color: string; symbol: string }[] | null;
  progress: number;
  seqLength: number;
  lastWrongIndex: number | null;
}

export const simonModule: PuzzleModule<SimonDef, SimonState, SimonInput, SimonView> = {
  type: 'simon',
  usesEdgework: false,
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
    const shuffledSymbols = shuffle(def.buttonSymbols, rng);
    const mapping = {} as Record<SimonColor, string>;
    SIMON_COLORS.forEach((color, i) => {
      mapping[color] = shuffledSymbols[i] ?? def.buttonSymbols[i] ?? '?';
    });
    return {
      type: 'simon',
      sequence,
      mapping,
      buttonOrder: shuffle(def.buttonSymbols, rng),
      progress: 0,
      lastWrongIndex: null,
    };
  },

  apply(def, state, input, roleId) {
    if (roleId !== def.operatorRoleId) {
      fail('Nur die Rolle am Frequenz-Panel kann Tasten drücken.');
    }
    const symbol = state.buttonOrder[input.buttonIndex];
    const expectedColor = state.sequence[state.progress];
    if (symbol === undefined || expectedColor === undefined) {
      return { state, solved: false, penalty: null };
    }
    if (symbol !== state.mapping[expectedColor]) {
      return {
        state: { ...state, progress: 0, lastWrongIndex: input.buttonIndex },
        solved: false,
        penalty: 'Falscher Steuerimpuls',
      };
    }
    const progress = state.progress + 1;
    return {
      state: { ...state, progress, lastWrongIndex: null },
      solved: progress >= state.sequence.length,
      penalty: null,
    };
  },

  view(def, state, roleId) {
    const isDisplay = roleId === def.operatorRoleId;
    return {
      kind: 'simon',
      sequence: isDisplay ? [...state.sequence] : null,
      buttons: isDisplay ? [...state.buttonOrder] : null,
      legend:
        roleId === def.manualRoleId
          ? Object.entries(state.mapping).map(([color, symbol]) => ({ color, symbol }))
          : null,
      progress: state.progress,
      seqLength: state.sequence.length,
      lastWrongIndex: isDisplay ? state.lastWrongIndex : null,
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
              `Das Panel blinkt eine Folge aus ${def.sequenceLength} Farben. Jede Farbe steht ` +
              'für einen Steuerimpuls.',
          },
          {
            kind: 'rules',
            items: [
              'Welcher Impuls zu welcher Farbe gehört, zeigt die Legende. ' +
                'Sie wechselt mit jedem Einsatz.',
              'Folge Farbe für Farbe übersetzen, Impulse in derselben Reihenfolge tippen.',
              `Falscher Impuls: Alarm, −${def.penaltySec} s. Die Folge beginnt von vorn.`,
            ],
          },
        ],
      },
    ];
  },

  solve(def, views) {
    const display = views[def.operatorRoleId];
    const legend = views[def.manualRoleId]?.legend;
    if (display?.sequence == null || display.buttons === null || legend == null) {
      throw new Error(`simon "${def.id}": solving needs the display and the legend views`);
    }
    const color = display.sequence[display.progress];
    const symbol = legend.find((entry) => entry.color === color)?.symbol;
    const buttonIndex = display.buttons.findIndex((button) => button === symbol);
    return buttonIndex < 0 ? [] : [{ roleId: def.operatorRoleId, input: { buttonIndex } }];
  },
};

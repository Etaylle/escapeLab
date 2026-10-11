import { z } from 'zod';
import { fail } from '../errors.js';
import { shuffle } from '../rng.js';
import { commonDefShape, type PuzzleModule } from './module.js';

/**
 * keypad puzzle: the operator sees `gridSymbols` as a shuffled keypad and
 * must press the symbols of `code` in order. A wrong press resets progress
 * and costs time.
 */
const defSchema = z
  .object({
    type: z.literal('keypad'),
    ...commonDefShape,
    operatorRoleId: z.string().min(1),
    manualRoleId: z.string().min(1),
    gridSymbols: z.array(z.string().min(1)).min(4),
    code: z.array(z.string().min(1)).min(2),
    penaltySec: z.number().int().positive().default(20),
  })
  .superRefine((def, ctx) => {
    const grid = new Set(def.gridSymbols);
    if (grid.size !== def.gridSymbols.length) {
      ctx.addIssue({ code: 'custom', message: `puzzle "${def.id}": grid symbols not unique` });
    }
    if (new Set(def.code).size !== def.code.length) {
      ctx.addIssue({ code: 'custom', message: `puzzle "${def.id}": code symbols not unique` });
    }
    if (def.code.some((s) => !grid.has(s))) {
      ctx.addIssue({ code: 'custom', message: `puzzle "${def.id}": code symbol not on grid` });
    }
  });
export type KeypadDef = z.infer<typeof defSchema>;

export interface KeypadState {
  type: 'keypad';
  /** keypad layout, shuffled per game */
  grid: string[];
  /** how many code symbols were entered correctly so far */
  progress: number;
  lastWrongIndex: number | null;
}

const inputSchema = z.strictObject({ keyIndex: z.number().int().nonnegative() });
export type KeypadInput = z.infer<typeof inputSchema>;

export interface KeypadView {
  kind: 'keypad';
  /** keypad layout — only the operator gets it */
  grid: { symbol: string; done: boolean }[] | null;
  progress: number;
  codeLength: number;
  lastWrongIndex: number | null;
}

export const keypadModule: PuzzleModule<KeypadDef, KeypadState, KeypadInput, KeypadView> = {
  type: 'keypad',
  usesEdgework: false,
  defSchema,
  inputSchema,

  init: (def, rng) => ({
    type: 'keypad',
    grid: shuffle(def.gridSymbols, rng),
    progress: 0,
    lastWrongIndex: null,
  }),

  apply(def, state, input, roleId) {
    if (roleId !== def.operatorRoleId) {
      fail('Nur die Rolle am Tastenfeld kann Codes eingeben.');
    }
    const symbol = state.grid[input.keyIndex];
    if (symbol === undefined) {
      return { state, solved: false, penalty: null };
    }
    if (symbol !== def.code[state.progress]) {
      return {
        state: { ...state, progress: 0, lastWrongIndex: input.keyIndex },
        solved: false,
        penalty: 'Falsche Taste am Code',
      };
    }
    const progress = state.progress + 1;
    return {
      state: { ...state, progress, lastWrongIndex: null },
      solved: progress >= def.code.length,
      penalty: null,
    };
  },

  view(def, state, roleId) {
    const isInput = roleId === def.operatorRoleId;
    const done = new Set(def.code.slice(0, state.progress));
    return {
      kind: 'keypad',
      grid: isInput ? state.grid.map((symbol) => ({ symbol, done: done.has(symbol) })) : null,
      progress: state.progress,
      codeLength: def.code.length,
      lastWrongIndex: isInput ? state.lastWrongIndex : null,
    };
  },

  manual(def) {
    return [
      {
        heading: 'Tastenfeld',
        blocks: [
          {
            kind: 'p',
            text:
              `${def.gridSymbols.length} Tasten mit je einem Zeichen. Der Code hat ` +
              `${def.code.length} Zeichen in fester Reihenfolge.`,
          },
          {
            kind: 'rules',
            items: [
              'Den Code führen die Unterlagen der Crew.',
              'Zeichen genau beschreiben, erst nach Ansage tippen.',
              `Falsches Zeichen: Alarm, −${def.penaltySec} s. Die Eingabe beginnt von vorn.`,
            ],
          },
        ],
      },
    ];
  },

  /** The code is the mission's own text (the infos), so it comes from the def. */
  solve(def, views) {
    const panel = views[def.operatorRoleId];
    if (panel?.grid == null) {
      throw new Error(`keypad "${def.id}": solving needs the operator's view of the keypad`);
    }
    const keyIndex = panel.grid.findIndex((key) => key.symbol === def.code[panel.progress]);
    return keyIndex < 0 ? [] : [{ roleId: def.operatorRoleId, input: { keyIndex } }];
  },
};

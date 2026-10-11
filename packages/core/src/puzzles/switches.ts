import { z } from 'zod';
import { fail } from '../errors.js';
import { shuffle } from '../rng.js';
import { commonDefShape, type PuzzleModule } from './module.js';

/**
 * switches puzzle: the operator sees a bank of toggle switches (shuffled per
 * game); the manual role sees which symbols must be ON (chosen per game).
 * Toggling is free, committing a wrong configuration costs time.
 */
const defSchema = z
  .object({
    type: z.literal('switches'),
    ...commonDefShape,
    operatorRoleId: z.string().min(1),
    manualRoleId: z.string().min(1),
    symbols: z.array(z.string().min(1)).min(4).max(10),
    onCount: z.number().int().positive(),
    penaltySec: z.number().int().positive().default(20),
  })
  .superRefine((def, ctx) => {
    if (new Set(def.symbols).size !== def.symbols.length) {
      ctx.addIssue({ code: 'custom', message: `puzzle "${def.id}": symbols not unique` });
    }
    if (def.onCount >= def.symbols.length) {
      ctx.addIssue({
        code: 'custom',
        message: `puzzle "${def.id}": onCount must be below the number of switches`,
      });
    }
  });
export type SwitchesDef = z.infer<typeof defSchema>;

export interface SwitchesState {
  type: 'switches';
  /** switch symbols in panel order (shuffled per game) */
  order: string[];
  on: boolean[];
  /** symbols that must be ON (chosen per game) */
  target: string[];
  lastResult: 'wrong' | null;
}

const inputSchema = z.union([
  z.strictObject({ switchIndex: z.number().int().nonnegative() }),
  z.strictObject({ commit: z.literal(true) }),
]);
export type SwitchesInput = z.infer<typeof inputSchema>;

export interface SwitchesView {
  kind: 'switches';
  /** switch bank — only the operator gets it */
  switches: { symbol: string; on: boolean }[] | null;
  /** symbols that must be ON — only the manual role gets it */
  target: string[] | null;
  targetCount: number;
  lastResult: 'wrong' | null;
}

function toggle(state: SwitchesState, index: number): SwitchesState {
  if (index < 0 || index >= state.on.length) {
    return state;
  }
  const on = state.on.map((v, i) => (i === index ? !v : v));
  return { ...state, on, lastResult: null };
}

function isCorrect(state: SwitchesState): boolean {
  const onSymbols = state.order.filter((_, i) => state.on[i] === true).sort();
  return (
    onSymbols.length === state.target.length && onSymbols.every((s, i) => s === state.target[i])
  );
}

export const switchesModule: PuzzleModule<
  SwitchesDef,
  SwitchesState,
  SwitchesInput,
  SwitchesView
> = {
  type: 'switches',
  usesEdgework: false,
  defSchema,
  inputSchema,

  init(def, rng) {
    const order = shuffle(def.symbols, rng);
    const target = shuffle(def.symbols, rng).slice(0, def.onCount).sort();
    return { type: 'switches', order, on: order.map(() => false), target, lastResult: null };
  },

  apply(def, state, input, roleId) {
    const commit = 'commit' in input;
    if (roleId !== def.operatorRoleId) {
      fail(
        commit
          ? 'Nur die Rolle an der Schalterbank kann prüfen.'
          : 'Nur die Rolle an der Schalterbank kann schalten.',
      );
    }
    if (!commit) {
      return { state: toggle(state, input.switchIndex), solved: false, penalty: null };
    }
    return isCorrect(state)
      ? { state: { ...state, lastResult: null }, solved: true, penalty: null }
      : {
          state: { ...state, lastResult: 'wrong' },
          solved: false,
          penalty: 'Falsche Schalterkombination',
        };
  },

  view(def, state, roleId) {
    const isPanel = roleId === def.operatorRoleId;
    return {
      kind: 'switches',
      switches: isPanel
        ? state.order.map((symbol, i) => ({ symbol, on: state.on[i] === true }))
        : null,
      target: roleId === def.manualRoleId ? state.target : null,
      targetCount: def.onCount,
      lastResult: isPanel ? state.lastResult : null,
    };
  },

  manual(def) {
    return [
      {
        heading: 'Schalterbank',
        blocks: [
          {
            kind: 'p',
            text:
              `${def.symbols.length} Kippschalter mit je einem Zeichen. Genau ${def.onCount} ` +
              'gehören nach OBEN, alle anderen nach UNTEN.',
          },
          {
            kind: 'rules',
            items: [
              'Welche nach oben gehören, zeigt die Sollwertanzeige. ' +
                'Sie wechselt mit jedem Einsatz.',
              'Umlegen ist gefahrlos.',
              `PRÜFEN mit falscher Stellung: Alarm, −${def.penaltySec} s.`,
            ],
          },
        ],
      },
    ];
  },

  solve(def, views) {
    const panel = views[def.operatorRoleId]?.switches;
    const target = views[def.manualRoleId]?.target;
    if (panel == null || target == null) {
      throw new Error(`switches "${def.id}": solving needs the panel and the target views`);
    }
    const switchIndex = panel.findIndex((sw) => sw.on !== target.includes(sw.symbol));
    return [
      {
        roleId: def.operatorRoleId,
        input: switchIndex < 0 ? { commit: true } : { switchIndex },
      },
    ];
  },
};

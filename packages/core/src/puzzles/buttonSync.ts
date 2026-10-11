import { z } from 'zod';
import { fail } from '../errors.js';
import { commonDefShape, type PuzzleModule } from './module.js';

/**
 * button-sync puzzle: every role listed in `buttons` must press its button.
 * With `windowMs` set, all presses must happen within that window of each
 * other, otherwise they expire and the team must retry. Every listed role is
 * an operator; there is no manual role.
 */
const defSchema = z.object({
  type: z.literal('button-sync'),
  ...commonDefShape,
  buttons: z.array(z.object({ roleId: z.string(), label: z.string() })).min(1),
  windowMs: z.number().int().positive().optional(),
  /** carried like on every module, but no rule here charges it: a missed window costs an attempt */
  penaltySec: z.number().int().positive().default(20),
});
export type ButtonSyncDef = z.infer<typeof defSchema>;

/** Runtime state of a button-sync puzzle. Timestamps are epoch ms taken from actions. */
export interface ButtonSyncState {
  type: 'button-sync';
  /** roleId -> epoch ms of the (still valid) press */
  pressed: Record<string, number>;
  attempts: number;
  lastResult: 'missed-window' | null;
}

const inputSchema = z.strictObject({ press: z.literal(true) });
export type ButtonSyncInput = z.infer<typeof inputSchema>;

export interface ButtonSyncView {
  kind: 'button-sync';
  buttonLabel: string | null;
  youPressed: boolean;
  pressedCount: number;
  requiredCount: number;
  attempts: number;
  lastResult: 'missed-window' | null;
}

/**
 * Apply a press by `roleId` at time `at`. With a window configured, presses
 * older than `windowMs` relative to `at` expire; expiring a press counts as a
 * failed attempt and is surfaced via `lastResult`.
 */
function press(
  def: ButtonSyncDef,
  state: ButtonSyncState,
  roleId: string,
  at: number,
): { state: ButtonSyncState; solved: boolean } {
  const pressed: Record<string, number> = {};
  let expired = false;
  for (const [role, time] of Object.entries(state.pressed)) {
    if (def.windowMs !== undefined && at - time > def.windowMs) {
      expired = true;
    } else {
      pressed[role] = time;
    }
  }
  pressed[roleId] = at;

  const solved = def.buttons.every((b) => pressed[b.roleId] !== undefined);
  return {
    state: {
      type: 'button-sync',
      pressed,
      attempts: expired ? state.attempts + 1 : state.attempts,
      lastResult: expired ? 'missed-window' : null,
    },
    solved,
  };
}

/** "2,5" for 2500 ms — German decimal comma. */
const seconds = (ms: number): string => String(ms / 1000).replace('.', ',');

export const buttonSyncModule: PuzzleModule<
  ButtonSyncDef,
  ButtonSyncState,
  ButtonSyncInput,
  ButtonSyncView
> = {
  type: 'button-sync',
  usesEdgework: false,
  defSchema,
  inputSchema,

  init: () => ({ type: 'button-sync', pressed: {}, attempts: 0, lastResult: null }),

  apply(def, state, _input, roleId, ctx) {
    if (!def.buttons.some((b) => b.roleId === roleId)) {
      fail('Deine Rolle hat bei diesem Rätsel keinen Knopf.');
    }
    return { ...press(def, state, roleId, ctx.at), penalty: null };
  },

  view(def, state, roleId) {
    const button = def.buttons.find((b) => b.roleId === roleId);
    return {
      kind: 'button-sync',
      buttonLabel: button?.label ?? null,
      youPressed: roleId !== null && state.pressed[roleId] !== undefined,
      pressedCount: Object.keys(state.pressed).length,
      requiredCount: def.buttons.length,
      attempts: state.attempts,
      lastResult: state.lastResult,
    };
  },

  manual(def) {
    const labels = def.buttons.map((b) => b.label).join(', ');
    const rules =
      def.windowMs === undefined
        ? ['Reihenfolge und Abstand sind egal. Jeder Knopf muss gedrückt sein.']
        : [
            `Alle Knöpfe innerhalb von ${seconds(def.windowMs)} Sekunden drücken.`,
            'Zu langsam: Die Drücke verfallen, der Versuch beginnt von vorn.',
            'Gemeinsam einzählen: drei — zwei — eins — JETZT.',
          ];
    return [
      {
        heading: 'Synchronschaltung',
        blocks: [
          {
            kind: 'p',
            text:
              def.buttons.length === 1
                ? `Ein Knopf: ${labels}.`
                : `${def.buttons.length} Knöpfe an getrennten Stationen: ${labels}.`,
          },
          { kind: 'rules', items: rules },
        ],
      },
    ];
  },

  solve(_def, views) {
    return Object.entries(views)
      .filter(([, view]) => view.buttonLabel !== null && !view.youPressed)
      .map(([roleId]) => ({ roleId, input: { press: true } }));
  },
};

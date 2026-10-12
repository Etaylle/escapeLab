import { z } from 'zod';
import { commonDefShape, type PuzzleModule } from './module.js';

/**
 * button-sync puzzle: every connected player must press, standing at the
 * station. With `windowMs` set, all presses must happen within that window
 * of each other, otherwise they expire and the crew must retry. Nobody
 * reads anything here, so the whole crew works the panel.
 */
const defSchema = z.strictObject({
  type: z.literal('button-sync'),
  ...commonDefShape,
  windowMs: z.number().int().positive().optional(),
  /** carried like on every module, but no rule here charges it: a missed window costs an attempt */
  penaltySec: z.number().int().positive().default(20),
});
export type ButtonSyncDef = z.infer<typeof defSchema>;

/** Runtime state of a button-sync puzzle. Timestamps are epoch ms taken from actions. */
export interface ButtonSyncState {
  type: 'button-sync';
  /** playerId -> epoch ms of the (still valid) press */
  pressed: Record<string, number>;
  attempts: number;
  lastResult: 'missed-window' | null;
}

const inputSchema = z.strictObject({ press: z.literal(true) });
export type ButtonSyncInput = z.infer<typeof inputSchema>;

export interface ButtonSyncView {
  kind: 'button-sync';
  youPressed: boolean;
  pressedCount: number;
  /** every connected player has to press */
  requiredCount: number;
  attempts: number;
  lastResult: 'missed-window' | null;
}

/**
 * Apply a press by `playerId` at time `at`. With a window configured,
 * presses older than `windowMs` relative to `at` expire; expiring a press
 * counts as a failed attempt and is surfaced via `lastResult`.
 */
function press(
  def: ButtonSyncDef,
  state: ButtonSyncState,
  playerId: string,
  at: number,
  crew: readonly string[],
): { state: ButtonSyncState; solved: boolean } {
  const pressed: Record<string, number> = {};
  let expired = false;
  for (const [player, time] of Object.entries(state.pressed)) {
    if (def.windowMs !== undefined && at - time > def.windowMs) {
      expired = true;
    } else {
      pressed[player] = time;
    }
  }
  pressed[playerId] = at;

  const solved = crew.every((member) => pressed[member] !== undefined);
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
  wholeCrew: true,
  defSchema,
  inputSchema,

  init: () => ({ type: 'button-sync', pressed: {}, attempts: 0, lastResult: null }),

  apply(def, state, _input, playerId, ctx) {
    return { ...press(def, state, playerId, ctx.at, ctx.crew), penalty: null };
  },

  view(_def, state, viewer, ctx) {
    return {
      kind: 'button-sync',
      youPressed: viewer.playerId !== null && state.pressed[viewer.playerId] !== undefined,
      pressedCount: Object.keys(state.pressed).length,
      requiredCount: ctx.crew.length,
      attempts: state.attempts,
      lastResult: state.lastResult,
    };
  },

  manual(def) {
    const rules =
      def.windowMs === undefined
        ? ['Reihenfolge und Abstand sind egal. Jeder muss gedrückt haben.']
        : [
            `Alle innerhalb von ${seconds(def.windowMs)} Sekunden drücken.`,
            'Zu langsam: Die Drücke verfallen, der Versuch beginnt von vorn.',
            'Gemeinsam einzählen: drei — zwei — eins — JETZT.',
          ];
    return [
      {
        heading: 'Synchronschaltung',
        blocks: [
          { kind: 'p', text: 'Die ganze Crew an die Station, jeder drückt einmal.' },
          { kind: 'rules', items: rules },
        ],
      },
    ];
  },

  solve: () => [{ by: 'everyone', input: { press: true } }],
};

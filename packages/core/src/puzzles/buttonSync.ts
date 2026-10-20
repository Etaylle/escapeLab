import { z } from 'zod';
import { commonDefShape, type PuzzleModule } from './module.js';
import { deviceFigure, workedExample } from './printed.js';

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
  /** what the panel looks like: one mushroom button, or a main switch with a lever for each */
  style: z.enum(['button', 'lever']).default('button'),
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
  /** the panel's look, from the def */
  style: ButtonSyncDef['style'];
  youPressed: boolean;
  pressedCount: number;
  /** every connected player has to press */
  requiredCount: number;
  /** how many of them stand at the station right now, the viewer among them where they do */
  here: number;
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

/** "2,5 Sekunden" for 2500 ms, "1 Sekunde" for 1000 — German decimal comma. */
const duration = (ms: number): string =>
  `${String(ms / 1000).replace('.', ',')} Sekunde${ms === 1000 ? '' : 'n'}`;

/**
 * The rules and the worked example, by the def's window: without one, every
 * press counts whenever it comes; with one, a late press lets the first expire.
 */
function printedRules(windowMs: number | undefined): { rules: string[]; example: string[] } {
  if (windowMs === undefined) {
    return {
      rules: [
        'Wenn jedes Crewmitglied einmal gedrückt hat, schließt die Schaltung; Reihenfolge ' +
          'und Abstand zählen nicht.',
      ],
      example: [
        'Crew aus 3 Personen.',
        'Gedrückt: die erste sofort, die zweite 10 Sekunden später, die dritte nach 1 Minute.',
        'Alle 3 haben gedrückt: Die Schaltung schließt.',
      ],
    };
  }
  return {
    rules: [
      `Wenn alle Crewmitglieder innerhalb von ${duration(windowMs)} gedrückt haben, ` +
        'schließt die Schaltung.',
      `Andernfalls verfallen die Drücke, die älter als ${duration(windowMs)} sind; sie ` +
        'zählen nicht mehr.',
    ],
    example: [
      'Crew aus 2 Personen.',
      `Die zweite drückt ${duration(windowMs + 1000)} nach der ersten: Der erste Druck ist ` +
        'verfallen.',
      `Die erste drückt erneut, ${duration(windowMs / 2)} später: Beide liegen innerhalb ` +
        `von ${duration(windowMs)}, die Schaltung schließt.`,
    ],
  };
}

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

  view(def, state, viewer, ctx) {
    return {
      kind: 'button-sync',
      style: def.style,
      youPressed: viewer.playerId !== null && state.pressed[viewer.playerId] !== undefined,
      pressedCount: Object.keys(state.pressed).length,
      requiredCount: ctx.crew.length,
      here: ctx.operators.filter((id) => ctx.crew.includes(id)).length,
      attempts: state.attempts,
      lastResult: state.lastResult,
    };
  },

  manual(def) {
    const { rules, example } = printedRules(def.windowMs);
    return [
      {
        heading: 'Synchronschaltung',
        blocks: [
          deviceFigure('button-sync', 'Pult mit Synchrontaste'),
          {
            kind: 'p',
            text:
              'Eine Taste für die ganze Crew: Jedes Crewmitglied steht dabei am Pult und ' +
              'drückt sie einmal.',
          },
          { kind: 'rules', items: rules },
          workedExample(example),
          // Nothing here raises an alarm — a missed window only costs the attempt.
          { kind: 'p', text: 'Fehlgriff: kein Alarm, keine Zeitstrafe.' },
        ],
      },
    ];
  },

  solve: () => [{ by: 'everyone', input: { press: true } }],
};

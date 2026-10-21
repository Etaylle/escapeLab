import { z } from 'zod';
import { commonDefShape, type PuzzleModule } from './module.js';
import { deviceFigure, workedExample } from './printed.js';

/**
 * button-sync puzzle: every connected player must press, standing at the
 * station. With `windowMs` set, a press lives that long: the station closes
 * once every player's press is live at the same moment, and a press that
 * runs out is dropped — its owner's device says so, and nothing is charged.
 * Without a window every press counts whenever it comes. Nobody reads
 * anything here, so the whole crew works the panel.
 */
const defSchema = z.strictObject({
  type: z.literal('button-sync'),
  ...commonDefShape,
  windowMs: z.number().int().positive().optional(),
  /** carried like on every module, but no rule here charges it: a press that ran out is redone */
  penaltySec: z.number().int().positive().default(20),
  /** what the panel looks like: one mushroom button, or a main switch with a lever for each */
  style: z.enum(['button', 'lever']).default('button'),
});
export type ButtonSyncDef = z.infer<typeof defSchema>;

/** Runtime state of a button-sync puzzle. Timestamps are epoch ms taken from actions. */
export interface ButtonSyncState {
  type: 'button-sync';
  /** playerId -> epoch ms of their live press */
  pressed: Record<string, number>;
  /** whose press ran out since they last pressed, sorted: their own device says so */
  expired: string[];
}

const inputSchema = z.strictObject({ press: z.literal(true) });
export type ButtonSyncInput = z.infer<typeof inputSchema>;

export interface ButtonSyncView {
  kind: 'button-sync';
  /** the panel's look, from the def */
  style: ButtonSyncDef['style'];
  /** how long a press lives, from the def; null where every press counts whenever it comes */
  windowMs: number | null;
  /**
   * the viewer's own live press: when it was made and when it runs out —
   * null for `expiresAt` without a window; null for the press itself while
   * the viewer has none, and for the audience
   */
  press: { at: number; expiresAt: number | null } | null;
  youPressed: boolean;
  /** whether somebody else's press is live: for the audience, anybody's */
  partnerPressed: boolean;
  /** the live presses */
  pressedCount: number;
  /** every connected player has to press */
  requiredCount: number;
  /** how many of them stand at the station right now, the viewer among them where they do */
  here: number;
  /** 'expired' on the device of a player whose press ran out, until they press again */
  lastResult: 'expired' | null;
}

/**
 * The state at `at`: every press older than the window dropped, and its
 * owner told. The same object where nothing ran out, as always without a
 * window. A press exactly `windowMs` old still lives.
 */
function expireAt(def: ButtonSyncDef, state: ButtonSyncState, at: number): ButtonSyncState {
  const { windowMs } = def;
  if (windowMs === undefined) {
    return state;
  }
  const live = Object.entries(state.pressed).filter(([, time]) => at - time <= windowMs);
  if (live.length === Object.keys(state.pressed).length) {
    return state;
  }
  const gone = Object.keys(state.pressed).filter((id) => !live.some(([player]) => player === id));
  return {
    type: 'button-sync',
    pressed: Object.fromEntries(live),
    expired: [...new Set([...state.expired, ...gone])].sort(),
  };
}

/**
 * A press by `playerId` at `at`. What ran out by then is dropped first, so
 * a press that comes too late opens a new window instead of failing the
 * old one, and charges nothing; the owners of the dropped presses are told,
 * the presser is not. The presser's own press is live again and whatever of
 * theirs ran out is forgotten.
 */
function press(
  def: ButtonSyncDef,
  state: ButtonSyncState,
  playerId: string,
  at: number,
  crew: readonly string[],
): { state: ButtonSyncState; solved: boolean } {
  const aged = expireAt(def, state, at);
  const pressed = { ...aged.pressed, [playerId]: at };
  return {
    state: {
      type: 'button-sync',
      pressed,
      expired: aged.expired.filter((id) => id !== playerId),
    },
    solved: crew.every((member) => pressed[member] !== undefined),
  };
}

/** The first moment a live press is older than the window; null without a window or a press. */
function dueAt(def: ButtonSyncDef, state: ButtonSyncState): number | null {
  const times = Object.values(state.pressed);
  return def.windowMs === undefined || times.length === 0
    ? null
    : Math.min(...times) + def.windowMs + 1;
}

/**
 * The drawing a main switch's manual opens on — a plate over a lever for each
 * of the crew — by the figure id the client draws it for. The button's is
 * the module type, as every module's.
 */
export const LEVER_FIGURE = 'button-sync-lever';

/** What the manual's opening says the device is, and how the crew works it, by its look. */
const DEVICE: Record<ButtonSyncDef['style'], { figure: string; caption: string; text: string }> = {
  button: {
    figure: 'button-sync',
    caption: 'Pult mit Synchrontaste',
    text:
      'Eine Taste für die ganze Crew: Jedes Crewmitglied steht dabei am Pult und drückt sie ' +
      'einmal.',
  },
  lever: {
    figure: LEVER_FIGURE,
    caption: 'Hauptschalter mit Hebeln',
    text:
      'Ein Hebel je Crewmitglied: Jedes Crewmitglied steht dabei am Schalter und legt seinen ' +
      'Hebel einmal um.',
  },
};

/** „2,5 s" for 2500 ms: German decimal comma, the unit as the penalty lines print it. */
const seconds = (ms: number): string => `${String(ms / 1000).replace('.', ',')} s`;

/** The rules and the worked example of a panel whose presses count whenever they come. */
function anyPace(style: ButtonSyncDef['style']): { rules: string[]; example: string[] } {
  if (style === 'lever') {
    return {
      rules: [
        'Wenn jedes Crewmitglied seinen Hebel einmal umgelegt hat, schließt der Hauptschalter; ' +
          'Reihenfolge und Abstand zählen nicht.',
      ],
      example: [
        'Crew aus 3 Personen.',
        'Umgelegt: der erste Hebel sofort, der zweite 10 Sekunden später, der dritte nach ' +
          '1 Minute.',
        'Alle 3 Hebel unten: Der Hauptschalter schließt.',
      ],
    };
  }
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

/** The rules and the worked example of a panel whose presses live `windowMs` each. */
function withinWindow(
  style: ButtonSyncDef['style'],
  windowMs: number,
): { rules: string[]; example: string[] } {
  const span = seconds(windowMs);
  const late = seconds(windowMs + 1000);
  const again = seconds(windowMs / 2);
  if (style === 'lever') {
    return {
      rules: [
        `Wenn alle Crewmitglieder ihren Hebel innerhalb von ${span} umgelegt haben, ` +
          'schließt der Hauptschalter.',
        `Andernfalls springt jeder Hebel ${span} nach dem Umlegen zurück und zählt nicht mehr.`,
      ],
      example: [
        'Crew aus 2 Personen.',
        `Die zweite Person legt ihren Hebel ${late} nach der ersten um: Der erste Hebel ist ` +
          'zurückgesprungen.',
        `Die erste legt ihren Hebel erneut um, ${again} später: Beide liegen innerhalb von ` +
          `${span}, der Hauptschalter schließt.`,
      ],
    };
  }
  return {
    rules: [
      `Wenn alle Crewmitglieder innerhalb von ${span} gedrückt haben, schließt die Schaltung.`,
      `Andernfalls verfällt jeder Druck ${span} nach dem Drücken und zählt nicht mehr.`,
    ],
    example: [
      'Crew aus 2 Personen.',
      `Die zweite drückt ${late} nach der ersten: Der erste Druck ist verfallen.`,
      `Die erste drückt erneut, ${again} später: Beide liegen innerhalb von ${span}, die ` +
        'Schaltung schließt.',
    ],
  };
}

/** The rules and the worked example, by the def's look and window. */
function printedRules({ style, windowMs }: ButtonSyncDef): { rules: string[]; example: string[] } {
  return windowMs === undefined ? anyPace(style) : withinWindow(style, windowMs);
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
  fields: [
    {
      key: 'windowMs',
      label: 'Zeitfenster in ms',
      help:
        'So dicht nacheinander muss die ganze Crew drücken, sonst verfallen die Drücke; ' +
        'leer = ohne Frist.',
      kind: 'int',
      min: 500,
      max: 10_000,
      default: 3000,
      off: 'omit',
    },
    {
      key: 'style',
      label: 'Bauform',
      help:
        'Ein Pilztaster für alle oder ein Hauptschalter mit einem Hebel je Crewmitglied; ' +
        'gedrückt wird gleich.',
      kind: 'choice',
      options: [
        { value: 'button', label: 'Taster' },
        { value: 'lever', label: 'Hebel' },
      ],
      default: 'button',
    },
  ],
  defSchema,
  inputSchema,

  init: () => ({ type: 'button-sync', pressed: {}, expired: [] }),

  apply(def, state, _input, playerId, ctx) {
    return { ...press(def, state, playerId, ctx.at, ctx.crew), penalty: null };
  },

  dueAt,
  expire: expireAt,

  view(def, state, viewer, ctx) {
    const own = viewer.playerId === null ? undefined : state.pressed[viewer.playerId];
    const windowMs = def.windowMs ?? null;
    return {
      kind: 'button-sync',
      style: def.style,
      windowMs,
      press:
        own === undefined
          ? null
          : { at: own, expiresAt: windowMs === null ? null : own + windowMs },
      youPressed: own !== undefined,
      partnerPressed: Object.keys(state.pressed).some((id) => id !== viewer.playerId),
      pressedCount: Object.keys(state.pressed).length,
      requiredCount: ctx.crew.length,
      here: ctx.operators.filter((id) => ctx.crew.includes(id)).length,
      lastResult:
        viewer.playerId !== null && state.expired.includes(viewer.playerId) ? 'expired' : null,
    };
  },

  manual(def) {
    const { rules, example } = printedRules(def);
    const device = DEVICE[def.style];
    return [
      {
        heading: 'Synchronschaltung',
        blocks: [
          deviceFigure(device.figure, device.caption),
          { kind: 'p', text: device.text },
          { kind: 'rules', items: rules },
          workedExample(example),
          // Nothing here raises an alarm — a press that runs out is just made again.
          { kind: 'p', text: 'Fehlgriff: kein Alarm, keine Zeitstrafe.' },
        ],
      },
    ];
  },

  solve: () => [{ by: 'everyone', input: { press: true } }],
};

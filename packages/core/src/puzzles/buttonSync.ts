import { z } from 'zod';
import { commonDefShape, type PuzzleModule } from './module.js';
import { labDocument, type TypePlate } from './printed.js';

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
 * The drawing over a main switch's Aufbau — a plate over a lever for each of
 * the crew — by the figure id the client draws it for. The button's is the
 * module type, as every module's.
 */
export const LEVER_FIGURE = 'button-sync-lever';

/**
 * What the document says of the device, by its look: its type plate, the
 * drawing it opens on, what it is for and how it is built. The levers and
 * the presses go by the badges logged into the lab — one for every member
 * of the crew — so the page names a badge where the game counts a player.
 */
const DEVICE: Record<
  ButtonSyncDef['style'],
  { plate: TypePlate; figure: string; caption: string; purpose: string; build: string }
> = {
  button: {
    plate: { name: 'Synchrontaster', type: 'ST-2', year: 1981 },
    figure: 'button-sync',
    caption: 'Pult mit Synchrontaste',
    purpose:
      'Der Synchrontaster sichert Schaltungen, die das ganze Labor betreffen, etwa einen ' +
      'Neustart oder den Not-Aus: Eine solche Schaltung schließt nur, wenn alle im Labor ' +
      'angemeldeten Dienstausweise sie bestätigen.',
    build:
      'Ein Pult mit einem Pilztaster, der jeden Druck dem Ausweis zuordnet, von dem er kommt; ' +
      'gezählt werden nur Drücke am Pult selbst.',
  },
  lever: {
    plate: { name: 'Hauptschalter', type: 'HS-3', year: 1976 },
    figure: LEVER_FIGURE,
    caption: 'Hauptschalter mit Hebeln',
    purpose:
      'Der Hauptschalter schaltet nach einem Ausfall Licht und Grundversorgung wieder zu. Für ' +
      'jeden im Labor angemeldeten Dienstausweis hat er einen Hebel, und er schließt erst, wenn ' +
      'alle Hebel umgelegt sind.',
    build:
      'Ein Schild über einer Reihe Hebel, einem je angemeldetem Ausweis, über jedem Hebel eine ' +
      'Lampe; umgelegt wird am Schalter selbst.',
  },
};

/** „2,5 Sekunden" for 2500 ms: German decimal comma. */
const seconds = (ms: number): string => {
  const said = String(ms / 1000).replace('.', ',');
  return `${said} ${said === '1' ? 'Sekunde' : 'Sekunden'}`;
};

/** What a document sets out beyond its plate: how the device runs, its law, its log, its notes. */
interface Printed {
  operation: string;
  rules: string[];
  log: string[];
  workshop: string[];
}

/** Nothing here costs time, whatever the look, and Betrieb says so last. */
const NO_COST: Record<ButtonSyncDef['style'], string> = {
  button: 'Die Überwachung meldet hier nichts: Kein Druck kostet Einsatzzeit.',
  lever: 'Die Überwachung meldet hier nichts: Kein Hebel kostet Einsatzzeit.',
};

/** The document's own parts for a device whose presses count whenever they come. */
function anyPace(style: ButtonSyncDef['style']): Printed {
  if (style === 'lever') {
    return {
      operation:
        `Ein umgelegter Hebel bleibt liegen, bis der Hauptschalter schließt. ${NO_COST.lever}`,
      rules: [
        'Wenn jeder Hebel einmal umgelegt ist, schließt der Hauptschalter; Reihenfolge und ' +
          'Abstand zählen nicht.',
      ],
      log: [
        '00:31 Angemeldet: 3 Ausweise, 3 Hebel.',
        '00:31 Hebel 1 umgelegt; Hebel 2 nach 10 Sekunden, Hebel 3 nach einer Minute.',
        '00:32 Alle 3 Hebel umgelegt: Hauptschalter geschlossen.',
      ],
      workshop: [
        'Der Schalter wartet beliebig lange; ein früh umgelegter Hebel springt nicht zurück.',
      ],
    };
  }
  return {
    operation: `Ein Druck gilt, bis die Schaltung schließt. ${NO_COST.button}`,
    rules: [
      'Wenn von jedem angemeldeten Ausweis ein Druck vorliegt, schließt die Schaltung; ' +
        'Reihenfolge und Abstand zählen nicht.',
    ],
    log: [
      '00:31 Angemeldet: 3 Ausweise.',
      '00:31 Druck von Ausweis 1; Ausweis 2 nach 10 Sekunden, Ausweis 3 nach einer Minute.',
      '00:32 Alle 3 Ausweise gedrückt: Schaltung geschlossen.',
    ],
    workshop: ['Die Schaltung wartet beliebig lange; ein früher Druck verfällt nicht.'],
  };
}

/** The document's own parts for a device whose presses live `windowMs` each. */
function withinWindow(style: ButtonSyncDef['style'], windowMs: number): Printed {
  const span = seconds(windowMs);
  const late = seconds(windowMs + 1000);
  const again = seconds(windowMs / 2);
  if (style === 'lever') {
    return {
      operation:
        `Ein umgelegter Hebel hält ${span} und springt dann zurück; ein zurückgesprungener ` +
        `wird neu umgelegt. ${NO_COST.lever}`,
      rules: [
        `Wenn alle Hebel innerhalb von ${span} umgelegt sind, schließt der Hauptschalter.`,
        `Andernfalls springt jeder Hebel ${span} nach dem Umlegen zurück und zählt nicht mehr.`,
      ],
      log: [
        '00:31 Angemeldet: 2 Ausweise, 2 Hebel.',
        `00:31 Hebel 2 umgelegt, ${late} nach Hebel 1: Hebel 1 zurückgesprungen.`,
        `00:31 Hebel 1 erneut umgelegt, ${again} später: beide liegen zugleich, Hauptschalter ` +
          'geschlossen.',
      ],
      workshop: [
        'Die Frist ist kurz; bewährt hat sich ein gemeinsamer Griff im selben Augenblick.',
      ],
    };
  }
  return {
    operation: `Ein Druck gilt ${span}; ein verfallener wird wiederholt. ${NO_COST.button}`,
    rules: [
      `Wenn von allen angemeldeten Ausweisen innerhalb von ${span} ein Druck vorliegt, ` +
        'schließt die Schaltung.',
      `Andernfalls verfällt jeder Druck ${span} nach dem Drücken und zählt nicht mehr.`,
    ],
    log: [
      '00:31 Angemeldet: 2 Ausweise.',
      `00:31 Druck von Ausweis 2, ${late} nach Ausweis 1: Druck 1 verfallen.`,
      `00:31 Druck von Ausweis 1, ${again} später: beide gelten zugleich, Schaltung geschlossen.`,
    ],
    workshop: ['Die Frist ist kurz; bewährt hat sich ein gemeinsamer Druck im selben Augenblick.'],
  };
}

/** The document's own parts, by the def's look and window. */
function printedParts({ style, windowMs }: ButtonSyncDef): Printed {
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
    const device = DEVICE[def.style];
    const { operation, rules, log, workshop } = printedParts(def);
    return labDocument({
      plate: device.plate,
      purpose: device.purpose,
      figure: { of: device.figure, device: device.caption },
      build: device.build,
      operation,
      law: [{ heading: 'Schaltregel', blocks: [{ kind: 'rules', items: rules }] }],
      log,
      workshop,
    });
  },

  solve: () => [{ by: 'everyone', input: { press: true } }],
};

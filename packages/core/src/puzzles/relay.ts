import { z } from 'zod';
import { fail } from '../errors.js';
import { mulberry32, shuffle, type Rng } from '../rng.js';
import { commonDefShape, type EmergencyModule } from './module.js';

/**
 * Notfall-Relais, a Spaceteam-style emergency. Every role gets a console of
 * four controls and always holds one instruction for a control on somebody
 * else's console: it reads the instruction out, the owner performs it, the
 * next one follows. An instruction left waiting too long is a miss and is
 * replaced. Enough completed instructions clear the emergency.
 *
 * Opened by `sabotage-start` when a mission's sabotage runs in `relay` mode,
 * never at a station. The reducer ages the instructions with `sabotage-tick`
 * (`expireRelay`) and moves their clocks on over a pause (`shiftRelay`).
 */

/** Lab nonsense for the controls; each is used once per emergency, so it can be shouted. */
export const CONTROL_NAMES = [
  'Plasmaventil',
  'Kryo-Puffer',
  'Faradaykäfig',
  'Neutronenbremse',
  'Ionenfilter',
  'Phasenkoppler',
  'Dampfdruckregler',
  'Notstromtrenner',
  'Spulenlast',
  'Zirkulator',
  'Quantenschleuse',
  'Gammablende',
  'Magnetrührer',
  'Tachyonenpumpe',
  'Laserweiche',
  'Fusionsdrossel',
  'Vakuumschott',
  'Heliumkammer',
  'Gravitonsieb',
  'Ölkühler',
  'Wellenbrecher',
  'Röntgenlampe',
  'Antimateriefalle',
  'Elektronenschleuder',
] as const;

const CONTROLS_PER_CONSOLE = 4;
/** Every name once per emergency: this many consoles fit the pool. */
export const RELAY_MAX_ROLES = Math.floor(CONTROL_NAMES.length / CONTROLS_PER_CONSOLE);
const DIAL_MAX = 5;
/** Without a mission-set `required`, the crew completes this many per role. */
const REQUIRED_PER_ROLE = 3;
const KINDS = ['switch', 'dial', 'button'] as const;
type RelayKind = (typeof KINDS)[number];

const defSchema = z.strictObject({
  type: z.literal('relay'),
  ...commonDefShape,
  /** every role of the mission: a console each, and an instruction for somebody else's */
  roles: z
    .array(z.object({ id: z.string().min(1), name: z.string().min(1) }))
    .min(2)
    .max(RELAY_MAX_ROLES),
  /** seconds an instruction waits for its owner before it is a miss */
  windowSec: z.number().int().positive().default(12),
  /** completed instructions that clear the emergency */
  required: z.number().int().positive(),
  /** seconds from the alarm until the emergency expires */
  durationSec: z.number().int().positive(),
  /** what the expiry costs; `sabotage-expired` charges it, never a move */
  penaltySec: z.number().int().positive().default(60),
});
export type RelayDef = z.infer<typeof defSchema>;

/** What an instruction asks for and what a move sets: AN/AUS, a dial level, or a press. */
export type RelayValue = boolean | number | 'press';

/** A control's kind and where it stands; a button keeps no position. */
export type RelaySetting =
  | { kind: 'switch'; value: boolean }
  | { kind: 'dial'; value: number }
  | { kind: 'button'; value: null };

interface RelayControl {
  id: string;
  /** the role whose console it sits on */
  ownerId: string;
  name: string;
  setting: RelaySetting;
}

interface RelayInstruction {
  /** the role that reads it out */
  holderId: string;
  /** always a control on another role's console */
  controlId: string;
  value: RelayValue;
  /** epoch ms; from here on it is a miss */
  expiresAt: number;
}

export interface RelayState {
  type: 'relay';
  /** four per role, in role order */
  controls: RelayControl[];
  /** one per role, in role order */
  instructions: RelayInstruction[];
  completed: number;
  missed: number;
  /** the instruction stream: every draw starts here and leaves the next seed behind */
  seed: number;
  /** epoch ms; the emergency's deadline, for the views */
  endsAt: number;
}

const inputSchema = z.strictObject({
  kind: z.literal('set'),
  control: z.string().min(1),
  value: z.union([z.boolean(), z.number().int().min(1).max(DIAL_MAX), z.literal('press')]),
});
export type RelayInput = z.infer<typeof inputSchema>;

export interface RelayView {
  kind: 'relay';
  /** your console as it stands; empty for the audience */
  controls: ({ id: string; name: string } & RelaySetting)[];
  /** what you read out — always for somebody else's console; null for the audience */
  instruction: {
    /** whose console the control sits on */
    roleName: string;
    control: string;
    value: RelayValue;
    expiresAt: number;
  } | null;
  /** how long every instruction runs, for the countdown bar */
  windowSec: number;
  completed: number;
  required: number;
  /** epoch ms; the emergency fails here */
  endsAt: number;
}

/** The parts of a mission's sabotage block a relay emergency runs on. */
export interface RelaySabotage {
  label: string;
  hint: string;
  durationSec: number;
  penaltySec: number;
  windowSec: number;
  required?: number | undefined;
}

/**
 * The emergency as a module def: the mission's roles and its sabotage block.
 * Nobody writes it down; it is rebuilt from the mission wherever it is needed.
 */
export function relayDefFor(
  roles: readonly { id: string; name: string }[],
  sabotage: RelaySabotage,
): RelayDef {
  return {
    type: 'relay',
    id: 'notfall-relais',
    title: sabotage.label,
    hints: [],
    roles: roles.map((role) => ({ id: role.id, name: role.name })),
    windowSec: sabotage.windowSec,
    required: sabotage.required ?? REQUIRED_PER_ROLE * roles.length,
    durationSec: sabotage.durationSec,
    penaltySec: sabotage.penaltySec,
  };
}

/** One switch, one dial, one button and one more of any kind, in a random order. */
function consoleKinds(rng: Rng): RelayKind[] {
  const extra = KINDS[Math.floor(rng() * KINDS.length)] ?? 'switch';
  return shuffle([...KINDS, extra], rng);
}

function randomSetting(kind: RelayKind, rng: Rng): RelaySetting {
  switch (kind) {
    case 'switch':
      return { kind, value: rng() < 0.5 };
    case 'dial':
      return { kind, value: 1 + Math.floor(rng() * DIAL_MAX) };
    case 'button':
      return { kind, value: null };
  }
}

/** Four controls per role, every one with its own name from the pool. */
function buildControls(def: RelayDef, rng: Rng): RelayControl[] {
  const names = shuffle(CONTROL_NAMES, rng);
  return def.roles.flatMap((role, r) =>
    consoleKinds(rng).map((kind, i) => {
      const n = r * CONTROLS_PER_CONSOLE + i;
      const name = names[n];
      if (name === undefined) {
        throw new Error(`relay "${def.id}": control names for at most ${RELAY_MAX_ROLES} roles`);
      }
      return { id: `k${n + 1}`, ownerId: role.id, name, setting: randomSetting(kind, rng) };
    }),
  );
}

/** Something the control does not show right now — for a button, a press. */
function changeFor(setting: RelaySetting, rng: Rng): RelayValue {
  switch (setting.kind) {
    case 'switch':
      return !setting.value;
    case 'dial':
      // one of the other four levels, evenly
      return ((setting.value + Math.floor(rng() * (DIAL_MAX - 1))) % DIAL_MAX) + 1;
    case 'button':
      return 'press';
  }
}

/** Where a move leaves the control, or null when the value does not fit its kind. */
function settingFor(kind: RelayKind, value: RelayValue): RelaySetting | null {
  if (kind === 'switch' && typeof value === 'boolean') {
    return { kind, value };
  }
  if (kind === 'dial' && typeof value === 'number') {
    return { kind, value };
  }
  if (kind === 'button' && value === 'press') {
    return { kind, value: null };
  }
  return null;
}

/**
 * Hand `holderId` a fresh instruction, drawn from the state's own stream: a
 * control on another console that no other instruction is about, to be set
 * to something it does not show. Replaces whatever the holder had.
 */
function issue(def: RelayDef, state: RelayState, holderId: string, at: number): RelayState {
  const others = state.instructions.filter((i) => i.holderId !== holderId);
  const busy = new Set(others.map((i) => i.controlId));
  const free = state.controls.filter((c) => c.ownerId !== holderId && !busy.has(c.id));
  const rng = mulberry32(state.seed);
  const control = free[Math.floor(rng() * free.length)];
  if (control === undefined) {
    // Four controls per console, one instruction per role: at least three stay free.
    throw new Error(`relay "${def.id}": no free control left for "${holderId}"`);
  }
  const fresh: RelayInstruction = {
    holderId,
    controlId: control.id,
    value: changeFor(control.setting, rng),
    expiresAt: at + def.windowSec * 1000,
  };
  return {
    ...state,
    instructions: def.roles.flatMap((role) =>
      role.id === holderId ? [fresh] : others.filter((i) => i.holderId === role.id),
    ),
    seed: Math.floor(rng() * 2 ** 32),
  };
}

/**
 * Every instruction that has run out by `at` is a miss and is replaced at
 * once; the very same state comes back when none has. `sabotage-tick` calls
 * this once a second, `apply` before every move.
 */
export function expireRelay(def: RelayDef, state: RelayState, at: number): RelayState {
  const overdue = state.instructions.filter((i) => at >= i.expiresAt);
  if (overdue.length === 0) {
    return state;
  }
  const live: RelayState = {
    ...state,
    instructions: state.instructions.filter((i) => at < i.expiresAt),
    missed: state.missed + overdue.length,
  };
  return overdue.reduce((next, i) => issue(def, next, i.holderId, at), live);
}

/** The same emergency with every clock in it moved on by `ms`, for the time a pause froze. */
export function shiftRelay(state: RelayState, ms: number): RelayState {
  return {
    ...state,
    endsAt: state.endsAt + ms,
    instructions: state.instructions.map((i) => ({ ...i, expiresAt: i.expiresAt + ms })),
  };
}

/** An instruction the way its holder reads it out. */
function spoken(
  def: RelayDef,
  state: RelayState,
  instruction: RelayInstruction,
): NonNullable<RelayView['instruction']> {
  const control = state.controls.find((c) => c.id === instruction.controlId);
  const owner = def.roles.find((role) => role.id === control?.ownerId);
  if (control === undefined || owner === undefined) {
    throw new Error(
      `relay "${def.id}": instruction for unknown control "${instruction.controlId}"`,
    );
  }
  return {
    roleName: owner.name,
    control: control.name,
    value: instruction.value,
    expiresAt: instruction.expiresAt,
  };
}

export const relayModule: EmergencyModule<RelayDef, RelayState, RelayInput, RelayView> = {
  type: 'relay',
  usesEdgework: false,
  defSchema,
  inputSchema,

  init(def, rng, ctx) {
    const blank: RelayState = {
      type: 'relay',
      controls: buildControls(def, rng),
      instructions: [],
      completed: 0,
      missed: 0,
      seed: Math.floor(rng() * 2 ** 32),
      endsAt: ctx.at + def.durationSec * 1000,
    };
    return def.roles.reduce((state, role) => issue(def, state, role.id, ctx.at), blank);
  },

  apply(def, state, input, roleId, ctx) {
    const control = state.controls.find((c) => c.id === input.control);
    if (control === undefined) {
      fail('Dieses Bedienelement gibt es nicht.');
    }
    if (control.ownerId !== roleId) {
      fail('Das Bedienelement sitzt an einem anderen Pult — sag die Anweisung laut an.');
    }
    const setting = settingFor(control.setting.kind, input.value);
    if (setting === null) {
      fail('Ungültige Eingabe.');
    }
    const aged = expireRelay(def, state, ctx.at);
    const moved: RelayState = {
      ...aged,
      controls: aged.controls.map((c) => (c.id === control.id ? { ...c, setting } : c)),
    };
    const done = moved.instructions.find(
      (i) => i.controlId === control.id && i.value === input.value,
    );
    if (done === undefined) {
      // Nobody asked for that: the control moves, and that is all.
      return { state: moved, solved: false, penalty: null };
    }
    const completed = moved.completed + 1;
    return {
      state: issue(def, { ...moved, completed }, done.holderId, ctx.at),
      solved: completed >= def.required,
      penalty: null,
    };
  },

  view(def, state, roleId) {
    const own = state.instructions.find((i) => i.holderId === roleId);
    return {
      kind: 'relay',
      controls: state.controls
        .filter((c) => c.ownerId === roleId)
        .map((c) => ({ id: c.id, name: c.name, ...c.setting })),
      instruction: own === undefined ? null : spoken(def, state, own),
      windowSec: def.windowSec,
      completed: state.completed,
      required: def.required,
      endsAt: state.endsAt,
    };
  },

  manual(def) {
    return [
      {
        heading: 'Notfall-Relais',
        blocks: [
          {
            kind: 'p',
            text:
              'Jedes Pult hat vier Bedienelemente. Jede Station erhält laufend eine Anweisung — ' +
              'immer für ein Element an einem anderen Pult. ' +
              `${def.required} ausgeführte Anweisungen beheben den Notfall.`,
          },
          {
            kind: 'rules',
            items: [
              'Anweisung sofort laut vorlesen: Pult, Element, Wert.',
              'Die eigene Anweisung nie selbst ausführen. Schalten darf nur, wer das Element ' +
                'am eigenen Pult hat.',
              'Ausgeführt: laut zurückrufen, z. B. „Kryo-Puffer steht auf 3".',
              `Eine Anweisung gilt ${def.windowSec} Sekunden. Danach verfällt sie, die nächste ` +
                'folgt sofort.',
              `Notfallzeit abgelaufen, zu wenig ausgeführt: Alarm, −${def.penaltySec} s.`,
              'Sonst: nichts schalten, was niemand angesagt hat.',
            ],
          },
          {
            kind: 'table',
            head: ['Element', 'Ansage', 'Handgriff'],
            rows: [
              ['Schalter', '„… AN" oder „… AUS"', 'umlegen'],
              ['Drehregler', '„… auf 1" bis „… auf 5"', 'auf die Stufe stellen'],
              ['Taster', '„… drücken"', 'einmal drücken'],
            ],
          },
        ],
      },
    ];
  },

  solve(def, views) {
    const consoles = def.roles.map((role) => ({ role, controls: views[role.id]?.controls ?? [] }));
    return def.roles.flatMap((holder) => {
      const wanted = views[holder.id]?.instruction ?? null;
      if (wanted === null) {
        return [];
      }
      // As the crew does it: the named console's owner finds the named control.
      for (const { role, controls } of consoles) {
        const control = controls.find((c) => c.name === wanted.control);
        if (role.name === wanted.roleName && control !== undefined) {
          const input = { kind: 'set' as const, control: control.id, value: wanted.value };
          return [{ roleId: role.id, input }];
        }
      }
      throw new Error(
        `relay "${def.id}": no console of ${wanted.roleName} has "${wanted.control}"`,
      );
    });
  },
};

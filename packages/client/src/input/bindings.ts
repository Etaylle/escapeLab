/**
 * The binding map: what every key and every remappable button of a controller does in the lab.
 * Every action has one key of the player's choosing (settings.ts keeps them, the settings panel
 * sets them); a few keys do the same whatever is bound — the arrows walk, Enter and Space work,
 * Esc steps back — and some the game keeps for itself. On a controller the four main actions
 * sit on buttons of the player's choosing too; the rest of the pad is fixed (input/pad.ts).
 * Every prompt names its key from here (input/glyphs.ts), never by itself.
 */

/** What the player does: walking and sprinting, the actions, and talking held down. */
export const ACTIONS = [
  'up',
  'down',
  'left',
  'right',
  'sprint',
  'interact',
  'drop',
  'notes',
  'minimap',
  'chat',
  'info',
  'talk',
] as const;

export type InputAction = (typeof ACTIONS)[number];

/** The four ways to walk. */
export const MOVE_ACTIONS = ['up', 'down', 'left', 'right'] as const;

export type Move = (typeof MOVE_ACTIONS)[number];

/** Each way to walk as a step on the map: x to the right, y down. */
export const MOVES: Readonly<Record<Move, readonly [number, number]>> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

/** What acts while held: walking and sprinting; talking is the voice's (voice/useVoice.ts). */
export type Held = Move | 'sprint';

/**
 * Where a key sits on the keyboard (`code`), so that a key held down is let go where it went
 * down, whatever Shift or a rebinding made of its name meanwhile; a key a controller sends sits
 * nowhere and goes by its name.
 */
export function keyPlace(e: Pick<KeyboardEvent, 'code' | 'key'>): string {
  return e.code || `key:${e.key.toLowerCase()}`;
}

/** An action held, not done once a press. */
export function isHeld(action: InputAction): action is Held {
  return action === 'sprint' || MOVE_ACTIONS.some((move) => move === action);
}

/** How the settings panel and the key list name each action. */
export const ACTION_NAMES: Readonly<Record<InputAction, string>> = {
  up: 'Laufen: vor',
  down: 'Laufen: zurück',
  left: 'Laufen: links',
  right: 'Laufen: rechts',
  sprint: 'Sprinten (halten)',
  interact: 'Benutzen',
  drop: 'Ablegen',
  notes: 'Notizblock',
  minimap: 'Minikarte',
  chat: 'Schnellchat',
  info: 'Einsatzinfo',
  talk: 'Sprechen (halten)',
};

/** A key for every action, as KeyboardEvent names it, lower-cased. */
export type KeyBindings = Readonly<Record<InputAction, string>>;

export const DEFAULT_KEYS: KeyBindings = {
  up: 'w',
  down: 's',
  left: 'a',
  right: 'd',
  sprint: 'shift',
  interact: 'e',
  drop: 'q',
  notes: 'n',
  minimap: 'm',
  chat: 'c',
  info: 'i',
  talk: 'v',
};

/**
 * The keys that do one thing whatever is bound, and what they do: the arrows walk, Enter and
 * Space work what is in front, Esc steps back, Tab moves the focus, 1–8 say the quick chat's
 * phrases, Backspace and Delete edit text. None of them can be bound.
 */
export const FIXED_KEYS: ReadonlyMap<string, string> = new Map([
  ['arrowup', 'Laufen'],
  ['arrowdown', 'Laufen'],
  ['arrowleft', 'Laufen'],
  ['arrowright', 'Laufen'],
  ['enter', 'Benutzen'],
  [' ', 'Benutzen'],
  ['escape', 'Zurücktreten'],
  ['tab', 'Fokus'],
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((digit): [string, string] => [String(digit), 'Schnellchat']),
  ['backspace', 'Texteingabe'],
  ['delete', 'Texteingabe'],
]);

/** What a fixed key does as an action: the arrows walk, Enter and Space work. */
const FIXED_ACTIONS: Readonly<Record<string, InputAction>> = {
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  enter: 'interact',
  ' ': 'interact',
};

/** Keys that are no key to bind: modifiers alone, and what the browser keeps. */
const UNFIT = new Set([
  ...['control', 'alt', 'altgraph', 'meta', 'os'],
  ...['capslock', 'dead', 'unidentified'],
]);

/** Whether a key, lower-cased, could be bound at all: one character, F1–F12, or Shift. */
function bindable(key: string): boolean {
  if (UNFIT.has(key)) {
    return false;
  }
  const one = [...key].length === 1 && key.trim() !== '';
  return one || key === 'shift' || /^f([1-9]|1[0-2])$/.test(key);
}

/** What a key would be for an action: fine, kept by the game, taken by another, or no key. */
export type BindVerdict =
  | { ok: true }
  | { ok: false; reason: 'unfit' }
  | { ok: false; reason: 'fixed'; what: string }
  | { ok: false; reason: 'taken'; by: InputAction };

/**
 * Whether `key` (as KeyboardEvent names it) can be bound to `action` in `keys`: a key of one
 * character, F1–F12 or Shift, that neither the game keeps (FIXED_KEYS) nor another action
 * holds — that one is named. The key `action` holds already is fine.
 */
export function bindVerdict(keys: KeyBindings, action: InputAction, key: string): BindVerdict {
  const named = key.toLowerCase();
  const fixed = FIXED_KEYS.get(named);
  if (fixed !== undefined) {
    return { ok: false, reason: 'fixed', what: fixed };
  }
  if (!bindable(named)) {
    return { ok: false, reason: 'unfit' };
  }
  const by = ACTIONS.find((other) => other !== action && keys[other] === named);
  return by === undefined ? { ok: true } : { ok: false, reason: 'taken', by };
}

/** What `key` (as KeyboardEvent names it) does under `keys`: its action, a fixed key's, or none. */
export function actionOfKey(keys: KeyBindings, key: string): InputAction | null {
  const named = key.toLowerCase();
  return ACTIONS.find((action) => keys[action] === named) ?? FIXED_ACTIONS[named] ?? null;
}

/** The keys that do `action` under `keys`: the bound one first, then any fixed one. */
export function keysOf(keys: KeyBindings, action: InputAction): string[] {
  const fixed = Object.keys(FIXED_ACTIONS).filter((key) => FIXED_ACTIONS[key] === action);
  return [keys[action], ...fixed];
}

const KEY_NAMES: Readonly<Record<string, string>> = {
  ' ': 'Leertaste',
  shift: 'Shift',
  enter: 'Enter',
  escape: 'Esc',
  tab: 'Tab',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  backspace: 'Rück',
  delete: 'Entf',
};

/** A key as the screen names it: V, F2, Ö, Shift, ←, Esc. */
export function keyName(key: string): string {
  const named = key.toLowerCase();
  return KEY_NAMES[named] ?? named.toUpperCase();
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The bindings `value` keeps, as the settings stored them: each action's key where it is one
 * that could be bound, its default otherwise — and the defaults whole where two actions would
 * end up on one key, which no panel lets happen.
 */
export function readKeys(value: unknown): KeyBindings {
  const raw = isRecord(value) ? value : {};
  const keys = Object.fromEntries(
    ACTIONS.map((action) => {
      const key = raw[action];
      const named = typeof key === 'string' ? key.toLowerCase() : null;
      const fits = named !== null && !FIXED_KEYS.has(named) && bindable(named);
      return [action, fits ? named : DEFAULT_KEYS[action]];
    }),
  ) as Record<InputAction, string>;
  const distinct = new Set(Object.values(keys)).size === ACTIONS.length;
  return distinct ? keys : DEFAULT_KEYS;
}

// --- the controller's remappable actions --------------------------------------------------

/** The four main actions, each on a button of the player's choosing. */
export const PAD_ACTIONS = ['interact', 'drop', 'notes', 'minimap'] as const;

export type PadAction = (typeof PAD_ACTIONS)[number];

/** The buttons the four main actions can sit on: the four faces and the two triggers. */
export const PAD_SLOTS = ['a', 'b', 'x', 'y', 'l2', 'r2'] as const;

export type PadSlot = (typeof PAD_SLOTS)[number];

export type PadBindings = Readonly<Record<PadAction, PadSlot>>;

/** A/✕ works, B/○ puts down or steps back, X/□ the notepad, Y/△ the minimap. */
export const DEFAULT_PAD: PadBindings = { interact: 'a', drop: 'b', notes: 'x', minimap: 'y' };

/** Whether `name` is a button a main action can sit on. */
export function isPadSlot(name: string): name is PadSlot {
  return PAD_SLOTS.some((slot) => slot === name);
}

/**
 * `action` put on `button`: where another of the four sat there, the two swap — the one that
 * moved is named — so that no button ever does two things.
 */
export function rebindPad(
  pad: PadBindings,
  action: PadAction,
  button: PadSlot,
): { pad: PadBindings; swapped: PadAction | null } {
  const other = PAD_ACTIONS.find((each) => each !== action && pad[each] === button) ?? null;
  const moved = other === null ? {} : { [other]: pad[action] };
  return { pad: { ...pad, ...moved, [action]: button }, swapped: other };
}

/** The action `button` does under `pad`; none for a button without one. */
export function padActionOf(pad: PadBindings, button: string): PadAction | null {
  return PAD_ACTIONS.find((action) => pad[action] === button) ?? null;
}

/** The pad's bindings as stored: each where it is a slot, all of them distinct; else defaults. */
export function readPad(value: unknown): PadBindings {
  const raw = isRecord(value) ? value : {};
  const pad = Object.fromEntries(
    PAD_ACTIONS.map((action) => {
      const slot = raw[action];
      return [action, typeof slot === 'string' && isPadSlot(slot) ? slot : DEFAULT_PAD[action]];
    }),
  ) as Record<PadAction, PadSlot>;
  return new Set(Object.values(pad)).size === PAD_ACTIONS.length ? pad : DEFAULT_PAD;
}

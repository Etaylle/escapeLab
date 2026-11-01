/**
 * A controller as the browser's Gamepad API hands it over in its standard mapping, read once a
 * frame (input/padRuntime.ts): the buttons held, the left stick past its dead zone, the D-pad.
 * Pure: a poll in, its state out. The left stick walks, A/✕ works, B/○ puts down or steps
 * back, X/□ the notepad, Y/△ the minimap — those four as the settings bind them
 * (input/bindings.ts `PadBindings`) — L1 talks while held, R1 sprints, Start opens the settings
 * and Select the Einsatzinfo. In the world the D-pad's ◀ pings and its ▶ opens the quick chat;
 * over a dialog it moves between the controls.
 */

/** The buttons of the standard mapping, by their index there. */
export const STANDARD_BUTTONS = [
  'a',
  'b',
  'x',
  'y',
  'l1',
  'r1',
  'l2',
  'r2',
  'select',
  'start',
  'l3',
  'r3',
  'dup',
  'ddown',
  'dleft',
  'dright',
  'home',
] as const;

export type PadButton = (typeof STANDARD_BUTTONS)[number];

/** In the world, the D-pad's ◀ pings where the avatar looks (input/padRuntime.ts). */
export const PAD_PING = 'dleft' satisfies PadButton;
/** In the world, the D-pad's ▶ opens the quick chat. */
export const PAD_CHAT = 'dright' satisfies PadButton;

/** How far the stick may lean before it counts, of its full lean. */
export const DEADZONE = 0.2;
/** A button or a trigger counts as pressed past this much of its travel. */
const PRESSED = 0.5;

/**
 * The stick's lean past the dead zone, scaled radially: nothing within DEADZONE of the middle,
 * then from 0 at its edge to 1 at the rim, in the direction it leans — so that a diagonal walks
 * as fast as a straight lean and no axis has a dead cross of its own.
 */
export function radial(x: number, y: number, deadzone = DEADZONE): { x: number; y: number } {
  const lean = Math.hypot(x, y);
  if (!(lean > deadzone)) {
    return { x: 0, y: 0 };
  }
  const scale = Math.min(1, (lean - deadzone) / (1 - deadzone)) / lean;
  return { x: x * scale, y: y * scale };
}

/** Which buttons a controller is printed with: letters, or the four symbols. */
export type PadFamily = 'xbox' | 'playstation';

/**
 * Which buttons a controller is printed with, told by its id: Microsoft's first — the vendor
 * 045e, Xbox or XInput, „Xbox Wireless Controller" among them — then Sony's: the vendor 054c,
 * their names, or the bare „Wireless Controller" a DualShock 4 reports. Letters for any other.
 */
export function padFamily(id: string): PadFamily {
  if (/045e|xbox|xinput/i.test(id)) {
    return 'xbox';
  }
  return /054c|playstation|dualsense|dualshock|wireless controller/i.test(id)
    ? 'playstation'
    : 'xbox';
}

/** Each button as its controller prints it. */
export const PAD_GLYPHS: Readonly<Record<PadFamily, Readonly<Record<PadButton, string>>>> = {
  xbox: {
    a: 'A',
    b: 'B',
    x: 'X',
    y: 'Y',
    l1: 'LB',
    r1: 'RB',
    l2: 'LT',
    r2: 'RT',
    select: 'View',
    start: 'Menü',
    l3: 'LS',
    r3: 'RS',
    dup: '▲',
    ddown: '▼',
    dleft: '◀',
    dright: '▶',
    home: 'Xbox',
  },
  playstation: {
    a: '✕',
    b: '○',
    x: '□',
    y: '△',
    l1: 'L1',
    r1: 'R1',
    l2: 'L2',
    r2: 'R2',
    select: 'Create',
    start: 'Options',
    l3: 'L3',
    r3: 'R3',
    dup: '▲',
    ddown: '▼',
    dleft: '◀',
    dright: '▶',
    home: 'PS',
  },
};

/** What the Gamepad API gives of a controller, as far as this reads it. */
export interface GamepadLike {
  readonly id: string;
  readonly connected: boolean;
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
  readonly axes: readonly number[];
}

/** One poll of a controller. */
export interface PadState {
  family: PadFamily;
  /** the buttons held now */
  held: ReadonlySet<PadButton>;
  /** the left stick past its dead zone, scaled from there to the rim: 0 to 1 long */
  stick: { x: number; y: number };
}

/** A controller at rest: nothing held, the stick in the middle. */
export const AT_REST: PadState = { family: 'xbox', held: new Set(), stick: { x: 0, y: 0 } };

/** What a poll of `pad` says: the buttons pressed past PRESSED, the stick past the dead zone. */
export function padStateOf(pad: GamepadLike): PadState {
  const held = new Set<PadButton>();
  STANDARD_BUTTONS.forEach((button, i) => {
    const it = pad.buttons[i];
    if (it !== undefined && (it.pressed || it.value > PRESSED)) {
      held.add(button);
    }
  });
  return { family: padFamily(pad.id), held, stick: radial(pad.axes[0] ?? 0, pad.axes[1] ?? 0) };
}

/** The buttons held in `now` that were not in `before`: pressed since the last poll. */
export function pressedSince(before: PadState, now: PadState): PadButton[] {
  return STANDARD_BUTTONS.filter((button) => now.held.has(button) && !before.held.has(button));
}

/** The buttons held in `before` that are not any more: let go since the last poll. */
export function releasedSince(before: PadState, now: PadState): PadButton[] {
  return STANDARD_BUTTONS.filter((button) => before.held.has(button) && !now.held.has(button));
}

/**
 * Where the controller steers: the stick past its dead zone, as far as it leans. The D-pad walks
 * nobody: in the world it pings and opens the quick chat (input/padRuntime.ts).
 */
export function steerOf(state: PadState): { x: number; y: number } {
  return { ...state.stick };
}

/** How the controller steers the avatar: where it points, as far as it leans, and R1 held. */
export interface Steer {
  x: number;
  y: number;
  sprint: boolean;
}

/** No controller steering: the stick in the middle, R1 let go. */
export const NO_STEER: Steer = { x: 0, y: 0, sprint: false };

/** Whether the controller is in use: a button held, or the stick leaning past its dead zone. */
export function inUse(state: PadState): boolean {
  return state.held.size > 0 || state.stick.x !== 0 || state.stick.y !== 0;
}

/** The four ways the D-pad and a flick of the stick point, for moving between controls. */
export type Direction = 'up' | 'down' | 'left' | 'right';

/** How far the stick has to lean to count as a flick between controls. */
const FLICK = 0.5;

/** Where the D-pad or a flick of the stick points now; none at rest. */
export function directionOf(state: PadState): Direction | null {
  const pads: readonly [PadButton, Direction][] = [
    ['dup', 'up'],
    ['ddown', 'down'],
    ['dleft', 'left'],
    ['dright', 'right'],
  ];
  const pad = pads.find(([button]) => state.held.has(button));
  if (pad !== undefined) {
    return pad[1];
  }
  const { x, y } = state.stick;
  if (Math.max(Math.abs(x), Math.abs(y)) < FLICK) {
    return null;
  }
  if (Math.abs(x) > Math.abs(y)) {
    return x > 0 ? 'right' : 'left';
  }
  return y > 0 ? 'down' : 'up';
}

import type { ComponentType } from 'react';
import type { PuzzleInputOf, PuzzleView } from '@escapelab/core';
import { ButtonSyncPanel, syncSounds } from './ButtonSyncPanel.js';
import { KeypadPanel, keypadSounds } from './KeypadPanel.js';
import { MazePanel, MazePlan, mazeSounds } from './MazePanel.js';
import { SimonPanel } from './SimonPanel.js';
import { SwitchesPanel, switchesSounds } from './SwitchesPanel.js';
import { WiringPanel, wiringSounds } from './WiringPanel.js';
import { MemoryPanel, memorySounds } from './MemoryPanel.js';
import { MorsePanel, morseSounds } from './MorsePanel.js';
import { ButtonPanel } from './ButtonPanel.js';
import { RelayPanel } from './RelayPanel.js';
import { SignalPanel, signalSounds } from './SignalPanel.js';
import { CircuitPanel, circuitSounds } from './CircuitPanel.js';
import { ServersPanel, serversSounds } from './ServersPanel.js';
import { AccessList, AccessPanel, accessSounds } from './AccessPanel.js';
import type { MissionTime } from '../clock.js';
import type { Refusal } from '../ws.js';
import type { DeviceCrew } from './Device.js';
import type { Change } from './feel.js';

export type PuzzleKind = PuzzleView['kind'];

/** The open puzzle of one kind, as its views show it. */
export type ViewOf<K extends PuzzleKind> = Extract<PuzzleView, { kind: K }>;

/** What a module's panel gets: the open puzzle as seen at its station, and a way to answer. */
export interface PanelProps<K extends PuzzleKind> {
  puzzle: ViewOf<K>;
  /**
   * the latest change at the device while it has been open — the view before it, and
   * whether an alarm came with it — for what the change plays; null before any
   */
  change: Change<ViewOf<K>> | null;
  /** sends one of this module's inputs as a `puzzle-input` message */
  send: (input: PuzzleInputOf<K>) => void;
  /** the mission's clock, for modules whose rules read it (clock.ts) */
  mission: MissionTime;
  /** the crew at the device, for a device that names them — the main switch's levers */
  crew?: DeviceCrew;
  /**
   * a press the server refused while the device was open, as long as it is fresh — for a device
   * that answers it where the press was made as well as in its head: the terminal's prompt
   */
  refused?: Refusal | null;
}

export type Panel<K extends PuzzleKind> = ComponentType<PanelProps<K>>;

/**
 * Every module's panel, by kind. A new module adds its panel file and one
 * line here; the type insists on an entry for every kind the core knows.
 */
export const PANELS: { [K in PuzzleKind]: Panel<K> } = {
  'button-sync': ButtonSyncPanel,
  wiring: WiringPanel,
  keypad: KeypadPanel,
  switches: SwitchesPanel,
  simon: SimonPanel,
  maze: MazePanel,
  memory: MemoryPanel,
  morse: MorsePanel,
  button: ButtonPanel,
  signal: SignalPanel,
  relay: RelayPanel,
  circuit: CircuitPanel,
  servers: ServersPanel,
  access: AccessPanel,
};

/** What a change at a module's device sounds like, beyond the kit's press, alarm and solve. */
export type ChangeSoundsOf<K extends PuzzleKind> = (change: Change<ViewOf<K>>) => void;

/**
 * The sounds a change plays at a module's device, by kind: a cable's sparks, a toggle's
 * clack, a stage's chime. Played once per change, and only at a console (PuzzlePanel).
 * The simon plays its tones as its lamp flashes and its keys go down; the button and the
 * relay make theirs as they are worked.
 */
export const SOUNDS: { [K in PuzzleKind]?: ChangeSoundsOf<K> } = {
  'button-sync': syncSounds,
  wiring: wiringSounds,
  keypad: keypadSounds,
  switches: switchesSounds,
  maze: mazeSounds,
  memory: memorySounds,
  morse: morseSounds,
  signal: signalSounds,
  circuit: circuitSounds,
  servers: serversSounds,
  access: accessSounds,
};

/** What a reader panel gets: the open puzzle as seen at a manual object covering it. */
export interface ReaderProps<K extends PuzzleKind> {
  puzzle: ViewOf<K>;
}

export type Reader<K extends PuzzleKind> = ComponentType<ReaderProps<K>>;

/**
 * The modules that show a reader more than the printed rules, by kind — the
 * maze's wall plan, the Zugangskontrolle's list of this shift's accounts.
 * Most have no entry.
 */
export const READERS: { [K in PuzzleKind]?: Reader<K> } = {
  maze: MazePlan,
  access: AccessList,
};

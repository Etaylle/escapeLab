import type { ComponentType } from 'react';
import type { PuzzleInputOf, PuzzleView } from '@escapelab/core';
import { ButtonSyncPanel } from './ButtonSyncPanel.js';
import { KeypadPanel } from './KeypadPanel.js';
import { MazePanel } from './MazePanel.js';
import { SimonPanel } from './SimonPanel.js';
import { SwitchesPanel } from './SwitchesPanel.js';
import { WiringPanel } from './WiringPanel.js';
import { RelayPanel } from './RelayPanel.js';

export type PuzzleKind = PuzzleView['kind'];

/** What a module's panel gets: the open puzzle as this role sees it, and a way to answer. */
export interface PanelProps<K extends PuzzleKind> {
  puzzle: Extract<PuzzleView, { kind: K }>;
  /** sends one of this module's inputs as a `puzzle-input` message */
  send: (input: PuzzleInputOf<K>) => void;
  /** the mission clock's end, for modules whose rules read the clock; null when it is not running */
  deadlineAt: number | null;
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
  relay: RelayPanel,
};

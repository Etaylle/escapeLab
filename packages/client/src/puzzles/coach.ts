import type { PuzzleView } from '@escapelab/core';

/** A line for a newcomer; its `id` says which, so that a session shows it once. */
export interface CoachMark {
  id: string;
  text: string;
}

/** What a newcomer works the devices with: a finger on a touch screen, else a mouse. */
export type Pointer = 'touch' | 'mouse';

/** The pointer this window is worked with, as the stylesheets ask; a mouse without a window. */
export function pointerNow(): Pointer {
  if (typeof window === 'undefined') {
    return 'mouse';
  }
  return window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse';
}

/** A device's line: one for every pointer, or a tap and a click worded apart. */
type Line = string | Readonly<Record<Pointer, string>>;

/** Every device's line, by device: a module, or at a station with two consoles a console's part. */
const LINES = {
  'button-sync': 'Alle drücken zugleich — ein Druck allein verfällt.',
  wiring: {
    touch: 'Ein Tipp auf ein Kabel trennt es sofort.',
    mouse: 'Ein Klick auf ein Kabel trennt es sofort.',
  },
  keypad: 'Jeder Druck zählt sofort; eine richtige Taste leuchtet.',
  switches: 'Umlegen ist gefahrlos — erst PRÜFEN zählt.',
  simon: 'Die Lampe blinkt die Folge; ↻ spielt sie noch einmal ab.',
  maze: 'Jeder Pfeil geht ein Feld; die Wände zeigt nur der Plan.',
  memory: 'Nach jedem Druck notieren: Position und Beschriftung.',
  morse: 'Nach der langen Pause beginnt das Wort von vorn.',
  button: {
    touch: 'Kurz tippen drückt, länger halten hält den Knopf.',
    mouse: 'Kurz klicken drückt, länger halten hält den Knopf.',
  },
  'circuit-box': {
    touch: 'Antippen trennt das Kabel sofort.',
    mouse: 'Anklicken trennt das Kabel sofort.',
  },
  'circuit-meter': 'Nummer wählen, Wert ablesen.',
  'signal-sender': 'Zeichen von links nach rechts ansagen.',
  'signal-receiver': 'Tasten in der angesagten Folge drücken.',
} as const satisfies Record<string, Line>;

type Device = keyof typeof LINES;

/**
 * The device in front of the player: the module, or at a station with two
 * consoles this console's part. None for the relay, which is no station,
 * nor at a console nobody stands at.
 */
function deviceOf(puzzle: PuzzleView): Device | null {
  switch (puzzle.kind) {
    case 'circuit':
      return puzzle.role === null ? null : `circuit-${puzzle.role}`;
    case 'signal':
      return puzzle.role === null ? null : `signal-${puzzle.role}`;
    case 'relay':
      return null;
    default:
      return puzzle.kind;
  }
}

/**
 * The one line a newcomer needs at the device in front of them: what its
 * controls do, since the device itself says nothing. One per device; where
 * it names the gesture, the one `pointer` makes — a tap on a touch screen,
 * a click with a mouse.
 */
export function deviceCoach(puzzle: PuzzleView, pointer: Pointer = pointerNow()): CoachMark | null {
  const device = deviceOf(puzzle);
  if (device === null) {
    return null;
  }
  const line: Line = LINES[device];
  return { id: `device:${device}`, text: typeof line === 'string' ? line : line[pointer] };
}

/** `next` the first time a session meets it; null once it has been shown, and for no mark. */
export function firstSight(next: CoachMark | null, seen: ReadonlySet<string>): CoachMark | null {
  return next === null || seen.has(next.id) ? null : next;
}

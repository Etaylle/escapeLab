import type { PuzzleView } from '@escapelab/core';

/** A line for a newcomer; its `id` says which, so that a session shows it once. */
export interface CoachMark {
  id: string;
  text: string;
}

const mark = (device: string, text: string): CoachMark => ({ id: `device:${device}`, text });

/**
 * The one line a newcomer needs at the device in front of them: what its
 * controls do, since the device itself says nothing. One per device type —
 * a module, and at a station with two consoles each console's part. None
 * for the relay, which is no station, nor at a console nobody stands at.
 */
export function deviceCoach(puzzle: PuzzleView): CoachMark | null {
  switch (puzzle.kind) {
    case 'button-sync':
      return mark('button-sync', 'Alle drücken zugleich — ein Druck allein verfällt.');
    case 'wiring':
      return mark('wiring', 'Ein Tipp auf ein Kabel trennt es sofort.');
    case 'keypad':
      return mark('keypad', 'Jeder Druck zählt sofort; eine richtige Taste leuchtet.');
    case 'switches':
      return mark('switches', 'Umlegen ist gefahrlos — erst PRÜFEN zählt.');
    case 'simon':
      return mark('simon', 'Die Lampe blinkt die Folge; ↻ spielt sie noch einmal ab.');
    case 'maze':
      return mark('maze', 'Jeder Pfeil geht ein Feld; die Wände zeigt nur der Plan.');
    case 'memory':
      return mark('memory', 'Nach jedem Druck notieren: Position und Beschriftung.');
    case 'morse':
      return mark('morse', 'Nach der langen Pause beginnt das Wort von vorn.');
    case 'button':
      return mark('button', 'Kurz tippen drückt, länger halten hält den Knopf.');
    case 'circuit':
      if (puzzle.role === null) {
        return null;
      }
      return puzzle.role === 'box'
        ? mark('circuit-box', 'Antippen trennt das Kabel sofort.')
        : mark('circuit-meter', 'Nummer wählen, Wert ablesen.');
    case 'signal':
      if (puzzle.role === null) {
        return null;
      }
      return puzzle.role === 'sender'
        ? mark('signal-sender', 'Zeichen von links nach rechts ansagen.')
        : mark('signal-receiver', 'Tasten in der angesagten Folge drücken.');
    case 'relay':
      return null;
  }
}

/** `next` the first time a session meets it; null once it has been shown, and for no mark. */
export function firstSight(next: CoachMark | null, seen: ReadonlySet<string>): CoachMark | null {
  return next === null || seen.has(next.id) ? null : next;
}

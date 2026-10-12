import type { ManualBlock } from './module.js';

/**
 * The pieces every module's printed rules share. A manual opens on a drawing
 * of the device and its description, sets out the rules, and closes on a
 * worked example and the penalty line — the same frame on every page, so the
 * book reads as one technical document.
 */

/** The line drawing that opens a manual; the client draws it for the module type `of`. */
export function deviceFigure(of: string, device: string): ManualBlock {
  return { kind: 'figure', of, caption: `Abb. 1 — ${device}` };
}

/** The boxed example: what was seen, which rule or row applied, what was done. */
export function workedExample(lines: readonly string[]): ManualBlock {
  return { kind: 'example', title: 'Beispiel', lines: [...lines] };
}

/** The line a manual ends on: what a wrong move costs, and what it leaves behind. */
export function penaltyLine(penaltySec: number, after?: string): ManualBlock {
  const cost = `Fehlgriff: Alarm, −${penaltySec} s.`;
  return { kind: 'p', text: after === undefined ? cost : `${cost} ${after}` };
}

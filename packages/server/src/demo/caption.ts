import type { ManualSection } from '@escapelab/core';

/**
 * What one of the demo crew tells the other after reading a station's rules: a sentence of the
 * pages it just had open, word for word. The crew are machines and say nothing; where a crew of
 * people would call across what the book says, the audience reads this under the picture. It is
 * taken from the manual — rules, never an instance's answer (core `manual()`) — so it is true of
 * every run, and it is the reader's to give: the pages lay open on its own view.
 */

/** The heading under which a manual keeps what the workshop found out: its handiest sentences. */
export const WORKSHOP = 'Aus der Werkstatt';

/** The paragraphs of `section`, in order. */
const paragraphs = (section: ManualSection): string[] =>
  section.blocks.flatMap((block) => (block.kind === 'p' ? [block.text] : []));

/** The rule lines of `section`, in order. */
const rules = (section: ManualSection): string[] =>
  section.blocks.flatMap((block) => (block.kind === 'rules' ? block.items : []));

/**
 * The sentence of `manual` a reader passes on: the workshop's first note where the manual has
 * one, else its first rule; null for a manual with neither, of which nothing is said.
 */
export function captionFrom(manual: readonly ManualSection[]): string | null {
  const workshop = manual.filter((section) => section.heading === WORKSHOP).flatMap(paragraphs);
  return workshop[0] ?? manual.flatMap(rules)[0] ?? null;
}

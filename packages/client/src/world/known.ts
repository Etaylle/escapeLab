/**
 * Whether a thing on a map is known to the crew (core view.ts): then the view tells it whole —
 * a source's label and rules, a part's carrier and drop-off, whether a note was read. One
 * nobody has found shows only what it is and where, while in sight.
 */
export function known<T extends { known: boolean }>(thing: T): thing is Extract<T, { known: true }> {
  return thing.known;
}

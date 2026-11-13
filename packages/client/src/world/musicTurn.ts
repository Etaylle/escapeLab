/**
 * One piece of music at a time on the music's bus (docs/sound.md „The menu"): the menu's theme,
 * the end card's sting and theme, the opening's cue and the run's stems hand the bus on rather
 * than play over each other. A piece that goes says when its fade will have died (`holdMusic`);
 * a piece that comes starts no sooner (`musicFrom`). Times are the audio context's, s — one
 * context a page. Pure: nothing here touches the graph.
 */

/** The audio time from which the music's bus is free again. */
let freeAt = 0;

/** A piece of music going out holds the bus until `until`, when its fade has died. */
export function holdMusic(until: number): void {
  freeAt = Math.max(freeAt, until);
}

/** When a piece of music meant to start at `at` may: then, or once the bus is free. */
export function musicFrom(at: number): number {
  return Math.max(at, freeAt);
}

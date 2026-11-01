import { findKey, type Find } from '@escapelab/core';
import type { WorldMap } from './render/frame.js';

/**
 * Labels wait for discovery. A thing this player has not found (core discovery.ts) is drawn as
 * what it is where light has fallen on it — the sprite alone, no name under it, nothing calling
 * for attention; once the server says it is found, its name and its call come up over
 * LABEL_FADE_S from the moment this screen learns of it, at once where the player asked for less
 * motion. Whatever was found before this screen first looked shows at once. Pure.
 */

/** How long a label takes to come up, s. */
export const LABEL_FADE_S = 0.3;

/** When each thing's label came up on this screen, sim time s, by find key; for one run. */
export interface LabelClock {
  /** the run, by its `startedAt`; null before one */
  run: number | null;
  since: Map<string, number>;
}

/** A clock for `run` with no label up yet. */
export function labelClock(run: number | null): LabelClock {
  return { run, since: new Map() };
}

/** What of `map` with a name or a call this player has found: sources, notes, parts, the sign. */
export function foundIn(map: WorldMap): Find[] {
  return [
    ...map.manuals.filter((m) => m.found).map((m): Find => ({ of: 'source', id: m.id })),
    ...map.notes.filter((n) => n.found).map((n): Find => ({ of: 'note', index: n.index })),
    ...map.items.filter((i) => i.found).map((i): Find => ({ of: 'item', id: i.id })),
    ...(map.edgeworkSign?.found === true ? [{ of: 'sign' } as const] : []),
  ];
}

/**
 * The clock after `map` of run `run` at sim time `time`: a thing found for the first time comes
 * up now — on this screen's first look (`first`) long ago, since it was there before the screen
 * came in; a run of its own starts the clock afresh.
 */
export function noteLabels(
  clock: LabelClock,
  map: WorldMap,
  run: number | null,
  time: number,
  first: boolean,
): LabelClock {
  const next = clock.run === run ? { run, since: new Map(clock.since) } : labelClock(run);
  for (const find of foundIn(map)) {
    const key = findKey(find);
    if (!next.since.has(key)) {
      next.since.set(key, first ? -Infinity : time);
    }
  }
  return next;
}

/** How far the name and the call of `find` show at sim time `time`, 0 to 1. */
export function labelAlpha(clock: LabelClock, find: Find, time: number, reduced: boolean): number {
  const since = clock.since.get(findKey(find));
  if (since === undefined) {
    return 0;
  }
  return reduced ? 1 : Math.min(1, Math.max(0, (time - since) / LABEL_FADE_S));
}

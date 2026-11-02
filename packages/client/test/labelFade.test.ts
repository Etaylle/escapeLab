import { describe, expect, it } from 'vitest';
import type { Find } from '@escapelab/core';
import {
  foundIn,
  LABEL_FADE_S,
  labelAlpha,
  labelClock,
  noteLabels,
} from '../src/world/labelFade.js';
import { mapWith, type Item, type Manual } from './fixtures.js';

const book: Manual = {
  id: 'buch',
  kind: 'book',
  x: 2,
  y: 3,
  label: 'HANDBUCH',
  puzzleIds: [],
  opened: true,
  needsKey: null,
  found: true,
  known: true,
};
/** The locker the crew knows of, which this player has not found yet. */
const locker: Manual = { ...book, id: 'spind', kind: 'locker', x: 6, found: false };
const fuse: Item = {
  id: 'fuse',
  label: 'SICHERUNG',
  kind: 'fuse',
  x: 3.5,
  y: 4.5,
  carriedBy: null,
  delivered: false,
  deliverTo: null,
  requiredFor: null,
  found: true,
  known: true,
};
const BUCH: Find = { of: 'source', id: 'buch' };
const SPIND: Find = { of: 'source', id: 'spind' };

describe('labels — names wait for discovery', () => {
  it('names what this player has found: sources, notes, parts, the sign; nothing else', () => {
    const map = mapWith({
      manuals: [book, locker],
      notes: [
        { index: 0, x: 2, y: 0, read: false, found: true, known: true },
        { index: 1, x: 7, y: 2, read: false, found: false, known: true },
      ],
      items: [fuse, { ...fuse, id: 'key', found: false }],
      edgeworkSign: { x: 1, y: 1, found: true, known: true },
    });
    expect(foundIn(map)).toEqual([
      { of: 'source', id: 'buch' },
      { of: 'note', index: 0 },
      { of: 'item', id: 'fuse' },
      { of: 'sign' },
    ]);
    const sign = { x: 1, y: 1, found: false, known: false };
    expect(foundIn(mapWith({ edgeworkSign: sign }))).toEqual([]);
  });

  it('shows at once what was found before the screen looked, a later find from then', () => {
    const first = noteLabels(labelClock(null), mapWith({ manuals: [book, locker] }), 7, 10, true);
    expect(labelAlpha(first, BUCH, 10, false)).toBe(1);
    expect(labelAlpha(first, SPIND, 10, false)).toBe(0);
    const found = mapWith({ manuals: [book, { ...locker, found: true, known: true }] });
    const later = noteLabels(first, found, 7, 12, false);
    expect(labelAlpha(later, SPIND, 12, false)).toBe(0);
    expect(labelAlpha(later, SPIND, 12 + LABEL_FADE_S / 2, false)).toBeCloseTo(0.5);
    expect(labelAlpha(later, SPIND, 12 + LABEL_FADE_S, false)).toBe(1);
    expect(LABEL_FADE_S).toBe(0.3);
    // Looking again changes nothing: a name comes up once.
    expect(noteLabels(later, found, 7, 13, false).since.get('source:spind')).toBe(12);
  });

  it('cuts straight to the name where the player asked for less motion; none unfound', () => {
    const first = noteLabels(labelClock(null), mapWith({ manuals: [book, locker] }), 7, 10, true);
    const found = mapWith({ manuals: [{ ...locker, found: true, known: true }] });
    const later = noteLabels(first, found, 7, 12, false);
    expect(labelAlpha(later, SPIND, 12, true)).toBe(1);
    expect(labelAlpha(first, SPIND, 10, true)).toBe(0);
  });

  it('starts afresh with a run of its own, its finds fading in from then', () => {
    const first = noteLabels(labelClock(null), mapWith({ manuals: [book] }), 7, 10, true);
    const next = noteLabels(first, mapWith({ manuals: [book] }), 8, 20, false);
    expect(next.run).toBe(8);
    expect(labelAlpha(next, BUCH, 20, false)).toBe(0);
    expect(labelAlpha(next, BUCH, 20 + LABEL_FADE_S, false)).toBe(1);
  });
});

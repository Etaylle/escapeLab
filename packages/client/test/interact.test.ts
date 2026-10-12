import { describe, expect, it } from 'vitest';
import type { MapView } from '@escapelab/core';
import { contextAction } from '../src/world/interact.js';
import { mapWith, type Manual } from './fixtures.js';

const YOU = 'p1';

/** The armed station at (5,5), the book covering it at (2,5). */
const station: MapView['stations'][number] = {
  puzzleId: 'notstrom',
  x: 5,
  y: 5,
  title: 'Notstrom',
  status: 'armed',
};
const book: Manual = {
  id: 'buch',
  kind: 'book',
  x: 2,
  y: 5,
  label: 'HANDBUCH',
  puzzleIds: ['notstrom'],
};
/** What the server says this player stands at. */
const AT_BOOK = [{ id: 'buch' }];

function part(parts: Partial<MapView['items'][number]>): MapView['items'][number] {
  return {
    id: 'fuse',
    label: 'Sicherung',
    x: 3.5,
    y: 6.5,
    carriedBy: null,
    delivered: false,
    deliverTo: { x: 9, y: 2 },
    requiredForTitle: null,
    ...parts,
  };
}

describe('contextAction — what E does where the player stands', () => {
  it('reads a manual object the server counts the player at', () => {
    const map = mapWith({ stations: [station], manuals: [book] });
    expect(contextAction(map, { x: 2.5, y: 6.4 }, YOU, AT_BOOK)).toMatchObject({
      kind: 'read',
      manualId: 'buch',
      label: '[E] Lesen',
    });
  });

  it('offers no reading the server does not count yet, however close', () => {
    const map = mapWith({ manuals: [book] });
    expect(contextAction(map, { x: 2.5, y: 5.5 }, YOU, [])).toBeNull();
  });

  it('operates the armed station only', () => {
    const at = { x: 5.5, y: 6.5 };
    expect(contextAction(mapWith({ stations: [station] }), at, YOU, [])).toMatchObject({
      kind: 'operate',
      label: '[E] Bedienen',
    });
    for (const status of ['locked', 'done'] as const) {
      const map = mapWith({ stations: [{ ...station, status }] });
      expect(contextAction(map, at, YOU, [])).toBeNull();
    }
  });

  it('takes the nearer of station and manual object when both are in reach', () => {
    const map = mapWith({ stations: [station], manuals: [{ ...book, x: 4, y: 6 }] });
    const nearBook = contextAction(map, { x: 4.6, y: 6.4 }, YOU, AT_BOOK);
    expect(nearBook?.kind).toBe('read');
    const nearStation = contextAction(map, { x: 5.4, y: 5.6 }, YOU, AT_BOOK);
    expect(nearStation?.kind).toBe('operate');
  });

  it('picks up a loose part before anything else', () => {
    const map = mapWith({ stations: [station], manuals: [book], items: [part({})] });
    expect(contextAction(map, { x: 3.5, y: 6.2 }, YOU, AT_BOOK)).toMatchObject({
      kind: 'pick',
      label: '[E] Sicherung aufnehmen',
    });
  });

  it('with full hands delivers at the drop-off, reads elsewhere, but never operates', () => {
    const carried = part({ carriedBy: YOU, deliverTo: { x: 2, y: 6 } });
    const map = mapWith({ stations: [station], manuals: [book], items: [carried] });
    expect(contextAction(map, { x: 2.5, y: 6.5 }, YOU, AT_BOOK)?.kind).toBe('deliver');
    expect(contextAction(map, { x: 2.5, y: 4.4 }, YOU, AT_BOOK)?.kind).toBe('read');
    expect(contextAction(map, { x: 5.5, y: 6.4 }, YOU, [])).toBeNull();
  });

  it('offers nothing out of reach', () => {
    const map = mapWith({ stations: [station], manuals: [book] });
    expect(contextAction(map, { x: 9.5, y: 9.5 }, YOU, AT_BOOK)).toBeNull();
  });
});

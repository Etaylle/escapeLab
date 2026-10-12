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
  opened: true,
  needsKey: null,
};
/** What the server says this player stands at. */
const AT_BOOK = [{ id: 'buch', kind: 'book', opened: true, needsKey: null }] as const;

/** A locker at (2,5) and a cabinet at (8,5) unlocked by the key, both covering the station. */
const locker: Manual = { ...book, id: 'spind', kind: 'locker', label: 'SPIND', opened: false };
const cabinet: Manual = {
  ...book,
  id: 'schrank',
  kind: 'cabinet',
  x: 8,
  label: 'SCHRANK',
  opened: false,
  needsKey: 'key',
};
const AT_LOCKER = [{ id: 'spind', kind: 'locker', opened: false, needsKey: null }] as const;
const AT_CABINET = [{ id: 'schrank', kind: 'cabinet', opened: false, needsKey: 'key' }] as const;

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

describe('contextAction — lockers and cabinets', () => {
  const key = part({ id: 'key', label: 'SCHLÜSSEL', x: 4.5, y: 9.5, deliverTo: { x: 8, y: 5 } });

  it('searches a closed locker, full hands or not, and reads it once open', () => {
    const map = mapWith({ manuals: [locker] });
    expect(contextAction(map, { x: 2.5, y: 6.4 }, YOU, AT_LOCKER)).toMatchObject({
      kind: 'open',
      manualId: 'spind',
      label: '[E] Durchsuchen',
    });
    const carrying = mapWith({ manuals: [locker], items: [part({ carriedBy: YOU })] });
    expect(contextAction(carrying, { x: 2.5, y: 6.4 }, YOU, AT_LOCKER)?.kind).toBe('open');
    const open = mapWith({ manuals: [{ ...locker, opened: true }] });
    const searched = [{ ...AT_LOCKER[0], opened: true }];
    expect(contextAction(open, { x: 2.5, y: 6.4 }, YOU, searched)).toMatchObject({
      kind: 'read',
      manualId: 'spind',
      label: '[E] Lesen',
    });
  });

  it('unlocks a cabinet with its key in hand rather than handing the key in', () => {
    const map = mapWith({ manuals: [cabinet], items: [{ ...key, carriedBy: YOU }] });
    expect(contextAction(map, { x: 8.5, y: 5.6 }, YOU, AT_CABINET)).toMatchObject({
      kind: 'open',
      manualId: 'schrank',
      label: '[E] Aufschließen',
    });
    expect(contextAction(map, { x: 8.5, y: 5.6 }, YOU, [])).toBeNull();
  });

  it('names the missing key at a locked cabinet, and E there does nothing', () => {
    const away = mapWith({ manuals: [cabinet], items: [key] });
    expect(contextAction(away, { x: 8.5, y: 6.4 }, YOU, AT_CABINET)).toEqual({
      kind: 'locked',
      label: '🔒 SCHLÜSSEL fehlt',
      x: 8.5,
      y: 4.45,
    });
    const otherHands = mapWith({ manuals: [cabinet], items: [{ ...key, carriedBy: 'p2' }] });
    expect(contextAction(otherHands, { x: 8.5, y: 6.4 }, YOU, AT_CABINET)?.kind).toBe('locked');
    const wrongPart = mapWith({ manuals: [cabinet], items: [key, part({ carriedBy: YOU })] });
    expect(contextAction(wrongPart, { x: 8.5, y: 6.4 }, YOU, AT_CABINET)?.kind).toBe('locked');
  });

  it('lets a missing key hide nothing that can be done', () => {
    const map = mapWith({ stations: [station], manuals: [{ ...cabinet, x: 5, y: 6 }] });
    expect(contextAction(map, { x: 5.5, y: 6.4 }, YOU, AT_CABINET)?.kind).toBe('operate');
  });
});

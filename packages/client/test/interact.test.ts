import { describe, expect, it } from 'vitest';
import type { MapView } from '@escapelab/core';
import { contextAction } from '../src/world/interact.js';
import { mapWith, type Manual } from './fixtures.js';

const YOU = 'p1';
/** Whether the armed station's puzzle already runs: E there then only shows its panel. */
const OPEN = true;
const SHUT = false;

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
    expect(contextAction(map, { x: 2.5, y: 6.4 }, YOU, AT_BOOK, SHUT)).toMatchObject({
      kind: 'read',
      manualId: 'buch',
      label: '[E] Lesen',
    });
  });

  it('offers no reading the server does not count yet, however close', () => {
    const map = mapWith({ manuals: [book] });
    expect(contextAction(map, { x: 2.5, y: 5.5 }, YOU, [], SHUT)).toBeNull();
  });

  it('operates the armed station only, shut or open', () => {
    const at = { x: 5.5, y: 6.5 };
    for (const open of [SHUT, OPEN]) {
      expect(contextAction(mapWith({ stations: [station] }), at, YOU, [], open)).toMatchObject({
        kind: 'operate',
        label: '[E] Bedienen',
      });
    }
    for (const status of ['locked', 'done'] as const) {
      const map = mapWith({ stations: [{ ...station, status }] });
      expect(contextAction(map, at, YOU, [], SHUT)).toBeNull();
    }
  });

  it('takes the nearer of station and manual object when both are in reach', () => {
    const map = mapWith({ stations: [station], manuals: [{ ...book, x: 4, y: 6 }] });
    const nearBook = contextAction(map, { x: 4.6, y: 6.4 }, YOU, AT_BOOK, SHUT);
    expect(nearBook?.kind).toBe('read');
    const nearStation = contextAction(map, { x: 5.4, y: 5.6 }, YOU, AT_BOOK, SHUT);
    expect(nearStation?.kind).toBe('operate');
  });

  it('picks up a loose part only when it is the nearest thing in reach', () => {
    const map = mapWith({ stations: [station], manuals: [book], items: [part({})] });
    expect(contextAction(map, { x: 3.5, y: 6.2 }, YOU, AT_BOOK, SHUT)).toMatchObject({
      kind: 'pick',
      label: '[E] Sicherung aufnehmen',
    });
    // The book beside the part: whoever stands nearer the book reads it.
    expect(contextAction(map, { x: 2.9, y: 6 }, YOU, AT_BOOK, SHUT)?.kind).toBe('read');
  });

  it('works an open station nearer than a loose part, but leaves a shut one to the part', () => {
    const map = mapWith({ stations: [station], items: [part({ x: 5.5, y: 7.1 })] });
    const at = { x: 5.5, y: 6.25 };
    expect(contextAction(map, at, YOU, [], OPEN)?.kind).toBe('operate');
    // Switching on goes through the server, which picks up the part first.
    expect(contextAction(map, at, YOU, [], SHUT)?.kind).toBe('pick');
  });

  it('with full hands delivers at the drop-off and works an open station, switching none on', () => {
    const carried = part({ carriedBy: YOU, deliverTo: { x: 2, y: 6 } });
    const map = mapWith({ stations: [station], manuals: [book], items: [carried] });
    expect(contextAction(map, { x: 2.5, y: 6.5 }, YOU, AT_BOOK, OPEN)?.kind).toBe('deliver');
    expect(contextAction(map, { x: 2.5, y: 4.4 }, YOU, AT_BOOK, OPEN)?.kind).toBe('read');
    expect(contextAction(map, { x: 5.5, y: 6.4 }, YOU, [], OPEN)).toMatchObject({
      kind: 'operate',
      label: '[E] Bedienen',
    });
    expect(contextAction(map, { x: 5.5, y: 6.4 }, YOU, [], SHUT)).toBeNull();
  });

  it('lets a second player with the part in hand work the station the first one opened', () => {
    const map = mapWith({
      stations: [station],
      manuals: [{ ...book, x: 4, y: 6 }],
      items: [part({ carriedBy: YOU })],
    });
    expect(contextAction(map, { x: 5.4, y: 5.6 }, YOU, AT_BOOK, OPEN)?.kind).toBe('operate');
    expect(contextAction(map, { x: 4.6, y: 6.4 }, YOU, AT_BOOK, OPEN)?.kind).toBe('read');
  });

  it('offers nothing out of reach', () => {
    const map = mapWith({ stations: [station], manuals: [book] });
    expect(contextAction(map, { x: 9.5, y: 9.5 }, YOU, AT_BOOK, OPEN)).toBeNull();
  });
});

describe('contextAction — lockers and cabinets', () => {
  const key = part({ id: 'key', label: 'SCHLÜSSEL', x: 4.5, y: 9.5, deliverTo: { x: 8, y: 5 } });

  it('searches a closed locker, full hands or not, and reads it once open', () => {
    const map = mapWith({ manuals: [locker] });
    expect(contextAction(map, { x: 2.5, y: 6.4 }, YOU, AT_LOCKER, SHUT)).toMatchObject({
      kind: 'open',
      manualId: 'spind',
      label: '[E] Durchsuchen',
    });
    const carrying = mapWith({ manuals: [locker], items: [part({ carriedBy: YOU })] });
    expect(contextAction(carrying, { x: 2.5, y: 6.4 }, YOU, AT_LOCKER, SHUT)?.kind).toBe('open');
    const open = mapWith({ manuals: [{ ...locker, opened: true }] });
    const searched = [{ ...AT_LOCKER[0], opened: true }];
    expect(contextAction(open, { x: 2.5, y: 6.4 }, YOU, searched, SHUT)).toMatchObject({
      kind: 'read',
      manualId: 'spind',
      label: '[E] Lesen',
    });
  });

  it('unlocks a cabinet with its key in hand rather than handing the key in', () => {
    const map = mapWith({ manuals: [cabinet], items: [{ ...key, carriedBy: YOU }] });
    expect(contextAction(map, { x: 8.5, y: 5.6 }, YOU, AT_CABINET, SHUT)).toMatchObject({
      kind: 'open',
      manualId: 'schrank',
      label: '[E] Aufschließen',
    });
    expect(contextAction(map, { x: 8.5, y: 5.6 }, YOU, [], SHUT)).toBeNull();
  });

  it('names the missing key at a locked cabinet, and E there does nothing', () => {
    const away = mapWith({ manuals: [cabinet], items: [key] });
    expect(contextAction(away, { x: 8.5, y: 6.4 }, YOU, AT_CABINET, SHUT)).toEqual({
      kind: 'locked',
      label: '🔒 SCHLÜSSEL fehlt',
      x: 8.5,
      y: 4.45,
    });
    const otherHands = mapWith({ manuals: [cabinet], items: [{ ...key, carriedBy: 'p2' }] });
    const wrongPart = mapWith({ manuals: [cabinet], items: [key, part({ carriedBy: YOU })] });
    for (const map of [otherHands, wrongPart]) {
      expect(contextAction(map, { x: 8.5, y: 6.4 }, YOU, AT_CABINET, SHUT)?.kind).toBe('locked');
    }
  });

  it('lets a missing key hide nothing that can be done', () => {
    const map = mapWith({ stations: [station], manuals: [{ ...cabinet, x: 5, y: 6 }] });
    expect(contextAction(map, { x: 5.5, y: 6.4 }, YOU, AT_CABINET, SHUT)?.kind).toBe('operate');
  });
});

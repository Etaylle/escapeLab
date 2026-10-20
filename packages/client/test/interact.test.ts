import { describe, expect, it } from 'vitest';
import type { MapView } from '@escapelab/core';
import { contextAction, promptText } from '../src/world/interact.js';
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
      label: 'Lesen',
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
        label: 'Bedienen',
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
      label: 'Sicherung aufnehmen',
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

  it('with full hands delivers at the drop-off and works the station, shut or open', () => {
    const carried = part({ carriedBy: YOU, deliverTo: { x: 2, y: 6 } });
    const map = mapWith({ stations: [station], manuals: [book], items: [carried] });
    expect(contextAction(map, { x: 2.5, y: 6.5 }, YOU, AT_BOOK, OPEN)?.kind).toBe('deliver');
    expect(contextAction(map, { x: 2.5, y: 4.4 }, YOU, AT_BOOK, OPEN)?.kind).toBe('read');
    for (const open of [SHUT, OPEN]) {
      expect(contextAction(map, { x: 5.5, y: 6.4 }, YOU, [], open)).toMatchObject({
        kind: 'operate',
        label: 'Bedienen',
      });
    }
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

describe('contextAction — a station with two consoles', () => {
  /** Console a at (5,5), console b at (12,5): one puzzle, armed at both. */
  const consoles: MapView['stations'] = [
    { ...station, console: 'a' },
    { ...station, x: 12, console: 'b' },
  ];

  it('works whichever console the player stands at, shut or open', () => {
    const map = mapWith({ stations: consoles });
    for (const open of [SHUT, OPEN]) {
      expect(contextAction(map, { x: 5.5, y: 6.4 }, YOU, [], open)).toEqual({
        kind: 'operate',
        label: 'Bedienen',
        x: 5.5,
        y: 4.45,
      });
      expect(contextAction(map, { x: 12.5, y: 6.4 }, YOU, [], open)).toEqual({
        kind: 'operate',
        label: 'Bedienen',
        x: 12.5,
        y: 4.45,
      });
    }
  });

  it('offers nothing between the consoles, out of reach of both', () => {
    const map = mapWith({ stations: consoles });
    expect(contextAction(map, { x: 9, y: 6.4 }, YOU, [], OPEN)).toBeNull();
  });

  it('takes the nearer of a console and a manual object', () => {
    const map = mapWith({ stations: consoles, manuals: [{ ...book, x: 11, y: 6 }] });
    expect(contextAction(map, { x: 11.4, y: 6.6 }, YOU, AT_BOOK, SHUT)?.kind).toBe('read');
    expect(contextAction(map, { x: 12.4, y: 5.9 }, YOU, AT_BOOK, SHUT)?.kind).toBe('operate');
  });
});

describe('contextAction — lockers and cabinets', () => {
  const key = part({ id: 'key', label: 'SCHLÜSSEL', x: 4.5, y: 9.5, deliverTo: { x: 8, y: 5 } });

  it('searches a closed locker, full hands or not, and reads it once open', () => {
    const map = mapWith({ manuals: [locker] });
    expect(contextAction(map, { x: 2.5, y: 6.4 }, YOU, AT_LOCKER, SHUT)).toMatchObject({
      kind: 'open',
      manualId: 'spind',
      label: 'Durchsuchen',
    });
    const carrying = mapWith({ manuals: [locker], items: [part({ carriedBy: YOU })] });
    expect(contextAction(carrying, { x: 2.5, y: 6.4 }, YOU, AT_LOCKER, SHUT)?.kind).toBe('open');
    const open = mapWith({ manuals: [{ ...locker, opened: true }] });
    const searched = [{ ...AT_LOCKER[0], opened: true }];
    expect(contextAction(open, { x: 2.5, y: 6.4 }, YOU, searched, SHUT)).toMatchObject({
      kind: 'read',
      manualId: 'spind',
      label: 'Lesen',
    });
  });

  it('unlocks a cabinet with its key in hand rather than handing the key in', () => {
    const map = mapWith({ manuals: [cabinet], items: [{ ...key, carriedBy: YOU }] });
    expect(contextAction(map, { x: 8.5, y: 5.6 }, YOU, AT_CABINET, SHUT)).toMatchObject({
      kind: 'open',
      manualId: 'schrank',
      label: 'Aufschließen',
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

describe('promptText — the prompt over the world', () => {
  const KEYBOARD = true;
  const TOUCH = false;
  /** The armed station at (5,5), a closed locker at (2,5), the fuse at (3.5,6.5). */
  const map = mapWith({ stations: [station], manuals: [locker], items: [part({})] });
  /** The prompt where the player stands, the server counting them at what `here` lists. */
  const prompt = (x: number, y: number, keyboard: boolean, here = AT_LOCKER) => {
    const action = contextAction(map, { x, y }, YOU, here, SHUT);
    return action === null ? null : promptText(action, keyboard);
  };

  it('puts the key before the verb on a keyboard', () => {
    expect(prompt(5.5, 6.4, KEYBOARD)).toBe('[E] Bedienen');
    expect(prompt(2.5, 6.4, KEYBOARD)).toBe('[E] Durchsuchen');
    expect(prompt(3.5, 6.6, KEYBOARD)).toBe('[E] Sicherung aufnehmen');
  });

  it('names no key on a touch screen: the verb alone', () => {
    expect(prompt(5.5, 6.4, TOUCH)).toBe('Bedienen');
    expect(prompt(2.5, 6.4, TOUCH)).toBe('Durchsuchen');
    expect(prompt(3.5, 6.6, TOUCH)).toBe('Sicherung aufnehmen');
  });

  it('names only what is missing at a locked cabinet, keyboard or touch', () => {
    const key = part({ id: 'key', label: 'SCHLÜSSEL', x: 4.5, y: 9.5, deliverTo: { x: 8, y: 5 } });
    const locked = contextAction(
      mapWith({ manuals: [cabinet], items: [key] }),
      { x: 8.5, y: 6.4 },
      YOU,
      AT_CABINET,
      SHUT,
    );
    expect(locked?.kind).toBe('locked');
    if (locked !== null) {
      expect(promptText(locked, KEYBOARD)).toBe('🔒 SCHLÜSSEL fehlt');
      expect(promptText(locked, TOUCH)).toBe('🔒 SCHLÜSSEL fehlt');
    }
  });
});

import { describe, expect, it } from 'vitest';
import type { MapView } from '@escapelab/core';
import { carriedItem, contextAction, promptText } from '../src/world/interact.js';
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
    expect(contextAction(map, { x: 2.5, y: 6.4 }, YOU, AT_BOOK, SHUT, null)).toMatchObject({
      kind: 'read',
      manualId: 'buch',
      label: 'Lesen',
    });
  });

  it('offers no reading the server does not count yet, however close', () => {
    const map = mapWith({ manuals: [book] });
    expect(contextAction(map, { x: 2.5, y: 5.5 }, YOU, [], SHUT, null)).toBeNull();
  });

  it('operates the armed station only, shut or open', () => {
    const at = { x: 5.5, y: 6.5 };
    for (const open of [SHUT, OPEN]) {
      const map = mapWith({ stations: [station] });
      expect(contextAction(map, at, YOU, [], open, null)).toMatchObject({
        kind: 'operate',
        label: 'Bedienen',
      });
    }
    for (const status of ['locked', 'done'] as const) {
      const map = mapWith({ stations: [{ ...station, status }] });
      expect(contextAction(map, at, YOU, [], SHUT, null)).toBeNull();
    }
  });

  it('takes the nearer of station and manual object when both are in reach', () => {
    const map = mapWith({ stations: [station], manuals: [{ ...book, x: 4, y: 6 }] });
    const nearBook = contextAction(map, { x: 4.6, y: 6.4 }, YOU, AT_BOOK, SHUT, null);
    expect(nearBook?.kind).toBe('read');
    const nearStation = contextAction(map, { x: 5.4, y: 5.6 }, YOU, AT_BOOK, SHUT, null);
    expect(nearStation?.kind).toBe('operate');
  });

  it('picks up a loose part only when it is the nearest thing in reach', () => {
    const map = mapWith({ stations: [station], manuals: [book], items: [part({})] });
    expect(contextAction(map, { x: 3.5, y: 6.2 }, YOU, AT_BOOK, SHUT, null)).toMatchObject({
      kind: 'pick',
      label: 'Sicherung aufnehmen',
    });
    // The book beside the part: whoever stands nearer the book reads it.
    expect(contextAction(map, { x: 2.9, y: 6 }, YOU, AT_BOOK, SHUT, null)?.kind).toBe('read');
  });

  it('works an open station nearer than a loose part, but leaves a shut one to the part', () => {
    const map = mapWith({ stations: [station], items: [part({ x: 5.5, y: 7.1 })] });
    const at = { x: 5.5, y: 6.25 };
    expect(contextAction(map, at, YOU, [], OPEN, null)?.kind).toBe('operate');
    // Switching on goes through the server, which picks up the part first.
    expect(contextAction(map, at, YOU, [], SHUT, null)?.kind).toBe('pick');
  });

  it('with full hands delivers at the drop-off and works the station, shut or open', () => {
    const carried = part({ carriedBy: YOU, deliverTo: { x: 2, y: 6 } });
    const map = mapWith({ stations: [station], manuals: [book], items: [carried] });
    expect(contextAction(map, { x: 2.5, y: 6.5 }, YOU, AT_BOOK, OPEN, null)?.kind).toBe('deliver');
    expect(contextAction(map, { x: 2.5, y: 4.4 }, YOU, AT_BOOK, OPEN, null)?.kind).toBe('read');
    for (const open of [SHUT, OPEN]) {
      expect(contextAction(map, { x: 5.5, y: 6.4 }, YOU, [], open, null)).toMatchObject({
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
    expect(contextAction(map, { x: 5.4, y: 5.6 }, YOU, AT_BOOK, OPEN, null)?.kind).toBe('operate');
    expect(contextAction(map, { x: 4.6, y: 6.4 }, YOU, AT_BOOK, OPEN, null)?.kind).toBe('read');
  });

  it('offers nothing out of reach', () => {
    const map = mapWith({ stations: [station], manuals: [book] });
    expect(contextAction(map, { x: 9.5, y: 9.5 }, YOU, AT_BOOK, OPEN, null)).toBeNull();
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
      expect(contextAction(map, { x: 5.5, y: 6.4 }, YOU, [], open, null)).toEqual({
        kind: 'operate',
        label: 'Bedienen',
        x: 5.5,
        y: 4.45,
      });
      expect(contextAction(map, { x: 12.5, y: 6.4 }, YOU, [], open, null)).toEqual({
        kind: 'operate',
        label: 'Bedienen',
        x: 12.5,
        y: 4.45,
      });
    }
  });

  it('offers nothing between the consoles, out of reach of both', () => {
    const map = mapWith({ stations: consoles });
    expect(contextAction(map, { x: 9, y: 6.4 }, YOU, [], OPEN, null)).toBeNull();
  });

  it('takes the nearer of a console and a manual object', () => {
    const map = mapWith({ stations: consoles, manuals: [{ ...book, x: 11, y: 6 }] });
    expect(contextAction(map, { x: 11.4, y: 6.6 }, YOU, AT_BOOK, SHUT, null)?.kind).toBe('read');
    expect(contextAction(map, { x: 12.4, y: 5.9 }, YOU, AT_BOOK, SHUT, null)?.kind).toBe('operate');
  });
});

describe('contextAction — lockers and cabinets', () => {
  const key = part({ id: 'key', label: 'SCHLÜSSEL', x: 4.5, y: 9.5, deliverTo: { x: 8, y: 5 } });

  it('searches a closed locker, full hands or not, and reads it once open', () => {
    const map = mapWith({ manuals: [locker] });
    expect(contextAction(map, { x: 2.5, y: 6.4 }, YOU, AT_LOCKER, SHUT, null)).toMatchObject({
      kind: 'open',
      manualId: 'spind',
      label: 'Durchsuchen',
    });
    const carrying = mapWith({ manuals: [locker], items: [part({ carriedBy: YOU })] });
    const reached = contextAction(carrying, { x: 2.5, y: 6.4 }, YOU, AT_LOCKER, SHUT, null);
    expect(reached?.kind).toBe('open');
    const open = mapWith({ manuals: [{ ...locker, opened: true }] });
    const searched = [{ ...AT_LOCKER[0], opened: true }];
    expect(contextAction(open, { x: 2.5, y: 6.4 }, YOU, searched, SHUT, null)).toMatchObject({
      kind: 'read',
      manualId: 'spind',
      label: 'Lesen',
    });
  });

  it('unlocks a cabinet with its key in hand rather than handing the key in', () => {
    const map = mapWith({ manuals: [cabinet], items: [{ ...key, carriedBy: YOU }] });
    expect(contextAction(map, { x: 8.5, y: 5.6 }, YOU, AT_CABINET, SHUT, null)).toMatchObject({
      kind: 'open',
      manualId: 'schrank',
      label: 'Aufschließen',
    });
    expect(contextAction(map, { x: 8.5, y: 5.6 }, YOU, [], SHUT, null)).toBeNull();
  });

  it('names the missing key at a locked cabinet, and E there does nothing', () => {
    const away = mapWith({ manuals: [cabinet], items: [key] });
    expect(contextAction(away, { x: 8.5, y: 6.4 }, YOU, AT_CABINET, SHUT, null)).toEqual({
      kind: 'locked',
      label: '🔒 SCHLÜSSEL fehlt',
      x: 8.5,
      y: 4.45,
    });
    const otherHands = mapWith({ manuals: [cabinet], items: [{ ...key, carriedBy: 'p2' }] });
    const wrongPart = mapWith({ manuals: [cabinet], items: [key, part({ carriedBy: YOU })] });
    for (const map of [otherHands, wrongPart]) {
      const at = { x: 8.5, y: 6.4 };
      expect(contextAction(map, at, YOU, AT_CABINET, SHUT, null)?.kind).toBe('locked');
    }
  });

  it('lets a missing key hide nothing that can be done', () => {
    const map = mapWith({ stations: [station], manuals: [{ ...cabinet, x: 5, y: 6 }] });
    const atStation = { x: 5.5, y: 6.4 };
    expect(contextAction(map, atStation, YOU, AT_CABINET, SHUT, null)?.kind).toBe('operate');
  });
});

describe('promptText — the prompt over the world', () => {
  const KEYBOARD = true;
  const TOUCH = false;
  /** The armed station at (5,5), a closed locker at (2,5), the fuse at (3.5,6.5). */
  const map = mapWith({ stations: [station], manuals: [locker], items: [part({})] });
  /** The prompt where the player stands, the server counting them at what `here` lists. */
  const prompt = (x: number, y: number, keyboard: boolean, here = AT_LOCKER) => {
    const action = contextAction(map, { x, y }, YOU, here, SHUT, null);
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
      null,
    );
    expect(locked?.kind).toBe('locked');
    if (locked !== null) {
      expect(promptText(locked, KEYBOARD)).toBe('🔒 SCHLÜSSEL fehlt');
      expect(promptText(locked, TOUCH)).toBe('🔒 SCHLÜSSEL fehlt');
    }
  });
});

describe('carriedItem — what a player has in hand', () => {
  it('finds the item a player carries, and only theirs', () => {
    const items = [part({ id: 'kern', carriedBy: 'p2' }), part({ carriedBy: YOU })];
    const map = mapWith({ items });
    expect(carriedItem(map, YOU)?.id).toBe('fuse');
    expect(carriedItem(map, 'p2')?.id).toBe('kern');
    expect(carriedItem(map, 'p3')).toBeUndefined();
  });

  it('finds nothing in empty hands, or once the item is in its place', () => {
    expect(carriedItem(mapWith({ items: [part({})] }), YOU)).toBeUndefined();
    const placed = mapWith({ items: [part({ carriedBy: YOU, delivered: true })] });
    expect(carriedItem(placed, YOU)).toBeUndefined();
  });
});

/**
 * A room 8 tiles wide with a note pinned to its north wall at (3,0), read
 * from (3,1) below it, one lying on the floor at (7,4), and the armed
 * station at (5,1).
 */
const ROOM = ['##########', ...Array.from({ length: 5 }, () => '#........#'), '##########'];
const wallNote = { index: 0, x: 3, y: 0, read: false };
const floorNote = { index: 1, x: 7, y: 4, read: true };
const noteRoom = mapWith({
  tiles: ROOM,
  notes: [wallNote, floorNote],
  stations: [{ ...station, x: 5, y: 1 }],
});

describe('contextAction — a note of the last shift', () => {
  it('reads the note the server counts this player at, the prompt over its sheet', () => {
    const action = contextAction(noteRoom, { x: 3.5, y: 1.6 }, YOU, [], SHUT, { index: 0 });
    expect(action).toEqual({ kind: 'note', index: 0, label: 'Lesen', x: 3.5, y: 1 - 0.85 });
    expect(action === null ? null : promptText(action, true)).toBe('[E] Lesen');
    const floor = contextAction(noteRoom, { x: 7.5, y: 3.6 }, YOU, [], SHUT, { index: 1 });
    expect(floor).toEqual({ kind: 'note', index: 1, label: 'Lesen', x: 7.5, y: 4.5 - 0.55 });
  });

  it('offers nothing where the server counts nobody at it, or the crew has not found it', () => {
    expect(contextAction(noteRoom, { x: 3.5, y: 1.6 }, YOU, [], SHUT, null)?.kind).not.toBe('note');
    const unfound = mapWith({ tiles: ROOM, notes: [floorNote] });
    expect(contextAction(unfound, { x: 3.5, y: 1.6 }, YOU, [], SHUT, { index: 0 })).toBeNull();
  });

  it('takes the nearer of a note and the armed station', () => {
    expect(contextAction(noteRoom, { x: 4.1, y: 1.5 }, YOU, [], SHUT, { index: 0 })?.kind).toBe(
      'note',
    );
    expect(contextAction(noteRoom, { x: 5.2, y: 1.5 }, YOU, [], SHUT, { index: 0 })?.kind).toBe(
      'operate',
    );
  });
});

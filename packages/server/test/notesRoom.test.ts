import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOTE_READ, parseMission, type Mission, type ServerMessage } from '@escapelab/core';
import { Room } from '../src/room.js';
import { walkTo, type Walker } from './walk.js';

/**
 * Two rooms one above the other, a gap at the east end between them, and a
 * note of the last crew pinned to the wall between them at (5,2): it hangs
 * on that wall's south face, so it is read from (5,3), in the south room.
 *
 *   0123456789
 * 0 ##########
 * 1 #........#   spawns (1,1) and (2,1); keypad (3,1)
 * 2 ########.#   the note on the wall (5,2), facing south
 * 3 #........#   book (8,3)
 * 4 ##########
 */
const NOTE = 'Gemeldet war es.';

const mission: Mission = parseMission({
  id: 'notizraum',
  title: 'Notiz-Raum',
  players: { min: 2, max: 2 },
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  puzzles: [{ type: 'keypad', id: 'code', title: 'Code' }],
  map: {
    tiles: ['##########', '#........#', '########.#', '#........#', '##########'],
    spawns: [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ],
    stations: [{ puzzleId: 'code', x: 3, y: 1 }],
    manuals: [
      { id: 'buch', kind: 'book', label: 'HANDBUCH', puzzleIds: ['code'], spots: [{ x: 8, y: 3 }] },
    ],
    notes: [{ x: 5, y: 2, text: NOTE }],
  },
});

function collector(): { messages: ServerMessage[]; listen: (m: ServerMessage) => void } {
  const messages: ServerMessage[] = [];
  return { messages, listen: (m) => messages.push(m) };
}

function lastView(walker: Walker) {
  const last = walker.messages.filter((m) => m.kind === 'view').at(-1);
  if (last?.kind !== 'view') {
    throw new Error('expected a view message');
  }
  return last.view;
}

describe('Room with a note of the last crew', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function started() {
    const room = new Room('TEST', mission);
    const anna = { ...room.join('Anna'), ...collector() };
    const ben = { ...room.join('Ben'), ...collector() };
    room.attach(anna.playerId, anna.listen);
    room.attach(ben.playerId, ben.listen);
    room.setReady(ben.playerId, true);
    room.act(anna.playerId, { kind: 'start-mission' });
    return { room, anna, ben };
  }

  it('finds a note by sight from the room its face looks into, not through its wall', () => {
    const { room, anna, ben } = started();
    const watched = collector();
    room.attachSpectator(watched.listen);
    const audience = watched.messages.filter((m) => m.kind === 'spectator-view').at(-1);
    expect(audience?.kind === 'spectator-view' ? audience.view.map?.notes : null).toEqual([
      { index: 0, x: 5, y: 2, read: false },
    ]);
    // Right behind the wall, two tiles from where it is read: neither found nor read there.
    walkTo(room, anna, 5.5, 1.5);
    expect(lastView(anna).map?.notes).toEqual([]);
    expect(lastView(anna).noteHere).toBeNull();
    // Round by the gap into the south room, up to the note: found for the crew, read by Anna.
    walkTo(room, anna, 5.5, 3.5);
    expect(lastView(ben).map?.notes).toEqual([{ index: 0, x: 5, y: 2, read: false }]);
    expect(lastView(anna).noteHere).toEqual({ index: 0, text: NOTE });
    expect(lastView(ben).noteHere).toBeNull();
    expect(JSON.stringify(lastView(ben))).not.toContain(NOTE);
  });

  it('logs a note read once, and only for who stands at it', () => {
    const { room, anna, ben } = started();
    walkTo(room, anna, 5.5, 3.5);
    expect(() => room.act(ben.playerId, { kind: 'read-note', note: 0 })).toThrow(
      'Nur direkt davor.',
    );
    const deadline = lastView(anna).deadlineAt;
    room.act(anna.playerId, { kind: 'read-note', note: 0 });
    room.act(anna.playerId, { kind: 'read-note', note: 0 });
    const events = lastView(ben).events.filter((e) => e.kind === 'note');
    expect(events.map((e) => e.label)).toEqual([NOTE_READ]);
    expect(lastView(ben).map?.notes).toEqual([{ index: 0, x: 5, y: 2, read: true }]);
    expect(lastView(anna).deadlineAt).toBe(deadline);
  });
});

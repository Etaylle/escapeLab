import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMission, type Mission, type ServerMessage } from '@escapelab/core';
import { Room } from '../src/room.js';
import { walkTo, type Walker } from './walk.js';

/**
 * A corridor for two or three: the wiring box at its west end beside the
 * spawns, a locker and a cabinet holding its rules at the east end, and the
 * cabinet's key halfway.
 *
 *   0123456789012345
 * 0 ################
 * 1 #..............#   box (3,1); locker (14,1)
 * 2 #..............#   sign (2,2); key (8,2); cabinet (14,2)
 * 3 ################
 */
const mission: Mission = parseMission({
  id: 'quellenraum',
  title: 'Quellen-Raum',
  players: { min: 2, max: 3 },
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  puzzles: [{ type: 'wiring', id: 'kabel', title: 'Kabel' }],
  map: {
    tiles: ['################', '#..............#', '#..............#', '################'],
    spawns: [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 1 },
    ],
    stations: [{ puzzleId: 'kabel', x: 3, y: 1 }],
    manuals: [
      {
        id: 'spind',
        kind: 'locker',
        label: 'SPIND',
        puzzleIds: ['kabel'],
        spots: [{ x: 14, y: 1 }],
      },
      {
        id: 'schrank',
        kind: 'cabinet',
        label: 'SCHRANK',
        puzzleIds: ['kabel'],
        spots: [{ x: 14, y: 2 }],
        needsKey: 'schluessel',
      },
    ],
    items: [{ id: 'schluessel', label: 'SCHLÜSSEL', x: 8, y: 2 }],
    edgeworkSign: { x: 2, y: 2 },
  },
});

/**
 * Two rooms and a plate door between them, the locker in the east one: three
 * tiles straight behind the door at (6,2), or round its corner at (5,1).
 *
 *   0123456789
 * 0 ##########
 * 1 #...#....#   spawns (1,1) and (2,1)
 * 2 #........#   station (1,2); door (4,2)
 * 3 #...#....#   plate (1,3); sign (3,3)
 * 4 ##########
 */
function behindTheDoor(locker: { x: number; y: number }): Mission {
  return parseMission({
    id: 'sichtraum',
    title: 'Sicht-Raum',
    players: { min: 2, max: 2 },
    story: { intro: 'i', win: 'w', lose: 'l' },
    timeLimitSec: 600,
    puzzles: [{ type: 'wiring', id: 'kabel', title: 'Kabel' }],
    map: {
      tiles: ['##########', '#...#....#', '#........#', '#...#....#', '##########'],
      spawns: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
      ],
      stations: [{ puzzleId: 'kabel', x: 1, y: 2 }],
      doors: [{ id: 'tuer', x: 4, y: 2, opensBy: { kind: 'plate', plateId: 'platte' } }],
      plates: [{ id: 'platte', x: 1, y: 3, label: 'HALTEN' }],
      manuals: [
        { id: 'spind', kind: 'locker', label: 'SPIND', puzzleIds: ['kabel'], spots: [locker] },
      ],
      edgeworkSign: { x: 3, y: 3 },
    },
  });
}

function collector(): { messages: ServerMessage[]; listen: (m: ServerMessage) => void } {
  const messages: ServerMessage[] = [];
  return { messages, listen: (m) => messages.push(m) };
}

function lastView(messages: ServerMessage[]) {
  const last = messages.filter((m) => m.kind === 'view').at(-1);
  if (last === undefined || last.kind !== 'view') {
    throw new Error('expected a view message');
  }
  return last.view;
}

describe('Room with sources to find and open', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function moveTo(room: Room, player: Walker, x: number, y: number): void {
    walkTo(room, player, x + 0.5, y + 0.5);
  }

  function started(lab: Mission = mission) {
    const room = new Room('TEST', lab);
    const anna = { ...room.join('Anna'), ...collector() };
    const ben = { ...room.join('Ben'), ...collector() };
    room.attach(anna.playerId, anna.listen);
    room.attach(ben.playerId, ben.listen);
    room.setReady(ben.playerId, true);
    room.act(anna.playerId, { kind: 'start-mission' });
    return { room, anna, ben };
  }

  it('finds a source for the whole crew once somebody comes within three and a half tiles', () => {
    const { room, anna, ben } = started();
    const found = (): string[] => (lastView(ben.messages).map?.manuals ?? []).map((m) => m.id);
    expect(found()).toEqual([]);
    moveTo(room, anna, 10, 1); // four tiles short of the locker
    expect(found()).toEqual([]);
    moveTo(room, anna, 11, 1); // three and a half
    expect(found()).toEqual(['spind', 'schrank']);
    moveTo(room, anna, 1, 1);
    expect(found()).toEqual(['spind', 'schrank']);
    expect(lastView(anna.messages).map?.manuals[0]).toMatchObject({ x: 14, y: 1, opened: false });
    room.dispose();
  });

  it('finds nothing through a wall or a shut door, close as it is, and finds it through the open door', () => {
    const { room, anna, ben } = started(behindTheDoor({ x: 6, y: 2 }));
    const found = (): string[] => (lastView(ben.messages).map?.manuals ?? []).map((m) => m.id);
    moveTo(room, anna, 3, 1); // three tiles from the locker, the wall between
    expect(found()).toEqual([]);
    moveTo(room, anna, 3, 2); // three tiles from it, the shut door between
    expect(found()).toEqual([]);
    moveTo(room, ben, 1, 3); // onto the plate: the door opens before Anna's eyes
    expect(lastView(ben.messages).map?.doors[0]?.open).toBe(true);
    expect(found()).toEqual(['spind']);
    moveTo(room, ben, 1, 1); // off the plate again: found stays found
    expect(lastView(ben.messages).map?.doors[0]?.open).toBe(false);
    expect(found()).toEqual(['spind']);
    room.dispose();
  });

  it('finds a source round the corner of a door only for whoever walks in', () => {
    const { room, anna, ben } = started(behindTheDoor({ x: 5, y: 1 }));
    const found = (): string[] => (lastView(anna.messages).map?.manuals ?? []).map((m) => m.id);
    moveTo(room, ben, 1, 3); // the door opens
    moveTo(room, anna, 3, 2); // before the open door, two tiles off: the wall beside it hides it
    expect(found()).toEqual([]);
    moveTo(room, anna, 5, 2); // through the door, the locker a step ahead
    expect(found()).toEqual(['spind']);
    room.dispose();
  });

  it('searches a locker for a player standing at it, and nobody further away', () => {
    const { room, anna, ben } = started();
    moveTo(room, anna, 12, 1);
    expect(() => room.act(anna.playerId, { kind: 'open-source', manualId: 'spind' })).toThrow(
      'Nur direkt davor.',
    );
    moveTo(room, anna, 13, 1); // beside the locker, and diagonally by the cabinet
    expect(lastView(anna.messages).sourcesHere.map((s) => [s.id, s.opened])).toEqual([
      ['spind', false],
      ['schrank', false],
    ]);
    room.act(anna.playerId, { kind: 'open-source', manualId: 'spind' });
    const view = lastView(ben.messages);
    expect(view.map?.manuals.find((m) => m.id === 'spind')?.opened).toBe(true);
    expect(view.events.at(-1)).toMatchObject({ kind: 'find', label: 'Spind durchsucht: SPIND' });
    expect(view.credits[anna.playerId]?.found).toBe(1);
    room.dispose();
  });

  it('unlocks a cabinet with the key in hand, by the one key that does the obvious thing', () => {
    const { room, anna } = started();
    moveTo(room, anna, 8, 2);
    room.act(anna.playerId, { kind: 'interact' });
    expect(lastView(anna.messages).map?.items[0]?.carriedBy).toBe(anna.playerId);
    moveTo(room, anna, 11, 2);
    expect(() => room.act(anna.playerId, { kind: 'interact' })).toThrow(/markierten Platz/);
    moveTo(room, anna, 14, 2);
    room.act(anna.playerId, { kind: 'interact' });
    const view = lastView(anna.messages);
    expect(view.sourcesHere.find((s) => s.id === 'schrank')?.opened).toBe(true);
    expect(view.map?.items[0]).toMatchObject({ delivered: true, x: 14.5, y: 2.5 });
    expect(view.manualsHere.map((m) => m.id)).toEqual(['schrank']);
    expect(view.credits[anna.playerId]).toMatchObject({ found: 1, delivered: 1 });
    room.dispose();
  });

  it('starts with whoever is connected, and turns away a resume of whoever was left out', () => {
    const room = new Room('TEST', mission);
    const anna = { ...room.join('Anna'), ...collector() };
    const ben = { ...room.join('Ben'), ...collector() };
    const cleo = room.join('Cleo');
    room.attach(anna.playerId, anna.listen);
    room.attach(ben.playerId, ben.listen);
    room.attach(cleo.playerId, () => undefined);
    expect(room.summary()).toMatchObject({ capacity: 3, free: 0 });
    room.detach(cleo.playerId);
    room.setReady(ben.playerId, true);
    room.act(anna.playerId, { kind: 'start-mission' });
    const view = lastView(anna.messages);
    expect(view.phase).toBe('playing');
    expect(view.players.map((p) => p.name)).toEqual(['Anna', 'Ben']);
    expect(view.pausedFor).toBeNull();
    expect(() => room.resume(cleo.playerId, cleo.token)).toThrow(/ohne diese Verbindung begonnen/);
    expect(() => room.resume(cleo.playerId, cleo.token)).toThrow(/Wiederverbinden fehlgeschlagen/);
    room.dispose();
  });
});

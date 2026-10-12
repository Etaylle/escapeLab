import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMission, type Mission, type ServerMessage } from '@escapelab/core';
import { Room } from '../src/room.js';

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

  function moveTo(room: Room, playerId: string, x: number, y: number): void {
    room.updatePosition(playerId, { x: x + 0.5, y: y + 0.5, facing: 0, moving: false });
  }

  function started() {
    const room = new Room('TEST', mission);
    const anna = { ...room.join('Anna'), ...collector() };
    const ben = { ...room.join('Ben'), ...collector() };
    room.attach(anna.playerId, anna.listen);
    room.attach(ben.playerId, ben.listen);
    room.act(ben.playerId, { kind: 'set-ready', ready: true });
    room.act(anna.playerId, { kind: 'start-mission' });
    return { room, anna, ben };
  }

  it('finds a source for the whole crew once somebody comes within three and a half tiles', () => {
    const { room, anna, ben } = started();
    const found = (): string[] => (lastView(ben.messages).map?.manuals ?? []).map((m) => m.id);
    expect(found()).toEqual([]);
    moveTo(room, anna.playerId, 10, 1); // four tiles short of the locker
    expect(found()).toEqual([]);
    moveTo(room, anna.playerId, 11, 1); // three and a half
    expect(found()).toEqual(['spind', 'schrank']);
    moveTo(room, anna.playerId, 1, 1);
    expect(found()).toEqual(['spind', 'schrank']);
    expect(lastView(anna.messages).map?.manuals[0]).toMatchObject({ x: 14, y: 1, opened: false });
    room.dispose();
  });

  it('searches a locker for a player standing at it, and nobody further away', () => {
    const { room, anna, ben } = started();
    moveTo(room, anna.playerId, 12, 1);
    expect(() => room.act(anna.playerId, { kind: 'open-source', manualId: 'spind' })).toThrow(
      'Dafür musst du direkt davor stehen.',
    );
    moveTo(room, anna.playerId, 13, 1); // beside the locker, and diagonally by the cabinet
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
    moveTo(room, anna.playerId, 8, 2);
    room.act(anna.playerId, { kind: 'interact' });
    expect(lastView(anna.messages).map?.items[0]?.carriedBy).toBe(anna.playerId);
    moveTo(room, anna.playerId, 11, 2);
    expect(() => room.act(anna.playerId, { kind: 'interact' })).toThrow(/markierten Platz/);
    moveTo(room, anna.playerId, 14, 2);
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
    room.act(ben.playerId, { kind: 'set-ready', ready: true });
    room.act(anna.playerId, { kind: 'start-mission' });
    const view = lastView(anna.messages);
    expect(view.phase).toBe('playing');
    expect(view.players.map((p) => p.name)).toEqual(['Anna', 'Ben']);
    expect(view.pausedFor).toBeNull();
    expect(() => room.resume(cleo.playerId, cleo.token)).toThrow(/ohne dich gestartet/);
    expect(() => room.resume(cleo.playerId, cleo.token)).toThrow(/Wiederverbinden fehlgeschlagen/);
    room.dispose();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMission, type Mission, type ServerMessage } from '@escapelab/core';
import { Room } from '../src/room.js';

/**
 * A corridor for two or three with a station of two consoles: the
 * Signalkette's console a at the west end, console b at the east end, its
 * book in between, the spawns out of reach of all three.
 *
 *   0123456789012345
 * 0 ################
 * 1 #..............#   console a (5,1); console b (13,1)
 * 2 #..............#   spawns (1,1) (1,2) (2,2); book (9,2)
 * 3 ################
 */
const mission: Mission = parseMission({
  id: 'doppelpult',
  title: 'Doppelpult',
  players: { min: 2, max: 3 },
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  puzzles: [{ type: 'signal', id: 'kette', title: 'Signalkette' }],
  map: {
    tiles: ['################', '#..............#', '#..............#', '################'],
    spawns: [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ],
    stations: [
      { puzzleId: 'kette', x: 5, y: 1, console: 'a' },
      { puzzleId: 'kette', x: 13, y: 1, console: 'b' },
    ],
    manuals: [
      {
        id: 'buch',
        kind: 'book',
        label: 'HANDBUCH',
        puzzleIds: ['kette'],
        spots: [{ x: 9, y: 2 }],
      },
    ],
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

describe('Room with a station of two consoles', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function moveTo(room: Room, playerId: string, x: number, y: number): void {
    room.updatePosition(playerId, { x: x + 0.5, y: y + 0.5, facing: 0, moving: false });
  }

  /** A run for Anna, Ben and Cleo, everybody still on a spawn. */
  function started() {
    const room = new Room('TEST', mission);
    const [anna, ben, cleo] = ['Anna', 'Ben', 'Cleo'].map((name) => {
      const player = { ...room.join(name), ...collector() };
      room.attach(player.playerId, player.listen);
      return player;
    });
    if (anna === undefined || ben === undefined || cleo === undefined) {
      throw new Error('expected three players');
    }
    room.act(ben.playerId, { kind: 'set-ready', ready: true });
    room.act(cleo.playerId, { kind: 'set-ready', ready: true });
    room.act(anna.playerId, { kind: 'start-mission' });
    return { room, anna, ben, cleo };
  }

  /** Anna at console a, Ben at console b, Cleo at the book. */
  function inPlace() {
    const run = started();
    moveTo(run.room, run.anna.playerId, 5, 1);
    moveTo(run.room, run.ben.playerId, 13, 1);
    moveTo(run.room, run.cleo.playerId, 9, 2);
    return run;
  }

  it('tells who stands at which console, from positions', () => {
    const { room, anna, ben, cleo } = inPlace();
    expect(lastView(anna.messages).presence).toMatchObject({ stationId: 'kette', console: 'a' });
    expect(lastView(ben.messages).presence).toMatchObject({ stationId: 'kette', console: 'b' });
    expect(lastView(cleo.messages).presence).toMatchObject({
      stationId: null,
      console: null,
      manualId: 'buch',
    });
    moveTo(room, ben.playerId, 9, 1);
    expect(lastView(ben.messages).presence).toMatchObject({ stationId: null, console: null });
    room.dispose();
  });

  it('switches the station on from either console, and from nowhere else', () => {
    for (const at of ['a', 'b'] as const) {
      const { room, anna, ben, cleo } = inPlace();
      expect(() => room.act(cleo.playerId, { kind: 'interact' })).toThrow(/Zu weit weg/);
      room.act((at === 'a' ? anna : ben).playerId, { kind: 'interact' });
      expect(lastView(cleo.messages).puzzle?.kind, `from console ${at}`).toBe('signal');
      room.dispose();
    }
  });

  it('takes a press from the player at console b, none from a player at neither', () => {
    const { room, anna, ben, cleo } = inPlace();
    room.act(ben.playerId, { kind: 'interact' });
    const atA = lastView(anna.messages).puzzle;
    const first = atA?.kind === 'signal' ? atA.sequence?.[0] : undefined;
    if (first === undefined) {
      throw new Error('expected console a to show the sequence');
    }
    expect(() =>
      room.act(cleo.playerId, { kind: 'puzzle-input', input: { press: first } }),
    ).toThrow('Dafür musst du am Pult stehen.');
    expect(() =>
      room.act(anna.playerId, { kind: 'puzzle-input', input: { press: first } }),
    ).toThrow('Dieses Pult sendet — das andere gibt ein.');
    room.act(ben.playerId, { kind: 'puzzle-input', input: { press: first } });
    expect(lastView(ben.messages).puzzle).toMatchObject({ kind: 'signal', done: 1 });
    expect(lastView(ben.messages).penaltySeq).toBe(0);
    room.dispose();
  });
});

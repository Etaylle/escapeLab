import { describe, expect, it } from 'vitest';
import { parseMission, type ServerMessage } from '@escapelab/core';
import { Room } from '../src/room.js';
import { passFor } from './passes.js';

/** A corridor for two: enough of a room to watch. */
const lab = parseMission({
  id: 'gang',
  title: 'Gang',
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 300,
  players: { min: 2, max: 2 },
  puzzles: [{ type: 'button-sync', id: 'eins', title: 'Eins' }],
  map: {
    tiles: ['##########', '#........#', '#........#', '##########'],
    spawns: [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ],
    stations: [{ puzzleId: 'eins', x: 4, y: 1 }],
    exit: { x: 8, y: 2 },
  },
});

/** The audience's counts a connection was told, in order, each for room TEST. */
function countsIn(heard: readonly ServerMessage[]): number[] {
  return heard.flatMap((msg) => {
    if (msg.kind !== 'audience') {
      return [];
    }
    expect(msg.code).toBe('TEST');
    return [msg.count];
  });
}

/** `name` seated in `room` and on its line: what the seat hears. */
function seated(room: Room, name: string): ServerMessage[] {
  const heard: ServerMessage[] = [];
  const { playerId } = room.join(name, passFor(name));
  room.attach(playerId, (msg) => heard.push(msg));
  return heard;
}

describe('how many watch a room', () => {
  it('is told the crew and the audience as a watcher comes and goes', () => {
    const room = new Room('TEST', lab);
    const anna = seated(room, 'Anna');
    const first: ServerMessage[] = [];
    const one = room.attachSpectator((msg) => first.push(msg));
    const two = room.attachSpectator(() => undefined);
    expect(countsIn(anna)).toEqual([1, 2]);
    expect(countsIn(first)).toEqual([1, 2]);
    two.detach();
    // A connection that goes twice goes once.
    two.detach();
    one.detach();
    expect(countsIn(anna)).toEqual([1, 2, 1, 0]);
    // The first watcher hears the second go, and nothing once it is gone itself.
    expect(countsIn(first)).toEqual([1, 2, 1]);
    expect(room.watching).toBe(0);
  });

  it('is told a seat coming onto its line while any watch, and nothing while none do', () => {
    const room = new Room('TEST', lab);
    expect(countsIn(seated(room, 'Anna'))).toEqual([]);
    room.attachSpectator(() => undefined);
    expect(countsIn(seated(room, 'Ben'))).toEqual([1]);
  });
});

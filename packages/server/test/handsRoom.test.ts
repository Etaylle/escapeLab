import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@escapelab/core';
import { Room } from '../src/room.js';
import { BLACKOUT_SEED, blackoutMission, blackoutRun, lastView, type Member } from './blackout.js';
import { passFor } from './passes.js';
import { walkTo } from './walk.js';

/** `name` seated in `room` on a connection of their own, heard from now on. */
function seat(room: Room, name: string): Member {
  const { playerId } = room.join(name, passFor(name));
  const messages: ServerMessage[] = [];
  const detach = room.attach(playerId, (m) => messages.push(m));
  return { playerId, name, pass: passFor(name), messages, detach };
}

/** Anna, Ben and Cleo in Blackout on the harness's seed, the opening skipped: the lights out. */
function blackoutForThree(): { room: Room; anna: Member; ben: Member; cleo: Member } {
  const room = new Room('HAND', blackoutMission(), undefined, BLACKOUT_SEED);
  const anna = seat(room, 'Anna');
  const ben = seat(room, 'Ben');
  const cleo = seat(room, 'Cleo');
  room.setReady(ben.playerId, true);
  room.setReady(cleo.playerId, true);
  room.act(anna.playerId, { kind: 'start-mission' });
  for (const member of [anna, ben, cleo]) {
    room.act(member.playerId, { kind: 'intro-done' });
  }
  return { room, anna, ben, cleo };
}

/** The place `member` holds as `viewer`'s latest view names it; undefined where it names none. */
const placeOf = (viewer: Member, member: Member) =>
  lastView(viewer).hands?.held.find((hand) => hand.playerId === member.playerId)?.place;

describe('the hands in a room', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('leaves them out of a view of two', () => {
    const { room, anna } = blackoutRun();
    expect(lastView(anna).lights.out).toBe(true);
    expect(lastView(anna).hands).toBeUndefined();
    room.dispose();
  });

  it('tells every view of three who holds the plate, and that nobody does once they step off', () => {
    const { room, anna, ben, cleo } = blackoutForThree();
    const plate = blackoutMission().map.plates.find((p) => p.id === 'flurplatte');
    if (plate === undefined) {
      throw new Error('Blackout has no Flur plate');
    }
    expect(placeOf(ben, anna)).toBeNull();
    walkTo(room, anna, plate.x + 0.5, plate.y + 0.5);
    for (const viewer of [anna, ben, cleo]) {
      expect(placeOf(viewer, anna), viewer.name).toEqual({ kind: 'plate', id: 'flurplatte' });
    }
    walkTo(room, anna, plate.x + 1.7, plate.y + 0.5);
    for (const viewer of [anna, ben, cleo]) {
      expect(placeOf(viewer, anna), viewer.name).toBeNull();
    }
    room.dispose();
  });
});

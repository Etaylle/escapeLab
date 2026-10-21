import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMission, type Mission } from '@escapelab/core';
import { RoomManager } from '../src/roomManager.js';
import type { Room } from '../src/room.js';

/** The host's start now requires everyone else to have confirmed. */
function ready(room: Room, ...players: { playerId: string }[]): void {
  for (const player of players) {
    room.setReady(player.playerId, true);
  }
}


const tutorial: Mission = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/systemcheck.json', import.meta.url), 'utf8')),
);
const blackout: Mission = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8')),
);

/** Join a room and keep the connection open, like a real player would. */
function seat(room: Room, name: string): { playerId: string; token: string } {
  const creds = room.join(name);
  room.attach(creds.playerId, () => undefined);
  return creds;
}

describe('lobby browser', () => {
  it('lists only rooms somebody is actually sitting in', () => {
    const manager = new RoomManager();
    const open = manager.create(tutorial);
    manager.create(blackout); // created but never joined

    expect(manager.list()).toEqual([]);
    seat(open, 'Anna');
    const listed = manager.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      code: open.code,
      missionId: tutorial.id,
      missionTitle: tutorial.title,
      difficulty: 'normal',
      phase: 'lobby',
      capacity: 2,
      free: 1,
    });
    expect(listed[0]?.players).toEqual([
      { name: 'Anna', color: expect.any(String), connected: true },
    ]);
  });

  it('counts free seats down as people arrive', () => {
    const manager = new RoomManager();
    const room = manager.create(blackout);
    seat(room, 'Anna');
    expect(manager.list()[0]?.free).toBe(2);
    seat(room, 'Ben');
    expect(manager.list()[0]?.free).toBe(1);
    seat(room, 'Cleo');
    const full = manager.list()[0];
    expect(full?.free).toBe(0);
    expect(full?.players.map((p) => p.name)).toEqual(['Anna', 'Ben', 'Cleo']);
    room.dispose();
  });

  it('shows a running room as such, with no free seats', () => {
    const manager = new RoomManager();
    const room = manager.create(tutorial);
    const anna = seat(room, 'Anna');
    const ben = seat(room, 'Ben');
    ready(room, ben);
    room.act(anna.playerId, { kind: 'start-mission' });

    const listed = manager.list()[0];
    expect(listed?.phase).toBe('playing');
    expect(listed?.free).toBe(0);
    room.dispose();
  });

  it('sorts rooms you can still join above the ones you can only watch', () => {
    const manager = new RoomManager();
    const running = manager.create(tutorial);
    const anna = seat(running, 'Anna');
    const ben = seat(running, 'Ben');
    ready(running, ben);
    running.act(anna.playerId, { kind: 'start-mission' });

    const open = manager.create(blackout);
    seat(open, 'Cleo');

    expect(manager.list().map((r) => r.code)).toEqual([open.code, running.code]);
    running.dispose();
  });

  it('drops a room from the list once everyone has disconnected', () => {
    const manager = new RoomManager();
    const room = manager.create(tutorial);
    const anna = seat(room, 'Anna');
    expect(manager.list()).toHaveLength(1);
    room.detach(anna.playerId);
    expect(manager.list()).toEqual([]);
  });
});

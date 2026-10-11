import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMission, type ServerMessage } from '@escapelab/core';
import { Room } from '../src/room.js';
import { RoomManager } from '../src/roomManager.js';

const mission = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/systemcheck.json', import.meta.url), 'utf8')),
);

/** Collects every message pushed to one player. */
function collector(): { messages: ServerMessage[]; listen: (m: ServerMessage) => void } {
  const messages: ServerMessage[] = [];
  return { messages, listen: (m) => messages.push(m) };
}

function lastView(messages: ServerMessage[]) {
  const views = messages.filter((m) => m.kind === 'view');
  const last = views.at(-1);
  if (last === undefined || last.kind !== 'view') {
    throw new Error('expected at least one view message');
  }
  return last.view;
}

describe('Room', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function fullLobby(room: Room) {
    const anna = { ...room.join('Anna'), ...collector() };
    const ben = { ...room.join('Ben'), ...collector() };
    room.attach(anna.playerId, anna.listen);
    room.attach(ben.playerId, ben.listen);
    room.act(anna.playerId, { kind: 'select-role', roleId: 'anleitung' });
    room.act(ben.playerId, { kind: 'select-role', roleId: 'steuerpult' });
    return { anna, ben };
  }

  /** Teleport an avatar; the room derives plates and interact range from this. */
  function moveTo(room: Room, playerId: string, x: number, y: number): void {
    room.updatePosition(playerId, { x: x + 0.5, y: y + 0.5, facing: 0, moving: false });
  }

  it('runs a full mapped game: walk, activate, solve, hold a plate, escape', () => {
    const room = new Room('TEST', mission);
    const { anna, ben } = fullLobby(room);
    room.act(anna.playerId, { kind: 'start-mission' });

    // Station 1 sits in the Kontrolle room; only steuerpult has a button.
    moveTo(room, ben.playerId, 2, 1);
    room.act(ben.playerId, { kind: 'interact' });
    room.act(ben.playerId, { kind: 'press-button' });
    expect(lastView(ben.messages).currentPuzzleIndex).toBe(1);
    // Solving it opened the puzzle door for good.
    expect(lastView(ben.messages).map?.doors.find((d) => d.id === 'lehrtuer')?.open).toBe(true);

    moveTo(room, anna.playerId, 12, 1);
    room.act(anna.playerId, { kind: 'interact' });
    room.act(anna.playerId, { kind: 'press-button' });
    room.act(ben.playerId, { kind: 'press-button' });
    expect(lastView(anna.messages).currentPuzzleIndex).toBe(2);

    // Anna holds the plate so the gate to the last station stays open.
    moveTo(room, anna.playerId, 8, 5);
    expect(lastView(ben.messages).map?.doors.find((d) => d.id === 'halteschott')?.open).toBe(true);
    moveTo(room, ben.playerId, 16, 4);
    room.act(ben.playerId, { kind: 'interact' });
    room.act(anna.playerId, { kind: 'press-button' });
    room.act(ben.playerId, { kind: 'press-button' });

    // All puzzles done: still playing, but the hatch is open.
    const afterPuzzles = lastView(anna.messages);
    expect(afterPuzzles.phase).toBe('playing');
    expect(afterPuzzles.map?.exit?.open).toBe(true);

    // One player at the hatch is not enough.
    moveTo(room, ben.playerId, 10, 1);
    expect(lastView(ben.messages).phase).toBe('playing');
    moveTo(room, anna.playerId, 10, 1);
    expect(lastView(anna.messages).phase).toBe('won');
    expect(lastView(ben.messages).phase).toBe('won');
    room.dispose();
  });

  it('pauses the run while someone is disconnected and gives the time back', () => {
    const room = new Room('TEST', mission);
    const { anna, ben } = fullLobby(room);
    room.act(anna.playerId, { kind: 'start-mission' });
    const deadline = lastView(anna.messages).deadlineAt ?? 0;

    // Anna is standing right at the first station when Ben drops out.
    moveTo(room, anna.playerId, 2, 1);
    room.detach(ben.playerId);
    const paused = lastView(anna.messages);
    expect(paused.pausedFor).toEqual(['Ben']);
    // Nothing can be done while the crew is short-handed.
    expect(() => room.act(anna.playerId, { kind: 'interact' })).toThrow(/pausiert/);

    // The clock does not run during the pause …
    vi.advanceTimersByTime(30_000);
    expect(lastView(anna.messages).phase).toBe('playing');

    const benAgain = collector();
    room.resume(ben.playerId, ben.token);
    room.attach(ben.playerId, benAgain.listen);
    const resumed = lastView(anna.messages);
    expect(resumed.pausedFor).toBeNull();
    // … so the deadline moved out by exactly the frozen time.
    expect(resumed.deadlineAt).toBe(deadline + 30_000);
    room.dispose();
  });

  it('does not expire the mission timer while paused', () => {
    const room = new Room('TEST', mission);
    const { anna, ben } = fullLobby(room);
    room.act(anna.playerId, { kind: 'start-mission' });
    room.detach(ben.playerId);

    vi.advanceTimersByTime(mission.timeLimitSec * 1000 + 60_000);
    expect(lastView(anna.messages).phase).toBe('playing');
    room.dispose();
  });

  it('rejects an interact from too far away', () => {
    const room = new Room('TEST', mission);
    const { anna, ben } = fullLobby(room);
    room.act(anna.playerId, { kind: 'start-mission' });
    // Ben spawns three rooms away from the first station.
    expect(() => room.act(ben.playerId, { kind: 'interact' })).toThrow(/Zu weit weg/);
    room.dispose();
  });

  it('releases a plate when its holder disconnects', () => {
    const room = new Room('TEST', mission);
    const { anna, ben } = fullLobby(room);
    room.act(anna.playerId, { kind: 'start-mission' });
    moveTo(room, anna.playerId, 8, 5);
    expect(lastView(ben.messages).map?.plates[0]?.pressed).toBe(true);
    room.detach(anna.playerId);
    expect(lastView(ben.messages).map?.plates[0]?.pressed).toBe(false);
    room.dispose();
  });

  it('broadcasts a loss when the mission timer expires', () => {
    const room = new Room('TEST', mission);
    const { anna } = fullLobby(room);
    room.act(anna.playerId, { kind: 'start-mission' });

    vi.advanceTimersByTime(mission.timeLimitSec * 1000 + 1);

    expect(lastView(anna.messages).phase).toBe('lost');
    room.dispose();
  });

  it('marks a detached player and lets them resume with their token', () => {
    const room = new Room('TEST', mission);
    const { anna, ben } = fullLobby(room);

    room.detach(ben.playerId);
    expect(
      lastView(anna.messages).players.find((p) => p.id === ben.playerId)?.connected,
    ).toBe(false);

    const benAgain = collector();
    room.resume(ben.playerId, ben.token);
    room.attach(ben.playerId, benAgain.listen);
    expect(lastView(benAgain.messages).you.id).toBe(ben.playerId);
    expect(
      lastView(anna.messages).players.find((p) => p.id === ben.playerId)?.connected,
    ).toBe(true);
    room.dispose();
  });

  it('rejects resume with a wrong token', () => {
    const room = new Room('TEST', mission);
    const anna = room.join('Anna');
    expect(() => room.resume(anna.playerId, 'falsches-token')).toThrow(/Wiederverbinden/);
    room.dispose();
  });

  it('keeps private info out of the other player\'s serialized views', () => {
    const room = new Room('TEST', mission);
    const { anna, ben } = fullLobby(room);
    room.act(anna.playerId, { kind: 'start-mission' });
    room.updatePosition(ben.playerId, { x: 2.5, y: 1.5, facing: 0, moving: false });
    room.act(ben.playerId, { kind: 'interact' });
    expect(JSON.stringify(ben.messages)).not.toContain('Freigabe erteilt');
    expect(JSON.stringify(anna.messages)).toContain('Freigabe erteilt');
    room.dispose();
  });
});

describe('RoomManager', () => {
  it('creates rooms with unique codes and sweeps empty ones after the TTL', () => {
    const manager = new RoomManager();
    const room = manager.create(mission);
    expect(manager.get(room.code.toLowerCase())).toBe(room);

    const player = { ...room.join('Anna'), ...collector() };
    room.attach(player.playerId, player.listen);
    room.detach(player.playerId);

    manager.sweep(Date.now() + 11 * 60 * 1000);
    expect(() => manager.get(room.code)).toThrow(/existiert nicht/);
  });

  it('fails with a clear message for unknown room codes', () => {
    expect(() => new RoomManager().get('XXXX')).toThrow(/existiert nicht/);
  });
});

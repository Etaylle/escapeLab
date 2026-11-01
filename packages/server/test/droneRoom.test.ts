import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMission, type Mission, type ServerMessage } from '@escapelab/core';
import { Room } from '../src/room.js';
import { pressE, walkTo, type Walker } from './walk.js';

/**
 * Corridor with two stations and a patrol that sleeps until the first is done.
 *
 *   012345678
 * 0 #########
 * 1 #.......#   stations at (2,1) and (6,1)
 * 2 #.......#   drone patrols (1,2) <-> (7,2), facing right
 * 3 #########
 */
const mission: Mission = parseMission({
  id: 'droneroom',
  title: 'Drohnen-Raum',
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  players: { min: 2, max: 2 },
  puzzles: ['first', 'second'].map((id) => ({ type: 'button-sync', id, title: id })),
  map: {
    tiles: ['#########', '#.......#', '#.......#', '#########'],
    spawns: [
      { x: 1, y: 1 },
      { x: 7, y: 1 },
    ],
    stations: [
      { puzzleId: 'first', x: 2, y: 1 },
      { puzzleId: 'second', x: 6, y: 1 },
    ],
    drones: [
      {
        id: 'wache',
        waypoints: [
          { x: 1, y: 2 },
          { x: 7, y: 2 },
        ],
        speed: 1,
        range: 6,
        activeAfterSolved: 1,
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

function lastPositions(messages: ServerMessage[]) {
  const last = messages.filter((m) => m.kind === 'positions').at(-1);
  if (last === undefined || last.kind !== 'positions') {
    throw new Error('expected a positions message');
  }
  return last;
}

describe('Room with a sleeping drone', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function moveTo(room: Room, player: Walker, x: number, y: number): void {
    walkTo(room, player, x + 0.5, y + 0.5);
  }

  it('keeps it hidden and harmless until the first station is done', () => {
    const room = new Room('TEST', mission);
    const anna = { ...room.join('Anna'), ...collector() };
    const ben = { ...room.join('Ben'), ...collector() };
    room.attach(anna.playerId, anna.listen);
    room.attach(ben.playerId, ben.listen);
    room.setReady(ben.playerId, true);
    room.act(anna.playerId, { kind: 'start-mission' });

    // Anna loiters right in front of it while the patrol simulation keeps ticking: nothing
    // moves, so the positions go out once a second.
    moveTo(room, anna, 3, 2);
    const before = anna.messages.length;
    vi.advanceTimersByTime(5000);
    const streamed = anna.messages.slice(before).filter((m) => m.kind === 'positions');
    expect(streamed).toHaveLength(5);
    expect(streamed.some((m) => 'wache' in m.drones)).toBe(false);
    expect(lastView(anna.messages).penaltySeq).toBe(0);

    // The first solve wakes it up exactly where its patrol starts …
    moveTo(room, ben, 2, 1);
    moveTo(room, anna, 2, 2);
    pressE(room, ben);
    room.act(anna.playerId, { kind: 'puzzle-input', input: { press: true } });
    room.act(ben.playerId, { kind: 'puzzle-input', input: { press: true } });
    moveTo(room, anna, 3, 2);
    const audience = collector();
    room.attachSpectator(audience.listen);
    expect(lastPositions(audience.messages).drones['wache']).toMatchObject({ x: 1.5, y: 2.5 });

    // … and from then on it patrols, shows up for everyone and spots Anna.
    vi.advanceTimersByTime(1000);
    expect(lastPositions(anna.messages).drones['wache']).toBeDefined();
    expect(lastView(anna.messages).penaltySeq).toBe(1);
    expect(lastView(anna.messages).credits[anna.playerId]?.alarms).toBe(1);
    room.dispose();
  });
});

/** The same corridor, its patrol held still while someone stands on the plate at (3,1). */
const heldMission: Mission = parseMission({
  ...mission,
  map: {
    ...mission.map,
    plates: [{ id: 'halt', x: 3, y: 1 }],
    drones: mission.map.drones.map((drone) => ({ ...drone, frozenByPlate: 'halt' })),
  },
});

describe('Room with a drone that wakes held still', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows it to the crew on the next tick, though a newcomer heard of it first', () => {
    const room = new Room('TEST', heldMission);
    const anna = { ...room.join('Anna'), ...collector() };
    const ben = { ...room.join('Ben'), ...collector() };
    room.attach(anna.playerId, anna.listen);
    room.attach(ben.playerId, ben.listen);
    room.setReady(ben.playerId, true);
    room.act(anna.playerId, { kind: 'start-mission' });
    walkTo(room, ben, 2.5, 1.5);
    walkTo(room, anna, 3.5, 1.5);
    pressE(room, ben);
    // the walk's last positions out, and nothing moving since
    vi.advanceTimersByTime(300);
    room.act(anna.playerId, { kind: 'puzzle-input', input: { press: true } });
    room.act(ben.playerId, { kind: 'puzzle-input', input: { press: true } });
    // The solve woke it, held still by Anna on the plate; someone comes to watch at once.
    const audience = collector();
    room.attachSpectator(audience.listen);
    expect(lastPositions(audience.messages).drones['wache']).toMatchObject({ frozen: true });
    const before = anna.messages.length;
    vi.advanceTimersByTime(100);
    const heard = anna.messages.slice(before).filter((m) => m.kind === 'positions');
    expect(heard.some((m) => m.kind === 'positions' && 'wache' in m.drones)).toBe(true);
    room.dispose();
  });
});

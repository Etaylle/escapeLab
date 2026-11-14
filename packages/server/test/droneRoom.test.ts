import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMission, type Mission, type ServerMessage } from '@escapelab/core';
import { Room } from '../src/room.js';
import { pressE, walkTo, type Walker } from './walk.js';
import { passFor } from './passes.js';

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
    const anna = { ...room.join('Anna', passFor('Anna')), ...collector() };
    const ben = { ...room.join('Ben', passFor('Ben')), ...collector() };
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
    const anna = { ...room.join('Anna', passFor('Anna')), ...collector() };
    const ben = { ...room.join('Ben', passFor('Ben')), ...collector() };
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

describe('Room with a drone and a crew member away', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /**
   * Anna and Ben in `run`, the first station solved — the patrol awake, from (1,2) towards
   * (7,2) — Anna at (3,2) in its way and Ben by the station; each with a hand to drop their line.
   */
  function awake(run: Mission) {
    const room = new Room('TEST', run);
    const anna = { ...room.join('Anna', passFor('Anna')), ...collector() };
    const ben = { ...room.join('Ben', passFor('Ben')), ...collector() };
    const drop = {
      anna: room.attach(anna.playerId, anna.listen),
      ben: room.attach(ben.playerId, ben.listen),
    };
    room.setReady(ben.playerId, true);
    room.act(anna.playerId, { kind: 'start-mission' });
    walkTo(room, ben, 2.5, 1.5);
    walkTo(room, anna, 2.5, 2.5);
    pressE(room, ben);
    room.act(anna.playerId, { kind: 'puzzle-input', input: { press: true } });
    room.act(ben.playerId, { kind: 'puzzle-input', input: { press: true } });
    return { room, anna, ben, drop };
  }

  it('flies on, and sees nobody whose line is down: a body that cannot move costs nothing', () => {
    const { room, anna, ben, drop } = awake(mission);
    walkTo(room, anna, 3.5, 2.5);
    drop.anna();
    const from = lastPositions(ben.messages).drones['wache'];
    vi.advanceTimersByTime(3000);
    expect(lastPositions(ben.messages).drones['wache']?.x).not.toBe(from?.x);
    expect(lastView(ben.messages).penaltySeq).toBe(0);
    expect(lastView(ben.messages).away.map((away) => away.name)).toEqual(['Anna']);
    room.dispose();
  });

  it('stays held while an avatar whose line is down stands on its plate', () => {
    const { room, anna, ben, drop } = awake(heldMission);
    walkTo(room, ben, 3.5, 1.5);
    expect(lastView(ben.messages).map?.plates[0]?.pressed).toBe(true);
    drop.ben();
    const audience = collector();
    room.attachSpectator(audience.listen);
    vi.advanceTimersByTime(3000);
    expect(lastView(anna.messages).map?.plates[0]?.pressed).toBe(true);
    expect(lastPositions(audience.messages).drones['wache']).toMatchObject({
      x: 1.5,
      y: 2.5,
      frozen: true,
    });
    // Back on the line and off the plate, Ben lets it go, and the patrol flies.
    room.resume(passFor('Ben'));
    room.attach(ben.playerId, ben.listen);
    walkTo(room, ben, 5.5, 1.5);
    expect(lastView(anna.messages).map?.plates[0]?.pressed).toBe(false);
    vi.advanceTimersByTime(500);
    expect(lastPositions(audience.messages).drones['wache']).toMatchObject({ frozen: false });
    room.dispose();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMission, type Mission, type ServerMessage } from '@escapelab/core';
import { Room } from '../src/room.js';

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
  roles: [
    { id: 'anleitung', name: 'Anleitung', description: '' },
    { id: 'steuerpult', name: 'Steuerpult', description: '' },
  ],
  puzzles: ['first', 'second'].map((id, i) => ({
    type: 'button-sync',
    id,
    title: id,
    prompt: '',
    buttons: [{ roleId: 'steuerpult', label: `B${i}` }],
  })),
  map: {
    tiles: ['#########', '#.......#', '#.......#', '#########'],
    spawns: { anleitung: { x: 1, y: 1 }, steuerpult: { x: 7, y: 1 } },
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

  function moveTo(room: Room, playerId: string, x: number, y: number): void {
    room.updatePosition(playerId, { x: x + 0.5, y: y + 0.5, facing: 0, moving: false });
  }

  it('keeps it hidden and harmless until the first station is done', () => {
    const room = new Room('TEST', mission);
    const anna = { ...room.join('Anna'), ...collector() };
    const ben = { ...room.join('Ben'), ...collector() };
    room.attach(anna.playerId, anna.listen);
    room.attach(ben.playerId, ben.listen);
    room.act(anna.playerId, { kind: 'select-role', roleId: 'anleitung' });
    room.act(ben.playerId, { kind: 'select-role', roleId: 'steuerpult' });
    room.act(ben.playerId, { kind: 'set-ready', ready: true });
    room.act(anna.playerId, { kind: 'start-mission' });

    // Anna loiters right in front of it while the patrol simulation keeps ticking.
    moveTo(room, anna.playerId, 3, 2);
    vi.advanceTimersByTime(5000);
    const streamed = anna.messages.filter((m) => m.kind === 'positions');
    expect(streamed.length).toBeGreaterThan(10);
    expect(streamed.some((m) => 'wache' in m.drones)).toBe(false);
    expect(lastView(anna.messages).penaltySeq).toBe(0);

    // The first solve wakes it up exactly where its patrol starts …
    moveTo(room, ben.playerId, 2, 1);
    room.act(ben.playerId, { kind: 'interact' });
    room.act(ben.playerId, { kind: 'puzzle-input', input: { press: true } });
    const audience = collector();
    room.attachSpectator(audience.listen);
    expect(lastPositions(audience.messages).drones['wache']).toMatchObject({ x: 1.5, y: 2.5 });

    // … and from then on it patrols, shows up for everyone and spots Anna.
    vi.advanceTimersByTime(1000);
    expect(lastPositions(anna.messages).drones['wache']).toBeDefined();
    expect(lastView(anna.messages).penaltySeq).toBe(1);
    room.dispose();
  });
});

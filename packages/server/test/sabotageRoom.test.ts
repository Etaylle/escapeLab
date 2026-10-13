import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMission, type Mission, type ServerMessage } from '@escapelab/core';
import { Room } from '../src/room.js';
import { walkTo, type Walker } from './walk.js';

/** The host's start now requires everyone else to have confirmed. */
function ready(room: Room, ...players: { playerId: string }[]): void {
  for (const player of players) {
    room.act(player.playerId, { kind: 'set-ready', ready: true });
  }
}


/** Corridor with three stations and an emergency valve at each end. */
const mission: Mission = parseMission({
  id: 'sabotageroom',
  title: 'Sabotage-Raum',
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 900,
  players: { min: 2, max: 2 },
  puzzles: ['first', 'second', 'third'].map((id) => ({ type: 'button-sync', id, title: id })),
  map: {
    tiles: ['#########', '#.......#', '#.......#', '#########'],
    spawns: [
      { x: 3, y: 1 },
      { x: 5, y: 1 },
    ],
    stations: [
      { puzzleId: 'first', x: 2, y: 1 },
      { puzzleId: 'second', x: 4, y: 1 },
      { puzzleId: 'third', x: 6, y: 1 },
    ],
    exit: { x: 4, y: 2 },
    sabotage: {
      label: 'KÜHLUNG AUSGEFALLEN',
      hint: 'Beide Ventile!',
      firstAfterSec: 60,
      everySec: 120,
      durationSec: 40,
      penaltySec: 60,
      panels: [
        { id: 'links', x: 1, y: 2 },
        { id: 'rechts', x: 7, y: 2 },
      ],
    },
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

describe('Room emergencies', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function moveTo(room: Room, player: Walker, x: number, y: number): void {
    walkTo(room, player, x + 0.5, y + 0.5);
  }

  /** Both at the station, switched on, both press. */
  function solveAt(room: Room, x: number, anna: Walker, ben: Walker) {
    moveTo(room, ben, x, 1);
    moveTo(room, anna, x, 2);
    room.act(ben.playerId, { kind: 'interact' });
    room.act(anna.playerId, { kind: 'puzzle-input', input: { press: true } });
    room.act(ben.playerId, { kind: 'puzzle-input', input: { press: true } });
  }

  /** Lobby, mission start, and the two station solves that arm emergencies. */
  function midMission() {
    const room = new Room('TEST', mission);
    const anna = { ...room.join('Anna'), ...collector() };
    const ben = { ...room.join('Ben'), ...collector() };
    room.attach(anna.playerId, anna.listen);
    room.attach(ben.playerId, ben.listen);
    ready(room, ben);
    room.act(anna.playerId, { kind: 'start-mission' });
    for (const x of [2, 4]) {
      solveAt(room, x, anna, ben);
    }
    return { room, anna, ben };
  }

  it('fires an emergency once enough stations are done', () => {
    const { room, anna } = midMission();
    expect(lastView(anna.messages).map?.sabotage).toBeNull();
    vi.advanceTimersByTime(61_000);
    expect(lastView(anna.messages).map?.sabotage?.label).toBe('KÜHLUNG AUSGEFALLEN');
    room.dispose();
  });

  it('is cleared when both valves are manned by different players', () => {
    const { room, anna, ben } = midMission();
    vi.advanceTimersByTime(61_000);
    moveTo(room, anna, 1, 2);
    expect(lastView(anna.messages).map?.sabotage).not.toBeNull();
    moveTo(room, ben, 7, 2);
    expect(lastView(anna.messages).map?.sabotage).toBeNull();
    room.dispose();
  });

  it('cannot be cleared by one player covering both valves', () => {
    const { room, anna } = midMission();
    vi.advanceTimersByTime(61_000);
    // Anna alone cannot be at both ends; standing on one is not enough.
    moveTo(room, anna, 1, 2);
    expect(lastView(anna.messages).map?.sabotage?.panels.filter((p) => p.occupied)).toHaveLength(
      1,
    );
    expect(lastView(anna.messages).map?.sabotage).not.toBeNull();
    room.dispose();
  });

  it('costs time when it expires and comes back later', () => {
    const { room, anna } = midMission();
    vi.advanceTimersByTime(61_000);
    const before = lastView(anna.messages).deadlineAt ?? 0;
    vi.advanceTimersByTime(41_000);
    const after = lastView(anna.messages);
    expect(after.map?.sabotage).toBeNull();
    expect(after.deadlineAt).toBe(before - 60_000);

    // The next one is due 120 s after the first, i.e. at t=180 s.
    vi.advanceTimersByTime(80_000);
    expect(lastView(anna.messages).map?.sabotage).not.toBeNull();
    room.dispose();
  });

  it('stops scheduling emergencies once the crew runs for the hatch', () => {
    const { room, anna, ben } = midMission();
    solveAt(room, 6, anna, ben);
    expect(lastView(anna.messages).map?.exit?.open).toBe(true);
    vi.advanceTimersByTime(300_000);
    expect(lastView(anna.messages).map?.sabotage).toBeNull();
    room.dispose();
  });
});

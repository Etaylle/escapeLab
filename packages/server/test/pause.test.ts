import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FIRST_WAIT_MS,
  LATER_WAIT_MS,
  parseMission,
  type PlayerView,
  type RunReport,
  type ServerMessage,
} from '@escapelab/core';
import { Room } from '../src/room.js';
import { passFor } from './passes.js';
import { pressE, walkTo, type Walker } from './walk.js';

/**
 * A corridor lab for two or three: one station the whole crew presses at (3,1), the hatch at
 * its east end, no intro — the clock runs from the start.
 *
 *   0123456789
 * 0 ##########
 * 1 #..1.....#   spawns (1,1), (1,2), (2,2)
 * 2 #.......E#   the hatch (8,2)
 * 3 ##########
 */
const lab = parseMission({
  id: 'flur',
  title: 'Flur',
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  players: { min: 2, max: 3 },
  puzzles: [{ type: 'button-sync', id: 'eins', title: 'Eins' }],
  map: {
    tiles: ['##########', '#........#', '#........#', '##########'],
    spawns: [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ],
    stations: [{ puzzleId: 'eins', x: 3, y: 1 }],
    exit: { x: 8, y: 2 },
  },
});

type Player = Walker & { name: string; detach: () => void };

function lastView(player: Walker): PlayerView {
  const last = player.messages.filter((m) => m.kind === 'view').at(-1);
  if (last?.kind !== 'view') {
    throw new Error('expected a view');
  }
  return last.view;
}

/** A player's connection on its own collector: what it hears, how it lets go. */
function connect(room: Room, playerId: string, name: string): Player {
  const messages: ServerMessage[] = [];
  return { playerId, name, messages, detach: room.attach(playerId, (m) => messages.push(m)) };
}

/** A run in the corridor for `names`, the first of them its host; the room's reports kept. */
function crew(names: string[]) {
  const reports: RunReport[] = [];
  const room = new Room('TEST', lab, ({ report }) => reports.push(report));
  const players = names.map((name) => connect(room, room.join(name, passFor(name)).playerId, name));
  for (const player of players.slice(1)) {
    room.setReady(player.playerId, true);
  }
  room.act(players[0]?.playerId ?? '', { kind: 'start-mission' });
  return { room, players, reports };
}

/** `player` back on a new connection, as their page resumes on their pass. */
function resume(room: Room, player: Player): Player {
  return connect(room, room.resume(passFor(player.name)), player.name);
}

const goOn = (room: Room, by: Player, absent: Player): void =>
  room.act(by.playerId, { kind: 'continue-without', absentId: absent.playerId });

/** The crew at the station, switched on and pressed by every one of `pressing`: the hatch opens. */
function solve(room: Room, pressing: Player[]): void {
  const [first, second] = pressing as [Player, Player];
  walkTo(room, first, 3.5, 2.5);
  walkTo(room, second, 4.5, 1.5);
  pressE(room, first);
  for (const player of pressing) {
    room.act(player.playerId, { kind: 'puzzle-input', input: { press: true } });
  }
  expect(lastView(first).map?.exit?.open).toBe(true);
}

describe('a crew member away from a run', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stands nothing still: the air says so once, and the clock runs on to its end', () => {
    const { room, players, reports } = crew(['Anna', 'Ben', 'Cem']);
    const [anna, , cem] = players as [Player, Player, Player];
    const deadline = lastView(anna).deadlineAt ?? 0;
    vi.advanceTimersByTime(5000);
    cem.detach();
    const dropAt = Date.now();
    const view = lastView(anna);
    expect(view.away).toEqual([
      { id: cem.playerId, name: 'Cem', since: dropAt, waivableAt: dropAt + FIRST_WAIT_MS },
    ]);
    expect(view.pausedAt).toBeNull();
    const said = view.events.filter((event) => event.kind === 'away');
    expect(said).toEqual([
      { at: dropAt, kind: 'away', label: 'Cems Leitung ist weg.', seconds: null },
    ]);
    vi.advanceTimersByTime(30_000);
    expect(lastView(anna).deadlineAt).toBe(deadline);
    vi.advanceTimersByTime(deadline - Date.now());
    expect(lastView(anna).phase).toBe('lost');
    expect(reports.map((report) => report.outcome)).toEqual(['lost:time']);
    room.dispose();
  });

  it('offers the way on without them 60 s after the run’s first drop, 20 s after a later', () => {
    const { room, players } = crew(['Anna', 'Ben', 'Cem']);
    const [anna, ben, cem] = players as [Player, Player, Player];
    const deadline = lastView(anna).deadlineAt ?? 0;
    vi.advanceTimersByTime(5000);
    cem.detach();
    vi.advanceTimersByTime(FIRST_WAIT_MS - 1);
    expect(() => goOn(room, anna, cem)).toThrow('Die Wartezeit läuft noch.');
    vi.advanceTimersByTime(1);
    goOn(room, ben, cem);
    // The clock went on all along: nothing added to the deadline.
    expect(lastView(anna).deadlineAt).toBe(deadline);
    expect(lastView(anna).away.map((away) => [away.name, away.waived])).toEqual([['Cem', true]]);
    expect(lastView(ben).players.find((p) => p.name === 'Cem')?.waived).toBe(true);
    // Cem is back: counted in at once, playing on.
    vi.advanceTimersByTime(10_000);
    const cemAgain = resume(room, cem);
    for (const view of [lastView(anna), lastView(cemAgain)]) {
      expect(view.away).toEqual([]);
      expect(view.players.find((p) => p.name === 'Cem')).not.toHaveProperty('waived');
    }
    // Every later drop of the run waits 20 s.
    ben.detach();
    expect(lastView(anna).away[0]?.waivableAt).toBe(Date.now() + LATER_WAIT_MS);
    room.dispose();
  });

  it('offers one alone on the line no way on, only the run called off: lost, abandoned', () => {
    const { room, players, reports } = crew(['Anna', 'Ben']);
    const [anna, ben] = players as [Player, Player];
    ben.detach();
    vi.advanceTimersByTime(FIRST_WAIT_MS);
    expect(() => goOn(room, anna, ben)).toThrow('Allein läuft kein Einsatz weiter.');
    room.act(anna.playerId, { kind: 'call-off' });
    expect(lastView(anna)).toMatchObject({ phase: 'lost', calledOff: 'Abgebrochen ohne Ben.' });
    expect(reports.map((report) => report.outcome)).toEqual(['lost:abandoned']);
    room.dispose();
  });

});

describe('a crew member away at the hatch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits at the hatch for whoever is away and not on it, as for somebody slow', () => {
    const { room, players } = crew(['Anna', 'Ben']);
    const [anna, ben] = players as [Player, Player];
    solve(room, [anna, ben]);
    walkTo(room, anna, 8.5, 2.5);
    expect(lastView(anna).map?.exit?.atExit).toEqual([anna.playerId]);
    ben.detach();
    vi.advanceTimersByTime(5000);
    expect(lastView(anna).phase).toBe('playing');
    expect(lastView(anna).away.map((away) => away.name)).toEqual(['Ben']);
    const benAgain = resume(room, ben);
    expect(lastView(benAgain).phase).toBe('playing');
    walkTo(room, benAgain, 8.5, 2.5);
    expect(lastView(anna).phase).toBe('won');
    room.dispose();
  });

  it('counts an avatar whose line is down where it stands: on the hatch, it is out', () => {
    const { room, players } = crew(['Anna', 'Ben']);
    const [anna, ben] = players as [Player, Player];
    solve(room, [anna, ben]);
    walkTo(room, ben, 8.5, 2.5);
    ben.detach();
    expect(lastView(anna).map?.exit?.atExit).toEqual([ben.playerId]);
    expect(lastView(anna).phase).toBe('playing');
    walkTo(room, anna, 8.5, 2.5);
    expect(lastView(anna).phase).toBe('won');
    room.dispose();
  });

  it('lets the crew it counts out escape without the one it went on without', () => {
    const { room, players } = crew(['Anna', 'Ben', 'Cem']);
    const [anna, ben, cem] = players as [Player, Player, Player];
    cem.detach();
    vi.advanceTimersByTime(FIRST_WAIT_MS);
    goOn(room, anna, cem);
    solve(room, [anna, ben]);
    walkTo(room, anna, 8.5, 2.5);
    expect(lastView(anna).phase).toBe('playing');
    walkTo(room, ben, 8.5, 2.5);
    expect(lastView(anna).phase).toBe('won');
    room.dispose();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseMission,
  type PlayerView,
  type RunReport,
  type ServerMessage,
} from '@escapelab/core';
import { Room } from '../src/room.js';
import { passFor } from './passes.js';
import { pressE, walkTo, type Walker } from './walk.js';

/**
 * A corridor lab for two or three: one station the whole crew presses at (4,1), a fuse lying at
 * (1,2), a door at (7,1) that stands open while somebody holds the plate at (5,2), and the hatch
 * at the east end; no intro.
 *
 *   0123456789
 * 0 ##########
 * 1 #...1..D.#   spawns (1,1), (2,1), (3,1); the station (4,1); the door (7,1)
 * 2 #F...P..E#   the fuse (1,2); the plate (5,2); the hatch (8,2)
 * 3 ##########
 */
const lab = parseMission({
  id: 'gang',
  title: 'Gang',
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  players: { min: 2, max: 3 },
  puzzles: [{ type: 'button-sync', id: 'eins', title: 'Eins' }],
  map: {
    tiles: ['##########', '#........#', '#........#', '##########'],
    spawns: [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ],
    stations: [{ puzzleId: 'eins', x: 4, y: 1 }],
    doors: [{ id: 'tuer', x: 7, y: 1, opensBy: { kind: 'plate', plateId: 'platte' } }],
    plates: [{ id: 'platte', x: 5, y: 2, label: 'HALTEN' }],
    items: [{ id: 'sicherung', label: 'SICHERUNG', x: 1, y: 2, deliverTo: { x: 8, y: 1 } }],
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

/** A run in the corridor for `names`, the first its host, every player on a connection. */
function crew(names: string[]) {
  const reports: RunReport[] = [];
  const room = new Room('TEST', lab, ({ report }) => reports.push(report));
  const players = names.map((name): Player => {
    const { playerId } = room.join(name, passFor(name));
    const messages: ServerMessage[] = [];
    return { playerId, name, messages, detach: room.attach(playerId, (m) => messages.push(m)) };
  });
  for (const player of players.slice(1)) {
    room.setReady(player.playerId, true);
  }
  room.act(players[0]?.playerId ?? '', { kind: 'start-mission' });
  return { room, players, reports };
}

const doorOpen = (view: PlayerView): boolean | undefined =>
  view.map?.doors.find((door) => door.id === 'tuer')?.open;

describe('a seat given up in a run', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('puts down what they carried where they stood, lets their plate go; the run goes on', () => {
    const { room, players } = crew(['Anna', 'Ben', 'Cem']);
    const [anna, , cem] = players as [Player, Player, Player];
    walkTo(room, cem, 1.5, 2.5);
    pressE(room, cem);
    expect(lastView(anna).map?.items[0]).toMatchObject({ carriedBy: cem.playerId });
    walkTo(room, cem, 5.5, 2.5);
    expect(doorOpen(lastView(anna))).toBe(true);
    room.abandon(passFor('Cem'));
    const view = lastView(anna);
    expect(view.phase).toBe('playing');
    expect(view.players.map((p) => p.name)).toEqual(['Anna', 'Ben']);
    expect(view.map?.items[0]).toMatchObject({ carriedBy: null, x: 5.5, y: 2.5 });
    expect(doorOpen(view)).toBe(false);
    // The positions go out at most every 66 ms: the next of them has no Cem any more.
    vi.advanceTimersByTime(100);
    const positions = anna.messages.filter((m) => m.kind === 'positions').at(-1);
    expect(positions?.kind === 'positions' && cem.playerId in positions.players).toBe(false);
    expect(cem.messages.at(-1)).toEqual({ kind: 'left', code: 'TEST', message: null });
    expect(() => room.resume(passFor('Cem'))).toThrow(/Wiederverbinden/);
    expect(room.seatSummary(passFor('Cem'))).toBeNull();
    room.dispose();
  });

  it('ends the run for everyone below the mission’s smallest crew, naming who left', () => {
    const { room, players, reports } = crew(['Anna', 'Ben']);
    const [anna] = players as [Player, Player];
    room.abandon(passFor('Ben'));
    expect(lastView(anna)).toMatchObject({
      phase: 'lost',
      calledOff: 'Ben hat den Einsatz verlassen.',
    });
    expect(reports.map((report) => [report.outcome, report.crew])).toEqual([
      ['lost:abandoned', ['Anna']],
    ]);
    room.dispose();
  });

  it('lets a seat away go, given up from another device, the run going on', () => {
    const { room, players } = crew(['Anna', 'Ben', 'Cem']);
    const [anna, , cem] = players as [Player, Player, Player];
    cem.detach();
    expect(lastView(anna).away.map((away) => away.name)).toEqual(['Cem']);
    vi.advanceTimersByTime(10_000);
    room.abandon(passFor('Cem'));
    expect(lastView(anna).away).toEqual([]);
    expect(lastView(anna).phase).toBe('playing');
    room.dispose();
  });

  it('lets the crew that is left out by the hatch', () => {
    const { room, players } = crew(['Anna', 'Ben', 'Cem']);
    const [anna, ben, cem] = players as [Player, Player, Player];
    walkTo(room, anna, 4.5, 2.5);
    walkTo(room, ben, 3.5, 2.5);
    walkTo(room, cem, 3.5, 1.5);
    pressE(room, anna);
    for (const player of [anna, ben, cem]) {
      room.act(player.playerId, { kind: 'puzzle-input', input: { press: true } });
    }
    expect(lastView(anna).map?.exit?.open).toBe(true);
    walkTo(room, anna, 8.5, 2.5);
    walkTo(room, ben, 8.5, 2.5);
    expect(lastView(anna).phase).toBe('playing');
    room.abandon(passFor('Cem'));
    expect(lastView(anna).phase).toBe('won');
    room.dispose();
  });
});

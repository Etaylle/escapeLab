import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMission, scaleMission, type Difficulty, type Mission } from '@escapelab/core';
import { Room } from '../src/room.js';
import { RoomManager } from '../src/roomManager.js';
import { walkTo, type Walker } from './walk.js';

/**
 * A corridor of two stations where the whole crew presses; mission control has two lines for
 * the first and one for the second, sent while a station stays quiet.
 *
 *   0123456789
 * 0 ##########
 * 1 #..1..2..#   stations at (3,1) and (6,1); spawns (1,1) and (8,1)
 * 2 ##########
 */
const FIRST = ['Die erste Station steht an der Nordwand.', 'Sie steht links im Flur.'];
const SECOND = ['Die zweite Station steht weiter östlich.'];

const mission: Mission = parseMission({
  id: 'leitstelle',
  title: 'Leitstelle',
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 900,
  players: { min: 2, max: 2 },
  puzzles: [
    { type: 'button-sync', id: 'eins', title: 'Eins', nudges: FIRST },
    { type: 'button-sync', id: 'zwei', title: 'Zwei', nudges: SECOND },
  ],
  map: {
    tiles: ['##########', '#........#', '##########'],
    spawns: [
      { x: 1, y: 1 },
      { x: 8, y: 1 },
    ],
    stations: [
      { puzzleId: 'eins', x: 3, y: 1 },
      { puzzleId: 'zwei', x: 6, y: 1 },
    ],
  },
});

const QUIET_MS = 90_000;

type Player = Walker & { token: string };

function join(room: Room, name: string): Player {
  const messages: Player['messages'] = [];
  const player = { ...room.join(name), messages };
  room.attach(player.playerId, (m) => messages.push(m));
  return player;
}

function lastView(walker: Walker) {
  const last = walker.messages.filter((m) => m.kind === 'view').at(-1);
  if (last?.kind !== 'view') {
    throw new Error('expected a view message');
  }
  return last.view;
}

/** What mission control has said unasked so far, as Anna's latest view carries it. */
const nudges = (walker: Walker): string[] =>
  lastView(walker)
    .events.filter((e) => e.kind === 'nudge')
    .map((e) => e.label);

describe('mission control watching from the room', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Anna and Ben in a run of the corridor, at `difficulty`; the clock runs from the start. */
  function started(difficulty: Difficulty = 'normal') {
    const room = new Room('TEST', scaleMission(mission, difficulty), undefined, null, difficulty);
    const anna = join(room, 'Anna');
    const ben = join(room, 'Ben');
    room.setReady(ben.playerId, true);
    room.act(anna.playerId, { kind: 'start-mission' });
    return { room, anna, ben };
  }

  it('speaks up once nothing has happened at the station for 90 s', () => {
    const { room, anna } = started();
    vi.advanceTimersByTime(QUIET_MS - 1);
    expect(nudges(anna)).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(nudges(anna)).toEqual([FIRST[0]]);
    room.dispose();
  });

  it('starts the quiet over with any input at the station', () => {
    const { room, anna, ben } = started();
    vi.advanceTimersByTime(60_000);
    walkTo(room, anna, 3.5, 1.5);
    walkTo(room, ben, 4.5, 1.5);
    room.act(anna.playerId, { kind: 'interact' });
    vi.advanceTimersByTime(QUIET_MS - 1);
    expect(nudges(anna)).toEqual([]);
    room.act(ben.playerId, { kind: 'puzzle-input', input: { press: true } });
    vi.advanceTimersByTime(QUIET_MS - 1);
    expect(nudges(anna)).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(nudges(anna)).toEqual([FIRST[0]]);
    room.dispose();
  });

  it('stands still while the run is paused', () => {
    const { room, anna, ben } = started();
    vi.advanceTimersByTime(30_000);
    room.detach(ben.playerId);
    vi.advanceTimersByTime(120_000);
    expect(nudges(anna)).toEqual([]);
    room.resume(ben.playerId, ben.token);
    room.attach(ben.playerId, (m) => ben.messages.push(m));
    vi.advanceTimersByTime(QUIET_MS - 30_000 - 1);
    expect(nudges(anna)).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(nudges(anna)).toEqual([FIRST[0]]);
    room.dispose();
  });

  it('sends the second line after another quiet spell, and no third', () => {
    const { room, anna } = started();
    vi.advanceTimersByTime(QUIET_MS);
    vi.advanceTimersByTime(QUIET_MS - 1);
    expect(nudges(anna)).toEqual([FIRST[0]]);
    vi.advanceTimersByTime(1);
    expect(nudges(anna)).toEqual(FIRST);
    vi.advanceTimersByTime(5 * QUIET_MS);
    expect(nudges(anna)).toEqual(FIRST);
    room.dispose();
  });

  it('keeps quiet on „hart", for as long as the station stays untouched', () => {
    const { room, anna } = started('hart');
    vi.advanceTimersByTime(5 * QUIET_MS);
    expect(nudges(anna)).toEqual([]);
    expect(lastView(anna).phase).toBe('playing');
    room.dispose();
  });

  it('opens a room on the difficulty asked for, normal where none is', () => {
    const manager = new RoomManager();
    const relaxed = manager.create(scaleMission(mission, 'entspannt'), null, 'entspannt');
    expect(relaxed.summary().difficulty).toBe('entspannt');
    expect(relaxed.difficulty).toBe('entspannt');
    expect(manager.create(scaleMission(mission, 'normal')).summary().difficulty).toBe('normal');
    const anna = join(relaxed, 'Anna');
    expect(lastView(anna).difficulty).toBe('entspannt');
    expect(lastView(anna).timeLimitSec).toBe(scaleMission(mission, 'entspannt').timeLimitSec);
    relaxed.dispose();
  });
});

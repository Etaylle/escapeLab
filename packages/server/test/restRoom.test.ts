import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EMERGENCY_MISSED,
  moduleFor,
  parseMission,
  sealedSnapshotSchema,
  type GameState,
  type Mission,
  type PuzzleState,
  type PuzzleView,
  type ServerMessage,
} from '@escapelab/core';
import { Room } from '../src/room.js';
import { rejoin } from './blackout.js';
import { passFor } from './passes.js';
import { pressE, standAt, walkTo, type Walker } from './walk.js';

/**
 * A station rests through an emergency in a room on its real timers: nothing wakes it while it
 * rests, and its clock is armed again once it is back on its consoles (core state.ts `resting`).
 *
 * A corridor for two with one station of two consoles and an emergency at two valves, which
 * only this test starts:
 *
 *   0123456789012345
 * 0 ################
 * 1 #..............#   console a (5,1); console b (13,1)
 * 2 #..............#   spawns (1,1) (1,2); sign (2,2); valves (4,2) (12,2); book (9,2)
 * 3 ################
 */
const DUCT = [5, 6, 7, 8, 9, 10, 11, 12, 13].map((x) => [x, 2]);

function corridor(type: 'firewall' | 'startup'): Mission {
  return parseMission({
    id: `ruheflur-${type}`,
    title: 'Ruheflur',
    players: { min: 2, max: 2 },
    story: { intro: 'i', win: 'w', lose: 'l' },
    timeLimitSec: 1800,
    puzzles: [
      { type, id: 'anlage', title: 'Anlage' },
      { type: 'button-sync', id: 'danach', title: 'Danach' },
    ],
    map: {
      tiles: ['################', '#..............#', '#..............#', '################'],
      spawns: [
        { x: 1, y: 1 },
        { x: 1, y: 2 },
      ],
      stations: [
        { puzzleId: 'anlage', x: 5, y: 1, console: 'a' },
        { puzzleId: 'anlage', x: 13, y: 1, console: 'b' },
        { puzzleId: 'danach', x: 8, y: 1 },
      ],
      manuals: [
        { id: 'buch', kind: 'book', label: 'BUCH', puzzleIds: ['anlage'], spots: [{ x: 9, y: 2 }] },
      ],
      edgeworkSign: { x: 2, y: 2 },
      // the Anlaufsteuerung's cable duct, from beside console a to beside console b
      conduits: type === 'startup' ? [{ puzzleId: 'anlage', tiles: DUCT }] : [],
      sabotage: {
        label: 'KÜHLUNG AUSGEFALLEN',
        // never on the schedule within a test: the test starts it at its moment
        firstAfterSec: 100_000,
        durationSec: 40,
        penaltySec: 60,
        afterSolved: 0,
        panels: [
          { id: 'links', x: 4, y: 2 },
          { id: 'rechts', x: 12, y: 2 },
        ],
      },
    },
  });
}

type Player = Walker & { name: string };

/** The room's game, its puzzle timer and its dispatch, as only a test reaches them. */
const gameOf = (room: Room): GameState => room['state'];
const ticking = (room: Room): boolean => room['puzzleTimer'] !== null;
const emergency = (room: Room): void =>
  room['dispatch']({ type: 'sabotage-start', at: Date.now() });

const alarmsOf = (room: Room): string[] =>
  gameOf(room)
    .events.filter((event) => event.kind === 'penalty')
    .map((event) => event.label);

/** The open station as `player`'s last view shows it; throws where it shows none. */
function seenBy(player: Player): PuzzleView {
  const last = player.messages.filter((m) => m.kind === 'view').at(-1);
  if (last?.kind !== 'view' || last.view.puzzle === null) {
    throw new Error(`${player.name} sees no open station`);
  }
  return last.view.puzzle;
}

/** Anna at console a, Ben at console b, the station switched on. */
function manned(type: 'firewall' | 'startup'): { room: Room; anna: Player; ben: Player } {
  const room = new Room('TEST', corridor(type));
  const [anna, ben] = ['Anna', 'Ben'].map((name): Player => {
    const messages: ServerMessage[] = [];
    const player = { ...room.join(name, passFor(name)), messages, name };
    room.attach(player.playerId, (m) => messages.push(m));
    return player;
  }) as [Player, Player];
  room.setReady(ben.playerId, true);
  room.act(anna.playerId, { kind: 'start-mission' });
  toConsoles(room, anna, ben);
  pressE(room, anna);
  return { room, anna, ben };
}

function toConsoles(room: Room, anna: Player, ben: Player): void {
  walkTo(room, anna, 5.5, 1.5);
  walkTo(room, ben, 13.5, 1.5);
}

function toValves(room: Room, anna: Player, ben: Player): void {
  walkTo(room, anna, 4.5, 2.5);
  walkTo(room, ben, 12.5, 2.5);
}

/**
 * The crew works the station as its solver says from both consoles' views, a second of the
 * room's real timers at a time, until `done` says so of the station — or it is solved.
 */
function work(
  { room, anna, ben }: { room: Room; anna: Player; ben: Player },
  done: (station: PuzzleState) => boolean = () => false,
): void {
  for (let second = 0; second < 600; second++) {
    const { puzzleState, mission, currentPuzzleIndex, edgework } = gameOf(room);
    const def = mission.puzzles[currentPuzzleIndex];
    if (puzzleState === null || def?.id !== 'anlage' || done(puzzleState)) {
      return;
    }
    const views = { operator: seenBy(anna), partner: seenBy(ben), reader: seenBy(anna) };
    const aid = { transcript: [], remainingSec: null, at: Date.now() };
    for (const { by, input } of moduleFor(def.type).solve(def, views, edgework, aid)) {
      const from = by === 'partner' ? ben : anna;
      room.act(from.playerId, { kind: 'puzzle-input', input });
    }
    vi.advanceTimersByTime(1000);
  }
  throw new Error('the crew never got there in ten minutes');
}

describe('Room with a station resting through an emergency', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const secondWave = (s: PuzzleState): boolean =>
    s.type === 'firewall' && s.cleared === 1 && s.dropped.length > 0;

  it('wakes the Paketfilter for nothing while it rests, and arms its clock again after', () => {
    const crew = manned('firewall');
    const { room, anna, ben } = crew;
    work(crew, secondWave);
    expect(ticking(room)).toBe(true);
    emergency(room);
    const put = gameOf(room).resting;
    expect([gameOf(room).puzzleState, ticking(room)]).toEqual([null, false]);
    // the wave's other attacks would have reached the Kern long since: nothing judges them
    vi.advanceTimersByTime(30_000);
    expect(gameOf(room).resting).toBe(put);
    expect([alarmsOf(room), ticking(room)]).toEqual([[], false]);

    toValves(room, anna, ben);
    expect(gameOf(room).sabotage).toBeNull();
    expect(gameOf(room).puzzleState).toMatchObject({ cleared: 1, waiting: true, dropped: [] });
    expect(ticking(room)).toBe(false);
    toConsoles(room, anna, ben);
    room.act(anna.playerId, { kind: 'puzzle-input', input: { start: true } });
    expect(ticking(room)).toBe(true);
    work(crew);
    expect(gameOf(room).currentPuzzleIndex).toBe(1);
    expect(alarmsOf(room)).toEqual([]);
    room.dispose();
  });

  it('judges the wave started after the emergency on the clock again, nobody acting', () => {
    const crew = manned('firewall');
    const { room, anna, ben } = crew;
    work(crew, secondWave);
    emergency(room);
    toValves(room, anna, ben);
    toConsoles(room, anna, ben);
    room.act(anna.playerId, { kind: 'puzzle-input', input: { start: true } });
    vi.advanceTimersByTime(120_000);
    expect(alarmsOf(room)).toEqual(['Paketfilter: Angriff im Kern']);
    expect(gameOf(room).puzzleState).toMatchObject({ cleared: 1, waiting: true });
    room.dispose();
  });

  it('brings the station back as the emergency runs out: its alarm alone', () => {
    const crew = manned('firewall');
    const { room } = crew;
    work(crew, secondWave);
    emergency(room);
    vi.advanceTimersByTime(40_000);
    expect(gameOf(room).sabotage).toBeNull();
    expect(alarmsOf(room)).toEqual([EMERGENCY_MISSED]);
    expect(gameOf(room).puzzleState).toMatchObject({ cleared: 1, waiting: true });
    vi.advanceTimersByTime(120_000);
    expect(alarmsOf(room)).toHaveLength(1);
    room.dispose();
  });

  it('lets the Anlaufsteuerung’s pulse lapse only as it is back, then runs it on the clock', () => {
    const crew = manned('startup');
    const { room, anna, ben } = crew;
    work(crew, (s) => s.type === 'startup' && s.stage === 1 && s.pulse !== null);
    expect(ticking(room)).toBe(true);
    emergency(room);
    const put = gameOf(room).resting;
    // travel and window are over in nine seconds: no tick lets the pulse arrive or die
    vi.advanceTimersByTime(30_000);
    expect(gameOf(room).resting).toBe(put);
    expect(put).toMatchObject({ stage: 1, pulse: { arrived: false } });
    expect(ticking(room)).toBe(false);

    toValves(room, anna, ben);
    const back = gameOf(room).puzzleState;
    expect(back).toMatchObject({ stage: 1, pulse: null, last: 'verfallen' });
    expect(back?.type === 'startup' && back.values).toEqual(put?.type === 'startup' && put.values);
    toConsoles(room, anna, ben);
    work(crew, (s) => s.type === 'startup' && s.pulse !== null);
    expect(ticking(room)).toBe(true);
    // the room's own tick brings the new pulse onto the ladder's marked steps
    vi.advanceTimersByTime(6000);
    expect(gameOf(room).puzzleState).toMatchObject({ pulse: { arrived: true } });
    work(crew);
    expect(gameOf(room).currentPuzzleIndex).toBe(1);
    expect(alarmsOf(room)).toEqual([]);
    room.dispose();
  });

  it('keeps the resting station through a snapshot and a restore, its progress with it', () => {
    const crew = manned('firewall');
    work(crew, secondWave);
    emergency(crew.room);
    const taken = crew.room.snapshot(Date.now());
    crew.room.dispose();
    const sealed = JSON.parse(JSON.stringify({ ...taken, instance: 'eins', final: true }));
    const kept = sealedSnapshotSchema.parse(sealed);
    expect(kept.state.resting).toEqual(taken.state.resting);
    expect(kept.state.resting).toMatchObject({ type: 'firewall', cleared: 1 });
    expect(kept.state.puzzleState).toBeNull();

    vi.advanceTimersByTime(60_000);
    const room = Room.restore(kept, Date.now());
    const [anna, ben] = ['Anna', 'Ben'].map((name): Player => ({ ...rejoin(room, { name }) }));
    if (anna === undefined || ben === undefined) {
      throw new Error('expected two players');
    }
    expect(gameOf(room).paused).toBeNull();
    expect([gameOf(room).puzzleState, ticking(room)]).toEqual([null, false]);
    standAt(room, anna, { x: 5.5, y: 1.5 });
    standAt(room, ben, { x: 13.5, y: 1.5 });
    toValves(room, anna, ben);
    expect(gameOf(room).puzzleState).toMatchObject({ cleared: 1, waiting: true });
    toConsoles(room, anna, ben);
    work({ room, anna, ben });
    expect(gameOf(room).currentPuzzleIndex).toBe(1);
    expect(alarmsOf(room)).toEqual([]);
    room.dispose();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMission, type Mission, type PlayerView, type ServerMessage } from '@escapelab/core';
import { Room } from '../src/room.js';
import { open, roomKey, seal } from '../src/seal.js';
import { rejoin } from './blackout.js';
import { passFor } from './passes.js';
import { pressE, walkTo, type Walker } from './walk.js';

/**
 * A corridor lab of three stations the whole crew presses — Eins (3,1), Zwei (7,1), Drei
 * (11,1) — taken in any order, with no hatch; `timeLimitSec` 0 runs it without a clock.
 *
 *   0123456789012345
 * 0 ################
 * 1 #..1...2...3...#   spawns (1,1) and (1,2)
 * 2 #..............#
 * 3 ################
 */
function freeLab(timeLimitSec = 600): Mission {
  return parseMission({
    id: 'frei',
    title: 'Freie Reihenfolge',
    order: 'free',
    players: { min: 2, max: 2 },
    story: { intro: 'i', win: 'w', lose: 'l' },
    timeLimitSec,
    puzzles: [
      { type: 'button-sync', id: 'eins', title: 'Eins' },
      { type: 'button-sync', id: 'zwei', title: 'Zwei' },
      { type: 'button-sync', id: 'drei', title: 'Drei' },
    ],
    map: {
      tiles: ['################', '#..............#', '#..............#', '################'],
      spawns: [
        { x: 1, y: 1 },
        { x: 1, y: 2 },
      ],
      stations: [
        { puzzleId: 'eins', x: 3, y: 1 },
        { puzzleId: 'zwei', x: 7, y: 1 },
        { puzzleId: 'drei', x: 11, y: 1 },
      ],
    },
  });
}

function join(room: Room, name: string): Walker {
  const messages: ServerMessage[] = [];
  const player = { ...room.join(name, passFor(name)), messages };
  room.attach(player.playerId, (m) => messages.push(m));
  return player;
}

function lastView(walker: Walker): PlayerView {
  const last = walker.messages.filter((m) => m.kind === 'view').at(-1);
  if (last?.kind !== 'view') {
    throw new Error('expected a view');
  }
  return last.view;
}

/** Anna and Ben in a started run of `mission`. */
function running(mission: Mission) {
  const room = new Room('TEST', mission);
  const anna = join(room, 'Anna');
  const ben = join(room, 'Ben');
  room.setReady(ben.playerId, true);
  room.act(anna.playerId, { kind: 'start-mission' });
  return { room, anna, ben };
}

/** Both walk up to the station at (x, 1), side by side below it, and Anna presses E. */
function switchOn(room: Room, anna: Walker, ben: Walker, x: number): void {
  walkTo(room, anna, x + 0.5, 2.5);
  walkTo(room, ben, x - 0.5, 2.5);
  pressE(room, anna);
}

/** Both press the open station together, which solves it. */
function pressTogether(room: Room, ...crew: Walker[]): void {
  for (const player of crew) {
    room.act(player.playerId, { kind: 'puzzle-input', input: { press: true } });
  }
}

describe('a free-order run in a room', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('switches on whichever station the crew stands at, and no other until it is solved', () => {
    const { room, anna, ben } = running(freeLab());
    switchOn(room, anna, ben, 11);
    expect(lastView(anna).puzzle?.title).toBe('Drei');
    walkTo(room, anna, 3.5, 2.5);
    expect(() => pressE(room, anna)).toThrow(/Zu weit weg/);
    walkTo(room, anna, 11.5, 2.5);
    pressTogether(room, anna, ben);
    expect(lastView(anna).currentPuzzleIndex).toBe(1);
    switchOn(room, anna, ben, 3);
    expect(lastView(ben).puzzle?.title).toBe('Eins');
    room.dispose();
  });

  it('shows whoever stands still the stations it no longer arms, once the crew picks one', () => {
    const { room, anna, ben } = running(freeLab());
    // All three armed while the crew picks: every view has them whole.
    expect(lastView(ben).map?.stations.map((s) => s.puzzleId)).toEqual(['eins', 'zwei', 'drei']);
    switchOn(room, anna, ben, 3);
    // Zwei and Drei, armed no more and found by nobody, lie in sight down the corridor.
    const glimpsed = (lastView(ben).map?.stations ?? []).filter((s) => !s.known);
    expect(glimpsed.map((s) => s.puzzleId)).toEqual(['zwei', 'drei']);
    room.dispose();
  });
});

describe('a run without a clock in a room', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('never runs out, and its seat says no time is left on any clock', () => {
    const { room, anna } = running(freeLab(0));
    vi.advanceTimersByTime(3 * 3600_000);
    const view = lastView(anna);
    expect(view.phase).toBe('playing');
    expect(view.deadlineAt).toBeNull();
    expect(room.seatSummary(passFor('Anna'))?.leftMs).toBeNull();
    room.dispose();
  });
});

/** The key the snapshots below are sealed under. */
const KEY = roomKey({ ROOM_SECRET: 'f00d'.repeat(16) }).key;

/** How long the server is down between the snapshot and the room taken up again, ms. */
const DOWNTIME_MS = 30_000;

/** `room` as it stands, sealed as a server going down would seal it: the room kept, the blob. */
function sealedNow(room: Room) {
  const kept = room.snapshot(Date.now());
  return { kept, blob: seal({ ...kept, instance: 'frei', final: true }, 'TEST', KEY) };
}

/** The stations the last view of `walker` has armed, in map order. */
const armedIn = (walker: Walker): string[] =>
  (lastView(walker).map?.stations ?? []).flatMap((s) =>
    'status' in s && s.status === 'armed' ? [s.puzzleId] : [],
  );

describe('a free-order run without a clock, sealed and taken up again', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a pick under way — the order, the station up, its instance — to be finished', () => {
    const { room, anna, ben } = running(freeLab(0));
    // Drei first: it swaps places with Eins at the run's first, and is the crew's until solved.
    switchOn(room, anna, ben, 11);
    const { kept, blob } = sealedNow(room);
    room.dispose();
    const { state } = open(blob, 'TEST', KEY);
    expect(state.mission.puzzles.map((p) => p.id)).toEqual(['drei', 'zwei', 'eins']);
    expect([state.currentPuzzleIndex, state.picked]).toEqual([0, true]);
    expect(state.puzzleState).toEqual(kept.state.puzzleState);
    vi.advanceTimersByTime(DOWNTIME_MS);
    const again = Room.restore(open(blob, 'TEST', KEY), Date.now());
    const [annaBack, benBack] = [rejoin(again, { name: 'Anna' }), rejoin(again, { name: 'Ben' })];
    // Back on: Drei still up and the crew's, the other two waiting for its solve.
    expect(lastView(annaBack).puzzle?.title).toBe('Drei');
    expect(armedIn(annaBack)).toEqual(['drei']);
    // Solved, the pick is given back: both still to solve stand armed for the next one.
    pressTogether(again, annaBack, benBack);
    expect(lastView(annaBack).currentPuzzleIndex).toBe(1);
    expect(armedIn(annaBack)).toEqual(['eins', 'zwei']);
    again.dispose();
  });

  it('keeps the crew picking between stations, its clock standing still meanwhile', () => {
    const { room, anna, ben } = running(freeLab(0));
    // Drei taken and solved: the crew picks its next.
    switchOn(room, anna, ben, 11);
    pressTogether(room, anna, ben);
    const { kept, blob } = sealedNow(room);
    room.dispose();
    const { state } = open(blob, 'TEST', KEY);
    expect(state.mission.puzzles.map((p) => p.id)).toEqual(['drei', 'zwei', 'eins']);
    expect([state.currentPuzzleIndex, state.picked]).toEqual([1, false]);
    expect(state.clockFrom).toBe(kept.state.clockFrom);
    vi.advanceTimersByTime(DOWNTIME_MS);
    const again = Room.restore(open(blob, 'TEST', KEY), Date.now());
    const [back] = [rejoin(again, { name: 'Anna' }), rejoin(again, { name: 'Ben' })];
    // Both back: the time run counts on from where it stood, the downtime left out.
    expect(lastView(back)).toMatchObject({ pausedAt: null, away: [] });
    expect(lastView(back).clockFrom).toBe((kept.state.clockFrom ?? 0) + DOWNTIME_MS);
    expect(lastView(back).currentPuzzleIndex).toBe(1);
    again.dispose();
  });
});

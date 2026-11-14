import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  emergenciesDue,
  FIRST_WAIT_MS,
  type RoomSnapshot,
  type ServerMessage,
} from '@escapelab/core';
import { Room } from '../src/room.js';
import { blackoutMidway, blackoutMission, lastView, rejoin, type Member } from './blackout.js';
import { passFor } from './passes.js';
import { standAsIn, walkTo } from './walk.js';

const T0 = 1_700_000_000_000;

/** How long the server is down between the snapshot and the room taken up again, ms. */
const DOWNTIME_MS = 30_000;

/** The latest positions `member` was sent. */
function lastPositions(member: Member): Extract<ServerMessage, { kind: 'positions' }> {
  const last = member.messages.filter((m) => m.kind === 'positions').at(-1);
  if (last?.kind !== 'positions') {
    throw new Error('expected positions');
  }
  return last;
}

describe('a room’s snapshot', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps a run mid-way through Blackout whole, and takes it up again as it stood', () => {
    const { room, anna, ben } = blackoutMidway();
    // Everything else the room keeps, once each: a ping, a quick-chat line, a voice signal and a
    // step refused; Ben's tab closed and back, a phone's ask for his seat turned away meanwhile.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    room.ping(ben.playerId, 29, 9);
    room.chat(ben.playerId, 0, undefined);
    room.relaySignal(ben.playerId, anna.playerId, { type: 'offer', sdp: 'v=0' });
    const far = { x: 1.5, y: 1.5, facing: 0, moving: false };
    room.updatePosition(ben.playerId, lastView(ben).startedAt ?? 0, far);
    ben.detach('closed');
    const phone = passFor('Bens Telefon');
    room.claim('Ben', phone, () => undefined);
    room.answerTakeover(anna.playerId, ben.playerId, false);
    rejoin(room, ben);
    // The Flur's patrol on its way, a while after it woke.
    vi.advanceTimersByTime(2000);
    const at = Date.now();
    const kept = room.snapshot(at);
    const { state, keeping } = kept;
    expect(keeping.refusedSteps).toBe(1);
    // When the patrols last moved is no part of it: their timer starts that anew as they wake.
    expect(keeping).not.toHaveProperty('lastDroneTick');
    // Nor when each line closed: a room taken up again waits for every seat from then on.
    expect(keeping).not.toHaveProperty('lostAt');
    for (const byMember of [keeping.lastPingAt, keeping.lastChatAt, keeping.signalAllowance]) {
      expect(Object.keys(byMember)).toEqual([ben.playerId]);
    }
    expect(keeping.closedClean).toEqual([ben.playerId]);
    expect(Object.keys(keeping.askAgainAt)).toEqual([`${ben.playerId}:${phone.id}`]);
    expect(state.currentPuzzleIndex).toBe(3);
    expect(state.items['ersatzsicherung']?.carriedBy).toBe(anna.playerId);
    expect(state.sabotage).toBeNull();
    expect(emergenciesDue(state)).toBe(true);
    const drone = keeping.drones?.['flurwache'];
    expect(drone).toBeDefined();
    expect([drone?.x, drone?.y]).not.toEqual([10.5, 11.5]);
    // Every seat off the line, the run standing still for the whole crew from now.
    expect(state.players.map((p) => [p.name, p.connected])).toEqual([
      ['Anna', false],
      ['Ben', false],
    ]);
    expect(state.paused).toEqual({ since: at, kind: 'wartung' });
    expect(Object.values(state.away)).toEqual([
      { since: at, waivableAt: at + FIRST_WAIT_MS, waived: false },
      { since: at, waivableAt: at + FIRST_WAIT_MS, waived: false },
    ]);
    expect(kept.seats.map(({ name, passId }) => [name, passId])).toEqual([
      ['Anna', passFor('Anna').id],
      ['Ben', passFor('Ben').id],
    ]);
    // The room itself plays on as it was.
    expect(lastView(anna).pausedAt).toBeNull();
    // As the sealed blob carries it, and back: nothing lost on the way.
    const carried = JSON.parse(JSON.stringify(kept)) as RoomSnapshot;
    expect(carried).toEqual(kept);
    const again = Room.restore(carried, at);
    expect(again.snapshot(at)).toEqual(kept);
    expect(again.createdAt).toBe(room.createdAt);
    room.dispose();
    again.dispose();
  });

  it('counts the room’s dispatches on from those of the snapshot it was taken up from', () => {
    const room = new Room('ZAHL', blackoutMission());
    const anna = room.join('Anna', passFor('Anna'));
    const first = room.snapshot().seq;
    room.act(anna.playerId, { kind: 'select-color', color: '#f472b6' });
    expect(room.snapshot().seq).toBe(first + 1);
    // A ping changes nothing in the game: no dispatch.
    room.ping(anna.playerId, 1, 1);
    const kept = room.snapshot();
    expect(kept.seq).toBe(first + 1);
    const again = Room.restore(kept, Date.now());
    again.resume(passFor('Anna'));
    expect(again.snapshot().seq).toBe(kept.seq + 1);
    room.dispose();
    again.dispose();
  });
});

/** A crew of the room that was, or of its twin taken up again: the room with its two seats. */
interface Crew {
  room: Room;
  anna: Member;
  ben: Member;
}

/**
 * Blackout mid-way, its snapshot taken as the server goes down for maintenance, the crew's lines
 * going with it; DOWNTIME_MS on, a twin taken up again from the snapshot; 10 s on, the crew back
 * in both. Returns both crews, the snapshot, and the view before it with the moments the
 * snapshot was taken and the crew was back.
 */
function twins() {
  const { room, anna, ben } = blackoutMidway();
  vi.advanceTimersByTime(2000);
  const at = Date.now();
  const before = lastView(anna);
  const kept = JSON.parse(JSON.stringify(room.snapshot(at))) as RoomSnapshot;
  room.goDown(at);
  anna.detach();
  ben.detach();
  vi.advanceTimersByTime(DOWNTIME_MS);
  const restored = Room.restore(kept, Date.now());
  vi.advanceTimersByTime(10_000);
  const back = Date.now();
  const [was, now] = [room, restored].map(
    (each): Crew => ({ room: each, anna: rejoin(each, anna), ben: rejoin(each, ben) }),
  ) as [Crew, Crew];
  for (const member of [anna, ben]) {
    standAsIn(restored, room, member);
  }
  return { was, now, kept, before, at, back };
}

const views = (crew: Crew) => [lastView(crew.anna), lastView(crew.ben)];

/** Where `crew`'s room has the Flur's patrol, as its positions last said. */
function patrolOf(crew: Crew): [number, number] {
  const drone = lastPositions(crew.anna).drones['flurwache'];
  return [drone?.x ?? Number.NaN, drone?.y ?? Number.NaN];
}

describe('a room taken up again from its snapshot', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('plays Blackout on as the room it was, the clock moved on by the downtime', () => {
    const { was, now, kept, before, at, back } = twins();
    expect(views(now)).toEqual(views(was));
    expect(lastView(now.anna).pausedAt).toBeNull();
    expect(lastView(now.anna).deadlineAt).toBe((before.deadlineAt ?? 0) + (back - at));
    // The patrol stood still through the pause, where it was: it does not start its loop anew.
    const stood = kept.keeping.drones?.['flurwache'] ?? { x: 0, y: 0 };
    const round = (n: number): number => Math.round(n * 100) / 100;
    expect(patrolOf(was)).toEqual([round(stood.x), round(stood.y)]);
    expect(patrolOf(now)).toEqual(patrolOf(was));
    // On together: the patrol flies on, the first emergency comes, Ben walks a few tiles.
    for (const [step, x] of [[500, 28], [20_000, 27], [30_000, 26]] as const) {
      vi.advanceTimersByTime(step);
      walkTo(was.room, was.ben, x + 0.5, 9.5);
      walkTo(now.room, now.ben, x + 0.5, 9.5);
      expect(views(now)).toEqual(views(was));
      expect(lastPositions(now.anna).drones).toEqual(lastPositions(was.anna).drones);
    }
    const emergencies = lastView(now.anna).events.filter((e) => e.kind === 'sabotage');
    expect(emergencies.map((e) => e.label)).toEqual(['Notfall: KÜHLKREISLAUF — RELAIS VON HAND']);
    expect(lastView(now.anna).map?.sabotage).not.toBeNull();
    was.room.dispose();
    now.room.dispose();
  });

  it('waits for whoever is not back a minute from the moment it was taken up again', () => {
    const { room } = blackoutMidway();
    const at = Date.now();
    const kept = room.snapshot(at);
    room.dispose();
    vi.advanceTimersByTime(DOWNTIME_MS);
    const restoredAt = Date.now();
    const restored = Room.restore(kept, restoredAt);
    vi.advanceTimersByTime(5000);
    const anna = rejoin(restored, { name: 'Anna' });
    const ben = kept.state.players.find((p) => p.name === 'Ben');
    expect(lastView(anna)).toMatchObject({
      pausedAt: at,
      away: [{ id: ben?.id, name: 'Ben', since: at, waivableAt: restoredAt + FIRST_WAIT_MS }],
    });
    restored.dispose();
  });
});

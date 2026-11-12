import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseMission,
  SNAPSHOT_EVERY_MS,
  SNAPSHOT_MAX,
  type RoomSnapshot,
  type ServerMessage,
} from '@escapelab/core';
import { MissionCatalog } from '../src/missions.js';
import { Room, type Sealer } from '../src/room.js';
import { RoomManager } from '../src/roomManager.js';
import { open, roomKey, seal } from '../src/seal.js';
import { serveSockets } from '../src/sockets.js';
import { FakeServer, joinedOf } from './line.js';
import { passFor } from './passes.js';

const T0 = 1_700_000_000_000;
const KEY = roomKey({ ROOM_SECRET: 'f00d'.repeat(16) }).key;

/** A corridor lab for two, a station the whole crew presses at (3,1); no intro. */
const lab = parseMission({
  id: 'flur',
  title: 'Flur',
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  players: { min: 2, max: 2 },
  puzzles: [{ type: 'button-sync', id: 'eins', title: 'Eins' }],
  map: {
    tiles: ['######', '#....#', '######'],
    spawns: [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ],
    stations: [{ puzzleId: 'eins', x: 3, y: 1 }],
  },
});

type Snapshot = Extract<ServerMessage, { kind: 'snapshot' }>;

const snapshotsOf = (heard: ServerMessage[]): Snapshot[] =>
  heard.filter((m): m is Snapshot => m.kind === 'snapshot');

/** A seat of the crew: its player id, what its connection heard, how it lets go. */
interface Seat {
  playerId: string;
  heard: ServerMessage[];
  detach: (clean?: boolean) => void;
}

/** What seals the lab's snapshots under KEY, as an instance's, watched. */
const sealing = () =>
  vi.fn((snapshot: RoomSnapshot, final: boolean) =>
    seal({ ...snapshot, instance: 'flur-instance', final }, 'FLUR', KEY),
  );

/** Anna and Ben in a room of the lab sealed by `sealer` (none for null), each heard; audience. */
function crewRoom(sealer: Sealer | null = sealing()) {
  const room = new Room('FLUR', lab, undefined, null, 'normal', null, sealer);
  const [anna, ben] = ['Anna', 'Ben'].map((name): Seat => {
    const heard: ServerMessage[] = [];
    const { playerId } = room.join(name, passFor(name));
    const detach = room.attach(playerId, (m) => heard.push(m));
    return { playerId, heard, detach };
  }) as [Seat, Seat];
  const audience: ServerMessage[] = [];
  room.attachSpectator((m) => audience.push(m));
  return { room, anna, ben, audience };
}

describe('the crew’s snapshots of its room', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('go to every seat on the line once the dispatches are over, sealed for the room', () => {
    const { room, anna, ben, audience } = crewRoom();
    expect(snapshotsOf(anna.heard)).toEqual([]);
    vi.advanceTimersByTime(0);
    const [first] = snapshotsOf(anna.heard);
    expect(snapshotsOf(anna.heard)).toHaveLength(1);
    expect(snapshotsOf(ben.heard)).toEqual(snapshotsOf(anna.heard));
    expect(snapshotsOf(audience)).toEqual([]);
    const kept = open(first?.blob ?? '', 'FLUR', KEY);
    expect(kept).toMatchObject({ code: 'FLUR', missionId: 'flur', seq: first?.seq, at: T0 });
    expect(kept.seats.map((seat) => seat.name)).toEqual(['Anna', 'Ben']);
    room.dispose();
  });

  it('go out at most every 2 s, with whatever came meanwhile', () => {
    const { room, anna, ben } = crewRoom();
    vi.advanceTimersByTime(0);
    vi.advanceTimersByTime(300);
    room.setReady(ben.playerId, true);
    vi.advanceTimersByTime(900);
    room.setReady(ben.playerId, false);
    room.setReady(ben.playerId, true);
    vi.advanceTimersByTime(SNAPSHOT_EVERY_MS - 1200 - 1);
    expect(snapshotsOf(anna.heard)).toHaveLength(1);
    vi.advanceTimersByTime(1);
    const [first, second] = snapshotsOf(anna.heard);
    expect(second?.at).toBe(T0 + SNAPSHOT_EVERY_MS);
    expect(second?.seq).toBe((first?.seq ?? 0) + 3);
    expect(open(second?.blob ?? '', 'FLUR', KEY).state.players[1]?.ready).toBe(true);
    // Nothing changed since: nothing more goes out.
    vi.advanceTimersByTime(10_000);
    expect(snapshotsOf(anna.heard)).toHaveLength(2);
    room.dispose();
  });

  it('go to nobody once nobody is on the line, and none goes out of a run that is over', () => {
    const { room, anna, ben } = crewRoom();
    vi.advanceTimersByTime(0);
    room.setReady(ben.playerId, true);
    room.act(anna.playerId, { kind: 'start-mission' });
    vi.advanceTimersByTime(SNAPSHOT_EVERY_MS);
    expect(snapshotsOf(anna.heard)).toHaveLength(2);
    // Ben gives up: the run is over, called off, and no snapshot of its end goes out.
    room.abandon(passFor('Ben'));
    vi.advanceTimersByTime(SNAPSHOT_EVERY_MS * 3);
    expect(snapshotsOf(anna.heard)).toHaveLength(2);
    room.dispose();
    // Both lines drop before the first goes out: none is even sealed, for nobody.
    const sealer = sealing();
    const quiet = crewRoom(sealer);
    quiet.anna.detach();
    quiet.ben.detach();
    vi.advanceTimersByTime(SNAPSHOT_EVERY_MS * 3);
    expect(sealer).not.toHaveBeenCalled();
    quiet.room.dispose();
  });

  it('go out under SNAPSHOT_MAX only, the log saying once of one too big', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { room, anna, ben } = crewRoom(() => 'v1.'.padEnd(SNAPSHOT_MAX + 1, 'x'));
    vi.advanceTimersByTime(0);
    room.setReady(ben.playerId, true);
    vi.advanceTimersByTime(SNAPSHOT_EVERY_MS);
    expect(snapshotsOf(anna.heard)).toEqual([]);
    expect(warn.mock.calls).toEqual([
      ['[escapelab] room FLUR: a snapshot of 256 kB is too big to send'],
    ]);
    room.dispose();
    vi.restoreAllMocks();
  });

  it('go nowhere from a room that seals none', () => {
    const { room, anna } = crewRoom(null);
    vi.advanceTimersByTime(SNAPSHOT_EVERY_MS * 3);
    expect(snapshotsOf(anna.heard)).toEqual([]);
    room.dispose();
  });
});

describe('the crew’s snapshots from the rooms of the manager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('go out of every room the manager opens with its key, to the socket that sat down', () => {
    const missions = fileURLToPath(new URL('../../../missions', import.meta.url));
    const line = new FakeServer();
    const manager = new RoomManager(undefined, false, null, KEY);
    serveSockets(line, { catalog: new MissionCatalog(missions), manager });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const anna = line.connect();
    anna.say({ kind: 'create-room', name: 'Anna', pass: passFor('Anna'), missionId: 'blackout' });
    vi.advanceTimersByTime(0);
    const { code } = joinedOf(anna);
    const [heard] = snapshotsOf(anna.heard);
    // Sealed as this instance's, and not its last of the room: the server goes on.
    expect(open(heard?.blob ?? '', code, KEY)).toMatchObject({
      code,
      missionId: 'blackout',
      instance: manager.instanceId,
      final: false,
    });
    manager.sweep(Number.POSITIVE_INFINITY);
    vi.restoreAllMocks();
  });
});

import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SNAPSHOT_EVERY_MS, SNAPSHOT_MAX_AGE_MS } from '@escapelab/core';
import { MissionCatalog } from '../src/missions.js';
import { RESTORE_WINDOW_MS, Room } from '../src/room.js';
import { RoomManager } from '../src/roomManager.js';
import { roomKey, seal } from '../src/seal.js';
import { serveSockets } from '../src/sockets.js';
import { FakeServer, joinedOf, type FakeSocket } from './line.js';
import { passFor } from './passes.js';

const T0 = 1_700_000_000_000;
const KEY = roomKey({ ROOM_SECRET: 'cafe'.repeat(16) }).key;
const missions = new MissionCatalog(fileURLToPath(new URL('../../../missions', import.meta.url)));

/** A server as index.ts wires it, on fake sockets, sealing with KEY; its log listened to. */
function server() {
  const line = new FakeServer();
  const manager = new RoomManager(undefined, false, null, KEY);
  serveSockets(line, { catalog: missions, manager });
  return { line, manager };
}

/** The newest snapshot `socket` was handed, as a `snapshot` or a `restart`. */
function blobOf(socket: FakeSocket): { blob: string; seq: number; at: number } {
  const last = socket.heard.filter((m) => m.kind === 'snapshot' || m.kind === 'restart').at(-1);
  if (last?.kind !== 'snapshot' && last?.kind !== 'restart') {
    throw new Error('this socket was handed no snapshot');
  }
  return last;
}

/** `name` back on a socket of `line`, resuming in room `code` with `blob`. */
function resume(line: FakeServer, name: string, code: string, blob?: string): FakeSocket {
  const socket = line.connect();
  const carried = blob === undefined ? {} : { blob };
  socket.say({ kind: 'resume', code, pass: passFor(name), ...carried });
  return socket;
}

/** The refusal `socket` was sent last; throws where it was sent none. */
function refusalOf(socket: FakeSocket): string {
  const last = socket.heard.filter((m) => m.kind === 'error').at(-1);
  if (last?.kind !== 'error') {
    throw new Error('this socket was refused nothing');
  }
  return last.message;
}

/** Anna and Ben in Blackout on server `old`, the lights out, their snapshots handed out. */
function crewOn(old: ReturnType<typeof server>) {
  const anna = old.line.connect();
  anna.say({ kind: 'create-room', name: 'Anna', pass: passFor('Anna'), missionId: 'blackout' });
  const { code } = joinedOf(anna);
  const ben = old.line.connect();
  ben.say({ kind: 'join-room', code, name: 'Ben', pass: passFor('Ben') });
  ben.say({ kind: 'set-ready', ready: true });
  anna.say({ kind: 'start-mission' });
  for (const socket of [anna, ben]) {
    socket.say({ kind: 'intro-done' });
  }
  vi.advanceTimersByTime(SNAPSHOT_EVERY_MS);
  return { code, anna, ben };
}

const logged = (log: ReturnType<typeof vi.spyOn>): string[] =>
  log.mock.calls.map(([line]) => String(line));

describe('a room taken up again from the snapshot a resume carries', () => {
  let log: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stands still for the crew until it is back, its clock moved on by the downtime', () => {
    const { code, anna, ben } = crewOn(server());
    const before = anna.view;
    const kept = blobOf(anna);
    // The old server is gone without a word; the new one knows no room.
    vi.advanceTimersByTime(20_000);
    const fresh = server();
    const annaBack = resume(fresh.line, 'Anna', code, kept.blob);
    expect(joinedOf(annaBack).code).toBe(code);
    expect(annaBack.view).toMatchObject({
      phase: 'playing',
      maintenance: true,
      pausedAt: kept.at,
      pausedFor: [{ name: 'Ben', since: kept.at }],
    });
    const age = ((Date.now() - kept.at) / 1000).toFixed(1);
    expect(logged(log)).toContain(
      `[escapelab] restored room ${code} from snapshot seq ${kept.seq} (2 seats, ${age} s old)`,
    );
    vi.advanceTimersByTime(4000);
    const benBack = resume(fresh.line, 'Ben', code, blobOf(ben).blob);
    for (const socket of [annaBack, benBack]) {
      expect(socket.view.pausedFor).toBeNull();
      expect(socket.view.deadlineAt).toBe((before.deadlineAt ?? 0) + (Date.now() - kept.at));
    }
    expect(fresh.manager.counts()).toMatchObject({ total: 1, running: 1, paused: 0, players: 2 });
  });

  it('is no room for a resume without a snapshot, nor for a pass it seats nowhere', () => {
    const { code, anna } = crewOn(server());
    const fresh = server();
    const unknown = `Raum "${code}" existiert nicht (mehr).`;
    expect(refusalOf(resume(fresh.line, 'Anna', code))).toBe(unknown);
    const stranger = resume(fresh.line, 'Dora', code, blobOf(anna).blob);
    expect(refusalOf(stranger)).toBe('Wiederverbinden fehlgeschlagen — Raum neu beitreten.');
    // The room is back all the same, for its crew.
    expect(joinedOf(resume(fresh.line, 'Anna', code, blobOf(anna).blob)).code).toBe(code);
  });
});

describe('a snapshot refused, and the audience after a restore', () => {
  let log: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('refuses a snapshot a day old, of a run that is over, or one that does not open', () => {
    const { code, anna } = crewOn(server());
    const { blob } = blobOf(anna);
    const fresh = server();
    vi.advanceTimersByTime(SNAPSHOT_MAX_AGE_MS + 1);
    expect(refusalOf(resume(fresh.line, 'Anna', code, blob))).toBe(
      'Der Spielstand ist älter als einen Tag.',
    );
    expect(logged(log)).toContain(
      `[escapelab] room ${code}: not taken up again, its snapshot is over a day old`,
    );
    const changed = `${blob.slice(0, -4)}${blob.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA'}`;
    expect(refusalOf(resume(fresh.line, 'Anna', code, changed))).toBe(
      'Der Spielstand dieses Raums lässt sich nicht wiederherstellen.',
    );
    // A run that is over: its crew is handed no snapshot of it, and a sealed one is refused.
    const room = new Room(code, missions.get('blackout'));
    const { playerId } = room.join('Anna', passFor('Anna'));
    room.join('Ben', passFor('Ben'));
    room.abandon(passFor('Ben'));
    room.join('Cem', passFor('Cem'));
    room.setReady(playerId, true);
    const over = room.snapshot();
    const ended = { ...over, state: { ...over.state, phase: 'lost' as const } };
    expect(refusalOf(resume(fresh.line, 'Anna', code, seal(ended, code, KEY)))).toBe(
      'Dieser Einsatz ist schon vorbei.',
    );
    // Sealed for this code, of another room: refused.
    const elsewhere = seal({ ...over, code: 'ZZ99' }, code, KEY);
    expect(refusalOf(resume(fresh.line, 'Anna', code, elsewhere))).toBe(
      'Der Spielstand dieses Raums lässt sich nicht wiederherstellen.',
    );
    expect(fresh.manager.counts().total).toBe(0);
    room.dispose();
  });

  it('refuses a snapshot where the code has gone to another room meanwhile', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { code, anna } = crewOn(server());
    expect(code).toBe('AAAA');
    vi.advanceTimersByTime(30_000);
    const fresh = server();
    const cem = fresh.line.connect();
    cem.say({ kind: 'create-room', name: 'Cem', pass: passFor('Cem'), missionId: 'blackout' });
    expect(joinedOf(cem).code).toBe('AAAA');
    expect(refusalOf(resume(fresh.line, 'Anna', code, blobOf(anna).blob))).toBe(
      'Der Raumcode AAAA gehört inzwischen einem anderen Raum.',
    );
  });

  it('lets the audience watch once the room is back', () => {
    const { code, anna } = crewOn(server());
    const fresh = server();
    const early = fresh.line.connect();
    early.say({ kind: 'spectate', code });
    expect(refusalOf(early)).toBe(`Raum "${code}" existiert nicht (mehr).`);
    resume(fresh.line, 'Anna', code, blobOf(anna).blob);
    const later = fresh.line.connect();
    later.say({ kind: 'spectate', code });
    expect(later.heard.some((m) => m.kind === 'spectator-view')).toBe(true);
  });
});

/**
 * Anna and Ben in Blackout, handed the same snapshot; then Ben's line drops and only Anna is
 * handed the next one: Ben keeps the older, whose run stands still from its snapshot on, and
 * Anna the newer, whose run stood still from Ben's drop. Once the crew is back, the deadline
 * says which the room was taken up from: each moved on by its own pause.
 */
function apart() {
  const { code, anna, ben } = crewOn(server());
  const deadline = anna.view.deadlineAt ?? 0;
  vi.advanceTimersByTime(3000);
  ben.close();
  const dropAt = Date.now();
  vi.advanceTimersByTime(SNAPSHOT_EVERY_MS);
  const older = blobOf(ben);
  const newer = blobOf(anna);
  expect(newer.seq).toBeGreaterThan(older.seq);
  expect(older.at).toBeLessThan(dropAt);
  const takenFrom = (socket: FakeSocket): 'older' | 'newer' | number => {
    const shift = (socket.view.deadlineAt ?? 0) - deadline;
    if (shift === Date.now() - older.at) {
      return 'older';
    }
    return shift === Date.now() - dropAt ? 'newer' : shift;
  };
  return { code, older, newer, takenFrom };
}

describe('the race of the crew’s snapshots after a restore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('takes the newer up within 10 s of the restore, whoever is back staying seated', () => {
    const { code, older, newer, takenFrom } = apart();
    const fresh = server();
    const ben = resume(fresh.line, 'Ben', code, older.blob);
    vi.advanceTimersByTime(RESTORE_WINDOW_MS - 1);
    const anna = resume(fresh.line, 'Anna', code, newer.blob);
    for (const socket of [ben, anna]) {
      expect(socket.view.pausedFor).toBeNull();
      expect(takenFrom(socket)).toBe('newer');
    }
    expect(ben.heard.some((m) => m.kind === 'left')).toBe(false);
    // Anna's second tab, with the same snapshot: taken up once, not again.
    resume(fresh.line, 'Anna', code, newer.blob);
    const said = vi
      .mocked(console.log)
      .mock.calls.map(([line]) => String(line))
      .filter((line) => line.includes('taken up again from snapshot'));
    expect(said).toEqual([
      `[escapelab] room ${code}: taken up again from snapshot seq ${newer.seq}`,
    ]);
  });

  it('takes no newer one after 10 s, nor an older or equal one at any time', () => {
    const { code, older, newer, takenFrom } = apart();
    const fresh = server();
    resume(fresh.line, 'Ben', code, older.blob);
    vi.advanceTimersByTime(RESTORE_WINDOW_MS);
    expect(takenFrom(resume(fresh.line, 'Anna', code, newer.blob))).toBe('older');
    // The other way round: the newer first, the older ignored.
    const other = server();
    resume(other.line, 'Anna', code, newer.blob);
    expect(takenFrom(resume(other.line, 'Ben', code, older.blob))).toBe('newer');
  });

  it('takes no newer one once the crew has done something in the room', () => {
    const old = server();
    const anna = old.line.connect();
    anna.say({ kind: 'create-room', name: 'Anna', pass: passFor('Anna'), missionId: 'blackout' });
    const { code } = joinedOf(anna);
    const ben = old.line.connect();
    ben.say({ kind: 'join-room', code, name: 'Ben', pass: passFor('Ben') });
    vi.advanceTimersByTime(SNAPSHOT_EVERY_MS);
    ben.close();
    vi.advanceTimersByTime(SNAPSHOT_EVERY_MS);
    const older = blobOf(ben);
    const newer = blobOf(anna);
    const colourOf = (socket: FakeSocket): string | undefined =>
      socket.view.players.find((p) => p.name === 'Ben')?.color;
    const was = colourOf(anna);
    // Ben, back first, picks another colour in the lobby: the crew's deed.
    const fresh = server();
    const benBack = resume(fresh.line, 'Ben', code, older.blob);
    benBack.say({ kind: 'select-color', color: '#a78bfa' });
    const annaBack = resume(fresh.line, 'Anna', code, newer.blob);
    const replaced = (): string[] =>
      vi
        .mocked(console.log)
        .mock.calls.map(([line]) => String(line))
        .filter((line) => line.includes('taken up again from snapshot'));
    expect(was).not.toBe('#a78bfa');
    expect(colourOf(annaBack)).toBe('#a78bfa');
    expect(replaced()).toEqual([]);
    // Without the deed, the newer is taken up.
    const control = server();
    resume(control.line, 'Ben', code, older.blob);
    expect(colourOf(resume(control.line, 'Anna', code, newer.blob))).toBe(was);
    expect(replaced()).toEqual([
      `[escapelab] room ${code}: taken up again from snapshot seq ${newer.seq}`,
    ]);
  });
});

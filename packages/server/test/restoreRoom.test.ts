import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FIRST_WAIT_MS,
  SNAPSHOT_EVERY_MS,
  SNAPSHOT_LIVE_MS,
  SNAPSHOT_MAX_AGE_MS,
} from '@escapelab/core';
import { MissionCatalog } from '../src/missions.js';
import { RESTORE_WINDOW_MS, Room, type RunListener } from '../src/room.js';
import { HANDOVER_MS, RoomManager } from '../src/roomManager.js';
import { open, roomKey, seal } from '../src/seal.js';
import { serveSockets } from '../src/sockets.js';
import { FakeServer, joinedOf, type FakeSocket } from './line.js';
import { passFor } from './passes.js';

const T0 = 1_700_000_000_000;
const KEY = roomKey({ ROOM_SECRET: 'cafe'.repeat(16) }).key;
const missions = new MissionCatalog(fileURLToPath(new URL('../../../missions', import.meta.url)));

/**
 * A server as index.ts wires it, on fake sockets, sealing with KEY: an instance of its own, by
 * the id its snapshots name, every run that ends reported to `onRunFinished`.
 */
function server(onRunFinished: RunListener = () => undefined) {
  const line = new FakeServer();
  const instance = randomUUID();
  const manager = new RoomManager(onRunFinished, false, null, KEY, instance);
  serveSockets(line, { catalog: missions, manager });
  return { line, manager, instance };
}

/** What a socket that waits for its room has heard: that the room `code` is on its way back. */
const restoring = (code: string) => [{ kind: 'restoring', code }];

/** Three hours, ms: how long an instance has been up where that does not matter. */
const HOURS = 3 * 60 * 60 * 1000;

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

/** Every line the log said so far, the console listened to. */
const said = (): string[] => vi.mocked(console.log).mock.calls.map(([line]) => String(line));

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
    // The old server is gone without a word, its crew holding the snapshots they had: the new
    // one knows no room, and waits for the old one's last snapshot of it, which never comes.
    const kept = blobOf(anna);
    const bens = blobOf(ben);
    vi.advanceTimersByTime(20_000);
    const fresh = server();
    const annaBack = resume(fresh.line, 'Anna', code, kept.blob);
    expect(annaBack.heard).toEqual(restoring(code));
    vi.advanceTimersByTime(HANDOVER_MS);
    expect(joinedOf(annaBack).code).toBe(code);
    expect(annaBack.view).toMatchObject({
      phase: 'playing',
      pausedAt: kept.at,
      away: [{ name: 'Ben', since: kept.at }],
    });
    const age = ((Date.now() - kept.at) / 1000).toFixed(1);
    expect(logged(log)).toContain(
      `[escapelab] restored room ${code} from snapshot seq ${kept.seq} ` +
        `(2 seats, ${age} s old, after 90.0 s of waiting)`,
    );
    vi.advanceTimersByTime(4000);
    const benBack = resume(fresh.line, 'Ben', code, bens.blob);
    for (const socket of [annaBack, benBack]) {
      expect(socket.view.pausedAt).toBeNull();
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
    vi.advanceTimersByTime(HANDOVER_MS);
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
    const over = { ...room.snapshot(), instance: 'another', final: true };
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
    expect(later.heard).toEqual(restoring(code));
    vi.advanceTimersByTime(HANDOVER_MS);
    expect(later.heard.some((m) => m.kind === 'spectator-view')).toBe(true);
  });
});

/**
 * Anna and Ben in Blackout, handed the same snapshot; then Ben's line drops and only Anna is
 * handed the next one, the run going on through the drop: Ben keeps the older, Anna the newer.
 * A run taken up from a snapshot stands still from the moment it was taken, so once the crew is
 * back the deadline says which the room was taken up from — each moved on by the time since its
 * own; any other shift as it is.
 */
function apart() {
  const old = server();
  const { code, anna, ben } = crewOn(old);
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
    return shift === Date.now() - newer.at ? 'newer' : shift;
  };
  return { old, code, anna, older, newer, takenFrom };
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
    // Ben's older snapshot alone in the wait: the room is taken up from it once the wait is over.
    const ben = resume(fresh.line, 'Ben', code, older.blob);
    vi.advanceTimersByTime(HANDOVER_MS + RESTORE_WINDOW_MS - 1);
    const anna = resume(fresh.line, 'Anna', code, newer.blob);
    for (const socket of [ben, anna]) {
      expect(socket.view.pausedAt).toBeNull();
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

  it('takes no newer one after 10 s, logging the race lost, nor an older one at all', () => {
    const { code, older, newer, takenFrom } = apart();
    const fresh = server();
    resume(fresh.line, 'Ben', code, older.blob);
    vi.advanceTimersByTime(HANDOVER_MS + RESTORE_WINDOW_MS);
    expect(takenFrom(resume(fresh.line, 'Anna', code, newer.blob))).toBe('older');
    const late =
      `[escapelab] room ${code}: snapshot seq ${newer.seq} came too late, the room goes on ` +
      `from seq ${older.seq}`;
    expect(said().filter((line) => line.includes('came too late'))).toEqual([late]);
    // The other way round: the newer first, the older ignored — and no race lost to log.
    const other = server();
    resume(other.line, 'Anna', code, newer.blob);
    vi.advanceTimersByTime(HANDOVER_MS);
    expect(takenFrom(resume(other.line, 'Ben', code, older.blob))).toBe('newer');
    expect(said().filter((line) => line.includes('came too late'))).toEqual([late]);
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
    // Anna goes on in the lobby: a newer snapshot of it, which Ben's page has not.
    anna.say({ kind: 'select-difficulty', difficulty: 'hart' });
    vi.advanceTimersByTime(SNAPSHOT_EVERY_MS);
    const older = blobOf(ben);
    const newer = blobOf(anna);
    expect(newer.seq).toBeGreaterThan(older.seq);
    const colourOf = (socket: FakeSocket): string | undefined =>
      socket.view.players.find((p) => p.name === 'Ben')?.color;
    const was = colourOf(anna);
    // Ben, back first, picks another colour in the lobby once it is back: the crew's deed.
    const fresh = server();
    const benBack = resume(fresh.line, 'Ben', code, older.blob);
    vi.advanceTimersByTime(HANDOVER_MS);
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
    vi.advanceTimersByTime(HANDOVER_MS);
    expect(colourOf(resume(control.line, 'Anna', code, newer.blob))).toBe(was);
    expect(replaced()).toEqual([
      `[escapelab] room ${code}: taken up again from snapshot seq ${newer.seq}`,
    ]);
  });
});

describe('the handover: the new instance waits for the old one’s last snapshot', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps a resume waiting for the old one’s last word, a final 61 s on taken up', () => {
    // However long the new instance has been up: the wait runs from the room's own.
    const fresh = server();
    vi.advanceTimersByTime(HOURS);
    const { old, code, anna, older, takenFrom } = apart();
    // Ben's page, its line dropped after the switch, comes back to the new instance with his
    // older snapshot, while Anna plays on on the old one.
    const ben = resume(fresh.line, 'Ben', code, older.blob);
    expect(ben.heard).toEqual(restoring(code));
    expect(fresh.manager.counts().total).toBe(0);
    expect(said()).toContain(
      `[escapelab] room ${code}: snapshot seq ${older.seq} is not the last of instance ` +
        `${old.instance}, waiting up to 90.0 s for a newer one`,
    );
    // The old instance's minute is over: SIGTERM, and Anna is handed its last snapshot.
    vi.advanceTimersByTime(61_000);
    old.manager.shutDown(Date.now());
    const last = blobOf(anna);
    expect(ben.heard).toEqual(restoring(code));
    const annaBack = resume(fresh.line, 'Anna', code, last.blob);
    for (const socket of [ben, annaBack]) {
      expect(joinedOf(socket)).toEqual({ kind: 'joined', code });
      expect(socket.view.pausedAt).toBeNull();
      // Taken up from the last one: the run went on on the old instance until it went down.
      expect(takenFrom(socket)).toBe(Date.now() - last.at);
    }
    expect(said()).toContain(
      `[escapelab] restored room ${code} from snapshot seq ${last.seq} ` +
        '(2 seats, 0.0 s old, after 61.0 s of waiting)',
    );
  });

  it('takes the newest handed in up 90 s after the room began to wait, when none is final', () => {
    // An instance up for hours; the old one gone without a word: no last snapshot ever comes.
    const fresh = server();
    vi.advanceTimersByTime(HOURS);
    const { code, older, newer, takenFrom } = apart();
    const ben = resume(fresh.line, 'Ben', code, older.blob);
    vi.advanceTimersByTime(30_000);
    const anna = resume(fresh.line, 'Anna', code, newer.blob);
    vi.advanceTimersByTime(HANDOVER_MS - 30_000 - 1);
    for (const socket of [ben, anna]) {
      expect(socket.heard).toEqual(restoring(code));
    }
    vi.advanceTimersByTime(1);
    for (const socket of [ben, anna]) {
      expect(joinedOf(socket).code).toBe(code);
      expect(socket.view.pausedAt).toBeNull();
      expect(takenFrom(socket)).toBe('newer');
    }
    const age = ((Date.now() - newer.at) / 1000).toFixed(1);
    expect(said()).toContain(
      `[escapelab] restored room ${code} from snapshot seq ${newer.seq} ` +
        `(2 seats, ${age} s old, after 90.0 s of waiting)`,
    );
  });

  it('lets a newer snapshot replace the room within 10 s of taking it up after the wait', () => {
    const { code, older, newer, takenFrom } = apart();
    const fresh = server();
    const ben = resume(fresh.line, 'Ben', code, older.blob);
    vi.advanceTimersByTime(HANDOVER_MS + RESTORE_WINDOW_MS - 1);
    const anna = resume(fresh.line, 'Anna', code, newer.blob);
    for (const socket of [ben, anna]) {
      expect(takenFrom(socket)).toBe('newer');
    }
    expect(said()).toContain(
      `[escapelab] room ${code}: taken up again from snapshot seq ${newer.seq}`,
    );
  });
});

describe('the handover: who waits for the room, and who does not', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('takes a last snapshot of the old instance up at once, however long it has been up', () => {
    const fresh = server();
    vi.advanceTimersByTime(HOURS);
    const old = server();
    const { code, anna } = crewOn(old);
    old.manager.shutDown(Date.now());
    const back = resume(fresh.line, 'Anna', code, blobOf(anna).blob);
    expect(back.heard.some((m) => m.kind === 'restoring')).toBe(false);
    expect(joinedOf(back).code).toBe(code);
  });

  it('keeps the audience, and a resume with no snapshot, waiting with the crew', () => {
    const { old, code, anna, older } = apart();
    const fresh = server();
    resume(fresh.line, 'Ben', code, older.blob);
    const audience = fresh.line.connect();
    audience.say({ kind: 'spectate', code });
    // A second tab of Anna's, its browser keeping no snapshot.
    const tab = resume(fresh.line, 'Anna', code);
    for (const socket of [audience, tab]) {
      expect(socket.heard).toEqual(restoring(code));
    }
    old.manager.shutDown(Date.now());
    resume(fresh.line, 'Anna', code, blobOf(anna).blob);
    expect(audience.heard.some((m) => m.kind === 'spectator-view')).toBe(true);
    expect(joinedOf(tab).code).toBe(code);
  });

  it('gives a seat up that waits for its room once the room is back, and seats it not', () => {
    const { old, code, anna, older } = apart();
    const fresh = server();
    // The card on Ben's join screen goes back to the run, and gives it up while it waits.
    const ben = resume(fresh.line, 'Ben', code, older.blob);
    ben.say({ kind: 'abandon', code, pass: passFor('Ben') });
    expect(ben.heard).toEqual([...restoring(code), ...restoring(code)]);
    old.manager.shutDown(Date.now());
    resume(fresh.line, 'Anna', code, blobOf(anna).blob);
    expect(ben.heard.some((m) => m.kind === 'joined')).toBe(false);
    expect(ben.heard.at(-1)).toEqual({ kind: 'left', code, message: null });
    expect(fresh.manager.whereIs(passFor('Ben'))).toBeNull();
  });

  it('seats a socket that waited once, and none that closed while it waited', () => {
    const { old, code, anna, older } = apart();
    const fresh = server();
    // Ben's page asks twice on one socket; a tab of Anna's waits too, then is closed.
    const ben = resume(fresh.line, 'Ben', code, older.blob);
    ben.say({ kind: 'resume', code, pass: passFor('Ben'), blob: older.blob });
    const tab = resume(fresh.line, 'Anna', code);
    tab.close();
    old.manager.shutDown(Date.now());
    const annaBack = resume(fresh.line, 'Anna', code, blobOf(anna).blob);
    expect(ben.heard.filter((m) => m.kind === 'joined')).toHaveLength(1);
    expect(tab.heard).toEqual(restoring(code));
    expect(annaBack.view.pausedAt).toBeNull();
  });

  it('gives the code it waits for to no new room, and refuses a snapshot of another', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { code, anna } = crewOn(server());
    expect(code).toBe('AAAA');
    const fresh = server();
    resume(fresh.line, 'Anna', code, blobOf(anna).blob);
    // Cem opens a room: the first code drawn is the one waited for, so his is the next.
    let draws = 0;
    vi.mocked(Math.random).mockImplementation(() => (draws++ < 4 ? 0 : 1.5 / 31));
    const cem = fresh.line.connect();
    cem.say({ kind: 'create-room', name: 'Cem', pass: passFor('Cem'), missionId: 'blackout' });
    expect(joinedOf(cem).code).toBe('BBBB');
    // A last snapshot of another room of the code, made since: refused, the room still awaited.
    const other = new Room(code, missions.get('blackout'));
    other.join('Dora', passFor('Dora'));
    const elsewhere = seal({ ...other.snapshot(), instance: 'another', final: true }, code, KEY);
    expect(refusalOf(resume(fresh.line, 'Dora', code, elsewhere))).toBe(
      'Der Raumcode AAAA gehört inzwischen einem anderen Raum.',
    );
    expect(fresh.manager.waitsFor(code)).toBe(true);
    other.dispose();
  });
});

describe('the handover: a join by code while the room waits', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('is told to come again in a moment, and is the room’s to answer once it is back', () => {
    const { old, code, anna, older } = apart();
    const fresh = server();
    resume(fresh.line, 'Ben', code, older.blob);
    const dora = fresh.line.connect();
    const join = { kind: 'join-room', code, name: 'Dora', pass: passFor('Dora') } as const;
    dora.say(join);
    const restoringRoom = 'Der Raum wird gerade wiederhergestellt, gleich noch einmal.';
    expect(dora.heard).toEqual([{ kind: 'error', message: restoringRoom, of: 'join-room' }]);
    old.manager.shutDown(Date.now());
    resume(fresh.line, 'Anna', code, blobOf(anna).blob);
    dora.say(join);
    expect(dora.heard).toHaveLength(2);
    expect(dora.heard.at(-1)).not.toMatchObject({ message: restoringRoom });
  });
});

describe('the handover gone wrong', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('lets nobody wait on for a room it could not take up after the wait', () => {
    const { code, older, newer, takenFrom } = apart();
    const fresh = server();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ben = resume(fresh.line, 'Ben', code, older.blob);
    const anna = resume(fresh.line, 'Anna', code, newer.blob);
    vi.spyOn(Room, 'restore').mockImplementationOnce(() => {
      throw new Error('a broken snapshot');
    });
    vi.advanceTimersByTime(HANDOVER_MS);
    expect(error.mock.calls).toEqual([
      [`[escapelab] room ${code}: not taken up again, Error: a broken snapshot`],
    ]);
    // Each resume goes again and waits anew: 90 s on, the room is back from what they kept.
    for (const socket of [ben, anna]) {
      expect(socket.heard).toEqual([...restoring(code), ...restoring(code)]);
    }
    vi.advanceTimersByTime(HANDOVER_MS);
    for (const socket of [ben, anna]) {
      expect(joinedOf(socket).code).toBe(code);
      expect(takenFrom(socket)).toBe('newer');
    }
  });
});

/** Long enough for an empty room to be closed (roomManager.ts EMPTY_ROOM_TTL_MS), ms. */
const EMPTY_LONG_ENOUGH = 10 * 60_000 + 1;

describe('a room closed, and the ghosts its snapshots would bring back', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('refuses the snapshot of a run that was over when its room was closed', () => {
    const old = server();
    const { code, anna, ben } = crewOn(old);
    // Ben's line drops, his page keeping its snapshot; Anna calls the run off once she may.
    const kept = blobOf(ben);
    ben.close();
    vi.advanceTimersByTime(FIRST_WAIT_MS);
    anna.say({ kind: 'call-off' });
    expect(anna.view.phase).toBe('lost');
    anna.close();
    old.manager.sweep(Date.now() + EMPTY_LONG_ENOUGH);
    expect(old.manager.counts().total).toBe(0);
    expect(refusalOf(resume(old.line, 'Ben', code, kept.blob))).toBe('Dieser Einsatz ist beendet.');
    expect(said()).toContain(
      `[escapelab] room ${code}: not taken up again, its run was over when its room was closed`,
    );
    expect(old.manager.counts().total).toBe(0);
  });

  it('refuses the snapshot of a room closed standing empty, until a day after', () => {
    const old = server();
    const { code, anna, ben } = crewOn(old);
    const kept = blobOf(anna);
    anna.close();
    ben.close();
    const closedAt = Date.now() + EMPTY_LONG_ENOUGH;
    old.manager.sweep(closedAt);
    expect(refusalOf(resume(old.line, 'Anna', code, kept.blob))).toBe(
      'Der Raum stand 10 Minuten leer und wurde geschlossen.',
    );
    // A day on its tombstone goes, and its snapshots are refused for their age alone.
    old.manager.sweep(closedAt + SNAPSHOT_MAX_AGE_MS + 1);
    vi.setSystemTime(closedAt + SNAPSHOT_MAX_AGE_MS + 1);
    expect(refusalOf(resume(old.line, 'Anna', code, kept.blob))).toBe(
      'Der Spielstand ist älter als einen Tag.',
    );
  });

  it('binds no pass to a room taken up again that it has not come back to', () => {
    const { code, ben } = crewOn(server());
    const fresh = server();
    const anna = resume(fresh.line, 'Anna', code, blobOf(ben).blob);
    vi.advanceTimersByTime(HANDOVER_MS);
    const where = (name: string) => {
      const socket = fresh.line.connect();
      socket.say({ kind: 'whereami', pass: passFor(name) });
      return socket.heard.find((m) => m.kind === 'seated');
    };
    expect(where('Ben')).toEqual({ kind: 'seated', seat: null });
    // Ben opens a room of his own: nothing keeps him, and his seat in the run stays.
    const own = fresh.line.connect();
    own.say({ kind: 'create-room', name: 'Ben', pass: passFor('Ben'), missionId: 'blackout' });
    expect(joinedOf(own).code).not.toBe(code);
    expect(anna.view.players.map((p) => p.name)).toEqual(['Anna', 'Ben']);
    // Anna came back to it: the run binds her, and keeps her from another room.
    expect(where('Anna')).toMatchObject({ seat: { code, phase: 'playing' } });
    const away = fresh.line.connect();
    away.say({ kind: 'create-room', name: 'Anna', pass: passFor('Anna'), missionId: 'blackout' });
    expect(refusalOf(away)).toBe(`Gebunden an den Einsatz „Blackout im Labor“ in Raum ${code}.`);
    // Once Ben is back, it binds him as well.
    resume(fresh.line, 'Ben', code, blobOf(ben).blob);
    expect(where('Ben')).toMatchObject({ seat: { code, phase: 'playing' } });
  });

  it('reports no run a ghost calls off, but one its crew came back to', () => {
    const { code, anna, ben } = crewOn(server());
    // Ben's stale page brings the run back alone, and calls it off once he may.
    const reported = vi.fn();
    const ghost = server(reported);
    const lone = resume(ghost.line, 'Ben', code, blobOf(ben).blob);
    vi.advanceTimersByTime(HANDOVER_MS + FIRST_WAIT_MS);
    lone.say({ kind: 'call-off' });
    expect(lone.view.phase).toBe('lost');
    expect(reported).not.toHaveBeenCalled();
    expect(said()).toContain(
      `[escapelab] room ${code}: not counted: none of its crew but who gave it up came back ` +
        'after the restore',
    );
    // Both back, then Anna gives up: the run is the crew's, and reported.
    const crew = server(reported);
    resume(crew.line, 'Anna', code, blobOf(anna).blob);
    resume(crew.line, 'Ben', code, blobOf(ben).blob);
    vi.advanceTimersByTime(HANDOVER_MS);
    const annaAgain = crew.line.connect();
    annaAgain.say({ kind: 'abandon', code, pass: passFor('Anna') });
    expect(reported).toHaveBeenCalledTimes(1);
    expect(reported.mock.calls[0]?.[0]).toMatchObject({ report: { outcome: 'lost:abandoned' } });
  });
});

describe('a seat whose line dropped while the run went on', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('comes back with the snapshot it kept into the run that went on, which it changes not', () => {
    const old = server();
    const { code, anna, ben } = crewOn(old);
    const kept = blobOf(ben);
    ben.close();
    vi.advanceTimersByTime(30_000);
    // The run went on: Anna's page was handed snapshots of it meanwhile, newer than Ben's.
    expect(blobOf(anna).at).toBeGreaterThan(kept.at);
    const back = resume(old.line, 'Ben', code, kept.blob);
    expect(joinedOf(back).code).toBe(code);
    expect(back.view).toMatchObject({ phase: 'playing', pausedAt: null, away: [] });
    expect(back.view.deadlineAt).toBe(anna.view.deadlineAt);
    expect(anna.view.away).toEqual([]);
  });

  it('stays away in the crew’s snapshots: a room taken up from one goes on without it', () => {
    const old = server();
    const { code, anna, ben } = crewOn(old);
    const benId = ben.view.you.id;
    ben.close();
    const dropAt = Date.now();
    vi.advanceTimersByTime(SNAPSHOT_LIVE_MS + 100);
    const last = blobOf(anna);
    expect(last.at).toBeGreaterThan(dropAt);
    const { state } = open(last.blob, code, KEY);
    // Ben's drop as it was; Anna, on the line, gone with the server the snapshot stands for.
    expect(state.away[benId]).toEqual({
      since: dropAt,
      waivableAt: dropAt + FIRST_WAIT_MS,
      waived: false,
    });
    expect(state.away[anna.view.you.id]).toMatchObject({ since: last.at, maintenance: true });
    expect(state.paused).toEqual({ since: last.at, kind: 'wartung' });
    // The old server gone without a word: a new one takes the room up from Anna's newest, and
    // the run goes on with Anna back, Ben away as before.
    vi.advanceTimersByTime(5000);
    const fresh = server();
    const annaBack = resume(fresh.line, 'Anna', code, last.blob);
    vi.advanceTimersByTime(HANDOVER_MS);
    expect(annaBack.view).toMatchObject({
      phase: 'playing',
      pausedAt: null,
      away: [{ name: 'Ben', since: dropAt, waivableAt: dropAt + FIRST_WAIT_MS }],
    });
    const benBack = resume(fresh.line, 'Ben', code);
    for (const socket of [annaBack, benBack]) {
      expect(socket.view).toMatchObject({ pausedAt: null, away: [] });
    }
  });
});

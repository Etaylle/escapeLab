import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMission, type Mission, type ServerMessage } from '@escapelab/core';
import { HEARTBEAT_MS, startHeartbeat } from '../src/heartbeat.js';
import { RoomManager } from '../src/roomManager.js';
import { serveSockets } from '../src/sockets.js';
import { FakeServer, joinedOf, ROUND_TRIP_MS, type FakeSocket } from './line.js';
import { passFor } from './passes.js';

/** The tutorial, for two. */
const mission: Mission = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/systemcheck.json', import.meta.url), 'utf8')),
);

/**
 * Anna and Ben on a socket each, served as the server serves them, the heartbeat beating,
 * the tutorial running; `end` disposes of the room and stops the heartbeat.
 */
function startedRun() {
  const server = new FakeServer();
  const manager = new RoomManager();
  serveSockets(server, { catalog: { get: () => mission, default: mission }, manager });
  const stop = startHeartbeat(server);
  const anna = server.connect();
  anna.say({ kind: 'create-room', name: 'Anna', pass: passFor('Anna'), missionId: mission.id });
  const { code } = joinedOf(anna);
  const ben = server.connect();
  ben.say({ kind: 'join-room', code, name: 'Ben', pass: passFor('Ben') });
  ben.say({ kind: 'set-ready', ready: true });
  anna.say({ kind: 'start-mission' });
  expect(anna.view.phase).toBe('playing');
  const end = (): void => {
    manager.get(code).dispose();
    stop();
  };
  return { server, anna, ben, code, end };
}

/** A new socket of Ben's resuming his place by his pass, as his page does after reconnecting. */
function resumeBen(server: FakeServer, ben: FakeSocket): FakeSocket {
  const { code } = joinedOf(ben);
  const back = server.connect();
  back.say({ kind: 'resume', code, pass: passFor('Ben') });
  return back;
}

describe('the heartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pings every socket every 10 s and keeps the ones that answer', () => {
    const { server, anna, ben, end } = startedRun();
    const browsing = server.connect();
    vi.advanceTimersByTime(10 * HEARTBEAT_MS + ROUND_TRIP_MS);
    for (const socket of [anna, ben, browsing]) {
      expect(socket.pings).toBe(10);
      expect(socket.terminated).toBe(false);
    }
    expect(anna.view.pausedFor).toBeNull();
    end();
  });

  it('ends a socket gone silent at its second missed pong, the run paused within 30 s', () => {
    const { anna, ben, end } = startedRun();
    vi.advanceTimersByTime(HEARTBEAT_MS + ROUND_TRIP_MS);
    // Ben's line goes dead right after his first pong: the longest the server can be fooled.
    ben.answering = false;
    const silentSince = Date.now();
    vi.advanceTimersByTime(2 * HEARTBEAT_MS);
    // The beat at 20 s pinged him, the one at 30 s found that ping missed and pinged again.
    expect(ben.pings).toBe(3);
    expect(ben.terminated).toBe(false);
    expect(anna.view.pausedFor).toBeNull();
    vi.advanceTimersByTime(HEARTBEAT_MS - ROUND_TRIP_MS - 1);
    expect(ben.terminated).toBe(false);
    vi.advanceTimersByTime(1);
    expect(ben.terminated).toBe(true);
    expect(anna.view.pausedFor?.map((away) => away.name)).toEqual(['Ben']);
    expect(Date.now() - silentSince).toBeLessThanOrEqual(30_000);
    expect(anna.terminated).toBe(false);
    end();
  });

  it('forgives a single missed pong: only two in a row end a socket', () => {
    const { ben, end } = startedRun();
    vi.advanceTimersByTime(HEARTBEAT_MS + ROUND_TRIP_MS);
    ben.answering = false;
    vi.advanceTimersByTime(HEARTBEAT_MS);
    ben.answering = true;
    vi.advanceTimersByTime(6 * HEARTBEAT_MS);
    expect(ben.terminated).toBe(false);
    end();
  });

  it('unpauses the run once the player is back on a new socket, which it keeps', () => {
    const { server, anna, ben, end } = startedRun();
    ben.answering = false;
    vi.advanceTimersByTime(3 * HEARTBEAT_MS);
    expect(ben.terminated).toBe(true);
    expect(anna.view.pausedFor?.map((away) => away.name)).toEqual(['Ben']);
    const back = resumeBen(server, ben);
    expect(joinedOf(back).code).toBe(joinedOf(ben).code);
    expect(back.view.you.id).toBe(ben.view.you.id);
    expect(anna.view.pausedFor).toBeNull();
    expect(back.view.pausedFor).toBeNull();
    vi.advanceTimersByTime(5 * HEARTBEAT_MS);
    expect(back.terminated).toBe(false);
    expect(anna.view.pausedFor).toBeNull();
    end();
  });

  it('leaves a player in the run who came back before the old socket was found dead', () => {
    const { server, anna, ben, end } = startedRun();
    // Ben's page saw its line drop and reconnected; the server still holds the old socket.
    ben.answering = false;
    const back = resumeBen(server, ben);
    vi.advanceTimersByTime(3 * HEARTBEAT_MS);
    expect(ben.terminated).toBe(true);
    expect(anna.view.pausedFor).toBeNull();
    expect(anna.view.players.find((p) => p.name === 'Ben')?.connected).toBe(true);
    anna.say({ kind: 'ping', x: 3, y: 3 });
    expect(back.heard.at(-1)).toMatchObject({ kind: 'ping', x: 3, y: 3 });
    end();
  });

  it('lets a silent audience go without pausing the run', () => {
    const { server, anna, code, end } = startedRun();
    const audience = server.connect();
    audience.say({ kind: 'spectate', code });
    audience.answering = false;
    vi.advanceTimersByTime(3 * HEARTBEAT_MS);
    expect(audience.terminated).toBe(true);
    const heard = audience.heard.length;
    anna.say({ kind: 'ping', x: 3, y: 3 });
    expect(audience.heard).toHaveLength(heard);
    expect(anna.view.pausedFor).toBeNull();
    end();
  });

  it('stops beating when asked', () => {
    const { anna, end } = startedRun();
    end();
    vi.advanceTimersByTime(5 * HEARTBEAT_MS);
    expect(anna.pings).toBe(0);
  });
});

/** The latest view message `socket` was sent, stamp and all. */
function lastViewOf(socket: FakeSocket): Extract<ServerMessage, { kind: 'view' }> {
  const last = socket.heard.filter((m) => m.kind === 'view').at(-1);
  if (last?.kind !== 'view') {
    throw new Error('this socket was sent no view');
  }
  return last;
}

/** What a page shows on the mission's clock at server time `now` by its latest view, ms. */
function clockOf(socket: FakeSocket, now: number): number {
  const { deadlineAt, pausedAt } = socket.view;
  if (deadlineAt === null) {
    throw new Error('the run has no clock');
  }
  return deadlineAt - (pausedAt ?? now);
}

describe('the server’s clock on the line', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers an ask for its time with the page’s own and its own, in a room or not', () => {
    const server = new FakeServer();
    const lab = { catalog: { get: () => mission, default: mission }, manager: new RoomManager() };
    serveSockets(server, lab);
    const page = server.connect();
    page.say({ kind: 'clock', sent: 42.5 });
    expect(page.heard).toEqual([{ kind: 'clock', sent: 42.5, at: 1_700_000_000_000 }]);
  });

  it('stamps every view with its time as it goes out', () => {
    const { anna, ben, end } = startedRun();
    expect(lastViewOf(anna).at).toBe(1_700_000_000_000);
    ben.answering = false;
    vi.advanceTimersByTime(3 * HEARTBEAT_MS);
    expect(anna.view.pausedFor?.map((away) => away.name)).toEqual(['Ben']);
    expect(lastViewOf(anna).at).toBe(Date.now());
    end();
  });

  it('says since when a run stands paused: its clock reads the same then, through, after', () => {
    const { server, anna, ben, end } = startedRun();
    vi.advanceTimersByTime(HEARTBEAT_MS + 5);
    ben.answering = false;
    vi.advanceTimersByTime(3 * HEARTBEAT_MS);
    expect(anna.view.pausedAt).toBe(lastViewOf(anna).at);
    const atPause = clockOf(anna, Date.now());
    vi.advanceTimersByTime(20_000);
    expect(clockOf(anna, Date.now())).toBe(atPause);
    resumeBen(server, ben);
    expect(anna.view.pausedAt).toBeNull();
    expect(clockOf(anna, Date.now())).toBe(atPause);
    vi.advanceTimersByTime(1_000);
    expect(clockOf(anna, Date.now())).toBe(atPause - 1_000);
    end();
  });
});

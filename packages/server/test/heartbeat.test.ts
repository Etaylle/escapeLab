import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseMission,
  type ClientMessage,
  type Mission,
  type PlayerView,
  type ServerMessage,
} from '@escapelab/core';
import { HEARTBEAT_MS, startHeartbeat } from '../src/heartbeat.js';
import { RoomManager } from '../src/roomManager.js';
import { serveSockets } from '../src/sockets.js';

/** How long a pong takes to come back, ms: the line's round trip. */
const ROUND_TRIP_MS = 40;

/** The tutorial, for two. */
const mission: Mission = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/systemcheck.json', import.meta.url), 'utf8')),
);

/**
 * A client's socket as the server sees it: it says what the client sends, answers a ping a
 * round trip later while `answering` — as a browser does on its own — and on `terminate`
 * leaves the server's clients and closes, as `ws` closes a socket it destroys.
 */
class FakeSocket extends EventEmitter {
  readonly heard: ServerMessage[] = [];
  answering = true;
  pings = 0;
  terminated = false;

  constructor(private readonly server: FakeServer) {
    super();
  }

  send(data: string): void {
    this.heard.push(JSON.parse(data) as ServerMessage);
  }

  ping(): void {
    this.pings += 1;
    setTimeout(() => {
      if (this.answering) {
        this.emit('pong');
      }
    }, ROUND_TRIP_MS);
  }

  terminate(): void {
    this.terminated = true;
    this.server.clients.delete(this);
    this.emit('close');
  }

  /** The client sends `msg`. */
  say(msg: ClientMessage): void {
    this.emit('message', Buffer.from(JSON.stringify(msg)));
  }

  /** The latest view this socket was sent. */
  get view(): PlayerView {
    const last = this.heard.filter((m) => m.kind === 'view').at(-1);
    if (last?.kind !== 'view') {
      throw new Error('this socket was sent no view');
    }
    return last.view;
  }
}

/** The WebSocket server and its open sockets, as `ws` keeps them. */
class FakeServer extends EventEmitter {
  readonly clients = new Set<FakeSocket>();

  /** A client connects. */
  connect(): FakeSocket {
    const socket = new FakeSocket(this);
    this.clients.add(socket);
    this.emit('connection', socket);
    return socket;
  }
}

/** What the server handed a player on joining, for resuming. */
type Joined = Extract<ServerMessage, { kind: 'joined' }>;

function joinedOf(socket: FakeSocket): Joined {
  const joined = socket.heard.find((m): m is Joined => m.kind === 'joined');
  if (joined === undefined) {
    throw new Error('this socket never joined a room');
  }
  return joined;
}

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
  anna.say({ kind: 'create-room', name: 'Anna', missionId: mission.id });
  const { code } = joinedOf(anna);
  const ben = server.connect();
  ben.say({ kind: 'join-room', code, name: 'Ben' });
  ben.say({ kind: 'set-ready', ready: true });
  anna.say({ kind: 'start-mission' });
  expect(anna.view.phase).toBe('playing');
  const end = (): void => {
    manager.get(code).dispose();
    stop();
  };
  return { server, anna, ben, code, end };
}

/** A new socket of Ben's resuming his place, as his page does after reconnecting. */
function resumeBen(server: FakeServer, ben: FakeSocket): FakeSocket {
  const { code, playerId, token } = joinedOf(ben);
  const back = server.connect();
  back.say({ kind: 'resume', code, playerId, token });
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
    expect(anna.view.pausedFor).toEqual(['Ben']);
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
    expect(anna.view.pausedFor).toEqual(['Ben']);
    const back = resumeBen(server, ben);
    expect(joinedOf(back).playerId).toBe(joinedOf(ben).playerId);
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

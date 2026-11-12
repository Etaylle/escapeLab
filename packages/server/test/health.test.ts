import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { healthResponse, versionOf, type Health } from '../src/api.js';
import { MissionCatalog } from '../src/missions.js';
import { RoomManager } from '../src/roomManager.js';
import { serveSockets } from '../src/sockets.js';
import { FakeServer, joinedOf, type FakeSocket } from './line.js';
import { passFor } from './passes.js';

/** The shipped missions: the Systemcheck for two, Blackout for two or three. */
const shipped = new MissionCatalog(fileURLToPath(new URL('../../../missions', import.meta.url)));

/**
 * A room of `missionId` its first name opens and the rest join, each on a socket of their own;
 * the run started where `go`.
 */
function roomOf(line: FakeServer, missionId: string, names: string[], go: boolean) {
  const sockets: FakeSocket[] = [];
  let code = '';
  for (const name of names) {
    const socket = line.connect();
    const pass = passFor(name);
    socket.say(
      code === ''
        ? { kind: 'create-room', name, pass, missionId }
        : { kind: 'join-room', code, name, pass },
    );
    code = joinedOf(socket).code;
    sockets.push(socket);
  }
  if (go) {
    for (const socket of sockets.slice(1)) {
      socket.say({ kind: 'set-ready', ready: true });
    }
    sockets[0]?.say({ kind: 'start-mission' });
  }
  return { code, sockets };
}

describe('GET /health', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('counts the rooms, the runs on and paused, the players and the audience: no names', () => {
    const line = new FakeServer();
    const manager = new RoomManager();
    serveSockets(line, { catalog: shipped, manager });
    const lobby = roomOf(line, 'systemcheck', ['Anna', 'Ben'], false);
    // A run for three, Emil's line gone: it waits for him, and somebody watches.
    const waiting = roomOf(line, 'blackout', ['Cem', 'Dora', 'Emil'], true);
    waiting.sockets[2]?.close();
    line.connect().say({ kind: 'spectate', code: waiting.code });
    const running = roomOf(line, 'systemcheck', ['Finn', 'Gus'], true);
    // A lobby whose one player's line closed: a room, nobody on the line.
    const left = roomOf(line, 'systemcheck', ['Hana'], false);
    left.sockets[0]?.close();
    const health: Health = {
      rooms: () => manager.counts(),
      uptimeSec: () => 42,
      version: 'c0ffee',
    };
    const answer = healthResponse(shipped, health, '/health');
    expect(answer).toEqual({
      status: 200,
      body: {
        ok: true,
        missions: shipped.all.map((m) => m.id),
        rooms: { total: 4, running: 2, paused: 1, players: 6, spectators: 1 },
        uptimeSec: 42,
        version: 'c0ffee',
      },
    });
    const said = JSON.stringify(answer);
    for (const name of ['Anna', 'Ben', 'Cem', 'Dora', 'Emil', 'Finn', 'Gus', 'Hana']) {
      expect(said).not.toContain(name);
    }
    for (const { code } of [lobby, waiting, running, left]) {
      expect(said).not.toContain(code);
      manager.get(code).dispose();
    }
  });

  it('answers /health alone, with or without a query, and leaves every other path be', () => {
    const none = new RoomManager();
    const health: Health = { rooms: () => none.counts(), uptimeSec: () => 0, version: 'dev' };
    expect(healthResponse(shipped, health, '/health?probe=1')?.body).toMatchObject({
      ok: true,
      rooms: { total: 0, running: 0, paused: 0, players: 0, spectators: 0 },
    });
    for (const path of ['/missions', '/healthz', '/stats', '/']) {
      expect(healthResponse(shipped, health, path), path).toBeNull();
    }
  });

  it('names the build Render deployed, else dev', () => {
    expect(versionOf({ RENDER_GIT_COMMIT: '3f2a9c1' })).toBe('3f2a9c1');
    expect(versionOf({})).toBe('dev');
    expect(versionOf({ RENDER_GIT_COMMIT: '' })).toBe('dev');
  });
});

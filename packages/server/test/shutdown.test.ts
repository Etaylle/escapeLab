import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESTART_CLOSE, type ServerMessage } from '@escapelab/core';
import { MissionCatalog } from '../src/missions.js';
import { Room } from '../src/room.js';
import { RoomManager } from '../src/roomManager.js';
import { open, roomKey } from '../src/seal.js';
import { CLOSING_MS, onSignal, shutDown } from '../src/shutdown.js';
import { serveSockets } from '../src/sockets.js';
import { FakeServer, joinedOf, type FakeSocket } from './line.js';
import { passFor } from './passes.js';

const T0 = 1_700_000_000_000;
const KEY = roomKey({ ROOM_SECRET: 'beef'.repeat(16) }).key;
const missions = new MissionCatalog(fileURLToPath(new URL('../../../missions', import.meta.url)));

/**
 * The server as index.ts wires it, on fake sockets: Anna and Ben in a run of Blackout, Cem in a
 * lobby of his own, and somebody watching the run.
 */
function server() {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const line = new FakeServer();
  const manager = new RoomManager(undefined, false, null, KEY, 'going-down');
  serveSockets(line, { catalog: missions, manager });
  const sitDown = (name: string, code?: string): FakeSocket => {
    const socket = line.connect();
    const pass = passFor(name);
    socket.say(
      code === undefined
        ? { kind: 'create-room', name, pass, missionId: 'blackout' }
        : { kind: 'join-room', code, name, pass },
    );
    return socket;
  };
  const anna = sitDown('Anna');
  const { code } = joinedOf(anna);
  const ben = sitDown('Ben', code);
  ben.say({ kind: 'set-ready', ready: true });
  anna.say({ kind: 'start-mission' });
  const cem = sitDown('Cem');
  const audience = line.connect();
  audience.say({ kind: 'spectate', code });
  return { line, manager, code, anna, ben, cem, audience };
}

/** Where in the order of every call to a spy the first call matching `pick` came; NaN for none. */
function firstCall<A extends unknown[]>(
  spy: { mock: { calls: A[]; invocationCallOrder: number[] } },
  pick: (...args: A) => boolean = () => true,
): number {
  const index = spy.mock.calls.findIndex((args) => pick(...args));
  return spy.mock.invocationCallOrder[index] ?? Number.NaN;
}

const said = (data: unknown): ServerMessage => JSON.parse(String(data)) as ServerMessage;

describe('the server going down for a restart', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stops taking, pauses each run, seals and sends its snapshot, closes, then exits 0', () => {
    const { line, manager, code, anna, ben, cem, audience } = server();
    vi.advanceTimersByTime(5000);
    const sockets = [anna, ben, cem, audience];
    const sends = sockets.map((socket) => vi.spyOn(socket, 'send'));
    const closes = sockets.map((socket) => vi.spyOn(socket, 'close'));
    const snapshot = vi.spyOn(Room.prototype, 'snapshot');
    const stopTaking = vi.fn();
    const exit = vi.fn();
    shutDown({ stopTaking, sockets: () => line.clients, manager, exit });
    const [annaSend, , cemSend, audienceSend] = sends as [
      (typeof sends)[number],
      (typeof sends)[number],
      (typeof sends)[number],
      (typeof sends)[number],
    ];
    const paused = firstCall(annaSend, (data) => {
      const msg = said(data);
      return msg.kind === 'view' && msg.view.maintenance === true;
    });
    const restart = firstCall(annaSend, (data) => said(data).kind === 'restart');
    const order = [
      firstCall(stopTaking),
      paused,
      firstCall(snapshot),
      restart,
      Math.min(...closes.map((close) => firstCall(close))),
      firstCall(exit),
    ];
    expect(order.every(Number.isFinite)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(exit.mock.calls).toEqual([[0]]);
    // Every socket closed with Service Restart, and none is left.
    for (const close of closes) {
      expect(close.mock.calls[0]?.[0]).toBe(RESTART_CLOSE);
    }
    expect(line.clients.size).toBe(0);
    // Each seat holds its room's last snapshot: the run standing still for the whole crew, sealed
    // as this instance's last of the room.
    for (const socket of [anna, ben]) {
      const last = socket.heard.filter((m) => m.kind === 'restart').at(-1);
      const kept = open(last?.kind === 'restart' ? last.blob : '', code, KEY);
      expect(kept.state).toMatchObject({ phase: 'playing', paused: { kind: 'wartung' } });
      expect(kept.seq).toBe(last?.kind === 'restart' ? last.seq : -1);
      expect(kept).toMatchObject({ instance: 'going-down', final: true });
    }
    expect(cemSend.mock.calls.map(([data]) => said(data).kind)).toContain('restart');
    expect(audienceSend.mock.calls.map(([data]) => said(data).kind)).not.toContain('restart');
  });

  it('exits 0 all the same once CLOSING_MS is over, cutting a socket that would not close', () => {
    const { line, manager, anna } = server();
    // Anna's end of the line never answers the closing frame.
    const stuck = vi.spyOn(anna, 'close').mockImplementation(() => undefined);
    const cut = vi.spyOn(anna, 'terminate');
    const exit = vi.fn();
    shutDown({ stopTaking: () => undefined, sockets: () => line.clients, manager, exit });
    expect(stuck).toHaveBeenCalledWith(RESTART_CLOSE, 'Server startet neu');
    vi.advanceTimersByTime(CLOSING_MS - 100);
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(cut).toHaveBeenCalled();
    expect(exit.mock.calls).toEqual([[0]]);
    expect(CLOSING_MS).toBeLessThan(10_000);
  });

  it('goes down once, whatever signals come: a Ctrl-C twice, then SIGTERM', () => {
    const { line, manager, anna } = server();
    vi.spyOn(anna, 'close').mockImplementation(() => undefined);
    const stopTaking = vi.fn();
    const exit = vi.fn();
    const goDown = onSignal({ stopTaking, sockets: () => line.clients, manager, exit });
    // Under `pnpm dev` a Ctrl-C comes from the terminal and again from tsx watch.
    goDown('SIGINT');
    goDown('SIGINT');
    goDown('SIGTERM');
    expect(stopTaking).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CLOSING_MS);
    expect(exit.mock.calls).toEqual([[0]]);
    const said = vi.mocked(console.log).mock.calls.map(([logged]) => String(logged));
    expect(said.filter((logged) => logged.includes('going down'))).toEqual([
      '[escapelab] SIGINT: going down for a restart',
      expect.stringContaining('going down for a restart, snapshot seq'),
      expect.stringContaining('going down for a restart, '),
      '[escapelab] SIGINT again: going down already',
      '[escapelab] SIGTERM again: going down already',
    ]);
  });
});

describe('the start script', () => {
  const scripts = (file: string): Record<string, string> =>
    (JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8')) as {
      scripts: Record<string, string>;
    }).scripts;
  const root = scripts('../../../package.json')['start'] ?? '';

  /**
   * The repo's start script run by `sh`, as pnpm runs it, with a pnpm of its own on the PATH that
   * notes each call with its process id and answers a migration with `migrateExit`: the calls, the
   * shell's own process id first, and how the script ended.
   */
  function startWith(env: Record<string, string>, migrateExit = 0) {
    const dir = mkdtempSync(join(tmpdir(), 'escapelab-start-'));
    const log = join(dir, 'calls');
    const pnpm = join(dir, 'pnpm');
    writeFileSync(
      pnpm,
      '#!/bin/sh\necho "pnpm $$ $*" >> "$LOG"\n' +
        `case "$*" in *"migrate deploy"*) exit ${migrateExit};; esac\n`,
    );
    chmodSync(pnpm, 0o755);
    const run = spawnSync('sh', ['-c', `echo "shell $$" >> "$LOG"; ${root}`], {
      env: { PATH: `${dir}:${process.env['PATH'] ?? ''}`, LOG: log, ...env },
      encoding: 'utf8',
    });
    const calls = readFileSync(log, 'utf8').trimEnd().split('\n');
    rmSync(dir, { recursive: true, force: true });
    return { calls, status: run.status };
  }

  it('leaves no shell nor tsx CLI between pnpm and the server: SIGTERM reaches the server', () => {
    expect(scripts('../package.json')['start']).toBe('exec node --import tsx src/index.ts');
    // The shell becomes pnpm (`exec`): the server's pnpm runs as the shell's own process.
    const { calls, status } = startWith({});
    const shell = calls[0]?.split(' ')[1];
    expect(calls).toEqual([`shell ${shell}`, `pnpm ${shell} --filter @escapelab/server start`]);
    expect(status).toBe(0);
  });

  it('applies the migrations first where DATABASE_URL is set, and starts nothing if they fail', () => {
    const migrated = startWith({ DATABASE_URL: 'set' });
    const shell = migrated.calls[0]?.split(' ')[1];
    const migration = migrated.calls[1]?.split(' ');
    expect(migration?.slice(2).join(' ')).toBe('--filter @escapelab/server prisma migrate deploy');
    expect(migration?.[1]).not.toBe(shell);
    expect(migrated.calls[2]).toBe(`pnpm ${shell} --filter @escapelab/server start`);
    expect(migrated.calls).toHaveLength(3);
    const failed = startWith({ DATABASE_URL: 'set' }, 1);
    expect(failed.calls.slice(1).map((call) => call.split(' ').slice(2).join(' '))).toEqual([
      '--filter @escapelab/server prisma migrate deploy',
    ]);
    expect(failed.status).toBe(1);
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SealedSnapshot } from '@escapelab/core';
import { MissionCatalog } from '../src/missions.js';
import { HANDOVER_MS, RoomManager } from '../src/roomManager.js';
import { open, roomKey, seal } from '../src/seal.js';
import { serveSockets } from '../src/sockets.js';
import { FakeServer, joinedOf, type FakeSocket } from './line.js';
import { passFor } from './passes.js';

const KEY = roomKey({ ROOM_SECRET: 'abcd'.repeat(16) }).key;
const missions = new MissionCatalog(fileURLToPath(new URL('../../../missions', import.meta.url)));

/**
 * A snapshot of Blackout mid-way, its relay emergency running, as the build before wrote it:
 * frozen, never written anew. Every later build takes a room up again from it — a field one adds
 * to the game without a default (core snapshot.ts) refuses it, as it would refuse every snapshot
 * on the crews' pages at that build's deploy.
 */
const BUILD_BEFORE = JSON.parse(
  readFileSync(new URL('./fixtures/blackout-snapshot.json', import.meta.url), 'utf8'),
) as SealedSnapshot;

describe('a snapshot of the build before', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BUILD_BEFORE.at + 30_000);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('takes its room up again: the run goes on once the crew is back', () => {
    const line = new FakeServer();
    const manager = new RoomManager(undefined, false, null, KEY, 'later');
    serveSockets(line, { catalog: missions, manager });
    const blob = seal(BUILD_BEFORE, BUILD_BEFORE.code, KEY);
    const crew = ['Anna', 'Ben'].map((name): FakeSocket => {
      const socket = line.connect();
      socket.say({ kind: 'resume', code: BUILD_BEFORE.code, pass: passFor(name), blob });
      return socket;
    });
    // Not its instance's last: the room waits for a newer one first, which never comes.
    vi.advanceTimersByTime(HANDOVER_MS);
    for (const socket of crew) {
      expect(joinedOf(socket).code).toBe(BUILD_BEFORE.code);
      expect(socket.view).toMatchObject({ phase: 'playing', pausedAt: null });
      expect(socket.view.map?.sabotage).not.toBeNull();
    }
  });

  it('fills in what it kept no word of: nobody on a plate, until the crew is back', () => {
    const presence = BUILD_BEFORE.state.presence as Partial<SealedSnapshot['state']['presence']>;
    expect(presence.plates).toBeUndefined();
    const opened = open(seal(BUILD_BEFORE, BUILD_BEFORE.code, KEY), BUILD_BEFORE.code, KEY);
    expect(opened.state.presence.plates).toEqual({});
  });

  it('lets keys this build does not know pass through, wherever they stand', () => {
    const later = {
      ...BUILD_BEFORE,
      later: 'top',
      state: {
        ...BUILD_BEFORE.state,
        later: 'state',
        players: BUILD_BEFORE.state.players.map((player) => ({ ...player, later: 'player' })),
      },
      keeping: { ...BUILD_BEFORE.keeping, later: 'keeping' },
    };
    const opened = open(seal(later, later.code, KEY), later.code, KEY);
    expect(opened).toMatchObject({
      later: 'top',
      state: { later: 'state' },
      keeping: { later: 'keeping' },
    });
    expect(opened.state.players[0]).toMatchObject({ later: 'player' });
  });
});

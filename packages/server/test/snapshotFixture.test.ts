import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SealedSnapshot } from '@escapelab/core';
import { MissionCatalog } from '../src/missions.js';
import { Room } from '../src/room.js';
import { HANDOVER_MS, RoomManager } from '../src/roomManager.js';
import { open, roomKey, seal } from '../src/seal.js';
import { serveSockets } from '../src/sockets.js';
import type { FinishedRun } from '../src/store/store.js';
import { lastView, playToTheHatch, rejoin, type Member } from './blackout.js';
import { FakeServer, joinedOf, type FakeSocket } from './line.js';
import { passFor } from './passes.js';
import { standAt } from './walk.js';

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

  it('staffs the nights of a room kept before the cast from 0, its lines naming nobody', () => {
    expect('castSeed' in BUILD_BEFORE.state).toBe(false);
    const opened = open(seal(BUILD_BEFORE, BUILD_BEFORE.code, KEY), BUILD_BEFORE.code, KEY);
    expect(opened.state.castSeed).toBe(0);
    const heard = opened.state.events.filter((event) => event.kind === 'radio');
    expect(heard.length).toBeGreaterThan(0);
    expect(heard.some((event) => event.speaker !== undefined)).toBe(false);
  });

  it('rests no station in a room kept before stations rested through an emergency', () => {
    expect('resting' in BUILD_BEFORE.state).toBe(false);
    expect(BUILD_BEFORE.state.sabotage).not.toBeNull();
    const opened = open(seal(BUILD_BEFORE, BUILD_BEFORE.code, KEY), BUILD_BEFORE.code, KEY);
    expect(opened.state.resting).toBeNull();
    expect(opened.state.puzzleState).toBeNull();
  });

  it('draws nothing for a room kept before the pools: every station of its run as before', () => {
    expect('drawn' in BUILD_BEFORE.state).toBe(false);
    const opened = open(seal(BUILD_BEFORE, BUILD_BEFORE.code, KEY), BUILD_BEFORE.code, KEY);
    expect(opened.state.drawn).toEqual({});
    const ids = (state: SealedSnapshot['state']): string[] =>
      state.mission.puzzles.map((p) => p.id);
    expect(ids(opened.state)).toEqual(ids(BUILD_BEFORE.state));
    expect(opened.state.currentPuzzleIndex).toBe(BUILD_BEFORE.state.currentPuzzleIndex);
  });

  it('fills in what it kept no word of: nobody on a plate, until the crew is back', () => {
    const presence = BUILD_BEFORE.state.presence as Partial<SealedSnapshot['state']['presence']>;
    expect(presence.plates).toBeUndefined();
    const opened = open(seal(BUILD_BEFORE, BUILD_BEFORE.code, KEY), BUILD_BEFORE.code, KEY);
    expect(opened.state.presence.plates).toEqual({});
  });

  it('marks nobody gone with the server: its run goes on as the first of the crew is back', () => {
    const away = Object.values(BUILD_BEFORE.state.away);
    expect(away.length).toBe(2);
    expect(away.some((member) => 'maintenance' in member)).toBe(false);
    const line = new FakeServer();
    const manager = new RoomManager(undefined, false, null, KEY, 'later');
    serveSockets(line, { catalog: missions, manager });
    const anna = line.connect();
    const blob = seal(BUILD_BEFORE, BUILD_BEFORE.code, KEY);
    anna.say({ kind: 'resume', code: BUILD_BEFORE.code, pass: passFor('Anna'), blob });
    vi.advanceTimersByTime(HANDOVER_MS);
    expect(anna.view).toMatchObject({ phase: 'playing', pausedAt: null });
    expect(anna.view.away.map((member) => member.name)).toEqual(['Ben']);
  });

  it('is won on its old chain: the Serverraum, the Funkpult, the reactor, the hatch', () => {
    // A run in flight at a deploy keeps the mission it began with: Blackout before its
    // Wechselplatz, the Notstromkasten second, the Signalkette before the Serverschott.
    const opened = open(seal(BUILD_BEFORE, BUILD_BEFORE.code, KEY), BUILD_BEFORE.code, KEY);
    const reports: FinishedRun[] = [];
    const room = Room.restore(opened, Date.now(), { onRunFinished: (run) => reports.push(run) });
    const [anna, ben] = ['Anna', 'Ben'].map((name) => rejoin(room, { name })) as [Member, Member];
    for (const member of [anna, ben]) {
      const stood = opened.keeping.positions[member.playerId];
      expect(stood, member.name).toBeDefined();
      standAt(room, member, stood ?? { x: 0, y: 0 });
    }
    const chain = ['notlicht', 'notstrom', 'signalkette', 'subsysteme', 'frequenz', 'reaktorstart'];
    expect(opened.state.mission.puzzles.map((p) => p.id)).toEqual(chain);
    expect(lastView(anna)).toMatchObject({ phase: 'playing', currentPuzzleIndex: 3 });
    // Its emergency runs out, then the three stations it had left and the way out.
    playToTheHatch({ room, anna, ben });
    expect(lastView(anna).phase).toBe('won');
    expect(reports.map(({ report }) => [report.outcome, report.missionId])).toEqual([
      ['won', 'blackout'],
    ]);
    expect(reports[0]?.report.stations.map((s) => s.puzzleId)).toEqual(chain);
    // No draw: its report names none, and so stands on no board of the new chain's.
    expect(reports[0]?.report.drawn ?? {}).toEqual({});
    room.dispose();
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

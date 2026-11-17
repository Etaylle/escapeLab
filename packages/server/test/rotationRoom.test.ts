import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  drawPools,
  parseMission,
  type Mission,
  type PlayerView,
  type ServerMessage,
} from '@escapelab/core';
import { MissionCatalog } from '../src/missions.js';
import { Room } from '../src/room.js';
import { open, roomKey, seal } from '../src/seal.js';
import type { FinishedRun } from '../src/store/store.js';
import { rejoin } from './blackout.js';
import { passFor } from './passes.js';
import { pressE, walkTo, type Walker } from './walk.js';

/**
 * A corridor lab in a chain of three places — Eins (3,1), the pool „mitte" of Anlage A (6,1), B
 * (9,1) and C (12,1), Drei (19,1) behind the door (16,2) the pool opens — every station pressed
 * by the whole crew.
 *
 *   0123456789012345678901
 * 0 ######################
 * 1 #..1..a..b..c...#..3.#   spawns (1,1) and (1,2)
 * 2 #...............D....#   door (16,2)
 * 3 ######################
 */
const TURN_LAB = {
  id: 'custom-wechsel',
  title: 'Wechsel',
  players: { min: 2, max: 2 },
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  puzzles: [
    { type: 'button-sync', id: 'eins', title: 'Eins' },
    { type: 'button-sync', id: 'xa', title: 'Anlage A', pool: 'mitte' },
    { type: 'button-sync', id: 'xb', title: 'Anlage B', pool: 'mitte' },
    { type: 'button-sync', id: 'xc', title: 'Anlage C', pool: 'mitte' },
    { type: 'button-sync', id: 'drei', title: 'Drei' },
  ],
  map: {
    tiles: [
      '######################',
      '#...............#....#',
      '#....................#',
      '######################',
    ],
    spawns: [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
    ],
    doors: [{ id: 'tor', x: 16, y: 2, opensBy: { kind: 'puzzle', puzzleId: 'mitte' } }],
    stations: [
      { puzzleId: 'eins', x: 3, y: 1 },
      { puzzleId: 'xa', x: 6, y: 1 },
      { puzzleId: 'xb', x: 9, y: 1 },
      { puzzleId: 'xc', x: 12, y: 1 },
      { puzzleId: 'drei', x: 19, y: 1 },
    ],
  },
};

const turnLab = (): Mission => parseMission(TURN_LAB);

/** Where each member of the pool stands, by id: the x of its console. */
const CONSOLE_X: Readonly<Record<string, number>> = { xa: 6, xb: 9, xc: 12 };

/** The first seed whose run of the lab has `puzzleId` at its Wechselplatz. */
function seedDrawing(puzzleId: string): number {
  for (let seed = 1; seed < 1000; seed++) {
    if (drawPools(turnLab().puzzles, seed)['mitte'] === puzzleId) {
      return seed;
    }
  }
  throw new Error(`no seed draws "${puzzleId}"`);
}

function join(room: Room, name: string): Walker {
  const messages: ServerMessage[] = [];
  const player = { ...room.join(name, passFor(name)), messages };
  room.attach(player.playerId, (m) => messages.push(m));
  return player;
}

function lastView(walker: Walker): PlayerView {
  const last = walker.messages.filter((m) => m.kind === 'view').at(-1);
  if (last?.kind !== 'view') {
    throw new Error('expected a view');
  }
  return last.view;
}

/** Anna and Ben in a run of the lab that draws `puzzleId`; `finished` hears its report. */
function running(puzzleId: string, finished: (run: FinishedRun) => void = () => undefined) {
  const room = new Room('TEST', turnLab(), finished, seedDrawing(puzzleId));
  const anna = join(room, 'Anna');
  const ben = join(room, 'Ben');
  room.setReady(ben.playerId, true);
  room.act(anna.playerId, { kind: 'start-mission' });
  return { room, anna, ben };
}

/** Both walk up to the station at (x, 1), side by side below it. */
function standAt(room: Room, anna: Walker, ben: Walker, x: number): void {
  walkTo(room, anna, x + 0.5, 2.5);
  walkTo(room, ben, x - 0.5, 2.5);
}

/** Both at the station at (x, 1), switched on by Anna and pressed by both: solved. */
function take(room: Room, anna: Walker, ben: Walker, x: number): void {
  standAt(room, anna, ben, x);
  pressE(room, anna);
  for (const player of [anna, ben]) {
    room.act(player.playerId, { kind: 'puzzle-input', input: { press: true } });
  }
}

/** The status of every station `walker`'s last view tells whole, by puzzle id. */
const statuses = (walker: Walker): Record<string, string> =>
  Object.fromEntries(
    (lastView(walker).map?.stations ?? []).flatMap((s) =>
      s.known ? [[s.puzzleId, s.status]] : [],
    ),
  );

describe('a run of a mission with a Wechselplatz in a room', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers E at a console out of service with its tag, and switches nothing on', () => {
    const { room, anna, ben } = running('xb');
    take(room, anna, ben, 3);
    expect(lastView(anna).currentPuzzleIndex).toBe(1);
    standAt(room, anna, ben, CONSOLE_X['xa'] ?? 0);
    expect(() => pressE(room, anna)).toThrow('Außer Betrieb.');
    expect(lastView(anna).puzzle).toBeNull();
    expect(statuses(anna)).toMatchObject({ xa: 'out', xb: 'armed' });
    // Away from every console, the answer is the one it always was.
    walkTo(room, anna, 14.5, 2.5);
    expect(() => pressE(room, anna)).toThrow(/Zu weit weg/);
    room.dispose();
  });

  it('opens the pool’s door with the drawn station, and reports the draw', () => {
    const reports: FinishedRun[] = [];
    const { room, anna, ben } = running('xc', (run) => reports.push(run));
    take(room, anna, ben, 3);
    expect(lastView(anna).map?.doors[0]?.open).toBe(false);
    take(room, anna, ben, CONSOLE_X['xc'] ?? 0);
    expect(lastView(anna).map?.doors[0]?.open).toBe(true);
    take(room, anna, ben, 19);
    expect(lastView(anna).phase).toBe('won');
    expect(lastView(anna).puzzleCount).toBe(3);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.report.drawn).toEqual({ mitte: 'xc' });
    expect(reports[0]?.report.stations.map((s) => s.puzzleId)).toEqual(['eins', 'xc', 'drei']);
    room.dispose();
  });
});

/** The key the snapshot below is sealed under. */
const KEY = roomKey({ ROOM_SECRET: 'f00d'.repeat(16) }).key;

describe('a run with a Wechselplatz, sealed and taken up again', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the draw: the same station up, the others out of service as before', () => {
    const { room, anna, ben } = running('xc');
    take(room, anna, ben, 3);
    const kept = room.snapshot(Date.now());
    const blob = seal({ ...kept, instance: 'wechsel', final: true }, 'TEST', KEY);
    room.dispose();
    const { state } = open(blob, 'TEST', KEY);
    expect(state.drawn).toEqual({ mitte: 'xc' });
    expect(state.mission.puzzles.map((p) => p.id)).toEqual(['eins', 'xc', 'drei', 'xa', 'xb']);
    vi.advanceTimersByTime(30_000);
    const again = Room.restore(open(blob, 'TEST', KEY), Date.now());
    const [annaBack, benBack] = [rejoin(again, { name: 'Anna' }), rejoin(again, { name: 'Ben' })];
    expect(lastView(annaBack).puzzleCount).toBe(3);
    take(again, annaBack, benBack, CONSOLE_X['xc'] ?? 0);
    expect(lastView(annaBack).currentPuzzleIndex).toBe(2);
    expect(lastView(annaBack).map?.doors[0]?.open).toBe(true);
    again.dispose();
  });
});

describe('the catalog, of a mission with a Wechselplatz', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(joinPath(tmpdir(), 'rotation-catalog-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('counts the stations of a run for the lobby, and prints every member’s rules', () => {
    writeFileSync(joinPath(dir, 'wechsel.json'), JSON.stringify({ ...TURN_LAB, id: 'wechsel' }));
    const catalog = new MissionCatalog(dir);
    expect(catalog.infos().map((info) => [info.id, info.puzzleCount])).toEqual([['wechsel', 3]]);
    expect(catalog.manual('wechsel')?.stations.map((s) => s.title)).toEqual([
      'Eins',
      'Anlage A',
      'Anlage B',
      'Anlage C',
      'Drei',
    ]);
    // Each page of the pool names the machines it takes turns with; the others name none.
    expect(catalog.manual('wechsel')?.stations.map((s) => s.takesTurnsWith)).toEqual([
      undefined,
      ['Anlage B', 'Anlage C'],
      ['Anlage A', 'Anlage C'],
      ['Anlage A', 'Anlage B'],
      undefined,
    ]);
  });
});

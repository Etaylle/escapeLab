import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMission, type Mission, type PlayerView, type ServerMessage } from '@escapelab/core';
import { Room } from '../src/room.js';
import { walkTo, type Walker } from './walk.js';

/**
 * A hall for two with the lights out from the start: the wiring box a few
 * steps east of the spawns, the sign beside them, the key halfway, and at
 * the east end a locker and a cabinet that both print the box's rules.
 *
 *   0123456789012345
 * 0 ################
 * 1 #....b.........#   spawns (1,1) and (1,2); box (5,1); locker (14,1)
 * 2 #.s.....k......#   sign (2,2); key (8,2); cabinet (14,2)
 * 3 ################
 */
const hall: Mission = parseMission({
  id: 'fundhalle',
  title: 'Fundhalle',
  players: { min: 2, max: 2 },
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  puzzles: [{ type: 'wiring', id: 'kabel', title: 'Kabel' }],
  map: {
    tiles: ['################', '#..............#', '#..............#', '################'],
    spawns: [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
    ],
    stations: [{ puzzleId: 'kabel', x: 5, y: 1 }],
    manuals: [
      {
        id: 'spind',
        kind: 'locker',
        label: 'SPIND',
        puzzleIds: ['kabel'],
        spots: [{ x: 14, y: 1 }],
      },
      {
        id: 'schrank',
        kind: 'cabinet',
        label: 'SCHRANK',
        puzzleIds: ['kabel'],
        spots: [{ x: 14, y: 2 }],
        needsKey: 'schluessel',
      },
    ],
    items: [{ id: 'schluessel', label: 'SCHLÜSSEL', x: 8, y: 2 }],
    edgeworkSign: { x: 2, y: 2 },
  },
});

/** Blackout, read as the server reads it. */
const blackout: Mission = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8')),
);

type Player = Walker & { token: string; detach: () => void };

function join(room: Room, name: string): Player {
  const messages: ServerMessage[] = [];
  const player = { ...room.join(name), messages };
  return { ...player, detach: room.attach(player.playerId, (m) => messages.push(m)) };
}

function lastView(walker: Walker): PlayerView {
  const last = walker.messages.filter((m) => m.kind === 'view').at(-1);
  if (last?.kind !== 'view') {
    throw new Error('expected a view message');
  }
  return last.view;
}

/** The sources `walker` has found by the last view, by id. */
function sourcesFound(walker: Walker): string[] {
  return (lastView(walker).map?.manuals ?? []).filter((m) => m.found).map((m) => m.id);
}

/** Turns `walker` where it stands to face `facing` (radians), as a client streams a turn. */
function turn(room: Room, walker: Walker, at: { x: number; y: number }, facing: number): void {
  const run = lastView(walker).startedAt ?? Number.NaN;
  room.updatePosition(walker.playerId, run, { ...at, facing, moving: false });
}

describe('a room where things are found by reach or by the lamp', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Anna and Ben in a run of `mission` (pinned to `seed` where given); the fake clock's now. */
  function started(mission: Mission = hall, seed: number | null = null) {
    const room = new Room('TEST', mission, () => undefined, seed);
    const anna = join(room, 'Anna');
    const ben = join(room, 'Ben');
    room.setReady(ben.playerId, true);
    room.act(anna.playerId, { kind: 'start-mission' });
    return { room, anna, ben, startedAt: Date.now() };
  }

  it('finds what the lamp rests on for a quarter second, by its own clock as nobody moves', () => {
    const { room, anna } = started();
    walkTo(room, anna, 9.5, 1.5); // facing east, the locker five tiles ahead
    vi.advanceTimersByTime(249);
    expect(sourcesFound(anna)).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sourcesFound(anna)).toEqual(['spind', 'schrank']);
    room.dispose();
  });

  it('starts a look anew once the lamp has turned away', () => {
    const { room, anna } = started();
    const here = { x: 9.5, y: 1.5 };
    walkTo(room, anna, here.x, here.y);
    vi.advanceTimersByTime(200);
    turn(room, anna, here, Math.PI);
    vi.advanceTimersByTime(100);
    turn(room, anna, here, 0);
    vi.advanceTimersByTime(249);
    expect(sourcesFound(anna)).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sourcesFound(anna)).toEqual(['spind', 'schrank']);
    room.dispose();
  });

  it('finds nothing while the run stands paused, and looks anew once it goes on', () => {
    const { room, anna, ben } = started();
    walkTo(room, anna, 9.5, 1.5);
    ben.detach();
    vi.advanceTimersByTime(1000);
    expect(sourcesFound(anna)).toEqual([]);
    // The lamp rested on the locker all through the pause, but the pause froze the look.
    room.resume(ben.playerId, ben.token);
    vi.advanceTimersByTime(249);
    expect(sourcesFound(anna)).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sourcesFound(anna)).toEqual(['spind', 'schrank']);
    room.dispose();
  });

  it('chimes for whoever found it, the find that matters most, then nothing for 1.5 s', () => {
    const { room, anna, ben, startedAt } = started();
    // At the start each finds the sign beside the spawns; the box ahead takes a look.
    expect(lastView(anna).map?.chimes).toEqual([{ find: { of: 'sign' }, at: startedAt }]);
    expect(lastView(ben).map?.chimes).toEqual([{ find: { of: 'sign' }, at: startedAt }]);
    vi.advanceTimersByTime(250);
    // The box and the key down the hall, looked at from the spawns: found inside the gap, they
    // stay silent for good.
    expect(lastView(anna).map?.stations[0]?.found).toBe(true);
    expect(lastView(anna).map?.items[0]?.found).toBe(true);
    expect(lastView(anna).map?.chimes).toHaveLength(1);
    vi.advanceTimersByTime(1250);
    // Along the north wall up to the locker, which prints the armed box's rules: it chimes; the
    // cabinet beside it, looked at a quarter of a second later, is found in the gap.
    walkTo(room, anna, 1.5, 1.5);
    walkTo(room, anna, 12.5, 1.5);
    vi.advanceTimersByTime(250);
    expect(sourcesFound(anna)).toEqual(['spind', 'schrank']);
    expect(lastView(anna).map?.chimes).toEqual([
      { find: { of: 'sign' }, at: startedAt },
      { find: { of: 'source', id: 'spind' }, at: startedAt + 1500 },
    ]);
    expect(lastView(ben).map?.chimes).toHaveLength(1);
    expect(sourcesFound(ben)).toEqual([]);
    room.dispose();
  });

  it('finds in the lab lit for its opening only what the two rules find (Blackout, seed 5)', () => {
    const { room, anna, ben } = started(blackout, 5);
    expect(lastView(anna).lights.out).toBe(false);
    expect(lastView(anna).map?.yourSpawn).toEqual({ x: 3, y: 3 });
    expect(lastView(ben).map?.yourSpawn).toEqual({ x: 1, y: 8 });
    vi.advanceTimersByTime(1000);
    const found = (walker: Walker) => {
      const map = lastView(walker).map;
      return [
        ...(map?.manuals ?? []).filter((m) => m.found).map((m) => m.id),
        ...(map?.items ?? []).filter((i) => i.found).map((i) => i.id),
        ...(map?.notes ?? []).filter((n) => n.found).map((n) => `note ${n.index}`),
        ...(map?.stations ?? []).filter((s) => s.found).map((s) => s.puzzleId),
        ...(map?.edgeworkSign?.found === true ? ['sign'] : []),
      ];
    };
    // Anna in the Archiv, facing east: the sign at her side, the fuse in her lamp's cone; the
    // book on its lectern to the north-east and the note on the north wall stay unfound.
    expect(found(anna)).toEqual(['ersatzsicherung', 'sign']);
    // Ben at the Flur's west end, facing east: console B of the Notstrom-Kasten at his side,
    // the clipboard down the Flur in his cone.
    expect(found(ben)).toEqual(['klemmbrett', 'notstrom']);
    room.dispose();
  });
});

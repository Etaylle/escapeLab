import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findKey,
  parseMission,
  type Mission,
  type PlayerView,
  type ServerMessage,
} from '@escapelab/core';
import { Room } from '../src/room.js';
import { walkTo, type Walker } from './walk.js';
import { passFor } from './passes.js';

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

type Player = Walker & { detach: () => void };

function join(room: Room, name: string): Player {
  const messages: ServerMessage[] = [];
  const player = { ...room.join(name, passFor(name)), messages };
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

/** Anna and Ben in a run of `mission` (pinned to `seed` where given); the fake clock's now. */
function started(mission: Mission = hall, seed: number | null = null) {
  const room = new Room('TEST', mission, () => undefined, seed);
  const anna = join(room, 'Anna');
  const ben = join(room, 'Ben');
  room.setReady(ben.playerId, true);
  room.act(anna.playerId, { kind: 'start-mission' });
  return { room, anna, ben, startedAt: Date.now() };
}

/**
 * Where the lamp finds both of the hall's sources, facing east: the locker 2.7 tiles ahead,
 * the cabinet 2.9 a little to the right — inside the lamp's 3 tiles, beyond the 2 of reach.
 */
const BY_LOCKERS = { x: 11.8, y: 1.5 };
/** Where the box lies 2.9 tiles ahead, facing east: in the lamp's cone, out of reach. */
const BEFORE_BOX = { x: 2.6, y: 1.5 };

describe('a room where the lamp finds what it rests on, close by', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('finds what the lamp rests on for 600 ms, by its own clock as nobody moves', () => {
    const { room, anna } = started();
    walkTo(room, anna, BY_LOCKERS.x, BY_LOCKERS.y);
    vi.advanceTimersByTime(599);
    expect(sourcesFound(anna)).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sourcesFound(anna)).toEqual(['spind', 'schrank']);
    room.dispose();
  });

  it('finds nothing the lamp rests on further down the hall than its 3 tiles', () => {
    const { room, anna } = started();
    walkTo(room, anna, 9.5, 1.5); // facing east, the locker five tiles ahead
    vi.advanceTimersByTime(10_000);
    expect(sourcesFound(anna)).toEqual([]);
    walkTo(room, anna, BY_LOCKERS.x, BY_LOCKERS.y);
    vi.advanceTimersByTime(600);
    expect(sourcesFound(anna)).toEqual(['spind', 'schrank']);
    room.dispose();
  });

  it('starts a look anew once the lamp has turned away', () => {
    const { room, anna } = started();
    const here = BY_LOCKERS;
    walkTo(room, anna, here.x, here.y);
    vi.advanceTimersByTime(500);
    turn(room, anna, here, Math.PI);
    vi.advanceTimersByTime(100);
    turn(room, anna, here, 0);
    vi.advanceTimersByTime(599);
    expect(sourcesFound(anna)).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sourcesFound(anna)).toEqual(['spind', 'schrank']);
    room.dispose();
  });

  it('looks on while somebody’s line is down: a drop freezes no look', () => {
    const { room, anna, ben } = started();
    walkTo(room, anna, BY_LOCKERS.x, BY_LOCKERS.y);
    ben.detach();
    vi.advanceTimersByTime(599);
    expect(sourcesFound(anna)).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sourcesFound(anna)).toEqual(['spind', 'schrank']);
    room.dispose();
  });

  it('lets the look of whoever drops go with the line: back, the lamp looks anew', () => {
    const { room, ben } = started();
    walkTo(room, ben, BY_LOCKERS.x, BY_LOCKERS.y);
    vi.advanceTimersByTime(500);
    ben.detach();
    vi.advanceTimersByTime(5000);
    // Ben's lamp rested on the locker all the while, but nobody looked through it.
    room.resume(passFor('Ben'));
    room.attach(ben.playerId, (m) => ben.messages.push(m));
    vi.advanceTimersByTime(599);
    expect(sourcesFound(ben)).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sourcesFound(ben)).toEqual(['spind', 'schrank']);
    room.dispose();
  });

  it('finds nothing while the server’s maintenance stands the run still, and looks anew', () => {
    const { room, anna } = started();
    walkTo(room, anna, BY_LOCKERS.x, BY_LOCKERS.y);
    room.goDown(Date.now());
    vi.advanceTimersByTime(1000);
    expect(sourcesFound(anna)).toEqual([]);
    // The lamp rested on the locker all through the standstill, but it froze the look.
    room.resume(passFor('Anna'));
    room.resume(passFor('Ben'));
    vi.advanceTimersByTime(599);
    expect(sourcesFound(anna)).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sourcesFound(anna)).toEqual(['spind', 'schrank']);
    room.dispose();
  });

  it('lets a look of one run go with it: the next run looks anew', () => {
    const { room, anna, ben } = started();
    const here = BEFORE_BOX;
    walkTo(room, anna, here.x, here.y);
    // Turned from the box at once, then back to it as the clock runs out: a look cut short.
    turn(room, anna, here, Math.PI);
    vi.advanceTimersByTime(hall.timeLimitSec * 1000 - 100);
    turn(room, anna, here, 0);
    vi.advanceTimersByTime(200);
    expect(lastView(anna).phase).toBe('lost');
    room.setReady(ben.playerId, true);
    room.setReady(anna.playerId, true);
    const box = () => lastView(anna).map?.stations[0]?.found;
    expect([lastView(anna).phase, box()]).toEqual(['playing', false]);
    walkTo(room, anna, here.x, here.y);
    vi.advanceTimersByTime(599);
    expect(box()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(box()).toBe(true);
    room.dispose();
  });
});

describe('a room where things are found on the way, each chiming for its finder', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('finds the lever a player stands by as the lights die, without a step (Blackout)', () => {
    const { room, anna, ben } = started(blackout, 5);
    // Ben skipped and walked up under the lever while the lights still burn: nothing to find.
    const at = blackout.map.stations.find((s) => s.puzzleId === 'notlicht') ?? { x: 0, y: 0 };
    walkTo(room, ben, at.x + 0.5, at.y + 1.5);
    vi.advanceTimersByTime(2000);
    const lever = () => lastView(ben).map?.stations.find((s) => s.look === 'lever');
    expect(lever()?.found).toBe(false);
    room.act(ben.playerId, { kind: 'intro-done' });
    room.act(anna.playerId, { kind: 'intro-done' });
    const out = Date.now();
    expect(lastView(ben).lights.out).toBe(true);
    expect(lever()?.found).toBe(true);
    expect(lastView(ben).map?.discoveries.at(-1)).toEqual({
      find: { of: 'console', puzzleId: 'notlicht', console: null },
      at: out,
      chime: true,
    });
    room.dispose();
  });

  it('lists each player’s own finds that matter, a chime at most once in 1.5 s', () => {
    const { room, anna, ben, startedAt } = started();
    /** A player's discoveries: what, how long after the start, and whether it chimes. */
    const listed = (walker: Walker) =>
      (lastView(walker).map?.discoveries ?? []).map((one) => [
        findKey(one.find),
        one.at - startedAt,
        one.chime,
      ]);
    // At the start each finds the sign beside the spawns; the box and the key down the hall lie
    // beyond the lamp's reach, however long it rests on them.
    const sign = [['sign', 0, true]];
    expect(listed(anna)).toEqual(sign);
    expect(listed(ben)).toEqual(sign);
    vi.advanceTimersByTime(600);
    expect(listed(anna)).toEqual(sign);
    // Anna walks up the hall to the key: the box beside her way and the key at her feet, found
    // inside the gap, are both listed, the box first — their captions show, their chime is
    // dropped for good.
    walkTo(room, anna, 8.5, 1.5);
    const walked = [...sign, ['console:kabel/-', 600, false], ['item:schluessel', 600, false]];
    expect(listed(anna)).toEqual(walked);
    vi.advanceTimersByTime(900);
    // Along the north wall up to the locker, which prints the armed box's rules: it chimes; the
    // cabinet beside it, found by the lamp 600 ms later, comes in the gap.
    walkTo(room, anna, 12.5, 1.5);
    vi.advanceTimersByTime(600);
    expect(sourcesFound(anna)).toEqual(['spind', 'schrank']);
    expect(listed(anna)).toEqual([
      ...walked,
      ['source:spind', 1500, true],
      ['source:schrank', 2100, false],
    ]);
    expect(listed(ben)).toEqual(sign);
    expect(sourcesFound(ben)).toEqual([]);
    room.dispose();
  });

  it('finds in the lab lit for its opening only what the two rules find (Blackout, seed 5)', () => {
    const { room, anna, ben } = started(blackout, 5);
    expect(lastView(anna).lights.out).toBe(false);
    expect(lastView(anna).map?.yourSpawn).toEqual({ x: 3, y: 3 });
    expect(lastView(ben).map?.yourSpawn).toEqual({ x: 1, y: 12 });
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
    // Anna in the Archiv, facing east: the sign at her side; the fuse 7.2 tiles off to the
    // south-east, the book on its lectern to the north-east and the note on the north wall stay
    // unfound, the room lit or not.
    expect(found(anna)).toEqual(['sign']);
    // Ben at the Flur's west end, facing east: the clipboard 10 tiles down the Flur lies beyond
    // his lamp's reach, behind the buttress (9,12) besides; console B of the Notstrom-Kasten up
    // the west end is no find before its station is armed.
    expect(found(ben)).toEqual([]);
    // Ben walks down the Flur till the clipboard lies 2.8 tiles ahead, the buttress beside his
    // way: his lamp finds it 600 ms on.
    walkTo(room, ben, 8.9, 11.5);
    vi.advanceTimersByTime(599);
    expect(found(ben)).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(found(ben)).toEqual(['klemmbrett']);
    room.dispose();
  });
});

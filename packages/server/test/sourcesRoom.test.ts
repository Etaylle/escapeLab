import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMission, type Mission, type ServerMessage } from '@escapelab/core';
import { Room } from '../src/room.js';
import { pressE, walkTo, type Walker } from './walk.js';

/**
 * A corridor for two or three: the wiring box at its west end beside the
 * spawns, a locker and a cabinet holding its rules at the east end, and the
 * cabinet's key halfway.
 *
 *   0123456789012345
 * 0 ################
 * 1 #..............#   box (3,1); locker (14,1)
 * 2 #..............#   sign (2,2); key (8,2); cabinet (14,2)
 * 3 ################
 */
const mission: Mission = parseMission({
  id: 'quellenraum',
  title: 'Quellen-Raum',
  players: { min: 2, max: 3 },
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  puzzles: [{ type: 'wiring', id: 'kabel', title: 'Kabel' }],
  map: {
    tiles: ['################', '#..............#', '#..............#', '################'],
    spawns: [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 1 },
    ],
    stations: [{ puzzleId: 'kabel', x: 3, y: 1 }],
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

/**
 * Two rooms and a plate door between them, the locker in the east one: three
 * tiles straight behind the door at (6,2), or round its corner at (5,1). The
 * sign hangs in the west room at (3,3), or wherever else `sign` puts it.
 *
 *   0123456789
 * 0 ##########
 * 1 #...#....#   spawns (1,1) and (2,1)
 * 2 #........#   station (1,2); door (4,2)
 * 3 #...#....#   plate (1,3); sign (3,3)
 * 4 ##########
 */
function behindTheDoor(
  locker: { x: number; y: number },
  sign: { x: number; y: number } = { x: 3, y: 3 },
): Mission {
  return parseMission({
    id: 'sichtraum',
    title: 'Sicht-Raum',
    players: { min: 2, max: 2 },
    story: { intro: 'i', win: 'w', lose: 'l' },
    timeLimitSec: 600,
    puzzles: [{ type: 'wiring', id: 'kabel', title: 'Kabel' }],
    map: {
      tiles: ['##########', '#...#....#', '#........#', '#...#....#', '##########'],
      spawns: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
      ],
      stations: [{ puzzleId: 'kabel', x: 1, y: 2 }],
      doors: [{ id: 'tuer', x: 4, y: 2, opensBy: { kind: 'plate', plateId: 'platte' } }],
      plates: [{ id: 'platte', x: 1, y: 3, label: 'HALTEN' }],
      manuals: [
        { id: 'spind', kind: 'locker', label: 'SPIND', puzzleIds: ['kabel'], spots: [locker] },
      ],
      edgeworkSign: sign,
    },
  });
}

/**
 * A ring of corridor round a block of wall, the locker at the far end of its
 * south side: out of sight from the north side, where both start, in sight
 * all the way down the south one. With `opening`, the run opens with the
 * power on for three seconds.
 *
 *   0123456789
 * 0 ##########
 * 1 #........#   spawns (1,1) and (2,1); station (8,1)
 * 2 #.######.#
 * 3 #........#   locker (8,3)
 * 4 ##########
 */
const ring = (opening = false): Mission =>
  parseMission({
    id: 'ringraum',
    title: 'Ring-Raum',
    players: { min: 2, max: 2 },
    story: { intro: 'i', win: 'w', lose: 'l' },
    timeLimitSec: 600,
    ...(opening ? { intro: { lightsSec: 3 } } : {}),
    puzzles: [{ type: 'keypad', id: 'code', title: 'Code' }],
    map: {
      tiles: ['##########', '#........#', '#.######.#', '#........#', '##########'],
      spawns: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
      ],
      stations: [{ puzzleId: 'code', x: 8, y: 1 }],
      manuals: [
        {
          id: 'spind',
          kind: 'locker',
          label: 'SPIND',
          puzzleIds: ['code'],
          spots: [{ x: 8, y: 3 }],
        },
      ],
    },
  });

function collector(): { messages: ServerMessage[]; listen: (m: ServerMessage) => void } {
  const messages: ServerMessage[] = [];
  return { messages, listen: (m) => messages.push(m) };
}

function lastView(messages: ServerMessage[]) {
  const last = messages.filter((m) => m.kind === 'view').at(-1);
  if (last === undefined || last.kind !== 'view') {
    throw new Error('expected a view message');
  }
  return last.view;
}

describe('Room with sources to find and open', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function moveTo(room: Room, player: Walker, x: number, y: number): void {
    walkTo(room, player, x + 0.5, y + 0.5);
  }

  function started(lab: Mission = mission) {
    const room = new Room('TEST', lab);
    const anna = { ...room.join('Anna'), ...collector() };
    const ben = { ...room.join('Ben'), ...collector() };
    room.attach(anna.playerId, anna.listen);
    room.attach(ben.playerId, ben.listen);
    room.setReady(ben.playerId, true);
    room.act(anna.playerId, { kind: 'start-mission' });
    return { room, anna, ben };
  }

  /**
   * Each source on the last map `walker` got: whether found by them, whether known to the crew.
   * One nobody has found is on a map only while in their sight.
   */
  function finds(walker: Walker & { messages: ServerMessage[] }) {
    return (lastView(walker.messages).map?.manuals ?? []).map((m) => [m.id, m.found, m.known]);
  }

  it('finds a source for whoever comes within two tiles in sight; the crew knows of it', () => {
    const { room, anna, ben } = started();
    // The corridor lies open: both are in everybody's sight from the start, found by nobody.
    expect(finds(ben)).toEqual([
      ['spind', false, false],
      ['schrank', false, false],
    ]);
    moveTo(room, anna, 11, 1); // three tiles short of the locker: no time to look
    expect(finds(anna)).toEqual([
      ['spind', false, false],
      ['schrank', false, false],
    ]);
    moveTo(room, anna, 12, 1); // two tiles from the locker, a little more from the cabinet
    expect(finds(anna)).toEqual([
      ['spind', true, true],
      ['schrank', false, false],
    ]);
    expect(finds(ben)).toEqual([
      ['spind', false, true],
      ['schrank', false, false],
    ]);
    moveTo(room, anna, 1, 1);
    expect(finds(anna)[0]).toEqual(['spind', true, true]);
    expect(lastView(anna.messages).map?.manuals[0]).toMatchObject({ x: 14, y: 1, opened: false });
    room.dispose();
  });

  it('finds nothing through a shut door, however long the lamp rests there; open, it does', () => {
    const { room, anna, ben } = started(behindTheDoor({ x: 6, y: 2 }));
    moveTo(room, anna, 3, 2); // three tiles from the locker, the shut door between, facing it
    vi.advanceTimersByTime(1000);
    expect(finds(anna)).toEqual([]);
    moveTo(room, ben, 1, 3); // onto the plate: the door opens before Anna's lamp
    expect(lastView(ben.messages).map?.doors[0]?.open).toBe(true);
    expect(finds(anna)).toEqual([['spind', false, false]]);
    vi.advanceTimersByTime(599);
    expect(finds(anna)).toEqual([['spind', false, false]]);
    vi.advanceTimersByTime(1);
    expect(finds(anna)).toEqual([['spind', true, true]]);
    moveTo(room, ben, 1, 1); // off the plate again: out of sight, but found stays found
    expect(lastView(ben.messages).map?.doors[0]?.open).toBe(false);
    expect(finds(anna)).toEqual([['spind', true, true]]);
    room.dispose();
  });

  it('finds a source round the corner of a door only for whoever walks in', () => {
    const { room, anna, ben } = started(behindTheDoor({ x: 5, y: 1 }));
    moveTo(room, ben, 1, 3); // the door opens
    moveTo(room, anna, 3, 2); // before the open door, facing in: the wall beside it hides it
    vi.advanceTimersByTime(1000);
    expect(finds(anna)).toEqual([]);
    moveTo(room, anna, 5, 2); // through the door, the locker a step ahead
    expect(finds(anna)).toEqual([['spind', true, true]]);
    expect(finds(ben)).toEqual([['spind', false, true]]);
    room.dispose();
  });

  it('opens no locker and shows no Laborkennung through a wall, however close behind it', () => {
    const { room, anna } = started(behindTheDoor({ x: 5, y: 1 }, { x: 5, y: 3 }));
    walkTo(room, anna, 3.95, 1.5); // pressed to the wall, a tile and a half from the locker
    vi.advanceTimersByTime(1000);
    expect(lastView(anna.messages).sourcesHere).toEqual([]);
    expect(() => room.act(anna.playerId, { kind: 'open-source', manualId: 'spind' })).toThrow(
      'Nur direkt davor.',
    );
    walkTo(room, anna, 3.95, 3.5); // as close to the sign, the wall between
    vi.advanceTimersByTime(1000);
    expect(lastView(anna.messages).edgework).toBeNull();
    room.dispose();
  });

  /** How many views Anna, Ben and an audience have got so far, in that order. */
  function viewsSent(...walkers: { messages: ServerMessage[] }[]): () => number[] {
    const isView = (m: ServerMessage) => m.kind === 'view' || m.kind === 'spectator-view';
    return () => walkers.map((walker) => walker.messages.filter(isView).length);
  }

  it('sends a change of sight to whose sight it is, and to nobody else', () => {
    const { room, anna, ben } = started(ring());
    const watched = collector();
    room.attachSpectator(watched.listen);
    const views = viewsSent(anna, ben, watched);
    moveTo(room, anna, 1, 2); // down the west side: the block still hides the locker
    expect(finds(anna)).toEqual([]);
    const before = views();
    moveTo(room, anna, 1, 3); // round the corner: the locker at the far end comes into sight
    expect(finds(anna)).toEqual([['spind', false, false]]);
    expect(views().map((n, i) => n - (before[i] ?? 0))).toEqual([1, 0, 0]);
    room.dispose();
  });

  it('keeps no sight while the power lights the lab: a walk round a corner sends no view', () => {
    const { room, anna, ben } = started(ring(true));
    const watched = collector();
    room.attachSpectator(watched.listen);
    const views = viewsSent(anna, ben, watched);
    // The lit lab shows the locker to everybody, from anywhere, as no more than seen.
    expect(finds(ben)).toEqual([['spind', false, false]]);
    moveTo(room, anna, 1, 2);
    const before = views();
    moveTo(room, anna, 1, 3);
    expect(views()).toEqual(before);
    expect(finds(anna)).toEqual([['spind', false, false]]);
    room.dispose();
  });

  it('searches a locker for a player standing at it, and nobody further away', () => {
    const { room, anna, ben } = started();
    moveTo(room, anna, 12, 1);
    expect(() => room.act(anna.playerId, { kind: 'open-source', manualId: 'spind' })).toThrow(
      'Nur direkt davor.',
    );
    moveTo(room, anna, 13, 1); // beside the locker, and diagonally by the cabinet
    expect(lastView(anna.messages).sourcesHere.map((s) => [s.id, s.opened])).toEqual([
      ['spind', false],
      ['schrank', false],
    ]);
    room.act(anna.playerId, { kind: 'open-source', manualId: 'spind' });
    const view = lastView(ben.messages);
    const spind = view.map?.manuals.find((m) => m.id === 'spind');
    expect(spind?.known === true && spind.opened).toBe(true);
    expect(view.events.at(-1)).toMatchObject({ kind: 'find', label: 'Spind durchsucht: SPIND' });
    expect(view.credits[anna.playerId]?.found).toBe(1);
    room.dispose();
  });

  it('unlocks a cabinet with the key in hand, by the one key that does the obvious thing', () => {
    const { room, anna } = started();
    moveTo(room, anna, 8, 2);
    pressE(room, anna);
    const key = lastView(anna.messages).map?.items[0];
    expect(key?.known === true ? key.carriedBy : null).toBe(anna.playerId);
    moveTo(room, anna, 11, 2);
    expect(() => pressE(room, anna)).toThrow(/markierten Platz/);
    moveTo(room, anna, 14, 2);
    pressE(room, anna);
    const view = lastView(anna.messages);
    expect(view.sourcesHere.find((s) => s.id === 'schrank')?.opened).toBe(true);
    expect(view.map?.items[0]).toMatchObject({ delivered: true, x: 14.5, y: 2.5 });
    expect(view.manualsHere.map((m) => m.id)).toEqual(['schrank']);
    expect(view.credits[anna.playerId]).toMatchObject({ found: 1, delivered: 1 });
    room.dispose();
  });

  it('starts with whoever is connected, and turns away a resume of whoever was left out', () => {
    const room = new Room('TEST', mission);
    const anna = { ...room.join('Anna'), ...collector() };
    const ben = { ...room.join('Ben'), ...collector() };
    const cleo = room.join('Cleo');
    room.attach(anna.playerId, anna.listen);
    room.attach(ben.playerId, ben.listen);
    const cleoGone = room.attach(cleo.playerId, () => undefined);
    expect(room.summary()).toMatchObject({ capacity: 3, free: 0 });
    cleoGone();
    room.setReady(ben.playerId, true);
    room.act(anna.playerId, { kind: 'start-mission' });
    const view = lastView(anna.messages);
    expect(view.phase).toBe('playing');
    expect(view.players.map((p) => p.name)).toEqual(['Anna', 'Ben']);
    expect(view.pausedFor).toBeNull();
    expect(() => room.resume(cleo.playerId, cleo.token)).toThrow(/ohne diese Verbindung begonnen/);
    expect(() => room.resume(cleo.playerId, cleo.token)).toThrow(/Wiederverbinden fehlgeschlagen/);
    room.dispose();
  });
});

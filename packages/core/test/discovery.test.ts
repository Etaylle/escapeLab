import { describe, expect, it } from 'vitest';
import {
  applyAction,
  CHIME_GAP_MS,
  findables,
  findKey,
  lookAround,
  shutDoors,
  viewFor,
  viewForSpectator,
  type Find,
  type GameState,
} from '../src/index.js';
import { findOf, inCone, mattering, type Findable, type Looker } from '../src/discovery.js';
import { blackoutMission } from './blackoutPlan.js';
import { consoleLab, lightsOut, standing, started, T0 } from './lab.js';

/** A source to find at (x, y). */
const source = (id: string, x: number, y: number): Findable => ({
  find: { of: 'source', id },
  key: `source:${id}`,
  x,
  y,
});

/** A part lying at (x, y). */
const part = (id: string, x: number, y: number): Findable => ({
  find: { of: 'item', id },
  key: `item:${id}`,
  x,
  y,
});

const WEST = Math.PI;
const EAST = 0;
const NORTH = -Math.PI / 2;
const NOTHING_SHUT: ReadonlySet<string> = new Set();

/**
 * A room with a pillar.
 *
 *   012345678901
 * 0 ############
 * 1 #..........#
 * 2 #....#.....#   pillar (5,2)
 * 3 #..........#
 * 4 ############
 */
const ROOM = {
  tiles: ['############', '#..........#', '#....#.....#', '#..........#', '############'],
};

/** What `looker` finds of `things` in ROOM at `now`, nothing glanced at before. */
function foundIn(looker: Looker, things: Findable[], now = T0): string[] {
  return lookAround(ROOM, NOTHING_SHUT, looker, things, {}, now).found;
}

describe('finding by reach', () => {
  it('finds what lies within two tiles with nothing between, and nothing a step further', () => {
    // Facing the west wall: the lamp's cone finds nothing to the east.
    const looker = { x: 1.5, y: 1.5, facing: WEST };
    const things = [
      source('zwei', 3.5, 1.5),
      source('mehr', 3.6, 1.5),
      source('schraeg', 2.9, 2.9),
    ];
    expect(foundIn(looker, things)).toEqual(['source:zwei', 'source:schraeg']);
  });

  it('finds nothing behind a wall, however near', () => {
    const looker = { x: 4.5, y: 2.5, facing: WEST };
    // 1.8 tiles east, the pillar between.
    expect(foundIn(looker, [source('dahinter', 6.3, 2.5)])).toEqual([]);
    expect(foundIn({ ...looker, x: 6.9 }, [source('dahinter', 6.3, 2.5)])).toEqual([
      'source:dahinter',
    ]);
  });

  it('finds a part within 0.9 tiles whatever stands between: it lies at one’s feet', () => {
    // Two walls meet at the corner (2,2) between the player and the floor beyond it.
    const corner = { tiles: ['#####', '#.#.#', '##..#', '#####'] };
    const looker = { x: 1.9, y: 1.9, facing: WEST };
    const look = (thing: Findable) =>
      lookAround(corner, NOTHING_SHUT, looker, [thing], {}, T0).found;
    expect(look(part('sicherung', 2.4, 2.4))).toEqual(['item:sicherung']);
    expect(look(source('buch', 2.4, 2.4))).toEqual([]);
  });
});

describe('finding by the lamp', () => {
  const hall = { tiles: ['##########', '#........#', '##########'] };
  // Three tiles ahead: as far as the lamp finds, past the reach that finds outright.
  const ahead = source('tafel', 4.5, 1.5);
  const look = (facing: number, glances = {}, now = T0) =>
    lookAround(hall, NOTHING_SHUT, { x: 1.5, y: 1.5, facing }, [ahead], glances, now);

  it('finds what stays in the cone for 600 ms, and nothing before', () => {
    const first = look(EAST);
    expect(first).toEqual({ found: [], glances: { 'source:tafel': T0 }, dueAt: T0 + 600 });
    expect(look(EAST, first.glances, T0 + 599).found).toEqual([]);
    expect(look(EAST, first.glances, T0 + 600)).toEqual({
      found: ['source:tafel'],
      glances: {},
      dueAt: null,
    });
  });

  it('starts a glance cut short anew', () => {
    const first = look(EAST);
    const away = look(WEST, first.glances, T0 + 500);
    expect(away).toEqual({ found: [], glances: {}, dueAt: null });
    const again = look(EAST, away.glances, T0 + 700);
    expect(again.glances).toEqual({ 'source:tafel': T0 + 700 });
    expect(look(EAST, again.glances, T0 + 1299).found).toEqual([]);
    expect(look(EAST, again.glances, T0 + 1300).found).toEqual(['source:tafel']);
  });

  it('reaches 3 tiles, half a radian either side, and no further', () => {
    const floor = Array<string>(12).fill(`#${'.'.repeat(18)}#`);
    const open = { tiles: ['#'.repeat(20), ...floor, '#'.repeat(20)] };
    const from = { x: 1.5, y: 6.5, facing: EAST };
    const at = (away: number, angle: number) => ({
      x: from.x + away * Math.cos(angle),
      y: from.y + away * Math.sin(angle),
    });
    const lit = (away: number, angle: number) => inCone(open, NOTHING_SHUT, from, at(away, angle));
    expect([lit(3, 0), lit(3.1, 0)]).toEqual([true, false]);
    expect([lit(2.5, 0.49), lit(2.5, -0.49), lit(2.5, 0.51), lit(2.5, -0.51)]).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it('finds nothing beyond its reach however long it rests there, till one comes nearer', () => {
    const far = source('tafel', 6.5, 1.5);
    const from = (x: number) => ({ x, y: 1.5, facing: EAST });
    // Five tiles off, straight ahead: no glance even begins.
    expect(lookAround(hall, NOTHING_SHUT, from(1.5), [far], {}, T0)).toEqual({
      found: [],
      glances: {},
      dueAt: null,
    });
    // 2.9 tiles off, a minute later: the lamp starts to find it.
    const nearer = lookAround(hall, NOTHING_SHUT, from(3.6), [far], {}, T0 + 60_000);
    expect(nearer.glances).toEqual({ 'source:tafel': T0 + 60_000 });
  });

  it('is cut off by walls and doors shut, and goes through a door open', () => {
    // 2.8 tiles east: the pillar (5,2) between on row 2, nothing between on row 1.
    const behind = { x: 6.3, y: 2.5 };
    expect(inCone(ROOM, NOTHING_SHUT, { x: 3.5, y: 2.5, facing: EAST }, behind)).toBe(false);
    expect(inCone(ROOM, NOTHING_SHUT, { x: 3.5, y: 1.5, facing: EAST }, { x: 6.3, y: 1.5 })).toBe(
      true,
    );
    const doorway = { tiles: ['#######', '#.....#', '#######'] };
    const looker = { x: 1.5, y: 1.5, facing: EAST };
    const past = { x: 4.4, y: 1.5 };
    expect(inCone(doorway, new Set(['3,1']), looker, past)).toBe(false);
    expect(inCone(doorway, NOTHING_SHUT, looker, past)).toBe(true);
  });
});

/** Blackout on the pinned seed, the lights out, nobody found anything. */
function blackout(): GameState {
  return lightsOut(started(blackoutMission(), 5));
}

/** What a player standing at `looker` finds in `state` at once, nothing glanced at before. */
function findsIn(state: GameState, looker: Looker): string[] {
  const map = state.mission.map;
  return lookAround(map, shutDoors(map, state), looker, findables(state), {}, T0).found;
}

describe('what a run has to find', () => {
  it('lists the sources as placed, notes on their faces, loose parts, consoles, the sign', () => {
    const state = blackout();
    const things = findables(state);
    const at = (key: string) => things.find((thing) => thing.key === key);
    expect(at('source:buch-archiv')).toMatchObject({ x: 6.5, y: 1.5 });
    // The note on the Archiv's north wall (2,0) hangs on its south face, over (2,1).
    expect(at('note:2')?.x).toBe(2.5);
    expect(at('note:2')?.y).toBeCloseTo(1.05);
    expect(at('item:ersatzsicherung')).toMatchObject({ x: 7.5, y: 5.5 });
    expect(at('console:notlicht/-')).toMatchObject({ x: 11.5, y: 7.5 });
    expect(at('sign')).toMatchObject({ x: 2.5, y: 3.5 });
    expect(things.some((thing) => thing.key.includes('shelf'))).toBe(false);
    const carried = applyAction(state, {
      type: 'pick-item',
      playerId: 'p1',
      itemId: 'ersatzsicherung',
      at: T0,
    });
    expect(findables(carried).some((thing) => thing.key === 'item:ersatzsicherung')).toBe(false);
  });

  it('lists only the armed station’s consoles: none while the lights burn or all is done', () => {
    const consoles = (state: GameState) =>
      findables(state)
        .filter((thing) => thing.find.of === 'console')
        .map((thing) => thing.key);
    expect(consoles(started(blackoutMission(), 5))).toEqual([]);
    expect(consoles(blackout())).toEqual(['console:notlicht/-']);
    const notstrom = { ...blackout(), currentPuzzleIndex: 1 };
    expect(consoles(notstrom)).toEqual(['console:notstrom/a', 'console:notstrom/b']);
    const done = { ...blackout(), currentPuzzleIndex: blackout().mission.puzzles.length };
    expect(consoles(done)).toEqual([]);
  });

  it('finds the lever passed in the lit opening once the lights die, and it chimes then', () => {
    // Who skipped the intro walks the lit lab while the crew still watches, up to the lever.
    const byLever = { x: 10.5, y: 7.5, facing: EAST };
    const lightsOn = started(blackoutMission(), 5);
    const passed = findsIn(lightsOn, byLever);
    expect(passed.some((key) => key.startsWith('console:'))).toBe(false);
    const walked = standing(lightsOn, { found: { p1: passed }, at: T0 + 1000 });
    // The lights die with them still there: the lever is up now, found and chiming.
    const dark = lightsOut(walked, T0 + 6000);
    const fresh = findsIn(dark, byLever).filter((key) => !passed.includes(key));
    expect(fresh).toEqual(['console:notlicht/-']);
    const after = standing(dark, { found: { p1: fresh }, at: T0 + 6000 });
    expect(after.discoveries['p1']?.at(-1)).toEqual({
      key: 'console:notlicht/-',
      at: T0 + 6000,
      chime: true,
    });
  });

  it('keys every thing apart, both consoles of a station too, and finds each by its key', () => {
    const map = consoleLab().map;
    const finds: Find[] = [
      { of: 'source', id: 'buch' },
      { of: 'console', puzzleId: 'kette', console: 'a' },
      { of: 'console', puzzleId: 'kette', console: 'b' },
      { of: 'console', puzzleId: 'kabel', console: null },
      { of: 'sign' },
    ];
    expect(finds.map(findKey)).toEqual([
      'source:buch',
      'console:kette/a',
      'console:kette/b',
      'console:kabel/-',
      'sign',
    ]);
    expect(finds.map((find) => findOf(map, findKey(find)))).toEqual(finds);
    expect(findOf(map, 'source:nix')).toBeNull();
  });
});

describe('a room the power lights', () => {
  // Blackout's lever lights the Flur and the Archiv: it is the first station.
  const lit = (): GameState => ({ ...blackout(), currentPuzzleIndex: 1 });

  it('shows every player the whole lab while the power is on: what and where, no names', () => {
    const mission = blackoutMission();
    const map = (state: GameState) => viewFor(state, 'p1').map;
    const glimpsedAll = (state: GameState) => {
      const view = map(state);
      expect(view?.manuals.length).toBe(mission.map.manuals.length);
      expect(view?.notes.length).toBe(mission.map.notes.length);
      expect(view?.items.length).toBe(mission.map.items.length);
      const things = [...(view?.manuals ?? []), ...(view?.notes ?? [])];
      expect(things.every((m) => !m.known && m.seen)).toBe(true);
      expect(JSON.stringify(view?.manuals)).not.toMatch(/label|puzzleIds|needsKey/);
    };
    // The opening, before the lights fail: nothing in anybody's sight, all of it seen.
    const opening = started(mission, 5);
    expect(opening.presence.sight).toEqual({});
    glimpsedAll(opening);
    // In the dark, out of everybody's sight: none of it.
    const dark = blackout();
    expect([map(dark)?.manuals, map(dark)?.notes, map(dark)?.items]).toEqual([[], [], []]);
    // Every station solved, the way out open: the lab lights up whole again.
    glimpsedAll({ ...dark, currentPuzzleIndex: mission.puzzles.length });
  });

  it('finds nothing for a player one or two steps in but what the same two rules find', () => {
    const state = lit();
    expect(viewFor(state, 'p1').map?.litRooms).toEqual(['FLUR', 'ARCHIV']);
    const map = state.mission.map;
    // One step in from the door at (4,6), facing in: the book on its lectern at (6,1) lies in
    // the lamp's cone, 4.5 tiles off — beyond its reach, so no look at it even begins.
    const in1 = { x: 4.5, y: 5.5, facing: NORTH };
    const look = lookAround(map, shutDoors(map, state), in1, findables(state), {}, T0);
    expect(look).toEqual({ found: [], glances: {}, dueAt: null });
    // Two steps in: the shelves, nothing to find.
    const in2 = { x: 4.5, y: 4.5, facing: NORTH };
    expect(findsIn(state, in2)).toEqual([]);
    expect(findsIn(blackout(), in2)).toEqual([]);
  });

  it('finds the sign by the shelves, the book across the room only from nearer', () => {
    const state = lit();
    const byShelves = { x: 3.5, y: 3.5, facing: WEST };
    expect(findsIn(state, byShelves)).toEqual(['sign']);
    // The book on its lectern at (6,1), the lamp held on it: 3.6 tiles off, it is never found.
    const map = state.mission.map;
    const shut = shutDoors(map, state);
    const things = findables(state).filter((thing) => thing.key !== 'sign');
    const atBook = (x: number, y: number) => ({ x, y, facing: Math.atan2(1.5 - y, 6.5 - x) });
    expect(lookAround(map, shut, atBook(3.5, 3.5), things, {}, T0)).toEqual({
      found: [],
      glances: {},
      dueAt: null,
    });
    // A step nearer, 2.8 tiles off: found once the lamp has rested on it for 600 ms.
    const nearer = atBook(4.5, 3.5);
    const glance = lookAround(map, shut, nearer, things, {}, T0);
    expect(glance).toEqual({ found: [], glances: { 'source:buch-archiv': T0 }, dueAt: T0 + 600 });
    expect(lookAround(map, shut, nearer, things, glance.glances, T0 + 599).found).toEqual([]);
    const later = lookAround(map, shut, nearer, things, glance.glances, T0 + 600);
    expect(later.found).toEqual(['source:buch-archiv']);
  });
});

describe('discoveries and their chime', () => {
  /** The double console lab with its lights out: the Signalkette armed, the book its rules. */
  const armed = (): GameState => lightsOut(started(consoleLab()));
  /** A player's discoveries: what, how long after T0, and whether it chimes. */
  const listed = (state: GameState, playerId: string) =>
    (state.discoveries[playerId] ?? []).map((one) => [one.key, one.at - T0, one.chime]);

  it('lists a find once, its chime once in 1.5 s a player; a find in the gap stays silent', () => {
    const first = standing(armed(), { found: { p1: ['sign'] }, at: T0 });
    expect(listed(first, 'p1')).toEqual([['sign', 0, true]]);
    const inTheGap = standing(first, { found: { p1: ['source:buch'] }, at: T0 + 1000 });
    expect(inTheGap.found['p1']).toEqual(['sign', 'source:buch']);
    // Found in the gap, the book is a discovery all the same: its caption shows, its chime not.
    expect(listed(inTheGap, 'p1')).toEqual([
      ['sign', 0, true],
      ['source:buch', 1000, false],
    ]);
    // The gap runs from the last chime, not from the last discovery.
    const after = standing(inTheGap, {
      found: { p1: ['console:kette/a'] },
      at: T0 + CHIME_GAP_MS,
    });
    expect(listed(after, 'p1').at(-1)).toEqual(['console:kette/a', 1500, true]);
    // Found again later, nothing is listed twice and nothing chimes.
    const again = standing(after, { found: { p1: ['source:buch', 'sign'] }, at: T0 + 9000 });
    expect(listed(again, 'p1')).toEqual(listed(after, 'p1'));
    // Ben's are his own: the sign chimes for him in the middle of Anna's gap.
    const ben = standing(first, { found: { p2: ['sign'] }, at: T0 + 100 });
    expect(listed(ben, 'p2')).toEqual([['sign', 100, true]]);
  });

  it('lists what matters of the finds made at once, the most first, which alone chimes', () => {
    const state = standing(armed(), {
      found: { p1: ['sign', 'console:kabel/-', 'source:buch', 'console:kette/b'] },
      at: T0,
    });
    // The Kabel station's console is not up: it is found, but no discovery.
    expect(listed(state, 'p1')).toEqual([
      ['console:kette/b', 0, true],
      ['source:buch', 0, false],
      ['sign', 0, false],
    ]);
    expect(viewFor(state, 'p1').map?.discoveries).toEqual([
      { find: { of: 'console', puzzleId: 'kette', console: 'b' }, at: T0, chime: true },
      { find: { of: 'source', id: 'buch' }, at: T0, chime: false },
      { find: { of: 'sign' }, at: T0, chime: false },
    ]);
    expect(viewFor(state, 'p2').map?.discoveries).toEqual([]);
    expect(viewForSpectator(state).map?.discoveries).toEqual([]);
  });

  it('matters for the armed station’s consoles and rules, a part, a note, the sign', () => {
    const state = armed();
    const how = (find: Find) => mattering(state, find);
    expect(how({ of: 'console', puzzleId: 'kette', console: 'a' })).toBe(0);
    expect(how({ of: 'source', id: 'buch' })).toBe(1);
    expect(how({ of: 'item', id: 'sicherung' })).toBe(2);
    expect(how({ of: 'note', index: 0 })).toBe(3);
    expect(how({ of: 'sign' })).toBe(4);
    // A console of a station still to come, or one done, would drown the one at hand.
    const kabel: Find = { of: 'console', puzzleId: 'kabel', console: null };
    expect(how(kabel)).toBeNull();
    const solved = { ...state, currentPuzzleIndex: 1 };
    expect(mattering(solved, kabel)).toBe(0);
    expect(mattering(solved, { of: 'console', puzzleId: 'kette', console: 'a' })).toBeNull();
    // With the power still on, no station is armed: neither its console nor its rules matter.
    const lightsOn = started(blackoutMission(), 5);
    expect(mattering(lightsOn, { of: 'source', id: 'buch-archiv' })).toBeNull();
    expect(mattering(lightsOn, { of: 'console', puzzleId: 'notlicht', console: null })).toBeNull();
  });

  it('stays silent for the rules of a station not armed', () => {
    // Blackout's book prints the Notstrom-Kasten's rules; the lever is armed.
    expect(mattering(blackout(), { of: 'source', id: 'buch-archiv' })).toBeNull();
    const notstrom = { ...blackout(), currentPuzzleIndex: 1 };
    expect(mattering(notstrom, { of: 'source', id: 'buch-archiv' })).toBe(1);
  });
});

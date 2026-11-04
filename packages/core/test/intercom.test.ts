import { describe, expect, it } from 'vitest';
import {
  applyAction,
  intercomOf,
  parseMission,
  stationKey,
  viewFor,
  viewForSpectator,
} from '../src/index.js';
import type { Action, GameState, Mission } from '../src/index.js';
import { decide } from '../src/puzzles/wiring.js';
import { lightsOut, standing, started, T0 } from './lab.js';

/**
 * A corridor for three round the Signalkette's two consoles, a at the west end and b at the
 * east end, with the wiring box between them, which comes after it. A book, a locker still to
 * be searched and a clipboard cover the Signalkette; a chart covers the box alone.
 *
 *   0123456789012345678
 * 0 ###################
 * 1 #.................#   console a (2,1); box (9,1); console b (16,1)
 * 2 #.................#   spawns (1,2) (2,2) (3,2); book (5,2); locker (9,2); chart (11,2);
 * 3 ###################   clipboard (13,2); sign (17,2)
 */
function funkLab(extra: object = {}): Mission {
  const row = `#${'.'.repeat(17)}#`;
  const source = (id: string, kind: string, label: string, covers: string, x: number) => ({
    id,
    kind,
    label,
    puzzleIds: [covers],
    spots: [{ x, y: 2 }],
  });
  return parseMission({
    id: 'sprechanlage',
    title: 'Sprechanlage',
    players: { min: 3, max: 3 },
    story: { intro: 'i', win: 'w', lose: 'l' },
    timeLimitSec: 600,
    puzzles: [
      { type: 'signal', id: 'kette', title: 'Signalkette' },
      { type: 'wiring', id: 'kabel', title: 'Kabel' },
    ],
    map: {
      tiles: ['#'.repeat(19), row, row, '#'.repeat(19)],
      spawns: [
        { x: 1, y: 2 },
        { x: 2, y: 2 },
        { x: 3, y: 2 },
      ],
      stations: [
        { puzzleId: 'kette', x: 2, y: 1, console: 'a' },
        { puzzleId: 'kette', x: 16, y: 1, console: 'b' },
        { puzzleId: 'kabel', x: 9, y: 1 },
      ],
      manuals: [
        source('buch', 'book', 'HANDBUCH', 'kette', 5),
        source('spind', 'locker', 'SPIND', 'kette', 9),
        source('tafel', 'chart', 'TAFEL', 'kabel', 11),
        source('klemmbrett', 'clipboard', 'KLEMMBRETT', 'kette', 13),
      ],
      edgeworkSign: { x: 17, y: 2 },
    },
    ...extra,
  });
}

const CONSOLE_B = stationKey({ puzzleId: 'kette', console: 'b' });

/** The intercom as each of the crew's views carries it, by player id: undefined where left out. */
function heardBy(state: GameState): Record<string, string[] | undefined> {
  return Object.fromEntries(
    state.players.map((player) => [player.id, viewFor(state, player.id).intercom]),
  );
}

describe('the station’s intercom', () => {
  it('joins the two consoles of the armed station, in the views of the two alone', () => {
    const manned = { stations: { kette: ['p1'], [CONSOLE_B]: ['p2'] } };
    const state = standing(started(funkLab()), manned);
    expect(intercomOf(state)).toEqual(['p1', 'p2']);
    expect(heardBy(state)).toEqual({ p1: ['p1', 'p2'], p2: ['p1', 'p2'], p3: undefined });
    // Somebody at none of its places is told nothing of it.
    expect(JSON.stringify(viewFor(state, 'p3'))).not.toContain('"intercom"');
    expect(JSON.stringify(viewForSpectator(state))).not.toContain('"intercom"');
  });

  it('joins a console and a source of the station, and two sources of it', () => {
    const lab = started(funkLab());
    const read = standing(lab, {
      stations: { [CONSOLE_B]: ['p1'] },
      manuals: { buch: ['p2'], klemmbrett: ['p3'] },
    });
    expect(intercomOf(read)).toEqual(['p1', 'p2', 'p3']);
    const sources = standing(lab, { manuals: { buch: ['p2'], klemmbrett: ['p3'] } });
    expect(heardBy(sources)).toEqual({ p1: undefined, p2: ['p2', 'p3'], p3: ['p2', 'p3'] });
  });

  it('leaves out a station not armed, a source of another and a locker not yet searched', () => {
    const lab = started(funkLab());
    const elsewhere = standing(lab, {
      stations: { kabel: ['p1'] },
      manuals: { tafel: ['p2'], spind: ['p3'] },
    });
    expect(intercomOf(elsewhere)).toEqual([]);
    expect(heardBy(elsewhere)).toEqual({ p1: undefined, p2: undefined, p3: undefined });
    const searched = applyAction(elsewhere, {
      type: 'open-source',
      playerId: 'p3',
      manualId: 'spind',
      at: T0 + 500,
    });
    expect(intercomOf(searched)).toEqual(['p3']);
  });

  it('is nobody’s while the lights are still on, and comes with the blackout', () => {
    const lit = started(funkLab({ intro: { lightsSec: 30 } }));
    const manned = standing(lit, { stations: { kette: ['p1'], [CONSOLE_B]: ['p2'] } });
    expect(intercomOf(manned)).toEqual([]);
    expect(heardBy(manned).p1).toBeUndefined();
    expect(intercomOf(lightsOut(manned, T0 + 1000))).toEqual(['p1', 'p2']);
  });
});

/**
 * One wiring box for two, its book beside it and the hatch at the east end.
 *
 *   0123456789012
 * 0 #############
 * 1 #...........#   box (3,1)
 * 2 #...........#   spawns (1,1) (1,2); book (6,2); sign (9,2); exit (11,2)
 * 3 #############
 */
const lastBox: Mission = parseMission({
  id: 'letzte',
  title: 'Letzte Station',
  players: { min: 2, max: 2 },
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  puzzles: [{ type: 'wiring', id: 'kabel', title: 'Kabel' }],
  map: {
    tiles: ['#############', '#...........#', '#...........#', '#############'],
    spawns: [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
    ],
    stations: [{ puzzleId: 'kabel', x: 3, y: 1 }],
    manuals: [
      {
        id: 'buch',
        kind: 'book',
        label: 'HANDBUCH',
        puzzleIds: ['kabel'],
        spots: [{ x: 6, y: 2 }],
      },
    ],
    edgeworkSign: { x: 9, y: 2 },
    exit: { x: 11, y: 2 },
  },
});

describe('the intercom once the last station is solved', () => {
  it('goes quiet for the run to the hatch, the two still standing where they worked', () => {
    const working = { stations: { kabel: ['p1'] }, manuals: { buch: ['p2'] } };
    const here = standing(started(lastBox), working);
    expect(intercomOf(here)).toEqual(['p1', 'p2']);
    const open = applyAction(here, { type: 'interact', playerId: 'p1', at: T0 + 500 });
    const wiring = open.puzzleState;
    if (wiring?.type !== 'wiring' || open.edgework === null) {
      throw new Error('expected the open wiring box');
    }
    const right = decide(
      wiring.wires.map((wire) => wire.color),
      open.edgework,
    ).wire;
    const wireId = wiring.wires[right]?.id;
    const cut: Action = { type: 'puzzle-input', playerId: 'p1', at: T0 + 1000, input: { wireId } };
    const solved = applyAction(open, cut);
    expect(solved.phase).toBe('playing');
    expect(solved.currentPuzzleIndex).toBe(1);
    expect(intercomOf(solved)).toEqual([]);
    expect(heardBy(solved)).toEqual({ p1: undefined, p2: undefined });
  });
});

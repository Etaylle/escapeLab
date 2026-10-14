import { describe, expect, it, vi } from 'vitest';
import {
  applyAction,
  initialState,
  parseMission,
  stationKey,
  viewFor,
  viewForSpectator,
} from '../src/index.js';
import type { Action, GameState, Mission } from '../src/index.js';
import { decide, wiringModule } from '../src/puzzles/wiring.js';
import { consoleLab, labMission, standing, T0 } from './lab.js';

const ALONE = 'Allein geht das nicht — jemand muss am anderen Pult oder bei den Regeln stehen.';

/**
 * A corridor with the wiring box at its west end and two sources of its
 * rules further east: a book, and a locker that has to be searched first.
 *
 *   0123456789012
 * 0 #############
 * 1 #...........#   box (3,1)
 * 2 #...........#   spawns (1,1) (1,2) (2,2); book (6,2); locker (9,2); sign (11,2)
 * 3 #############
 */
const workshop: Mission = parseMission({
  id: 'werkbank',
  title: 'Werkbank',
  players: { min: 3, max: 3 },
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  puzzles: [{ type: 'wiring', id: 'kabel', title: 'Kabel' }],
  map: {
    tiles: ['#############', '#...........#', '#...........#', '#############'],
    spawns: [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
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
      {
        id: 'spind',
        kind: 'locker',
        label: 'SPIND',
        puzzleIds: ['kabel'],
        spots: [{ x: 9, y: 2 }],
      },
    ],
    edgeworkSign: { x: 11, y: 2 },
  },
});

/** The smallest crew the mission takes — Anna (p1), Ben (p2), Cleo (p3) — on its way. */
function crewed(mission: Mission): GameState {
  const names = ['Anna', 'Ben', 'Cleo'].slice(0, mission.players.min);
  const actions: Action[] = [
    ...names.map((name, i): Action => ({ type: 'player-join', playerId: `p${i + 1}`, name })),
    ...names.slice(1).map((_, i): Action => ({
      type: 'set-ready',
      playerId: `p${i + 2}`,
      ready: true,
    })),
    { type: 'start-mission', playerId: 'p1', at: T0, seed: 7 },
  ];
  return actions.reduce(applyAction, initialState(mission));
}

/** The workshop's box switched on by Anna, with Ben at the book. */
function boxOpen(): GameState {
  const here = standing(crewed(workshop), {
    stations: { kabel: ['p1'] },
    manuals: { buch: ['p2'] },
  });
  return applyAction(here, { type: 'interact', playerId: 'p1', at: T0 + 500 });
}

/** A cut at the open box by `playerId`: the one its rules name, or any other. */
function cut(state: GameState, playerId: string, which: 'right' | 'wrong'): Action {
  const wiring = state.puzzleState;
  if (wiring?.type !== 'wiring' || state.edgework === null) {
    throw new Error('expected the open wiring box');
  }
  const right = decide(
    wiring.wires.map((w) => w.color),
    state.edgework,
  ).wire;
  const wire = wiring.wires.find((_, i) => (which === 'right') === (i === right));
  return { type: 'puzzle-input', playerId, at: T0 + 1000, input: { wireId: wire?.id } };
}

const CONSOLE_B = stationKey({ puzzleId: 'kette', console: 'b' });

/**
 * The console lab's Signalkette switched on with Anna at console a, who
 * reads stage 1's first sign there; then who stands at console a, at
 * console b and at the book — and Ben's press of that sign at console b.
 */
function chainOpen(at: { a: string[]; b: string[]; book: string[] }): {
  state: GameState;
  press: Action;
} {
  const manned = { kette: ['p1'], [CONSOLE_B]: ['p2'] };
  const here = standing(crewed(consoleLab(3)), { stations: manned });
  const open = applyAction(here, { type: 'interact', playerId: 'p1', at: T0 + 500 });
  const sends = viewFor(open, 'p1').puzzle;
  const sign = sends?.kind === 'signal' ? sends.sequence?.[0] : undefined;
  return {
    state: standing(open, {
      stations: { kette: at.a, [CONSOLE_B]: at.b },
      manuals: { buch: at.book },
    }),
    press: { type: 'puzzle-input', playerId: 'p2', at: T0 + 1000, input: { press: sign } },
  };
}

describe('an input at a station', () => {
  it('counts at a station of one console while somebody else reads its rules', () => {
    const solved = applyAction(boxOpen(), cut(boxOpen(), 'p1', 'right'));
    // the box is the workshop's only station: solving it wins the run
    expect(solved.phase).toBe('won');
    expect(solved.penaltySeq).toBe(0);
  });

  it('is turned away without an alarm once the reader walks off, and counts on return', () => {
    const open = boxOpen();
    // With the reader there, a wrong cut is an alarm …
    expect(applyAction(open, cut(open, 'p1', 'wrong')).penaltySeq).toBe(1);
    // … alone, the same cut is refused before it reaches the box.
    const alone = standing(open, { stations: { kabel: ['p1'] } });
    expect(() => applyAction(alone, cut(alone, 'p1', 'wrong'))).toThrow(ALONE);
    expect(() => applyAction(alone, cut(alone, 'p1', 'right'))).toThrow(ALONE);
    const back = standing(alone, { stations: { kabel: ['p1'] }, manuals: { buch: ['p2'] } });
    expect(applyAction(back, cut(back, 'p1', 'right')).phase).toBe('won');
  });

  it('needs somebody else: a second player at the same console or at a shut locker is not', () => {
    const open = boxOpen();
    const crowded = standing(open, {
      stations: { kabel: ['p1', 'p2'] },
      manuals: { spind: ['p3'] },
    });
    expect(() => applyAction(crowded, cut(crowded, 'p2', 'right'))).toThrow(ALONE);
    // The mover reading too is no help either.
    const both = standing(open, { stations: { kabel: ['p1'] }, manuals: { buch: ['p1'] } });
    expect(() => applyAction(both, cut(both, 'p1', 'right'))).toThrow(ALONE);
    const searched = applyAction(crowded, {
      type: 'open-source',
      playerId: 'p3',
      manualId: 'spind',
      at: T0 + 800,
    });
    expect(applyAction(searched, cut(searched, 'p2', 'right')).phase).toBe('won');
  });

  it('counts at a station of two with the other console manned, nobody reading', () => {
    const manned = chainOpen({ a: ['p1'], b: ['p2'], book: [] });
    expect(applyAction(manned.state, manned.press).puzzleState).toMatchObject({ done: 1 });
    const empty = chainOpen({ a: [], b: ['p2'], book: [] });
    expect(() => applyAction(empty.state, empty.press)).toThrow(ALONE);
    // A reader lets the press through to the Signalkette, which wants its sending console manned.
    const read = chainOpen({ a: [], b: ['p2'], book: ['p3'] });
    expect(() => applyAction(read.state, read.press)).toThrow('Am sendenden Pult steht niemand.');
  });

  it('counts where the whole crew works the panel, with nobody reading', () => {
    const sync = labMission([{ type: 'button-sync', id: 'sync', title: 'Sync' }], 'gleichtakt');
    const here = standing(crewed(sync), { stations: { sync: ['p1'] } });
    const open = applyAction(here, { type: 'interact', playerId: 'p1', at: T0 + 500 });
    const press: Action = {
      type: 'puzzle-input',
      playerId: 'p1',
      at: T0 + 600,
      input: { press: true },
    };
    expect(applyAction(open, press).puzzleState).toMatchObject({ pressed: { p1: T0 + 600 } });
  });

  it('tells the module who reads — the mover too — and nobody while it sets up', () => {
    const init = vi.spyOn(wiringModule, 'init');
    const apply = vi.spyOn(wiringModule, 'apply');
    const open = boxOpen();
    const all = standing(open, { stations: { kabel: ['p1'] }, manuals: { buch: ['p1', 'p2'] } });
    applyAction(all, cut(all, 'p1', 'right'));
    expect(init.mock.calls[0]?.[2]).toMatchObject({ console: null, readers: [] });
    expect(apply.mock.calls[0]?.[4]).toMatchObject({ console: 'a', readers: ['p1', 'p2'] });
    init.mockRestore();
    apply.mockRestore();
  });
});

describe('the backup in the view', () => {
  it('names the reader and where they read, for the player at the station only', () => {
    const open = boxOpen();
    expect(viewFor(open, 'p1').puzzle?.backup).toEqual({ name: 'Ben', where: 'HANDBUCH' });
    expect(viewFor(open, 'p2').puzzle?.backup).toBeNull();
    expect(viewFor(open, 'p3').puzzle?.backup).toBeNull();
    expect(viewForSpectator(open).puzzle?.backup).toBeNull();
  });

  it('is null while nobody backs the player up, a shut locker included', () => {
    const open = boxOpen();
    const alone = standing(open, { stations: { kabel: ['p1'] } });
    expect(viewFor(alone, 'p1').puzzle?.backup).toBeNull();
    const shut = standing(open, { stations: { kabel: ['p1', 'p2'] }, manuals: { spind: ['p3'] } });
    expect(viewFor(shut, 'p1').puzzle?.backup).toBeNull();
    const searched = applyAction(shut, {
      type: 'open-source',
      playerId: 'p3',
      manualId: 'spind',
      at: T0 + 800,
    });
    expect(viewFor(searched, 'p1').puzzle?.backup).toEqual({ name: 'Cleo', where: 'SPIND' });
    expect(viewFor(searched, 'p2').puzzle?.backup).toEqual({ name: 'Cleo', where: 'SPIND' });
  });

  it('names the other console before a reader, at a station with two', () => {
    const all = chainOpen({ a: ['p1'], b: ['p2'], book: ['p3'] }).state;
    expect(viewFor(all, 'p1').puzzle?.backup).toEqual({ name: 'Ben', where: 'Pult B' });
    expect(viewFor(all, 'p2').puzzle?.backup).toEqual({ name: 'Anna', where: 'Pult A' });
    expect(viewFor(all, 'p3').puzzle?.backup).toBeNull();
    const left = chainOpen({ a: ['p1'], b: [], book: ['p3'] }).state;
    expect(viewFor(left, 'p1').puzzle?.backup).toEqual({ name: 'Cleo', where: 'HANDBUCH' });
  });

  it('is null where the whole crew works the panel, even with somebody at the book', () => {
    const sync = labMission([{ type: 'button-sync', id: 'sync', title: 'Sync' }], 'gleichtakt');
    const here = standing(crewed(sync), { stations: { sync: ['p1'] }, manuals: { buch: ['p2'] } });
    const open = applyAction(here, { type: 'interact', playerId: 'p1', at: T0 + 500 });
    expect(viewFor(open, 'p1').puzzle?.backup).toBeNull();
  });
});

const INSIDE = { x: 7, y: 3 };
const OUTSIDE = { x: 2, y: 3 };

/**
 * Two rooms: the west one with the spawns, the sign and a plate, the east
 * one with the wiring box behind a door that only the plate holds open —
 * until the box is solved, then it stays open. Each source of the box's
 * rules lies on the spots given.
 *
 *   0123456789
 * 0 ##########
 * 1 #....#...#   sign (2,1); box (7,1)
 * 2 #........#   spawns (1,1) (1,2) (1,3); plate (3,2); door (5,2)
 * 3 #....#...#   inside (7,3), outside (2,3)
 * 4 ##########
 */
function chamber(
  crew: number,
  sources: { x: number; y: number }[][],
  opensBy: object = { kind: 'plate', plateId: 'platte', untilSolved: 'kabel' },
): unknown {
  const labels = ['HANDBUCH', 'TAFEL'];
  return {
    id: 'kammer',
    title: 'Kammer',
    players: { min: crew, max: crew },
    story: { intro: 'i', win: 'w', lose: 'l' },
    timeLimitSec: 600,
    puzzles: [{ type: 'wiring', id: 'kabel', title: 'Kabel' }],
    map: {
      tiles: ['##########', '#....#...#', '#........#', '#....#...#', '##########'],
      spawns: [
        { x: 1, y: 1 },
        { x: 1, y: 2 },
        { x: 1, y: 3 },
      ],
      doors: [{ id: 'tuer', x: 5, y: 2, opensBy }],
      plates: [{ id: 'platte', x: 3, y: 2, label: 'HALTEN' }],
      stations: [{ puzzleId: 'kabel', x: 7, y: 1 }],
      manuals: sources.map((spots, i) => ({
        id: `quelle-${i}`,
        kind: 'book',
        label: labels[i] ?? 'HANDBUCH',
        puzzleIds: ['kabel'],
        spots,
      })),
      edgeworkSign: { x: 2, y: 1 },
    },
  };
}

describe('the map walk: a second player at every station', () => {
  it('turns down a station whose only rules lie behind its own door, for a crew of two', () => {
    expect(() => parseMission(chamber(2, [[INSIDE]]))).toThrow(
      'map: station "kabel" and its rules (HANDBUCH at 7,3) are never reachable by two ' +
        'different players at once — the crew would be alone (crew of 2 starting at 1,1 · 1,2)',
    );
  });

  it('takes the same room for three: the third holds the door', () => {
    expect(() => parseMission(chamber(3, [[INSIDE]]))).not.toThrow();
  });

  it('takes the rules outside the door, or one source of two that pairs up', () => {
    expect(() => parseMission(chamber(2, [[OUTSIDE]]))).not.toThrow();
    expect(() => parseMission(chamber(2, [[INSIDE], [OUTSIDE]]))).not.toThrow();
    expect(() => parseMission(chamber(2, [[INSIDE], [{ x: 8, y: 3 }]]))).toThrow(
      /its rules \(HANDBUCH at 7,3, TAFEL at 8,3\) are never reachable by two different players/,
    );
  });

  it('checks every spot the rules may be drawn to', () => {
    expect(() => parseMission(chamber(2, [[OUTSIDE, INSIDE]]))).toThrow(
      /station "kabel" and its rules \(HANDBUCH at 7,3\) are never reachable/,
    );
  });

  it('leaves a station nobody reaches to the check that says so', () => {
    const shut = () => parseMission(chamber(2, [[OUTSIDE]], { kind: 'puzzle', puzzleId: 'kabel' }));
    expect(shut).toThrow(/nobody can reach station "kabel"/);
    expect(shut).not.toThrow(/the crew would be alone/);
  });
});

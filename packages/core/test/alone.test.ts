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
import { chamber, consoleLab, INSIDE, labMission, OUTSIDE, standing, T0 } from './lab.js';

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

/** The open box with Anna at it and the rest of the crew nowhere near it or its rules. */
function aloneAtBox(): GameState {
  return standing(boxOpen(), { stations: { kabel: ['p1'] } });
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

/** What the Signalkette says to a press while nobody stands at the sending console. */
const NOBODY_SENDING = 'Am sendenden Pult steht niemand.';

describe('an input at a station', () => {
  it('counts at a station of one console with nobody else at it or at its rules', () => {
    const solved = applyAction(aloneAtBox(), cut(aloneAtBox(), 'p1', 'right'));
    // the box is the workshop's only station: solving it wins the run
    expect(solved.phase).toBe('won');
    expect(solved.penaltySeq).toBe(0);
  });

  it('takes a wrong move alone as an alarm, as it does with the reader there', () => {
    const alone = aloneAtBox();
    expect(applyAction(alone, cut(alone, 'p1', 'wrong')).penaltySeq).toBe(1);
    const read = boxOpen();
    expect(applyAction(read, cut(read, 'p1', 'wrong')).penaltySeq).toBe(1);
  });

  it('counts from whoever stands at the console, a second player there too', () => {
    const crowded = standing(boxOpen(), { stations: { kabel: ['p1', 'p2'] } });
    expect(applyAction(crowded, cut(crowded, 'p2', 'right')).phase).toBe('won');
  });

  it('leaves a station of two to its module: the chain wants its sending console manned', () => {
    const manned = chainOpen({ a: ['p1'], b: ['p2'], book: [] });
    expect(applyAction(manned.state, manned.press).puzzleState).toMatchObject({ done: 1 });
    for (const book of [[], ['p3']]) {
      const empty = chainOpen({ a: [], b: ['p2'], book });
      expect(() => applyAction(empty.state, empty.press)).toThrow(NOBODY_SENDING);
    }
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

  it('tells the module who reads — the mover too, or nobody — and nobody while it sets up', () => {
    const init = vi.spyOn(wiringModule, 'init');
    const apply = vi.spyOn(wiringModule, 'apply');
    const open = boxOpen();
    const all = standing(open, { stations: { kabel: ['p1'] }, manuals: { buch: ['p1', 'p2'] } });
    applyAction(all, cut(all, 'p1', 'right'));
    applyAction(aloneAtBox(), cut(aloneAtBox(), 'p1', 'right'));
    expect(init.mock.calls[0]?.[2]).toMatchObject({ console: null, readers: [] });
    expect(apply.mock.calls[0]?.[4]).toMatchObject({ console: 'a', readers: ['p1', 'p2'] });
    expect(apply.mock.calls[1]?.[4]).toMatchObject({ console: 'a', readers: [] });
    init.mockRestore();
    apply.mockRestore();
  });
});

/** Who the view names at the other console — Anna (p1), Ben (p2) or Cleo (p3). */
function named(playerId: 'p1' | 'p2' | 'p3') {
  const name = { p1: 'Anna', p2: 'Ben', p3: 'Cleo' }[playerId];
  return { playerId, name };
}

describe('the other console in the view', () => {
  it('names who stands at the other console, to each console of a station with two', () => {
    const all = chainOpen({ a: ['p1'], b: ['p2'], book: ['p3'] }).state;
    expect(viewFor(all, 'p1').puzzle?.atOtherConsole).toEqual(named('p2'));
    expect(viewFor(all, 'p2').puzzle?.atOtherConsole).toEqual(named('p1'));
    expect(viewFor(all, 'p3').puzzle?.atOtherConsole).toBeNull();
    expect(viewForSpectator(all).puzzle?.atOtherConsole).toBeNull();
  });

  it('is null while nobody stands at the other console, a reader at the book or not', () => {
    const left = chainOpen({ a: ['p1'], b: [], book: ['p3'] }).state;
    expect(viewFor(left, 'p1').puzzle?.atOtherConsole).toBeNull();
  });

  it('is null at a station of one console, and where the whole crew works the panel', () => {
    const open = boxOpen();
    expect(viewFor(open, 'p1').puzzle?.atOtherConsole).toBeNull();
    const sync = labMission([{ type: 'button-sync', id: 'sync', title: 'Sync' }], 'gleichtakt');
    const here = standing(crewed(sync), { stations: { sync: ['p1', 'p2'] } });
    const on = applyAction(here, { type: 'interact', playerId: 'p1', at: T0 + 500 });
    expect(viewFor(on, 'p1').puzzle?.atOtherConsole).toBeNull();
  });
});

describe('the map walk', () => {
  it('takes a station whose only rules lie behind its own door, for a crew of two', () => {
    expect(() => parseMission(chamber(2, [[INSIDE]]))).not.toThrow();
  });

  it('still turns down a station nobody reaches', () => {
    const shut = () => parseMission(chamber(2, [[OUTSIDE]], { kind: 'puzzle', puzzleId: 'kabel' }));
    expect(shut).toThrow(/nobody can reach station "kabel"/);
  });
});

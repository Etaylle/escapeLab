import { describe, expect, it } from 'vitest';
import {
  applyAction,
  crewOf,
  FIRST_WAIT_MS,
  LATER_WAIT_MS,
  parseMission,
  runReport,
  viewFor,
  viewForSpectator,
} from '../src/index.js';
import type { Action, GameState, Mission } from '../src/index.js';
import { consoleLab, lineBack, lineDrops, standing, started, T0 } from './lab.js';

/**
 * A corridor lab for three: two stations where the whole crew presses, (3,1) and (5,1), and
 * the hatch at its east end.
 *
 *   0123456789
 * 0 ##########
 * 1 #..1.2...#   spawns (1,1), (1,2), (2,2)
 * 2 #.......E#   the hatch (8,2)
 * 3 ##########
 */
const mission: Mission = parseMission({
  id: 'drei',
  title: 'Drei',
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  players: { min: 3, max: 3 },
  puzzles: [
    { type: 'button-sync', id: 'eins', title: 'Eins' },
    { type: 'button-sync', id: 'zwei', title: 'Zwei' },
  ],
  map: {
    tiles: ['##########', '#........#', '#........#', '##########'],
    spawns: [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ],
    stations: [
      { puzzleId: 'eins', x: 3, y: 1 },
      { puzzleId: 'zwei', x: 5, y: 1 },
    ],
    exit: { x: 8, y: 2 },
  },
});

const goOn = (playerId: string, absentId: string, at: number): Action => ({
  type: 'continue-without',
  playerId,
  absentId,
  at,
});
const callOff = (playerId: string, at: number): Action => ({ type: 'call-off', playerId, at });

function run(actions: Action[], from: GameState): GameState {
  return actions.reduce(applyAction, from);
}

/** `crew` at the armed station, switched on, every one of them pressing at `at`. */
function pressAll(state: GameState, crew: string[], at: number): GameState {
  const def = state.mission.puzzles[state.currentPuzzleIndex];
  if (def === undefined) {
    throw new Error('pressAll: every station is solved');
  }
  const here = standing(state, { stations: { [def.id]: crew } });
  const open = applyAction(here, { type: 'interact', playerId: crew[0] ?? 'p1', at });
  return crew.reduce(
    (next, playerId) =>
      applyAction(next, { type: 'puzzle-input', playerId, at, input: { press: true } }),
    open,
  );
}

const DROP_AT = T0 + 10_000;
const running = started(mission);
/** Cem (p3) dropped: the run stands still for him. */
const waiting = applyAction(running, lineDrops('p3', DROP_AT));

describe('a line dropping in a run', () => {
  it('stands the run still for everybody, from the moment it dropped', () => {
    expect(waiting.paused).toEqual({ since: DROP_AT });
    expect(waiting.away).toEqual({
      p3: { since: DROP_AT, waivableAt: DROP_AT + FIRST_WAIT_MS, waived: false },
    });
    for (const view of [viewFor(waiting, 'p1'), viewForSpectator(waiting)]) {
      expect(view.pausedFor).toEqual([
        { id: 'p3', name: 'p3', since: DROP_AT, waivableAt: DROP_AT + FIRST_WAIT_MS },
      ]);
      expect(view.pausedAt).toBe(DROP_AT);
    }
  });

  it('counts once, however often the room says it', () => {
    expect(applyAction(waiting, lineDrops('p3', DROP_AT + 5000))).toEqual(waiting);
  });

  it('ends no run: the clock, the hatch and a whole-crew station all wait', () => {
    expect(applyAction(waiting, { type: 'time-expired', at: T0 + 700_000 }).phase).toBe('playing');
    const crew = ['p1', 'p2', 'p3'];
    const escaping = pressAll(pressAll(running, crew, T0 + 1000), crew, T0 + 2000);
    expect(escaping.mission.map.exit).toBeDefined();
    const atHatch = standing(escaping, { exit: ['p1', 'p2'] });
    const gone = applyAction(atHatch, lineDrops('p3', T0 + 3000));
    expect(applyAction(gone, { type: 'escaped', at: T0 + 3500 })).toBe(gone);
    expect(gone.phase).toBe('playing');
  });

  it('is no pause outside a run', () => {
    const lost = applyAction(running, { type: 'time-expired', at: T0 + 700_000 });
    const dropped = applyAction(lost, lineDrops('p3', T0 + 700_100));
    expect(dropped.paused).toBeNull();
    expect(dropped.away).toEqual({});
    expect(dropped.players.find((p) => p.id === 'p3')?.connected).toBe(false);
  });
});

describe('a line back', () => {
  it('ends the pause it caused, every deadline moved on by it', () => {
    const back = applyAction(waiting, lineBack('p3', DROP_AT + 30_000));
    expect(back.paused).toBeNull();
    expect(back.away).toEqual({});
    expect(back.deadlineAt).toBe((running.deadlineAt ?? 0) + 30_000);
  });
});

describe('going on without somebody away', () => {
  it('waits a minute for the first drop of a run', () => {
    const early = DROP_AT + FIRST_WAIT_MS - 1;
    expect(() => applyAction(waiting, goOn('p1', 'p3', early))).toThrow(
      'Die Wartezeit läuft noch.',
    );
    const on = applyAction(waiting, goOn('p1', 'p3', DROP_AT + FIRST_WAIT_MS));
    expect(on.paused).toBeNull();
    expect(on.away['p3']?.waived).toBe(true);
    expect(on.deadlineAt).toBe((running.deadlineAt ?? 0) + FIRST_WAIT_MS);
    expect(viewFor(on, 'p1').players.find((p) => p.id === 'p3')).toMatchObject({
      connected: false,
      waived: true,
    });
    expect(viewFor(on, 'p1').pausedFor).toBeNull();
  });

  it('waits 20 s for every later drop of the run, whoever’s it is', () => {
    const back = applyAction(waiting, lineBack('p3', DROP_AT + 5000));
    const again = applyAction(back, lineDrops('p2', DROP_AT + 9000));
    expect(again.away['p2']?.waivableAt).toBe(DROP_AT + 9000 + LATER_WAIT_MS);
    expect(() => applyAction(again, goOn('p1', 'p2', DROP_AT + 9000 + LATER_WAIT_MS - 1))).toThrow(
      'Die Wartezeit läuft noch.',
    );
    expect(applyAction(again, goOn('p1', 'p2', DROP_AT + 9000 + LATER_WAIT_MS)).paused).toBeNull();
    const third = run([lineBack('p2', DROP_AT + 12_000), lineDrops('p3', DROP_AT + 13_000)], again);
    expect(third.away['p3']?.waivableAt).toBe(DROP_AT + 13_000 + LATER_WAIT_MS);
  });

  it('counts them out at a station the whole crew presses, and at the hatch', () => {
    const on = applyAction(waiting, goOn('p1', 'p3', DROP_AT + FIRST_WAIT_MS));
    expect(crewOf(on).map((p) => p.id)).toEqual(['p1', 'p2']);
    const at = DROP_AT + FIRST_WAIT_MS + 1000;
    const switchedOn = applyAction(standing(on, { stations: { eins: ['p1'] } }), {
      type: 'interact',
      playerId: 'p1',
      at,
    });
    expect(viewFor(switchedOn, 'p1').puzzle).toMatchObject({ requiredCount: 2, here: 1 });
    const pressed = pressAll(on, ['p1', 'p2'], at);
    expect(pressed.currentPuzzleIndex).toBe(1);
    const escaping = pressAll(pressed, ['p1', 'p2'], at + 1000);
    const onIt = standing(escaping, { exit: ['p1', 'p2'] });
    const won = applyAction(onIt, { type: 'escaped', at: at + 2000 });
    expect(won.phase).toBe('won');
  });

  it('keeps the rules of a station with two consoles: a move nobody backs is turned away', () => {
    const lab = consoleLab(3);
    const away = applyAction(started(lab), lineDrops('p3', DROP_AT));
    const on = applyAction(away, goOn('p1', 'p3', DROP_AT + FIRST_WAIT_MS));
    const at = DROP_AT + FIRST_WAIT_MS + 500;
    const open = applyAction(standing(on, { stations: { kette: ['p1'] }, signSeen: ['p1'] }), {
      type: 'interact',
      playerId: 'p1',
      at,
    });
    expect(() =>
      applyAction(open, { type: 'puzzle-input', playerId: 'p1', at, input: { kind: 'send' } }),
    ).toThrow(/Eingabe gesperrt/);
  });

  it('counts them in again the moment they are back, and pauses nothing for it', () => {
    const on = applyAction(waiting, goOn('p1', 'p3', DROP_AT + FIRST_WAIT_MS));
    const back = applyAction(on, lineBack('p3', DROP_AT + FIRST_WAIT_MS + 15_000));
    expect(back.paused).toBeNull();
    expect(back.away).toEqual({});
    expect(crewOf(back).map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(viewFor(back, 'p1').players.find((p) => p.id === 'p3')).not.toHaveProperty('waived');
    expect(back.deadlineAt).toBe(on.deadlineAt);
  });

  it('takes two of the crew on the line, and somebody away the run waits for', () => {
    const pair = started(consoleLab(2));
    const alone = applyAction(pair, lineDrops('p2', DROP_AT));
    expect(() => applyAction(alone, goOn('p1', 'p2', DROP_AT + FIRST_WAIT_MS))).toThrow(
      'Allein läuft kein Einsatz weiter.',
    );
    expect(() => applyAction(running, goOn('p1', 'p3', DROP_AT))).toThrow('Hier fehlt niemand.');
    const on = applyAction(waiting, goOn('p1', 'p3', DROP_AT + FIRST_WAIT_MS));
    expect(() => applyAction(on, goOn('p2', 'p3', DROP_AT + FIRST_WAIT_MS + 1))).toThrow(
      'Hier fehlt niemand.',
    );
  });
});

describe('calling a run off', () => {
  const pair = started(consoleLab(2));
  const alone = applyAction(pair, lineDrops('p2', DROP_AT));

  it('is for the one left on the line, once the wait is over: lost, called off', () => {
    expect(() => applyAction(alone, callOff('p1', DROP_AT + FIRST_WAIT_MS - 1))).toThrow(
      'Die Wartezeit läuft noch.',
    );
    const off = applyAction(alone, callOff('p1', DROP_AT + FIRST_WAIT_MS));
    expect(off.phase).toBe('lost');
    expect(off.paused).toBeNull();
    expect(off.calledOff).toBe('Abgebrochen ohne p2.');
    expect(off.events.at(-1)).toMatchObject({ kind: 'finish', label: 'Abgebrochen ohne p2.' });
    expect(runReport(off, 'ABCD').outcome).toBe('lost:abandoned');
    expect(viewFor(off, 'p1').calledOff).toBe('Abgebrochen ohne p2.');
    expect(viewForSpectator(off).calledOff).toBe('Abgebrochen ohne p2.');
  });

  it('is no way out while two are on the line, or nobody is missing', () => {
    expect(() => applyAction(waiting, callOff('p1', DROP_AT + FIRST_WAIT_MS))).toThrow(
      'Abbrechen erst, wenn sonst niemand mehr verbunden ist.',
    );
    expect(() => applyAction(pair, callOff('p1', DROP_AT))).toThrow('Hier fehlt niemand.');
  });

  it('leaves every other end as it was', () => {
    const lost = applyAction(pair, { type: 'time-expired', at: T0 + 700_000 });
    expect(lost.calledOff).toBeNull();
    expect(runReport(lost, 'ABCD').outcome).toBe('lost:time');
    expect(viewFor(lost, 'p1')).not.toHaveProperty('calledOff');
  });
});

describe('a new run', () => {
  it('starts with nobody away and no drop counted', () => {
    const on = applyAction(waiting, goOn('p1', 'p3', DROP_AT + FIRST_WAIT_MS));
    const lost = applyAction(applyAction(on, lineBack('p3', DROP_AT + 70_000)), {
      type: 'time-expired',
      at: T0 + 800_000,
    });
    const again = run(
      [
        { type: 'set-ready', playerId: 'p2', ready: true },
        { type: 'set-ready', playerId: 'p3', ready: true },
        { type: 'rematch', playerId: 'p1', at: T0 + 900_000, seed: 3 },
      ],
      lost,
    );
    expect(again).toMatchObject({ phase: 'playing', away: {}, drops: 0, calledOff: null });
  });
});

import { describe, expect, it } from 'vitest';
import {
  applyAction,
  clockCallDueAt,
  crewOf,
  FIRST_WAIT_MS,
  initialState,
  LATER_WAIT_MS,
  nudgeDueAt,
  parseMission,
  runReport,
  viewFor,
  viewForSpectator,
} from '../src/index.js';
import type { Action, GameState, Mission } from '../src/index.js';
import { consoleLab, lineBack, lineDrops, standing, started, T0 } from './lab.js';

/**
 * A corridor lab for three: two stations where the whole crew presses, (3,1) and (5,1), and
 * the hatch at its east end; mission control calls the clock and speaks up about a quiet
 * station.
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
  radio: { clock: { fiveMinutes: 'Noch fünf Minuten.' } },
  puzzles: [
    { type: 'button-sync', id: 'eins', title: 'Eins', nudges: ['Der Hebel wartet.'] },
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

/** Anna (p1) hosts, Ben (p2) and Cem (p3) joined and said yes; she starts at T0. */
function crew(): GameState {
  const names = ['Anna', 'Ben', 'Cem'];
  return run(
    [
      ...names.map((name, i): Action => ({ type: 'player-join', playerId: `p${i + 1}`, name })),
      { type: 'set-ready', playerId: 'p2', ready: true },
      { type: 'set-ready', playerId: 'p3', ready: true },
      { type: 'start-mission', playerId: 'p1', at: T0, seed: 7 },
    ],
    initialState(mission),
  );
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
const running = crew();
/** Cem (p3) dropped: the run goes on. */
const gone = applyAction(running, lineDrops('p3', DROP_AT));

describe('a line dropping in a run', () => {
  it('stands nothing still: Cem is away, and the run goes on', () => {
    expect(gone.paused).toBeNull();
    expect(gone.away).toEqual({
      p3: { since: DROP_AT, waivableAt: DROP_AT + FIRST_WAIT_MS, waived: false },
    });
    for (const view of [viewFor(gone, 'p1'), viewForSpectator(gone)]) {
      expect(view.away).toEqual([
        { id: 'p3', name: 'Cem', since: DROP_AT, waivableAt: DROP_AT + FIRST_WAIT_MS },
      ]);
      expect(view.pausedAt).toBeNull();
    }
    expect(viewFor(running, 'p1').away).toEqual([]);
  });

  it('is said on the air once, as mission control says it, and counts once', () => {
    expect(gone.events.at(-1)).toEqual({
      at: DROP_AT,
      kind: 'away',
      label: 'Cems Leitung ist weg.',
      seconds: null,
    });
    expect(applyAction(gone, lineDrops('p3', DROP_AT + 5000))).toEqual(gone);
    const toMenu: Action = { type: 'player-disconnected', playerId: 'p2', at: DROP_AT, menu: true };
    const menu = applyAction(running, toMenu);
    expect(menu.events.at(-1)?.label).toBe('Ben hat sich abgemeldet.');
  });

  it('runs the clock on: its calls, mission control and the end come as they would', () => {
    expect(gone.deadlineAt).toBe(running.deadlineAt);
    expect(clockCallDueAt(gone)).toBe(clockCallDueAt(running));
    expect(clockCallDueAt(gone)).not.toBeNull();
    const quiet = applyAction(standing(gone, { stations: { eins: ['p1'] } }), {
      type: 'interact',
      playerId: 'p1',
      at: DROP_AT + 1000,
    });
    expect(nudgeDueAt(quiet)).not.toBeNull();
    const out = applyAction(gone, { type: 'time-expired', at: running.deadlineAt ?? 0 });
    expect(out.phase).toBe('lost');
  });

  it('ends no run on its own, and the stations of the whole crew wait for Cem', () => {
    expect(gone.phase).toBe('playing');
    expect(crewOf(gone).map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    const pressed = pressAll(gone, ['p1', 'p2'], DROP_AT + 1000);
    expect(pressed.currentPuzzleIndex).toBe(0);
    expect(viewFor(pressed, 'p1').puzzle).toMatchObject({ requiredCount: 3 });
  });

  it('is no drop outside a run', () => {
    const lost = applyAction(running, { type: 'time-expired', at: T0 + 700_000 });
    const dropped = applyAction(lost, lineDrops('p3', T0 + 700_100));
    expect(dropped.paused).toBeNull();
    expect(dropped.away).toEqual({});
    expect(dropped.events).toEqual(lost.events);
    expect(dropped.players.find((p) => p.id === 'p3')?.connected).toBe(false);
  });
});

describe('a line back', () => {
  it('plays on at once: nobody away, nothing moved on', () => {
    const back = applyAction(gone, lineBack('p3', DROP_AT + 30_000));
    expect(back.paused).toBeNull();
    expect(back.away).toEqual({});
    expect(back.deadlineAt).toBe(running.deadlineAt);
    expect(viewFor(back, 'p1').away).toEqual([]);
  });
});

describe('going on without somebody away', () => {
  it('waits a minute for the first drop of a run', () => {
    const early = DROP_AT + FIRST_WAIT_MS - 1;
    expect(() => applyAction(gone, goOn('p1', 'p3', early))).toThrow('Die Wartezeit läuft noch.');
    const on = applyAction(gone, goOn('p1', 'p3', DROP_AT + FIRST_WAIT_MS));
    expect(on.paused).toBeNull();
    expect(on.away['p3']?.waived).toBe(true);
    expect(on.deadlineAt).toBe(running.deadlineAt);
    expect(viewFor(on, 'p1').players.find((p) => p.id === 'p3')).toMatchObject({
      connected: false,
      waived: true,
    });
    expect(viewFor(on, 'p1').away).toEqual([
      { id: 'p3', name: 'Cem', since: DROP_AT, waivableAt: DROP_AT + FIRST_WAIT_MS, waived: true },
    ]);
  });

  it('waits 20 s for every later drop of the run, whoever’s it is', () => {
    const back = applyAction(gone, lineBack('p3', DROP_AT + 5000));
    const again = applyAction(back, lineDrops('p2', DROP_AT + 9000));
    expect(again.away['p2']?.waivableAt).toBe(DROP_AT + 9000 + LATER_WAIT_MS);
    expect(() => applyAction(again, goOn('p1', 'p2', DROP_AT + 9000 + LATER_WAIT_MS - 1))).toThrow(
      'Die Wartezeit läuft noch.',
    );
    const on = applyAction(again, goOn('p1', 'p2', DROP_AT + 9000 + LATER_WAIT_MS));
    expect(on.away['p2']?.waived).toBe(true);
    const third = run([lineBack('p2', DROP_AT + 12_000), lineDrops('p3', DROP_AT + 13_000)], again);
    expect(third.away['p3']?.waivableAt).toBe(DROP_AT + 13_000 + LATER_WAIT_MS);
  });

  it('counts them out at a station the whole crew presses, and at the hatch', () => {
    const on = applyAction(gone, goOn('p1', 'p3', DROP_AT + FIRST_WAIT_MS));
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
    const at = DROP_AT + 500;
    const open = applyAction(standing(away, { stations: { kette: ['p1'] }, signSeen: ['p1'] }), {
      type: 'interact',
      playerId: 'p1',
      at,
    });
    expect(() =>
      applyAction(open, { type: 'puzzle-input', playerId: 'p1', at, input: { kind: 'send' } }),
    ).toThrow(/Eingabe gesperrt/);
    const on = applyAction(open, goOn('p1', 'p3', DROP_AT + FIRST_WAIT_MS));
    expect(() =>
      applyAction(on, { type: 'puzzle-input', playerId: 'p1', at, input: { kind: 'send' } }),
    ).toThrow(/Eingabe gesperrt/);
  });

  it('counts them in again the moment they are back', () => {
    const on = applyAction(gone, goOn('p1', 'p3', DROP_AT + FIRST_WAIT_MS));
    const back = applyAction(on, lineBack('p3', DROP_AT + FIRST_WAIT_MS + 15_000));
    expect(back.paused).toBeNull();
    expect(back.away).toEqual({});
    expect(crewOf(back).map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(viewFor(back, 'p1').players.find((p) => p.id === 'p3')).not.toHaveProperty('waived');
    expect(back.deadlineAt).toBe(on.deadlineAt);
  });

  it('takes two of the crew on the line, and somebody away it misses', () => {
    const pair = started(consoleLab(2));
    const alone = applyAction(pair, lineDrops('p2', DROP_AT));
    expect(() => applyAction(alone, goOn('p1', 'p2', DROP_AT + FIRST_WAIT_MS))).toThrow(
      'Allein läuft kein Einsatz weiter.',
    );
    expect(() => applyAction(running, goOn('p1', 'p3', DROP_AT))).toThrow('Hier fehlt niemand.');
    const on = applyAction(gone, goOn('p1', 'p3', DROP_AT + FIRST_WAIT_MS));
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
    expect(viewFor(off, 'p1').away).toEqual([]);
  });

  it('is no way out while two are on the line, or nobody is missing', () => {
    expect(() => applyAction(gone, callOff('p1', DROP_AT + FIRST_WAIT_MS))).toThrow(
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
    const on = applyAction(gone, goOn('p1', 'p3', DROP_AT + FIRST_WAIT_MS));
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

describe('the server’s maintenance', () => {
  const DOWN_AT = T0 + 30_000;
  const maintenance = (at: number, waitFrom = at): Action => ({
    type: 'maintenance',
    at,
    waitFrom,
  });

  it('stands a run still for the whole crew, every seat away, till the crew is back', () => {
    const down = applyAction(running, maintenance(DOWN_AT));
    expect(down.players.map((p) => p.connected)).toEqual([false, false, false]);
    expect(down.paused).toEqual({ since: DOWN_AT, kind: 'wartung' });
    const away = { since: DOWN_AT, waivableAt: DOWN_AT + FIRST_WAIT_MS, waived: false };
    expect(down.away).toEqual({ p1: away, p2: away, p3: away });
    // Nobody dropped: no later wait is made shorter for it, and nothing is said on the air.
    expect(down.drops).toBe(0);
    expect(down.events).toEqual(running.events);
    expect(viewFor(down, 'p1').pausedAt).toBe(DOWN_AT);
    expect(viewFor(down, 'p1').away.map((member) => member.name)).toEqual(['Anna', 'Ben', 'Cem']);
    expect(viewForSpectator(down).pausedAt).toBe(DOWN_AT);
    // Every move is refused meanwhile.
    expect(() => applyAction(down, { type: 'interact', playerId: 'p1', at: DOWN_AT })).toThrow(
      'Wartung — der Einsatz steht still.',
    );
    // Back one by one: the run goes on once the whole crew is, the clock moved on by the pause.
    const halfBack = run(
      [lineBack('p1', DOWN_AT + 20_000), lineBack('p2', DOWN_AT + 30_000)],
      down,
    );
    expect(halfBack.paused).toEqual({ since: DOWN_AT, kind: 'wartung' });
    const back = applyAction(halfBack, lineBack('p3', DOWN_AT + 40_000));
    expect(back.paused).toBeNull();
    expect(back.away).toEqual({});
    expect(back.deadlineAt).toBe((running.deadlineAt ?? 0) + 40_000);
    expect(viewFor(back, 'p1').pausedAt).toBeNull();
  });

  it('waits a minute from the moment the server takes the run up again, said twice alike', () => {
    const down = applyAction(running, maintenance(DOWN_AT));
    const up = applyAction(down, maintenance(DOWN_AT, DOWN_AT + 25_000));
    expect(up.paused).toEqual(down.paused);
    expect(Object.values(up.away).map((away) => away.waivableAt)).toEqual(
      Array(3).fill(DOWN_AT + 25_000 + FIRST_WAIT_MS),
    );
    expect(applyAction(up, maintenance(DOWN_AT, DOWN_AT + 25_000))).toEqual(up);
    const back = run([lineBack('p1', DOWN_AT + 30_000), lineBack('p2', DOWN_AT + 30_000)], up);
    expect(() => applyAction(back, goOn('p1', 'p3', DOWN_AT + 25_000 + FIRST_WAIT_MS - 1))).toThrow(
      'Die Wartezeit läuft noch.',
    );
    const on = applyAction(back, goOn('p1', 'p3', DOWN_AT + 25_000 + FIRST_WAIT_MS));
    expect(on.paused).toBeNull();
  });

  it('keeps a drop made before it, and waits for that one with the rest', () => {
    const down = applyAction(gone, maintenance(DOWN_AT));
    expect(down.paused).toEqual({ since: DOWN_AT, kind: 'wartung' });
    expect(down.away['p3']).toEqual({
      since: DROP_AT,
      waivableAt: DOWN_AT + FIRST_WAIT_MS,
      waived: false,
    });
    const twoBack = run([lineBack('p1', DOWN_AT + 9000), lineBack('p2', DOWN_AT + 9000)], down);
    expect(twoBack.paused).toEqual({ since: DOWN_AT, kind: 'wartung' });
    expect(applyAction(twoBack, lineBack('p3', DOWN_AT + 12_000)).paused).toBeNull();
  });

  it('keeps whom the run went on without counted out, and waits only for the rest', () => {
    const on = applyAction(gone, goOn('p1', 'p3', DROP_AT + FIRST_WAIT_MS));
    const later = DROP_AT + FIRST_WAIT_MS + 5000;
    const downOn = applyAction(on, maintenance(later));
    expect(downOn.away['p3']).toEqual(on.away['p3']);
    expect(downOn.paused).toEqual({ since: later, kind: 'wartung' });
    const back = run([lineBack('p1', later + 9000), lineBack('p2', later + 9000)], downOn);
    expect(back.paused).toBeNull();
    expect(back.away['p3']?.waived).toBe(true);
  });

  it('lets a new device’s ask for a seat lapse: the device went with the server', () => {
    const asked = applyAction(gone, { type: 'takeover-claimed', playerId: 'p3', at: DROP_AT });
    expect(asked.away['p3']?.claimUntil).toBeDefined();
    const down = applyAction(asked, maintenance(DOWN_AT));
    expect(down.away['p3']).not.toHaveProperty('claimUntil');
    expect(viewFor(down, 'p1')).not.toHaveProperty('takeovers');
  });

  it('takes every seat off the line outside a run, and nothing else', () => {
    const lobby = run(
      ['p1', 'p2'].map((playerId): Action => ({ type: 'player-join', playerId, name: playerId })),
      initialState(mission),
    );
    const down = applyAction(lobby, maintenance(DOWN_AT));
    expect(down).toEqual({
      ...lobby,
      players: lobby.players.map((player) => ({ ...player, connected: false })),
    });
  });
});

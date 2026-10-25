import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  CREW_COLORS,
  GameError,
  initialState,
  moduleFor,
  parseMission,
  stationKey,
  viewFor,
} from '../src/index.js';
import type { Action, GameState, Mission } from '../src/index.js';
import { standing } from './lab.js';

// The tutorial: a whole-crew press, a Signalkette at two consoles, a wiring station read at
// a locker, a whole-crew finale.
const mission: Mission = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/systemcheck.json', import.meta.url), 'utf8')),
);

const T0 = 1_000_000;

function run(actions: Action[], from?: GameState): GameState {
  return actions.reduce(applyAction, from ?? initialState(mission));
}

/** Lobby with the whole crew, ready to start: Anna (host) and Ben. */
function readyLobby(): GameState {
  return run([
    { type: 'player-join', playerId: 'p1', name: 'Anna' },
    { type: 'player-join', playerId: 'p2', name: 'Ben' },
    { type: 'set-ready', playerId: 'p2', ready: true },
  ]);
}

function started(at = T0): GameState {
  return run([{ type: 'start-mission', playerId: 'p1', at, seed: 42 }], readyLobby());
}

/** Stations 1 and 4 of the tutorial are button-syncs: one input, a press. */
function press(playerId: string, at: number): Action {
  return { type: 'puzzle-input', playerId, at, input: { press: true } };
}

/** The current station switched on with the whole crew standing at it. */
function bothAtStation(state: GameState, at: number): GameState {
  const def = state.mission.puzzles[state.currentPuzzleIndex];
  if (def === undefined) {
    throw new Error('no station left');
  }
  const here = standing(state, { stations: { [def.id]: ['p1', 'p2'] } });
  return applyAction(here, { type: 'interact', playerId: 'p2', at });
}

/**
 * Station 2 is the Signalkette: Anna at console a, Ben at console b. Each
 * stage is pressed at the console that receives it, worked out from the two
 * consoles' views alone, until the station solves.
 */
function signalSent(state: GameState, at: number): GameState {
  const def = state.mission.puzzles[state.currentPuzzleIndex];
  const consoleB = stationKey({ puzzleId: 'signalprobe', console: 'b' });
  const here = standing(state, { stations: { signalprobe: ['p1'], [consoleB]: ['p2'] } });
  let next = applyAction(here, { type: 'interact', playerId: 'p1', at });
  while (next.currentPuzzleIndex === state.currentPuzzleIndex) {
    const anna = viewFor(next, 'p1').puzzle;
    const ben = viewFor(next, 'p2').puzzle;
    if (def?.type !== 'signal' || anna === null || ben === null) {
      throw new Error('expected the open Signalkette');
    }
    const views = { operator: anna, partner: ben, reader: anna };
    const moves = moduleFor(def.type).solve(def, views, null);
    if (moves.length === 0) {
      throw new Error('the Signalkette is open, but its views show nothing to press');
    }
    for (const { by, input } of moves) {
      const playerId = by === 'partner' ? 'p2' : 'p1';
      next = applyAction(next, { type: 'puzzle-input', playerId, at, input });
    }
  }
  return next;
}

/** Station 3 switched on: Ben at the wiring box, Anna at the searched locker, Ben past the sign. */
function wiringOpen(state: GameState, at: number): GameState {
  const here = standing(state, {
    stations: { doppelbestaetigung: ['p2'] },
    manuals: { 'spind-leitstand': ['p1'] },
    signSeen: ['p2'],
  });
  const searched = applyAction(here, {
    type: 'open-source',
    playerId: 'p1',
    manualId: 'spind-leitstand',
    at,
  });
  return applyAction(searched, { type: 'interact', playerId: 'p2', at });
}

/** Station 3 is wiring: the cut its rules name, worked out from the two views alone. */
function cutRightWire(state: GameState, at: number): GameState {
  const def = state.mission.puzzles[state.currentPuzzleIndex];
  const ben = viewFor(state, 'p2');
  const anna = viewFor(state, 'p1');
  if (def?.type !== 'wiring' || anna.puzzle === null || ben.puzzle === null) {
    throw new Error('expected the open wiring station');
  }
  const views = { operator: ben.puzzle, reader: anna.puzzle };
  let next = state;
  for (const { input } of moduleFor(def.type).solve(def, views, ben.edgework)) {
    next = applyAction(next, { type: 'puzzle-input', playerId: 'p2', at, input });
  }
  return next;
}

describe('lobby', () => {
  it('makes the first player host', () => {
    const state = readyLobby();
    expect(state.players.map((p) => p.isHost)).toEqual([true, false]);
  });

  it('rejects starting with fewer players than the mission takes', () => {
    const state = run([{ type: 'player-join', playerId: 'p1', name: 'Anna' }]);
    expect(() =>
      applyAction(state, { type: 'start-mission', playerId: 'p1', at: T0, seed: 42 }),
    ).toThrow(GameError);
    expect(() =>
      applyAction(state, { type: 'start-mission', playerId: 'p1', at: T0, seed: 42 }),
    ).toThrow(/mindestens 2/);
  });

  it('rejects start by non-host and join into a full or running game', () => {
    const lobby = readyLobby();
    expect(() =>
      applyAction(lobby, { type: 'start-mission', playerId: 'p2', at: T0, seed: 42 }),
    ).toThrow(/Host/);
    expect(() =>
      applyAction(lobby, { type: 'player-join', playerId: 'p3', name: 'Cleo' }),
    ).toThrow(/voll/);
    expect(() =>
      applyAction(started(), { type: 'player-join', playerId: 'p3', name: 'Cleo' }),
    ).toThrow(/Lobby/);
  });

  it('hands out distinct crew colors and lets players swap to free ones', () => {
    const state = readyLobby();
    const [anna, ben] = state.players;
    expect(anna?.color).not.toBe(ben?.color);
    expect(viewFor(state, 'p1').palette.filter((p) => p.takenByName !== null)).toHaveLength(2);

    const recolored = applyAction(state, {
      type: 'select-color',
      playerId: 'p2',
      color: CREW_COLORS[4],
    });
    expect(recolored.players[1]?.color).toBe(CREW_COLORS[4]);
  });

  it('rejects a taken color, an unknown color and recoloring mid-mission', () => {
    const state = readyLobby();
    const annaColor = state.players[0]?.color ?? '';
    expect(() =>
      applyAction(state, { type: 'select-color', playerId: 'p2', color: annaColor }),
    ).toThrow(/trägt schon/);
    expect(() =>
      applyAction(state, { type: 'select-color', playerId: 'p2', color: '#123456' }),
    ).toThrow(/gibt es nicht/);
    expect(() =>
      applyAction(started(), { type: 'select-color', playerId: 'p2', color: CREW_COLORS[5] }),
    ).toThrow(/nur in der Lobby/);
  });

  it('refuses to start before everyone but the host has confirmed', () => {
    const lobby = run([
      { type: 'player-join', playerId: 'p1', name: 'Anna' },
      { type: 'player-join', playerId: 'p2', name: 'Ben' },
    ]);
    expect(() =>
      applyAction(lobby, { type: 'start-mission', playerId: 'p1', at: T0, seed: 1 }),
    ).toThrow(/Noch nicht bereit: Ben/);

    const confirmed = applyAction(lobby, { type: 'set-ready', playerId: 'p2', ready: true });
    expect(viewFor(confirmed, 'p1').players[1]?.ready).toBe(true);
    expect(
      applyAction(confirmed, { type: 'start-mission', playerId: 'p1', at: T0, seed: 1 }).phase,
    ).toBe('playing');
  });

  it('clears confirmations whenever the setup changes', () => {
    // A variant for up to three, so there is room for a third player.
    const roomy = parseMission({
      ...JSON.parse(JSON.stringify(mission)),
      id: 'three',
      players: { min: 2, max: 3 },
      map: {
        ...JSON.parse(JSON.stringify(mission.map)),
        spawns: [...mission.map.spawns, { x: 2, y: 4 }],
      },
    });
    const confirmed = run(
      [
        { type: 'player-join', playerId: 'p1', name: 'Anna' },
        { type: 'player-join', playerId: 'p2', name: 'Ben' },
        { type: 'set-ready', playerId: 'p2', ready: true },
      ],
      initialState(roomy),
    );
    expect(confirmed.players[1]?.ready).toBe(true);

    // The host switching the difficulty un-readies the crew …
    const harder = applyAction(confirmed, {
      type: 'switch-mission',
      playerId: 'p1',
      mission: roomy,
      difficulty: 'hart',
    });
    expect(harder.players.every((p) => !p.ready)).toBe(true);

    // … and so does a third player walking in.
    const joined = applyAction(confirmed, {
      type: 'player-join',
      playerId: 'p3',
      name: 'Cleo',
    });
    expect(joined.players.every((p) => !p.ready)).toBe(true);
  });

  it('rejects confirming during a running mission, but allows it afterwards', () => {
    const running = started();
    expect(() =>
      applyAction(running, { type: 'set-ready', playerId: 'p2', ready: false }),
    ).toThrow(/zwischen den Läufen/);

    const finished = applyAction(running, { type: 'time-expired', at: T0 + 400_000 });
    expect(
      applyAction(finished, { type: 'set-ready', playerId: 'p2', ready: true }).players[1]?.ready,
    ).toBe(true);
  });

  it('runs a rematch straight from the end screen, keeping the crew', () => {
    const finished = applyAction(started(), { type: 'time-expired', at: T0 + 400_000 });
    expect(() =>
      applyAction(finished, { type: 'rematch', playerId: 'p2', at: T0 + 500_000, seed: 2 }),
    ).toThrow(/Host/);

    // Finishing cleared the confirmations, so the crew confirms again.
    const confirmed = applyAction(finished, {
      type: 'set-ready',
      playerId: 'p2',
      ready: true,
    });
    const again = applyAction(confirmed, {
      type: 'rematch',
      playerId: 'p1',
      at: T0 + 500_000,
      seed: 2,
    });
    expect(again.phase).toBe('playing');
    expect(again.players.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(again.players.every((p) => p.spawn !== null)).toBe(true);
    expect(again.currentPuzzleIndex).toBe(0);
    // The fresh report holds nothing but mission control's opener.
    expect(again.events).toEqual([
      { at: T0 + 500_000, kind: 'radio', label: mission.radio.start, seconds: null },
    ]);
    expect(again.deadlineAt).toBe(T0 + 500_000 + mission.timeLimitSec * 1000);
  });

  it('refuses a rematch while still playing or before everyone confirms', () => {
    expect(() =>
      applyAction(started(), { type: 'rematch', playerId: 'p1', at: T0 + 1, seed: 2 }),
    ).toThrow(/erst nach Missionsende/);

    const notReady = run(
      [
        { type: 'player-join', playerId: 'p1', name: 'Anna' },
        { type: 'player-join', playerId: 'p2', name: 'Ben' },
        { type: 'set-ready', playerId: 'p2', ready: true },
        { type: 'start-mission', playerId: 'p1', at: T0, seed: 1 },
        { type: 'time-expired', at: T0 + 400_000 },
      ],
    );
    expect(() =>
      applyAction(notReady, { type: 'rematch', playerId: 'p1', at: T0 + 500_000, seed: 2 }),
    ).toThrow(/Noch nicht bereit: Ben/);
  });

  it('rejects blank player names', () => {
    expect(() =>
      applyAction(initialState(mission), { type: 'player-join', playerId: 'p1', name: '   ' }),
    ).toThrow(/Namen/);
  });
});

describe('playing a full mission', () => {
  it('opens the hatch after all four puzzles and wins once everyone is out', () => {
    let state = bothAtStation(started(), T0 + 500);
    // Puzzle 1: everyone at the station presses.
    state = run([press('p1', T0 + 1000), press('p2', T0 + 1200)], state);
    expect(state.currentPuzzleIndex).toBe(1);
    // Puzzle 2: the signs, sent from one console and pressed at the other, both ways.
    state = signalSent(state, T0 + 2000);
    expect(state.currentPuzzleIndex).toBe(2);
    // Puzzle 3: one right wire, cut at the box while the book is read.
    state = cutRightWire(wiringOpen(state, T0 + 4000), T0 + 5000);
    expect(state.currentPuzzleIndex).toBe(3);
    // Puzzle 4: both within 3 seconds.
    state = run(
      [press('p1', T0 + 70_000), press('p2', T0 + 72_000)],
      bothAtStation(state, T0 + 60_000),
    );
    expect(state.phase).toBe('playing');
    expect(state.currentPuzzleIndex).toBe(4);
    expect(applyAction(state, { type: 'escaped', at: T0 + 80_000 }).phase).toBe('won');
  });

  it('lets a press outside the window run out, charges nothing and tells only its owner', () => {
    let state = run(
      [press('p1', T0 + 1000), press('p2', T0 + 1000)],
      bothAtStation(started(), T0 + 500),
    );
    state = signalSent(state, T0 + 1200);
    state = cutRightWire(wiringOpen(state, T0 + 1500), T0 + 2000);
    state = run(
      [
        // The finale's 3 s window: Anna presses at +10 s, Ben only at +20 s.
        press('p1', T0 + 10_000),
        press('p2', T0 + 20_000),
      ],
      bothAtStation(state, T0 + 9000),
    );
    expect(state.currentPuzzleIndex).toBe(3);
    expect(state.penaltySeq).toBe(0);
    expect(viewFor(state, 'p1').puzzle).toMatchObject({
      press: null,
      partnerPressed: true,
      lastResult: 'expired',
    });
    expect(viewFor(state, 'p2').puzzle).toMatchObject({
      press: { at: T0 + 20_000, expiresAt: T0 + 23_000 },
      partnerPressed: false,
      lastResult: null,
    });
    // Ben's late press opened a new window: Anna's press within it solves the station.
    state = applyAction(state, press('p1', T0 + 21_000));
    expect(state.currentPuzzleIndex).toBe(4);
  });

  it('needs every player to press: one press alone solves nothing', () => {
    const state = applyAction(bothAtStation(started(), T0 + 500), press('p2', T0 + 1000));
    expect(state.currentPuzzleIndex).toBe(0);
    expect(viewFor(state, 'p2').puzzle).toMatchObject({ youPressed: true, pressedCount: 1 });
    expect(viewFor(state, 'p1').puzzle).toMatchObject({ youPressed: false, requiredCount: 2 });
  });

  it('rejects a press from a player away from the station', () => {
    const open = applyAction(
      standing(started(), { stations: { init: ['p2'] } }),
      { type: 'interact', playerId: 'p2', at: T0 + 500 },
    );
    expect(() => applyAction(open, press('p1', T0 + 1000))).toThrow(
      'Eingabe nur am Pult.',
    );
  });

  it('rejects an input the open puzzle does not take', () => {
    const open = bothAtStation(started(), T0 + 500);
    for (const input of [{ wireId: 'w0' }, { press: true, extra: 1 }, undefined, 'press']) {
      expect(() =>
        applyAction(open, { type: 'puzzle-input', playerId: 'p2', at: T0 + 1000, input }),
      ).toThrow(/Ungültige Eingabe/);
    }
  });

  it('loses when time expires, also on a late press', () => {
    const afterDeadline = T0 + mission.timeLimitSec * 1000;
    expect(applyAction(started(), { type: 'time-expired', at: afterDeadline }).phase).toBe('lost');
    const late = applyAction(bothAtStation(started(), T0 + 500), press('p2', afterDeadline));
    expect(late.phase).toBe('lost');
  });

  it('lets the host return to the lobby with the crew intact and the spawns given back', () => {
    let state = applyAction(started(), { type: 'time-expired', at: T0 + 300_000 });
    state = applyAction(state, { type: 'back-to-lobby', playerId: 'p1' });
    expect(state.phase).toBe('lobby');
    expect(state.players.map((p) => [p.id, p.spawn])).toEqual([
      ['p1', null],
      ['p2', null],
    ]);
  });
});

describe('asymmetric information in views', () => {
  it('gives the wires to the box, the rules to the locker, the edgework to the sign reader', () => {
    const first = run(
      [press('p1', T0 + 1000), press('p2', T0 + 1000)],
      bothAtStation(started(), T0 + 500),
    );
    const state = wiringOpen(signalSent(first, T0 + 1500), T0 + 2000);
    const def = mission.puzzles[2];
    const ben = viewFor(state, 'p2');
    const anna = viewFor(state, 'p1');
    if (def === undefined || ben.puzzle?.kind !== 'wiring' || anna.puzzle?.kind !== 'wiring') {
      throw new Error('expected the wiring station');
    }
    expect(ben.puzzle.wires).not.toBeNull();
    expect(ben.puzzle.manual).toBeNull();
    expect(anna.puzzle.wires).toBeNull();
    expect(anna.puzzle.manual).toEqual(moduleFor(def.type).manual(def));
    expect(ben.edgework).toEqual(state.edgework);
    expect(anna.edgework).toBeNull();
    expect(JSON.stringify(anna)).not.toContain(JSON.stringify(ben.puzzle.wires));
    expect(JSON.stringify(anna)).not.toContain(state.edgework?.serial ?? '?');
  });

  it('tracks connection status in views', () => {
    const state = applyAction(started(), { type: 'player-disconnected', playerId: 'p2' });
    const anna = viewFor(state, 'p1');
    expect(anna.players.find((p) => p.id === 'p2')?.connected).toBe(false);
  });
});

const blackout: Mission = parseMission(
  JSON.parse(readFileSync(new URL('../../../missions/blackout.json', import.meta.url), 'utf8')),
);

describe('on to the next mission', () => {
  /** The tutorial played to the end and won, Ben's yes to the next run already in. */
  function wonAndConfirmed(): GameState {
    let state = bothAtStation(started(), T0 + 500);
    state = run([press('p1', T0 + 1000), press('p2', T0 + 1200)], state);
    state = signalSent(state, T0 + 2000);
    state = cutRightWire(wiringOpen(state, T0 + 4000), T0 + 5000);
    state = run(
      [press('p1', T0 + 70_000), press('p2', T0 + 72_000)],
      bothAtStation(state, T0 + 60_000),
    );
    state = applyAction(state, { type: 'escaped', at: T0 + 80_000 });
    expect(state.phase).toBe('won');
    return applyAction(state, { type: 'set-ready', playerId: 'p2', ready: true });
  }

  const onTo = (state: GameState, next: Mission, playerId = 'p1'): GameState =>
    applyAction(state, { type: 'rematch', playerId, at: T0 + 100_000, seed: 3, mission: next });

  it('names the mission a run leads on to in every view, and none where none follows', () => {
    expect(mission.next).toBe('blackout');
    for (const playerId of ['p1', 'p2']) {
      expect(viewFor(wonAndConfirmed(), playerId).nextMissionId).toBe('blackout');
    }
    expect(blackout.next).toBeUndefined();
    expect(viewFor(onTo(wonAndConfirmed(), blackout), 'p1')).not.toHaveProperty('nextMissionId');
  });

  it('starts the mission the host names, with the same crew, difficulty and seed count', () => {
    const over = wonAndConfirmed();
    const next = onTo(over, blackout);
    expect(next.phase).toBe('playing');
    expect(next.mission).toBe(blackout);
    expect([next.difficulty, next.runs]).toEqual([over.difficulty, over.runs + 1]);
    expect(next.players.map((p) => p.id)).toEqual(['p1', 'p2']);
    const onASpawn = (p: GameState['players'][number]): boolean =>
      blackout.map.spawns.some((s) => s.x === p.spawn?.x && s.y === p.spawn.y);
    expect(next.players.every(onASpawn)).toBe(true);
    // Blackout opens with the power on: no clock, no radio line, the lights due to fail.
    expect(next.deadlineAt).toBeNull();
    expect(next.events).toEqual([]);
    expect(next.lightsDueAt).toBe(T0 + 100_000 + (blackout.intro?.lightsSec ?? 0) * 1000);
    expect(viewFor(next, 'p2').missionTitle).toBe(blackout.title);
  });

  it('runs the same mission again where the host names none', () => {
    const again = applyAction(wonAndConfirmed(), {
      type: 'rematch',
      playerId: 'p1',
      at: T0 + 100_000,
      seed: 3,
    });
    expect(again.mission).toBe(mission);
    expect(again.phase).toBe('playing');
  });

  it('keeps the guards of a start: the host starts it, and the crew has to fit', () => {
    expect(() => onTo(wonAndConfirmed(), blackout, 'p2')).toThrow(/Host/);
    const forThree = parseMission({
      ...JSON.parse(JSON.stringify(blackout)),
      id: 'blackout-drei',
      players: { min: 3, max: 3 },
    });
    expect(() => onTo(wonAndConfirmed(), forThree)).toThrow(/mindestens 3/);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  CREW_COLORS,
  GameError,
  initialState,
  moduleFor,
  parseMission,
  viewFor,
} from '../src/index.js';
import type { Action, GameState, Mission } from '../src/index.js';

// Lobby and puzzle-chain tests run without the tile map (with one, puzzles wait
// for station activation); the mapped flow is covered in map.test.ts.
const mission: Mission = parseMission({
  ...JSON.parse(
    readFileSync(new URL('../../../missions/systemcheck.json', import.meta.url), 'utf8'),
  ),
  map: undefined,
});

const T0 = 1_000_000;

function run(actions: Action[], from?: GameState): GameState {
  return actions.reduce(applyAction, from ?? initialState(mission));
}

/** Lobby with both roles assigned, ready to start. anna=anleitung (host), ben=steuerpult. */
function readyLobby(): GameState {
  return run([
    { type: 'player-join', playerId: 'p1', name: 'Anna' },
    { type: 'player-join', playerId: 'p2', name: 'Ben' },
    { type: 'select-role', playerId: 'p1', roleId: 'anleitung' },
    { type: 'select-role', playerId: 'p2', roleId: 'steuerpult' },
    { type: 'set-ready', playerId: 'p2', ready: true },
  ]);
}

function started(at = T0): GameState {
  return run([{ type: 'start-mission', playerId: 'p1', at, seed: 42 }], readyLobby());
}

/** Stations 1 and 3 of the tutorial are button-syncs: one input, a press. */
function press(playerId: string, at: number): Action {
  return { type: 'puzzle-input', playerId, at, input: { press: true } };
}

/** Station 2 is wiring: the cut its rules name, worked out from the two views alone. */
function cutRightWire(state: GameState, at: number): GameState {
  const def = state.mission.puzzles[state.currentPuzzleIndex];
  const anna = viewFor(state, 'p1');
  const ben = viewFor(state, 'p2');
  if (def?.type !== 'wiring' || anna.puzzle === null || ben.puzzle === null) {
    throw new Error('expected the open wiring station');
  }
  const views = { anleitung: anna.puzzle, steuerpult: ben.puzzle };
  let next = state;
  for (const { roleId, input } of moduleFor(def.type).solve(def, views, ben.edgework)) {
    const playerId = roleId === 'anleitung' ? 'p1' : 'p2';
    next = applyAction(next, { type: 'puzzle-input', playerId, at, input });
  }
  return next;
}

describe('lobby', () => {
  it('makes the first player host', () => {
    const state = readyLobby();
    expect(state.players.map((p) => p.isHost)).toEqual([true, false]);
  });

  it('rejects taking an occupied role', () => {
    const state = readyLobby();
    expect(() =>
      applyAction(state, { type: 'select-role', playerId: 'p2', roleId: 'anleitung' }),
    ).toThrow(GameError);
  });

  it('rejects starting with unassigned roles', () => {
    const state = run([
      { type: 'player-join', playerId: 'p1', name: 'Anna' },
      { type: 'select-role', playerId: 'p1', roleId: 'anleitung' },
    ]);
    expect(() =>
      applyAction(state, { type: 'start-mission', playerId: 'p1', at: T0, seed: 42 }),
    ).toThrow(/Steuerpult/);
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
      { type: 'select-role', playerId: 'p1', roleId: 'anleitung' },
      { type: 'select-role', playerId: 'p2', roleId: 'steuerpult' },
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
    // A three-role variant, so there is a free role to switch to.
    const roomy = parseMission({
      ...JSON.parse(JSON.stringify(mission)),
      id: 'three',
      roles: [
        ...JSON.parse(JSON.stringify(mission.roles)),
        { id: 'dritte', name: 'Dritte', description: '' },
      ],
    });
    const confirmed = run(
      [
        { type: 'player-join', playerId: 'p1', name: 'Anna' },
        { type: 'player-join', playerId: 'p2', name: 'Ben' },
        { type: 'select-role', playerId: 'p2', roleId: 'steuerpult' },
        { type: 'set-ready', playerId: 'p2', ready: true },
      ],
      initialState(roomy),
    );
    expect(confirmed.players[1]?.ready).toBe(true);

    // Someone switching role un-readies the crew …
    const reRoled = applyAction(confirmed, {
      type: 'select-role',
      playerId: 'p2',
      roleId: 'dritte',
    });
    expect(reRoled.players.every((p) => !p.ready)).toBe(true);

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

  it('runs a rematch straight from the end screen, keeping the roles', () => {
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
    expect(again.players.map((p) => p.roleId)).toEqual(['anleitung', 'steuerpult']);
    expect(again.currentPuzzleIndex).toBe(0);
    expect(again.events).toEqual([]);
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
        { type: 'select-role', playerId: 'p1', roleId: 'anleitung' },
        { type: 'select-role', playerId: 'p2', roleId: 'steuerpult' },
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
  it('wins after solving all three puzzles', () => {
    let state = started();
    // Puzzle 1: only steuerpult has a button.
    state = applyAction(state, press('p2', T0 + 1000));
    expect(state.currentPuzzleIndex).toBe(1);
    // Puzzle 2: one right wire, cut by steuerpult.
    state = cutRightWire(state, T0 + 5000);
    expect(state.currentPuzzleIndex).toBe(2);
    // Puzzle 3: both within 3 seconds.
    state = run(
      [
        press('p1', T0 + 70_000),
        press('p2', T0 + 72_000),
      ],
      state,
    );
    expect(state.phase).toBe('won');
  });

  it('expires a press outside the sync window and counts the attempt', () => {
    let state = applyAction(started(), press('p2', T0 + 1000));
    state = cutRightWire(state, T0 + 2000);
    state = run(
      [
        // Window puzzle: first press at +10s, partner misses the 3s window.
        press('p1', T0 + 10_000),
        press('p2', T0 + 20_000),
      ],
      state,
    );
    expect(state.phase).toBe('playing');
    if (state.puzzleState?.type !== 'button-sync') {
      throw new Error('expected button-sync puzzle state');
    }
    expect(state.puzzleState.attempts).toBe(1);
    expect(state.puzzleState.lastResult).toBe('missed-window');
    // The late press is still valid as the start of the next attempt.
    state = applyAction(state, press('p1', T0 + 21_000));
    expect(state.phase).toBe('won');
  });

  it('rejects a press from a role without a button', () => {
    expect(() => applyAction(started(), press('p1', T0 + 1000))).toThrow(/keinen Knopf/);
  });

  it('rejects an input the open puzzle does not take', () => {
    for (const input of [{ wireId: 'w0' }, { press: true, extra: 1 }, undefined, 'press']) {
      expect(() =>
        applyAction(started(), { type: 'puzzle-input', playerId: 'p2', at: T0 + 1000, input }),
      ).toThrow(/Ungültige Eingabe/);
    }
  });

  it('loses when time expires, also on a late press', () => {
    const afterDeadline = T0 + mission.timeLimitSec * 1000;
    expect(applyAction(started(), { type: 'time-expired', at: afterDeadline }).phase).toBe('lost');
    const late = applyAction(started(), press('p2', afterDeadline));
    expect(late.phase).toBe('lost');
  });

  it('lets the host return to the lobby with roles intact', () => {
    let state = applyAction(started(), { type: 'time-expired', at: T0 + 300_000 });
    state = applyAction(state, { type: 'back-to-lobby', playerId: 'p1' });
    expect(state.phase).toBe('lobby');
    expect(state.players.map((p) => p.roleId)).toEqual(['anleitung', 'steuerpult']);
  });
});

describe('asymmetric information in views', () => {
  it('shows the manual text only to the Anleitung role', () => {
    const state = started();
    const anna = viewFor(state, 'p1');
    const ben = viewFor(state, 'p2');
    expect(anna.puzzle?.info).toMatch(/Freigabe erteilt/);
    expect(ben.puzzle?.info).toBeNull();
    // A button-sync station has no manual role, so nobody gets the printed rules.
    expect([anna.puzzle?.manual, ben.puzzle?.manual]).toEqual([null, null]);
    if (anna.puzzle?.kind !== 'button-sync' || ben.puzzle?.kind !== 'button-sync') {
      throw new Error('expected button-sync puzzle views');
    }
    expect(anna.puzzle.buttonLabel).toBeNull();
    expect(ben.puzzle.buttonLabel).toBe('INIT');
    expect(JSON.stringify(ben)).not.toContain('Freigabe erteilt');
  });

  it('tracks connection status in views', () => {
    const state = applyAction(started(), { type: 'player-disconnected', playerId: 'p2' });
    const anna = viewFor(state, 'p1');
    expect(anna.players.find((p) => p.id === 'p2')?.connected).toBe(false);
  });
});

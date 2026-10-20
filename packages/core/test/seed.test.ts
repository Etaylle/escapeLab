import { describe, expect, it } from 'vitest';
import { applyAction, initialState, runReport, SEED_MAX, viewFor } from '../src/index.js';
import type { Action, GameState } from '../src/index.js';
import { labMission, openLab, started, T0 } from './lab.js';

/** A corridor lab with a wiring box, whose instance is drawn from the run's seed. */
const mission = labMission([{ type: 'wiring', id: 'kabel', title: 'Kabel' }]);

/** What the server rolls for every run here; a pinned room passes it over. */
const ROLLED = 271_828_182;

function run(state: GameState, actions: Action[]): GameState {
  return actions.reduce(applyAction, state);
}

/** p1 (host) and p2 in a room pinned to `roomSeed`, or to none; p2 confirms, p1 starts. */
function firstRun(roomSeed: number | null): GameState {
  return run(initialState(mission, roomSeed), [
    { type: 'player-join', playerId: 'p1', name: 'Anna' },
    { type: 'player-join', playerId: 'p2', name: 'Ben' },
    { type: 'set-ready', playerId: 'p2', ready: true },
    { type: 'start-mission', playerId: 'p1', at: T0, seed: ROLLED },
  ]);
}

/** The run lost on time. */
function lost(state: GameState): GameState {
  return applyAction(state, { type: 'time-expired', at: (state.startedAt ?? T0) + 700_000 });
}

/** The run lost, and the next one started straight from the end screen. */
function rematch(state: GameState, seed = ROLLED): GameState {
  const over = lost(state);
  return run(over, [
    { type: 'set-ready', playerId: 'p2', ready: true },
    { type: 'rematch', playerId: 'p1', at: (over.finishedAt ?? T0) + 1000, seed },
  ]);
}

/** The run lost, the crew back in the lobby, and the next one started from there. */
function viaLobby(state: GameState): GameState {
  const over = lost(state);
  return run(over, [
    { type: 'back-to-lobby', playerId: 'p1' },
    { type: 'set-ready', playerId: 'p2', ready: true },
    { type: 'start-mission', playerId: 'p1', at: (over.finishedAt ?? T0) + 1000, seed: ROLLED },
  ]);
}

/** What a run's seed decides: where the crew starts, where the sources lie, edgework and box. */
function drawn(state: GameState) {
  return {
    spawns: state.players.map((player) => player.spawn),
    places: state.places,
    edgework: state.edgework,
    box: openLab(state, { at: (state.startedAt ?? T0) + 100 }).puzzleState,
  };
}

describe('a room pinned to a seed', () => {
  it('plays its run n on seed + n, whatever the server rolled, by rematch or lobby', () => {
    const first = firstRun(40);
    const second = rematch(first);
    const third = viaLobby(second);
    expect([first.seed, second.seed, third.seed]).toEqual([40, 41, 42]);
  });

  it('draws, places and sets up its run n as any run on seed + n', () => {
    const second = rematch(firstRun(40));
    expect(drawn(second)).toEqual(drawn(started(mission, 41)));
    expect(drawn(second)).not.toEqual(drawn(firstRun(40)));
  });

  it('wraps past the largest seed', () => {
    const last = firstRun(SEED_MAX);
    expect([last.seed, rematch(last).seed]).toEqual([SEED_MAX, 0]);
  });

  it('leaves every run of a room nobody pinned to the seed the server rolled', () => {
    const first = firstRun(null);
    expect([first.seed, rematch(first, 8).seed]).toEqual([ROLLED, 8]);
  });
});

describe('the seed in views and reports', () => {
  it("shows a pinned room's players its seed, and the run's once one runs", () => {
    const lobby = applyAction(initialState(mission, 40), {
      type: 'player-join',
      playerId: 'p1',
      name: 'Anna',
    });
    expect(viewFor(lobby, 'p1').seed).toEqual({ room: 40, run: null });
    const second = rematch(firstRun(40));
    expect(viewFor(second, 'p2').seed).toEqual({ room: 40, run: 41 });
    expect(viewFor(lost(second), 'p2').seed).toEqual({ room: 40, run: 41 });
    const back = applyAction(lost(second), { type: 'back-to-lobby', playerId: 'p1' });
    expect(viewFor(back, 'p1').seed).toEqual({ room: 40, run: null });
  });

  it('keeps a rolled seed out of every view: it would give the instances away', () => {
    const view = viewFor(lost(firstRun(null)), 'p1');
    expect(Object.keys(view)).not.toContain('seed');
    expect(JSON.stringify(view)).not.toContain(String(ROLLED));
  });

  it('reports the seed a pinned run played, and none for a rolled one', () => {
    expect(runReport(lost(rematch(firstRun(40))), 'TEST').seed).toBe(41);
    expect(Object.keys(runReport(lost(firstRun(null)), 'TEST'))).not.toContain('seed');
  });
});

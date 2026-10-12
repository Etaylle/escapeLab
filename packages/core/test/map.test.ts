import { describe, expect, it } from 'vitest';
import { applyAction, inEscapePhase, initialState, parseMission, viewFor } from '../src/index.js';
import type { Action, GameState, Mission } from '../src/index.js';
import { standing } from './lab.js';

/**
 * Fixture: two rooms split by a wall at x=4 with a door at (4,2) that opens
 * only while the plate 'p1' is held; both stations stand in the west room,
 * where the crew starts. Movement itself is client-authoritative and not
 * part of the reducer — plates arrive as set-occupancy actions and presence
 * as set-presence (the server derives both from live positions), stations
 * are activated via interact (the server checks proximity before
 * dispatching).
 */
const fixture: Mission = parseMission({
  id: 'maptest',
  title: 'Map-Test',
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 300,
  roles: [
    { id: 'anleitung', name: 'Anleitung', description: '' },
    { id: 'steuerpult', name: 'Steuerpult', description: '' },
  ],
  puzzles: [
    { type: 'button-sync', id: 'first', title: 'Erstes' },
    { type: 'button-sync', id: 'second', title: 'Zweites' },
  ],
  map: {
    tiles: ['#########', '#...#...#', '#.......#', '#...#...#', '#...#...#', '#########'],
    spawns: { anleitung: { x: 1, y: 1 }, steuerpult: { x: 3, y: 1 } },
    doors: [{ id: 'd1', x: 4, y: 2, opensBy: { kind: 'plate', plateId: 'p1' } }],
    plates: [{ id: 'p1', x: 2, y: 3, label: 'HALTEN' }],
    stations: [
      { puzzleId: 'first', x: 1, y: 4 },
      { puzzleId: 'second', x: 3, y: 4 },
    ],
    labels: [{ text: 'LINKS', x: 1, y: 1 }],
  },
});

const T0 = 1_000_000;

function run(actions: Action[], from: GameState): GameState {
  return actions.reduce(applyAction, from);
}

/** Both stations are button-syncs: one input, a press, from everyone standing there. */
function bothPress(state: GameState, at: number): GameState {
  const def = state.mission.puzzles[state.currentPuzzleIndex];
  return run(
    [
      { type: 'puzzle-input', playerId: 'p1', at, input: { press: true } },
      { type: 'puzzle-input', playerId: 'p2', at, input: { press: true } },
    ],
    standing(state, { stations: { [def?.id ?? '']: ['p1', 'p2'] } }),
  );
}

function started(mission: Mission = fixture): GameState {
  return run(
    [
      { type: 'player-join', playerId: 'p1', name: 'Anna' },
      { type: 'player-join', playerId: 'p2', name: 'Ben' },
      { type: 'select-role', playerId: 'p1', roleId: 'anleitung' },
      { type: 'select-role', playerId: 'p2', roleId: 'steuerpult' },
      { type: 'set-ready', playerId: 'p2', ready: true },
      { type: 'start-mission', playerId: 'p1', at: T0, seed: 1 },
    ],
    initialState(mission),
  );
}

describe('mapped missions', () => {
  it('waits for station activation and exposes the map with spawns', () => {
    const state = started();
    expect(state.puzzleState).toBeNull();
    expect(state.pressedPlates).toEqual([]);
    const anna = viewFor(state, 'p1');
    expect(anna.puzzle).toBeNull();
    expect(anna.map?.yourSpawn).toEqual({ x: 1, y: 1 });
    expect(viewFor(state, 'p2').map?.yourSpawn).toEqual({ x: 3, y: 1 });
    expect(anna.map?.stations).toEqual([
      { puzzleId: 'first', x: 1, y: 4, title: 'Erstes', status: 'armed' },
      { puzzleId: 'second', x: 3, y: 4, title: 'Zweites', status: 'locked' },
    ]);
    expect(anna.map?.manuals).toEqual([]);
    expect(anna.map?.edgeworkSign).toBeNull();
  });

  it('opens plate doors exactly while the plate is held', () => {
    let state = started();
    expect(viewFor(state, 'p1').map?.doors[0]?.open).toBe(false);
    state = applyAction(state, { type: 'set-occupancy', plates: ['p1'], panels: [] });
    const view = viewFor(state, 'p1');
    expect(view.map?.doors[0]?.open).toBe(true);
    expect(view.map?.plates[0]?.pressed).toBe(true);
    state = applyAction(state, { type: 'set-occupancy', plates: [], panels: [] });
    expect(viewFor(state, 'p1').map?.doors[0]?.open).toBe(false);
  });

  it('ignores plate updates outside a running mission', () => {
    const lobby = run(
      [{ type: 'player-join', playerId: 'p1', name: 'Anna' }],
      initialState(fixture),
    );
    expect(
      applyAction(lobby, { type: 'set-occupancy', plates: ['p1'], panels: [] }).pressedPlates,
    ).toEqual([]);
  });

  it('activates stations in order via interact and waits again after a solve', () => {
    let state = started();
    state = applyAction(state, { type: 'interact', playerId: 'p2', at: T0 + 1000 });
    expect(state.puzzleState).not.toBeNull();
    expect(viewFor(state, 'p2').puzzle?.kind).toBe('button-sync');

    expect(() =>
      applyAction(state, { type: 'interact', playerId: 'p2', at: T0 + 1100 }),
    ).toThrow(/läuft schon/);

    state = bothPress(state, T0 + 2000);
    expect(state.currentPuzzleIndex).toBe(1);
    expect(state.puzzleState).toBeNull();
    expect(viewFor(state, 'p2').map?.stations[1]?.status).toBe('armed');

    state = applyAction(state, { type: 'interact', playerId: 'p1', at: T0 + 3000 });
    state = bothPress(state, T0 + 4000);
    expect(state.phase).toBe('won');
  });

  it('puzzle doors stay open once their puzzle is solved', () => {
    const withPuzzleDoor = parseMission({
      ...JSON.parse(JSON.stringify(fixture)),
      id: 'puzzledoor',
      map: {
        ...JSON.parse(JSON.stringify(fixture.map)),
        doors: [{ id: 'd1', x: 4, y: 2, opensBy: { kind: 'puzzle', puzzleId: 'first' } }],
        plates: [],
      },
    });
    let state = started(withPuzzleDoor);
    expect(viewFor(state, 'p1').map?.doors[0]?.open).toBe(false);
    state = bothPress(
      applyAction(state, { type: 'interact', playerId: 'p2', at: T0 + 1000 }),
      T0 + 2000,
    );
    expect(viewFor(state, 'p1').map?.doors[0]?.open).toBe(true);
  });

  it('runs the escape phase: exit opens after the last puzzle, escaped wins', () => {
    const withExit = parseMission({
      ...JSON.parse(JSON.stringify(fixture)),
      id: 'exittest',
      map: { ...JSON.parse(JSON.stringify(fixture.map)), exit: { x: 1, y: 2 } },
    });
    let state = started(withExit);
    // Escaping before the puzzles are done is rejected.
    expect(() => applyAction(state, { type: 'escaped', at: T0 + 1 })).toThrow(/verriegelt/);
    expect(viewFor(state, 'p1').map?.exit).toEqual({ x: 1, y: 2, open: false });

    state = bothPress(
      applyAction(state, { type: 'interact', playerId: 'p2', at: T0 + 1000 }),
      T0 + 2000,
    );
    state = bothPress(
      applyAction(state, { type: 'interact', playerId: 'p1', at: T0 + 3000 }),
      T0 + 4500,
    );
    expect(state.phase).toBe('playing');
    expect(inEscapePhase(state)).toBe(true);
    expect(viewFor(state, 'p1').map?.exit?.open).toBe(true);
    expect(viewFor(state, 'p1').map?.stations.every((s) => s.status === 'done')).toBe(true);

    const won = applyAction(state, { type: 'escaped', at: T0 + 9000 });
    expect(won.phase).toBe('won');
    expect(won.finishedAt).toBe(T0 + 9000);
    // A too-late escape is a loss.
    expect(applyAction(state, { type: 'escaped', at: T0 + 300_000 }).phase).toBe('lost');
  });

  it('takes no mission without a map: there would be nowhere to stand', () => {
    expect(() =>
      parseMission({ ...JSON.parse(JSON.stringify(fixture)), id: 'nomap', map: undefined }),
    ).toThrow(/map/);
  });
});

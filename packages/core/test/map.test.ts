import { describe, expect, it } from 'vitest';
import { applyAction, initialState, parseMission, viewFor } from '../src/index.js';
import type { Action, GameState, Mission } from '../src/index.js';

/**
 * Fixture: two rooms split by a wall at x=4 with a door at (4,2) that opens
 * only while the plate 'p1' is held. Movement itself is client-authoritative
 * and not part of the reducer — plates arrive as set-pressed-plates actions
 * (the server derives them from live positions), stations are activated via
 * interact (the server checks proximity before dispatching).
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
    {
      type: 'button-sync',
      id: 'first',
      title: 'Erstes',
      prompt: '',
      buttons: [{ roleId: 'steuerpult', label: 'A' }],
    },
    {
      type: 'button-sync',
      id: 'second',
      title: 'Zweites',
      prompt: '',
      buttons: [
        { roleId: 'anleitung', label: 'B1' },
        { roleId: 'steuerpult', label: 'B2' },
      ],
    },
  ],
  map: {
    tiles: ['#########', '#...#...#', '#.......#', '#...#...#', '#...#...#', '#########'],
    spawns: { anleitung: { x: 1, y: 1 }, steuerpult: { x: 3, y: 1 } },
    doors: [{ id: 'd1', x: 4, y: 2, opensBy: { kind: 'plate', plateId: 'p1' } }],
    plates: [{ id: 'p1', x: 2, y: 3, label: 'HALTEN' }],
    stations: [
      { puzzleId: 'first', x: 6, y: 3 },
      { puzzleId: 'second', x: 7, y: 4 },
    ],
    labels: [{ text: 'LINKS', x: 1, y: 1 }],
  },
});

const T0 = 1_000_000;

function run(actions: Action[], from: GameState): GameState {
  return actions.reduce(applyAction, from);
}

function started(): GameState {
  return run(
    [
      { type: 'player-join', playerId: 'p1', name: 'Anna' },
      { type: 'player-join', playerId: 'p2', name: 'Ben' },
      { type: 'select-role', playerId: 'p1', roleId: 'anleitung' },
      { type: 'select-role', playerId: 'p2', roleId: 'steuerpult' },
      { type: 'start-mission', playerId: 'p1', at: T0, seed: 1 },
    ],
    initialState(fixture),
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
      { x: 6, y: 3, title: 'Erstes', status: 'armed' },
      { x: 7, y: 4, title: 'Zweites', status: 'locked' },
    ]);
  });

  it('opens plate doors exactly while the plate is held', () => {
    let state = started();
    expect(viewFor(state, 'p1').map?.doors[0]?.open).toBe(false);
    state = applyAction(state, { type: 'set-pressed-plates', plates: ['p1'] });
    const view = viewFor(state, 'p1');
    expect(view.map?.doors[0]?.open).toBe(true);
    expect(view.map?.plates[0]?.pressed).toBe(true);
    state = applyAction(state, { type: 'set-pressed-plates', plates: [] });
    expect(viewFor(state, 'p1').map?.doors[0]?.open).toBe(false);
  });

  it('ignores plate updates outside a running mission', () => {
    const lobby = run(
      [{ type: 'player-join', playerId: 'p1', name: 'Anna' }],
      initialState(fixture),
    );
    expect(
      applyAction(lobby, { type: 'set-pressed-plates', plates: ['p1'] }).pressedPlates,
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

    state = applyAction(state, { type: 'press-button', playerId: 'p2', at: T0 + 2000 });
    expect(state.currentPuzzleIndex).toBe(1);
    expect(state.puzzleState).toBeNull();
    expect(viewFor(state, 'p2').map?.stations[1]?.status).toBe('armed');

    state = applyAction(state, { type: 'interact', playerId: 'p1', at: T0 + 3000 });
    state = run(
      [
        { type: 'press-button', playerId: 'p1', at: T0 + 4000 },
        { type: 'press-button', playerId: 'p2', at: T0 + 4500 },
      ],
      state,
    );
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
    let state = run(
      [
        { type: 'player-join', playerId: 'p1', name: 'Anna' },
        { type: 'player-join', playerId: 'p2', name: 'Ben' },
        { type: 'select-role', playerId: 'p1', roleId: 'anleitung' },
        { type: 'select-role', playerId: 'p2', roleId: 'steuerpult' },
        { type: 'start-mission', playerId: 'p1', at: T0, seed: 1 },
      ],
      initialState(withPuzzleDoor),
    );
    expect(viewFor(state, 'p1').map?.doors[0]?.open).toBe(false);
    state = run(
      [
        { type: 'interact', playerId: 'p2', at: T0 + 1000 },
        { type: 'press-button', playerId: 'p2', at: T0 + 2000 },
      ],
      state,
    );
    expect(viewFor(state, 'p1').map?.doors[0]?.open).toBe(true);
  });

  it('keeps the old auto-chain flow for missions without a map', () => {
    const noMap = parseMission({
      ...JSON.parse(JSON.stringify(fixture)),
      id: 'nomap',
      map: undefined,
    });
    const state = run(
      [
        { type: 'player-join', playerId: 'p1', name: 'Anna' },
        { type: 'player-join', playerId: 'p2', name: 'Ben' },
        { type: 'select-role', playerId: 'p1', roleId: 'anleitung' },
        { type: 'select-role', playerId: 'p2', roleId: 'steuerpult' },
        { type: 'start-mission', playerId: 'p1', at: T0, seed: 1 },
      ],
      initialState(noMap),
    );
    expect(state.puzzleState).not.toBeNull();
    expect(viewFor(state, 'p1').map).toBeNull();
    expect(() =>
      applyAction(state, { type: 'interact', playerId: 'p1', at: T0 + 1000 }),
    ).toThrow(/keine Karte/);
  });
});

import { describe, expect, it } from 'vitest';
import { applyAction, initialState, parseMission, viewFor } from '../src/index.js';
import type { Action, GameState, Mission } from '../src/index.js';

/** Two chambers with an emergency valve in each, plus two stations. */
const mission: Mission = parseMission({
  id: 'sabotagetest',
  title: 'Sabotage-Test',
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  players: { min: 2, max: 2 },
  puzzles: [
    { type: 'button-sync', id: 'first', title: 'Erstes' },
    { type: 'button-sync', id: 'second', title: 'Zweites' },
  ],
  map: {
    tiles: ['#########', '#.......#', '#.......#', '#########'],
    spawns: [
      { x: 1, y: 1 },
      { x: 7, y: 1 },
    ],
    stations: [
      { puzzleId: 'first', x: 3, y: 1 },
      { puzzleId: 'second', x: 5, y: 1 },
    ],
    exit: { x: 4, y: 2 },
    sabotage: {
      label: 'KÜHLUNG AUSGEFALLEN',
      hint: 'Beide Ventile!',
      durationSec: 40,
      penaltySec: 60,
      panels: [
        { id: 'links', x: 1, y: 2 },
        { id: 'rechts', x: 7, y: 2 },
      ],
    },
  },
});

const T0 = 1_000_000;

function run(actions: Action[], from: GameState): GameState {
  return actions.reduce(applyAction, from);
}

function playing(): GameState {
  return run(
    [
      { type: 'player-join', playerId: 'p1', name: 'Anna' },
      { type: 'player-join', playerId: 'p2', name: 'Ben' },
      { type: 'set-ready', playerId: 'p2', ready: true },
      { type: 'start-mission', playerId: 'p1', at: T0, seed: 1 },
    ],
    initialState(mission),
  );
}

describe('sabotage emergencies', () => {
  it('starts with a deadline and shows up in every view', () => {
    const state = applyAction(playing(), { type: 'sabotage-start', at: T0 + 1000 });
    expect(state.sabotage).toEqual({ endsAt: T0 + 41_000 });
    const view = viewFor(state, 'p1').map?.sabotage;
    expect(view?.label).toBe('KÜHLUNG AUSGEFALLEN');
    expect(view?.endsAt).toBe(T0 + 41_000);
    expect(view?.panels.map((p) => p.occupied)).toEqual([false, false]);
  });

  it('interrupts an open puzzle so both players can run to the panels', () => {
    let state = applyAction(playing(), { type: 'interact', playerId: 'p2', at: T0 + 500 });
    expect(state.puzzleState).not.toBeNull();
    state = applyAction(state, { type: 'sabotage-start', at: T0 + 1000 });
    expect(state.puzzleState).toBeNull();
    // The station stays armed, so the puzzle can be restarted afterwards.
    expect(viewFor(state, 'p2').map?.stations[0]?.status).toBe('armed');
  });

  it('blocks station activation while the emergency runs', () => {
    const state = applyAction(playing(), { type: 'sabotage-start', at: T0 + 1000 });
    expect(() =>
      applyAction(state, { type: 'interact', playerId: 'p2', at: T0 + 2000 }),
    ).toThrow(/Notfall/);
  });

  it('shows which panels are manned and clears when they all are', () => {
    let state = applyAction(playing(), { type: 'sabotage-start', at: T0 + 1000 });
    state = applyAction(state, { type: 'set-occupancy', plates: [], panels: ['links'] });
    expect(viewFor(state, 'p1').map?.sabotage?.panels.map((p) => p.occupied)).toEqual([
      true,
      false,
    ]);
    expect(state.sabotage).not.toBeNull();

    state = applyAction(state, { type: 'sabotage-cleared', at: T0 + 9000 });
    expect(state.sabotage).toBeNull();
    expect(viewFor(state, 'p1').map?.sabotage).toBeNull();
    // Afterwards the crew can get back to work.
    expect(
      applyAction(state, { type: 'interact', playerId: 'p2', at: T0 + 9500 }).puzzleState,
    ).not.toBeNull();
  });

  it('costs a heavy time penalty when it runs out', () => {
    const state = applyAction(playing(), { type: 'sabotage-start', at: T0 + 1000 });
    const before = state.deadlineAt ?? 0;
    const expired = applyAction(state, { type: 'sabotage-expired', at: T0 + 41_000 });
    expect(expired.sabotage).toBeNull();
    expect(expired.deadlineAt).toBe(before - 60_000);
    expect(expired.penaltySeq).toBe(1);
    expect(expired.phase).toBe('playing');
  });

  it('never starts twice or outside a running mission', () => {
    const started = applyAction(playing(), { type: 'sabotage-start', at: T0 + 1000 });
    const again = applyAction(started, { type: 'sabotage-start', at: T0 + 2000 });
    expect(again.sabotage).toEqual(started.sabotage);

    const lobby = run(
      [{ type: 'player-join', playerId: 'p1', name: 'Anna' }],
      initialState(mission),
    );
    expect(applyAction(lobby, { type: 'sabotage-start', at: T0 }).sabotage).toBeNull();
  });

  it('rejects maps with more panels than the smallest crew has players', () => {
    expect(() =>
      parseMission({
        ...JSON.parse(JSON.stringify(mission)),
        map: {
          ...JSON.parse(JSON.stringify(mission.map)),
          sabotage: {
            label: 'X',
            panels: [
              { id: 'a', x: 1, y: 2 },
              { id: 'b', x: 3, y: 2 },
              { id: 'c', x: 5, y: 2 },
            ],
          },
        },
      }),
    ).toThrow(/more sabotage panels than the smallest crew has players/);
  });
});

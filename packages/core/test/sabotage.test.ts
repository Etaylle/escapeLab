import { describe, expect, it } from 'vitest';
import { applyAction, initialState, parseMission, radioLines, viewFor } from '../src/index.js';
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

function playing(of: Mission = mission): GameState {
  return run(
    [
      { type: 'player-join', playerId: 'p1', name: 'Anna' },
      { type: 'player-join', playerId: 'p2', name: 'Ben' },
      { type: 'set-ready', playerId: 'p2', ready: true },
      { type: 'start-mission', playerId: 'p1', at: T0, seed: 1 },
    ],
    initialState(of),
  );
}

/** The mission, its emergency given a message for the plant's loudspeakers. */
const ANNOUNCE = 'Störung im Kühlkreislauf. Relais auf Handbetrieb.';
const announcing: Mission = parseMission({
  ...JSON.parse(JSON.stringify(mission)),
  map: {
    ...JSON.parse(JSON.stringify(mission.map)),
    sabotage: { ...JSON.parse(JSON.stringify(mission.map.sabotage)), announce: ANNOUNCE },
  },
});

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
    const station = viewFor(state, 'p2').map?.stations[0];
    expect(station?.known === true ? station.status : null).toBe('armed');
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

  it('has the plant’s loudspeakers say so as it starts, every time, where the mission gives a word', () => {
    const first = applyAction(playing(announcing), { type: 'sabotage-start', at: T0 + 1000 });
    expect(first.events.slice(-2)).toEqual([
      { at: T0 + 1000, kind: 'sabotage', label: 'Notfall: KÜHLUNG AUSGEFALLEN', seconds: null },
      { at: T0 + 1000, kind: 'radio', label: ANNOUNCE, seconds: null, moment: 'announce' },
    ]);
    const cleared = applyAction(first, { type: 'sabotage-cleared', at: T0 + 9000 });
    const second = applyAction(cleared, { type: 'sabotage-start', at: T0 + 200_000 });
    const said = (state: GameState) => state.events.filter((e) => e.moment === 'announce');
    expect(said(cleared)).toHaveLength(1);
    expect(said(second).map((e) => e.at)).toEqual([T0 + 1000, T0 + 200_000]);
    // A start that changes nothing says nothing either.
    expect(said(applyAction(second, { type: 'sabotage-start', at: T0 + 201_000 }))).toHaveLength(2);
    // Without a message the loudspeakers stay quiet.
    const quiet = applyAction(playing(), { type: 'sabotage-start', at: T0 + 1000 });
    expect(quiet.events.filter((e) => e.kind === 'radio' && e.at > T0)).toEqual([]);
    expect(radioLines(announcing).at(-1)).toEqual({
      text: ANNOUNCE,
      when: 'announce',
      puzzleId: null,
      speaker: 'pa',
      mood: null,
    });
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

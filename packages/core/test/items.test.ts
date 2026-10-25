import { describe, expect, it } from 'vitest';
import { applyAction, initialState, missingItemsFor, parseMission, viewFor } from '../src/index.js';
import type { Action, GameState, Mission } from '../src/index.js';
import { standing } from './lab.js';

/** A corridor with a crate at one end and its slot at the other. */
const mission: Mission = parseMission({
  id: 'itemtest',
  title: 'Trage-Test',
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  players: { min: 2, max: 2 },
  puzzles: [
    { type: 'button-sync', id: 'first', title: 'Erstes' },
    { type: 'button-sync', id: 'second', title: 'Zweites' },
  ],
  map: {
    tiles: ['#########', '#.......#', '#########'],
    spawns: [
      { x: 1, y: 1 },
      { x: 7, y: 1 },
    ],
    stations: [
      { puzzleId: 'first', x: 3, y: 1 },
      { puzzleId: 'second', x: 5, y: 1 },
    ],
    items: [
      {
        id: 'sicherung',
        label: 'SICHERUNG',
        x: 1,
        y: 1,
        deliverTo: { x: 7, y: 1 },
        requiredFor: 'second',
      },
    ],
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

/** Solve the first puzzle so the item-gated station becomes the current one. */
function atGatedStation(): GameState {
  return run(
    [
      { type: 'interact', playerId: 'p2', at: T0 + 100 },
      { type: 'puzzle-input', playerId: 'p1', at: T0 + 200, input: { press: true } },
      { type: 'puzzle-input', playerId: 'p2', at: T0 + 200, input: { press: true } },
    ],
    standing(playing(), { stations: { first: ['p1', 'p2'] } }),
  );
}

const pick = (playerId: string): Action => ({
  type: 'pick-item',
  playerId,
  itemId: 'sicherung',
  at: T0 + 1000,
});

describe('carryable items', () => {
  it('starts on the floor and shows up in every view', () => {
    const state = playing();
    expect(state.items['sicherung']).toEqual({
      x: 1.5,
      y: 1.5,
      carriedBy: null,
      delivered: false,
    });
    const item = viewFor(state, 'p1').map?.items[0];
    expect(item).toMatchObject({ label: 'SICHERUNG', delivered: false, carriedBy: null });
    expect(item?.requiredForTitle).toBe('Zweites');
  });

  it('can be picked up, dropped where you stand, and picked up by someone else', () => {
    let state = applyAction(playing(), pick('p1'));
    expect(state.items['sicherung']?.carriedBy).toBe('p1');

    state = applyAction(state, {
      type: 'drop-item',
      playerId: 'p1',
      itemId: 'sicherung',
      x: 4.25,
      y: 1.5,
      at: T0 + 2000,
    });
    expect(state.items['sicherung']).toMatchObject({ carriedBy: null, x: 4.25, y: 1.5 });

    state = applyAction(state, pick('p2'));
    expect(state.items['sicherung']?.carriedBy).toBe('p2');
  });

  it('refuses a second item and someone else\'s item', () => {
    const carried = applyAction(playing(), pick('p1'));
    expect(() => applyAction(carried, pick('p2'))).toThrow(/jemand anderes/);
    expect(() => applyAction(carried, pick('p1'))).toThrow(/Schon in der Hand/);
    expect(() =>
      applyAction(carried, {
        type: 'drop-item',
        playerId: 'p2',
        itemId: 'sicherung',
        x: 2,
        y: 1,
        at: T0,
      }),
    ).toThrow(/Nicht in der Hand/);
  });

  it('keeps the station inert until the item is delivered', () => {
    const state = atGatedStation();
    expect(missingItemsFor(state, 'second')).toEqual(['SICHERUNG']);
    expect(() =>
      applyAction(state, { type: 'interact', playerId: 'p2', at: T0 + 3000 }),
    ).toThrow(/fehlt noch: SICHERUNG/);

    const delivered = run(
      [
        pick('p1'),
        { type: 'deliver-item', playerId: 'p1', itemId: 'sicherung', at: T0 + 4000 },
      ],
      state,
    );
    expect(missingItemsFor(delivered, 'second')).toEqual([]);
    expect(delivered.items['sicherung']).toMatchObject({
      delivered: true,
      carriedBy: null,
      x: 7.5,
      y: 1.5,
    });
    expect(
      applyAction(delivered, { type: 'interact', playerId: 'p2', at: T0 + 5000 }).puzzleState,
    ).not.toBeNull();
  });

  it('cannot be touched again once delivered, or while paused', () => {
    const delivered = run(
      [pick('p1'), { type: 'deliver-item', playerId: 'p1', itemId: 'sicherung', at: T0 + 2000 }],
      atGatedStation(),
    );
    expect(() => applyAction(delivered, pick('p2'))).toThrow(/bereits abgeliefert/);

    const paused = applyAction(playing(), { type: 'set-paused', paused: true, at: T0 + 500 });
    expect(() => applyAction(paused, pick('p1'))).toThrow(/Pausiert/);
  });

  it('rejects an item required for a puzzle that does not exist', () => {
    expect(() =>
      parseMission({
        ...JSON.parse(JSON.stringify(mission)),
        map: {
          ...JSON.parse(JSON.stringify(mission.map)),
          items: [
            {
              id: 'x',
              label: 'X',
              x: 1,
              y: 1,
              deliverTo: { x: 2, y: 1 },
              requiredFor: 'gibtsnicht',
            },
          ],
        },
      }),
    ).toThrow(/required for unknown puzzle/);
  });
});

import { describe, expect, it } from 'vitest';
import { applyAction, initialState, parseMission } from '@escapelab/core';
import type { Action, GameState, Mission } from '@escapelab/core';
import { DronePatrol } from '../src/drones.js';

/**
 * Fixture: two chambers divided by a pillar wall at column 4. One drone
 * sweeps the middle row of the left chamber, facing right.
 *
 *   012345678
 * 0 #########
 * 1 #...#...#
 * 2 #...#...#   drone patrols (1,2) <-> (3,2)
 * 3 #...#...#
 * 4 #########
 */
const mission: Mission = parseMission({
  id: 'dronetest',
  title: 'Drohnen-Test',
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 300,
  players: { min: 2, max: 2 },
  puzzles: [{ type: 'button-sync', id: 'only', title: 'Einziges' }],
  map: {
    tiles: ['#########', '#...#...#', '#...#...#', '#...#...#', '#########'],
    spawns: [
      { x: 1, y: 1 },
      { x: 3, y: 1 },
    ],
    stations: [{ puzzleId: 'only', x: 2, y: 1 }],
    plates: [{ id: 'kamera', x: 3, y: 3, label: 'KAMERA HALTEN' }],
    drones: [
      {
        id: 'wache',
        waypoints: [
          { x: 1, y: 2 },
          { x: 3, y: 2 },
        ],
        speed: 1,
        range: 6,
        halfAngleDeg: 30,
        penaltySec: 15,
        frozenByPlate: 'kamera',
      },
    ],
  },
});

/**
 * The two chambers joined by a plate door at (4,2), right in the drone's line.
 *
 *   012345678
 * 0 #########
 * 1 #...#...#
 * 2 #.......#   drone (1,2) facing the door (4,2)
 * 3 #...#...#   plate (1,3)
 * 4 #########
 */
const doorway: Mission = parseMission({
  ...JSON.parse(JSON.stringify(mission)),
  id: 'doorwaytest',
  map: {
    ...JSON.parse(JSON.stringify(mission.map)),
    tiles: ['#########', '#...#...#', '#.......#', '#...#...#', '#########'],
    doors: [{ id: 'tuer', x: 4, y: 2, opensBy: { kind: 'plate', plateId: 'platte' } }],
    plates: [{ id: 'platte', x: 1, y: 3, label: 'HALTEN' }],
    drones: [
      {
        id: 'wache',
        waypoints: [
          { x: 1, y: 2 },
          { x: 3, y: 2 },
        ],
        speed: 1,
        range: 6,
        halfAngleDeg: 30,
        penaltySec: 15,
      },
    ],
  },
});

/** The same lab with a second station; the drone sleeps until the first one is done. */
const sleeper: Mission = parseMission({
  ...JSON.parse(JSON.stringify(mission)),
  id: 'sleepertest',
  puzzles: [
    ...JSON.parse(JSON.stringify(mission.puzzles)),
    { type: 'button-sync', id: 'second', title: 'Zweites' },
  ],
  map: {
    ...JSON.parse(JSON.stringify(mission.map)),
    stations: [
      { puzzleId: 'only', x: 2, y: 1 },
      { puzzleId: 'second', x: 2, y: 3 },
    ],
    drones: mission.map?.drones.map((d) => ({ ...d, activeAfterSolved: 1 })),
  },
});

const T0 = 1_000_000;

function run(actions: Action[], from: GameState): GameState {
  return actions.reduce(applyAction, from);
}

function playing(fixture: Mission = mission): GameState {
  return run(
    [
      { type: 'player-join', playerId: 'p1', name: 'Anna' },
      { type: 'player-join', playerId: 'p2', name: 'Ben' },
      { type: 'set-ready', playerId: 'p2', ready: true },
      { type: 'start-mission', playerId: 'p1', at: T0, seed: 1 },
    ],
    initialState(fixture),
  );
}

function at(x: number, y: number): Map<string, { x: number; y: number }> {
  return new Map([['p1', { x, y }]]);
}

/** Who stands at which station, the way the room reports it. */
function standing(state: GameState, stations: Record<string, string[]>): GameState {
  return applyAction(state, {
    type: 'set-presence',
    stations,
    manuals: {},
    signSeen: [],
    seen: [],
    exit: [],
  });
}

function patrol(fixture: Mission = mission): DronePatrol {
  const map = fixture.map;
  if (map === undefined) {
    throw new Error('fixture needs a map');
  }
  return new DronePatrol(map);
}

describe('DronePatrol', () => {
  it('starts on its first waypoint and moves towards the next', () => {
    const drones = patrol();
    const state = playing();
    const start = drones.snapshot(state, T0)['wache'];
    expect(start).toEqual(
      expect.objectContaining({ x: 1.5, y: 2.5, range: 6, alerted: false, frozen: false }),
    );
    drones.step(state, 1); // one second at speed 1 tile/s
    const moved = drones.snapshot(state, T0)['wache'];
    expect(moved?.x).toBeCloseTo(2.5, 2);
    expect(moved?.y).toBeCloseTo(2.5, 2);
  });

  it('turns around at the end of its loop', () => {
    const drones = patrol();
    const state = playing();
    drones.step(state, 2.1); // reach (3,2) …
    drones.step(state, 0.1); // … switch target back to (1,2)
    drones.step(state, 1);
    const pos = drones.snapshot(state, T0)['wache'];
    expect(pos?.x).toBeLessThan(3.5);
  });

  it('spots a player straight ahead inside the cone', () => {
    const drones = patrol();
    const events = drones.detect(playing(), at(3.5, 2.5), T0);
    expect(events).toEqual([{ droneId: 'wache', penaltySec: 15, playerId: 'p1' }]);
  });

  it('ignores a player outside the cone angle', () => {
    const drones = patrol();
    expect(drones.detect(playing(), at(1.5, 1.5), T0)).toEqual([]);
  });

  it('ignores a player behind a wall even when inside the cone', () => {
    const drones = patrol();
    // (6.5,2.5) is dead ahead and in range, but the pillar at column 4 blocks it.
    expect(drones.detect(playing(), at(6.5, 2.5), T0)).toEqual([]);
  });

  it('looks through an open door in its line, and not through a shut one', () => {
    const drones = patrol(doorway);
    const shut = playing(doorway);
    expect(drones.detect(shut, at(6.5, 2.5), T0)).toEqual([]);
    const open = applyAction(shut, { type: 'set-occupancy', plates: ['platte'], panels: [] });
    expect(drones.detect(open, at(6.5, 2.5), T0)).toHaveLength(1);
  });

  it('ignores a player beyond its range', () => {
    const map = mission.map;
    if (map === undefined) {
      throw new Error('fixture needs a map');
    }
    const shortSighted = new DronePatrol({
      ...map,
      drones: map.drones.map((d) => ({ ...d, range: 1.5 })),
    });
    expect(shortSighted.detect(playing(), at(3.5, 2.5), T0)).toEqual([]);
  });

  it('only triggers once per cooldown window', () => {
    const drones = patrol();
    const state = playing();
    expect(drones.detect(state, at(3.5, 2.5), T0)).toHaveLength(1);
    expect(drones.detect(state, at(3.5, 2.5), T0 + 1000)).toHaveLength(0);
    expect(drones.detect(state, at(3.5, 2.5), T0 + 6000)).toHaveLength(1);
  });

  it('reports itself alerted for a while after a sighting', () => {
    const drones = patrol();
    const state = playing();
    drones.detect(state, at(3.5, 2.5), T0);
    expect(drones.snapshot(state, T0 + 1000)['wache']?.alerted).toBe(true);
    expect(drones.snapshot(state, T0 + 6000)['wache']?.alerted).toBe(false);
  });

  it('cannot spot a player heads-down at the open station, but anyone else', () => {
    const drones = patrol();
    const busy = applyAction(standing(playing(), { only: ['p1'] }), {
      type: 'interact',
      playerId: 'p1',
      at: T0 + 10,
    });
    expect(busy.puzzleState).not.toBeNull();
    expect(drones.detect(busy, at(3.5, 2.5), T0)).toEqual([]);
    const elsewhere = standing(busy, { only: ['p2'] });
    expect(drones.detect(elsewhere, at(3.5, 2.5), T0)).toHaveLength(1);
  });

  it('stands still, sees nothing and says so while its plate is held', () => {
    const drones = patrol();
    const held = applyAction(playing(), { type: 'set-occupancy', plates: ['kamera'], panels: [] });
    drones.step(held, 1);
    expect(drones.snapshot(held, T0)['wache']).toMatchObject({ x: 1.5, y: 2.5, frozen: true });
    expect(drones.detect(held, at(3.5, 2.5), T0)).toEqual([]);
    const released = applyAction(held, { type: 'set-occupancy', plates: [], panels: [] });
    expect(drones.snapshot(released, T0)['wache']?.frozen).toBe(false);
    expect(drones.detect(released, at(3.5, 2.5), T0)).toHaveLength(1);
    drones.step(released, 1);
    expect(drones.snapshot(released, T0)['wache']?.x).toBeCloseTo(2.5, 2);
  });

  it('ignores disconnected players', () => {
    const drones = patrol();
    const gone = applyAction(playing(), { type: 'player-disconnected', playerId: 'p1' });
    expect(drones.detect(gone, at(3.5, 2.5), T0)).toEqual([]);
  });
});

describe('sleeping drones', () => {
  it('stay invisible and blind until the crew has solved enough puzzles', () => {
    const drones = patrol(sleeper);
    const state = playing(sleeper);
    drones.step(state, 1);
    expect(drones.snapshot(state, T0)).toEqual({});
    // Dead ahead of where it would look, yet nothing happens.
    expect(drones.detect(state, at(3.5, 2.5), T0)).toEqual([]);
  });

  it('wake on their first waypoint and patrol from there', () => {
    const drones = patrol(sleeper);
    const asleep = playing(sleeper);
    drones.step(asleep, 3);
    const awake = run(
      [
        { type: 'interact', playerId: 'p2', at: T0 + 10 },
        { type: 'puzzle-input', playerId: 'p1', at: T0 + 20, input: { press: true } },
        { type: 'puzzle-input', playerId: 'p2', at: T0 + 20, input: { press: true } },
      ],
      standing(asleep, { only: ['p1', 'p2'] }),
    );
    expect(awake.currentPuzzleIndex).toBe(1);
    expect(drones.snapshot(awake, T0)['wache']).toEqual(
      expect.objectContaining({ x: 1.5, y: 2.5 }),
    );
    drones.step(awake, 1);
    expect(drones.snapshot(awake, T0)['wache']?.x).toBeCloseTo(2.5, 2);
    expect(drones.detect(awake, at(3.5, 2.5), T0)).toHaveLength(1);
  });
});

describe('drone map validation', () => {
  it('rejects a patrol route that crosses a wall', () => {
    const map = mission.map;
    if (map === undefined) {
      throw new Error('fixture needs a map');
    }
    expect(() =>
      parseMission({
        ...JSON.parse(JSON.stringify(mission)),
        map: {
          ...JSON.parse(JSON.stringify(map)),
          drones: [
            {
              id: 'wanddurchflieger',
              waypoints: [
                { x: 1, y: 2 },
                { x: 7, y: 2 },
              ],
            },
          ],
        },
      }),
    ).toThrow(/through a wall/);
  });
});

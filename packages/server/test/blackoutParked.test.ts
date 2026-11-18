import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canSee, drawPools, patrollingDrones, runOrder, walkable } from '@escapelab/core';
import type { GameState, MapDef } from '@escapelab/core';
import { DronePatrol } from '../src/drones.js';
import {
  blackoutMidway,
  blackoutMission,
  DRAW_SEEDS,
  reaktor,
  serverraum,
  wechselplatz,
  type BlackoutCrew,
} from './blackout.js';

/**
 * A crew that has just solved a station and stays where it stood is not caught for it: after
 * every solve of every draw, nobody standing anywhere a console of that station is worked from,
 * or its rules are read from, is seen by a drone — not in the ten seconds that follow, nor on
 * any later round of the beats.
 * The level sees to it, not the engine: both drones sleep until the Serverraum is solved, whose
 * consoles lie out of their sight, and every console after it stands where no beat looks.
 */

const draws = Object.entries(DRAW_SEEDS) as [keyof typeof DRAW_SEEDS, number][];

/** How far from a console's middle the room counts a player at it (room.ts INTERACT_RADIUS). */
const AT_CONSOLE = 1.6;
/** The room's drone tick, s (room.ts DRONE_TICK_MS). */
const TICK_S = 0.08;
/** Both beats flown round more than once, s: the Laborwache's takes 20 s, the Flurwache's 17. */
const BEATS_S = 45;

/** No door shut: a wall alone hides a place from a console here. */
const NONE: ReadonlySet<string> = new Set();

interface Point {
  x: number;
  y: number;
}

/**
 * Every place on a half-tile grid within a console's or a source's reach of the tile `spot`,
 * in sight of it: nobody stands at a place through a wall (room.ts `facesConsole`).
 */
function around(map: MapDef, spot: Point): Point[] {
  const points: Point[] = [];
  const [cx, cy] = [spot.x + 0.5, spot.y + 0.5];
  const seen = (x: number, y: number): boolean => canSee(map, { x, y }, { x: cx, y: cy }, NONE);
  for (let x = cx - 1.5; x <= cx + 1.5; x += 0.5) {
    for (let y = cy - 1.5; y <= cy + 1.5; y += 0.5) {
      const near = Math.hypot(x - cx, y - cy) <= AT_CONSOLE;
      if (near && walkable(map, Math.floor(x), Math.floor(y)) && seen(x, y)) {
        points.push({ x, y });
      }
    }
  }
  return points;
}

/** Every place a console of `puzzleId` is worked from. */
const workedFrom = (map: MapDef, puzzleId: string): Point[] =>
  map.stations.filter((s) => s.puzzleId === puzzleId).flatMap((spot) => around(map, spot));

/**
 * Every place the rules of `puzzleId` are read from: at each source that covers it, on every
 * place a seed may lay that source — not this run's alone.
 */
const readFrom = (map: MapDef, puzzleId: string): Point[] =>
  map.manuals
    .filter((manual) => manual.puzzleIds.includes(puzzleId))
    .flatMap((manual) => manual.spots.flatMap((spot) => around(map, spot)));

/** The first of `points` a drone catches somebody on within `seconds` of `state`, if any. */
function caughtAt(state: GameState, points: readonly Point[], seconds: number): string | null {
  const patrol = new DronePatrol(state.mission.map);
  const [first, second] = state.players;
  for (let t = 0; t < seconds; t += TICK_S) {
    patrol.step(state, TICK_S);
    for (const point of points) {
      const standing = new Map([first, second].flatMap((p) => (p ? [[p.id, point]] : [])));
      const [spotted] = patrol.detect(state, standing, 0);
      if (spotted !== undefined) {
        return `${spotted.droneId} at (${point.x}, ${point.y}) after ${t.toFixed(1)} s`;
      }
    }
  }
  return null;
}

describe('a crew parked at the station it has just solved', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * The run's state once no emergency has the lab — the drones see nobody during one — with
   * both players on their lines, as a snapshot never keeps them: a drone spares a body whose
   * line is down.
   */
  const settled = (crew: BlackoutCrew): GameState => {
    for (let s = 0; s < 120 && crew.room.snapshot().state.sabotage?.emergency; s++) {
      vi.advanceTimersByTime(1000);
    }
    const { state } = crew.room.snapshot();
    expect(state.sabotage?.emergency).toBeUndefined();
    return { ...state, players: state.players.map((p) => ({ ...p, connected: true })) };
  };

  it.each(draws)('%s (seed %i): no drone sees it, after any solve', (_id, seed) => {
    const mission = blackoutMission();
    const order = runOrder(mission.puzzles, drawPools(mission.puzzles, seed));
    const crew = blackoutMidway(undefined, seed);
    // The lever, the Anlaufsteuerung, the Paketfilter: no drone is awake yet.
    expect(patrollingDrones(mission.map, settled(crew))).toEqual([]);
    const steps = [serverraum, wechselplatz, reaktor];
    steps.forEach((solve, i) => {
      solve(crew);
      const state = settled(crew);
      const solved = order[3 + i];
      expect(state.currentPuzzleIndex).toBe(4 + i);
      expect(patrollingDrones(mission.map, state).map((d) => d.id)).toEqual([
        'flurwache',
        'laborwache',
      ]);
      const points = workedFrom(mission.map, solved?.id ?? '');
      expect(points.length, solved?.id).toBeGreaterThanOrEqual(6);
      expect(caughtAt(state, points, BEATS_S), solved?.id).toBeNull();
      // Whoever read its rules for the crew stays at the source as well.
      const reading = readFrom(mission.map, solved?.id ?? '');
      expect(reading.length > 0, solved?.id).toBe(solved?.type !== 'button-sync');
      expect(caughtAt(state, reading, BEATS_S), `reading for ${solved?.id}`).toBeNull();
    });
  });

  it('would be seen on the beats themselves: the check has eyes', () => {
    const crew = blackoutMidway();
    serverraum(crew);
    const state = settled(crew);
    expect(caughtAt(state, [{ x: 15.5, y: 11.5 }], BEATS_S)).toMatch(/^flurwache/);
    expect(caughtAt(state, [{ x: 22.5, y: 17.5 }], BEATS_S)).toMatch(/^laborwache/);
  });
});

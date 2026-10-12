import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMission } from '../src/index.js';
import type { Mission } from '../src/index.js';
import { crewsOf, reachability, tileKey, type Spot } from '../src/reach.js';

/**
 * Guardrail for every shipped mission, beyond what the mission validation
 * already walks (stations in order, every spot of every manual object, the
 * sign): every crew the mission takes can gather at the exit, every
 * carryable can be carried where it belongs, and the walk the game does —
 * puzzle doors open for good once solved, plate doors only while a
 * *different* player stands on the plate — is the one from core's
 * validation.
 */

const missionsDir = new URL('../../../missions/', import.meta.url);
const missions: Mission[] = readdirSync(missionsDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => parseMission(JSON.parse(readFileSync(new URL(f, missionsDir), 'utf8'))));

/** Every crew the mission starts with: each count of players on each choice of spawns. */
function crews(mission: Mission): Spot[][] {
  return crewsOf(mission.map.spawns, mission.players.min, mission.players.max);
}

/** The puzzles solved while the one with `puzzleId` is the current one. */
function solvedBefore(mission: Mission, puzzleId: string | undefined): Set<string> {
  const solved = new Set<string>();
  for (const puzzle of mission.puzzles) {
    if (puzzle.id === puzzleId) {
      break;
    }
    solved.add(puzzle.id);
  }
  return solved;
}

describe.each(missions.map((m) => [m.id, m] as const))('mission %s', (_id, mission) => {
  const map = mission.map;

  it('draws every player a distinct spawn, enough for the largest crew', () => {
    const spawns = map.spawns.map((s) => tileKey(s.x, s.y));
    expect(new Set(spawns).size).toBe(spawns.length);
    expect(spawns.length).toBeGreaterThanOrEqual(mission.players.max);
  });

  it('lets every crew gather at the exit once all puzzles are solved', () => {
    const exit = map.exit;
    expect(exit).toBeDefined();
    const solved = new Set(mission.puzzles.map((p) => p.id));
    for (const crew of crews(mission)) {
      for (const [i, tiles] of reachability(map, crew, solved).entries()) {
        const from = crew[i] === undefined ? String(i) : tileKey(crew[i].x, crew[i].y);
        expect(
          exit !== undefined && tiles.has(tileKey(exit.x, exit.y)),
          `the player starting at ${from} cannot reach the exit`,
        ).toBe(true);
      }
    }
  });

  it('lets someone in every crew fetch and deliver every carryable before it is needed', () => {
    for (const item of map.items) {
      if (item.deliverTo === undefined) {
        continue; // a key: the validation walks it to every spot of its cabinet
      }
      // State of the world while the station waiting for this item is current.
      const solved = solvedBefore(mission, item.requiredFor);
      const pickup = tileKey(item.x, item.y);
      const dropOff = tileKey(item.deliverTo.x, item.deliverTo.y);
      for (const crew of crews(mission)) {
        const reach = reachability(map, crew, solved);
        // The same player has to be able to do both, since it is carried.
        expect(
          reach.some((tiles) => tiles.has(pickup) && tiles.has(dropOff)),
          `no single player can carry "${item.id}" all the way`,
        ).toBe(true);
      }
    }
  });

  it('keeps every station out of reach of its rules, so nobody reads and works it alone', () => {
    // The server counts a player at a spot up to 2 tiles from its centre (once
    // there), so centres more than twice that apart share no standing spot.
    for (const manual of map.manuals) {
      for (const puzzleId of manual.puzzleIds) {
        const station = map.stations.find((s) => s.puzzleId === puzzleId);
        if (station === undefined) {
          throw new Error(`mission "${mission.id}" has no station for "${puzzleId}"`);
        }
        for (const spot of manual.spots) {
          expect(
            Math.hypot(station.x - spot.x, station.y - spot.y),
            `"${manual.id}" at ${spot.x},${spot.y} lies within reach of station "${puzzleId}"`,
          ).toBeGreaterThan(4);
        }
      }
    }
  });

  it('keeps the exit clear of plates so nobody is counted out by accident', () => {
    const exit = map.exit;
    if (exit === undefined) {
      return;
    }
    for (const plate of map.plates) {
      expect(
        Math.hypot(plate.x - exit.x, plate.y - exit.y),
        `plate "${plate.id}" sits next to the exit`,
      ).toBeGreaterThan(1.5);
    }
  });
});

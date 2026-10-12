import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMission } from '../src/index.js';
import type { Mission } from '../src/index.js';
import { reachability, tileKey, type Spot } from '../src/reach.js';

/**
 * Guardrail for every shipped mission, beyond what the mission validation
 * already walks (stations in order, manual objects, the sign): everyone can
 * gather at the exit, every carryable can be carried where it belongs, and
 * the walk the game does — puzzle doors open for good once solved, plate
 * doors only while a *different* player stands on the plate — is the one
 * from core's validation.
 */

const missionsDir = new URL('../../../missions/', import.meta.url);
const missions: Mission[] = readdirSync(missionsDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => parseMission(JSON.parse(readFileSync(new URL(f, missionsDir), 'utf8'))));

function spawnsOf(mission: Mission): Spot[] {
  return mission.roles.map((role) => {
    const spawn = mission.map.spawns[role.id];
    if (spawn === undefined) {
      throw new Error(`mission "${mission.id}" has no spawn for "${role.id}"`);
    }
    return spawn;
  });
}

describe.each(missions.map((m) => [m.id, m] as const))('mission %s', (_id, mission) => {
  const map = mission.map;

  it('spawns every role in a distinct starting position', () => {
    const spawns = spawnsOf(mission).map((s) => tileKey(s.x, s.y));
    expect(new Set(spawns).size).toBe(spawns.length);
  });

  it('lets everyone gather at the exit once all puzzles are solved', () => {
    const exit = map.exit;
    expect(exit).toBeDefined();
    const solved = new Set(mission.puzzles.map((p) => p.id));
    for (const [i, tiles] of reachability(map, spawnsOf(mission), solved).entries()) {
      const roleId = mission.roles[i]?.id ?? String(i);
      expect(
        exit !== undefined && tiles.has(tileKey(exit.x, exit.y)),
        `role "${roleId}" cannot reach the exit`,
      ).toBe(true);
    }
  });

  it('lets someone fetch and deliver every carryable before it is needed', () => {
    for (const item of map.items) {
      // State of the world while the station waiting for this item is current.
      const solved = new Set<string>();
      for (const puzzle of mission.puzzles) {
        if (puzzle.id === item.requiredFor) {
          break;
        }
        solved.add(puzzle.id);
      }
      const reach = reachability(map, spawnsOf(mission), solved);
      const pickup = tileKey(item.x, item.y);
      const dropOff = tileKey(item.deliverTo.x, item.deliverTo.y);
      expect(reach.some((tiles) => tiles.has(pickup)), `nobody can reach "${item.id}"`).toBe(true);
      expect(
        reach.some((tiles) => tiles.has(dropOff)),
        `nobody can reach the drop-off of "${item.id}"`,
      ).toBe(true);
      // And the same player has to be able to do both, since it is carried.
      expect(
        reach.some((tiles) => tiles.has(pickup) && tiles.has(dropOff)),
        `no single player can carry "${item.id}" all the way`,
      ).toBe(true);
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

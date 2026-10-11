import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMission } from '../src/index.js';
import type { MapDef, Mission } from '../src/index.js';

/**
 * Guardrail for every shipped mission: walk the map the way the game does
 * (puzzle doors open for good once solved, plate doors only while a *different*
 * player stands on the plate) and prove that the stations can be activated in
 * order and that everyone can gather at the exit afterwards.
 */

const missionsDir = new URL('../../../missions/', import.meta.url);
const missions: Mission[] = readdirSync(missionsDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => parseMission(JSON.parse(readFileSync(new URL(f, missionsDir), 'utf8'))));

const key = (x: number, y: number): string => `${x},${y}`;
const STEPS = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
] as const;

function isFloor(map: MapDef, x: number, y: number): boolean {
  return map.tiles[y]?.charAt(x) === '.';
}

/** Tiles reachable from `start`, treating doors as walls unless `isOpen` says otherwise. */
function flood(
  map: MapDef,
  start: { x: number; y: number },
  isOpen: (doorId: string) => boolean,
): Set<string> {
  const doorAt = new Map(map.doors.map((d) => [key(d.x, d.y), d.id]));
  const seen = new Set<string>([key(start.x, start.y)]);
  const queue: [number, number][] = [[start.x, start.y]];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    if (current === undefined) {
      break;
    }
    const [x, y] = current;
    for (const [dx, dy] of STEPS) {
      const nx = x + dx;
      const ny = y + dy;
      const k = key(nx, ny);
      if (seen.has(k) || !isFloor(map, nx, ny)) {
        continue;
      }
      const doorId = doorAt.get(k);
      if (doorId !== undefined && !isOpen(doorId)) {
        continue;
      }
      seen.add(k);
      queue.push([nx, ny]);
    }
  }
  return seen;
}

function requireMap(mission: Mission): MapDef {
  const map = mission.map;
  if (map === undefined) {
    throw new Error(`mission "${mission.id}" has no map`);
  }
  return map;
}

function spawnsOf(mission: Mission): { x: number; y: number }[] {
  const map = requireMap(mission);
  return mission.roles.map((role) => {
    const spawn = map.spawns[role.id];
    if (spawn === undefined) {
      throw new Error(`mission "${mission.id}" has no spawn for "${role.id}"`);
    }
    return spawn;
  });
}

/**
 * Per-player reachability once `solved` puzzles are done, as a fixpoint: a
 * plate door is passable for a player when some *other* player can reach the
 * plate, which is exactly the cooperation the game requires.
 */
function reachability(mission: Mission, solved: Set<string>): Set<string>[] {
  const map = requireMap(mission);
  const spawns = spawnsOf(mission);
  let reach: Set<string>[] = spawns.map(() => new Set<string>());

  for (let round = 0; round < spawns.length * map.doors.length + 2; round++) {
    const next = spawns.map((spawn, i) =>
      flood(map, spawn, (doorId) => {
        const opensBy = map.doors.find((d) => d.id === doorId)?.opensBy;
        if (opensBy === undefined) {
          return false;
        }
        if (opensBy.kind === 'puzzle') {
          return solved.has(opensBy.puzzleId);
        }
        const plate = map.plates.find((p) => p.id === opensBy.plateId);
        return (
          plate !== undefined &&
          reach.some((tiles, j) => j !== i && tiles.has(key(plate.x, plate.y)))
        );
      }),
    );
    const grew = next.some((tiles, i) => tiles.size !== (reach[i]?.size ?? 0));
    reach = next;
    if (!grew) {
      break;
    }
  }
  return reach;
}

/** On the station tile or orthogonally next to it, like the in-game check. */
function canActivate(tiles: Set<string>, station: { x: number; y: number }): boolean {
  if (tiles.has(key(station.x, station.y))) {
    return true;
  }
  return STEPS.some(([dx, dy]) => tiles.has(key(station.x + dx, station.y + dy)));
}

describe.each(missions.map((m) => [m.id, m] as const))('mission %s', (_id, mission) => {
  const map = requireMap(mission);

  it('spawns every role in a distinct starting position', () => {
    const spawns = spawnsOf(mission).map((s) => key(s.x, s.y));
    expect(new Set(spawns).size).toBe(spawns.length);
  });

  it('lets the crew activate every station in mission order', () => {
    const solved = new Set<string>();
    for (const puzzle of mission.puzzles) {
      const station = map.stations.find((s) => s.puzzleId === puzzle.id);
      expect(station, `station for "${puzzle.id}"`).toBeDefined();
      const reach = reachability(mission, solved);
      const whoCan = reach.filter((tiles) => station !== undefined && canActivate(tiles, station));
      expect(whoCan.length, `nobody can reach station "${puzzle.id}"`).toBeGreaterThan(0);
      solved.add(puzzle.id);
    }
  });

  it('lets everyone gather at the exit once all puzzles are solved', () => {
    const exit = map.exit;
    expect(exit).toBeDefined();
    const reach = reachability(mission, new Set(mission.puzzles.map((p) => p.id)));
    for (const [i, tiles] of reach.entries()) {
      const roleId = mission.roles[i]?.id ?? String(i);
      expect(
        exit !== undefined && tiles.has(key(exit.x, exit.y)),
        `role "${roleId}" cannot reach the exit`,
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

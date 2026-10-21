import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMission } from '../src/index.js';
import type { Mission } from '../src/index.js';
import {
  canStandAt,
  crewsOf,
  reachability,
  tileKey,
  twoAtOnce,
  type Spot,
} from '../src/reach.js';

/**
 * Guardrail for every shipped mission, beyond what the mission validation
 * already walks (stations in order, every spot of every manual object, the
 * sign): every crew the mission takes can gather at the exit, every
 * carryable can be carried where it belongs, a plate door that waits for a
 * puzzle needs nobody on its plate once that puzzle is solved, both consoles
 * of a station can be manned at once, and the walk the game does — puzzle
 * doors open for good once solved, plate doors only while a *different*
 * player stands on the plate — is the one from core's validation. The lose
 * story names no cause, since a run is lost to the clock or to the alarm
 * limit and the end screen's last report line says which.
 */

/** Words that tie a lost run to the clock or to the alarms. */
const A_CAUSE =
  /\b(Zeit|Uhr|Countdown|abgelaufen|Sekunde\w*|Minute\w*|erschöpft|Alarm\w*|Fehler\w*)\b/i;

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
        const stations = map.stations.filter((s) => s.puzzleId === puzzleId);
        if (stations.length === 0) {
          throw new Error(`mission "${mission.id}" has no station for "${puzzleId}"`);
        }
        for (const station of stations) {
          for (const spot of manual.spots) {
            expect(
              Math.hypot(station.x - spot.x, station.y - spot.y),
              `"${manual.id}" at ${spot.x},${spot.y} lies within reach of station "${puzzleId}"`,
            ).toBeGreaterThan(4);
          }
        }
      }
    }
  });

  it('lets every player through a plate door alone once the puzzle it waits for is solved', () => {
    for (const door of map.doors) {
      const puzzleId = door.opensBy.kind === 'plate' ? door.opensBy.untilSolved : undefined;
      if (puzzleId === undefined) {
        continue;
      }
      // Nobody stands on the plate any more: each player walks on their own.
      const solved = new Set([...solvedBefore(mission, puzzleId), puzzleId]);
      for (const spawn of map.spawns) {
        const [alone] = reachability(map, [spawn], solved);
        expect(
          alone?.has(tileKey(door.x, door.y)),
          `the player starting at ${tileKey(spawn.x, spawn.y)} cannot pass "${door.id}" alone`,
        ).toBe(true);
      }
    }
  });

  it('keeps the consoles of a station apart, so nobody works both of them alone', () => {
    for (const station of map.stations.filter((s) => s.console === 'a')) {
      const other = map.stations.find((s) => s.puzzleId === station.puzzleId && s.console === 'b');
      expect(other, `station "${station.puzzleId}" has no console b`).toBeDefined();
      expect(
        Math.hypot(station.x - (other?.x ?? station.x), station.y - (other?.y ?? station.y)),
        `the consoles of station "${station.puzzleId}" stand within reach of each other`,
      ).toBeGreaterThan(4);
    }
  });

  it('lets two different players man both consoles of a station at once, for every crew', () => {
    // One walks to a console, the others holding plates for them, and stays
    // there; another walks to the other one without the help of the first.
    for (const a of map.stations.filter((s) => s.console === 'a')) {
      const b = map.stations.find((s) => s.puzzleId === a.puzzleId && s.console === 'b');
      if (b === undefined) {
        throw new Error(`mission "${mission.id}" has no console b for "${a.puzzleId}"`);
      }
      const solved = solvedBefore(mission, a.puzzleId);
      for (const crew of crews(mission)) {
        const from = crew.map((spawn) => tileKey(spawn.x, spawn.y)).join(' · ');
        expect(
          twoAtOnce(map, crew, solved)(a, b),
          `the crew starting at ${from} cannot man both consoles of "${a.puzzleId}" at once`,
        ).toBe(true);
      }
    }
  });

  it('tells the lose story without naming why the run was lost', () => {
    expect(mission.story.lose).not.toMatch(A_CAUSE);
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

/**
 * Blackout's own design, beyond what every mission keeps: the fuse box of
 * the Notstrom-Kasten lies behind the Maschinenraum door, its meter outside
 * where whoever holds the door's plate walks on to it. The plate holds the
 * door only until the box is safe, so from the Signalkette on everybody
 * walks to either console without anyone on it.
 */
describe('mission blackout by design', () => {
  const blackout = missions.find((m) => m.id === 'blackout');
  if (blackout === undefined) {
    throw new Error('missions/blackout.json is missing');
  }

  it('puts the fuse box behind the plate door and its meter on the plate holder\'s side', () => {
    const map = blackout.map;
    const [box, meter] = ['a', 'b'].map((side) =>
      map.stations.find((s) => s.puzzleId === 'notstrom' && s.console === side),
    );
    const door = map.doors.find(
      (d) => d.opensBy.kind === 'plate' && d.opensBy.untilSolved === 'notstrom',
    );
    const plateId = door?.opensBy.kind === 'plate' ? door.opensBy.plateId : undefined;
    const plate = map.plates.find((p) => p.id === plateId);
    if (box === undefined || meter === undefined || plate === undefined) {
      throw new Error('Blackout needs the Notstrom-Kasten at two consoles and a plate door for it');
    }
    // Nobody else around: the plate holder on their own, with nothing solved yet.
    const [alone = new Set<string>()] = reachability(map, [plate], new Set());
    expect(canStandAt(alone, meter), 'the plate holder cannot walk on to the meter').toBe(true);
    expect(canStandAt(alone, box), 'the fuse box lies open without the plate').toBe(false);
  });

  it('starts nobody behind a door: from every spawn the lever lies in reach alone', () => {
    const lever = blackout.map.stations.find((s) => s.puzzleId === blackout.puzzles[0]?.id);
    if (lever === undefined) {
      throw new Error('Blackout has no station for its first puzzle');
    }
    for (const spawn of blackout.map.spawns) {
      const [alone = new Set<string>()] = reachability(blackout.map, [spawn], new Set());
      expect(
        canStandAt(alone, lever),
        `the player starting at ${tileKey(spawn.x, spawn.y)} is shut off from the lever`,
      ).toBe(true);
    }
  });

  it('lets nobody to the fuse box without the plate: every spawn lies outside it', () => {
    // Every crew still mans box and meter at once (the check above for every mission): one of
    // it holds the plate for the other, then walks on to the meter.
    const box = blackout.map.stations.find((s) => s.puzzleId === 'notstrom' && s.console === 'a');
    if (box === undefined) {
      throw new Error('Blackout has no console A for the Notstrom-Kasten');
    }
    const solved = solvedBefore(blackout, 'notstrom');
    for (const spawn of blackout.map.spawns) {
      const [alone = new Set<string>()] = reachability(blackout.map, [spawn], solved);
      expect(
        canStandAt(alone, box),
        `the player starting at ${tileKey(spawn.x, spawn.y)} reaches the fuse box alone`,
      ).toBe(false);
    }
  });

  it('lets each player reach both consoles of the Signalkette on their own', () => {
    const consoles = blackout.map.stations.filter((s) => s.puzzleId === 'signalkette');
    expect(consoles.map((s) => s.console)).toEqual(['a', 'b']);
    const solved = solvedBefore(blackout, 'signalkette');
    for (const spawn of blackout.map.spawns) {
      const [alone = new Set<string>()] = reachability(blackout.map, [spawn], solved);
      for (const spot of consoles) {
        expect(
          canStandAt(alone, spot),
          `from ${tileKey(spawn.x, spawn.y)} nobody reaches console ${spot.console} alone`,
        ).toBe(true);
      }
    }
  });
});

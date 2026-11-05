import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canSee, noteSpot, parseMission, WALK_SPEED } from '../src/index.js';
import type { Mission } from '../src/index.js';
import {
  canStandAt,
  crewsOf,
  reachability,
  tileKey,
  twoAtOnce,
  walkable,
  type Spot,
} from '../src/reach.js';
import { blackoutPlan } from './blackoutPlan.js';

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

const STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * Each floor tile's room, as the clients dress it: the floor no door cuts
 * off, shared out to the label nearest by walking — by the label's name.
 */
function roomsOf(map: Mission['map']): Map<string, string> {
  const doors = new Set(map.doors.map((d) => tileKey(d.x, d.y)));
  const rooms = new Map<string, string>();
  const queue: (Spot & { room: string })[] = [];
  const claim = (x: number, y: number, room: string): void => {
    const key = tileKey(x, y);
    if (map.tiles[y]?.charAt(x) === '.' && !doors.has(key) && !rooms.has(key)) {
      rooms.set(key, room);
      queue.push({ x, y, room });
    }
  };
  map.labels.forEach((label) => claim(label.x, label.y, label.text));
  for (const at of queue) {
    STEPS.forEach(([dx, dy]) => claim(at.x + dx, at.y + dy, at.room));
  }
  return rooms;
}

/** Steps from `from` to every tile it reaches, every door open, round `blocked` and furniture. */
function stepsFrom(map: Mission['map'], from: Spot, blocked: ReadonlySet<string>): Map<string, number> {
  const steps = new Map([[tileKey(from.x, from.y), 0]]);
  const queue = [from];
  for (const at of queue) {
    for (const [dx, dy] of STEPS) {
      const next = { x: at.x + dx, y: at.y + dy };
      const key = tileKey(next.x, next.y);
      if (!steps.has(key) && !blocked.has(key) && walkable(map, next.x, next.y)) {
        steps.set(key, (steps.get(tileKey(at.x, at.y)) ?? 0) + 1);
        queue.push(next);
      }
    }
  }
  return steps;
}

const EIGHT_WAYS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/** The steps a walker takes out of `at`: onto free floor, a diagonal only past two free sides. */
function stepsOut(
  free: (x: number, y: number) => boolean,
  at: Spot,
): { to: Spot; tiles: number }[] {
  return EIGHT_WAYS.filter(
    ([dx, dy]) => free(at.x + dx, at.y + dy) && free(at.x + dx, at.y) && free(at.x, at.y + dy),
  ).map(([dx, dy]) => ({ to: { x: at.x + dx, y: at.y + dy }, tiles: Math.hypot(dx, dy) }));
}

/**
 * How far somebody walks from `from` to `to`, in tiles: the eight ways a player steers, no
 * corner cut, round furniture and the doors in `shut`; Infinity where no way leads there.
 */
function walkTiles(map: Mission['map'], from: Spot, to: Spot, shut: ReadonlySet<string>): number {
  const free = (x: number, y: number): boolean => walkable(map, x, y) && !shut.has(tileKey(x, y));
  const best = new Map([[tileKey(from.x, from.y), 0]]);
  const open: (Spot & { tiles: number })[] = [{ ...from, tiles: 0 }];
  for (let at = open.shift(); at !== undefined; at = open.shift()) {
    if (at.x === to.x && at.y === to.y) {
      return at.tiles;
    }
    for (const step of stepsOut(free, at)) {
      const tiles = at.tiles + step.tiles;
      if (tiles < (best.get(tileKey(step.to.x, step.to.y)) ?? Infinity)) {
        best.set(tileKey(step.to.x, step.to.y), tiles);
        open.push({ ...step.to, tiles });
        open.sort((a, b) => a.tiles - b.tiles);
      }
    }
  }
  return Infinity;
}

/** The furniture each kind of room stands, as docs/art-bible.md's „Rooms with identity" has it. */
const FURNITURE_OF: Readonly<Record<string, readonly string[]>> = {
  archive: ['shelf', 'cart'],
  server: ['rack'],
  machine: ['generator', 'pipes', 'barrel'],
  lab: ['bench', 'hood'],
  reactor: ['core', 'cables', 'desk'],
  control: ['desk'],
};

/**
 * Blackout's own design, beyond what every mission keeps: the fuse box of
 * the Notstrom-Kasten lies behind the Maschinenraum door, its meter outside
 * where whoever holds the door's plate walks on to it. The plate holds the
 * door only until the box is safe, so from the Signalkette on everybody
 * walks to either console without anyone on it. Its rooms run in a loop, the
 * crew starts out of each other's sight, the escape is a run across the lab,
 * every room is furnished and the emergency lamps mark the lever and the
 * corridors' doors. Its main ways open two tiles wide, and no walk of the plan
 * the harness plays takes longer than 12 s.
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

  it('starts nobody in sight of another: the crew has to find each other', () => {
    const map = blackout.map;
    const shut = new Set(map.doors.map((d) => tileKey(d.x, d.y)));
    const middle = (spot: Spot): Spot => ({ x: spot.x + 0.5, y: spot.y + 0.5 });
    for (const [i, one] of map.spawns.entries()) {
      for (const other of map.spawns.slice(i + 1)) {
        expect(
          canSee(map, middle(one), middle(other), shut),
          `the spawns ${tileKey(one.x, one.y)} and ${tileKey(other.x, other.y)} see each other`,
        ).toBe(false);
      }
    }
  });

  it('runs its rooms in a loop: the reactor lies both ways round, by the Serverraum or the Labor', () => {
    const map = blackout.map;
    const rooms = roomsOf(map);
    const floorOf = (room: string): Set<string> =>
      new Set([...rooms].filter(([, name]) => name === room).map(([key]) => key));
    const flur = map.labels.find((label) => label.text === 'FLUR');
    const reactor = map.stations.find((s) => s.puzzleId === 'reaktorstart');
    if (flur === undefined || reactor === undefined) {
      throw new Error('Blackout needs its FLUR and the reactor');
    }
    for (const room of ['SERVERRAUM', 'LABOR']) {
      expect(
        stepsFrom(map, flur, floorOf(room)).has(tileKey(reactor.x, reactor.y)),
        `no way from the Flur to the reactor that keeps out of the ${room}`,
      ).toBe(true);
    }
  });

  it('makes the escape a run across the lab, as long both ways, as the last shift noted', () => {
    const map = blackout.map;
    const rooms = roomsOf(map);
    const floorOf = (room: string): Set<string> =>
      new Set([...rooms].filter(([, name]) => name === room).map(([key]) => key));
    const reactor = map.stations.find((s) => s.puzzleId === 'reaktorstart');
    const exit = map.exit;
    if (reactor === undefined || exit === undefined) {
      throw new Error('Blackout needs the reactor and the hatch');
    }
    const way = (round: string): number | undefined =>
      stepsFrom(map, reactor, floorOf(round)).get(tileKey(exit.x, exit.y));
    // Round the Labor means by the Serverraum, and the other way round.
    expect(way('LABOR')).toBeGreaterThanOrEqual(30);
    expect(way('SERVERRAUM')).toBe(way('LABOR'));
  });

  it('furnishes every room with eight pieces at least, each of the room’s own kind', () => {
    const map = blackout.map;
    const rooms = roomsOf(map);
    for (const label of map.labels.filter((l) => l.kind !== 'corridor')) {
      const pieces = map.decor.filter((d) => rooms.get(tileKey(d.x, d.y)) === label.text);
      expect(pieces.length, `${label.text} has ${pieces.length} pieces`).toBeGreaterThanOrEqual(8);
      const own = FURNITURE_OF[label.kind ?? ''] ?? [];
      expect(pieces.filter((piece) => !own.includes(piece.kind)), label.text).toEqual([]);
    }
  });

  it('opens its main ways two tiles wide, a door that is a device one tile in its wall', () => {
    const map = blackout.map;
    const rooms = roomsOf(map);
    // Between two rooms without a door: as many tiles of one beside the other as the way is wide.
    const widths = new Map<string, number>();
    for (const [key, room] of rooms) {
      const [x = 0, y = 0] = key.split(',').map(Number);
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ] as const) {
        const other = rooms.get(tileKey(x + dx, y + dy));
        if (other !== undefined && other !== room) {
          const pair = [room, other].sort().join(' · ');
          widths.set(pair, (widths.get(pair) ?? 0) + 1);
        }
      }
    }
    expect(Object.fromEntries(widths)).toEqual({
      'ARCHIV · FLUR': 2,
      'OST-FLUR · SERVERRAUM': 2,
      'LABOR · SÜD-FLUR': 2,
    });
    const wall = (x: number, y: number): boolean => map.tiles[y]?.charAt(x) === '#';
    for (const door of map.doors) {
      const across = wall(door.x - 1, door.y) && wall(door.x + 1, door.y);
      const along = wall(door.x, door.y - 1) && wall(door.x, door.y + 1);
      expect(across || along, `${door.id} stands one tile wide in its wall`).toBe(true);
    }
  });

  it('keeps every walk of the pinned plan within 12 s at a walk, the escape both ways', () => {
    const map = blackout.map;
    const plan = blackoutPlan();
    const rooms = roomsOf(map);
    const at = (puzzleId: string, console?: 'a' | 'b'): Spot => {
      const spot = map.stations.find((s) => s.puzzleId === puzzleId && s.console === console);
      return spot ?? { x: -1, y: -1 };
    };
    const rulesOf = (puzzleId: string): Spot => {
      const source = map.manuals.find((manual) => manual.puzzleIds.includes(puzzleId));
      return (source === undefined ? undefined : plan.places[source.id]) ?? { x: -1, y: -1 };
    };
    /** Where a walk to `spot` ends: on it, or beside it where something stands there. */
    const stand = (spot: Spot): Spot =>
      [spot, ...STEPS.map(([dx, dy]) => ({ x: spot.x + dx, y: spot.y + dy }))].find((s) =>
        walkable(map, s.x, s.y),
      ) ?? spot;
    const opener = (door: (typeof map.doors)[number]): string | undefined =>
      door.opensBy.kind === 'puzzle' ? door.opensBy.puzzleId : door.opensBy.untilSolved;
    /** The doors shut once `solved` are, but those held open by a plate. */
    const shut = (solved: readonly string[], held: readonly string[] = []): Set<string> =>
      new Set(
        map.doors
          .filter((d) => !held.includes(d.id) && !solved.includes(opener(d) ?? ''))
          .map((d) => tileKey(d.x, d.y)),
      );
    const plateDoor = map.doors.find((door) => door.opensBy.kind === 'plate')?.id ?? '';
    const plateOf = map.plates.find((plate) =>
      map.doors.some((d) => d.opensBy.kind === 'plate' && d.opensBy.plateId === plate.id),
    );
    const fuse = plan.ersatzsicherung;
    const key = map.items.find((item) => map.manuals.some((m) => m.needsKey === item.id));
    const sign = map.edgeworkSign ?? { x: -1, y: -1 };
    const hatch = map.exit ?? { x: -1, y: -1 };
    const [lever, box, meter] = [at('notlicht'), at('notstrom', 'a'), at('notstrom', 'b')];
    const [signalA, signalB] = [at('signalkette', 'a'), at('signalkette', 'b')];
    const [terminal, rack] = [at('subsysteme', 'a'), at('subsysteme', 'b')];
    const [radio, reactor] = [at('frequenz'), at('reaktorstart')];
    const solved = blackout.puzzles.map((p) => p.id);
    const before = (n: number): Set<string> => shut(solved.slice(0, n));
    const legs: [string, Spot, Spot, Set<string>][] = [
      ['host to the lever', plan.spawns.host, lever, before(0)],
      ['guest to the lever', plan.spawns.guest, lever, before(0)],
      ['the lever to the book', lever, rulesOf('notstrom'), before(1)],
      ['the book to the sign', rulesOf('notstrom'), sign, before(1)],
      ['the sign to the plate', sign, plateOf ?? sign, before(1)],
      ['the lever to the fuse box, the plate held', lever, box, shut([], [plateDoor])],
      ['the plate to the meter', plateOf ?? sign, meter, before(1)],
      ['the meter to the clipboard', meter, rulesOf('signalkette'), before(2)],
      ['the clipboard to console A', rulesOf('signalkette'), signalA, before(2)],
      ['the fuse box to console B', box, signalB, before(2)],
      ['console B to the terminal', signalB, terminal, before(3)],
      ['console A to the locker', signalA, rulesOf('subsysteme'), before(3)],
      ['the locker to the rack', rulesOf('subsysteme'), rack, before(3)],
      ['the rack to the key', rack, key ?? rack, before(4)],
      ['the key to the cabinet', key ?? rack, rulesOf('frequenz'), before(4)],
      ['the terminal to the radio', terminal, radio, before(4)],
      ['the radio to the fuse', radio, fuse.from, before(5)],
      ['the fuse to the reactor', fuse.from, fuse.to, before(5)],
      ['the cabinet to the reactor', rulesOf('frequenz'), reactor, before(5)],
    ];
    for (const round of ['LABOR', 'SERVERRAUM']) {
      const other = new Set([...rooms].filter(([, name]) => name === round).map(([k]) => k));
      legs.push([`the escape, out of the ${round}`, reactor, hatch, other]);
    }
    for (const [what, from, to, doors] of legs) {
      const seconds = walkTiles(map, stand(from), stand(to), doors) / WALK_SPEED;
      expect(seconds, what).toBeLessThanOrEqual(12);
    }
  });

  it('hangs an emergency lamp by the lever and by every door off a corridor', () => {
    const map = blackout.map;
    const rooms = roomsOf(map);
    const kinds = new Map(map.labels.map((label) => [label.text, label.kind]));
    const lampBy = (spot: Spot): boolean =>
      map.lamps.some((lamp) => Math.max(Math.abs(lamp.x - spot.x), Math.abs(lamp.y - spot.y)) <= 1);
    const lever = map.stations.find((s) => s.puzzleId === blackout.puzzles[0]?.id);
    expect(lever !== undefined && lampBy(lever), 'no lamp by the lever').toBe(true);
    const offCorridor = map.doors.filter((door) =>
      STEPS.some(([dx, dy]) => {
        const room = rooms.get(tileKey(door.x + dx, door.y + dy));
        return room !== undefined && kinds.get(room) === 'corridor';
      }),
    );
    expect(offCorridor.length).toBeGreaterThan(0);
    for (const door of offCorridor) {
      expect(lampBy(door), `no lamp by "${door.id}"`).toBe(true);
    }
  });

  it('works the Serverraum at a terminal and a rack in its room, its rules in the locker', () => {
    const def = blackout.puzzles.find((p) => p.id === 'subsysteme');
    expect(def).toMatchObject({ type: 'servers', title: 'Serverraum', crashed: 4, trap: true });
    expect(def?.lights).toEqual(['LABOR']);
    expect(def?.hints.length).toBeGreaterThan(0);
    const consoles = blackout.map.stations.filter((s) => s.puzzleId === 'subsysteme');
    expect(consoles).toEqual([
      { puzzleId: 'subsysteme', x: 11, y: 4, console: 'a' },
      { puzzleId: 'subsysteme', x: 21, y: 4, console: 'b' },
    ]);
    const rooms = roomsOf(blackout.map);
    for (const spot of consoles) {
      expect(rooms.get(tileKey(spot.x, spot.y)), `console ${spot.console}`).toBe('SERVERRAUM');
    }
    const locker = blackout.map.manuals.find((m) => m.puzzleIds.includes('subsysteme'));
    expect(locker?.kind).toBe('locker');
    for (const spot of locker?.spots ?? []) {
      expect(rooms.get(tileKey(spot.x, spot.y)), `locker at ${tileKey(spot.x, spot.y)}`).toBe(
        'SERVERRAUM',
      );
    }
  });

  it('pins the lab’s story to free notes by the lever, in the Serverraum and by the hatch', () => {
    const map = blackout.map;
    const rooms = roomsOf(map);
    const lever = map.stations.find((s) => s.puzzleId === blackout.puzzles[0]?.id);
    const exit = map.exit;
    const spots = map.notes.map((note) => noteSpot(map, note));
    if (lever === undefined || exit === undefined || spots.some((spot) => spot === null)) {
      throw new Error('Blackout needs its lever, its hatch and notes somebody can read');
    }
    const [byLever, inServers, byHatch] = spots;
    const near = (a: Spot | null | undefined, b: Spot): number =>
      a == null ? Infinity : Math.hypot(a.x - b.x, a.y - b.y);
    expect(map.notes).toHaveLength(3);
    expect(near(byLever, lever)).toBeLessThanOrEqual(2);
    expect(rooms.get(tileKey(inServers?.x ?? -1, inServers?.y ?? -1))).toBe('SERVERRAUM');
    expect(near(byHatch, exit)).toBeLessThanOrEqual(2);
    // Every crew can walk up to every note once the lab is open.
    const solved = new Set(blackout.puzzles.map((p) => p.id));
    for (const crew of crews(blackout)) {
      const reach = reachability(map, crew, solved);
      for (const spot of spots) {
        expect(
          spot !== null && reach.some((tiles) => canStandAt(tiles, spot)),
          `nobody of the crew at ${crew.map((s) => tileKey(s.x, s.y)).join(' · ')} reads a note`,
        ).toBe(true);
      }
    }
  });

  it('keeps its hints to the stations: no note of the lab’s story among them', () => {
    const story = blackout.map.notes.map((note) => note.text);
    for (const puzzle of blackout.puzzles) {
      expect(puzzle.hints.length, puzzle.id).toBeLessThanOrEqual(3);
      for (const hint of puzzle.hints) {
        expect(story, `${puzzle.id}: „${hint}"`).not.toContain(hint);
      }
    }
    expect(blackout.map.notes.map((note) => note.text)).toEqual([
      expect.stringMatching(/23:47/),
      expect.stringMatching(/Admin$/),
      expect.stringMatching(/durchs Labor oder am Serverraum vorbei/),
    ]);
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

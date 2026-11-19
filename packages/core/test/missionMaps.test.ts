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
import {
  everyDraw,
  namesStation,
  poolsOf,
  restsIn,
  stationsIn,
  type Draw,
} from '../src/rotation.js';
import { blackoutPlans, type BlackoutPlan } from './blackoutPlan.js';

/**
 * Guardrail for every shipped mission, beyond what the mission validation
 * already walks (stations in order, every spot of every manual object, the
 * sign): every crew the mission takes can gather at the exit — a mission in
 * free order may have none and end with its last solve —, every
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

/** Every draw a run of `mission` can have: one, the empty one, where no station takes turns. */
function draws(mission: Mission): Draw[] {
  return everyDraw(mission.puzzles);
}

/** What `puzzle` solved opens: whatever names it, or the Wechselplatz it has in the run. */
const refsOf = (puzzle: { id: string; pool?: string | undefined }): string[] =>
  puzzle.pool === undefined ? [puzzle.id] : [puzzle.id, puzzle.pool];

/**
 * What is solved in a run of `draw` while the station `ref` names — a puzzle's id, or a pool's
 * for the station the run has there — is the current one: each station before it, and with a
 * drawn station its pool, as the doors name it.
 */
function solvedBefore(mission: Mission, ref: string | undefined, draw: Draw): Set<string> {
  const solved = new Set<string>();
  for (const puzzle of stationsIn(mission.puzzles, draw)) {
    if (namesStation(ref, puzzle)) {
      break;
    }
    refsOf(puzzle).forEach((id) => solved.add(id));
  }
  return solved;
}

/** Every station of the lab solved, each Wechselplatz with them: every door open for good. */
function allSolved(mission: Mission): Set<string> {
  return new Set([...mission.puzzles.map((p) => p.id), ...poolsOf(mission.puzzles).keys()]);
}

/** Whether the station of `puzzleId` is out of service in a run of `draw`. */
function resting(mission: Mission, puzzleId: string, draw: Draw): boolean {
  const puzzle = mission.puzzles.find((p) => p.id === puzzleId);
  return puzzle !== undefined && restsIn(draw, puzzle);
}

/**
 * Every crew of `mission` can gather at its exit once all is solved. Only a mission in free
 * order may have none and end with its last solve, as the Übungshalle does.
 */
function expectAllOut(mission: Mission): void {
  const exit = mission.map.exit;
  if (exit === undefined) {
    expect(mission.order).toBe('free');
    return;
  }
  const solved = allSolved(mission);
  for (const crew of crews(mission)) {
    for (const [i, tiles] of reachability(mission.map, crew, solved).entries()) {
      const from = crew[i] === undefined ? String(i) : tileKey(crew[i].x, crew[i].y);
      expect(
        tiles.has(tileKey(exit.x, exit.y)),
        `the player starting at ${from} cannot reach the exit`,
      ).toBe(true);
    }
  }
}

describe.each(missions.map((m) => [m.id, m] as const))('mission %s', (_id, mission) => {
  const map = mission.map;

  it('draws every player a distinct spawn, enough for the largest crew', () => {
    const spawns = map.spawns.map((s) => tileKey(s.x, s.y));
    expect(new Set(spawns).size).toBe(spawns.length);
    expect(spawns.length).toBeGreaterThanOrEqual(mission.players.max);
  });

  it('lets every crew gather at the exit once all is solved, or ends free at the last', () => {
    expectAllOut(mission);
  });

  it('lets someone in every crew fetch and deliver every carryable before it is needed', () => {
    for (const item of map.items) {
      if (item.deliverTo === undefined) {
        continue; // a key: the validation walks it to every spot of its cabinet
      }
      const pickup = tileKey(item.x, item.y);
      const dropOff = tileKey(item.deliverTo.x, item.deliverTo.y);
      for (const draw of draws(mission)) {
        // State of the world while the station waiting for this item is current.
        const solved = solvedBefore(mission, item.requiredFor, draw);
        for (const crew of crews(mission)) {
          const reach = reachability(map, crew, solved);
          // The same player has to be able to do both, since it is carried.
          expect(
            reach.some((tiles) => tiles.has(pickup) && tiles.has(dropOff)),
            `no single player can carry "${item.id}" all the way`,
          ).toBe(true);
        }
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
      for (const draw of draws(mission)) {
        // Nobody stands on the plate any more: each player walks on their own.
        const solved = new Set([...solvedBefore(mission, puzzleId, draw), puzzleId]);
        for (const spawn of map.spawns) {
          const [alone] = reachability(map, [spawn], solved);
          expect(
            alone?.has(tileKey(door.x, door.y)),
            `the player starting at ${tileKey(spawn.x, spawn.y)} cannot pass "${door.id}" alone`,
          ).toBe(true);
        }
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
      // In every run that has the station: one out of service waits for nobody.
      for (const draw of draws(mission).filter((d) => !resting(mission, a.puzzleId, d))) {
        const solved = solvedBefore(mission, a.puzzleId, draw);
        for (const crew of crews(mission)) {
          const from = crew.map((spawn) => tileKey(spawn.x, spawn.y)).join(' · ');
          expect(
            twoAtOnce(map, crew, solved)(a, b),
            `the crew starting at ${from} cannot man both consoles of "${a.puzzleId}" at once`,
          ).toBe(true);
        }
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

/** A walk of the plan: what it is, from where to where, with which doors shut. */
type Leg = [what: string, from: Spot, to: Spot, shut: Set<string>];

/**
 * The walks of the plan the harness plays on `plan`'s seed, each with the tiles it takes: the
 * eight ways a player steers, round furniture and the doors shut at the time, from a tile at the
 * place to a tile at the next. The host starts in the Archiv and takes console A of every
 * station; the guest reads its rules and takes console B.
 */
function blackoutWalks(blackout: Mission, plan: BlackoutPlan): [string, number][] {
  const map = blackout.map;
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
  const before = shutBefore(blackout, plan);
  const plateDoors = map.doors.filter((door) => door.opensBy.kind === 'plate').map((d) => d.id);
  const fuse = plan.ersatzsicherung;
  const { plate, key, sign, hatch } = landmarks(map);
  const [lever, reactor] = [at('notlicht'), at('reaktorstart')];
  const [anlaufA, anlaufB] = [at('anlauf', 'a'), at('anlauf', 'b')];
  const [gate, analysis] = [at('paketfilter', 'a'), at('paketfilter', 'b')];
  const [terminal, rack] = [at('subsysteme', 'a'), at('subsysteme', 'b')];
  const legs: Leg[] = [
    ['host to the lever', plan.spawns.host, lever, before(0)],
    ['guest to the lever', plan.spawns.guest, lever, before(0)],
    ['the lever to the Betriebsbuch', lever, rulesOf('anlauf'), before(1)],
    ['the Betriebsbuch to the sign', rulesOf('anlauf'), sign, before(1)],
    ['the sign to the plate', sign, plate, before(1)],
    ['the lever to console A, the plate held', lever, anlaufA, before(1, plateDoors)],
    ['the plate to console B', plate, anlaufB, before(1)],
    ['console B to the policy', anlaufB, rulesOf('paketfilter'), before(2)],
    ['the policy to the Analysepult', rulesOf('paketfilter'), analysis, before(2)],
    ['console A to the Sperrpult', anlaufA, gate, before(2)],
    ['the Sperrpult to the terminal', gate, terminal, before(3)],
    ['the Analysepult to the locker', analysis, rulesOf('subsysteme'), before(3)],
    ['the locker to the rack', rulesOf('subsysteme'), rack, before(3)],
    ...wechselWalks(plan.drawn, { at, rulesOf, terminal, rack, key, before }),
    ['the fuse to the reactor', fuse.from, fuse.to, before(5)],
  ];
  for (const round of ['LABOR', 'SERVERRAUM']) {
    const other = new Set([...rooms].filter(([, name]) => name === round).map(([k]) => k));
    legs.push([`the escape, out of the ${round}`, reactor, hatch, other]);
  }
  return legs.map(([what, from, to, doors]) => [
    what,
    walkTiles(map, stand(from), stand(to), doors),
  ]);
}

/** Nowhere on any map: where a walk to a thing the map lacks is measured to, and fails. */
const NOWHERE: Spot = { x: -1, y: -1 };

/** The plate that holds a door, the cabinet's key, the sign and the hatch of `map`. */
function landmarks(map: Mission['map']): { plate: Spot; key: Spot; sign: Spot; hatch: Spot } {
  const plate = map.plates.find((p) =>
    map.doors.some((d) => d.opensBy.kind === 'plate' && d.opensBy.plateId === p.id),
  );
  const key = map.items.find((item) => map.manuals.some((m) => m.needsKey === item.id));
  return {
    plate: plate ?? NOWHERE,
    key: key ?? NOWHERE,
    sign: map.edgeworkSign ?? NOWHERE,
    hatch: map.exit ?? NOWHERE,
  };
}

/**
 * The doors of `blackout` shut with the first `n` stations of `plan`'s run solved, by tile —
 * but those `held` open by a plate.
 */
function shutBefore(
  blackout: Mission,
  plan: BlackoutPlan,
): (n: number, held?: readonly string[]) => Set<string> {
  const opener = (door: Mission['map']['doors'][number]): string =>
    (door.opensBy.kind === 'puzzle' ? door.opensBy.puzzleId : door.opensBy.untilSolved) ?? '';
  const run = stationsIn(blackout.puzzles, { [plan.pool]: plan.drawn });
  return (n, held = []) => {
    const solved = new Set(run.slice(0, n).flatMap(refsOf));
    return new Set(
      blackout.map.doors
        .filter((d) => !held.includes(d.id) && !solved.has(opener(d)))
        .map((d) => tileKey(d.x, d.y)),
    );
  };
}

/** What the walks to and from the Wechselplatz are measured between. */
interface WechselWays {
  at: (puzzleId: string, console?: 'a' | 'b') => Spot;
  rulesOf: (puzzleId: string) => Spot;
  terminal: Spot;
  rack: Spot;
  key: Spot;
  before: (n: number) => Set<string>;
}

/**
 * The walks from the Serverraum to the station `drawn` has at the Wechselplatz, and from it on
 * to the spare fuse and the reactor: the host from the terminal to its console A and on to the
 * fuse, the guest from the rack by its rules to console B — or to the cabinet, by its key —
 * and on to the reactor.
 */
function wechselWalks(drawn: string, ways: WechselWays): Leg[] {
  const { at, rulesOf, terminal, rack, key, before } = ways;
  const fuse = { x: 9, y: 7 };
  const reactor = at('reaktorstart');
  const rules = rulesOf(drawn);
  if (drawn === 'frequenz') {
    const radio = at('frequenz');
    return [
      ['the rack to the key', rack, key, before(4)],
      ['the key to the cabinet', key, rules, before(4)],
      ['the terminal to the radio', terminal, radio, before(4)],
      ['the radio to the fuse', radio, fuse, before(5)],
      ['the cabinet to the reactor', rules, reactor, before(5)],
    ];
  }
  const [a, b] = [at(drawn, 'a'), at(drawn, 'b')];
  // The Signalkette's console B stands in the Maschinenraum, nearer the terminal's side of the
  // Flur's west end; the guest takes its console A at the Flur's east end, as before.
  const [hosts, guests] = drawn === 'signalkette' ? [b, a] : [a, b];
  return [
    ['the rack to the rules', rack, rules, before(4)],
    ['the rules to the guest’s console', rules, guests, before(4)],
    ['the terminal to the host’s console', terminal, hosts, before(4)],
    ['the host’s console to the fuse', hosts, fuse, before(5)],
    ['the guest’s console to the reactor', guests, reactor, before(5)],
  ];
}

/**
 * Blackout's own design, beyond what every mission keeps: console A of the
 * Anlaufsteuerung lies behind the Maschinenraum door, its console B outside
 * where whoever holds the door's plate walks on to it. The plate holds the
 * door only until the generator runs, so from the Paketfilter on everybody
 * walks to either side without anyone on it. Its fifth place is a Wechselplatz:
 * the Signalkette, the Funkpult and the Notstromkasten take turns there, each
 * with its own consoles and rules in reach once the Labortür is open. Its rooms run in a loop, the
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

  it('puts console A of the Anlaufsteuerung behind the plate door, B outside it', () => {
    const map = blackout.map;
    const [inside, outside] = ['a', 'b'].map((side) =>
      map.stations.find((s) => s.puzzleId === 'anlauf' && s.console === side),
    );
    const door = map.doors.find(
      (d) => d.opensBy.kind === 'plate' && d.opensBy.untilSolved === 'anlauf',
    );
    const plateId = door?.opensBy.kind === 'plate' ? door.opensBy.plateId : undefined;
    const plate = map.plates.find((p) => p.id === plateId);
    if (inside === undefined || outside === undefined || plate === undefined) {
      throw new Error('Blackout needs the Anlaufsteuerung at two consoles and a plate door for it');
    }
    // Nobody else around: the plate holder on their own, with nothing solved yet.
    const [alone = new Set<string>()] = reachability(map, [plate], new Set());
    expect(canStandAt(alone, outside), 'the plate holder cannot walk on to console B').toBe(true);
    expect(canStandAt(alone, inside), 'console A lies open without the plate').toBe(false);
    // The duct joins them under the Maschinenraum's wall: from the Flur's console down to A's.
    const rooms = roomsOf(map);
    const duct = map.conduits.find((conduit) => conduit.puzzleId === 'anlauf');
    const roomAt = ([x, y]: readonly [number, number]): string | undefined =>
      rooms.get(tileKey(x, y));
    expect(duct?.tiles.map(roomAt)).toEqual([
      'FLUR',
      'FLUR',
      'FLUR',
      undefined,
      'MASCHINENRAUM',
      'MASCHINENRAUM',
    ]);
    expect(rooms.get(tileKey(inside.x, inside.y))).toBe('MASCHINENRAUM');
    expect(rooms.get(tileKey(outside.x, outside.y))).toBe('FLUR');
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

  it('lets nobody to the Anlaufsteuerung’s console A without the plate, from any spawn', () => {
    // Every crew still mans both consoles at once (the check above for every mission): one of
    // it holds the plate for the other, then walks on to console B.
    const inside = blackout.map.stations.find((s) => s.puzzleId === 'anlauf' && s.console === 'a');
    if (inside === undefined) {
      throw new Error('Blackout has no console A for the Anlaufsteuerung');
    }
    const [draw = {}] = draws(blackout);
    const solved = solvedBefore(blackout, 'anlauf', draw);
    for (const spawn of blackout.map.spawns) {
      const [alone = new Set<string>()] = reachability(blackout.map, [spawn], solved);
      expect(
        canStandAt(alone, inside),
        `the player starting at ${tileKey(spawn.x, spawn.y)} reaches console A alone`,
      ).toBe(false);
    }
  });

  it('keeps the Betriebsbuch a short walk from console B: there and back within 10 s', () => {
    // Whoever works console A is shut in the Maschinenraum until the generator runs; the lamp
    // pictures' table lies in the Archiv, and only console B's player can walk to it — once
    // before the station, or again for a stage — while the script waits for both consoles.
    const map = blackout.map;
    const outside = map.stations.find((s) => s.puzzleId === 'anlauf' && s.console === 'b');
    const book = map.manuals.find((m) => m.puzzleIds.includes('anlauf'));
    if (outside === undefined || book === undefined) {
      throw new Error('Blackout needs console B of the Anlaufsteuerung and its book');
    }
    const shut = new Set(map.doors.map((d) => tileKey(d.x, d.y)));
    expect(book.spots.length).toBeGreaterThan(1);
    for (const spot of book.spots) {
      const there = walkTiles(map, outside, spot, shut) / WALK_SPEED;
      // 6.1 s and 5.4 s as it lies; a place at the Flur's far end would be 12 s, which the
      // lead's bound of 20 s would let through — held to half of it.
      expect(2 * there, `the book at ${tileKey(spot.x, spot.y)}`).toBeLessThanOrEqual(10);
      expect(2 * there).toBeGreaterThan(2);
    }
  });

  it('opens each door by its own place in the chain', () => {
    expect(blackout.map.doors.map((door) => [door.id, door.opensBy])).toEqual([
      ['maschinentuer', { kind: 'plate', plateId: 'flurplatte', untilSolved: 'anlauf' }],
      ['serverschott', { kind: 'puzzle', puzzleId: 'paketfilter' }],
      ['labortuer', { kind: 'puzzle', puzzleId: 'subsysteme' }],
      ['reaktortuer', { kind: 'puzzle', puzzleId: 'wechsel' }],
      ['reaktorschott', { kind: 'puzzle', puzzleId: 'wechsel' }],
    ]);
  });

  it('leaves three notes of the last shift at each station that came with the new chain', () => {
    const hints = (id: string): number =>
      blackout.puzzles.find((p) => p.id === id)?.hints.length ?? 0;
    expect(['anlauf', 'paketfilter', 'subsysteme', 'signalkette'].map(hints)).toEqual([3, 3, 3, 3]);
  });

  it('stands the Paketfilter before the Serverschott, which its solve opens', () => {
    const map = blackout.map;
    const rooms = roomsOf(map);
    const schott = map.doors.find((door) => door.id === 'serverschott');
    const policy = map.manuals.find((m) => m.puzzleIds.includes('paketfilter'));
    if (schott === undefined || policy === undefined) {
      throw new Error('Blackout needs its Serverschott and the Paketfilter’s policy');
    }
    expect(schott.opensBy).toEqual({ kind: 'puzzle', puzzleId: 'paketfilter' });
    const consoles = map.stations.filter((s) => s.puzzleId === 'paketfilter');
    expect(consoles.map((s) => s.console).sort()).toEqual(['a', 'b']);
    for (const spot of consoles) {
      expect(rooms.get(tileKey(spot.x, spot.y)), `console ${spot.console}`).toBe('FLUR');
      // On the Flur's north wall, the Schott's own, a few steps along it.
      expect(spot.y).toBe(schott.y + 1);
      expect(Math.abs(spot.x - schott.x)).toBeLessThanOrEqual(7);
    }
    expect(policy.spots.length).toBeGreaterThan(1);
    for (const spot of policy.spots) {
      const where = tileKey(spot.x, spot.y);
      expect(rooms.get(where), `policy at ${where}`).toBe('FLUR');
    }
  });

  it('gives each station of the Wechselplatz consoles and rules of its own, in reach', () => {
    const map = blackout.map;
    const pools = poolsOf(blackout.puzzles);
    expect([...pools.keys()]).toEqual(['wechsel']);
    const members = pools.get('wechsel') ?? [];
    expect(members).toEqual(['signalkette', 'frequenz', 'notstrom']);
    // The reactor's two doors wait for the place, whichever station has it.
    const waiting = map.doors.filter(
      (door) => door.opensBy.kind === 'puzzle' && door.opensBy.puzzleId === 'wechsel',
    );
    expect(waiting.map((door) => door.id)).toEqual(['reaktortuer', 'reaktorschott']);
    const spotsOf = (id: string): Spot[] => [
      ...map.stations.filter((s) => s.puzzleId === id),
      ...map.manuals.filter((m) => m.puzzleIds.includes(id)).flatMap((m) => m.spots),
    ];
    // No station shares a console's tile or a source with another of the pool.
    const tiles = members.flatMap((id) => spotsOf(id).map((s) => tileKey(s.x, s.y)));
    expect(new Set(tiles).size).toBe(tiles.length);
    for (const id of members) {
      const sources = map.manuals.filter((m) => m.puzzleIds.includes(id));
      expect(sources.map((m) => m.puzzleIds), id).toEqual([[id]]);
    }
    // Once the Labortür is open — the Serverraum solved — each player walks to every console
    // and every place a source may lie, of the station in service and of the two at rest:
    // a station out of service is passed, not hidden.
    for (const draw of draws(blackout)) {
      const solved = solvedBefore(blackout, 'wechsel', draw);
      for (const spawn of map.spawns) {
        const [alone = new Set<string>()] = reachability(map, [spawn], solved);
        for (const id of members) {
          for (const spot of spotsOf(id)) {
            expect(
              canStandAt(alone, spot),
              `${id} at ${tileKey(spot.x, spot.y)} out of reach from ${tileKey(spawn.x, spawn.y)}`,
            ).toBe(true);
          }
        }
      }
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

  it.each(blackoutPlans().runs)(
    'keeps every walk of the plan drawing $drawn within 12 s at a walk, the escape both ways',
    (plan) => {
      for (const [what, tiles] of blackoutWalks(blackout, plan)) {
        expect(tiles / WALK_SPEED, what).toBeLessThanOrEqual(12);
      }
    },
  );

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

  it('patrols the long corridor and the south way, each waking away from the crew', () => {
    const map = blackout.map;
    const rooms = roomsOf(map);
    const roomOf = (spot: Spot): string | undefined => rooms.get(tileKey(spot.x, spot.y));
    const droneOf = (id: string): (typeof map.drones)[number] | undefined =>
      map.drones.find((d) => d.id === id);
    const [flur, labor] = [droneOf('flurwache'), droneOf('laborwache')];
    if (flur === undefined || labor === undefined) {
      throw new Error('Blackout needs its Flurwache and its Laborwache');
    }
    // The Flurwache flies the Flur, along a third of its length at least, its cone reaching on
    // past both ends; the Laborwache the Süd-Flur and the Labor it opens on.
    expect(new Set(flur.waypoints.map(roomOf))).toEqual(new Set(['FLUR']));
    expect(new Set(labor.waypoints.map(roomOf))).toEqual(new Set(['SÜD-FLUR', 'LABOR']));
    const along = (xs: number[]): number => Math.max(...xs) - Math.min(...xs);
    const flurFloor = [...rooms]
      .filter(([, room]) => room === 'FLUR')
      .map(([k]) => Number(k.split(',')[0]));
    expect(along(flur.waypoints.map((w) => w.x))).toBeGreaterThanOrEqual(along(flurFloor) / 3);
    // Each sleeps on its first waypoint till the station before it is solved: out of sight of
    // that station's consoles, or more than twice its reach away.
    const shut = new Set(map.doors.map((d) => tileKey(d.x, d.y)));
    const middle = (spot: Spot): Spot => ({ x: spot.x + 0.5, y: spot.y + 0.5 });
    for (const drone of [flur, labor]) {
      const waker = blackout.puzzles[drone.activeAfterSolved - 1];
      const [sleep = { x: -1, y: -1 }] = drone.waypoints;
      for (const spot of map.stations.filter((s) => s.puzzleId === waker?.id)) {
        const far = Math.hypot(sleep.x - spot.x, sleep.y - spot.y) > 2 * drone.range;
        const hidden = !canSee(map, middle(sleep), middle(spot), shut);
        expect(far || hidden, `${drone.id} wakes by ${spot.puzzleId} ${spot.console ?? ''}`).toBe(
          true,
        );
      }
    }
    // As fast and as far-seeing as on the lab before: only the ways changed.
    expect(
      map.drones.map(({ id, speed, range, halfAngleDeg, penaltySec, activeAfterSolved }) => [
        id,
        speed,
        range,
        halfAngleDeg,
        penaltySec,
        activeAfterSolved,
      ]),
    ).toEqual([
      ['flurwache', 1.7, 4.5, 26, 15, 4],
      ['laborwache', 1.3, 4, 30, 15, 4],
    ]);
    expect(flur.frozenByPlate).toBe('kameraplatte');
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
    const [byLever, inServers, byHatch, roster, handover, fuses] = spots;
    const near = (a: Spot | null | undefined, b: Spot): number =>
      a == null ? Infinity : Math.hypot(a.x - b.x, a.y - b.y);
    const keyOf = (spot: Spot | null | undefined): string =>
      spot == null ? 'nowhere' : tileKey(spot.x, spot.y);
    const roomAt = (spot: Spot | null | undefined): string | undefined => rooms.get(keyOf(spot));
    expect(map.notes).toHaveLength(6);
    expect(near(byLever, lever)).toBeLessThanOrEqual(2);
    expect(roomAt(inServers)).toBe('SERVERRAUM');
    expect(near(byHatch, exit)).toBeLessThanOrEqual(2);
    // The Wechselplatz in the lab's own words: the duty roster in the Flur by the Paketfilter,
    // where the crew stands before it comes to the place; the hand-over beside the
    // Anlaufsteuerung in the Maschinenraum; Haller's fuses in the Labor.
    const gate = map.stations.filter((s) => s.puzzleId === 'paketfilter' && s.console === 'a');
    expect(roomAt(roster)).toBe('FLUR');
    expect(gate.map((spot) => near(roster, spot) <= 2)).toEqual([true]);
    expect(roomAt(handover)).toBe('MASCHINENRAUM');
    expect(roomAt(fuses)).toBe('LABOR');
    // No note is read from a door's tile, nor from a tile a source may lie on.
    const taken = new Set([
      ...map.doors.map((d) => tileKey(d.x, d.y)),
      ...map.manuals.flatMap((m) => m.spots.map((s) => tileKey(s.x, s.y))),
    ]);
    expect(spots.map(keyOf).filter((key) => taken.has(key))).toEqual([]);
    // Nor from a tile at a console — the lever's note alone hangs beside its station —: E there
    // would read the note, nearer than the console, instead of working it.
    const consoles = map.stations.filter((s) => s.puzzleId !== 'notlicht');
    const atConsole = (spot: Spot | null | undefined): boolean =>
      consoles.some((s) => Math.max(Math.abs(s.x - (spot?.x ?? 99)), Math.abs(s.y - (spot?.y ?? 99))) <= 1);
    expect(spots.filter(atConsole)).toEqual([]);
    // Every crew can walk up to every note once the lab is open.
    const solved = allSolved(blackout);
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
      expect.stringMatching(/^Dienstplan Wechselplatz: Signalkette, Funkpult, Notstromkasten\./),
      expect.stringMatching(/Anlaufsteuerung.*Wechselplatz/),
      expect.stringMatching(/^Aktenschrank im Labor: Schlüssel im Serverraum über dem Rack\./),
    ]);
  });

  it('lets each player reach both consoles of the Signalkette on their own', () => {
    const consoles = blackout.map.stations.filter((s) => s.puzzleId === 'signalkette');
    expect(consoles.map((s) => s.console)).toEqual(['a', 'b']);
    const solved = solvedBefore(blackout, 'signalkette', { wechsel: 'signalkette' });
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

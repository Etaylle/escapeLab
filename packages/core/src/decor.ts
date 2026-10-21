import type { MapDef } from './mission.js';
import { tileKey, type Spot } from './reach.js';

/**
 * The checks the map's furniture has to pass, besides the reach proofs that
 * already walk round it: every piece on a floor tile of its own, and never
 * where anything else of the map stands — a spawn, a station's console, a
 * plate, a door, a source's spot, an item or its drop-off, the sign, the
 * exit, a lamp, an emergency's panel — nor where a drone flies, at its
 * waypoints or on the straight lines between them. Each message names the
 * piece, its tile and what it is in the way of.
 */

type Decor = MapDef['decor'][number];

/** What stands on each tile of the map besides furniture, in words, by key. */
type Occupants = Map<string, string[]>;

function note(occupants: Occupants, spot: Spot, what: string): void {
  const key = tileKey(spot.x, spot.y);
  occupants.set(key, [...(occupants.get(key) ?? []), what]);
}

/** Everything placed on the map, by the tile it stands on. */
function occupantsOf(map: MapDef): Occupants {
  const occupants: Occupants = new Map();
  map.spawns.forEach((spawn) => note(occupants, spawn, 'a spawn'));
  for (const station of map.stations) {
    const what =
      station.console === undefined
        ? `station "${station.puzzleId}"`
        : `console ${station.console} of station "${station.puzzleId}"`;
    note(occupants, station, what);
  }
  map.plates.forEach((plate) => note(occupants, plate, `plate "${plate.id}"`));
  map.doors.forEach((door) => note(occupants, door, `door "${door.id}"`));
  for (const manual of map.manuals) {
    manual.spots.forEach((spot) => note(occupants, spot, `a spot of manual object "${manual.id}"`));
  }
  for (const item of map.items) {
    note(occupants, item, `item "${item.id}"`);
    if (item.deliverTo !== undefined) {
      note(occupants, item.deliverTo, `the drop-off of item "${item.id}"`);
    }
  }
  if (map.edgeworkSign !== undefined) {
    note(occupants, map.edgeworkSign, 'the edgework sign');
  }
  if (map.exit !== undefined) {
    note(occupants, map.exit, 'the exit');
  }
  map.lamps.forEach((lamp) => note(occupants, lamp, 'an emergency lamp'));
  for (const panel of map.sabotage?.panels ?? []) {
    note(occupants, panel, `sabotage panel "${panel.id}"`);
  }
  noteFlights(occupants, map.drones);
  return occupants;
}

/**
 * A drone's waypoints and the tiles of the straight lines it flies between
 * them, sampled as the flight-path check samples them.
 */
function noteFlights(occupants: Occupants, drones: MapDef['drones']): void {
  for (const drone of drones) {
    drone.waypoints.forEach((point, i) =>
      note(occupants, point, `waypoint ${i} of drone "${drone.id}"`),
    );
    const flown = new Set<string>();
    drone.waypoints.forEach((from, i) => {
      const to = drone.waypoints[(i + 1) % drone.waypoints.length] ?? from;
      const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) * 4);
      for (let s = 1; s < steps; s++) {
        const x = Math.floor(from.x + 0.5 + ((to.x - from.x) * s) / steps);
        const y = Math.floor(from.y + 0.5 + ((to.y - from.y) * s) / steps);
        flown.add(tileKey(x, y));
      }
    });
    for (const key of flown) {
      const [x = 0, y = 0] = key.split(',').map(Number);
      note(occupants, { x, y }, `the flight path of drone "${drone.id}"`);
    }
  }
}

/** What a piece of furniture is called in a message: its kind, quoted. */
const named = (piece: Decor): string => `decor "${piece.kind}" at ${piece.x},${piece.y}`;

/**
 * Every problem with the map's furniture, as the validator words its issues;
 * none where it stands well. `floor` says whether a tile is floor.
 */
export function decorIssues(map: MapDef, floor: (x: number, y: number) => boolean): string[] {
  const issues: string[] = [];
  const occupants = occupantsOf(map);
  const taken = new Map<string, Decor>();
  for (const piece of map.decor) {
    const key = tileKey(piece.x, piece.y);
    if (!floor(piece.x, piece.y)) {
      issues.push(`map: ${named(piece)} is not on a floor tile`);
    }
    const before = taken.get(key);
    if (before !== undefined) {
      issues.push(
        `map: two pieces of decor stand at ${piece.x},${piece.y} ` +
          `("${before.kind}" and "${piece.kind}") — one a tile`,
      );
    }
    taken.set(key, piece);
    for (const what of occupants.get(key) ?? []) {
      issues.push(`map: ${named(piece)} stands on ${what} — furniture goes on free floor`);
    }
  }
  return issues;
}

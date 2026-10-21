import type { MapView } from '@escapelab/core';
import { runsOf, type Run } from './light.js';

type Spot = { x: number; y: number };
type RoomMap = Pick<MapView, 'tiles' | 'doors'>;

const STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

const AROUND = [...STEPS, [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

const key = (x: number, y: number): string => `${x},${y}`;

/**
 * The floor of the room around `from`: every floor tile reachable from it
 * without crossing a door, open or not. Empty when `from` is no floor.
 */
export function roomFloor(map: RoomMap, from: Spot): Spot[] {
  const doors = new Set(map.doors.map((d) => key(d.x, d.y)));
  const inside = (x: number, y: number): boolean =>
    map.tiles[y]?.charAt(x) === '.' && !doors.has(key(x, y));
  if (!inside(from.x, from.y)) {
    return [];
  }
  const seen = new Set([key(from.x, from.y)]);
  const room = [{ x: from.x, y: from.y }];
  for (let i = 0; i < room.length; i++) {
    const at = room[i] ?? from;
    for (const [dx, dy] of STEPS) {
      const x = at.x + dx;
      const y = at.y + dy;
      if (inside(x, y) && !seen.has(key(x, y))) {
        seen.add(key(x, y));
        room.push({ x, y });
      }
    }
  }
  return room;
}

/**
 * Every tile a room's lights reach: its floor, the walls around it and the
 * doors in them — no floor beyond, so the room next door stays dark.
 */
export function roomArea(map: RoomMap, from: Spot): Spot[] {
  const doors = new Set(map.doors.map((d) => key(d.x, d.y)));
  const area = new Map<string, Spot>();
  for (const { x, y } of roomFloor(map, from)) {
    area.set(key(x, y), { x, y });
    for (const [dx, dy] of AROUND) {
      const at = { x: x + dx, y: y + dy };
      const wall = map.tiles[at.y]?.charAt(at.x) === '#';
      const door = doors.has(key(at.x, at.y)) && (dx === 0 || dy === 0);
      if (wall || door) {
        area.set(key(at.x, at.y), at);
      }
    }
  }
  return [...area.values()];
}

/** A room lit whole: its tiles by key, and as runs along their rows. */
export interface RoomLight {
  keys: ReadonlySet<string>;
  runs: Run[];
}

/**
 * The room the power lights round a player standing at `at` while the lab still has it (the
 * cold open): the floor reachable from their tile without crossing a door, open or not, with
 * the walls and doors round it — lit whole, as a room a solved station lit. None where the
 * tile is no room's floor, as on a door.
 */
export function powerRoom(map: RoomMap, at: Spot): RoomLight | null {
  const tiles = roomArea(map, { x: Math.floor(at.x), y: Math.floor(at.y) });
  if (tiles.length === 0) {
    return null;
  }
  const keys = new Set(tiles.map((tile) => key(tile.x, tile.y)));
  return { keys, runs: runsOf(keys) };
}

/** Tiles of lit rooms that the same rooms light, as runs along their rows. */
export interface LitGroup {
  /** the rooms whose light reaches these tiles, by name: two for a wall or door between them */
  rooms: string[];
  runs: Run[];
}

/**
 * The tiles of the lit rooms (`rooms`: the tiles each lights, by name),
 * grouped by which of them light each tile — a wall or a door two rooms
 * share is lit by both — each tile counted once however often listed.
 */
export function litGroups(rooms: ReadonlyMap<string, readonly Spot[]>): LitGroup[] {
  const lighting = new Map<string, Set<string>>();
  for (const [room, tiles] of rooms) {
    for (const tile of tiles) {
      const at = key(tile.x, tile.y);
      lighting.set(at, (lighting.get(at) ?? new Set()).add(room));
    }
  }
  const groups = new Map<string, { rooms: string[]; tiles: string[] }>();
  for (const [at, lit] of lighting) {
    const names = [...lit];
    const id = names.join('\n');
    const group = groups.get(id) ?? { rooms: names, tiles: [] };
    group.tiles.push(at);
    groups.set(id, group);
  }
  return [...groups.values()].map(({ rooms: names, tiles }) => ({
    rooms: names,
    runs: runsOf(tiles),
  }));
}

/** The lit rooms a screen takes in, by label: long lit, warming up now, or waiting. */
export interface RoomsComingOn {
  /** lit before this screen looked: up at once, no warm-up */
  long: string[];
  /** lit just now: warming up from now on */
  now: string[];
  /** lit just now while something lies over the world: they wait for it to go */
  waiting: string[];
}

/**
 * How the rooms of `litRooms` come on at a screen that has lit `known` already: one lit before
 * it looked comes on whole at once; one just lit (`news`) warms up — but not behind a panel or
 * pages (`covered`): it waits, with those `waiting` already, until nothing lies over the
 * world, so that a solved device closes first and its room lights up in plain sight.
 */
export function roomsComingOn(
  litRooms: readonly string[],
  known: ReadonlySet<string>,
  news: readonly string[],
  waiting: readonly string[],
  covered: boolean,
): RoomsComingOn {
  const fresh = litRooms.filter((room) => !known.has(room) && !waiting.includes(room));
  const long = fresh.filter((room) => !news.includes(room));
  const due = [...waiting, ...fresh.filter((room) => news.includes(room))];
  return covered ? { long, now: [], waiting: due } : { long, now: due, waiting: [] };
}

/** A room's lights come on over this long, ms: the Notlicht moment, and every station after. */
export const WARM_UP_MS = 500;

/** The two dips of strip lights striking on the way up: from, to (ms) and how far down, 0 to 1. */
const DIPS: readonly (readonly [number, number, number])[] = [
  [120, 175, 0.75],
  [280, 330, 0.55],
];

/**
 * How far a room's lights are up `ms` after they came on, 0 to 1: rising
 * through the half second with two dips — under reduced motion without.
 */
export function warmUp(ms: number, reduced = false): number {
  if (ms >= WARM_UP_MS) {
    return 1;
  }
  if (ms <= 0) {
    return 0;
  }
  const t = ms / WARM_UP_MS;
  const rise = t * (2 - t);
  const dip = reduced ? undefined : DIPS.find(([from, to]) => ms >= from && ms < to);
  return dip === undefined ? rise : rise * (1 - dip[2]);
}

/**
 * The name of the room this player starts in: the room label on the floor
 * around the spawn that no door cuts through, failing that the label nearest
 * to the spawn. Null on a map without labels.
 */
export function startRoom(
  map: Pick<MapView, 'tiles' | 'doors' | 'labels' | 'yourSpawn'>,
): string | null {
  const spawn = map.yourSpawn;
  const room = roomFloor(map, spawn);
  const inside = map.labels.find((label) =>
    room.some((tile) => tile.x === label.x && tile.y === label.y),
  );
  if (inside !== undefined) {
    return inside.text;
  }
  const away = (label: { x: number; y: number }): number =>
    Math.hypot(label.x - spawn.x, label.y - spawn.y);
  return [...map.labels].sort((a, b) => away(a) - away(b))[0]?.text ?? null;
}

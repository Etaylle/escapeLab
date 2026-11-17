import type { MapView, PuzzleView } from '@escapelab/core';
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

/** What the lights of a room add, where they come on (`roomLights`). */
export interface RoomLights {
  /** the tiles they reach that no room lit before reaches: none for a floor lit already */
  tiles: Spot[];
  /** the room lit before on whose floor a label of this name stands, the first; null for none */
  same: string | null;
  /**
   * how brightly they burn, as many times a room's own: the most any label standing on the
   * tiles they add gives (`brightness`), 1 where none gives one
   */
  brightness: number;
}

/**
 * What the lights of the room `room` add to the rooms lit already (`lit`, by name: the tiles
 * each lights): the area of every label of that name (`roomArea`) whose floor no room lit before
 * lights. A floor that several names label — the Übungshalle's one hall under its fourteen,
 * Blackout's Flur under FLUR and ARCHIV — is lit once, by the first of them to come on: each of
 * the others lights nothing more, where adding its ceiling lights again would burn the floor
 * white. `same` names that first room. A floor that burns brighter says so on its labels
 * (`brightness`): Blackout's Flur and Archiv, lit by two names from the start, burn twice.
 */
export function roomLights(
  map: Pick<MapView, 'tiles' | 'doors' | 'labels'>,
  room: string,
  lit: ReadonlyMap<string, { tiles: readonly Spot[] }>,
): RoomLights {
  const litBy = new Map<string, string>();
  for (const [name, { tiles }] of lit) {
    for (const tile of tiles) {
      const at = key(tile.x, tile.y);
      litBy.set(at, litBy.get(at) ?? name);
    }
  }
  const spots = map.labels.filter((label) => label.text === room);
  const litBefore = (spot: Spot): string | undefined => litBy.get(key(spot.x, spot.y));
  const same = spots.map(litBefore).find((name) => name !== undefined) ?? null;
  const tiles = spots
    .filter((spot) => litBefore(spot) === undefined)
    .flatMap((spot) => roomArea(map, spot));
  const added = new Set(tiles.map((tile) => key(tile.x, tile.y)));
  const brightness = Math.max(
    1,
    ...map.labels.filter((label) => added.has(key(label.x, label.y))).map((l) => l.brightness ?? 1),
  );
  return { tiles, same, brightness };
}

/** A room's lights as they come on (`roomOn`): the client keeps them with a path of their tiles. */
export interface RoomOn {
  /** the tiles they add to the rooms lit already: none for a floor lit already */
  tiles: Spot[];
  /** since when they are on (sim time): a floor's first name's, where they add no tile */
  since: number;
  /** how brightly they burn (`RoomLights`) */
  brightness: number;
}

/**
 * The lights of the room `room` coming on at `since` (sim time) over the rooms lit already
 * (`lit`, by name): what they add (`roomLights`), and since when they are on. A name that adds
 * no tile — its floor lit by another name already — is on since that name, so that what stands
 * there under it (sources.ts `powerAt`) does not warm up a second time. A name with labels on two
 * floors, one lit already, is on since now, as its other floor warms up from now: a source on
 * the floor lit before warms up again under that name. No mission names two floors so; the
 * lights of one name keep one `since`.
 */
export function roomOn(
  map: Pick<MapView, 'tiles' | 'doors' | 'labels'>,
  room: string,
  lit: ReadonlyMap<string, { tiles: readonly Spot[]; since: number }>,
  since: number,
): RoomOn {
  const { tiles, same, brightness } = roomLights(map, room, lit);
  const first = tiles.length === 0 && same !== null ? lit.get(same) : undefined;
  return { tiles, since: first?.since ?? since, brightness };
}

/**
 * Whether rooms coming on (`roomOn`) bring light onto the screen — the relay's click, which
 * says so: some tile of theirs comes on. Names whose floors were lit already bring none.
 */
export function bringsLight(rooms: readonly RoomOn[]): boolean {
  return rooms.some((room) => room.tiles.length > 0);
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
 * Whether a room just lit waits on this screen: while a station's panel lies over the world
 * (`station`), so that the solved device closes first and its room warms up in plain sight. A
 * source's pages hold nothing back — its reader sees the room come on as the station is
 * solved — and the audience, at no device, never waits.
 */
export function lightsHeld(spectator: boolean, station: PuzzleView | null): boolean {
  return !spectator && station !== null;
}

/**
 * How the rooms of `litRooms` come on at a screen that has lit `known` already: one lit before
 * it looked comes on whole at once; one just lit (`news`) warms up — but not behind a station's
 * panel (`covered`, `lightsHeld`): it waits, with those `waiting` already, until the panel is
 * gone, so that a solved device closes first and its room lights up in plain sight.
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

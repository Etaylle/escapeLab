import type { MapView } from '@escapelab/core';
import { hashTile } from './brush.js';
import {
  CORNER_NE,
  CORNER_NW,
  CORNER_SE,
  CORNER_SW,
  FLOOR_E,
  FLOOR_N,
  FLOOR_S,
  FLOOR_W,
  WORN_ACROSS,
  WORN_ALONG,
  type FloorKind,
} from './surfaces.js';

/**
 * How every room is dressed, worked out from the map alone and a seed from
 * the mission's id, so a room looks the same every run: the kind of each
 * tile (its room's, by the label's `kind`), each floor tile's variant — a
 * worn band along the room's main axis, dust in its corners, now and then a
 * stain or a mark, hazard stripes round the reactor's core — each wall
 * tile's floor round it, and the props hung on the walls' faces: pipes and
 * cable trays along a corridor, rack fronts in the server room, gauges and
 * steam vents in the machine room, warning stripes beside every door. Wall
 * props hang on wall tiles only, so walking is never touched. Pure.
 */

/** What the dressing reads of a map. */
export type DressMap = Pick<
  MapView,
  'width' | 'height' | 'tiles' | 'labels' | 'doors' | 'lamps' | 'decor'
>;

/** The props hung on a wall's face. */
export const WALL_PROP_KINDS = [
  'pipes',
  'tray',
  'stripes',
  'extinguisher',
  'poster',
  'clock',
  'whiteboard',
  'vent',
  'steam',
  'gauge',
  'screen',
  'rack',
  'shelf',
] as const;
export type WallPropKind = (typeof WALL_PROP_KINDS)[number];

/** How many looks a wall prop comes in. */
export const WALL_PROP_VARIANTS = 4;

/** A prop on the face of the wall tile (x, y), looking into the room south of it. */
export interface WallProp {
  x: number;
  y: number;
  kind: WallPropKind;
  variant: number;
  /** the room it hangs in, by its label; null where the floor below is no labelled room's */
  room: string | null;
}

export interface Dressing {
  width: number;
  height: number;
  /**
   * each tile's kind, row by row: a floor tile its room's; a wall the room
   * its face looks into, or 'plain' where it shows no face
   */
  kinds: FloorKind[];
  /** each floor tile's room by its label, row by row; null outside every labelled room */
  rooms: (string | null)[];
  /** each floor tile's variant (surfaces.ts), row by row; 0 elsewhere */
  floor: Uint8Array;
  /** each wall tile's floor neighbours as bits (surfaces.ts FLOOR_N …), row by row; 0 elsewhere */
  walls: Uint8Array;
  props: WallProp[];
}

/**
 * The seed a mission's dressing grows from: its id, hashed (FNV-1a) — a
 * custom mission's without its „custom-", so a copy saved under a shipped
 * mission's name keeps that mission's looks.
 */
export function seedOf(missionId: string): number {
  const name = missionId.replace(/^custom-/, '');
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h = Math.imul(h ^ name.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h;
}

/** A dressing's grid, and what it is worked out from. */
interface Grid {
  map: DressMap;
  seed: number;
  /** floor, door tiles included */
  floor: (x: number, y: number) => boolean;
  index: (x: number, y: number) => number;
}

function gridOf(map: DressMap, seed: number): Grid {
  return {
    map,
    seed,
    floor: (x, y) => map.tiles[y]?.charAt(x) === '.',
    index: (x, y) => y * map.width + x,
  };
}

const STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * Each floor tile's room and kind, by the labels: the floor no door cuts
 * off, shared out to the label each tile is nearest by walking — an
 * archive open to the corridor keeps its own floor — and the first label
 * of two as near. Door tiles take the kind beside them.
 */
function roomsOf(grid: Grid): { kinds: FloorKind[]; rooms: (string | null)[] } {
  const { map, index } = grid;
  const size = map.width * map.height;
  const kinds: FloorKind[] = new Array<FloorKind>(size).fill('plain');
  const rooms: (string | null)[] = new Array<string | null>(size).fill(null);
  const doors = new Set(map.doors.map((d) => index(d.x, d.y)));
  const inside = (x: number, y: number): boolean =>
    x >= 0 && x < map.width && grid.floor(x, y) && !doors.has(index(x, y));
  const claimed = new Set<number>();
  const queue: { x: number; y: number; room: string; kind: FloorKind }[] = [];
  const claim = (x: number, y: number, room: string, kind: FloorKind): void => {
    const i = index(x, y);
    if (inside(x, y) && !claimed.has(i)) {
      claimed.add(i);
      rooms[i] = room;
      kinds[i] = kind;
      queue.push({ x, y, room, kind });
    }
  };
  for (const label of map.labels) {
    claim(label.x, label.y, label.text, label.kind ?? 'plain');
  }
  // Breadth first from every label at once: a tile goes to whoever walks there first.
  for (const at of queue) {
    for (const [dx, dy] of STEPS) {
      claim(at.x + dx, at.y + dy, at.room, at.kind);
    }
  }
  for (const door of map.doors) {
    const beside = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ].find(([dx = 0, dy = 0]) => claimed.has(index(door.x + dx, door.y + dy)));
    if (beside !== undefined) {
      const [dx = 0, dy = 0] = beside;
      kinds[index(door.x, door.y)] = kinds[index(door.x + dx, door.y + dy)] ?? 'plain';
    }
  }
  return { kinds, rooms };
}

/** Each wall tile's floor neighbours, as bits. */
function wallMasks(grid: Grid): Uint8Array {
  const { map, floor, index } = grid;
  const walls = new Uint8Array(map.width * map.height);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.tiles[y]?.charAt(x) !== '#') {
        continue;
      }
      walls[index(x, y)] =
        (floor(x, y - 1) ? FLOOR_N : 0) |
        (floor(x + 1, y) ? FLOOR_E : 0) |
        (floor(x, y + 1) ? FLOOR_S : 0) |
        (floor(x - 1, y) ? FLOOR_W : 0);
    }
  }
  return walls;
}

/** The rows of a room a worn band runs along, or its columns: within 0.75 of its middle. */
interface Band {
  across: boolean;
  middle: number;
}

/** Where each room's feet wear the floor: along its main axis, through its middle. */
function bandsOf(grid: Grid, rooms: readonly (string | null)[]): Map<string, Band> {
  const box = new Map<string, [number, number, number, number]>();
  rooms.forEach((room, i) => {
    if (room === null) return;
    const x = i % grid.map.width;
    const y = Math.floor(i / grid.map.width);
    const [x0, y0, x1, y1] = box.get(room) ?? [x, y, x, y];
    box.set(room, [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)]);
  });
  const bands = new Map<string, Band>();
  for (const [room, [x0, y0, x1, y1]] of box) {
    const across = x1 - x0 >= y1 - y0;
    bands.set(room, { across, middle: across ? (y0 + y1 + 1) / 2 : (x0 + x1 + 1) / 2 });
  }
  return bands;
}

/** The tiles round the reactor's core, by index: its hazard stripes. */
function hazardTiles(grid: Grid): Set<number> {
  const near = new Set<number>();
  for (const piece of grid.map.decor.filter((d) => d.kind === 'core')) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        near.add(grid.index(piece.x + dx, piece.y + dy));
      }
    }
  }
  return near;
}

/** Dust in the corner where walls meet on two sides of the tile; null for none. */
function cornerOf(grid: Grid, x: number, y: number): number | null {
  const wall = (dx: number, dy: number): boolean => !grid.floor(x + dx, y + dy);
  if (wall(0, -1) && wall(-1, 0)) return CORNER_NW;
  if (wall(0, -1) && wall(1, 0)) return CORNER_NE;
  if (wall(0, 1) && wall(-1, 0)) return CORNER_SW;
  if (wall(0, 1) && wall(1, 0)) return CORNER_SE;
  return null;
}

/** A plain variant: mostly bare, now and then a stain or a mark. */
function baseVariant(hash: number): number {
  const roll = hash % 20;
  return roll < 10 ? 0 : roll < 15 ? 1 : roll < 18 ? 2 : 3;
}

/** Each floor tile's variant. */
function floorVariants(
  grid: Grid,
  kinds: readonly FloorKind[],
  rooms: readonly (string | null)[],
): Uint8Array {
  const { map, seed, index } = grid;
  const variants = new Uint8Array(map.width * map.height);
  const bands = bandsOf(grid, rooms);
  const hazard = hazardTiles(grid);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!grid.floor(x, y)) continue;
      const i = index(x, y);
      const kind = kinds[i] ?? 'plain';
      const hash = hashTile(seed, x, y);
      const band = bands.get(rooms[i] ?? '');
      const corner = cornerOf(grid, x, y);
      const worn =
        band !== undefined &&
        kind !== 'server' &&
        Math.abs((band.across ? y : x) + 0.5 - band.middle) < 0.75 &&
        hash % 7 !== 0;
      if (kind === 'reactor' && hazard.has(i)) {
        variants[i] = 3;
      } else if (corner !== null && hash % 4 !== 0) {
        variants[i] = corner;
      } else if (worn) {
        variants[i] = band.across ? WORN_ACROSS : WORN_ALONG;
      } else {
        variants[i] = baseVariant(hash >>> 3);
      }
    }
  }
  return variants;
}

/** What a kind of room hangs on its walls, by weight; null for a bare face. */
type PropOdds = readonly (readonly [WallPropKind | null, number])[];

const PROPS_BY_KIND: Readonly<Record<FloorKind, PropOdds>> = {
  plain: [
    [null, 70],
    ['poster', 12],
    ['vent', 10],
    ['clock', 8],
  ],
  corridor: [
    ['pipes', 34],
    ['tray', 22],
    [null, 20],
    ['poster', 8],
    ['vent', 6],
    ['extinguisher', 6],
    ['clock', 4],
  ],
  archive: [
    ['shelf', 58],
    [null, 18],
    ['poster', 10],
    ['clock', 8],
    ['extinguisher', 6],
  ],
  server: [
    ['rack', 46],
    ['vent', 20],
    ['screen', 18],
    [null, 16],
  ],
  machine: [
    ['pipes', 24],
    ['gauge', 24],
    ['steam', 22],
    ['screen', 10],
    [null, 12],
    ['extinguisher', 8],
  ],
  lab: [
    ['whiteboard', 22],
    ['screen', 20],
    ['shelf', 12],
    ['poster', 10],
    [null, 22],
    ['extinguisher', 7],
    ['clock', 7],
  ],
  reactor: [
    ['gauge', 26],
    ['screen', 22],
    ['pipes', 20],
    ['stripes', 16],
    [null, 16],
  ],
  control: [
    ['screen', 46],
    ['gauge', 16],
    [null, 26],
    ['clock', 12],
  ],
};

/** How many of a prop one room hangs at most; the rest as often as the dice say. */
const AT_MOST: Readonly<Partial<Record<WallPropKind, number>>> = {
  clock: 1,
  extinguisher: 1,
  whiteboard: 2,
};

/** What the dice pick from `pick` for `hash`, skipping props the room has enough of. */
function pickProp(
  pick: PropOdds,
  hash: number,
  enough: (kind: WallPropKind) => boolean,
): WallPropKind | null {
  const open = pick.filter(([kind]) => kind === null || !enough(kind));
  const total = open.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = hash % total;
  for (const [kind, weight] of open) {
    if (roll < weight) return kind;
    roll -= weight;
  }
  return null;
}

/** What hangs on the face of wall tile (x, y), looking into a room of `kind`. */
function propFor(
  grid: Grid,
  [x, y]: readonly [number, number],
  kind: FloorKind,
  enough: (kind: WallPropKind) => boolean,
): WallPropKind | null {
  const doorAt = (dx: number, dy: number): boolean =>
    grid.map.doors.some((d) => d.x === x + dx && d.y === y + dy);
  if (doorAt(-1, 0) || doorAt(1, 0) || doorAt(0, 1)) {
    return 'stripes';
  }
  const pillar = grid.floor(x - 1, y) && grid.floor(x + 1, y);
  if (pillar && kind === 'server') return 'rack';
  if (pillar && kind === 'archive') return 'shelf';
  return pickProp(PROPS_BY_KIND[kind], hashTile(grid.seed ^ 0x5bd1e995, x, y), enough);
}

/** The props on the walls' faces, each on a wall tile whose south neighbour is floor. */
function wallProps(
  grid: Grid,
  kinds: readonly FloorKind[],
  rooms: readonly (string | null)[],
): WallProp[] {
  const { map, index } = grid;
  const lamps = new Set(map.lamps.map((lamp) => index(lamp.x, lamp.y)));
  const hung = new Map<string, number>();
  const props: WallProp[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.tiles[y]?.charAt(x) !== '#' || !grid.floor(x, y + 1) || lamps.has(index(x, y))) {
        continue;
      }
      const below = index(x, y + 1);
      const room = rooms[below] ?? null;
      const count = (kind: WallPropKind): string => `${room ?? '·'} ${kind}`;
      const enough = (kind: WallPropKind): boolean =>
        (hung.get(count(kind)) ?? 0) >= (AT_MOST[kind] ?? Infinity);
      const kind = propFor(grid, [x, y], kinds[below] ?? 'plain', enough);
      if (kind !== null) {
        hung.set(count(kind), (hung.get(count(kind)) ?? 0) + 1);
        const variant = hashTile(grid.seed ^ 0x27d4eb2f, x, y) % WALL_PROP_VARIANTS;
        props.push({ x, y, kind, variant, room });
      }
    }
  }
  return props;
}

/**
 * The dressing of `map` grown from `seed` (seedOf the mission's id): the same
 * map and seed, the same dressing, run after run.
 */
export function dressMap(map: DressMap, seed: number): Dressing {
  const grid = gridOf(map, seed);
  const { kinds, rooms } = roomsOf(grid);
  const walls = wallMasks(grid);
  // A wall shows the kind of the room its face looks into; one without a face is plain.
  walls.forEach((mask, i) => {
    if (map.tiles[Math.floor(i / map.width)]?.charAt(i % map.width) === '#') {
      kinds[i] = (mask & FLOOR_S) !== 0 ? (kinds[i + map.width] ?? 'plain') : 'plain';
    }
  });
  return {
    width: map.width,
    height: map.height,
    kinds,
    rooms,
    floor: floorVariants(grid, kinds, rooms),
    walls,
    props: wallProps(grid, kinds, rooms),
  };
}

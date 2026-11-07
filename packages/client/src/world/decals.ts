import { hashTile, TAU } from './brush.js';
import type { FloorKind } from './surfaces.js';

/**
 * The lab's clutter, as Half-Life tells a place by what lies about in it: marks on the floor
 * that say what a room is for — coffee rings and papers where people sit, spills in the lab,
 * tyre marks and oil in the machine room, cable ties in the server room, scorch marks round
 * the fuse box and the reactor — and on the corridors' floors the markings of a working
 * building: a lane line down the middle and arrows to the exit. Placed by the seed like the
 * rest of the dressing (dress.ts), never where something is found, pressed or walked into —
 * no label, no chime, no collision: a layer of the dressing the mission and its validation
 * never see, baked with the floor (tileCache.ts). Pure.
 */

/** What lies on the floor. */
export type DecalKind =
  | 'coffee'
  | 'papers'
  | 'spill'
  | 'oil'
  | 'tyres'
  | 'ties'
  | 'scorch'
  | 'scuff'
  | 'tape'
  | 'screws'
  | 'lane'
  | 'arrow';

/** A mark on the floor: its middle in tiles, which way it turns, which of its looks. */
export interface Decal {
  x: number;
  y: number;
  kind: DecalKind;
  /** radians: along a lane, toward the exit for an arrow, any way for the rest */
  angle: number;
  variant: number;
}

/** The marks each kind of room has lying about, four or five apiece. */
export const DECALS_BY_KIND: Readonly<Record<FloorKind, readonly DecalKind[]>> = {
  plain: ['scuff', 'papers', 'coffee', 'tape'],
  corridor: ['scuff', 'tape', 'papers', 'oil'],
  archive: ['papers', 'coffee', 'scuff', 'tape', 'papers'],
  server: ['ties', 'papers', 'scuff', 'tape', 'ties'],
  machine: ['tyres', 'oil', 'scuff', 'screws', 'oil'],
  lab: ['spill', 'papers', 'coffee', 'tape', 'spill'],
  reactor: ['scorch', 'oil', 'scuff', 'screws'],
  control: ['coffee', 'papers', 'scuff', 'ties', 'coffee'],
};

/** One floor tile in so many carries a mark: lived-in, not busy. */
export const DECAL_EVERY = 9;
/** How many looks each mark comes in. */
export const DECAL_VARIANTS = 3;
/** An arrow to the exit every so many tiles of a corridor's lane. */
export const ARROW_EVERY = 6;

/** What placing the marks reads: the floor, its rooms and kinds, and what must stay clear. */
export interface DecalGround {
  width: number;
  height: number;
  seed: number;
  /** whether (x, y) is floor one walks on, door tiles included */
  floor: (x: number, y: number) => boolean;
  kinds: readonly FloorKind[];
  rooms: readonly (string | null)[];
  /** the tiles nothing may lie on, by index: furniture, doors, plates, the exit, the lamps */
  taken: ReadonlySet<number>;
  /** where the fuse boxes stand, tiles: scorch marks lie round them */
  fuseBoxes: readonly { x: number; y: number }[];
  /** the exit, tiles; null for a map without one */
  exit: { x: number; y: number } | null;
  /** each room's main axis and its middle (dress.ts bands): where a corridor's lane runs */
  bands: ReadonlyMap<string, { across: boolean; middle: number }>;
}

/** A tile's own die for `salt`: the same tile and seed, the same throw. */
function die(ground: DecalGround, x: number, y: number, salt: number): number {
  return hashTile(ground.seed + salt * 7919, x, y);
}

/** The clutter of every room: on one free floor tile in DECAL_EVERY, from its kind's marks. */
function clutterOf(ground: DecalGround): Decal[] {
  const decals: Decal[] = [];
  for (let y = 0; y < ground.height; y++) {
    for (let x = 0; x < ground.width; x++) {
      const i = y * ground.width + x;
      if (!ground.floor(x, y) || ground.taken.has(i) || die(ground, x, y, 1) % DECAL_EVERY !== 0) {
        continue;
      }
      const marks = DECALS_BY_KIND[ground.kinds[i] ?? 'plain'];
      const roll = die(ground, x, y, 2);
      const kind = marks[roll % marks.length] ?? 'scuff';
      const at = (salt: number): number => 0.25 + ((die(ground, x, y, salt) % 100) / 100) * 0.5;
      const angle = ((die(ground, x, y, 5) % 360) / 360) * TAU;
      decals.push({ x: x + at(3), y: y + at(4), kind, angle, variant: roll % DECAL_VARIANTS });
    }
  }
  return decals;
}

/** Scorch marks on the free floor round every fuse box: where its shorts have blackened it. */
function scorchOf(ground: DecalGround): Decal[] {
  const decals: Decal[] = [];
  for (const box of ground.fuseBoxes) {
    for (const [dx, dy] of [
      [0, 1],
      [1, 0],
      [-1, 0],
      [0, -1],
    ] as const) {
      const x = box.x + dx;
      const y = box.y + dy;
      if (ground.floor(x, y) && !ground.taken.has(y * ground.width + x)) {
        const angle = ((die(ground, x, y, 6) % 360) / 360) * TAU;
        const variant = die(ground, x, y, 7) % DECAL_VARIANTS;
        const [mx, my] = [x + 0.5 - dx * 0.25, y + 0.5 - dy * 0.25];
        decals.push({ x: mx, y: my, kind: 'scorch', angle, variant });
      }
    }
  }
  return decals;
}

/** How many steps every floor tile lies from the exit, by index; Infinity where none leads. */
export function stepsToExit(ground: DecalGround): number[] {
  const steps = new Array<number>(ground.width * ground.height).fill(Infinity);
  const { exit } = ground;
  if (exit === null) {
    return steps;
  }
  const queue: [number, number][] = [[exit.x, exit.y]];
  steps[exit.y * ground.width + exit.x] = 0;
  for (const [x, y] of queue) {
    const here = steps[y * ground.width + x] ?? 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      const i = ny * ground.width + nx;
      if (ground.floor(nx, ny) && (steps[i] ?? 0) === Infinity) {
        steps[i] = here + 1;
        queue.push([nx, ny]);
      }
    }
  }
  return steps;
}

/** The way from (x, y) one step nearer the exit, radians; null where none is nearer. */
function towardExit(ground: DecalGround, steps: readonly number[], x: number, y: number) {
  const here = steps[y * ground.width + x] ?? Infinity;
  const ways = [
    [1, 0, 0],
    [0, 1, Math.PI / 2],
    [-1, 0, Math.PI],
    [0, -1, -Math.PI / 2],
  ] as const;
  const stepsAt = (dx: number, dy: number): number =>
    steps[(y + dy) * ground.width + x + dx] ?? Infinity;
  const best = ways.find(([dx, dy]) => stepsAt(dx, dy) < here);
  return best === undefined ? null : best[2];
}

/**
 * The corridors' markings: a lane line down the middle of each corridor's main axis, a dash a
 * tile, and on it every ARROW_EVERY tiles an arrow pointing the way to the exit.
 */
function markingsOf(ground: DecalGround): Decal[] {
  const steps = stepsToExit(ground);
  const decals: Decal[] = [];
  ground.rooms.forEach((room, i) => {
    const band = room === null ? undefined : ground.bands.get(room);
    if (band === undefined || ground.kinds[i] !== 'corridor' || ground.taken.has(i)) {
      return;
    }
    const x = i % ground.width;
    const y = Math.floor(i / ground.width);
    const along = band.across ? x : y;
    const across = band.across ? y : x;
    // The row (or column) the middle line runs through: of two as near, the later one.
    if (!ground.floor(x, y) || across !== Math.floor(band.middle)) {
      return;
    }
    const lane = band.across ? 0 : Math.PI / 2;
    const toExit = along % ARROW_EVERY === 0 ? towardExit(ground, steps, x, y) : null;
    decals.push(
      toExit === null
        ? { x: x + 0.5, y: y + 0.5, kind: 'lane', angle: lane, variant: 0 }
        : { x: x + 0.5, y: y + 0.5, kind: 'arrow', angle: toExit, variant: 0 },
    );
  });
  return decals;
}

/**
 * Every mark on the floor of `ground`: the corridors' markings, the scorch round the fuse
 * boxes, and the rooms' clutter — no two on one tile, the markings and the scorch first.
 */
export function decalsOf(ground: DecalGround): Decal[] {
  const placed = [...markingsOf(ground), ...scorchOf(ground)];
  const used = new Set(placed.map((d) => Math.floor(d.y) * ground.width + Math.floor(d.x)));
  const clutter = clutterOf(ground).filter(
    (d) => !used.has(Math.floor(d.y) * ground.width + Math.floor(d.x)),
  );
  return [...placed, ...clutter];
}

import { tileKey, type Spot } from './reach.js';

/**
 * Sight on the tile map, one rule for everybody: walls block it, and so do
 * doors while they are shut; floor and open doors let it through; nothing is
 * seen off the map. The drones spot players by it, the crew finds sources by
 * it, and the clients' lamps light what it reaches.
 *
 * A sight line is a straight segment between two points, in tiles. Every wall
 * and shut door it touches stops it, even one it only touches at a corner:
 * light does not squeeze between two walls meeting corner to corner, nor
 * through a gap of no width between two pillars — the same from either end.
 */

/** The map as sight needs it: rows of floor ('.') and wall. */
export interface SightMap {
  readonly tiles: readonly string[];
}

/** What can be seen from one point within a radius. */
export interface Sight {
  /** keys of every tile a sight line reaches: the floor, and the walls and shut doors it stops at */
  tiles: Set<string>;
  /** keys of the walls and shut doors among them */
  walls: Set<string>;
  /**
   * where the sight lines stop, sweeping round the point by angle: the
   * outline of the floor in sight, cut off at the radius
   */
  outline: Spot[];
}

/** Sight lines cast evenly all round a point, besides those aimed at corners. */
const SWEEP = 180;
/** How far beside a corner, in radians, the two lines aimed past it pass. */
const GRAZE = 1e-4;
const TAU = Math.PI * 2;

type Opacity = (x: number, y: number) => boolean;

/** The two tiles beside a grid point a line passes exactly through: it only touches them. */
type Beside = readonly [Spot, Spot];

/** Gets each tile a line passes into, the fraction of the way there, and what it brushed. */
type Enter = (x: number, y: number, t: number, beside: Beside | null) => boolean;

/** The rule: a wall, off the map, or a door shut right now. */
function blocksSight(map: SightMap, shut: ReadonlySet<string>, x: number, y: number): boolean {
  return map.tiles[y]?.charAt(x) !== '.' || shut.has(tileKey(x, y));
}

/** Whether a line through a grid point touches a tile there that blocks: then it stops. */
function grazes(opaque: Opacity, beside: Beside | null): boolean {
  return beside !== null && (opaque(beside[0].x, beside[0].y) || opaque(beside[1].x, beside[1].y));
}

/** Along one axis: how far from where the line starts the next grid line ahead lies. */
function gapAhead(from: number, cell: number, step: number): number {
  return step > 0 ? cell + 1 - from : from - cell;
}

/**
 * Which grid line a line crosses next before it ends, from the gaps to the
 * next vertical and horizontal ones and how far it runs along each axis: the
 * vertical one (-1), the horizontal one (1), both at once through a grid
 * point (0), or none (null). Compared as products, so a crossing through a
 * grid point is recognised exactly wherever the inputs are exact.
 */
function nextLine(gapX: number, gapY: number, runX: number, runY: number): -1 | 0 | 1 | null {
  const crossX = gapX < runX;
  const crossY = gapY < runY;
  if (crossX && crossY) {
    return Math.sign(gapX * runY - gapY * runX) as -1 | 0 | 1;
  }
  return crossX ? -1 : crossY ? 1 : null;
}

/**
 * Walks the tiles the line from `a` to `b` crosses, in order (Amanatides and
 * Woo), handing `enter` each tile it passes into after the one it starts in,
 * until `enter` returns false or the line ends. Through a grid point it steps
 * straight into the diagonal tile and names the two tiles beside the point.
 */
function walk(a: Spot, b: Spot, enter: Enter): void {
  const stepX = Math.sign(b.x - a.x);
  const stepY = Math.sign(b.y - a.y);
  const runX = Math.abs(b.x - a.x);
  const runY = Math.abs(b.y - a.y);
  if (!Number.isFinite(runX + runY + a.x + a.y)) {
    throw new Error(`sight: a line needs finite ends, not ${a.x},${a.y} to ${b.x},${b.y}`);
  }
  let x = Math.floor(a.x);
  let y = Math.floor(a.y);
  let line = nextLine(gapAhead(a.x, x, stepX), gapAhead(a.y, y, stepY), runX, runY);
  while (line !== null) {
    const t = line > 0 ? gapAhead(a.y, y, stepY) / runY : gapAhead(a.x, x, stepX) / runX;
    const beside: Beside | null = line === 0 ? [{ x: x + stepX, y }, { x, y: y + stepY }] : null;
    x += line <= 0 ? stepX : 0;
    y += line >= 0 ? stepY : 0;
    if (!enter(x, y, t, beside)) {
      return;
    }
    line = nextLine(gapAhead(a.x, x, stepX), gapAhead(a.y, y, stepY), runX, runY);
  }
}

/**
 * Whether `a` and `b` (points in tiles) see each other: the line between them
 * touches no wall and no shut door, not even at a corner. The tiles it starts
 * and ends in never block it — a door may have shut on whoever stands in it.
 * Symmetric.
 */
export function canSee(map: SightMap, a: Spot, b: Spot, shut: ReadonlySet<string>): boolean {
  const opaque: Opacity = (x, y) => blocksSight(map, shut, x, y);
  let clear = true;
  // The tile entered last blocks only once the line goes on past it.
  let passing: Spot | null = null;
  walk(a, b, (x, y, _t, beside) => {
    clear = !grazes(opaque, beside) && (passing === null || !opaque(passing.x, passing.y));
    passing = { x, y };
    return clear;
  });
  return clear;
}

/** The map as sight lines see it, worked out once per look: which tiles block, and where. */
interface Grid {
  width: number;
  height: number;
  opaque: Opacity;
  /** whether the tile lies on the map */
  inside: (x: number, y: number) => boolean;
}

function gridOf(map: SightMap, shut: ReadonlySet<string>): Grid {
  const height = map.tiles.length;
  const width = Math.max(0, ...map.tiles.map((row) => row.length));
  const blocked = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      blocked[y * width + x] = blocksSight(map, shut, x, y) ? 1 : 0;
    }
  }
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height;
  return {
    width,
    height,
    inside,
    opaque: (x, y) => !inside(x, y) || blocked[y * width + x] === 1,
  };
}

/** Whether, of the four tiles meeting at grid point (x, y), some block sight and some do not. */
function mixedAt(opaque: Opacity, x: number, y: number): boolean {
  const blocking = [opaque(x - 1, y - 1), opaque(x, y - 1), opaque(x - 1, y), opaque(x, y)].filter(
    Boolean,
  ).length;
  return blocking > 0 && blocking < 4;
}

/** An angle brought back into (-π, π]. */
function wrap(angle: number): number {
  if (angle > Math.PI) {
    return angle - TAU;
  }
  return angle <= -Math.PI ? angle + TAU : angle;
}

/**
 * The directions to cast sight lines in, by angle: an even sweep, so the
 * outline follows the radius where nothing stops it, and straight at and just
 * beside every grid point within the radius where a tile that blocks meets
 * one that does not. Only there can the outline change course, and the lines
 * just beside a corner trace the edge of the shadow behind it.
 */
function sightAngles(grid: Grid, from: Spot, radius: number): number[] {
  const angles = Array.from({ length: SWEEP }, (_, i) => -Math.PI + (TAU * (i + 0.5)) / SWEEP);
  // Grid points off the map have nothing but off-map tiles around them.
  const top = Math.max(0, Math.ceil(from.y - radius));
  const left = Math.max(0, Math.ceil(from.x - radius));
  for (let y = top; y <= Math.min(grid.height, from.y + radius); y++) {
    for (let x = left; x <= Math.min(grid.width, from.x + radius); x++) {
      if (Math.hypot(x - from.x, y - from.y) <= radius && mixedAt(grid.opaque, x, y)) {
        const angle = Math.atan2(y - from.y, x - from.x);
        angles.push(wrap(angle - GRAZE), angle, wrap(angle + GRAZE));
      }
    }
  }
  return angles.sort((p, q) => p - q);
}

/**
 * Follows one sight line from `from` to `to` and tells `reach` every tile it
 * gets into, up to the wall or shut door that stops it — or the blocking
 * tiles at a corner it touches. Returns the fraction of the way it got.
 */
function cast(grid: Grid, from: Spot, to: Spot, reach: (x: number, y: number) => void): number {
  let stop = 1;
  walk(from, to, (x, y, t, beside) => {
    if (beside !== null && grazes(grid.opaque, beside)) {
      for (const tile of beside.filter((side) => grid.opaque(side.x, side.y))) {
        reach(tile.x, tile.y);
      }
      stop = t;
      return false;
    }
    reach(x, y);
    const wall = grid.opaque(x, y);
    if (wall) {
      stop = t;
    }
    return !wall;
  });
  return stop;
}

const DIAGONALS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/**
 * The corner walls between two seen walls round a seen floor tile. No sight
 * line gets into one — it lies behind the point where the two meet — but it
 * is the same wall, and a room's walls are seen whole. Floor round a corner
 * stays unseen.
 */
function cornerWalls(grid: Grid, floor: readonly Spot[], walls: ReadonlySet<string>): Spot[] {
  const corners: Spot[] = [];
  for (const { x, y } of floor) {
    for (const [dx, dy] of DIAGONALS) {
      const corner = { x: x + dx, y: y + dy };
      if (
        grid.inside(corner.x, corner.y) &&
        grid.opaque(corner.x, corner.y) &&
        walls.has(tileKey(corner.x, y)) &&
        walls.has(tileKey(x, corner.y))
      ) {
        corners.push(corner);
      }
    }
  }
  return corners;
}

/**
 * Everything visible from `from` within `radius` (in tiles), as the sight
 * lines cast from there find it: the tiles they reach — floor, and the walls
 * and shut doors they stop at, off-map tiles left out — and the outline of
 * the floor in sight. A tile counts as seen as soon as some part of it is;
 * the corner joining two seen walls counts with them. The tile `from` lies
 * in is always seen and never blocks.
 */
export function sightFrom(
  map: SightMap,
  from: Spot,
  radius: number,
  shut: ReadonlySet<string>,
): Sight {
  if (!(radius >= 0 && Number.isFinite(radius))) {
    throw new Error(`sight: the radius has to be a finite number of tiles, not ${radius}`);
  }
  const grid = gridOf(map, shut);
  const tiles = new Set<string>();
  const walls = new Set<string>();
  const floor: Spot[] = [];
  const reach = (x: number, y: number): void => {
    const key = tileKey(x, y);
    if (!grid.inside(x, y) || tiles.has(key)) {
      return;
    }
    tiles.add(key);
    if (grid.opaque(x, y)) {
      walls.add(key);
    } else {
      floor.push({ x, y });
    }
  };
  reach(Math.floor(from.x), Math.floor(from.y));
  const outline = sightAngles(grid, from, radius).map((angle) => {
    const to = { x: from.x + radius * Math.cos(angle), y: from.y + radius * Math.sin(angle) };
    const t = cast(grid, from, to, reach);
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  });
  for (const corner of cornerWalls(grid, floor, walls)) {
    reach(corner.x, corner.y);
  }
  return { tiles, walls, outline };
}

/** The keys of the tiles visible from `from` within `radius`: `sightFrom`'s tiles. */
export function visibleTiles(
  map: SightMap,
  from: Spot,
  radius: number,
  shut: ReadonlySet<string>,
): Set<string> {
  return sightFrom(map, from, radius, shut).tiles;
}

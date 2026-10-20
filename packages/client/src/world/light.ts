import { sightFrom, type MapView, type Sight, type SightMap } from '@escapelab/core';

/**
 * The world's light follows sight (core's `sightFrom`): the crew's lamps and
 * the drones' eyes light only what they can see — walls and shut doors cut
 * them off — and the world shows its objects only on tiles some light has
 * fallen on. Pure: the light pass draws from what this works out.
 */

type Spot = { x: number; y: number };

/** A light in the world: where it hangs, its glow all round, and a beam one way. */
export interface Lamp {
  x: number;
  y: number;
  /** radius of the glow all round, in tiles; 0 for none */
  glow: number;
  /** a flashlight's cone or a drone's eye: where it points, how wide and how far; null for none */
  beam: { facing: number; halfAngle: number; reach: number } | null;
}

/** Tiles side by side in one row: the first of them and how many. */
export interface Run {
  x: number;
  y: number;
  length: number;
}

/** Where a lamp's light may fall, for the light pass to clip to. */
export interface LightClip {
  /** the floor in sight, as a polygon round the lamp */
  outline: Spot[];
  /** the walls and shut doors in sight, row by row: lit as whole tiles, nothing behind them */
  walls: Run[];
}

/** Takes a sight from a point, as `sightFrom` does. */
export type Look = (map: SightMap, at: Spot, reach: number, shut: ReadonlySet<string>) => Sight;

/** A lamp, and what it sees from where it hangs. */
export interface Lit {
  lamp: Lamp;
  sight: Sight;
}

/** What a run remembers of its light. */
export interface LightMemory {
  /** the run, by its `startedAt`; null before one */
  run: number | null;
  /** tiles some light has fallen on this run, by key: whatever lies there stays drawn */
  seen: Set<string>;
  /** the run's sights, remembered by where they were taken from */
  look: Look;
}

/**
 * How deep a light cuts into the darkness from its middle (offset 0) out to
 * its rim (offset 1): a radial gradient's stops as [offset, depth], depth 1
 * clearing the darkness entirely; straight lines join them.
 */
export type Stops = readonly (readonly [offset: number, depth: number])[];

/**
 * Your lamp's glow: the darkness cleared through 70 % of its radius and
 * fading out only at the rim — a lit circle the walls cut, not a haze round
 * a point.
 */
export const OWN_GLOW_STOPS: Stops = [
  [0, 1],
  [0.7, 1],
  [1, 0],
];
/** Your flashlight's cone along its reach: bright near you, fading out far ahead. */
export const OWN_BEAM_STOPS: Stops = [
  [0, 1],
  [0.45, 0.8],
  [1, 0],
];
/** The glow of a lamp somebody else of the crew carries: a little softer than yours. */
export const CREW_GLOW_STOPS: Stops = [
  [0, 0.9],
  [0.5, 0.8],
  [1, 0],
];
/** A drone's eye along its reach. */
export const DRONE_BEAM_STOPS: Stops = [
  [0, 0.9],
  [1, 0],
];

/** A lit room's light through an open door: bright in the doorway, fading out into the dark. */
export const SPILL_STOPS: Stops = [
  [0, 0.85],
  [0.5, 0.45],
  [1, 0],
];

/** An emergency lamp's glow: dim even in its middle, fading out well before its rim. */
export const EMERGENCY_STOPS: Stops = [
  [0, 0.55],
  [0.45, 0.3],
  [1, 0],
];
/** How far an emergency lamp's glow reaches, in tiles. */
export const EMERGENCY_GLOW = 1.5;
/** How far over the floor a lamp on a wall hangs its light, past the wall's face, in tiles. */
const FACE_INSET = 0.05;
/**
 * The faces of a wall a lamp may hang on, by the floor beside each, in the
 * order one is taken: south first — the face the view looks at — then
 * north, east and west; with the way the lamp shines from each.
 */
const FACES = [
  { dx: 0, dy: 1, facing: Math.PI / 2 },
  { dx: 0, dy: -1, facing: -Math.PI / 2 },
  { dx: 1, dy: 0, facing: 0 },
  { dx: -1, dy: 0, facing: Math.PI },
] as const;

/** Where an emergency lamp hangs: the point its light comes from, and which way it shines. */
export interface LampMount {
  x: number;
  y: number;
  /** on a wall, the way it shines in radians (0 east, π/2 south); null on the floor */
  facing: number | null;
}

/**
 * Where the emergency lamp on tile `lamp` hangs: one on the floor in its
 * tile's middle, one on a wall on that wall's face toward the floor beside
 * it, just over the floor — so that the wall stops its light like any
 * other, and nothing behind the wall is lit. Null for a lamp with no floor
 * beside it, which the mission's validation turns away.
 */
export function lampMount(map: Pick<MapView, 'tiles'>, lamp: Spot): LampMount | null {
  const floor = (x: number, y: number): boolean => map.tiles[y]?.charAt(x) === '.';
  if (floor(lamp.x, lamp.y)) {
    return { x: lamp.x + 0.5, y: lamp.y + 0.5, facing: null };
  }
  const face = FACES.find(({ dx, dy }) => floor(lamp.x + dx, lamp.y + dy));
  if (face === undefined) {
    return null;
  }
  return {
    x: lamp.x + 0.5 + face.dx * (0.5 + FACE_INSET),
    y: lamp.y + 0.5 + face.dy * (0.5 + FACE_INSET),
    facing: face.facing,
  };
}

/** An emergency lamp's light: a dim glow all round where it hangs, and no beam. */
export function emergencyLamp(mount: LampMount): Lamp {
  return { x: mount.x, y: mount.y, glow: EMERGENCY_GLOW, beam: null };
}

/** How far a player sees while the lab has its power, in tiles. */
export const POWER_REACH = 9;

/**
 * The light round a player while the lab has its power: the room's own, all
 * round as far as POWER_REACH, and no beam — walls and shut doors stop it
 * like any light, so nothing behind them shows.
 */
export function powerLamp(at: Spot): Lamp {
  return { x: at.x, y: at.y, glow: POWER_REACH, beam: null };
}

/** The glow an object gives off on its own, `strength` deep in its middle. */
export function objectGlowStops(strength: number): Stops {
  return [
    [0, strength],
    [0.55, strength * 0.55],
    [1, 0],
  ];
}

/** Half a tile's diagonal: a light reaching this far past a tile's middle still touches the tile. */
const HALF_DIAGONAL = Math.SQRT1_2;

const spotOf = (key: string): Spot => {
  const [x = Number.NaN, y = Number.NaN] = key.split(',').map(Number);
  return { x, y };
};

/** The doors shut right now, by tile key: light stops at them as at walls. */
export function doorsShut(map: Pick<MapView, 'doors'>): Set<string> {
  return new Set(map.doors.filter((door) => !door.open).map((door) => `${door.x},${door.y}`));
}

/** How far a lamp's light reaches at most, glow or beam. */
export function reachOf(lamp: Lamp): number {
  return Math.max(lamp.glow, lamp.beam?.reach ?? 0);
}

/** Tiles merged into runs along their rows, top to bottom and left to right. */
function runsOf(keys: Iterable<string>): Run[] {
  const tiles = [...keys].map(spotOf).sort((a, b) => a.y - b.y || a.x - b.x);
  const runs: Run[] = [];
  for (const tile of tiles) {
    const last = runs.at(-1);
    if (last !== undefined && last.y === tile.y && last.x + last.length === tile.x) {
      last.length += 1;
    } else {
      runs.push({ x: tile.x, y: tile.y, length: 1 });
    }
  }
  return runs;
}

/**
 * Where the light of a lamp with this sight may fall: the floor it sees, up
 * to the faces of the walls, and the walls and shut doors it sees as whole
 * tiles — a lit room shows its walls whole and nothing behind them.
 */
export function lightClip(sight: Sight): LightClip {
  return { outline: sight.outline, walls: runsOf(sight.walls) };
}

/** Whether a lamp's glow or beam touches the tile at `tile`. */
function touches(lamp: Lamp, tile: Spot): boolean {
  const dx = tile.x + 0.5 - lamp.x;
  const dy = tile.y + 0.5 - lamp.y;
  const away = Math.hypot(dx, dy);
  if (away <= lamp.glow + HALF_DIAGONAL) {
    return true;
  }
  const { beam } = lamp;
  if (beam === null || away > beam.reach + HALF_DIAGONAL) {
    return false;
  }
  const turn = Math.atan2(dy, dx) - beam.facing;
  const off = Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn)));
  return off <= beam.halfAngle + Math.atan2(HALF_DIAGONAL, away);
}

/** The tiles a lamp lights, by key: in its sight, and touched by its glow or its beam. */
export function litTiles(lamp: Lamp, sight: Sight): string[] {
  return [...sight.tiles].filter((key) => touches(lamp, spotOf(key)));
}

/** A run's light before any has fallen: nothing seen, no sight taken yet. */
export function lightMemory(run: number | null): LightMemory {
  return { run, seen: new Set(), look: sightCache() };
}

/**
 * `sightFrom`, remembering the last sights taken, by where from to a
 * thousandth of a tile: a lamp standing still costs nothing. Good for one
 * map; take a fresh one for another.
 */
export function sightCache(limit = 64): Look {
  const known = new Map<string, Sight>();
  return (map, at, reach, shut) => {
    const from = { x: Math.round(at.x * 1000) / 1000, y: Math.round(at.y * 1000) / 1000 };
    const key = `${from.x},${from.y},${reach},${[...shut].sort().join(';')}`;
    const seen = known.get(key);
    if (seen !== undefined) {
      return seen;
    }
    if (known.size >= limit) {
      known.clear();
    }
    const sight = sightFrom(map, from, reach, shut);
    known.set(key, sight);
    return sight;
  };
}

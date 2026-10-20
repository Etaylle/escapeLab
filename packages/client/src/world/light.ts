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

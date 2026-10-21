import { decorTiles } from '@escapelab/core';
import type { CeilingLight } from '../power.js';
import { ALARM_RED, WARM } from '../power.js';
import { roomKeep, roomUp } from '../render/darkness.js';
import type { Frame, WorldMap } from '../render/frame.js';

/**
 * The map as the light layer's textures hold it, a texel a tile, row by
 * row from the top: which tiles stop light (walls, furniture, and doors
 * while shut), which faces of each wall look onto the floor, and the light
 * that is no lamp's — the lit rooms', and the lab's own while it has its
 * power — as the Canvas pass lays it (render/light.ts, render/darkness.ts).
 * Pure.
 */

type TileMap = Pick<WorldMap, 'width' | 'height' | 'tiles'>;

/** The faces of a wall, in the order a texel holds them: north, east, south, west. */
const FACES = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

/**
 * How much the 'screen' of faint warm light over a powered room lifts its
 * floor: its 5 % share of the warm colour, on floor about a quarter bright.
 */
const SCREEN_LIFT = 0.05 * 0.75;
/** The warm light screened over a powered room, as the Canvas pass fills it. */
const SCREEN_WARM = [255, 186, 128] as const;

function floorAt(map: TileMap, x: number, y: number): boolean {
  return map.tiles[y]?.charAt(x) === '.';
}

/**
 * One byte a tile: 255 where the tile stops light — anything but floor, as
 * sight has it (core's sight.ts), a piece of furniture (`map.decor`), which
 * throws a shadow though sight sees past it, or a door shut now (`shut`, by
 * tile key) — else 0.
 */
export function occupancy(
  map: Pick<WorldMap, 'width' | 'height' | 'tiles' | 'decor'>,
  shut: ReadonlySet<string>,
): Uint8Array {
  const furniture = decorTiles(map.decor);
  const data = new Uint8Array(map.width * map.height);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const key = `${x},${y}`;
      const stops = !floorAt(map, x, y) || furniture.has(key) || shut.has(key);
      data[y * map.width + x] = stops ? 255 : 0;
    }
  }
  return data;
}

/**
 * What the occupancy texture of `map` is made for, as text: its rows, the
 * tiles its furniture stands on and the doors shut (`shut`) — the texture
 * is made anew only as one of them changes.
 */
export function occupancyKey(
  map: Pick<WorldMap, 'tiles' | 'decor'>,
  shut: ReadonlySet<string>,
): string {
  const furniture = [...decorTiles(map.decor)].join(';');
  return `${map.tiles.join('\n')}|${furniture}|${[...shut].sort().join(';')}`;
}

/**
 * Four bytes a tile: for a wall, 255 for each of its faces — north, east,
 * south, west — that looks onto floor, a door's included; 0 for a face
 * against another wall and for every floor tile. The light pass tilts a
 * wall's surface towards its open faces, so that a lamp to its left lights
 * its left face.
 */
export function wallFaces(map: TileMap): Uint8Array {
  const data = new Uint8Array(map.width * map.height * 4);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (floorAt(map, x, y)) {
        continue;
      }
      FACES.forEach(([dx, dy], face) => {
        data[(y * map.width + x) * 4 + face] = floorAt(map, x + dx, y + dy) ? 255 : 0;
      });
    }
  }
  return data;
}

/**
 * The ceiling lights' pools for a light colour, a tile at a time: red,
 * green and blue of what they add over a tile, 0 to 1, row by row — as
 * power.ts's `ceilingLayer` bakes them.
 */
export type Pools = (light: CeilingLight) => Float32Array;

/** The light that is no lamp's, a texel a tile. */
export interface Ambient {
  /** one byte a tile: how much of the darkness it keeps, 255 for all of it */
  keep: Uint8Array;
  /** four bytes a tile: the lit rooms' light, laid over the darkness */
  over: Uint8Array;
  /** four bytes a tile: the lab's own light while it has its power, under the darkness */
  under: Uint8Array;
}

/** The tile index of the tile `key` ("x,y") on `map`, or -1 off it. */
function indexOf(map: TileMap, key: string): number {
  const [x = -1, y = -1] = key.split(',').map(Number);
  const inside = x >= 0 && y >= 0 && x < map.width && y < map.height;
  return inside ? y * map.width + x : -1;
}

/** The tile indices of `spots` on `map`, each once, those off it left out. */
function indicesOf(map: TileMap, spots: Iterable<string>): number[] {
  return [...new Set([...spots].map((key) => indexOf(map, key)))].filter((i) => i >= 0);
}

const keyOf = ({ x, y }: { x: number; y: number }): string => `${x},${y}`;

/** The tiles of the room the power lights round you, while the lab has it. */
function poweredTiles(frame: Frame): number[] {
  const room = frame.scene.lit ? frame.light.room : null;
  return indicesOf(frame.map, room?.light.keys ?? []);
}

/**
 * How much darkness each tile keeps: all of it, but what each lit room
 * lighting it leaves (render/darkness.ts `roomKeep`) — and none in the room
 * the power lights round you.
 */
function keepOf(frame: Frame): Float32Array {
  const { map } = frame;
  const keep = new Float32Array(map.width * map.height).fill(1);
  const left = roomKeep(frame);
  for (const [label, room] of frame.lit) {
    const share = left(label);
    for (const i of indicesOf(map, room.tiles.map(keyOf))) {
      keep[i] = (keep[i] ?? 1) * share;
    }
  }
  for (const i of indicesOf(map, frame.light.room?.light.keys ?? [])) {
    keep[i] = 0;
  }
  return keep;
}

/** Adds `share` of `rgb` (three floats a tile) over the tiles `indices` to `into`. */
function addOver(
  into: Float32Array,
  rgb: ArrayLike<number>,
  share: number,
  indices: number[],
): void {
  for (const i of indices) {
    for (let c = 0; c < 3; c++) {
      into[i * 3 + c] = (into[i * 3 + c] ?? 0) + (rgb[i * 3 + c] ?? 0) * share;
    }
  }
}

/**
 * The lit rooms' light over the darkness: each room's ceiling lights, warm
 * — turning red as the escape's siren sounds — as far as they have come on.
 */
function overOf(frame: Frame, pools: Pools): Float32Array {
  const { map } = frame;
  const over = new Float32Array(map.width * map.height * 3);
  const tints = [
    { pools: pools(WARM), share: 1 - frame.red },
    { pools: pools(ALARM_RED), share: frame.red },
  ].filter(({ share }) => share > 0);
  for (const room of frame.lit.values()) {
    const up = roomUp(frame, room.since);
    const tiles = indicesOf(map, room.tiles.map(keyOf));
    for (const tint of tints) {
      addOver(over, tint.pools, up * tint.share, tiles);
    }
  }
  return over;
}

/**
 * The lab's own light under the darkness: while it has its power, your
 * room's ceiling lights and the faint warm screen over it; at the end of
 * a run won, every room's, as far as they have come on (`ending.lit`).
 */
function underOf(frame: Frame, pools: Pools): Float32Array {
  const { map } = frame;
  const count = map.width * map.height;
  const under = new Float32Array(count * 3);
  const whole = frame.ending?.lit ?? 0;
  const tiles = whole > 0 ? Array.from({ length: count }, (_, i) => i) : poweredTiles(frame);
  const share = whole > 0 ? whole : 1;
  const warm = pools(WARM);
  const lift = SCREEN_WARM.map((c) => (c / 255) * SCREEN_LIFT);
  for (const i of tiles) {
    for (let c = 0; c < 3; c++) {
      under[i * 3 + c] = ((warm[i * 3 + c] ?? 0) + (lift[c] ?? 0)) * share;
    }
  }
  return under;
}

/** Floats 0 to 1, three a tile, as bytes, four a tile (the fourth 255). */
function rgbaBytes(rgb: Float32Array): Uint8Array {
  const tiles = rgb.length / 3;
  const data = new Uint8Array(tiles * 4);
  for (let i = 0; i < tiles; i++) {
    for (let c = 0; c < 3; c++) {
      data[i * 4 + c] = Math.round(Math.min(1, Math.max(0, rgb[i * 3 + c] ?? 0)) * 255);
    }
    data[i * 4 + 3] = 255;
  }
  return data;
}

/**
 * The light of `frame` that is no lamp's, a texel a tile: how much darkness
 * each tile keeps, the lit rooms' light over it and the powered lab's under
 * it — the ceiling lights' pools as `pools` gives them.
 */
export function ambientOf(frame: Frame, pools: Pools): Ambient {
  const keep = keepOf(frame);
  return {
    keep: Uint8Array.from(keep, (k) => Math.round(Math.min(1, Math.max(0, k)) * 255)),
    over: rgbaBytes(overOf(frame, pools)),
    under: rgbaBytes(underOf(frame, pools)),
  };
}

/**
 * The pools of a baked ceiling layer (power.ts `ceilingLayer`: a pixel a
 * tile, the light's colour at the strength of its pool), read off its
 * pixels — RGBA, row by row — as what they add over each tile.
 */
export function poolsOfPixels(pixels: ArrayLike<number>, tiles: number): Float32Array {
  const pools = new Float32Array(tiles * 3);
  for (let i = 0; i < tiles; i++) {
    const alpha = (pixels[i * 4 + 3] ?? 0) / 255;
    for (let c = 0; c < 3; c++) {
      pools[i * 3 + c] = ((pixels[i * 4 + c] ?? 0) / 255) * alpha;
    }
  }
  return pools;
}

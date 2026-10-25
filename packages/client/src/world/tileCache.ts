import type { DecorKind } from '@escapelab/core';
import { spriteFor, type Dressed, type TileSprites } from './artKit.js';
import { atlasLevel, sprite, spriteAt, type Atlas } from './atlas.js';
import { decorVariant } from './decor.js';
import { phaseOf, sameGrid, type PixelGrid } from './render/grid.js';

/**
 * The map's floor, walls and furniture baked whole on the frame's pixel grid
 * (render/grid.ts), so that a frame copies what the camera shows of it pixel
 * for pixel in one go instead of drawing a scaled sprite a tile. Each tile is
 * baked as the floor and walls were always drawn — its sprite from the atlas
 * (atlas.ts) scaled to the grid, in the light the tile stands in, the colours
 * of the lab with its power on or the dark's — floors first, the walls over
 * them, a wall's face in the light of the floor below it and its shadow on
 * that floor, then the furniture light has fallen on. A tile whose light has
 * changed, or furniture coming into sight or going out of it, is baked again
 * with what overlaps it, inside a box of whole pixels, so that it comes out as
 * a whole bake would; another map bakes it all anew. Only the tiles in view
 * are looked at: one out of view is brought up to date as it comes into view.
 * On another grid only the tiles in view are baked anew while the grid still
 * moves — the camera pulling back at the end, which a whole bake a frame would
 * cost more than — and the whole map once it holds still.
 */

/** The longest side the cache's canvas may have, px: a texture every GPU of note takes. */
export const MAX_SIDE = 8192;
/** The most pixels the cache's canvas may have: 128 MB at four bytes a pixel. */
export const MAX_AREA = 32 * 1024 * 1024;

/** A piece of furniture as the map lists it. */
interface DecorPiece {
  kind: DecorKind;
  x: number;
  y: number;
  variant?: number;
}

/** The map as the cache bakes it. */
export interface CacheMap {
  width: number;
  height: number;
  tiles: readonly string[];
  decor: readonly DecorPiece[];
}

/** The light a tile is baked in, and whether what stands on it shows. */
export interface TileLight {
  /** whether the tile (x, y) is in the colours of the lab with its power on */
  lit: (x: number, y: number) => boolean;
  /** whether the world shows what stands on the tile (x, y): light has fallen on it */
  shown: (x: number, y: number) => boolean;
}

/** The tiles a frame looks at: columns x0 to x1, rows y0 to y1. */
export interface TileRange {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** A box of whole pixels on the cache's canvas: left, top, right, bottom (exclusive). */
type PixelBox = readonly [number, number, number, number];

export interface TileCache {
  /** the grid baked on: at its scale, its pixels at its phase */
  grid: PixelGrid;
  /** the dressing baked: another map dresses anew, and is baked anew */
  dressed: Dressed;
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  /** where the canvas's top-left pixel lies, in whole pixels from the grid origin's whole pixel */
  left: number;
  top: number;
  width: number;
  height: number;
  /** by tile index, 1 where the tile is baked in the colours of the power on */
  lit: Uint8Array;
  /** by tile index, 1 where a piece of furniture is baked onto the tile */
  shown: Uint8Array;
  /** the furniture by tile index */
  decor: Map<number, DecorPiece>;
  /** whether the whole map is baked; else only the tiles in view of the frame it was baked for */
  whole: boolean;
}

/** What baking reads: the atlas the sprites come from, and the light. */
interface Bake {
  cache: TileCache;
  atlas: Atlas;
  light: TileLight;
}

/**
 * The grid a map `width` × `height` tiles is baked on for a frame on `grid`:
 * that one, or — where its canvas would pass MAX_SIDE or MAX_AREA, a very
 * large map on a very dense screen — fewer pixels a tile, drawn scaled.
 */
export function cacheGrid(width: number, height: number, grid: PixelGrid): PixelGrid {
  const most = Math.min(MAX_SIDE / Math.max(width, height), Math.sqrt(MAX_AREA / (width * height)));
  return grid.scale <= most ? grid : { scale: Math.floor(most), ox: 0, oy: 0 };
}

/**
 * The cache of `map` dressed as `dressed` for a frame on `grid`, up to date
 * over the tiles of `range`: kept in `kit`; on another grid, or for another
 * dressing, the tiles of `range` baked anew while the grid still moves
 * (`steady` false), the whole map once it holds still.
 */
export function cachedTiles(
  kit: { atlas: Atlas; tiles: TileCache | null },
  dressed: Dressed,
  map: CacheMap,
  frame: { grid: PixelGrid; steady: boolean },
  light: TileLight,
  range: TileRange,
): TileCache {
  const on = cacheGrid(map.width, map.height, frame.grid);
  const known = kit.tiles;
  const fits = known !== null && known.dressed === dressed && sameGrid(known.grid, on);
  if (fits && known.whole) {
    bringUp({ cache: known, atlas: kit.atlas, light }, map, range);
    return known;
  }
  const cache = fits ? known : newCache(kit.atlas, dressed, map, on, known?.canvas);
  const bake = { cache, atlas: kit.atlas, light };
  if (frame.steady || known === null) {
    bakeRegion(bake, map, [0, 0, cache.canvas.width, cache.canvas.height]);
    cache.whole = true;
  } else {
    bakeRegion(bake, map, rangeBox(cache, range));
    cache.whole = false;
  }
  kit.tiles = cache;
  return cache;
}

/** The box of whole pixels the tiles of `range` cover on the cache's canvas, cut to it. */
function rangeBox(cache: TileCache, range: TileRange): PixelBox {
  const [left, top] = pixelAt(cache, range.x0, range.y0);
  const [right, bottom] = pixelAt(cache, range.x1 + 1, range.y1 + 1);
  const { width, height } = cache.canvas;
  return [
    Math.max(0, Math.floor(left)),
    Math.max(0, Math.floor(top)),
    Math.min(width, Math.ceil(right)),
    Math.min(height, Math.ceil(bottom)),
  ];
}

/**
 * Copies the tiles of `range` from `cache` onto `ctx` for a frame on `grid`:
 * pixel for pixel where the cache was baked on that grid, else scaled to it.
 */
export function drawTiles(
  ctx: CanvasRenderingContext2D,
  cache: TileCache,
  grid: PixelGrid,
  range: TileRange,
): void {
  const [x0, y0] = pixelAt(cache, range.x0, range.y0);
  const [x1, y1] = pixelAt(cache, range.x1 + 1, range.y1 + 1);
  const sx = Math.max(0, Math.floor(x0));
  const sy = Math.max(0, Math.floor(y0));
  const sw = Math.min(cache.canvas.width, Math.ceil(x1)) - sx;
  const sh = Math.min(cache.canvas.height, Math.ceil(y1)) - sy;
  if (sw <= 0 || sh <= 0) {
    return;
  }
  ctx.save();
  if (sameGrid(cache.grid, grid)) {
    ctx.setTransform(1, 0, 0, 1, Math.round(grid.ox) + cache.left, Math.round(grid.oy) + cache.top);
  } else {
    // A pixel of the cache lies at (left - phase + i) / scale tiles from the origin.
    const k = grid.scale / cache.grid.scale;
    const [px, py] = phaseOf(cache.grid);
    ctx.setTransform(k, 0, 0, k, grid.ox + (cache.left - px) * k, grid.oy + (cache.top - py) * k);
  }
  ctx.drawImage(cache.canvas, sx, sy, sw, sh, sx, sy, sw, sh);
  ctx.restore();
}

/** Where tile column `x` and row `y` begin on the cache's canvas, px. */
function pixelAt(cache: TileCache, x: number, y: number): [number, number] {
  const [px, py] = phaseOf(cache.grid);
  const s = cache.grid.scale;
  return [x * s + px - cache.left, y * s + py - cache.top];
}

/** An empty cache for `map` on `grid`, on `into` where given, else on a canvas of the atlas's. */
function newCache(
  atlas: Atlas,
  dressed: Dressed,
  map: CacheMap,
  grid: PixelGrid,
  into: HTMLCanvasElement | undefined,
): TileCache {
  const [px, py] = phaseOf(grid);
  const left = Math.floor(px);
  const top = Math.floor(py);
  const w = Math.ceil(map.width * grid.scale + px) - left;
  const h = Math.ceil(map.height * grid.scale + py) - top;
  const canvas = into ?? atlas.make(w, h);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const g = canvas.getContext('2d');
  if (g === null) {
    throw new Error('tileCache: canvas.getContext("2d") returned null; cannot bake the map.');
  }
  const count = map.width * map.height;
  const decor = new Map(map.decor.map((piece) => [piece.y * map.width + piece.x, piece]));
  const blank = { lit: new Uint8Array(count), shown: new Uint8Array(count) };
  const size = { width: map.width, height: map.height };
  return { grid, dressed, canvas, g, left, top, ...size, ...blank, decor, whole: false };
}

/** The sprites tile `i` is drawn with; null for the void. */
function spritesAt(cache: TileCache, i: number): TileSprites | null {
  return cache.dressed.tiles[i] ?? null;
}

/** Whether tile `i` of `map` is a wall. */
function wallAt(map: CacheMap, cache: TileCache, i: number): boolean {
  return map.tiles[Math.floor(i / cache.width)]?.charAt(i % cache.width) === '#';
}

/**
 * Brings the tiles of `range` up to date: a tile baked in another light than
 * it stands in now — a floor with the wall above it, whose face takes its
 * light — and a piece of furniture shown or not unlike its bake are baked
 * again, in one box of whole pixels round them all.
 */
function bringUp(bake: Bake, map: CacheMap, range: TileRange): void {
  const box = boxOf(bake.cache, [...relit(bake, map, range), ...reshown(bake, range)]);
  if (box !== null) {
    bakeRegion(bake, map, box);
  }
}

/** Whether the tile (x, y) lies in `range`. */
function inRange(range: TileRange, x: number, y: number): boolean {
  return x >= range.x0 && x <= range.x1 && y >= range.y0 && y <= range.y1;
}

/** The tiles of `range` baked in another light than they stand in now; a floor, its wall above. */
function relit({ cache, light }: Bake, map: CacheMap, range: TileRange): number[] {
  const dirty: number[] = [];
  for (let y = range.y0; y <= range.y1; y++) {
    for (let x = range.x0; x <= range.x1; x++) {
      const i = y * cache.width + x;
      if (spritesAt(cache, i) === null || Number(light.lit(x, y)) === cache.lit[i]) {
        continue;
      }
      dirty.push(i);
      // A floor's light is the face light of the wall above it.
      if (y > 0 && !wallAt(map, cache, i)) {
        dirty.push(i - cache.width);
      }
    }
  }
  return dirty;
}

/** The furniture in `range` shown or not unlike its bake. */
function reshown({ cache, light }: Bake, range: TileRange): number[] {
  const dirty: number[] = [];
  for (const [i, piece] of cache.decor) {
    if (!inRange(range, piece.x, piece.y)) {
      continue;
    }
    if (Number(light.shown(piece.x, piece.y)) !== cache.shown[i]) {
      dirty.push(i);
    }
  }
  return dirty;
}

/**
 * The box of whole pixels round every pixel the sprites of tiles `dirty` may
 * touch — a wall's two tiles tall, as its shadow falls below it — and a
 * pixel more; null for none.
 */
function boxOf(cache: TileCache, dirty: readonly number[]): PixelBox | null {
  if (dirty.length === 0) {
    return null;
  }
  const xs = dirty.map((i) => i % cache.width);
  const ys = dirty.map((i) => Math.floor(i / cache.width));
  const [left, top] = pixelAt(cache, Math.min(...xs), Math.min(...ys));
  const [right, bottom] = pixelAt(cache, Math.max(...xs) + 1, Math.max(...ys) + 2);
  const { width, height } = cache.canvas;
  return [
    Math.max(0, Math.floor(left) - 1),
    Math.max(0, Math.floor(top) - 1),
    Math.min(width, Math.ceil(right) + 1),
    Math.min(height, Math.ceil(bottom) + 1),
  ];
}

/** Whether the pixels of tile `i` all lie in `box`: a tile baked whole, whose record holds. */
function within(cache: TileCache, i: number, [left, top, right, bottom]: PixelBox): boolean {
  const x = i % cache.width;
  const y = Math.floor(i / cache.width);
  const [x0, y0] = pixelAt(cache, x, y);
  const [x1, y1] = pixelAt(cache, x + 1, y + 1);
  return x0 >= left && y0 >= top && x1 <= right && y1 <= bottom;
}

/**
 * Bakes the pixels of `box` anew: cleared, then every floor, every wall and
 * every piece of furniture in sight whose sprite reaches into it, in that
 * order, clipped to it — as a whole bake draws them there.
 */
function bakeRegion(bake: Bake, map: CacheMap, box: PixelBox): void {
  const { cache } = bake;
  const [left, top, right, bottom] = box;
  const [px, py] = phaseOf(cache.grid);
  const s = cache.grid.scale;
  const [ox, oy] = [px - cache.left, py - cache.top];
  // Tiles whose sprites reach the box: a wall's shadow reaches a tile below it.
  const x0 = Math.max(0, Math.floor((left - ox) / s) - 1);
  const x1 = Math.min(cache.width - 1, Math.ceil((right - ox) / s));
  const y0 = Math.max(0, Math.floor((top - oy) / s) - 2);
  const y1 = Math.min(cache.height - 1, Math.ceil((bottom - oy) / s));
  const tiles: number[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (spritesAt(cache, y * cache.width + x) !== null) {
        tiles.push(y * cache.width + x);
      }
    }
  }
  const { g } = cache;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.beginPath();
  g.rect(left, top, right - left, bottom - top);
  g.clip();
  g.clearRect(left, top, right - left, bottom - top);
  g.setTransform(s, 0, 0, s, ox, oy);
  const level = atlasLevel(s);
  const whole = (i: number): boolean => within(cache, i, box);
  tiles.filter((i) => !wallAt(map, cache, i)).forEach((i) => drawSurface(bake, i, level, whole(i)));
  tiles.filter((i) => wallAt(map, cache, i)).forEach((i) => drawSurface(bake, i, level, whole(i)));
  tiles.filter((i) => cache.decor.has(i)).forEach((i) => drawDecor(bake, i, level, whole(i)));
  g.restore();
}

/**
 * Bakes tile `i`'s floor or wall sprite, in the light it stands in, in tile
 * space; `record`: the tile is baked whole, and its light is noted.
 */
function drawSurface(bake: Bake, i: number, level: number, record: boolean): void {
  const { cache, atlas, light } = bake;
  const sprites = spritesAt(cache, i);
  if (sprites === null) {
    return;
  }
  const x = i % cache.width;
  const y = Math.floor(i / cache.width);
  const lit = light.lit(x, y);
  const { key, spec } = spriteFor(sprites, lit, sprites.face && light.lit(x, y + 1));
  const drawn = spriteAt(atlas, level, key, spec);
  cache.g.drawImage(drawn.canvas, x, y, 1, drawn.tall);
  if (record) {
    cache.lit[i] = Number(lit);
  }
}

/**
 * Bakes the furniture on tile `i` where light has fallen on it, in the light
 * of its tile; `record`: the tile is baked whole, and whether it shows is noted.
 */
function drawDecor(bake: Bake, i: number, level: number, record: boolean): void {
  const { cache, atlas, light } = bake;
  const piece = cache.decor.get(i);
  const shown = piece !== undefined && light.shown(piece.x, piece.y);
  if (record) {
    cache.shown[i] = Number(shown);
  }
  if (piece === undefined || !shown) {
    return;
  }
  const lit = light.lit(piece.x, piece.y);
  const spec = { decor: piece.kind, variant: decorVariant(piece), lit };
  cache.g.drawImage(sprite(atlas, level, spec).canvas, piece.x, piece.y, 1, 1);
}

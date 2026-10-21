import type { DecorKind } from '@escapelab/core';
import { drawDecor } from './decor.js';
import type { WallPropKind } from './dress.js';
import { paintSurface, spriteHeight, type FloorKind, type SurfaceSpec } from './surfaces.js';
import { drawWallProp } from './wallProps.js';

/**
 * The sprite atlas: every floor, wall and piece of furniture the map shows,
 * each kind in each variant, baked once per zoom level — and per light, the
 * ceiling lights' or the dark's — on first use, then drawn tile by tile, a
 * blit each, as the floor and walls always were; a wall prop is baked into
 * the sprite of the wall it hangs on. The zoom levels step
 * by about a half, so a frame draws a sprite at most a little smaller than
 * it was baked; the last two levels asked for are kept, so the end of a run
 * pulling back over the lab bakes each level once.
 */

/** The zoom levels sprites are baked at, device pixels a tile. */
export const ATLAS_LEVELS = [16, 24, 32, 48, 64, 96, 128, 192, 256] as const;
/** How many zoom levels the atlas keeps baked. */
const KEPT_LEVELS = 2;

/** A prop hung on a wall's face, in one of its looks. */
export interface HungProp {
  kind: WallPropKind;
  variant: number;
}

/** A wall tile, and what hangs on its face in the face's light, where anything does. */
export type WallSpec = Extract<SurfaceSpec, { wall: FloorKind }> & { prop?: HungProp };

/** A sprite the atlas bakes: a floor tile, a wall tile with its prop, a piece of furniture. */
export type SpriteSpec =
  | Extract<SurfaceSpec, { floor: FloorKind }>
  | WallSpec
  | { decor: DecorKind; variant: number; lit: boolean };

/** A baked sprite, and how many tiles tall it is drawn: a wall's shadow reaches below it. */
export interface Sprite {
  canvas: HTMLCanvasElement;
  tall: number;
}

/** Makes a canvas of `width` × `height` pixels with its 2D context: the DOM's, or a test's. */
export type CanvasMaker = (width: number, height: number) => HTMLCanvasElement;

export interface Atlas {
  /** sprites by key, at each zoom level baked, the level asked for last at the end */
  levels: Map<number, Map<string, Sprite>>;
  /** the level asked for last and its sprites: a frame asks for one level, tile after tile */
  last: { level: number; sprites: Map<string, Sprite> } | null;
  make: CanvasMaker;
}

/** A canvas from the document. */
const domCanvas: CanvasMaker = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

/** An empty atlas baking on canvases from `make`. */
export function newAtlas(make: CanvasMaker = domCanvas): Atlas {
  return { levels: new Map(), last: null, make };
}

/** The level a zoom of `scale` device pixels a tile draws from: the first not much smaller. */
export function atlasLevel(scale: number): number {
  const largest = ATLAS_LEVELS[ATLAS_LEVELS.length - 1] ?? 256;
  return ATLAS_LEVELS.find((level) => level >= scale * 0.92) ?? largest;
}

/** The key a sprite goes by in the atlas: its sort, its kind, its variant, its light. */
export function spriteKey(spec: SpriteSpec): string {
  const light = spec.lit ? 'lit' : 'dark';
  if ('floor' in spec) return `floor:${spec.floor}:${spec.variant}:${light}`;
  if ('wall' in spec) {
    const hung = spec.prop === undefined ? '' : `:${spec.prop.kind}${spec.prop.variant}`;
    return `wall:${spec.wall}:${spec.mask}:${light}:${spec.faceLit ? 'lit' : 'dark'}${hung}`;
  }
  return `decor:${spec.decor}:${spec.variant}:${light}`;
}

/** How many tiles tall a sprite is. */
function tallOf(spec: SpriteSpec): number {
  return 'decor' in spec ? 1 : spriteHeight(spec);
}

/** Bakes `spec` at `px` pixels a tile. */
function bakeSprite(make: CanvasMaker, spec: SpriteSpec, px: number): Sprite {
  const tall = tallOf(spec);
  const canvas = make(px, px * tall);
  const g = canvas.getContext('2d');
  if (g === null) {
    throw new Error('atlas: canvas.getContext("2d") returned null; cannot bake a sprite.');
  }
  if ('decor' in spec) {
    g.setTransform(px, 0, 0, px, px / 2, px / 2);
    drawDecor(g, spec.decor, spec.variant, spec.lit);
  } else {
    paintSurface(g, spec, px);
    if ('wall' in spec && spec.prop !== undefined) {
      g.setTransform(px, 0, 0, px, 0, 0);
      drawWallProp(g, spec.prop.kind, spec.prop.variant, spec.faceLit);
    }
  }
  return { canvas, tall };
}

/** The sprites baked at `level`, now the level asked for last; the oldest past KEPT_LEVELS go. */
function levelOf(atlas: Atlas, level: number): Map<string, Sprite> {
  if (atlas.last?.level === level) {
    return atlas.last.sprites;
  }
  const sprites = atlas.levels.get(level) ?? new Map<string, Sprite>();
  atlas.levels.delete(level);
  atlas.levels.set(level, sprites);
  while (atlas.levels.size > KEPT_LEVELS) {
    const oldest = atlas.levels.keys().next();
    if (oldest.done === true) break;
    atlas.levels.delete(oldest.value);
  }
  atlas.last = { level, sprites };
  return sprites;
}

/**
 * The sprite of `spec` at zoom level `level`, baked on first use; `key` is
 * its spriteKey, worked out once by the caller.
 */
export function spriteAt(atlas: Atlas, level: number, key: string, spec: SpriteSpec): Sprite {
  const sprites = levelOf(atlas, level);
  let sprite = sprites.get(key);
  if (sprite === undefined) {
    sprite = bakeSprite(atlas.make, spec, level);
    sprites.set(key, sprite);
  }
  return sprite;
}

/** The sprite of `spec` at `level`, its key worked out here. */
export function sprite(atlas: Atlas, level: number, spec: SpriteSpec): Sprite {
  return spriteAt(atlas, level, spriteKey(spec), spec);
}

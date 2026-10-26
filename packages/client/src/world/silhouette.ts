import type { CanvasMaker } from './atlas.js';
import { PHOSPHOR, rgba } from './palette.js';

/**
 * The glow a thing gives off in its own shape: its drawing's alpha — its
 * silhouette — grown a little and blurred, tinted phosphor, baked once per
 * zoom level (the atlas's levels, atlas.ts) into a canvas of its own, which
 * a frame then lays on in one blit (render/highlight.ts). The blur is the
 * canvas's shadow, and only at the bake: the silhouette is drawn a canvas's
 * width off to the left, so that only its shadow lands. No frame ever blurs
 * anything.
 */

/**
 * How a glow is cut, px at 64 px a tile, grown with the zoom: its silhouette
 * spread so far each way — a rim that reads at the faint end of a breath —
 * then blurred so wide.
 */
export interface GlowCut {
  blur: number;
  spread: number;
}

/** The halo, and its core: tighter, round the silhouette itself. */
export const HALO: GlowCut = { blur: 6, spread: 1.5 };
export const CORE: GlowCut = { blur: 2, spread: 0 };
/** The art's own pixels a tile, which the cuts are given in. */
const ART_PX = 64;
/** How many copies round a circle spread a silhouette: steps small enough for a hairline. */
const SPREAD_STEPS = 12;
/** How many zoom levels the glows keep baked, as the atlas does its sprites. */
const KEPT_LEVELS = 2;

/** What a glow is baked from: one thing as it is drawn, without its shadow, glow or label. */
export interface Shape {
  /** what it is, as the bakes go by: drawings with the same silhouette share a key */
  key: string;
  /** the box its drawing stays within round its anchor, in tiles */
  box: { x: number; y: number; w: number; h: number };
  /** draws it in tile units, its anchor at the origin */
  draw: (g: CanvasRenderingContext2D) => void;
}

/** A glow as baked: its canvas, and where that lies round its shape's anchor, in tiles. */
export interface GlowSprite {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The pixels a glow covers at its level: its corner, from the anchor, and its size. */
export interface GlowBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The glows baked so far, by zoom level, on canvases from `make`. */
export interface Glows {
  /** each level's glows by cut and shape key, the level asked for last at the end */
  levels: Map<number, Map<string, GlowSprite>>;
  /** the level asked for last and its glows: a frame asks for one level */
  last: { level: number; sprites: Map<string, GlowSprite> } | null;
  make: CanvasMaker;
}

/** No glow baked yet; they will be baked on canvases from `make`. */
export function newGlows(make: CanvasMaker): Glows {
  return { levels: new Map(), last: null, make };
}

/** `px` pixels of the art at 64 px a tile, in pixels at `level` px a tile. */
export function artAt(px: number, level: number): number {
  return (px * level) / ART_PX;
}

/**
 * How far a glow cut `cut` reaches past its silhouette at `level` px a tile,
 * in whole pixels: its spread, three sigma of its blur — half the shadow's
 * blur is its sigma — and a pixel more.
 */
export function glowReach(cut: GlowCut, level: number): number {
  return Math.ceil(artAt(cut.spread, level) + artAt(cut.blur, level) * 1.5) + 1;
}

/** What a glow of `shape` cut `cut` covers at `level` px a tile: its box, and its reach round it. */
export function glowBounds(shape: Shape, level: number, cut: GlowCut): GlowBounds {
  const margin = glowReach(cut, level);
  const { x, y, w, h } = shape.box;
  const left = Math.floor(x * level) - margin;
  const top = Math.floor(y * level) - margin;
  return {
    left,
    top,
    width: Math.ceil((x + w) * level) + margin - left,
    height: Math.ceil((y + h) * level) + margin - top,
  };
}

/** The 2D context of a canvas the glows are baked on. */
function contextOf(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = canvas.getContext('2d');
  if (g === null) {
    throw new Error('silhouette: canvas.getContext("2d") returned null; cannot bake a glow.');
  }
  return g;
}

/**
 * `shape` drawn at `level` px a tile on a canvas of its own over `bounds`:
 * its silhouette is the canvas's alpha.
 */
export function paintSilhouette(
  make: CanvasMaker,
  shape: Shape,
  level: number,
  bounds: GlowBounds,
): HTMLCanvasElement {
  const canvas = make(bounds.width, bounds.height);
  const g = contextOf(canvas);
  g.setTransform(level, 0, 0, level, -bounds.left, -bounds.top);
  shape.draw(g);
  return canvas;
}

/** `silhouette` grown `px` pixels each way: copies of it round a circle that wide, and itself. */
function spreadOut(
  make: CanvasMaker,
  silhouette: HTMLCanvasElement,
  px: number,
): HTMLCanvasElement {
  const canvas = make(silhouette.width, silhouette.height);
  const g = contextOf(canvas);
  for (let i = 0; i < SPREAD_STEPS; i++) {
    const turn = (i / SPREAD_STEPS) * Math.PI * 2;
    g.drawImage(silhouette, Math.cos(turn) * px, Math.sin(turn) * px);
  }
  g.drawImage(silhouette, 0, 0);
  return canvas;
}

/** Bakes the glow of `shape` at `level` px a tile: its silhouette spread, blurred, phosphor. */
export function bakeGlow(
  make: CanvasMaker,
  shape: Shape,
  level: number,
  cut: GlowCut,
): GlowSprite {
  const bounds = glowBounds(shape, level, cut);
  const silhouette = paintSilhouette(make, shape, level, bounds);
  const spread = artAt(cut.spread, level);
  const grown = spread > 0 ? spreadOut(make, silhouette, spread) : silhouette;
  const canvas = make(bounds.width, bounds.height);
  const g = contextOf(canvas);
  g.shadowColor = rgba(PHOSPHOR, 1);
  g.shadowBlur = artAt(cut.blur, level);
  g.shadowOffsetX = bounds.width;
  g.drawImage(grown, -bounds.width, 0);
  return {
    canvas,
    x: bounds.left / level,
    y: bounds.top / level,
    w: bounds.width / level,
    h: bounds.height / level,
  };
}

/** The glows baked at `level`, now the level asked for last; the oldest past KEPT_LEVELS go. */
function levelOf(glows: Glows, level: number): Map<string, GlowSprite> {
  if (glows.last?.level === level) {
    return glows.last.sprites;
  }
  const sprites = glows.levels.get(level) ?? new Map<string, GlowSprite>();
  glows.levels.delete(level);
  glows.levels.set(level, sprites);
  for (const oldest of glows.levels.keys()) {
    if (glows.levels.size <= KEPT_LEVELS) break;
    glows.levels.delete(oldest);
  }
  glows.last = { level, sprites };
  return sprites;
}

/** The glow of `shape` cut `cut` at zoom level `level`, baked the first time it is asked for. */
export function glowSprite(glows: Glows, level: number, shape: Shape, cut: GlowCut): GlowSprite {
  const sprites = levelOf(glows, level);
  const key = `${cut.blur}/${cut.spread}|${shape.key}`;
  let sprite = sprites.get(key);
  if (sprite === undefined) {
    sprite = bakeGlow(glows.make, shape, level, cut);
    sprites.set(key, sprite);
  }
  return sprite;
}

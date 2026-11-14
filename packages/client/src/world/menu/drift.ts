import { coverZoom } from '../assemble.js';
import { smooth } from '../ease.js';
import { SHOT_WIDE, shotPoint, shotStart } from '../intro/shot.js';
import type { WorldMap } from '../render/frame.js';
import { clampCamera, tileCss } from '../viewport.js';

/**
 * The menu's scene (world/menu/scene.ts): the lit lab of the mission picked behind the menu,
 * drifting along the opening's shot (intro/shot.ts) — from the reactor end to the spawn and
 * back — as a menu over a living scene does in Half-Life 2 or Firewatch. Pure: how far along
 * the shot the camera stands at a moment, how wide it frames the lab, the box of the lab the
 * drift ever shows, where in that box a frame's pixels start, and the crossfade from one
 * mission's lab to the next. Lengths in tiles, pixels device pixels, times in ms.
 */

type Spot = { x: number; y: number };

/** One loop of the drift, there along the shot and back, ms. */
export const DRIFT_MS = 30_000;

/** How long a mission picked anew takes to come in over the one before, ms. */
export const SCENE_FADE_MS = 600;

/**
 * How far along the shot the camera stands `ms` into the drift, 0 (the reactor end) to 1 (the
 * spawn): there in the first half of DRIFT_MS and back in the second, easing out of each end
 * and into the next, so that it rests a moment at either. Under reduced motion it stands
 * still at the reactor end, where the drift starts.
 */
export function driftAt(ms: number, reduced: boolean): number {
  if (reduced) {
    return 0;
  }
  const u = (((ms % DRIFT_MS) + DRIFT_MS) % DRIFT_MS) / DRIFT_MS;
  return smooth(u < 0.5 ? u * 2 : 2 - u * 2);
}

/** The opening's shot as the scene frames it: its two ends, held where the camera can look. */
export interface SceneShot {
  from: Spot;
  to: Spot;
  /** device pixels a tile */
  scale: number;
}

/**
 * The shot over `map` for a canvas `w` × `h` at `dpr` device pixels a CSS pixel, as the
 * opening frames it (assemble.ts `aim`): a little wider than play frames a window of that
 * height with no HUD over it, and never so wide that the lab leaves the canvas; from the
 * reactor end to the spawn, both ends held where the camera can look, so that it moves from
 * one to the other all the way.
 */
export function sceneShot(map: WorldMap, w: number, h: number, dpr: number): SceneShot {
  const near = tileCss({ height: h / dpr, bar: 0, touch: false }) * dpr;
  const scale = Math.max(coverZoom(map, w, h), near * SHOT_WIDE);
  const spawn = { x: map.yourSpawn.x + 0.5, y: map.yourSpawn.y + 0.5 };
  const lens = { scale, w, h, top: 0, lift: 0 };
  return {
    from: clampCamera(map, shotStart(map, spawn), lens),
    to: clampCamera(map, spawn, lens),
    scale,
  };
}

/** A box of whole device pixels on the lab at a shot's scale: its corner and its size. */
export interface PixelBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The box of the lab a canvas `w` × `h` ever shows along `shot`: the frame at one end, the
 * frame at the other and every one between, in whole pixels round them.
 */
export function driftBox(shot: SceneShot, w: number, h: number): PixelBox {
  const { from, to, scale } = shot;
  const left = Math.floor(Math.min(from.x, to.x) * scale - w / 2);
  const top = Math.floor(Math.min(from.y, to.y) * scale - h / 2);
  const right = Math.ceil(Math.max(from.x, to.x) * scale + w / 2);
  const bottom = Math.ceil(Math.max(from.y, to.y) * scale + h / 2);
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * How far round the lab its dark is baked where a place's frame looks past the lab's edge, tiles.
 */
export const DARK_ROUND = 1;

/**
 * The lab of `map` at `scale` px a tile and the dark DARK_ROUND round it, whole pixels: as far as
 * the scene bakes what a place's frame shows (`sceneBox`).
 */
export function labBound(map: { width: number; height: number }, scale: number): PixelBox {
  const round = Math.ceil(DARK_ROUND * scale);
  const width = Math.ceil(map.width * scale) + 2 * round;
  const height = Math.ceil(map.height * scale) + 2 * round;
  return { left: -round, top: -round, width, height };
}

/** `v` held within `lo` and `hi`. */
const within = (lo: number, v: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * The box of the lab a canvas `w` × `h` ever shows: along `shot` (driftBox), and at each of the
 * frames whose corners `corners` are — the menu's places (places.ts) — as far as `bound` reaches,
 * the lab and the dark round it (`labBound`): further into the dark a frame shows the dark
 * without the bake (scene.ts `paintBake`). In whole pixels round them all.
 */
export function sceneBox(
  shot: SceneShot,
  [w, h]: readonly [number, number],
  corners: readonly { x: number; y: number }[],
  bound: PixelBox,
): PixelBox {
  const drift = driftBox(shot, w, h);
  const [right, bottom] = [bound.left + bound.width, bound.top + bound.height];
  const xs = [drift.left, drift.left + drift.width];
  const ys = [drift.top, drift.top + drift.height];
  for (const { x, y } of corners) {
    xs.push(within(bound.left, x, right), within(bound.left, x + w, right));
    ys.push(within(bound.top, y, bottom), within(bound.top, y + h, bottom));
  }
  const [left, top] = [Math.min(...xs), Math.min(...ys)];
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

/**
 * Where in `box` a frame `w` × `h` starts with the camera `progress` of the way along `shot`,
 * whole pixels: the bake is copied that far up and to the left, pixel for pixel. Always
 * within the box, the frame whole inside it.
 */
export function driftOffset(
  shot: SceneShot,
  box: PixelBox,
  w: number,
  h: number,
  progress: number,
): { x: number; y: number } {
  const at = shotPoint(shot.from, shot.to, progress);
  const x = Math.round(at.x * shot.scale - w / 2) - box.left;
  const y = Math.round(at.y * shot.scale - h / 2) - box.top;
  return {
    x: Math.min(box.width - w, Math.max(0, x)),
    y: Math.min(box.height - h, Math.max(0, y)),
  };
}

/** How far a mission picked at `since` has come in at `now`, 0 to 1. */
export function fadeAt(since: number, now: number): number {
  return Math.min(1, Math.max(0, (now - since) / SCENE_FADE_MS));
}

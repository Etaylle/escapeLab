import { checkMission, type DronePosition, type PlayerView } from '@escapelab/core';
import { assembleFrame, type FrameSource, type Latest } from '../assemble.js';
import { worldText } from '../art.js';
import type { CanvasMaker } from '../atlas.js';
import { bakeable } from '../baked.js';
import { openLightPath } from '../gl/path.js';
import { BLACK, css, rgba } from '../palette.js';
import * as actors from '../render/actors.js';
import { backingSize } from '../render/backing.js';
import { renderKit, type Frame } from '../render/frame.js';
import * as glow from '../render/glow.js';
import * as light from '../render/light.js';
import * as objects from '../render/objects.js';
import * as tiles from '../render/tiles.js';
import { newSim } from '../sim.js';
import {
  driftOffset,
  fadeAt,
  labBound,
  sceneBox,
  sceneShot,
  SCENE_FADE_MS,
  type PixelBox,
  type SceneShot,
} from './drift.js';
import { placeCorner, placesOf, type Spot } from './places.js';
import { parkedDrones, sceneViewOf } from './view.js';

/**
 * The menu's scene drawn (screens/MenuScene.tsx): a mission's lab lit whole, baked once for the
 * canvas's size — every pass of the world's picture but its HUD and what lies over it (room
 * names, prompts, the minimap), run once over the box the drift and the menu's places ever show
 * (drift.ts `sceneBox`, places.ts) — and then copied onto the canvas pixel for pixel, from where
 * the camera stands (camera.ts): as far along the opening's shot as the drift has come, or at an
 * item's place, or on the way between; one copy a frame, two while a mission picked anew comes in
 * over the last (SCENE_FADE_MS). Nothing in it moves but the camera: nobody of a crew stands in
 * the lab, and its drones are parked. A lab lit whole is lit the Canvas way, which needs no light
 * layer, so the scene opens no WebGL context.
 */

/** The passes the bake runs, in the pipeline's order (render/pipeline.ts): no HUD, nothing over. */
const PASSES: readonly ((ctx: CanvasRenderingContext2D, frame: Frame) => void)[] = [
  tiles.draw,
  objects.draw,
  actors.draw,
  glow.under,
  light.draw,
  glow.draw,
];

/** A mission's lab as the scene draws it: its view, its drones parked (view.ts). */
export interface SceneLab {
  missionId: string;
  view: PlayerView;
  drones: Record<string, DronePosition>;
}

/** The lab baked for a canvas `w` × `h`: the box of it the drift shows, and the shot it follows. */
export interface SceneBake {
  canvas: HTMLCanvasElement;
  shot: SceneShot;
  box: PixelBox;
  w: number;
  h: number;
  /** whether its canvas holds the lab at night, its light sunk (`nightTo`) */
  night: boolean;
  /** where on it the frame that shows each item's place starts, device px (places.ts) */
  spots: Readonly<Record<string, Spot>>;
  /**
   * the dark round the lab as it holds it: where on it that is read, and its colour as it stands
   * now, lit or at night — what a frame that looks past its edge shows there (`paintBake`); null
   * where no place's frame looks past the lab
   */
  dark: { at: Spot; colour: string } | null;
}

/**
 * How far the lab sinks at night, the menu's hero standing in it with its lamp: its light cut
 * to little more than a third — which the bake added onto itself brings back (`nightTo`).
 */
export const NIGHT_SINK = 0.62;

/**
 * Adds `g`'s canvas onto itself until its light is `times` as strong: doubled at each whole
 * step, the last step a share of itself.
 */
function multiplyLight(g: CanvasRenderingContext2D, times: number): void {
  g.globalCompositeOperation = 'lighter';
  for (let left = times; left > 1 + 1e-6; ) {
    const share = Math.min(1, left - 1);
    g.globalAlpha = share;
    g.drawImage(g.canvas, 0, 0);
    left /= 1 + share;
  }
}

/**
 * `bake`'s lab at night (`night`) or lit, on its own canvas and only where it stands otherwise:
 * sunk under a black NIGHT_SINK strong, laid over its own pixels alone, or added onto itself
 * until its light is back — over the whole canvas, in its own pixels, whatever transform and
 * strength the world's passes left on its context, which would shift both by the box's corner.
 * Once for each change, so that a frame copies the bake as it is and no frame darkens the scene
 * anew.
 */
export function nightTo(bake: SceneBake, night: boolean): void {
  const g = bake.night === night ? null : bake.canvas.getContext('2d');
  if (g === null) {
    return;
  }
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  if (night) {
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = rgba(BLACK, NIGHT_SINK);
    g.fillRect(0, 0, bake.canvas.width, bake.canvas.height);
  } else {
    multiplyLight(g, 1 / (1 - NIGHT_SINK));
  }
  g.restore();
  bake.night = night;
  if (bake.dark !== null) {
    bake.dark.colour = colourAt(g, bake.dark.at);
  }
}

/** The colour of the pixel at `at` of `g`'s canvas as it stands, as a canvas takes it. */
function colourAt(g: CanvasRenderingContext2D, at: Spot): string {
  const { data } = g.getImageData(at.x, at.y, 1, 1);
  return css([data[0] ?? 0, data[1] ?? 0, data[2] ?? 0]);
}

/**
 * A world of the lab's own for the bake: the audience's lab lit whole, the camera at `at`, its
 * kit baking on canvases from `make`.
 */
function sourceFor(
  lab: SceneLab,
  canvas: HTMLCanvasElement,
  overlay: CanvasRenderingContext2D,
  at: NonNullable<FrameSource['scene']>,
  make: CanvasMaker,
): FrameSource {
  const kit = renderKit(overlay, make);
  kit.light = openLightPath(canvas, '?gl=0');
  const latest: Latest = {
    view: lab.view,
    darkSince: null,
    locked: false,
    finale: null,
    escapeSince: null,
    intro: null,
    reduced: false,
    textScale: 1,
    voice: null,
  };
  return {
    canvas,
    kit,
    sim: newSim(0),
    spectator: true,
    touchPad: matchMedia('(pointer: coarse)'),
    insets: { top: 0, bar: 0, bottom: 0, controls: [] },
    live: { current: latest },
    alarm: { current: null },
    positions: { current: { run: null, players: {} } },
    drones: { current: lab.drones },
    chats: { current: [] },
    clips: new WeakMap(),
    texts: { s: 0, dpr: 0, scale: 0, styles: worldText(at.scale, 1) },
    scene: at,
  };
}

/** A canvas `width` × `height` and its 2D context; null where the browser gives none. */
function canvasOf(width: number, height: number): CanvasRenderingContext2D | null {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext('2d');
}

/**
 * Lets `canvas`'s pixels go at once rather than whenever it is collected, as frameCache.ts
 * does: a bake of a large window at twice its density holds tens of megabytes.
 */
export function freeCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

/** Canvases from the document, each kept in `made` too: to be freed once the bake is done. */
function keptIn(made: HTMLCanvasElement[]): CanvasMaker {
  return (width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    made.push(canvas);
    return canvas;
  };
}

/**
 * The bake's canvas, as large as `box`, and one for the darkness the light pass keeps (none
 * falls on a lab lit whole); null where the box is too large to bake or the browser gives none.
 */
function canvasesFor(
  box: PixelBox,
): { ctx: CanvasRenderingContext2D; overlay: CanvasRenderingContext2D } | null {
  const ctx = bakeable(box.width, box.height) ? canvasOf(box.width, box.height) : null;
  const overlay = canvasOf(1, 1);
  if (ctx !== null && overlay !== null) {
    return { ctx, overlay };
  }
  for (const made of [ctx, overlay]) {
    if (made !== null) freeCanvas(made.canvas);
  }
  return null;
}

/** What a canvas `w` × `h` at `dpr` frames of `lab`: the shot, its places' corners, the box. */
interface SceneFraming {
  shot: SceneShot;
  /** where the frame of each item's place starts on the lab at the shot's scale, device px */
  corners: [item: string, corner: Spot][];
  box: PixelBox;
  /** the lab's own pixels at the shot's scale: what lies past them is its dark */
  lab: PixelBox;
}

/** How a canvas `w` × `h` at `dpr` frames `lab`; null where the view has no map. */
function framingOf(lab: SceneLab, w: number, h: number, dpr: number): SceneFraming | null {
  const map = lab.view.map;
  if (map === null) {
    return null;
  }
  const shot = sceneShot(map, w, h, dpr);
  const places = Object.entries(placesOf(lab.missionId));
  const corners = places.map(([item, spot]): [string, Spot] => [
    item,
    placeCorner(spot, shot.scale, w, h),
  ]);
  const bound = labBound(map, shot.scale);
  const box = sceneBox(
    shot,
    [w, h],
    corners.map(([, corner]) => corner),
    bound,
  );
  const round = -bound.left;
  const own = { left: 0, top: 0, width: bound.width - 2 * round, height: bound.height - 2 * round };
  return { shot, corners, box, lab: own };
}

/**
 * Where on a bake of `box` its dark round the lab `lab` is read, in its pixels: the middle of the
 * side of the box that reaches furthest past the lab, where the lab's light falls on the dark as
 * evenly as along the whole side; null where the box lies within the lab.
 */
function darkAt(box: PixelBox, lab: PixelBox): Spot | null {
  const [midX, midY] = [Math.floor(box.width / 2), Math.floor(box.height / 2)];
  const sides: [number, Spot][] = [
    [lab.left - box.left, { x: 0, y: midY }],
    [box.left + box.width - (lab.left + lab.width), { x: box.width - 1, y: midY }],
    [lab.top - box.top, { x: midX, y: 0 }],
    [box.top + box.height - (lab.top + lab.height), { x: midX, y: box.height - 1 }],
  ];
  const [past, at] = sides.reduce((a, b) => (b[0] > a[0] ? b : a));
  return past > 0 ? at : null;
}

/** The dark round the lab as `g`, the bake of `box`, holds it (`darkAt`); null for none. */
function darkOf(g: CanvasRenderingContext2D, box: PixelBox, lab: PixelBox): SceneBake['dark'] {
  const at = darkAt(box, lab);
  return at === null ? null : { at, colour: colourAt(g, at) };
}

/**
 * Bakes `lab` for a canvas `w` × `h` at `dpr` device pixels a CSS pixel: the passes run once
 * over the box the drift and the places show, the camera at its middle. What the bake's kit made
 * on the way — the map baked whole, more pixels than the bake itself, and the sprites — is freed
 * once it is done. Null where the view has no map or the box would be too large to bake
 * (baked.ts `bakeable`).
 */
export function bakeScene(lab: SceneLab, w: number, h: number, dpr: number): SceneBake | null {
  const map = lab.view.map;
  const framing = w <= 0 || h <= 0 ? null : framingOf(lab, w, h, dpr);
  if (map === null || framing === null) {
    return null;
  }
  const { shot, box, corners, lab: own } = framing;
  const canvases = canvasesFor(box);
  if (canvases === null) {
    return null;
  }
  const { ctx, overlay } = canvases;
  const middle = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  const at = { x: middle.x / shot.scale, y: middle.y / shot.scale, scale: shot.scale };
  const made = [overlay.canvas];
  const source = sourceFor(lab, ctx.canvas, overlay, at, keptIn(made));
  const frame = assembleFrame(source, map, dpr, performance.now(), []);
  for (const pass of PASSES) {
    pass(ctx, frame);
  }
  source.kit.light?.dispose();
  made.forEach(freeCanvas);
  const spots = Object.fromEntries(
    corners.map(([item, corner]) => [item, { x: corner.x - box.left, y: corner.y - box.top }]),
  );
  const dark = darkOf(ctx, box, own);
  return { canvas: ctx.canvas, shot, box, w, h, night: false, spots, dark };
}

/** Where on `bake` the frame starts that the drift shows `progress` along its shot. */
export function driftCorner(bake: SceneBake, progress: number): Spot {
  return driftOffset(bake.shot, bake.box, bake.w, bake.h, progress);
}

/**
 * Where on `bake` the frame starts that shows the place of `item`: the drift's, `progress` along
 * its shot, for none or for an item whose lab has no place for it.
 */
export function goalCorner(bake: SceneBake, item: string | null, progress: number): Spot {
  return (item === null ? undefined : bake.spots[item]) ?? driftCorner(bake, progress);
}

/** `v` held within `lo` and `hi`. */
const within = (lo: number, v: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * What of a frame `w` × `h` starting at `corner` on a bake `bw` × `bh` lies past the bake, as
 * rectangles on the frame — x, y, width, height —: none where the frame lies within it.
 */
export function pastBake(
  corner: Spot,
  [bw, bh]: readonly [number, number],
  [w, h]: readonly [number, number],
): [number, number, number, number][] {
  const left = within(0, -corner.x, w);
  const right = within(left, bw - corner.x, w);
  const top = within(0, -corner.y, h);
  const bottom = within(top, bh - corner.y, h);
  const parts: [number, number, number, number][] = [
    [0, 0, left, h],
    [right, 0, w - right, h],
    [left, 0, right - left, top],
    [left, bottom, right - left, h - bottom],
  ];
  return parts.filter(([, , pw, ph]) => pw > 0 && ph > 0);
}

/**
 * Copies `bake` onto `ctx`'s canvas, its frame starting at `corner`, `alpha` strong — and where
 * the frame looks past the bake, into the dark round the lab, fills that with the dark's colour
 * as the bake holds it now, at night or lit, which the bake's own tile of dark meets evenly.
 */
export function paintBake(
  ctx: CanvasRenderingContext2D,
  bake: SceneBake,
  corner: Spot,
  alpha: number,
): void {
  ctx.globalAlpha = alpha;
  ctx.drawImage(bake.canvas, -corner.x, -corner.y);
  const size = [ctx.canvas.width, ctx.canvas.height] as const;
  const past = pastBake(corner, [bake.canvas.width, bake.canvas.height], size);
  if (past.length > 0 && bake.dark !== null) {
    ctx.fillStyle = bake.dark.colour;
    for (const [x, y, pw, ph] of past) ctx.fillRect(x, y, pw, ph);
  }
  ctx.globalAlpha = 1;
}

/** What the scene shows: the lab baked, the one it comes in over and since when, what was drawn. */
export interface SceneShow {
  bake: SceneBake | null;
  /** the lab the new one comes in over, while it does; null for none, or once it has */
  from: SceneBake | null;
  /** when `bake` came, ms (performance.now) */
  since: number;
  /**
   * the bake the last frame drew whole: under reduced motion nothing is drawn again until it
   * changes
   */
  drawn: SceneBake | null;
}

/** Whether a frame at `now` draws anything: the drift moving, a lab coming in, a new bake. */
export function needsPaint(show: SceneShow, now: number, reduced: boolean): boolean {
  return (
    show.bake !== null && (!reduced || fadeAt(show.since, now) < 1 || show.drawn !== show.bake)
  );
}

/** Where a frame of the scene stands: the drift's progress along its shot, the camera's corner. */
export interface SceneView {
  progress: number;
  /** where the frame of the lab shown starts on its bake (camera.ts) */
  corner: Spot;
}

/**
 * One frame of the scene at `now` as `view` frames it: the lab coming in over the one before,
 * `fadeAt` of the way — over nothing, the canvas cleared, for the first — or the lab alone once
 * it has come, the one before then freed. The lab before drifts on as it did.
 */
export function paintShow(
  ctx: CanvasRenderingContext2D,
  show: SceneShow,
  now: number,
  view: SceneView,
): void {
  const bake = show.bake;
  if (bake === null) {
    return;
  }
  const t = fadeAt(show.since, now);
  if (t >= 1) {
    const gone = show.from;
    show.from = null;
    freeDropped(show, [gone]);
  } else if (show.from === null) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  } else {
    paintBake(ctx, show.from, driftCorner(show.from, view.progress), 1);
  }
  paintBake(ctx, bake, view.corner, t);
  show.drawn = t >= 1 ? bake : null;
}

/** Frees the canvas of each of `dropped` that `show` no longer holds. */
function freeDropped(show: SceneShow, dropped: readonly (SceneBake | null)[]): void {
  for (const bake of dropped) {
    if (bake !== null && bake !== show.bake && bake !== show.from) {
      freeCanvas(bake.canvas);
    }
  }
}

/**
 * `show` with `bake` in it: coming in over what showed (`fade`) — over nothing where nothing
 * did, or where that was baked for another size of canvas — or at once. What it no longer
 * holds is freed: the lab before, unless the new one comes in over it, and the one that was
 * still coming in.
 */
export function showBake(show: SceneShow, bake: SceneBake, now: number, fade: boolean): void {
  const before = show.bake;
  const dropped = [before, show.from];
  const sameSize = before !== null && before.w === bake.w && before.h === bake.h;
  show.from = fade && sameSize ? before : null;
  show.bake = bake;
  show.since = fade ? now : now - SCENE_FADE_MS;
  show.drawn = null;
  freeDropped(show, dropped);
}

/** `show` emptied, its bakes freed: the scene closes. */
export function clearShow(show: SceneShow): void {
  const dropped = [show.bake, show.from];
  show.bake = null;
  show.from = null;
  show.drawn = null;
  freeDropped(show, dropped);
}

/**
 * The labs asked for so far, by mission id: each fetched once a page — but one not to be had
 * is forgotten, and asked for anew the next time.
 */
const labs = new Map<string, Promise<SceneLab | null>>();

/** `json` as a mission's lab; null where it is no mission, or its run does not start. */
function labOf(missionId: string, json: unknown): SceneLab | null {
  const checked = checkMission(json);
  if (!checked.ok) {
    return null;
  }
  try {
    const { mission } = checked;
    return { missionId, view: sceneViewOf(mission), drones: parkedDrones(mission) };
  } catch {
    return null;
  }
}

/**
 * The lab of mission `missionId` (GET /missions/:id), fetched once a page; null where it is
 * not to be had — the scene then keeps the lab it shows, and the next pick of the mission asks
 * again, as the server may be back by then.
 */
export function sceneLab(missionId: string): Promise<SceneLab | null> {
  const known = labs.get(missionId);
  if (known !== undefined) {
    return known;
  }
  const asked = fetch(`/missions/${encodeURIComponent(missionId)}`)
    .then((res) => (res.ok ? res.json() : null))
    .then((json: unknown) => (json === null ? null : labOf(missionId, json)))
    .catch(() => null)
    .then((lab) => {
      if (lab === null) {
        labs.delete(missionId);
      }
      return lab;
    });
  labs.set(missionId, asked);
  return asked;
}

/** The steps a scene's density falls in where its box would be too large to bake. */
const DENSITY_STEP = 0.25;

/**
 * Whether `lab`'s scene bakes for a canvas `cssW` × `cssH` at `dpr`: its whole box (`framingOf`).
 */
function bakesAt(lab: SceneLab, [cssW, cssH]: readonly [number, number], dpr: number): boolean {
  const size = backingSize(cssW, cssH, dpr);
  const box = framingOf(lab, size.w, size.h, size.dpr)?.box;
  return box === undefined || bakeable(box.width, box.height);
}

/**
 * The size and density `canvas` draws its scene at: its box at the screen's density
 * (render/backing.ts), or at the densest a quarter less at a time where the box the drift and the
 * places show would be too large to bake at it — at 1 at the least.
 */
export function sceneBacking(
  lab: SceneLab | null,
  cssW: number,
  cssH: number,
  ratio: number,
): { w: number; h: number; dpr: number } {
  const dense = backingSize(cssW, cssH, ratio);
  if (lab === null) {
    return dense;
  }
  let dpr = dense.dpr;
  while (dpr > 1 && !bakesAt(lab, [cssW, cssH], dpr)) {
    dpr = Math.max(1, dpr - DENSITY_STEP);
  }
  return backingSize(cssW, cssH, dpr);
}

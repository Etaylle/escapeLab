import { checkMission, type DronePosition, type PlayerView } from '@escapelab/core';
import { assembleFrame, type FrameSource, type Latest } from '../assemble.js';
import { worldText } from '../art.js';
import type { CanvasMaker } from '../atlas.js';
import { bakeable } from '../baked.js';
import { openLightPath } from '../gl/path.js';
import * as actors from '../render/actors.js';
import { backingSize } from '../render/backing.js';
import { renderKit, type Frame } from '../render/frame.js';
import * as glow from '../render/glow.js';
import * as light from '../render/light.js';
import * as objects from '../render/objects.js';
import * as tiles from '../render/tiles.js';
import { newSim } from '../sim.js';
import {
  driftAt,
  driftBox,
  driftOffset,
  fadeAt,
  sceneShot,
  SCENE_FADE_MS,
  type PixelBox,
  type SceneShot,
} from './drift.js';
import { parkedDrones, sceneViewOf } from './view.js';

/**
 * The menu's scene drawn (screens/MenuScene.tsx): a mission's lab lit whole, baked once for the
 * canvas's size — every pass of the world's picture but its HUD and what lies over it (room
 * names, prompts, the minimap), run once over the box the drift ever shows (drift.ts
 * `driftBox`) — and then copied onto the canvas pixel for pixel, as far along the opening's
 * shot as the drift has come: one copy a frame, two while a mission picked anew comes in over
 * the last (SCENE_FADE_MS). Nothing in it moves but the camera: nobody of a crew stands in the
 * lab, and its drones are parked. A lab lit whole is lit the Canvas way, which needs no light
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

/**
 * Bakes `lab` for a canvas `w` × `h` at `dpr` device pixels a CSS pixel: the passes run once
 * over the box the drift shows, the camera at its middle. What the bake's kit made on the way
 * — the map baked whole, more pixels than the bake itself, and the sprites — is freed once it
 * is done. Null where the view has no map or the box would be too large to bake (baked.ts
 * `bakeable`).
 */
export function bakeScene(lab: SceneLab, w: number, h: number, dpr: number): SceneBake | null {
  const map = lab.view.map;
  if (map === null || w <= 0 || h <= 0) {
    return null;
  }
  const shot = sceneShot(map, w, h, dpr);
  const box = driftBox(shot, w, h);
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
  return { canvas: ctx.canvas, shot, box, w, h };
}

/** Copies `bake` onto `ctx`'s canvas `progress` of the way along its shot, `alpha` strong. */
export function paintBake(
  ctx: CanvasRenderingContext2D,
  bake: SceneBake,
  progress: number,
  alpha: number,
): void {
  const { x, y } = driftOffset(bake.shot, bake.box, bake.w, bake.h, progress);
  ctx.globalAlpha = alpha;
  ctx.drawImage(bake.canvas, -x, -y);
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

/**
 * One frame of the scene at `now`, the drift `driftMs` in: the lab coming in over the one
 * before, `fadeAt` of the way — over nothing, the canvas cleared, for the first — or the lab
 * alone once it has come, the one before then freed.
 */
export function paintShow(
  ctx: CanvasRenderingContext2D,
  show: SceneShow,
  now: number,
  driftMs: number,
  reduced: boolean,
): void {
  const bake = show.bake;
  if (bake === null) {
    return;
  }
  const t = fadeAt(show.since, now);
  const progress = driftAt(driftMs, reduced);
  if (t >= 1) {
    const gone = show.from;
    show.from = null;
    freeDropped(show, [gone]);
  } else if (show.from === null) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  } else {
    paintBake(ctx, show.from, progress, 1);
  }
  paintBake(ctx, bake, progress, t);
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

/**
 * The size and density `canvas` draws its scene at: its box at the screen's density
 * (render/backing.ts), or at 1 where the drift's box at that density would be too large to bake.
 */
export function sceneBacking(
  lab: SceneLab | null,
  cssW: number,
  cssH: number,
  ratio: number,
): { w: number; h: number; dpr: number } {
  const dense = backingSize(cssW, cssH, ratio);
  const map = lab?.view.map ?? null;
  if (map === null || dense.dpr <= 1) {
    return dense;
  }
  const box = driftBox(sceneShot(map, dense.w, dense.h, dense.dpr), dense.w, dense.h);
  return bakeable(box.width, box.height) ? dense : backingSize(cssW, cssH, 1);
}

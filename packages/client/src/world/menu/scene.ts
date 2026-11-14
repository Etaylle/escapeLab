import { checkMission, type DronePosition, type PlayerView } from '@escapelab/core';
import { assembleFrame, type FrameSource, type Latest } from '../assemble.js';
import { worldText } from '../art.js';
import type { CanvasMaker } from '../atlas.js';
import { bakeable } from '../baked.js';
import { openLightPath } from '../gl/path.js';
import { BLACK, css, rgba } from '../palette.js';
import * as actors from '../render/actors.js';
import { backingSize } from '../render/backing.js';
import { renderKit, type Frame, type RenderKit, type WorldMap } from '../render/frame.js';
import * as glow from '../render/glow.js';
import * as light from '../render/light.js';
import * as objects from '../render/objects.js';
import * as tiles from '../render/tiles.js';
import { newSim } from '../sim.js';
import {
  driftBox,
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
 * names, prompts, the minimap), run over the box the drift and the menu's places ever show
 * (drift.ts `sceneBox`, places.ts) in pieces: the drift's box first, as the scene was baked
 * before it had places, the rest after (`restBaker`) — and then copied onto the canvas pixel for
 * pixel, each piece whole at its place, from where the camera stands (camera.ts): as far along
 * the opening's shot as the drift has come, or at an item's place, or on the way between; two
 * labs while a mission picked anew comes in over the last (SCENE_FADE_MS). Nothing in it moves
 * but the camera: nobody of a crew stands in the lab, and its drones are parked. A lab lit whole
 * is lit the Canvas way, which needs no light layer, so the scene opens no WebGL context.
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

/**
 * A piece of a bake: its box on the lab at the shot's scale, device px, its canvas once baked, and
 * whether it would not bake — no canvas to be had: no frame that falls on it shows.
 */
export interface BakePiece {
  box: PixelBox;
  canvas: HTMLCanvasElement | null;
  failed: boolean;
}

/**
 * The lab baked for a canvas `w` × `h`: the box of it the drift and the places show, in pieces —
 * the drift's box first, baked with the bake, then what the places show besides (`restBaker`),
 * each within what a canvas may hold — and the shot the drift follows.
 */
export interface SceneBake {
  shot: SceneShot;
  box: PixelBox;
  /** its pieces, the drift's box first; a piece's canvas null until it is baked */
  pieces: BakePiece[];
  w: number;
  h: number;
  /** whether its canvases hold the lab at night, its light sunk (`nightTo`) */
  night: boolean;
  /** where on it the frame that shows each item's place starts, device px (places.ts) */
  spots: Readonly<Record<string, Spot>>;
  /**
   * the dark round the lab as it holds it: where on it that is read, and its colour as it stands
   * now, lit or at night — what a frame that looks past its edge shows there (`paintBake`) —,
   * null until a piece that holds it is baked; null where no place's frame looks past the lab
   */
  dark: { at: Spot; colour: string | null } | null;
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
 * `canvas`'s lab at night (`night`) or lit: sunk under a black NIGHT_SINK strong, laid over its
 * own pixels alone, or added onto itself until its light is back — over the whole canvas, in its
 * own pixels, whatever transform and strength the world's passes left on its context, which would
 * shift both by the box's corner.
 */
function nightOn(canvas: HTMLCanvasElement, night: boolean): void {
  const g = canvas.getContext('2d');
  if (g === null) {
    return;
  }
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  if (night) {
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = rgba(BLACK, NIGHT_SINK);
    g.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    multiplyLight(g, 1 / (1 - NIGHT_SINK));
  }
  g.restore();
}

/**
 * `bake`'s lab at night (`night`) or lit, on each of its pieces baked and only where it stands
 * otherwise (`nightOn`), its dark read again as it now stands: once for each change, so that a
 * frame copies the bake as it is and no frame darkens the scene anew.
 */
export function nightTo(bake: SceneBake, night: boolean): void {
  if (bake.night === night) {
    return;
  }
  for (const { canvas } of bake.pieces) {
    if (canvas !== null) nightOn(canvas, night);
  }
  bake.night = night;
  readDark(bake);
}

/** Whether the point `x`, `y` lies in `box`. */
const holds = (box: PixelBox, x: number, y: number): boolean =>
  x >= box.left && y >= box.top && x < box.left + box.width && y < box.top + box.height;

/** The baked piece of `bake` that holds the point `at` of its box, with its context; null for none. */
function holderAt(bake: SceneBake, at: Spot): { box: PixelBox; g: CanvasRenderingContext2D } | null {
  const [x, y] = [bake.box.left + at.x, bake.box.top + at.y];
  for (const { box, canvas } of bake.pieces) {
    const g = canvas !== null && holds(box, x, y) ? canvas.getContext('2d') : null;
    if (g !== null) return { box, g };
  }
  return null;
}

/** Reads `bake`'s dark off the baked piece that holds it, as it stands; none where none does. */
function readDark(bake: SceneBake): void {
  const { dark } = bake;
  const holder = dark === null ? null : holderAt(bake, dark.at);
  if (dark === null || holder === null) {
    return;
  }
  const { box, g } = holder;
  dark.colour = colourAt(g, { x: bake.box.left + dark.at.x - box.left, y: bake.box.top + dark.at.y - box.top });
}

/** The colour of the pixel at `at` of `g`'s canvas as it stands, as a canvas takes it. */
function colourAt(g: CanvasRenderingContext2D, at: Spot): string {
  const { data } = g.getImageData(at.x, at.y, 1, 1);
  return css([data[0] ?? 0, data[1] ?? 0, data[2] ?? 0]);
}

/**
 * A world of the lab's own for a piece of the bake drawn on `canvas`: the audience's lab lit
 * whole, the camera at `at`, drawn with `kit`, which every piece of a bake shares.
 */
function sourceFor(
  lab: SceneLab,
  canvas: HTMLCanvasElement,
  kit: RenderKit,
  at: NonNullable<FrameSource['scene']>,
): FrameSource {
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

/** What bakes the pieces of a lab with one kit: each piece onto a canvas of its own, then freed. */
interface PieceKit {
  /** `box` baked onto a canvas as large; null where it is too large or the browser gives none */
  bake(box: PixelBox): HTMLCanvasElement | null;
  /** lets the kit's canvases go: the map it baked whole, its sprites, the darkness's canvas */
  free(): void;
}

/**
 * A kit for baking `lab`'s pieces at `dpr` along `shot` on `map`: the darkness the light pass keeps
 * on a canvas of its own (none falls on a lab lit whole), the map and the sprites baked once for
 * every piece; null where the browser gives no canvas.
 */
function pieceKit(lab: SceneLab, map: WorldMap, shot: SceneShot, dpr: number): PieceKit | null {
  const overlay = canvasOf(1, 1);
  if (overlay === null) {
    return null;
  }
  const made = [overlay.canvas];
  const kit = renderKit(overlay, keptIn(made));
  kit.light = openLightPath(overlay.canvas, '?gl=0');
  return {
    bake(box) {
      const ctx = bakeable(box.width, box.height) ? canvasOf(box.width, box.height) : null;
      if (ctx === null) {
        return null;
      }
      const middle = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      const at = { x: middle.x / shot.scale, y: middle.y / shot.scale, scale: shot.scale };
      const frame = assembleFrame(sourceFor(lab, ctx.canvas, kit, at), map, dpr, performance.now(), []);
      for (const pass of PASSES) {
        pass(ctx, frame);
      }
      return ctx.canvas;
    },
    free() {
      kit.light?.dispose();
      made.forEach(freeCanvas);
    },
  };
}

/**
 * What a canvas `w` × `h` at `dpr` frames of `lab`: its map, the shot, its places' corners, the
 * box the drift and the places show and the drift's own.
 */
interface SceneFraming {
  map: WorldMap;
  shot: SceneShot;
  /** where the frame of each item's place starts on the lab at the shot's scale, device px */
  corners: [item: string, corner: Spot][];
  box: PixelBox;
  drift: PixelBox;
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
  return { map, shot, corners, box, drift: driftBox(shot, w, h), lab: own };
}

/** The most pixels a piece of a bake's rest holds: a canvas a step bakes without a long stall. */
const REST_PIECE_PIXELS = 1024 * 1024;

/** Whether a piece `width` × `height` may be one of a bake's rest: a canvas, and a short step. */
const restFits = (width: number, height: number): boolean =>
  bakeable(width, height) && width * height <= REST_PIECE_PIXELS;

/**
 * `part` cut along its longer side into as few equal pieces as fit (`restFits`); none where even
 * a pixel's width of it would not.
 */
function cutToFit(part: PixelBox): PixelBox[] {
  const across = part.width >= part.height;
  const [long, short] = across ? [part.width, part.height] : [part.height, part.width];
  let n = 1;
  while (n < long && !restFits(Math.ceil(long / n), short)) n += 1;
  if (!restFits(Math.ceil(long / n), short)) {
    return [];
  }
  const step = Math.ceil(long / n);
  return Array.from({ length: Math.ceil(long / step) }, (_, i): PixelBox => {
    const [at, size] = [i * step, Math.min(step, long - i * step)];
    return across
      ? { left: part.left + at, top: part.top, width: size, height: part.height }
      : { left: part.left, top: part.top + at, width: part.width, height: size };
  });
}

/**
 * What of `box` lies past `drift`, which it holds — above it and below it the box's whole width,
 * left and right of it the drift's height — in pieces that each fit (`cutToFit`).
 */
export function restOf(box: PixelBox, drift: PixelBox): PixelBox[] {
  const [right, bottom] = [box.left + box.width, box.top + box.height];
  const [driftRight, driftBottom] = [drift.left + drift.width, drift.top + drift.height];
  const parts: PixelBox[] = [
    { left: box.left, top: box.top, width: box.width, height: drift.top - box.top },
    { left: box.left, top: driftBottom, width: box.width, height: bottom - driftBottom },
    { left: box.left, top: drift.top, width: drift.left - box.left, height: drift.height },
    { left: driftRight, top: drift.top, width: right - driftRight, height: drift.height },
  ];
  return parts.filter((part) => part.width > 0 && part.height > 0).flatMap(cutToFit);
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

/**
 * The kits bakes kept for their rest (`bakeScene` with `keep`): the map and the sprites baked
 * once, until the rest's baker takes the kit (`restBaker`) or the bake lets it go (`letKitGo`).
 */
const keptKits = new WeakMap<SceneBake, PieceKit>();

/** The drift's box of `framing` baked, and the kit that baked it; null where it would not bake. */
function bakeDrift(
  lab: SceneLab,
  framing: SceneFraming,
  dpr: number,
): { canvas: HTMLCanvasElement; kit: PieceKit } | null {
  const kit = pieceKit(lab, framing.map, framing.shot, dpr);
  const canvas = kit?.bake(framing.drift) ?? null;
  if (kit === null || canvas === null) {
    kit?.free();
    return null;
  }
  return { canvas, kit };
}

/** A bake of `framing` for a canvas `w` × `h`, its drift's piece on `canvas`, the rest to bake. */
function bakeOf(framing: SceneFraming, canvas: HTMLCanvasElement, [w, h]: number[]): SceneBake {
  const { shot, box, drift, corners } = framing;
  const rest = restOf(box, drift).map((part) => ({ box: part, canvas: null, failed: false }));
  const spots = Object.fromEntries(
    corners.map(([item, corner]) => [item, { x: corner.x - box.left, y: corner.y - box.top }]),
  );
  const at = darkAt(box, framing.lab);
  const dark = at === null ? null : { at, colour: null };
  const pieces = [{ box: drift, canvas, failed: false }, ...rest];
  return { shot, box, pieces, w: w ?? 0, h: h ?? 0, night: false, spots, dark };
}

/**
 * Bakes `lab` for a canvas `w` × `h` at `dpr` device pixels a CSS pixel: the passes run once over
 * the drift's box, the camera at its middle, as the scene was baked before it had places; what
 * the places show besides waits for `restBaker`. What the kit made on the way — the map baked
 * whole, more pixels than the bake itself, and the sprites — is freed once it is done, or kept
 * for the rest (`keep`) until the rest's baker takes it or the bake lets it go. Null where the
 * view has no map or the drift's box would be too large to bake (baked.ts `bakeable`).
 */
export function bakeScene(
  lab: SceneLab,
  w: number,
  h: number,
  dpr: number,
  keep = false,
): SceneBake | null {
  const framing = w > 0 && h > 0 ? framingOf(lab, w, h, dpr) : null;
  const baked = framing === null ? null : bakeDrift(lab, framing, dpr);
  if (framing === null || baked === null) {
    return null;
  }
  const bake = bakeOf(framing, baked.canvas, [w, h]);
  keepOrFree(bake, baked.kit, keep);
  return bake;
}

/** `kit` kept for `bake`'s rest where `keep` says, else let go at once. */
function keepOrFree(bake: SceneBake, kit: PieceKit, keep: boolean): void {
  if (keep) {
    keptKits.set(bake, kit);
  } else {
    kit.free();
  }
}

/** Lets go of the kit `bake` kept for its rest, where it kept one: the rest bakes with its own. */
export function letKitGo(bake: SceneBake): void {
  keptKits.get(bake)?.free();
  keptKits.delete(bake);
}

/** What bakes the rest of a bake, one piece a step (`restBaker`). */
export interface RestBaker {
  /** bakes the next piece that waits; says whether any waits still */
  step(): boolean;
  /** lets the kit go, whatever still waits */
  drop(): void;
}

/** The next piece of `bake` that waits to be baked; undefined once none does. */
const waiting = (bake: SceneBake): BakePiece | undefined =>
  bake.pieces.find(({ canvas, failed }) => canvas === null && !failed);

/**
 * A piece of `bake` just baked onto `canvas` — null: it would not bake — laid at night as the bake
 * stands, and the bake's dark read again, a piece that holds it being baked now.
 */
function settle(bake: SceneBake, piece: BakePiece, canvas: HTMLCanvasElement | null): void {
  piece.canvas = canvas;
  piece.failed = canvas === null;
  if (canvas !== null && bake.night) {
    nightOn(canvas, true);
  }
  readDark(bake);
}

/**
 * What bakes the rest of `bake` — `lab` at `dpr` — one piece a step with one kit for them all,
 * the one the bake kept where it kept one (`settle`); the kit let go once none waits.
 */
export function restBaker(lab: SceneLab, bake: SceneBake, dpr: number): RestBaker {
  let kit: PieceKit | null = keptKits.get(bake) ?? null;
  keptKits.delete(bake);
  const drop = (): void => {
    kit?.free();
    kit = null;
  };
  const bakeNext = (piece: BakePiece, map: WorldMap): void => {
    kit ??= pieceKit(lab, map, bake.shot, dpr);
    settle(bake, piece, kit?.bake(piece.box) ?? null);
  };
  return {
    step() {
      const [piece, map] = [waiting(bake), lab.view.map];
      if (piece !== undefined && map !== null) bakeNext(piece, map);
      const waits = map !== null && waiting(bake) !== undefined;
      if (!waits) drop();
      return waits;
    },
    drop,
  };
}

/** Whether boxes `a` and `b` share any pixel. */
const overlap = (a: PixelBox, b: PixelBox): boolean =>
  a.left < b.left + b.width &&
  b.left < a.left + a.width &&
  a.top < b.top + b.height &&
  b.top < a.top + a.height;

/**
 * Whether `bake` shows the place of `item` yet: its lab has one, and every piece its frame falls
 * on is baked.
 */
export function placeReady(bake: SceneBake, item: string | null): boolean {
  const spot = item === null ? undefined : bake.spots[item];
  if (spot === undefined) {
    return false;
  }
  const { left, top } = bake.box;
  const frame = { left: left + spot.x, top: top + spot.y, width: bake.w, height: bake.h };
  return bake.pieces.every(({ box, canvas }) => canvas !== null || !overlap(box, frame));
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

/** Copies each baked piece of `bake` that the frame starting at `corner` shows, whole at its place. */
function layPieces(ctx: CanvasRenderingContext2D, bake: SceneBake, corner: Spot): void {
  const frame = { left: corner.x, top: corner.y, width: ctx.canvas.width, height: ctx.canvas.height };
  for (const { box, canvas } of bake.pieces) {
    const at = { left: box.left - bake.box.left, top: box.top - bake.box.top };
    if (canvas !== null && overlap({ ...box, ...at }, frame)) {
      ctx.drawImage(canvas, at.left - corner.x, at.top - corner.y);
    }
  }
}

/**
 * Fills what the frame starting at `corner` shows past `bake`, into the dark round the lab, with
 * the dark's colour as the bake holds it now, at night or lit, which the bake's own tile of dark
 * meets evenly.
 */
function layDark(ctx: CanvasRenderingContext2D, bake: SceneBake, corner: Spot): void {
  const size = [ctx.canvas.width, ctx.canvas.height] as const;
  const colour = bake.dark?.colour ?? null;
  const past = colour === null ? [] : pastBake(corner, [bake.box.width, bake.box.height], size);
  for (const [x, y, pw, ph] of past) {
    ctx.fillStyle = colour ?? '';
    ctx.fillRect(x, y, pw, ph);
  }
}

/**
 * Copies `bake` onto `ctx`'s canvas, its frame starting at `corner`, `alpha` strong: each of its
 * pieces baked whole at its place (`layPieces`), and the dark past it (`layDark`).
 */
export function paintBake(
  ctx: CanvasRenderingContext2D,
  bake: SceneBake,
  corner: Spot,
  alpha: number,
): void {
  ctx.globalAlpha = alpha;
  layPieces(ctx, bake, corner);
  layDark(ctx, bake, corner);
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

/** Lets each canvas of `bake`'s pieces go at once, and a kit it kept for its rest. */
export function freeBake(bake: SceneBake): void {
  letKitGo(bake);
  for (const { canvas } of bake.pieces) {
    if (canvas !== null) freeCanvas(canvas);
  }
}

/** Frees the canvases of each of `dropped` that `show` no longer holds. */
function freeDropped(show: SceneShow, dropped: readonly (SceneBake | null)[]): void {
  for (const bake of dropped) {
    if (bake !== null && bake !== show.bake && bake !== show.from) {
      freeBake(bake);
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
 * Whether `lab`'s scene bakes for a canvas `cssW` × `cssH` at `dpr`: the drift's box, the piece
 * baked first, as the scene was baked before it had places (`framingOf`); the rest is cut to fit.
 */
function bakesAt(lab: SceneLab, [cssW, cssH]: readonly [number, number], dpr: number): boolean {
  const size = backingSize(cssW, cssH, dpr);
  const drift = framingOf(lab, size.w, size.h, size.dpr)?.drift;
  return drift === undefined || bakeable(drift.width, drift.height);
}

/**
 * The size and density `canvas` draws its scene at: at the screen's density (render/backing.ts),
 * or at the densest a quarter less at a time where the drift's box would be too large to bake at
 * it — at 1 at the least.
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

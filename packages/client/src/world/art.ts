import type { ConsoleId, ManualKind } from '@escapelab/core';

// art.ts — pure Canvas2D drawing for EscapeLab: cute capsule scientists in a moody lab.
//
// No imports, no DOM queries, and nothing touches the DOM at import time. All draw
// functions assume the ctx is already transformed so that THE ORIGIN IS THE OBJECT'S
// ANCHOR and 1.0 === one map tile. Every public draw function saves and restores
// (try/finally) all ctx state it changes, and allocates nothing per call beyond what the
// canvas API itself allocates (drawPlate's uppercase label is the one exception).
//
// Module state is limited to these lazily filled memo caches, never invalidated:
// - Gradients. A CanvasGradient's coordinates are resolved in the user space active when
//   it is used for a fill or stroke, not when it is created, so a gradient built once in
//   object-local tile units stays correct under whatever transform a later call sets up.
//   Gradients belong to the context that created them, hence a WeakMap keyed by context
//   (entries die with their canvas), then by builder function, then by a color key string
//   ('' for color-independent gradients). Builders are module-level functions, so a
//   lookup allocates nothing. Keys come from small fixed sets (player colors, status
//   tints), so the caches stay tiny.
// - Derived shading colors per scientist body color.
// - The static scientist outlines as Path2D objects.
// makeFloorTile() and makeWallTile() return a fresh canvas per call for the caller to keep
// (e.g. as a CanvasPattern); their noise comes from a seeded PRNG, so every call yields the
// identical texture.
//
// Text: sub-pixel font sizes such as '0.26px' render unreliably (engines may round, clamp
// or hint the size before the transform applies). All text is therefore drawn TEXT_SCALE
// times larger inside ctx.scale(1 / TEXT_SCALE, 1 / TEXT_SCALE).

const TAU = Math.PI * 2;

const TEAL = '#2dd4bf';
const AMBER = '#fbbf24';
/** Reading: manual objects, like their edge marker. */
const BLUE = '#60a5fa';
// 'r, g, b' triples: glow and shadow colors, also their gradient cache keys.
const TEAL_RGB = '45, 212, 191';
const AMBER_RGB = '251, 191, 36';
const GREEN_RGB = '74, 222, 128';
const BLUE_RGB = '96, 165, 250';
const SHADOW_RGB = '0, 0, 0';
/** Near-black edge line for consoles, doors and other props. */
const PROP_EDGE = '#05080b';

const MONO = 'ui-monospace, Menlo, monospace';
/** Text is drawn this many times larger inside a matching down-scale (see header). */
const TEXT_SCALE = 32;
/** 0.26 tile: name tags and station titles. */
const FONT_HEADING = `bold ${0.26 * TEXT_SCALE}px ${MONO}`;
/** 0.2 tile: labels of plates, manual objects and the sign. */
const FONT_LABEL = `bold ${0.2 * TEXT_SCALE}px ${MONO}`;
/** 0.17 tile: a console's letter on its station. */
const FONT_BADGE = `bold ${0.17 * TEXT_SCALE}px ${MONO}`;
/** Label of a prop that is not calling for anybody right now. */
const IDLE_LABEL = '#8a96a5';
const HALO_COLOR = 'rgba(3, 6, 10, 0.88)';
/** Halo stroke width in text space; the halo reaches half of it past each glyph edge. */
const HALO_WIDTH = 0.075 * TEXT_SCALE;

// ---- Shared helpers ------------------------------------------------------------------

type Rgb = readonly [number, number, number];
type GradientBuilder = (ctx: CanvasRenderingContext2D, key: string) => CanvasGradient;
type GradientsByKey = Map<string, CanvasGradient>;
type GradientsByBuilder = Map<GradientBuilder, GradientsByKey>;

/** Gradient memo: context -> builder -> key -> gradient (see the header comment). */
const gradientCache = new WeakMap<CanvasRenderingContext2D, GradientsByBuilder>();

/** Returns the gradient `build` makes for `key` on `ctx`, building it on first use. */
function cachedGradient(
  ctx: CanvasRenderingContext2D,
  build: GradientBuilder,
  key: string,
): CanvasGradient {
  let byBuilder = gradientCache.get(ctx);
  if (byBuilder === undefined) {
    byBuilder = new Map<GradientBuilder, GradientsByKey>();
    gradientCache.set(ctx, byBuilder);
  }
  let byKey = byBuilder.get(build);
  if (byKey === undefined) {
    byKey = new Map<string, CanvasGradient>();
    byBuilder.set(build, byKey);
  }
  let gradient = byKey.get(key);
  if (gradient === undefined) {
    gradient = build(ctx, key);
    byKey.set(key, gradient);
  }
  return gradient;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Maps a 0..1 looping phase to a smooth 0..1..0 wave with no jump at the wrap. */
function pulseWave(phase: number): number {
  return 0.5 - 0.5 * Math.cos(phase * TAU);
}

/** mulberry32: tiny seeded PRNG for deterministic texture noise; floats in [0, 1). */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Adds a rounded-rect subpath. `r` rounds the top corners and `rBottom` the bottom ones;
 * both are clamped to half the rect's shorter side.
 */
function roundRectPath(
  p: CanvasPath,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  rBottom = r,
): void {
  const limit = Math.max(0, Math.min(w, h) / 2);
  const rt = Math.min(r, limit);
  const rb = Math.min(rBottom, limit);
  p.moveTo(x + rt, y);
  p.arcTo(x + w, y, x + w, y + h, rt);
  p.arcTo(x + w, y + h, x, y + h, rb);
  p.arcTo(x, y + h, x, y, rb);
  p.arcTo(x, y, x + w, y, rt);
  p.closePath();
}

/** Adds a circle subpath that is not connected to the previous subpath. */
function addCircle(p: CanvasPath, x: number, y: number, r: number): void {
  p.moveTo(x + r, y);
  p.arc(x, y, r, 0, TAU);
}

/** Unit-radius radial falloff used by softEllipse; `rgb` is an 'r, g, b' triple. */
function buildSoftGradient(ctx: CanvasRenderingContext2D, rgb: string): CanvasGradient {
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, `rgba(${rgb}, 1)`);
  g.addColorStop(0.45, `rgba(${rgb}, 0.6)`);
  g.addColorStop(1, `rgba(${rgb}, 0)`);
  return g;
}

/**
 * Fills an ellipse with a soft radial falloff of `rgb` ('r, g, b') that peaks at `alpha`
 * in the center: ground shadows with 'source-over', light glows with 'lighter'.
 */
function softEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rgb: string,
  alpha: number,
  op: GlobalCompositeOperation,
): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = op;
  ctx.globalAlpha *= alpha;
  ctx.translate(cx, cy);
  ctx.scale(rx, ry);
  ctx.fillStyle = cachedGradient(ctx, buildSoftGradient, rgb);
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/**
 * Draws centered text with a dark halo (stroke first, then fill) at tile position (x, y).
 * Changes text, stroke and fill state; callers own the surrounding save/restore.
 */
function drawHaloText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  fill: string,
  baseline: CanvasTextBaseline,
): void {
  if (text === '') return;
  ctx.scale(1 / TEXT_SCALE, 1 / TEXT_SCALE);
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = baseline;
  ctx.lineJoin = 'round';
  ctx.lineWidth = HALO_WIDTH;
  ctx.strokeStyle = HALO_COLOR;
  ctx.strokeText(text, x * TEXT_SCALE, y * TEXT_SCALE);
  ctx.fillStyle = fill;
  ctx.fillText(text, x * TEXT_SCALE, y * TEXT_SCALE);
  // TEXT_SCALE is a power of two, so this undoes the down-scale exactly.
  ctx.scale(TEXT_SCALE, TEXT_SCALE);
}

// ---- Scientist -----------------------------------------------------------------------

export interface ScientistOpts {
  /** body color, e.g. '#2dd4bf' */
  color: string;
  name: string;
  /** facing angle in radians (0 = right, PI/2 = down) — flip/tilt the visor side */
  facing: number;
  moving: boolean;
  /** walk cycle 0..1, advances only while moving */
  walkPhase: number;
  /** local player: add a subtle white ground ring */
  isYou: boolean;
  /** dim to ~45% alpha when false */
  connected: boolean;
}

// Geometry in tile units, drawn facing right with the origin at the feet center.
const BODY_HALF_W = 0.22;
const BODY_TOP = -0.82;
const DOME_Y = BODY_TOP + BODY_HALF_W;
const BODY_BOTTOM = -0.15;
const BODY_CORNER = 0.09;
const LEG_W = 0.17;
const LEG_TOP = -0.24;
const LEG_X = 0.12;
const OUTLINE_W = 0.035;
const VISOR_FRONT = 0.285;
const VISOR_H = 0.19;
const NAME_Y = BODY_TOP - 0.1;
const NAME_COLOR = '#e8eef4';
// Animation amplitudes (tile units, radians for LEAN).
const STRIDE = 0.06;
const STEP_LIFT = 0.025;
const BOB = 0.025;
const LEAN = 0.06;
const DISCONNECTED_ALPHA = 0.45;

interface BodyColors {
  /** Lit front-top of the body. */
  light: string;
  /** Shaded back-bottom of the body and the rear leg. */
  shade: string;
  /** Backpack: a step darker than the shade so it reads against the body. */
  pack: string;
  /** Darker same-hue outline. */
  outline: string;
}

const bodyColorCache = new Map<string, BodyColors>();

/** Derives (once per color) the shading colors for a scientist body color. */
function bodyColors(color: string): BodyColors {
  let colors = bodyColorCache.get(color);
  if (colors === undefined) {
    const rgb = parseHexColor(color);
    colors = {
      light: mixRgb(rgb, 255, 0.3),
      shade: mixRgb(rgb, 0, 0.3),
      pack: mixRgb(rgb, 0, 0.42),
      outline: mixRgb(rgb, 0, 0.62),
    };
    bodyColorCache.set(color, colors);
  }
  return colors;
}

/**
 * Parses '#rgb' or '#rrggbb'.
 *
 * @throws Error for any other format, naming the accepted ones.
 */
function parseHexColor(color: string): Rgb {
  if (!/^#(?:[0-9a-f]{3}){1,2}$/i.test(color)) {
    throw new Error(
      `art: scientist color "${color}" must be '#rgb' or '#rrggbb', e.g. '#2dd4bf'.`,
    );
  }
  // '#abc' -> '#aabbcc'
  const hex = color.length === 4 ? color.replace(/[0-9a-f]/gi, '$&$&') : color;
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mixes `rgb` toward the grey `level` (0 black .. 255 white) by `t`; returns '#rrggbb'. */
function mixRgb(rgb: Rgb, level: number, t: number): string {
  let hex = '#';
  for (const c of rgb) {
    hex += Math.round(c + (level - c) * t).toString(16).padStart(2, '0');
  }
  return hex;
}

interface ScientistPaths {
  body: Path2D;
  /** Centered on x = 0, standing on y = 0. */
  leg: Path2D;
  pack: Path2D;
}

let scientistPaths: ScientistPaths | null = null;

/** Static scientist outlines, built on first use so importing the module needs no DOM. */
function getScientistPaths(): ScientistPaths {
  if (scientistPaths !== null) return scientistPaths;
  const x = BODY_HALF_W;
  const body = new Path2D();
  body.moveTo(-x, DOME_Y);
  body.arc(0, DOME_Y, x, Math.PI, 0);
  body.lineTo(x, BODY_BOTTOM - BODY_CORNER);
  body.quadraticCurveTo(x, BODY_BOTTOM, x - BODY_CORNER, BODY_BOTTOM);
  body.lineTo(-x + BODY_CORNER, BODY_BOTTOM);
  body.quadraticCurveTo(-x, BODY_BOTTOM, -x, BODY_BOTTOM - BODY_CORNER);
  body.closePath();
  const leg = new Path2D();
  roundRectPath(leg, -LEG_W / 2, LEG_TOP, LEG_W, -LEG_TOP, 0.06);
  const pack = new Path2D();
  roundRectPath(pack, -0.285, -0.62, 0.13, 0.32, 0.05);
  scientistPaths = { body, leg, pack };
  return scientistPaths;
}

/** Body fill: lit front-top fading to the shaded back-bottom (facing-right space). */
function buildBodyGradient(ctx: CanvasRenderingContext2D, color: string): CanvasGradient {
  const colors = bodyColors(color);
  const g = ctx.createLinearGradient(0.16, -0.8, -0.24, -0.15);
  g.addColorStop(0, colors.light);
  g.addColorStop(0.45, color);
  g.addColorStop(1, colors.shade);
  return g;
}

/** Dark glass, slightly lighter at the top where it reflects the ceiling. */
function buildVisorGradient(ctx: CanvasRenderingContext2D): CanvasGradient {
  const g = ctx.createLinearGradient(0, -VISOR_H / 2, 0, VISOR_H / 2);
  g.addColorStop(0, '#3f5c6e');
  g.addColorStop(0.45, '#1a2a35');
  g.addColorStop(1, '#0a1218');
  return g;
}

function strokePathAt(ctx: CanvasRenderingContext2D, path: Path2D, x: number, y: number): void {
  ctx.translate(x, y);
  ctx.stroke(path);
  ctx.translate(-x, -y);
}

function fillPathAt(ctx: CanvasRenderingContext2D, path: Path2D, x: number, y: number): void {
  ctx.translate(x, y);
  ctx.fill(path);
  ctx.translate(-x, -y);
}

/** Soft specular arc across the top of the dome. */
function drawBodyHighlight(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.arc(0, DOME_Y, BODY_HALF_W - 0.065, -2.25, -1.25);
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.035;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.24)';
  ctx.stroke();
}

/**
 * Visor on the facing (+x) side. Facing the camera (down) widens and lowers it; facing
 * away (up) narrows and raises it, hinting at the vertical part of `facing`.
 */
function drawVisor(ctx: CanvasRenderingContext2D, facing: number, outline: string): void {
  const s = Math.sin(facing);
  const w = 0.3 + 0.05 * Math.max(0, s) - 0.1 * Math.max(0, -s);
  const cy = DOME_Y + 0.02 + 0.025 * s;
  const r = VISOR_H / 2;
  // Visor-local space: front edge at x = 0, vertical center at y = 0.
  ctx.translate(VISOR_FRONT, cy);
  ctx.beginPath();
  roundRectPath(ctx, -w, -r, w, VISOR_H, r);
  ctx.lineWidth = OUTLINE_W * 2;
  ctx.strokeStyle = outline;
  ctx.stroke();
  ctx.fillStyle = cachedGradient(ctx, buildVisorGradient, '');
  ctx.fill();
  // Teal lab light reflected along the lower rim.
  ctx.beginPath();
  ctx.moveTo(-w + r, r - 0.04);
  ctx.lineTo(-r, r - 0.04);
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.018;
  ctx.strokeStyle = 'rgba(45, 212, 191, 0.3)';
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(-0.09, -0.042, 0.06, 0.024, -0.12, 0, TAU);
  addCircle(ctx, -0.165, -0.045, 0.013);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.fill();
  ctx.translate(-VISOR_FRONT, -cy);
}

/**
 * Legs, backpack, body and visor. Mirrors the figure for left-facing and leans it while
 * moving; leaves the transform changed, so callers wrap it in save/restore.
 */
function drawScientistFigure(
  ctx: CanvasRenderingContext2D,
  o: ScientistOpts,
  colors: BodyColors,
  theta: number,
  bob: number,
): void {
  const paths = getScientistPaths();
  const swing = o.moving ? Math.sin(theta) * STRIDE : 0;
  // Positive while the front leg swings forward (lifted), negative while the rear one does.
  const lift = o.moving ? Math.cos(theta) * STEP_LIFT : 0;
  const frontX = LEG_X + swing;
  const frontY = -Math.max(0, lift);
  const backX = -LEG_X - swing;
  const backY = -Math.max(0, -lift);
  ctx.scale(Math.cos(o.facing) < 0 ? -1 : 1, 1);
  if (o.moving) ctx.rotate(LEAN);
  ctx.lineJoin = 'round';
  // Outline pass at twice the outline width; the fill pass covers the inner half, leaving
  // one continuous outline around the union of legs, backpack and body.
  ctx.lineWidth = OUTLINE_W * 2;
  ctx.strokeStyle = colors.outline;
  strokePathAt(ctx, paths.leg, backX, backY);
  strokePathAt(ctx, paths.leg, frontX, frontY);
  strokePathAt(ctx, paths.pack, 0, bob);
  strokePathAt(ctx, paths.body, 0, bob);
  ctx.fillStyle = colors.shade;
  fillPathAt(ctx, paths.leg, backX, backY);
  ctx.fillStyle = o.color;
  fillPathAt(ctx, paths.leg, frontX, frontY);
  ctx.translate(0, bob);
  ctx.fillStyle = colors.pack;
  ctx.fill(paths.pack);
  ctx.fillStyle = cachedGradient(ctx, buildBodyGradient, o.color);
  ctx.fill(paths.body);
  drawBodyHighlight(ctx);
  drawVisor(ctx, o.facing, colors.outline);
}

function drawYouRing(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.37, 0.135, 0, 0, TAU);
  ctx.lineWidth = 0.025;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.stroke();
}

/** Anchor: FEET CENTER. Body ~0.62 tile wide, ~0.85 tile tall. */
export function drawScientist(ctx: CanvasRenderingContext2D, o: ScientistOpts): void {
  // Resolved first so an invalid color throws before anything is drawn.
  const colors = bodyColors(o.color);
  ctx.save();
  try {
    if (!o.connected) ctx.globalAlpha *= DISCONNECTED_ALPHA;
    const theta = o.walkPhase * TAU;
    // The body is highest while the legs pass each other and back down at full stride.
    const bob = o.moving ? -Math.abs(Math.cos(theta)) * BOB : 0;
    // bob <= 0: a raised body casts a slightly smaller shadow.
    softEllipse(ctx, 0, 0, 0.3 + bob, 0.1 + bob / 3, SHADOW_RGB, 0.35, 'source-over');
    if (o.isYou) drawYouRing(ctx);
    ctx.save();
    drawScientistFigure(ctx, o, colors, theta, bob);
    ctx.restore();
    drawHaloText(ctx, o.name, 0, NAME_Y, FONT_HEADING, NAME_COLOR, 'bottom');
  } finally {
    ctx.restore();
  }
}

// ---- Floor and wall textures ---------------------------------------------------------

const TEX_SIZE = 64;
/** Height in px of the wall's lit top cap. */
const WALL_CAP = 10;

function createTextureCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_SIZE;
  canvas.height = TEX_SIZE;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('art: canvas.getContext("2d") returned null; cannot build a texture.');
  }
  return [canvas, ctx];
}

/** Adds grey noise of +-amp levels (slightly stronger on blue) to the whole texture. */
function addNoise(ctx: CanvasRenderingContext2D, rand: () => number, amp: number): void {
  const image = ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() * 2 - 1) * amp;
    d[i] = (d[i] ?? 0) + n;
    d[i + 1] = (d[i + 1] ?? 0) + n;
    d[i + 2] = (d[i + 2] ?? 0) + n * 1.2;
  }
  ctx.putImageData(image, 0, 0);
}

/** 2x2 px rivet with a light top-left and a dark bottom-right edge. */
function drawRivet(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.fillRect(x + 1, y + 1, 2, 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.fillRect(x, y, 2, 2);
}

/**
 * One square floor panel. Its seam groove sits on the top and left edges and its shadow
 * on the bottom and right, so tiled panels form continuous bevelled seams.
 */
function drawFloorPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  rand: () => number,
): void {
  const v = (rand() - 0.5) * 0.03;
  ctx.fillStyle = v >= 0 ? `rgba(255, 255, 255, ${v})` : `rgba(0, 0, 0, ${-2 * v})`;
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = '#080b10';
  ctx.fillRect(x, y, size, 1);
  ctx.fillRect(x, y, 1, size);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
  ctx.fillRect(x + 1, y + 1, size - 1, 1);
  ctx.fillRect(x + 1, y + 1, 1, size - 1);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.fillRect(x + 1, y + size - 1, size - 1, 1);
  ctx.fillRect(x + size - 1, y + 1, 1, size - 1);
  const near = 4;
  const far = size - 7;
  drawRivet(ctx, x + near, y + near);
  drawRivet(ctx, x + far, y + near);
  drawRivet(ctx, x + near, y + far);
  drawRivet(ctx, x + far, y + far);
}

/** 64x64 px tile texture for lab floor: very dark blue-grey panels, subtle seams/variation. */
export function makeFloorTile(): HTMLCanvasElement {
  const [canvas, ctx] = createTextureCanvas();
  const rand = seededRandom(0xf1004);
  ctx.fillStyle = '#0f151c';
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  const half = TEX_SIZE / 2;
  for (let y = 0; y < TEX_SIZE; y += half) {
    for (let x = 0; x < TEX_SIZE; x += half) drawFloorPanel(ctx, x, y, half, rand);
  }
  addNoise(ctx, rand, 2.2);
  return canvas;
}

/** Full-width horizontal streaks, so the brushed look tiles seamlessly left-right. */
function drawBrushedStreaks(ctx: CanvasRenderingContext2D, rand: () => number): void {
  for (let i = 0; i < 22; i++) {
    const y = Math.floor(rand() * TEX_SIZE);
    const a = (0.015 + rand() * 0.03).toFixed(3);
    ctx.fillStyle = rand() < 0.5 ? `rgba(255, 255, 255, ${a})` : `rgba(0, 0, 0, ${a})`;
    ctx.fillRect(0, y, TEX_SIZE, 1);
  }
}

/** Lit top cap of the wall (the pseudo-3D hint) and the lip shadow below it. */
function drawWallCap(ctx: CanvasRenderingContext2D): void {
  const cap = ctx.createLinearGradient(0, 0, 0, WALL_CAP);
  cap.addColorStop(0, '#26303c');
  cap.addColorStop(1, '#19212a');
  ctx.fillStyle = cap;
  ctx.fillRect(0, 0, TEX_SIZE, WALL_CAP);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.09)';
  ctx.fillRect(0, 0, TEX_SIZE, 1);
  ctx.fillStyle = '#05070a';
  ctx.fillRect(0, WALL_CAP, TEX_SIZE, 1);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.fillRect(0, WALL_CAP + 1, TEX_SIZE, 2);
}

/** 64x64 px wall texture: darker metallic with a lighter top edge (pseudo-3D hint). */
export function makeWallTile(): HTMLCanvasElement {
  const [canvas, ctx] = createTextureCanvas();
  const rand = seededRandom(0x3a115eed);
  const face = ctx.createLinearGradient(0, 0, 0, TEX_SIZE);
  face.addColorStop(0, '#131a22');
  face.addColorStop(1, '#080b10');
  ctx.fillStyle = face;
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  drawBrushedStreaks(ctx, rand);
  // Seams: a vertical one on the tile edge and a horizontal one across the face.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(0, WALL_CAP, 1, TEX_SIZE - WALL_CAP);
  ctx.fillRect(0, 38, TEX_SIZE, 1);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.fillRect(1, WALL_CAP, 1, TEX_SIZE - WALL_CAP);
  ctx.fillRect(0, 39, TEX_SIZE, 1);
  drawRivet(ctx, 5, 17);
  drawRivet(ctx, 56, 17);
  drawRivet(ctx, 5, 45);
  drawRivet(ctx, 56, 45);
  // Dark foot where the wall meets the floor.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fillRect(0, TEX_SIZE - 2, TEX_SIZE, 2);
  drawWallCap(ctx);
  addNoise(ctx, rand, 1.6);
  return canvas;
}

// ---- Station -------------------------------------------------------------------------

export interface StationOpts {
  status: 'done' | 'armed' | 'locked';
  /** 0..1 looping pulse driven by the caller */
  pulse: number;
  /** drawn over an armed station; over a console of a two-console station it names the console */
  title: string;
  /** which console of a two-console station this is, lettered on it; null at a station with one */
  console: ConsoleId | null;
}

type StationStatus = StationOpts['status'];

interface StationLook {
  deskTop: string;
  deskFront: string;
  bezel: string;
  /** Top color of the screen gradient; doubles as its cache key. */
  screen: string;
  keys: string;
  /** Status LEDs, and the disc a console's letter sits on. */
  led: string;
  /** A console's letter on the LED-colored disc. */
  badgeInk: string;
}

const STATION_LOOKS: Readonly<Record<StationStatus, StationLook>> = {
  armed: {
    deskTop: '#1e2630',
    deskFront: '#131920',
    bezel: '#0f141a',
    screen: '#0e4943',
    keys: 'rgba(45, 212, 191, 0.32)',
    led: TEAL,
    badgeInk: PROP_EDGE,
  },
  done: {
    deskTop: '#1e2630',
    deskFront: '#131920',
    bezel: '#0f141a',
    screen: '#0d2c1b',
    keys: 'rgba(74, 222, 128, 0.16)',
    led: '#4ade80',
    badgeInk: PROP_EDGE,
  },
  locked: {
    deskTop: '#202328',
    deskFront: '#15171b',
    bezel: '#111316',
    screen: '#181b1f',
    keys: 'rgba(255, 255, 255, 0.06)',
    led: '#3f444b',
    badgeInk: IDLE_LABEL,
  },
};

/** A console's letter, on a disc over the monitor's top-right corner. */
const CONSOLE_LETTERS: Readonly<Record<ConsoleId, string>> = { a: 'A', b: 'B' };
const BADGE_X = 0.31;
const BADGE_Y = -0.37;
const BADGE_R = 0.12;

const SCREEN_X = -0.27;
const SCREEN_Y = -0.39;
const SCREEN_W = 0.54;
const SCREEN_H = 0.32;
const SCREEN_R = 0.03;
const SCREEN_CY = SCREEN_Y + SCREEN_H / 2;
const LOCK_GREY = '#6b7280';

function buildScreenGradient(ctx: CanvasRenderingContext2D, top: string): CanvasGradient {
  const g = ctx.createLinearGradient(0, SCREEN_Y, 0, SCREEN_Y + SCREEN_H);
  g.addColorStop(0, top);
  g.addColorStop(1, '#05080b');
  return g;
}

function drawStationGlow(
  ctx: CanvasRenderingContext2D,
  status: StationStatus,
  wave: number,
): void {
  if (status === 'armed') {
    softEllipse(ctx, 0, SCREEN_CY, 0.9, 0.8, TEAL_RGB, 0.18 + 0.32 * wave, 'lighter');
  } else if (status === 'done') {
    softEllipse(ctx, 0, SCREEN_CY, 0.6, 0.55, GREEN_RGB, 0.1, 'lighter');
  }
}

function drawStationKeyboard(ctx: CanvasRenderingContext2D, keys: string): void {
  ctx.fillStyle = '#0a0e13';
  ctx.beginPath();
  roundRectPath(ctx, -0.26, 0.03, 0.52, 0.11, 0.02);
  ctx.fill();
  ctx.fillStyle = keys;
  for (let i = 0; i < 7; i++) {
    const x = -0.235 + i * 0.068;
    ctx.fillRect(x, 0.046, 0.05, 0.028);
    ctx.fillRect(x, 0.09, 0.05, 0.028);
  }
}

/** Desk with keyboard, status LEDs and vents; the monitor is drawn over its back edge. */
function drawStationCabinet(
  ctx: CanvasRenderingContext2D,
  look: StationLook,
  ledAlpha: number,
): void {
  ctx.fillStyle = look.deskTop;
  ctx.beginPath();
  roundRectPath(ctx, -0.38, -0.12, 0.76, 0.3, 0.06, 0);
  ctx.fill();
  ctx.fillStyle = look.deskFront;
  ctx.beginPath();
  roundRectPath(ctx, -0.38, 0.18, 0.76, 0.22, 0, 0.06);
  ctx.fill();
  ctx.beginPath();
  roundRectPath(ctx, -0.38, -0.12, 0.76, 0.52, 0.06);
  ctx.lineWidth = 0.025;
  ctx.strokeStyle = PROP_EDGE;
  ctx.stroke();
  // Light catching the desk's back edge and its front crease.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.fillRect(-0.32, -0.105, 0.64, 0.012);
  ctx.fillRect(-0.36, 0.17, 0.72, 0.012);
  drawStationKeyboard(ctx, look.keys);
  const alpha = ctx.globalAlpha;
  ctx.globalAlpha = alpha * ledAlpha;
  ctx.fillStyle = look.led;
  ctx.beginPath();
  addCircle(ctx, -0.27, 0.29, 0.022);
  addCircle(ctx, -0.2, 0.29, 0.022);
  addCircle(ctx, -0.13, 0.29, 0.022);
  ctx.fill();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  for (let i = 0; i < 3; i++) ctx.fillRect(0.06, 0.245 + i * 0.04, 0.24, 0.016);
}

function drawStationMonitor(ctx: CanvasRenderingContext2D, look: StationLook): void {
  ctx.fillStyle = '#0a0d11';
  ctx.fillRect(-0.06, -0.02, 0.12, 0.06);
  ctx.beginPath();
  roundRectPath(ctx, -0.33, -0.45, 0.66, 0.44, 0.05);
  ctx.fillStyle = look.bezel;
  ctx.fill();
  ctx.lineWidth = 0.025;
  ctx.strokeStyle = PROP_EDGE;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.fillRect(-0.28, -0.44, 0.56, 0.012);
  ctx.beginPath();
  roundRectPath(ctx, SCREEN_X, SCREEN_Y, SCREEN_W, SCREEN_H, SCREEN_R);
  ctx.fillStyle = cachedGradient(ctx, buildScreenGradient, look.screen);
  ctx.fill();
}

/** Teal screen tint and rim that follow the pulse, plus terminal lines with a cursor. */
function drawArmedScreen(ctx: CanvasRenderingContext2D, wave: number): void {
  const alpha = ctx.globalAlpha;
  ctx.beginPath();
  roundRectPath(ctx, SCREEN_X, SCREEN_Y, SCREEN_W, SCREEN_H, SCREEN_R);
  ctx.fillStyle = TEAL;
  ctx.strokeStyle = TEAL;
  ctx.lineWidth = 0.016;
  ctx.globalAlpha = alpha * (0.06 + 0.1 * wave);
  ctx.fill();
  ctx.globalAlpha = alpha * (0.35 + 0.45 * wave);
  ctx.stroke();
  const x = SCREEN_X + 0.05;
  ctx.globalAlpha = alpha * 0.7;
  ctx.fillRect(x, SCREEN_Y + 0.06, 0.3, 0.028);
  ctx.fillRect(x, SCREEN_Y + 0.115, 0.4, 0.028);
  ctx.fillRect(x, SCREEN_Y + 0.17, 0.24, 0.028);
  ctx.fillRect(x, SCREEN_Y + 0.225, 0.12, 0.028);
  ctx.globalAlpha = alpha * wave;
  ctx.fillRect(x + 0.15, SCREEN_Y + 0.225, 0.04, 0.028);
  ctx.globalAlpha = alpha;
}

function drawCheckGlyph(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(-0.1, SCREEN_CY + 0.005);
  ctx.lineTo(-0.03, SCREEN_CY + 0.075);
  ctx.lineTo(0.11, SCREEN_CY - 0.075);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 0.045;
  ctx.strokeStyle = 'rgba(74, 222, 128, 0.7)';
  ctx.stroke();
}

function drawLockGlyph(ctx: CanvasRenderingContext2D): void {
  const cy = SCREEN_CY - 0.008;
  ctx.beginPath();
  ctx.moveTo(-0.042, cy);
  ctx.arc(0, cy - 0.03, 0.042, Math.PI, 0);
  ctx.lineTo(0.042, cy);
  ctx.lineWidth = 0.026;
  ctx.strokeStyle = LOCK_GREY;
  ctx.stroke();
  ctx.beginPath();
  roundRectPath(ctx, -0.075, cy - 0.01, 0.15, 0.11, 0.02);
  ctx.fillStyle = LOCK_GREY;
  ctx.fill();
  ctx.beginPath();
  addCircle(ctx, 0, cy + 0.035, 0.016);
  ctx.rect(-0.007, cy + 0.04, 0.014, 0.032);
  ctx.fillStyle = '#16191d';
  ctx.fill();
}

function drawStationScreen(
  ctx: CanvasRenderingContext2D,
  status: StationStatus,
  wave: number,
): void {
  if (status === 'armed') drawArmedScreen(ctx, wave);
  else if (status === 'done') drawCheckGlyph(ctx);
  else drawLockGlyph(ctx);
  // Faint glass glare in the upper-left corner.
  ctx.beginPath();
  ctx.moveTo(SCREEN_X + 0.03, SCREEN_Y + 0.015);
  ctx.lineTo(SCREEN_X + 0.26, SCREEN_Y + 0.015);
  ctx.lineTo(SCREEN_X + 0.03, SCREEN_Y + 0.21);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.fill();
}

/** One console of a two-console station: its letter on a disc in the status color. */
function drawConsoleBadge(ctx: CanvasRenderingContext2D, look: StationLook, id: ConsoleId): void {
  ctx.beginPath();
  addCircle(ctx, BADGE_X, BADGE_Y, BADGE_R);
  ctx.fillStyle = look.led;
  ctx.fill();
  ctx.lineWidth = 0.025;
  ctx.strokeStyle = PROP_EDGE;
  ctx.stroke();
  ctx.scale(1 / TEXT_SCALE, 1 / TEXT_SCALE);
  ctx.font = FONT_BADGE;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = look.badgeInk;
  ctx.fillText(CONSOLE_LETTERS[id], BADGE_X * TEXT_SCALE, BADGE_Y * TEXT_SCALE);
  ctx.scale(TEXT_SCALE, TEXT_SCALE);
}

/** Anchor: TILE CENTER. A small console/terminal with glowing screen; armed = teal glow
 * (strength follows pulse) + title text above (0.26 tile mono, dark halo); done = dim
 * green check on screen; locked = grey, small lock glyph. A console of a two-console
 * station carries its letter on a disc, whatever its status. */
export function drawStation(ctx: CanvasRenderingContext2D, o: StationOpts): void {
  const look = STATION_LOOKS[o.status];
  const armed = o.status === 'armed';
  const wave = pulseWave(o.pulse);
  ctx.save();
  try {
    softEllipse(ctx, 0, 0.37, 0.46, 0.13, SHADOW_RGB, 0.45, 'source-over');
    drawStationGlow(ctx, o.status, wave);
    drawStationCabinet(ctx, look, armed ? 0.35 + 0.65 * wave : 0.85);
    drawStationMonitor(ctx, look);
    drawStationScreen(ctx, o.status, wave);
    if (o.console !== null) drawConsoleBadge(ctx, look, o.console);
    if (armed) drawHaloText(ctx, o.title, 0, -0.5, FONT_HEADING, '#99f6e4', 'bottom');
  } finally {
    ctx.restore();
  }
}

// ---- Pressure plate ------------------------------------------------------------------

export interface PlateOpts {
  pressed: boolean;
  label: string;
  /** holding it freezes a drone: a camera glyph replaces the center indicator */
  camera: boolean;
}

const PLATE_SOCKET_R = 0.38;
const PLATE_RIM_R = 0.335;
const PLATE_BOLT = 0.18;

/** Recess walls: shadowed at the top, catching light at the bottom. */
function buildSocketGradient(ctx: CanvasRenderingContext2D): CanvasGradient {
  const g = ctx.createLinearGradient(0, -PLATE_SOCKET_R, 0, PLATE_SOCKET_R);
  g.addColorStop(0, '#030508');
  g.addColorStop(1, '#131a22');
  return g;
}

/** Metal top face lit from the upper left; coordinates relative to the disc center. */
function buildDiscGradient(ctx: CanvasRenderingContext2D): CanvasGradient {
  const g = ctx.createRadialGradient(-0.1, -0.12, 0.02, 0, 0, 0.32);
  g.addColorStop(0, '#46525f');
  g.addColorStop(0.5, '#2a333e');
  g.addColorStop(1, '#1a2029');
  return g;
}

function drawPlateSocket(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.arc(0, 0, PLATE_SOCKET_R, 0, TAU);
  ctx.fillStyle = cachedGradient(ctx, buildSocketGradient, '');
  ctx.fill();
  ctx.lineWidth = 0.02;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.stroke();
}

/** Camera body with viewfinder bump and lens, lit teal while pressed. */
function drawCameraGlyph(ctx: CanvasRenderingContext2D, pressed: boolean): void {
  const color = pressed ? TEAL : IDLE_LABEL;
  ctx.beginPath();
  roundRectPath(ctx, -0.095, -0.05, 0.19, 0.115, 0.022);
  ctx.rect(-0.04, -0.078, 0.08, 0.03);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 0.012;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0.008, 0.036, 0, TAU);
  ctx.fillStyle = '#151b22';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0.008, 0.016, 0, TAU);
  ctx.fillStyle = color;
  ctx.fill();
}

/** Engraved ring, four bolts and the center indicator (lit teal while pressed) or camera. */
function drawPlateEngraving(
  ctx: CanvasRenderingContext2D,
  pressed: boolean,
  camera: boolean,
): void {
  ctx.beginPath();
  ctx.arc(0, 0, 0.2, 0, TAU);
  ctx.lineWidth = 0.018;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0.009, 0.2, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.lineWidth = 0.008;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.stroke();
  ctx.beginPath();
  addCircle(ctx, -PLATE_BOLT, -PLATE_BOLT, 0.018);
  addCircle(ctx, PLATE_BOLT, -PLATE_BOLT, 0.018);
  addCircle(ctx, -PLATE_BOLT, PLATE_BOLT, 0.018);
  addCircle(ctx, PLATE_BOLT, PLATE_BOLT, 0.018);
  ctx.fillStyle = '#4a5562';
  ctx.fill();
  if (camera) {
    drawCameraGlyph(ctx, pressed);
    return;
  }
  ctx.beginPath();
  ctx.arc(0, 0, 0.065, 0, TAU);
  ctx.fillStyle = pressed ? TEAL : '#151b22';
  ctx.fill();
  ctx.lineWidth = 0.014;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.stroke();
}

/** The disc stands proud of the floor (thick side wall) or sinks in when pressed. */
function drawPlateDisc(ctx: CanvasRenderingContext2D, pressed: boolean, camera: boolean): void {
  const r = pressed ? 0.295 : 0.31;
  const cy = pressed ? 0.012 : -0.016;
  const side = pressed ? 0.008 : 0.03;
  ctx.beginPath();
  ctx.arc(0, cy + side, r, 0, TAU);
  ctx.fillStyle = '#0a0e13';
  ctx.fill();
  ctx.translate(0, cy);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fillStyle = cachedGradient(ctx, buildDiscGradient, '');
  ctx.fill();
  if (pressed) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fill();
  }
  ctx.lineWidth = 0.014;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.stroke();
  drawPlateEngraving(ctx, pressed, camera);
  ctx.translate(0, -cy);
}

/** Anchor: TILE CENTER. Floor pressure plate: inset metal disc, pressed = sunk + teal rim
 * glow, label under it (0.2 tile mono, dark halo, uppercase); a camera plate shows a camera
 * glyph in the middle. */
export function drawPlate(ctx: CanvasRenderingContext2D, o: PlateOpts): void {
  ctx.save();
  try {
    drawPlateSocket(ctx);
    if (o.pressed) softEllipse(ctx, 0, 0, 0.6, 0.6, TEAL_RGB, 0.45, 'lighter');
    drawPlateDisc(ctx, o.pressed, o.camera);
    if (o.pressed) {
      ctx.beginPath();
      ctx.arc(0, 0.006, PLATE_RIM_R, 0, TAU);
      ctx.lineWidth = 0.024;
      ctx.strokeStyle = 'rgba(45, 212, 191, 0.9)';
      ctx.stroke();
    }
    const color = o.pressed ? '#5eead4' : IDLE_LABEL;
    drawHaloText(ctx, o.label.toUpperCase(), 0, 0.41, FONT_LABEL, color, 'top');
  } finally {
    ctx.restore();
  }
}

// ---- Door ----------------------------------------------------------------------------

export interface DoorOpts {
  /** 0 = fully closed, 1 = fully open; caller animates */
  openT: number;
  /** true: the door bar runs horizontally (wall gap left-right) */
  horizontal: boolean;
}

/** Half the thickness of the door slab across the wall line. */
const DOOR_HALF_T = 0.17;
const DOOR_PANEL_W = 0.5;
const JAMB_W = 0.07;

/** Panel metal: lit top edge (pseudo-3D) fading to a dark bottom. */
function buildDoorPanelGradient(ctx: CanvasRenderingContext2D): CanvasGradient {
  const g = ctx.createLinearGradient(0, -DOOR_HALF_T, 0, DOOR_HALF_T);
  g.addColorStop(0, '#36404c');
  g.addColorStop(0.12, '#252d37');
  g.addColorStop(1, '#141920');
  return g;
}

function buildJambGradient(ctx: CanvasRenderingContext2D): CanvasGradient {
  const g = ctx.createLinearGradient(0, -0.24, 0, 0.24);
  g.addColorStop(0, '#3a4553');
  g.addColorStop(0.08, '#222a34');
  g.addColorStop(1, '#10151b');
  return g;
}

/** Dark floor slot the panels run in; stays visible when the door is open. */
function drawDoorTrack(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#05070a';
  ctx.fillRect(-0.5, -0.2, 1, 0.4);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.fillRect(-0.5, 0.188, 1, 0.012);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(-0.5, -0.02, 1, 0.04);
}

/** Adds a chevron pointing toward +x (the seam, for the left panel). */
function addChevron(p: CanvasPath, x: number): void {
  p.moveTo(x - 0.03, -0.07);
  p.lineTo(x + 0.03, 0);
  p.lineTo(x - 0.03, 0.07);
}

/** Left panel with its leading (seam) edge at x = -slide. */
function drawDoorPanel(ctx: CanvasRenderingContext2D, slide: number): void {
  const edge = -slide;
  const x0 = edge - DOOR_PANEL_W;
  ctx.fillStyle = cachedGradient(ctx, buildDoorPanelGradient, '');
  ctx.fillRect(x0, -DOOR_HALF_T, DOOR_PANEL_W, 2 * DOOR_HALF_T);
  ctx.lineWidth = 0.02;
  ctx.strokeStyle = PROP_EDGE;
  ctx.strokeRect(x0, -DOOR_HALF_T, DOOR_PANEL_W, 2 * DOOR_HALF_T);
  ctx.beginPath();
  addChevron(ctx, edge - 0.31);
  addChevron(ctx, edge - 0.21);
  ctx.lineWidth = 0.03;
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.5)';
  ctx.stroke();
  // Amber light strip along the leading edge, with a faint halo.
  ctx.fillStyle = 'rgba(251, 191, 36, 0.16)';
  ctx.fillRect(edge - 0.12, -0.135, 0.09, 0.27);
  ctx.fillStyle = AMBER;
  ctx.fillRect(edge - 0.09, -0.115, 0.03, 0.23);
}

/** Both panels, clipped to the tile so the parts that slid into the walls disappear. */
function drawDoorPanels(ctx: CanvasRenderingContext2D, slide: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(-0.5, -0.5, 1, 1);
  ctx.clip();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  drawDoorPanel(ctx, slide);
  ctx.scale(-1, 1);
  drawDoorPanel(ctx, slide);
  ctx.restore();
}

/** Wall-side frame block the panels retract under. */
function drawDoorJamb(ctx: CanvasRenderingContext2D, x: number): void {
  ctx.fillStyle = cachedGradient(ctx, buildJambGradient, '');
  ctx.fillRect(x, -0.24, JAMB_W, 0.48);
  ctx.lineWidth = 0.016;
  ctx.strokeStyle = PROP_EDGE;
  ctx.strokeRect(x, -0.24, JAMB_W, 0.48);
}

/** Anchor: TILE CENTER. Two amber-lit sliding panels that retract into the walls as
 * openT rises; closed shows a faint warning glow. */
export function drawDoor(ctx: CanvasRenderingContext2D, o: DoorOpts): void {
  const t = clamp01(o.openT);
  ctx.save();
  try {
    // The art is drawn for a horizontal bar; a vertical door is the same art transposed
    // (x <-> y), which turns the panels' lit top edge into a lit left edge.
    if (!o.horizontal) ctx.transform(0, 1, 1, 0, 0, 0);
    drawDoorTrack(ctx);
    softEllipse(ctx, 0, 0, 0.62, 0.48, AMBER_RGB, 0.26 * (1 - t), 'lighter');
    if (t < 1) drawDoorPanels(ctx, t * DOOR_PANEL_W);
    drawDoorJamb(ctx, -0.5);
    drawDoorJamb(ctx, 0.5 - JAMB_W);
  } finally {
    ctx.restore();
  }
}

// ---- Manual objects ------------------------------------------------------------------

export interface ManualObjectOpts {
  kind: ManualKind;
  label: string;
  /** covers the armed station: blue glow, strength follows pulse */
  active: boolean;
  /** a locker searched, a cabinet unlocked; everything else is always open */
  opened: boolean;
  /** 0..1 looping pulse driven by the caller */
  pulse: number;
}

const READ_LABEL = '#93c5fd';
/** Lengths of the lines of print on a page, top to bottom. */
const PRINT = [0.2, 0.17, 0.21, 0.12, 0.19] as const;
const PAPER = '#d6cdb4';
const PAPER_PRINT = 'rgba(52, 44, 30, 0.5)';
/** Laid over the paper of a manual object that is not needed right now. */
const PAPER_DIM = 'rgba(0, 0, 0, 0.3)';
const PLAN_X = -0.21;
const PLAN_Y = -0.35;
const PLAN_W = 0.42;
const PLAN_H = 0.28;
/** The route on the terminal's plan, as x, y pairs. */
const PLAN_ROUTE = [-0.15, -0.3, -0.15, -0.21, 0.01, -0.21, 0.01, -0.13, 0.15, -0.13] as const;

/** Adds one page of the open book; `side` -1 is left of the spine, 1 right of it. */
function addPage(p: CanvasPath, side: number): void {
  p.moveTo(side * 0.01, -0.235);
  p.quadraticCurveTo(side * 0.14, -0.27, side * 0.275, -0.25);
  p.lineTo(side * 0.31, 0.02);
  p.quadraticCurveTo(side * 0.15, -0.005, side * 0.01, 0.015);
  p.closePath();
}

/** Cover, pages with print, the crease and a ribbon; dimmed paper when not needed now. */
function drawOpenBook(ctx: CanvasRenderingContext2D, active: boolean): void {
  ctx.beginPath();
  ctx.moveTo(-0.3, -0.27);
  ctx.lineTo(0.3, -0.27);
  ctx.lineTo(0.34, 0.045);
  ctx.lineTo(-0.34, 0.045);
  ctx.closePath();
  ctx.fillStyle = '#1e3a5f';
  ctx.fill();
  ctx.beginPath();
  addPage(ctx, -1);
  addPage(ctx, 1);
  ctx.fillStyle = PAPER;
  ctx.fill();
  if (!active) {
    ctx.fillStyle = PAPER_DIM;
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(60, 50, 30, 0.22)';
  ctx.fillRect(-0.04, -0.24, 0.08, 0.255);
  ctx.beginPath();
  for (let i = 0; i < PRINT.length; i++) {
    const y = -0.2 + i * 0.043;
    ctx.moveTo(-0.05 - (PRINT[i] ?? 0), y);
    ctx.lineTo(-0.05, y);
    ctx.moveTo(0.05, y);
    ctx.lineTo(0.05 + (PRINT[PRINT.length - 1 - i] ?? 0), y);
  }
  ctx.moveTo(0, -0.24);
  ctx.lineTo(0, 0.015);
  ctx.lineWidth = 0.011;
  ctx.strokeStyle = PAPER_PRINT;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0.07, 0.01);
  ctx.lineTo(0.1, 0.01);
  ctx.lineTo(0.1, 0.125);
  ctx.lineTo(0.085, 0.105);
  ctx.lineTo(0.07, 0.125);
  ctx.closePath();
  ctx.fillStyle = '#c2410c';
  ctx.fill();
}

/** Foot, column and a slanted desk with a lip, the open book on top. */
function drawLectern(ctx: CanvasRenderingContext2D, active: boolean): void {
  ctx.beginPath();
  roundRectPath(ctx, -0.17, 0.27, 0.34, 0.09, 0.04);
  ctx.fillStyle = '#141a21';
  ctx.fill();
  ctx.fillStyle = '#1b232c';
  ctx.fillRect(-0.05, 0.04, 0.1, 0.25);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.fillRect(-0.05, 0.04, 0.018, 0.25);
  ctx.beginPath();
  ctx.moveTo(-0.33, -0.3);
  ctx.lineTo(0.33, -0.3);
  ctx.lineTo(0.39, 0.07);
  ctx.lineTo(-0.39, 0.07);
  ctx.closePath();
  ctx.fillStyle = '#26303b';
  ctx.fill();
  ctx.lineWidth = 0.025;
  ctx.strokeStyle = PROP_EDGE;
  ctx.stroke();
  ctx.fillStyle = '#1a2129';
  ctx.fillRect(-0.39, 0.05, 0.78, 0.05);
  drawOpenBook(ctx, active);
}

function buildPlanGradient(ctx: CanvasRenderingContext2D): CanvasGradient {
  const g = ctx.createLinearGradient(0, PLAN_Y, 0, PLAN_Y + PLAN_H);
  g.addColorStop(0, '#0f2a4a');
  g.addColorStop(1, '#05080b');
  return g;
}

/** Grid and route on the terminal's screen; the rim pulses while it is needed. */
function drawPlan(ctx: CanvasRenderingContext2D, active: boolean, wave: number): void {
  const alpha = ctx.globalAlpha;
  ctx.globalAlpha = alpha * (active ? 1 : 0.45);
  ctx.beginPath();
  for (let i = 1; i < 5; i++) {
    const x = PLAN_X + (PLAN_W * i) / 5;
    ctx.moveTo(x, PLAN_Y + 0.02);
    ctx.lineTo(x, PLAN_Y + PLAN_H - 0.02);
  }
  for (let i = 1; i < 4; i++) {
    const y = PLAN_Y + (PLAN_H * i) / 4;
    ctx.moveTo(PLAN_X + 0.02, y);
    ctx.lineTo(PLAN_X + PLAN_W - 0.02, y);
  }
  ctx.lineWidth = 0.008;
  ctx.strokeStyle = 'rgba(96, 165, 250, 0.3)';
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(PLAN_ROUTE[0], PLAN_ROUTE[1]);
  for (let i = 2; i < PLAN_ROUTE.length; i += 2) {
    ctx.lineTo(PLAN_ROUTE[i] ?? 0, PLAN_ROUTE[i + 1] ?? 0);
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 0.022;
  ctx.strokeStyle = READ_LABEL;
  ctx.stroke();
  if (active) {
    ctx.beginPath();
    roundRectPath(ctx, PLAN_X, PLAN_Y, PLAN_W, PLAN_H, 0.02);
    ctx.lineWidth = 0.016;
    ctx.strokeStyle = BLUE;
    ctx.globalAlpha = alpha * (0.35 + 0.45 * wave);
    ctx.stroke();
  }
  ctx.globalAlpha = alpha;
}

/** Upright cabinet: the plan on its screen, a keyboard ledge and vents. */
function drawTerminal(ctx: CanvasRenderingContext2D, active: boolean, wave: number): void {
  ctx.beginPath();
  roundRectPath(ctx, -0.29, -0.44, 0.58, 0.8, 0.05);
  ctx.fillStyle = '#18202a';
  ctx.fill();
  ctx.lineWidth = 0.025;
  ctx.strokeStyle = PROP_EDGE;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.fillRect(-0.24, -0.43, 0.48, 0.012);
  ctx.beginPath();
  roundRectPath(ctx, -0.25, -0.39, 0.5, 0.36, 0.03);
  ctx.fillStyle = '#0b0f14';
  ctx.fill();
  ctx.beginPath();
  roundRectPath(ctx, PLAN_X, PLAN_Y, PLAN_W, PLAN_H, 0.02);
  ctx.fillStyle = cachedGradient(ctx, buildPlanGradient, '');
  ctx.fill();
  drawPlan(ctx, active, wave);
  ctx.beginPath();
  roundRectPath(ctx, -0.33, 0.01, 0.66, 0.1, 0.03);
  ctx.fillStyle = '#222b35';
  ctx.fill();
  ctx.lineWidth = 0.02;
  ctx.strokeStyle = PROP_EDGE;
  ctx.stroke();
  ctx.fillStyle = 'rgba(96, 165, 250, 0.22)';
  for (let i = 0; i < 6; i++) ctx.fillRect(-0.27 + i * 0.09, 0.035, 0.07, 0.025);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  for (let i = 0; i < 3; i++) ctx.fillRect(-0.18, 0.18 + i * 0.045, 0.36, 0.016);
}

/** A ruled table with a column of colour swatches, as printed on the chart. */
function drawChartTable(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = 'rgba(30, 58, 95, 0.75)';
  ctx.fillRect(-0.34, -0.42, 0.68, 0.075);
  ctx.fillStyle = '#f87171';
  ctx.fillRect(-0.3, -0.31, 0.12, 0.045);
  ctx.fillStyle = AMBER;
  ctx.fillRect(-0.3, -0.23, 0.12, 0.045);
  ctx.fillStyle = TEAL;
  ctx.fillRect(-0.3, -0.15, 0.12, 0.045);
  ctx.fillStyle = BLUE;
  ctx.fillRect(-0.3, -0.07, 0.12, 0.045);
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const y = -0.265 + i * 0.08;
    ctx.moveTo(-0.34, y);
    ctx.lineTo(0.34, y);
  }
  ctx.moveTo(-0.14, -0.345);
  ctx.lineTo(-0.14, 0.06);
  ctx.moveTo(0.12, -0.345);
  ctx.lineTo(0.12, 0.06);
  ctx.lineWidth = 0.009;
  ctx.strokeStyle = 'rgba(30, 41, 59, 0.5)';
  ctx.stroke();
  ctx.fillStyle = 'rgba(30, 41, 59, 0.55)';
  for (let i = 0; i < 4; i++) {
    const y = -0.3 + i * 0.08;
    ctx.fillRect(-0.1, y, 0.16, 0.022);
    ctx.fillRect(0.16, y, 0.12, 0.022);
  }
}

/** Board on an easel with a clamp on top; dimmed paper when not needed now. */
function drawChart(ctx: CanvasRenderingContext2D, active: boolean): void {
  ctx.beginPath();
  ctx.moveTo(-0.24, 0.05);
  ctx.lineTo(-0.3, 0.37);
  ctx.moveTo(0.24, 0.05);
  ctx.lineTo(0.3, 0.37);
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.045;
  ctx.strokeStyle = '#2b3540';
  ctx.stroke();
  ctx.beginPath();
  roundRectPath(ctx, -0.38, -0.46, 0.76, 0.56, 0.03);
  ctx.fillStyle = '#2b3540';
  ctx.fill();
  ctx.lineWidth = 0.025;
  ctx.strokeStyle = PROP_EDGE;
  ctx.stroke();
  ctx.fillStyle = '#c3cad3';
  ctx.fillRect(-0.34, -0.42, 0.68, 0.48);
  drawChartTable(ctx);
  if (!active) {
    ctx.fillStyle = PAPER_DIM;
    ctx.fillRect(-0.34, -0.42, 0.68, 0.48);
  }
  ctx.fillStyle = '#3b4654';
  ctx.fillRect(-0.07, -0.5, 0.14, 0.06);
}

/** A sheet of paper with lines of print, from its top left corner; dimmed when not needed. */
function drawSheet(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  active: boolean,
): void {
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.fillStyle = PAPER;
  ctx.fill();
  if (!active) {
    ctx.fillStyle = PAPER_DIM;
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(30, 58, 95, 0.75)';
  ctx.fillRect(x + w * 0.14, y + h * 0.1, w * 0.45, h * 0.06);
  ctx.beginPath();
  const lines = Math.floor((h * 0.68) / 0.05);
  for (let i = 0; i < lines; i++) {
    const length = ((PRINT[i % PRINT.length] ?? 0.2) / 0.21) * w * 0.72;
    ctx.moveTo(x + w * 0.14, y + h * 0.27 + i * 0.05);
    ctx.lineTo(x + w * 0.14 + length, y + h * 0.27 + i * 0.05);
  }
  ctx.lineWidth = 0.011;
  ctx.strokeStyle = PAPER_PRINT;
  ctx.stroke();
}

/** The hook the clipboard hangs from, in the wall just above its tile. */
const HOOK_Y = -0.52;

/** Hardboard with a spring clip and a sheet of rules, hanging slightly askew from its hook. */
function drawClipboard(ctx: CanvasRenderingContext2D, active: boolean): void {
  ctx.beginPath();
  addCircle(ctx, 0, HOOK_Y, 0.03);
  ctx.fillStyle = '#2b3540';
  ctx.fill();
  ctx.translate(0, HOOK_Y);
  ctx.rotate(-0.05);
  ctx.translate(0, -HOOK_Y);
  ctx.beginPath();
  roundRectPath(ctx, -0.17, -0.41, 0.4, 0.6, 0.035);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.fill();
  ctx.beginPath();
  roundRectPath(ctx, -0.2, -0.44, 0.4, 0.6, 0.035);
  ctx.fillStyle = '#6b4f33';
  ctx.fill();
  ctx.lineWidth = 0.02;
  ctx.strokeStyle = '#3a2a1a';
  ctx.stroke();
  drawSheet(ctx, -0.16, -0.35, 0.32, 0.46, active);
  ctx.beginPath();
  roundRectPath(ctx, -0.05, -0.5, 0.1, 0.05, 0.018);
  ctx.fillStyle = '#7b8794';
  ctx.fill();
  ctx.beginPath();
  roundRectPath(ctx, -0.11, -0.47, 0.22, 0.09, 0.025);
  ctx.fillStyle = '#9aa5b1';
  ctx.fill();
  ctx.lineWidth = 0.012;
  ctx.strokeStyle = '#3f4954';
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.fillRect(-0.08, -0.455, 0.16, 0.012);
}

const LOCKER_X = -0.23;
const LOCKER_TOP = -0.42;
const LOCKER_W = 0.46;
const LOCKER_H = 0.72;

/** Four slits pressed into a locker door from `y` down, each with a lit lower lip. */
function drawLouvres(ctx: CanvasRenderingContext2D, y: number): void {
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(-0.13, y + i * 0.04, 0.26, 0.016);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.fillRect(-0.13, y + i * 0.04 + 0.016, 0.26, 0.008);
  }
}

/** The shut door: louvres top and bottom, a name card and the handle. */
function drawLockerDoor(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  roundRectPath(ctx, LOCKER_X, LOCKER_TOP, LOCKER_W, LOCKER_H, 0.025);
  ctx.fillStyle = '#434c57';
  ctx.fill();
  ctx.lineWidth = 0.014;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.fillRect(LOCKER_X + 0.02, LOCKER_TOP + 0.012, LOCKER_W - 0.04, 0.012);
  drawLouvres(ctx, -0.35);
  drawLouvres(ctx, 0.13);
  ctx.fillStyle = '#b5ae98';
  ctx.fillRect(-0.08, -0.16, 0.16, 0.06);
  ctx.beginPath();
  roundRectPath(ctx, 0.12, -0.08, 0.045, 0.17, 0.018);
  ctx.fillStyle = '#9aa4b1';
  ctx.fill();
  ctx.lineWidth = 0.012;
  ctx.strokeStyle = PROP_EDGE;
  ctx.stroke();
}

/** Searched: the door swung out past its hinge, a shelf inside and a sheet of rules. */
function drawLockerOpen(ctx: CanvasRenderingContext2D, active: boolean): void {
  ctx.beginPath();
  roundRectPath(ctx, LOCKER_X, LOCKER_TOP, LOCKER_W, LOCKER_H, 0.025);
  ctx.fillStyle = '#0c1015';
  ctx.fill();
  ctx.fillStyle = '#39424c';
  ctx.fillRect(LOCKER_X, -0.27, LOCKER_W, 0.03);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.fillRect(LOCKER_X, -0.27, LOCKER_W, 0.008);
  ctx.save();
  ctx.rotate(0.05);
  drawSheet(ctx, -0.1, -0.17, 0.22, 0.32, active);
  ctx.restore();
  ctx.beginPath();
  addCircle(ctx, 0.008, -0.155, 0.018);
  ctx.fillStyle = '#c2410c';
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(LOCKER_X, LOCKER_TOP);
  ctx.lineTo(LOCKER_X - 0.16, LOCKER_TOP - 0.05);
  ctx.lineTo(LOCKER_X - 0.16, LOCKER_TOP + LOCKER_H + 0.05);
  ctx.lineTo(LOCKER_X, LOCKER_TOP + LOCKER_H);
  ctx.closePath();
  ctx.fillStyle = '#353d47';
  ctx.fill();
  ctx.lineWidth = 0.014;
  ctx.strokeStyle = PROP_EDGE;
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    ctx.moveTo(LOCKER_X - 0.035, -0.33 + i * 0.04);
    ctx.lineTo(LOCKER_X - 0.125, -0.35 + i * 0.04);
    ctx.moveTo(LOCKER_X - 0.035, 0.15 + i * 0.04);
    ctx.lineTo(LOCKER_X - 0.125, 0.16 + i * 0.04);
  }
  ctx.lineWidth = 0.014;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.stroke();
}

/** A grey steel locker, shut or — once searched — standing open with the rules inside. */
function drawLocker(ctx: CanvasRenderingContext2D, active: boolean, opened: boolean): void {
  ctx.beginPath();
  roundRectPath(ctx, -0.27, -0.47, 0.54, 0.84, 0.04);
  ctx.fillStyle = '#272e36';
  ctx.fill();
  ctx.lineWidth = 0.025;
  ctx.strokeStyle = PROP_EDGE;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.fillRect(-0.23, -0.46, 0.46, 0.012);
  if (opened) drawLockerOpen(ctx, active);
  else drawLockerDoor(ctx);
}

const DRAWER_X = -0.26;
const DRAWER_W = 0.52;
const DRAWER_H = 0.22;
/** Tops of the cabinet's three drawers, top to bottom. */
const DRAWER_TOPS = [-0.38, -0.13, 0.12] as const;
const DRAWER_FRONT = '#3a4336';
/** A drawer pulled out catches more of the light. */
const DRAWER_FRONT_OUT = '#46513f';
/** Tabs of the hanging files in the open drawer. */
const FILE_TABS = ['#f87171', BLUE, AMBER, '#4ade80', TEAL] as const;

/** A drawer front with its label card and pull handle, `top` its upper edge. */
function drawDrawer(ctx: CanvasRenderingContext2D, top: number, front: string): void {
  ctx.beginPath();
  roundRectPath(ctx, DRAWER_X, top, DRAWER_W, DRAWER_H, 0.02);
  ctx.fillStyle = front;
  ctx.fill();
  ctx.lineWidth = 0.012;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.fillRect(DRAWER_X + 0.02, top + 0.01, DRAWER_W - 0.04, 0.01);
  ctx.fillStyle = '#b9b29a';
  ctx.fillRect(-0.07, top + 0.04, 0.14, 0.05);
  ctx.beginPath();
  roundRectPath(ctx, -0.1, top + 0.125, 0.2, 0.04, 0.016);
  ctx.fillStyle = '#a3ab9c';
  ctx.fill();
  ctx.lineWidth = 0.01;
  ctx.strokeStyle = PROP_EDGE;
  ctx.stroke();
}

/** A hasp over the top drawer and a brass padlock hanging from it. */
function drawPadlock(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  roundRectPath(ctx, 0.15, -0.43, 0.05, 0.17, 0.015);
  ctx.fillStyle = '#59605c';
  ctx.fill();
  ctx.lineWidth = 0.012;
  ctx.strokeStyle = PROP_EDGE;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0.125, -0.21);
  ctx.arc(0.175, -0.25, 0.05, Math.PI, 0);
  ctx.lineTo(0.225, -0.21);
  ctx.lineWidth = 0.024;
  ctx.strokeStyle = '#b6bec7';
  ctx.stroke();
  ctx.beginPath();
  roundRectPath(ctx, 0.095, -0.225, 0.16, 0.13, 0.03);
  ctx.fillStyle = '#c9a54a';
  ctx.fill();
  ctx.lineWidth = 0.014;
  ctx.strokeStyle = '#5c4718';
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.fillRect(0.115, -0.212, 0.12, 0.014);
  ctx.beginPath();
  addCircle(ctx, 0.175, -0.17, 0.017);
  ctx.rect(0.168, -0.165, 0.014, 0.035);
  ctx.fillStyle = '#3d2f12';
  ctx.fill();
}

/** Unlocked: the top drawer pulled out, its files and a sheet of rules standing up in it. */
function drawOpenDrawer(ctx: CanvasRenderingContext2D, active: boolean): void {
  const top = DRAWER_TOPS[0];
  const front = top + 0.15;
  ctx.fillStyle = '#0b0e0b';
  ctx.fillRect(DRAWER_X, top, DRAWER_W, DRAWER_H);
  for (let i = 0; i < FILE_TABS.length; i++) {
    const x = DRAWER_X + 0.04 + i * 0.09;
    ctx.fillStyle = i % 2 === 0 ? '#b8975a' : '#9c7f48';
    ctx.fillRect(x, top + 0.03, 0.08, front - top);
    ctx.fillStyle = FILE_TABS[i] ?? AMBER;
    ctx.fillRect(x + 0.012, top + 0.005, 0.035, 0.03);
  }
  drawSheet(ctx, -0.09, top - 0.1, 0.18, 0.24, active);
  drawDrawer(ctx, front, DRAWER_FRONT_OUT);
}

/** A filing cabinet under a padlock or — once unlocked — with its top drawer pulled out. */
function drawCabinet(ctx: CanvasRenderingContext2D, active: boolean, opened: boolean): void {
  ctx.beginPath();
  roundRectPath(ctx, -0.3, -0.43, 0.6, 0.8, 0.035);
  ctx.fillStyle = '#262c25';
  ctx.fill();
  ctx.lineWidth = 0.025;
  ctx.strokeStyle = PROP_EDGE;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.fillRect(-0.26, -0.42, 0.52, 0.012);
  for (const top of opened ? DRAWER_TOPS.slice(1) : DRAWER_TOPS) drawDrawer(ctx, top, DRAWER_FRONT);
  if (opened) drawOpenDrawer(ctx, active);
  else drawPadlock(ctx);
}

/** Anchor: TILE CENTER. Where printed rules lie: an open book on a lectern, a terminal
 * showing a plan, a chart on an easel, a clipboard on a hook in the wall above, a grey locker
 * (ajar once searched, the rules inside) or a filing cabinet under a padlock (gone once
 * unlocked, the top drawer pulled out). Covering the armed station = blue glow (strength
 * follows pulse) and lit paper or screen; label under it (0.2 tile mono, dark halo). */
export function drawManualObject(ctx: CanvasRenderingContext2D, o: ManualObjectOpts): void {
  const wave = pulseWave(o.pulse);
  ctx.save();
  try {
    // A clipboard hangs on the wall and casts its shadow there.
    const shadow = o.kind === 'clipboard' ? 0 : 0.45;
    softEllipse(ctx, 0, 0.36, 0.42, 0.12, SHADOW_RGB, shadow, 'source-over');
    if (o.active) softEllipse(ctx, 0, -0.12, 0.85, 0.75, BLUE_RGB, 0.14 + 0.26 * wave, 'lighter');
    ctx.save();
    switch (o.kind) {
      case 'book':
        drawLectern(ctx, o.active);
        break;
      case 'terminal':
        drawTerminal(ctx, o.active, wave);
        break;
      case 'chart':
        drawChart(ctx, o.active);
        break;
      case 'clipboard':
        drawClipboard(ctx, o.active);
        break;
      case 'locker':
        drawLocker(ctx, o.active, o.opened);
        break;
      case 'cabinet':
        drawCabinet(ctx, o.active, o.opened);
        break;
    }
    ctx.restore();
    drawHaloText(ctx, o.label, 0, 0.41, FONT_LABEL, o.active ? READ_LABEL : IDLE_LABEL, 'top');
  } finally {
    ctx.restore();
  }
}

// ---- Edgework sign -------------------------------------------------------------------

export interface SignOpts {
  label: string;
  /** this player has read it: a teal tick instead of the amber call for attention */
  seen: boolean;
  /** 0..1 looping pulse driven by the caller */
  pulse: number;
}

/** Brushed brass, lit from the top. */
function buildPlaqueGradient(ctx: CanvasRenderingContext2D): CanvasGradient {
  const g = ctx.createLinearGradient(0, -0.31, 0, 0.07);
  g.addColorStop(0, '#b39552');
  g.addColorStop(1, '#6b5428');
  return g;
}

/** Adds the outline of a serial — five characters, a dash, a digit — shifted down by `dy`. */
function addSerial(p: CanvasPath, dy: number): void {
  for (let i = 0; i < 5; i++) p.rect(-0.235 + i * 0.07, -0.17 + dy, 0.045, 0.09);
  p.rect(0.125, -0.13 + dy, 0.035, 0.015);
  p.rect(0.185, -0.17 + dy, 0.045, 0.09);
}

/** The serial's shape cut into the brass, never the serial itself; three lamps under it. */
function drawEngraving(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  addSerial(ctx, 0.008);
  ctx.fillStyle = 'rgba(255, 238, 200, 0.28)';
  ctx.fill();
  ctx.beginPath();
  addSerial(ctx, 0);
  ctx.rect(-0.2, -0.235, 0.4, 0.014);
  addCircle(ctx, -0.1, -0.025, 0.022);
  addCircle(ctx, 0, -0.025, 0.022);
  addCircle(ctx, 0.1, -0.025, 0.022);
  ctx.fillStyle = 'rgba(40, 28, 10, 0.8)';
  ctx.fill();
}

function drawSeenTick(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.arc(0.3, -0.3, 0.07, 0, TAU);
  ctx.fillStyle = TEAL;
  ctx.fill();
  ctx.lineWidth = 0.016;
  ctx.strokeStyle = PROP_EDGE;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0.27, -0.3);
  ctx.lineTo(0.293, -0.275);
  ctx.lineTo(0.333, -0.322);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 0.02;
  ctx.strokeStyle = '#042f2a';
  ctx.stroke();
}

/** Anchor: TILE CENTER. The Laborkennung: a brass plaque on two posts, a serial's outline
 * and three lamps engraved; amber glow (strength follows pulse) until this player has read
 * it, then a teal tick. Label under it (0.2 tile mono, dark halo). */
export function drawSign(ctx: CanvasRenderingContext2D, o: SignOpts): void {
  const wave = pulseWave(o.pulse);
  ctx.save();
  try {
    softEllipse(ctx, 0, 0.33, 0.3, 0.09, SHADOW_RGB, 0.4, 'source-over');
    softEllipse(ctx, 0, -0.12, 0.75, 0.6, AMBER_RGB, o.seen ? 0.06 : 0.12 + 0.22 * wave, 'lighter');
    ctx.fillStyle = '#1b232c';
    ctx.fillRect(-0.2, 0.04, 0.05, 0.28);
    ctx.fillRect(0.15, 0.04, 0.05, 0.28);
    ctx.beginPath();
    roundRectPath(ctx, -0.32, -0.31, 0.64, 0.38, 0.04);
    ctx.fillStyle = cachedGradient(ctx, buildPlaqueGradient, '');
    ctx.fill();
    ctx.lineWidth = 0.022;
    ctx.strokeStyle = PROP_EDGE;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.fillRect(-0.28, -0.3, 0.56, 0.012);
    ctx.beginPath();
    addCircle(ctx, -0.27, -0.26, 0.016);
    addCircle(ctx, 0.27, -0.26, 0.016);
    addCircle(ctx, -0.27, 0.02, 0.016);
    addCircle(ctx, 0.27, 0.02, 0.016);
    ctx.fillStyle = '#3d3020';
    ctx.fill();
    drawEngraving(ctx);
    if (o.seen) drawSeenTick(ctx);
    drawHaloText(ctx, o.label, 0, 0.36, FONT_LABEL, o.seen ? IDLE_LABEL : '#fcd34d', 'top');
  } finally {
    ctx.restore();
  }
}

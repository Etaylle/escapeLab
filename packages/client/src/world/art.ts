import type { ConsoleId, ManualKind } from '@escapelab/core';
import {
  addCircle,
  cachedGradient,
  clamp01,
  footShadow,
  OUTLINE,
  pulseWave,
  roundRectPath,
  softEllipse,
  TAU,
} from './brush.js';
import { restingPose, type Arms, type FigurePose } from './figure.js';
import {
  ALARM,
  AMBER,
  BLACK,
  BRASS,
  css,
  DONE_GREEN,
  EMERGENCY,
  GLASS,
  INK,
  LABEL,
  lift,
  LINO,
  mix,
  NIGHT,
  PAPER,
  parseHex,
  READ_BLUE,
  REACTOR,
  rgba,
  sink,
  STEEL,
  TEAL,
  WHITE,
  WOOD,
  type Rgb,
} from './palette.js';
import { SHEET_ON_FLOOR, SHEET_ON_WALL } from './notes.js';
import { surfaceTile } from './surfaces.js';

// art.ts — the props and the crew: capsule scientists in a dark 1980s lab, drawn in Canvas2D
// after the art bible (docs/art-bible.md): colours from palette.ts only, a 2 px outline at
// 64 px a tile (brush.ts's OUTLINE), lit from the top left, a soft foot shadow under every
// standing prop.
//
// Nothing touches the DOM at import time. Every draw function assumes the ctx is transformed
// so that THE ORIGIN IS THE OBJECT'S ANCHOR and 1.0 === one map tile, saves and restores
// (try/finally) all ctx state it changes, and allocates nothing per call beyond what the
// canvas API itself allocates (drawPlate's uppercase label is the one exception). Module
// state is limited to memo caches never invalidated: gradients (brush.ts), the shading
// colours per scientist body colour, and the scientist outlines as Path2D objects.
//
// Text: sub-pixel font sizes such as '0.26px' render unreliably (engines may round, clamp or
// hint the size before the transform applies). All text is therefore drawn TEXT_SCALE times
// larger inside ctx.scale(1 / TEXT_SCALE, 1 / TEXT_SCALE). Name tags and the labels under
// props follow the zoom only within a range of CSS pixels: the caller hands in worldText()
// for its zoom as `text`; without it they are drawn at their size in tiles.

const C_TEAL = css(TEAL);
const C_AMBER = css(AMBER);
/** Reading: manual objects, like their edge marker. */
const C_BLUE = css(READ_BLUE);
/** The outline round consoles, doors and every other prop. */
const PROP_EDGE = css(INK);

const MONO = 'ui-monospace, Menlo, monospace';
/** Text is drawn this many times larger inside a matching down-scale (see header). */
const TEXT_SCALE = 32;
/** 0.17 tile: a console's letter on its station; it grows and shrinks with its disc. */
const FONT_BADGE = `bold ${0.17 * TEXT_SCALE}px ${MONO}`;
/** Label of a prop that is not calling for anybody right now. */
const IDLE_LABEL = css(LABEL);
const HALO_COLOR = rgba(NIGHT, 0.88);
/** Light catching a prop's top edge: the key light comes from the top left. */
const EDGE_LIGHT = rgba(WHITE, 0.07);
const VENT = rgba(BLACK, 0.45);

/** Steel `t` of the way into shadow: a prop's front, a recess. */
const steel = (t: number): string => css(sink(STEEL, t));

// ---- World text ----------------------------------------------------------------------

/** A style of world text: its height in tiles, and its font and halo width in text space. */
export interface TextStyle {
  size: number;
  font: string;
  /** stroke width of the dark halo; it reaches half of it past each glyph edge */
  halo: number;
}

/** The world's text at one zoom: the labels under props and the name tags over the crew. */
export interface WorldText {
  label: TextStyle;
  name: TextStyle;
}

/** A prop's label and a name tag at an ordinary zoom, in tiles, and the halo round both. */
const LABEL_TILES = 0.2;
const NAME_TILES = 0.26;
const HALO_TILES = 0.075;
/**
 * How large they may come out on screen, CSS pixels: never too small to read on a phone,
 * never giant on a wide window, and below the room names (viewport.ts's ROOM_NAME_PX).
 */
const LABEL_PX = [10, 12] as const;
const NAME_PX = [11, 14] as const;

/** Text `size` tiles high, its halo grown or shrunk with it from its size at `natural`. */
function textStyle(size: number, natural: number): TextStyle {
  return {
    size,
    font: `bold ${size * TEXT_SCALE}px ${MONO}`,
    halo: HALO_TILES * (size / natural) * TEXT_SCALE,
  };
}

/** `natural` tiles of text at `tilePx` device pixels per tile, held within `px` CSS pixels. */
function heldWithin(
  natural: number,
  tilePx: number,
  dpr: number,
  [min, max]: readonly [number, number],
): number {
  return (Math.min(max, Math.max(min, (natural * tilePx) / dpr)) * dpr) / tilePx;
}

/**
 * The world's text at a zoom of `tilePx` device pixels per tile: labels and name tags
 * follow the zoom, but only so far — no giant letters on a wide window, none too small to
 * read on a phone.
 */
export function worldText(tilePx: number, dpr: number): WorldText {
  return {
    label: textStyle(heldWithin(LABEL_TILES, tilePx, dpr, LABEL_PX), LABEL_TILES),
    name: textStyle(heldWithin(NAME_TILES, tilePx, dpr, NAME_PX), NAME_TILES),
  };
}

/** The world's text at its size in tiles, for a caller that names no zoom. */
const TILE_TEXT: WorldText = {
  label: textStyle(LABEL_TILES, LABEL_TILES),
  name: textStyle(NAME_TILES, NAME_TILES),
};

/**
 * Draws centered text with a dark halo (stroke first, then fill) at tile position (x, y).
 * Changes text, stroke and fill state; callers own the surrounding save/restore.
 */
function drawHaloText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  style: TextStyle,
  fill: string,
  baseline: CanvasTextBaseline,
): void {
  if (text === '') return;
  ctx.scale(1 / TEXT_SCALE, 1 / TEXT_SCALE);
  ctx.font = style.font;
  ctx.textAlign = 'center';
  ctx.textBaseline = baseline;
  ctx.lineJoin = 'round';
  ctx.lineWidth = style.halo;
  ctx.strokeStyle = HALO_COLOR;
  ctx.strokeText(text, x * TEXT_SCALE, y * TEXT_SCALE);
  ctx.fillStyle = fill;
  ctx.fillText(text, x * TEXT_SCALE, y * TEXT_SCALE);
  // TEXT_SCALE is a power of two, so this undoes the down-scale exactly.
  ctx.scale(TEXT_SCALE, TEXT_SCALE);
}

/**
 * Anchor: the prop's own. A label `y` tiles below it, top-aligned, as plates, manual
 * objects and the sign carry theirs: for props drawn elsewhere, such as carryables.
 */
export function drawPropLabel(
  ctx: CanvasRenderingContext2D,
  label: string,
  y: number,
  color: string,
  text: WorldText = TILE_TEXT,
): void {
  ctx.save();
  try {
    drawHaloText(ctx, label, 0, y, text.label, color, 'top');
  } finally {
    ctx.restore();
  }
}

// ---- Scientist -----------------------------------------------------------------------

export interface ScientistOpts {
  /** body color, one of the crew's: '#rgb' or '#rrggbb' */
  color: string;
  name: string;
  /** facing angle in radians (0 = right, PI/2 = down): the way the figure walks */
  facing: number;
  moving: boolean;
  /** walk cycle 0..1, advances only while moving */
  walkPhase: number;
  /** local player: add a subtle white ground ring */
  isYou: boolean;
  /** dim to ~45% alpha when false */
  connected: boolean;
  /** the world's text at this zoom (worldText); the name in plain tiles when left out */
  text?: WorldText;
  /** how the figure stands this frame (figure.ts); at rest, facing `facing`, when left out */
  pose?: FigurePose;
  /**
   * what the hands hold while the pose holds something, drawn at its size on the floor round
   * its own anchor, in tiles — the figure puts it before its chest at HELD_SCALE
   */
  held?: (ctx: CanvasRenderingContext2D) => void;
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
/** How far the visor slides back across the dome as the figure glances away from its way. */
const VISOR_SLIDE = 0.06;
const NAME_Y = BODY_TOP - 0.1;
const NAME_COLOR = css(lift(LABEL, 0.82));
// The arms: a capsule from the shoulder, a mitten at its end, behind the body — hanging,
// they stay inside its outline; raised, the hands come up beside the head.
const ARM_LENGTH = 0.28;
const ARM_WIDTH = 0.09;
const HAND_R = 0.055;
/** The shoulders at the dome's widest, toward its front and its back. */
const FRONT_SHOULDER: readonly [number, number] = [0.15, -0.62];
const BACK_SHOULDER: readonly [number, number] = [-0.15, -0.62];
/** Holding, both arms reach forward from the chest under the visor, the back one higher. */
const HOLD_FRONT: readonly [number, number] = [0.12, -0.44];
const HOLD_BACK: readonly [number, number] = [0.06, -0.5];
/** Where a held item sits, before the chest in the hands, and its share of its floor size. */
const HELD_X = 0.43;
const HELD_Y = -0.44;
export const HELD_SCALE = 0.6;
// Animation amplitudes (tile units, radians for LEAN).
const STRIDE = 0.06;
const STEP_LIFT = 0.025;
const BOB = 0.025;
const LEAN = 0.06;
const DISCONNECTED_ALPHA = 0.45;
/** Visor glass: steel with a cold sheen. */
const VISOR_GLASS = mix(STEEL, GLASS, 0.3);
/** The teal lab light along the visor's lower rim, and the glints on its glass. */
const VISOR_RIM = rgba(TEAL, 0.3);
const VISOR_GLINT = rgba(WHITE, 0.8);
/** A dimmed visor: the glass sunk this far toward black at the full dim. */
const VISOR_DIM = rgba(BLACK, 0.7);
/** The light sweeping across the visor of somebody speaking: its width, slant and glow. */
const SHIMMER_W = 0.07;
const SHIMMER_SLANT = 0.05;
const SHIMMER_LIGHT = rgba(WHITE, 0.55);

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

/**
 * Derives (once per color) the shading colors for a scientist body color.
 *
 * @throws Error for a colour that is no '#rgb' or '#rrggbb'.
 */
function bodyColors(color: string): BodyColors {
  let colors = bodyColorCache.get(color);
  if (colors === undefined) {
    const rgb = parseHex(color);
    colors = {
      light: css(lift(rgb, 0.3)),
      shade: css(sink(rgb, 0.3)),
      pack: css(sink(rgb, 0.42)),
      outline: css(sink(rgb, 0.62)),
    };
    bodyColorCache.set(color, colors);
  }
  return colors;
}

interface ScientistPaths {
  body: Path2D;
  /** Centered on x = 0, standing on y = 0. */
  leg: Path2D;
  pack: Path2D;
  /** Hanging from its shoulder at the origin down +y, the hand at its end. */
  arm: Path2D;
  /** A hand alone, centered on the origin: over what the hands hold. */
  hand: Path2D;
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
  const arm = new Path2D();
  roundRectPath(arm, -ARM_WIDTH / 2, -ARM_WIDTH / 2, ARM_WIDTH, ARM_LENGTH, ARM_WIDTH / 2);
  addCircle(arm, 0, ARM_LENGTH, HAND_R);
  const hand = new Path2D();
  addCircle(hand, 0, 0, HAND_R);
  scientistPaths = { body, leg, pack, arm, hand };
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
  g.addColorStop(0, css(sink(VISOR_GLASS, 0.42)));
  g.addColorStop(0.45, css(sink(VISOR_GLASS, 0.78)));
  g.addColorStop(1, css(sink(VISOR_GLASS, 0.9)));
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
  ctx.strokeStyle = rgba(WHITE, 0.24);
  ctx.stroke();
}

/**
 * A light sweeping across the visor of somebody speaking, `at` of its way from
 * the visor's back (0) past its front (1): a slanted band, clipped to the glass.
 * Visor-local space: front edge at x = 0, vertical center at y = 0, `w` wide.
 */
function drawShimmer(ctx: CanvasRenderingContext2D, w: number, at: number): void {
  const r = VISOR_H / 2;
  const x = -w - SHIMMER_W + (w + 2 * SHIMMER_W) * at;
  ctx.save();
  ctx.beginPath();
  roundRectPath(ctx, -w, -r, w, VISOR_H, r);
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(x - SHIMMER_W / 2 + SHIMMER_SLANT, -r);
  ctx.lineTo(x + SHIMMER_W / 2 + SHIMMER_SLANT, -r);
  ctx.lineTo(x + SHIMMER_W / 2 - SHIMMER_SLANT, r);
  ctx.lineTo(x - SHIMMER_W / 2 - SHIMMER_SLANT, r);
  ctx.closePath();
  ctx.fillStyle = SHIMMER_LIGHT;
  ctx.fill();
  ctx.restore();
}

/** The visor's teal rim and white glints, `light` of their strength (a dimmed visor's less). */
function drawVisorGlints(ctx: CanvasRenderingContext2D, w: number, light: number): void {
  const r = VISOR_H / 2;
  const alpha = ctx.globalAlpha;
  ctx.globalAlpha = alpha * light;
  ctx.beginPath();
  ctx.moveTo(-w + r, r - 0.04);
  ctx.lineTo(-r, r - 0.04);
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.018;
  ctx.strokeStyle = VISOR_RIM;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(-0.09, -0.042, 0.06, 0.024, -0.12, 0, TAU);
  addCircle(ctx, -0.165, -0.045, 0.013);
  ctx.fillStyle = VISOR_GLINT;
  ctx.fill();
  ctx.globalAlpha = alpha;
}

/**
 * Visor on the side the figure looks to. Looking toward the camera (down)
 * widens and lowers it; away (up) narrows and raises it — the vertical part
 * of the look. A glance away from the figure's way (`facing`) slides it back
 * across the dome; a dimmed visor loses its glints; while the figure speaks
 * a light sweeps across it.
 */
function drawVisor(
  ctx: CanvasRenderingContext2D,
  pose: FigurePose,
  facing: number,
  outline: string,
): void {
  const s = Math.sin(pose.look);
  const w = 0.3 + 0.05 * Math.max(0, s) - 0.1 * Math.max(0, -s);
  const x = VISOR_FRONT - VISOR_SLIDE * (1 - Math.cos(pose.look - facing));
  const cy = DOME_Y + 0.02 + 0.025 * s;
  const r = VISOR_H / 2;
  // Visor-local space: front edge at x = 0, vertical center at y = 0.
  ctx.translate(x, cy);
  ctx.beginPath();
  roundRectPath(ctx, -w, -r, w, VISOR_H, r);
  ctx.lineWidth = OUTLINE_W * 2;
  ctx.strokeStyle = outline;
  ctx.stroke();
  ctx.fillStyle = cachedGradient(ctx, buildVisorGradient, '');
  ctx.fill();
  if (pose.dim > 0) {
    const alpha = ctx.globalAlpha;
    ctx.globalAlpha = alpha * pose.dim;
    ctx.fillStyle = VISOR_DIM;
    ctx.fill();
    ctx.globalAlpha = alpha;
  }
  drawVisorGlints(ctx, w, 1 - pose.dim);
  if (pose.shimmer !== null) {
    drawShimmer(ctx, w, pose.shimmer);
  }
  ctx.translate(-x, -cy);
}

/** Where an arm hangs from, body space: at the dome's widest, or at the chest to hold. */
function shoulderOf(front: boolean, holding: boolean): readonly [number, number] {
  if (holding) {
    return front ? HOLD_FRONT : HOLD_BACK;
  }
  return front ? FRONT_SHOULDER : BACK_SHOULDER;
}

/**
 * Both arms, stroked (the outline pass) or filled — the back arm in the
 * pack's tone, the front one in the shade — body space, from the shoulders
 * they reach from, `holding` or not. An angle turns the arm from hanging
 * toward the front: the canvas turns the other way.
 */
function drawArms(
  ctx: CanvasRenderingContext2D,
  arms: Arms,
  holding: boolean,
  colors: BodyColors | null,
): void {
  const { arm } = getScientistPaths();
  for (const front of [false, true]) {
    const [x, y] = shoulderOf(front, holding);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-(front ? arms.front : arms.back));
    if (colors === null) {
      ctx.stroke(arm);
    } else {
      ctx.fillStyle = front ? colors.shade : colors.pack;
      ctx.fill(arm);
    }
    ctx.restore();
  }
}

/**
 * What the hands hold, before the chest at HELD_SCALE: over the back hand,
 * which the arms' pass drew already, and under the front one, so that the
 * two grip it. Body space.
 */
function drawHeld(
  ctx: CanvasRenderingContext2D,
  held: (ctx: CanvasRenderingContext2D) => void,
  pose: FigurePose,
  colors: BodyColors,
): void {
  ctx.save();
  ctx.translate(HELD_X, HELD_Y);
  ctx.scale(HELD_SCALE, HELD_SCALE);
  held(ctx);
  ctx.restore();
  const { hand } = getScientistPaths();
  const [sx, sy] = shoulderOf(true, true);
  const angle = pose.arms?.front ?? 0;
  const x = sx + ARM_LENGTH * Math.sin(angle);
  const y = sy + ARM_LENGTH * Math.cos(angle);
  ctx.translate(x, y);
  ctx.lineWidth = OUTLINE_W;
  ctx.strokeStyle = colors.outline;
  ctx.stroke(hand);
  ctx.fillStyle = colors.shade;
  ctx.fill(hand);
  ctx.translate(-x, -y);
}

/**
 * Arms, legs, backpack, body and visor, and what the hands hold. Turns the
 * figure to the side it looks to, bows it as the pose says and leans it
 * while moving; leaves the transform changed, so callers wrap it in
 * save/restore. `bob` raises the body over the legs (negative is up).
 */
function drawScientistFigure(
  ctx: CanvasRenderingContext2D,
  o: ScientistOpts,
  colors: BodyColors,
  theta: number,
  bob: number,
  pose: FigurePose,
): void {
  const paths = getScientistPaths();
  const swing = o.moving ? Math.sin(theta) * STRIDE : 0;
  // Positive while the front leg swings forward (lifted), negative while the rear one does.
  const raise = o.moving ? Math.cos(theta) * STEP_LIFT : 0;
  const frontX = LEG_X + swing;
  const frontY = -Math.max(0, raise);
  const backX = -LEG_X - swing;
  const backY = -Math.max(0, -raise);
  ctx.scale(Math.cos(pose.look) < 0 ? -1 : 1, 1);
  ctx.rotate((o.moving ? LEAN : 0) + pose.bow);
  ctx.lineJoin = 'round';
  // Outline pass at twice the outline width; the fill pass covers the inner half, leaving
  // one continuous outline around the union of arms, legs, backpack and body.
  ctx.lineWidth = OUTLINE_W * 2;
  ctx.strokeStyle = colors.outline;
  if (pose.arms !== null) {
    ctx.translate(0, bob);
    drawArms(ctx, pose.arms, pose.holding, null);
    ctx.translate(0, -bob);
  }
  strokePathAt(ctx, paths.leg, backX, backY);
  strokePathAt(ctx, paths.leg, frontX, frontY);
  strokePathAt(ctx, paths.pack, 0, bob);
  strokePathAt(ctx, paths.body, 0, bob);
  ctx.fillStyle = colors.shade;
  fillPathAt(ctx, paths.leg, backX, backY);
  ctx.fillStyle = o.color;
  fillPathAt(ctx, paths.leg, frontX, frontY);
  ctx.translate(0, bob);
  if (pose.arms !== null) {
    drawArms(ctx, pose.arms, pose.holding, colors);
  }
  ctx.fillStyle = colors.pack;
  ctx.fill(paths.pack);
  ctx.fillStyle = cachedGradient(ctx, buildBodyGradient, o.color);
  ctx.fill(paths.body);
  drawBodyHighlight(ctx);
  drawVisor(ctx, pose, o.facing, colors.outline);
  if (pose.holding && o.held !== undefined) {
    drawHeld(ctx, o.held, pose, colors);
  }
}

function drawYouRing(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.37, 0.135, 0, 0, TAU);
  ctx.lineWidth = 0.025;
  ctx.strokeStyle = rgba(WHITE, 0.55);
  ctx.stroke();
}

/**
 * Somebody speaking: a soft ring in their colour round their feet, wider than
 * the white ring under your own, breathing with `time` (s). Anchor: FEET
 * CENTER, drawn before the figure so that it stands in it.
 */
export function drawVoiceRing(ctx: CanvasRenderingContext2D, color: string, time: number): void {
  const breath = 0.5 + 0.5 * Math.sin(time * 8);
  const rx = 0.46 + 0.05 * breath;
  const ry = 0.17 + 0.02 * breath;
  ctx.save();
  const alpha = ctx.globalAlpha;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
  // A wide faint band for the glow, a thin bright line on it.
  ctx.globalAlpha = alpha * (0.22 + 0.12 * breath);
  ctx.lineWidth = 0.13;
  ctx.stroke();
  ctx.globalAlpha = alpha * (0.6 + 0.3 * breath);
  ctx.lineWidth = 0.035;
  ctx.stroke();
  ctx.restore();
}

/**
 * Anchor: FEET CENTER. Body ~0.62 tile wide, ~0.85 tile tall. Stands as
 * `o.pose` says (figure.ts) — off the ground and squashed or stretched about
 * its feet, its shadow shrinking under it as it rises — at rest without one.
 */
export function drawScientist(ctx: CanvasRenderingContext2D, o: ScientistOpts): void {
  // Resolved first so an invalid color throws before anything is drawn.
  const colors = bodyColors(o.color);
  const pose = o.pose ?? restingPose(o.facing);
  ctx.save();
  try {
    if (!o.connected) ctx.globalAlpha *= DISCONNECTED_ALPHA;
    const theta = o.walkPhase * TAU;
    // The body is highest while the legs pass each other and back down at full stride.
    const bob = o.moving ? -Math.abs(Math.cos(theta)) * BOB : 0;
    // bob <= 0: a raised body casts a slightly smaller shadow, a figure in the air a smaller one.
    const rx = (0.3 + bob) * pose.shadow;
    const ry = (0.1 + bob / 3) * pose.shadow;
    softEllipse(ctx, 0, 0, rx, ry, BLACK, 0.35, 'source-over');
    if (o.isYou) drawYouRing(ctx);
    ctx.save();
    ctx.translate(0, -pose.rise);
    ctx.scale(1 / pose.stretch, pose.stretch);
    drawScientistFigure(ctx, o, colors, theta, bob - pose.bob, pose);
    ctx.restore();
    drawHaloText(ctx, o.name, 0, NAME_Y, (o.text ?? TILE_TEXT).name, NAME_COLOR, 'bottom');
  } finally {
    ctx.restore();
  }
}

// ---- Floor and wall textures ---------------------------------------------------------

/** The size of the floor and wall textures the editor's brushes show, in pixels. */
const TEX_SIZE = 64;

/**
 * A plain room's floor as a 64 × 64 px texture: steel panels in the dark — or, `powered`,
 * under the ceiling lights (surfaces.ts draws every room kind's).
 */
export function makeFloorTile(powered = false): HTMLCanvasElement {
  return surfaceTile(TEX_SIZE, { floor: 'plain', variant: 0, lit: powered });
}

/** A plain room's wall seen from the room south of it, as a 64 × 64 px texture. */
export function makeWallTile(powered = false): HTMLCanvasElement {
  return surfaceTile(TEX_SIZE, { wall: 'plain', mask: 4, lit: powered, faceLit: powered });
}

// ---- Station -------------------------------------------------------------------------

export interface StationOpts {
  status: 'done' | 'armed' | 'locked';
  /** 0..1 looping pulse driven by the caller */
  pulse: number;
  /** which console of a two-console station this is, lettered on it; null at a station with one */
  console: ConsoleId | null;
  /** the thing alone, no foot shadow or glow: what its silhouette is baked from (silhouette.ts) */
  bare?: boolean;
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
    deskTop: steel(0.68),
    deskFront: steel(0.8),
    bezel: steel(0.85),
    screen: css(sink(TEAL, 0.7)),
    keys: rgba(TEAL, 0.32),
    led: C_TEAL,
    badgeInk: PROP_EDGE,
  },
  done: {
    deskTop: steel(0.68),
    deskFront: steel(0.8),
    bezel: steel(0.85),
    screen: css(sink(DONE_GREEN, 0.82)),
    keys: rgba(DONE_GREEN, 0.16),
    led: css(DONE_GREEN),
    badgeInk: PROP_EDGE,
  },
  locked: {
    deskTop: css(sink(LABEL, 0.78)),
    deskFront: css(sink(LABEL, 0.85)),
    bezel: css(sink(LABEL, 0.88)),
    screen: css(sink(LABEL, 0.83)),
    keys: rgba(WHITE, 0.06),
    led: css(sink(LABEL, 0.6)),
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
const LOCK_GREY = css(sink(LABEL, 0.25));

function buildScreenGradient(ctx: CanvasRenderingContext2D, top: string): CanvasGradient {
  const g = ctx.createLinearGradient(0, SCREEN_Y, 0, SCREEN_Y + SCREEN_H);
  g.addColorStop(0, top);
  g.addColorStop(1, PROP_EDGE);
  return g;
}

function drawStationGlow(
  ctx: CanvasRenderingContext2D,
  status: StationStatus,
  wave: number,
): void {
  if (status === 'armed') {
    softEllipse(ctx, 0, SCREEN_CY, 0.9, 0.8, TEAL, 0.18 + 0.32 * wave, 'lighter');
  } else if (status === 'done') {
    softEllipse(ctx, 0, SCREEN_CY, 0.6, 0.55, DONE_GREEN, 0.1, 'lighter');
  }
}

function drawStationKeyboard(ctx: CanvasRenderingContext2D, keys: string): void {
  ctx.fillStyle = steel(0.9);
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
  ctx.lineWidth = OUTLINE;
  ctx.strokeStyle = PROP_EDGE;
  ctx.stroke();
  // Light catching the desk's back edge and its front crease.
  ctx.fillStyle = EDGE_LIGHT;
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
  ctx.fillStyle = VENT;
  for (let i = 0; i < 3; i++) ctx.fillRect(0.06, 0.245 + i * 0.04, 0.24, 0.016);
}

function drawStationMonitor(ctx: CanvasRenderingContext2D, look: StationLook): void {
  ctx.fillStyle = steel(0.9);
  ctx.fillRect(-0.06, -0.02, 0.12, 0.06);
  ctx.beginPath();
  roundRectPath(ctx, -0.33, -0.45, 0.66, 0.44, 0.05);
  ctx.fillStyle = look.bezel;
  ctx.fill();
  ctx.lineWidth = OUTLINE;
  ctx.strokeStyle = PROP_EDGE;
  ctx.stroke();
  ctx.fillStyle = EDGE_LIGHT;
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
  ctx.fillStyle = C_TEAL;
  ctx.strokeStyle = C_TEAL;
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
  ctx.strokeStyle = rgba(DONE_GREEN, 0.7);
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
  ctx.fillStyle = css(sink(LABEL, 0.85));
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
  ctx.fillStyle = rgba(WHITE, 0.04);
  ctx.fill();
}

/** One console of a two-console station: its letter on a disc in the status color. */
function drawConsoleBadge(ctx: CanvasRenderingContext2D, look: StationLook, id: ConsoleId): void {
  ctx.beginPath();
  addCircle(ctx, BADGE_X, BADGE_Y, BADGE_R);
  ctx.fillStyle = look.led;
  ctx.fill();
  ctx.lineWidth = OUTLINE;
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
 * (strength follows pulse) and terminal lines; done = dim green check on screen; locked =
 * grey, small lock glyph. A console of a two-console station carries its letter on a
 * disc, whatever its status. No title: the operator stands right above the console, and
 * the objective bar names the station. */
export function drawStation(ctx: CanvasRenderingContext2D, o: StationOpts): void {
  const look = STATION_LOOKS[o.status];
  const wave = pulseWave(o.pulse);
  ctx.save();
  try {
    if (o.bare !== true) {
      footShadow(ctx, 0, 0.37, 0.46, 0.13);
      drawStationGlow(ctx, o.status, wave);
    }
    drawStationCabinet(ctx, look, o.status === 'armed' ? 0.35 + 0.65 * wave : 0.85);
    drawStationMonitor(ctx, look);
    drawStationScreen(ctx, o.status, wave);
    if (o.console !== null) drawConsoleBadge(ctx, look, o.console);
  } finally {
    ctx.restore();
  }
}

// ---- Fuse box ------------------------------------------------------------------------

const FUSE_BODY = steel(0.52);
const FUSE_DOOR = steel(0.4);
const WARNING_YELLOW = css(sink(AMBER, 0.08));

/** Two rows of fuses behind the box's window, their caps in the status colour. */
function drawFuseRows(ctx: CanvasRenderingContext2D, led: string, ledAlpha: number): void {
  ctx.fillStyle = steel(0.88);
  ctx.fillRect(-0.24, -0.2, 0.36, 0.3);
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 4; i++) {
      const x = -0.215 + i * 0.085;
      const y = -0.17 + row * 0.15;
      ctx.fillStyle = css(PAPER);
      ctx.fillRect(x, y, 0.05, 0.1);
      ctx.fillStyle = steel(0.2);
      ctx.fillRect(x, y, 0.05, 0.022);
      ctx.fillRect(x, y + 0.078, 0.05, 0.022);
    }
  }
  const alpha = ctx.globalAlpha;
  ctx.globalAlpha = alpha * ledAlpha;
  ctx.fillStyle = led;
  ctx.beginPath();
  addCircle(ctx, 0.23, -0.15, 0.028);
  ctx.fill();
  ctx.globalAlpha = alpha;
}

/** The warning triangle on the box's door: amber with a black bolt. */
function drawBoltSign(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(0.23, -0.06);
  ctx.lineTo(0.3, 0.07);
  ctx.lineTo(0.16, 0.07);
  ctx.closePath();
  ctx.fillStyle = WARNING_YELLOW;
  ctx.fill();
  ctx.lineWidth = 0.012;
  ctx.strokeStyle = PROP_EDGE;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0.235, -0.025);
  ctx.lineTo(0.215, 0.02);
  ctx.lineTo(0.235, 0.02);
  ctx.lineTo(0.22, 0.055);
  ctx.lineWidth = 0.012;
  ctx.stroke();
}

/** Anchor: TILE CENTER. The fuse box a circuit is worked at: a steel cabinet on the wall, its
 * fuses behind a window, a warning triangle and a status lamp; armed, it glows teal like every
 * station that is up. A short throws the world's sparks out of it (particles.ts). */
export function drawFusebox(ctx: CanvasRenderingContext2D, o: StationOpts): void {
  const look = STATION_LOOKS[o.status];
  const wave = pulseWave(o.pulse);
  ctx.save();
  try {
    if (o.bare !== true) {
      footShadow(ctx, 0, 0.3, 0.42, 0.11);
      drawStationGlow(ctx, o.status, wave);
    }
    ctx.beginPath();
    roundRectPath(ctx, -0.36, -0.42, 0.72, 0.64, 0.04);
    ctx.fillStyle = FUSE_BODY;
    ctx.fill();
    ctx.lineWidth = OUTLINE;
    ctx.strokeStyle = PROP_EDGE;
    ctx.stroke();
    ctx.fillStyle = FUSE_DOOR;
    ctx.fillRect(-0.3, -0.36, 0.6, 0.52);
    ctx.fillStyle = rgba(WHITE, 0.1);
    ctx.fillRect(-0.3, -0.36, 0.6, 0.014);
    drawFuseRows(ctx, look.led, o.status === 'armed' ? 0.35 + 0.65 * wave : 0.85);
    drawBoltSign(ctx);
    ctx.fillStyle = VENT;
    for (let i = 0; i < 3; i++) ctx.fillRect(-0.24, -0.33 + i * 0.03, 0.2, 0.012);
    if (o.console !== null) drawConsoleBadge(ctx, look, o.console);
  } finally {
    ctx.restore();
  }
}

// ---- Main switch ---------------------------------------------------------------------

export interface LeverBoxOpts {
  status: StationStatus;
  /** 0..1 looping pulse driven by the caller */
  pulse: number;
  /** how many levers it has: one for each member of the crew, two at least */
  levers: number;
  /** the thing alone, no foot shadow or glow: what its silhouette is baked from (silhouette.ts) */
  bare?: boolean;
}

/** The lever's red: emergency red leaning to orange, as such handles are painted. */
const LEVER_HANDLE = mix(EMERGENCY, REACTOR, 0.3);
const LEVER_RED = css(sink(LEVER_HANDLE, 0.28));
const LEVER_RED_LIT = css(lift(LEVER_HANDLE, 0.15));
const PLATE_YELLOW = css(sink(AMBER, 0.14));

/** One lever in its slot at `x`: up at AUS, or thrown down to EIN. */
function drawLeverInSlot(
  ctx: CanvasRenderingContext2D,
  x: number,
  down: boolean,
  lit: boolean,
): void {
  ctx.fillStyle = PROP_EDGE;
  ctx.beginPath();
  roundRectPath(ctx, x - 0.035, -0.27, 0.07, 0.36, 0.03);
  ctx.fill();
  const y = down ? 0.04 : -0.24;
  ctx.fillStyle = css(lift(STEEL, 0.35));
  ctx.fillRect(x - 0.016, y, 0.032, 0.07);
  ctx.beginPath();
  roundRectPath(ctx, x - 0.1, y - 0.04, 0.2, 0.075, 0.025);
  ctx.fillStyle = lit ? LEVER_RED_LIT : LEVER_RED;
  ctx.fill();
  ctx.lineWidth = 0.018;
  ctx.strokeStyle = PROP_EDGE;
  ctx.stroke();
  ctx.fillStyle = rgba(WHITE, 0.25);
  ctx.fillRect(x - 0.08, y - 0.032, 0.16, 0.012);
}

/** Anchor: TILE CENTER. A main switch on the wall: a steel cabinet with a yellow plate and a
 * lever for each of the crew, side by side in their slots — up while it waits, thrown down once
 * done; armed, it glows teal like every station that is up, its levers lit. */
export function drawLeverBox(ctx: CanvasRenderingContext2D, o: LeverBoxOpts): void {
  const look = STATION_LOOKS[o.status];
  const wave = pulseWave(o.pulse);
  const armed = o.status === 'armed';
  ctx.save();
  try {
    if (o.bare !== true) {
      footShadow(ctx, 0, 0.3, 0.44, 0.12);
      drawStationGlow(ctx, o.status, wave);
    }
    ctx.beginPath();
    roundRectPath(ctx, -0.38, -0.46, 0.76, 0.66, 0.05);
    ctx.fillStyle = steel(0.55);
    ctx.fill();
    ctx.lineWidth = OUTLINE;
    ctx.strokeStyle = PROP_EDGE;
    ctx.stroke();
    ctx.fillStyle = rgba(WHITE, 0.1);
    ctx.fillRect(-0.33, -0.445, 0.66, 0.012);
    ctx.fillStyle = PLATE_YELLOW;
    ctx.fillRect(-0.3, -0.4, 0.6, 0.07);
    ctx.fillStyle = rgba(sink(BRASS, 0.88), 0.75);
    for (let i = 0; i < 4; i++) ctx.fillRect(-0.24 + i * 0.13, -0.373, 0.09, 0.016);
    const n = Math.max(2, o.levers);
    for (let i = 0; i < n; i++) {
      drawLeverInSlot(ctx, -0.22 + (0.44 * i) / (n - 1), o.status === 'done', armed);
    }
    ctx.globalAlpha *= armed ? 0.35 + 0.65 * wave : 0.85;
    ctx.fillStyle = look.led;
    ctx.beginPath();
    addCircle(ctx, 0.3, 0.13, 0.025);
    ctx.fill();
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
  /** the world's text at this zoom (worldText); the label in plain tiles when left out */
  text?: WorldText;
}

const PLATE_SOCKET_R = 0.38;
const PLATE_RIM_R = 0.335;
const PLATE_BOLT = 0.18;
const PLATE_DARK = steel(0.82);

/** Recess walls: shadowed at the top, catching light at the bottom. */
function buildSocketGradient(ctx: CanvasRenderingContext2D): CanvasGradient {
  const g = ctx.createLinearGradient(0, -PLATE_SOCKET_R, 0, PLATE_SOCKET_R);
  g.addColorStop(0, css(NIGHT));
  g.addColorStop(1, steel(0.8));
  return g;
}

/** Metal top face lit from the upper left; coordinates relative to the disc center. */
function buildDiscGradient(ctx: CanvasRenderingContext2D): CanvasGradient {
  const g = ctx.createRadialGradient(-0.1, -0.12, 0.02, 0, 0, 0.32);
  g.addColorStop(0, steel(0.25));
  g.addColorStop(0.5, steel(0.55));
  g.addColorStop(1, steel(0.72));
  return g;
}

function drawPlateSocket(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.arc(0, 0, PLATE_SOCKET_R, 0, TAU);
  ctx.fillStyle = cachedGradient(ctx, buildSocketGradient, '');
  ctx.fill();
  ctx.lineWidth = 0.02;
  ctx.strokeStyle = rgba(WHITE, 0.06);
  ctx.stroke();
}

/** Camera body with viewfinder bump and lens, lit teal while pressed. */
function drawCameraGlyph(ctx: CanvasRenderingContext2D, pressed: boolean): void {
  const color = pressed ? C_TEAL : IDLE_LABEL;
  ctx.beginPath();
  roundRectPath(ctx, -0.095, -0.05, 0.19, 0.115, 0.022);
  ctx.rect(-0.04, -0.078, 0.08, 0.03);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 0.012;
  ctx.strokeStyle = rgba(BLACK, 0.55);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0.008, 0.036, 0, TAU);
  ctx.fillStyle = PLATE_DARK;
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
  ctx.strokeStyle = rgba(BLACK, 0.45);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0.009, 0.2, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.lineWidth = 0.008;
  ctx.strokeStyle = EDGE_LIGHT;
  ctx.stroke();
  ctx.beginPath();
  addCircle(ctx, -PLATE_BOLT, -PLATE_BOLT, 0.018);
  addCircle(ctx, PLATE_BOLT, -PLATE_BOLT, 0.018);
  addCircle(ctx, -PLATE_BOLT, PLATE_BOLT, 0.018);
  addCircle(ctx, PLATE_BOLT, PLATE_BOLT, 0.018);
  ctx.fillStyle = steel(0.45);
  ctx.fill();
  if (camera) {
    drawCameraGlyph(ctx, pressed);
    return;
  }
  ctx.beginPath();
  ctx.arc(0, 0, 0.065, 0, TAU);
  ctx.fillStyle = pressed ? C_TEAL : PLATE_DARK;
  ctx.fill();
  ctx.lineWidth = 0.014;
  ctx.strokeStyle = rgba(BLACK, 0.55);
  ctx.stroke();
}

/** The disc stands proud of the floor (thick side wall) or sinks in when pressed. */
function drawPlateDisc(ctx: CanvasRenderingContext2D, pressed: boolean, camera: boolean): void {
  const r = pressed ? 0.295 : 0.31;
  const cy = pressed ? 0.012 : -0.016;
  const side = pressed ? 0.008 : 0.03;
  ctx.beginPath();
  ctx.arc(0, cy + side, r, 0, TAU);
  ctx.fillStyle = steel(0.9);
  ctx.fill();
  ctx.translate(0, cy);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fillStyle = cachedGradient(ctx, buildDiscGradient, '');
  ctx.fill();
  if (pressed) {
    ctx.fillStyle = rgba(BLACK, 0.25);
    ctx.fill();
  }
  ctx.lineWidth = 0.014;
  ctx.strokeStyle = rgba(WHITE, 0.1);
  ctx.stroke();
  drawPlateEngraving(ctx, pressed, camera);
  ctx.translate(0, -cy);
}

/**
 * What a plate's label says it does: a plate that holds a door open reads „HALTEN · TÜR" —
 * HALTEN alone left open what for; the camera plate keeps its „KAMERA HALTEN", and a label a
 * mission wrote otherwise stays as written.
 */
export function plateCaption(plate: { label: string; freezesDrone: boolean }): string {
  return !plate.freezesDrone && plate.label === 'HALTEN' ? 'HALTEN · TÜR' : plate.label;
}

/** Anchor: TILE CENTER. Floor pressure plate: inset metal disc, pressed = sunk + teal rim
 * glow, label under it (world text, dark halo, uppercase); a camera plate shows a camera
 * glyph in the middle. */
export function drawPlate(ctx: CanvasRenderingContext2D, o: PlateOpts): void {
  ctx.save();
  try {
    drawPlateSocket(ctx);
    if (o.pressed) softEllipse(ctx, 0, 0, 0.6, 0.6, TEAL, 0.45, 'lighter');
    drawPlateDisc(ctx, o.pressed, o.camera);
    if (o.pressed) {
      ctx.beginPath();
      ctx.arc(0, 0.006, PLATE_RIM_R, 0, TAU);
      ctx.lineWidth = 0.024;
      ctx.strokeStyle = rgba(TEAL, 0.9);
      ctx.stroke();
    }
    const color = o.pressed ? css(lift(TEAL, 0.25)) : IDLE_LABEL;
    drawHaloText(ctx, o.label.toUpperCase(), 0, 0.41, (o.text ?? TILE_TEXT).label, color, 'top');
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
  g.addColorStop(0, steel(0.45));
  g.addColorStop(0.12, steel(0.62));
  g.addColorStop(1, steel(0.8));
  return g;
}

function buildJambGradient(ctx: CanvasRenderingContext2D): CanvasGradient {
  const g = ctx.createLinearGradient(0, -0.24, 0, 0.24);
  g.addColorStop(0, steel(0.42));
  g.addColorStop(0.08, steel(0.65));
  g.addColorStop(1, steel(0.84));
  return g;
}

/** Dark floor slot the panels run in; stays visible when the door is open. */
function drawDoorTrack(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = PROP_EDGE;
  ctx.fillRect(-0.5, -0.2, 1, 0.4);
  ctx.fillStyle = rgba(WHITE, 0.05);
  ctx.fillRect(-0.5, 0.188, 1, 0.012);
  ctx.fillStyle = rgba(BLACK, 0.6);
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
  ctx.lineWidth = OUTLINE;
  ctx.strokeStyle = PROP_EDGE;
  ctx.strokeRect(x0, -DOOR_HALF_T, DOOR_PANEL_W, 2 * DOOR_HALF_T);
  ctx.beginPath();
  addChevron(ctx, edge - 0.31);
  addChevron(ctx, edge - 0.21);
  ctx.lineWidth = 0.03;
  ctx.strokeStyle = rgba(AMBER, 0.5);
  ctx.stroke();
  // Amber light strip along the leading edge, with a faint halo.
  ctx.fillStyle = rgba(AMBER, 0.16);
  ctx.fillRect(edge - 0.12, -0.135, 0.09, 0.27);
  ctx.fillStyle = C_AMBER;
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
    softEllipse(ctx, 0, 0, 0.62, 0.48, AMBER, 0.26 * (1 - t), 'lighter');
    if (t < 1) drawDoorPanels(ctx, t * DOOR_PANEL_W);
    drawDoorJamb(ctx, -0.5);
    drawDoorJamb(ctx, 0.5 - JAMB_W);
  } finally {
    ctx.restore();
  }
}

// ---- Exit hatch ----------------------------------------------------------------------

export interface ExitHatchOpts {
  /** 0 shut … 1 open: its two leaves slide apart as the hatch grinds open; caller animates */
  open: number;
  /** 0..1 looping pulse driven by the caller */
  pulse: number;
}

/** Half the hatch's frame, and half the opening its leaves close, in tiles. */
const HATCH_HALF = 0.42;
const SHAFT_HALF = 0.31;

/** The way out under the leaves: green-white light, brightest in the middle of the gap. */
function buildShaftGradient(ctx: CanvasRenderingContext2D): CanvasGradient {
  const g = ctx.createLinearGradient(-SHAFT_HALF, 0, SHAFT_HALF, 0);
  g.addColorStop(0, css(sink(DONE_GREEN, 0.15)));
  g.addColorStop(0.5, css(lift(DONE_GREEN, 0.92)));
  g.addColorStop(1, css(sink(DONE_GREEN, 0.15)));
  return g;
}

/** The frame's border in yellow and black, slanting, as a way out is marked on a floor. */
function drawHatchStripes(ctx: CanvasRenderingContext2D, lit: boolean): void {
  ctx.save();
  ctx.beginPath();
  roundRectPath(ctx, -HATCH_HALF, -HATCH_HALF, HATCH_HALF * 2, HATCH_HALF * 2, 0.06);
  const rim = SHAFT_HALF + 0.03;
  ctx.rect(rim, -rim, -2 * rim, 2 * rim);
  ctx.clip('evenodd');
  ctx.fillStyle = lit ? C_AMBER : rgba(AMBER, 0.35);
  for (let x = -0.9; x < 0.9; x += 0.16) {
    ctx.beginPath();
    ctx.moveTo(x, -HATCH_HALF);
    ctx.lineTo(x + 0.08, -HATCH_HALF);
    ctx.lineTo(x + 0.08 + 2 * HATCH_HALF, HATCH_HALF);
    ctx.lineTo(x + 2 * HATCH_HALF, HATCH_HALF);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** One leaf, from the shaft's edge at `outer` to its leading edge at `inner`, ribbed for grip. */
function drawHatchLeaf(ctx: CanvasRenderingContext2D, outer: number, inner: number): void {
  const [x0, x1] = outer < inner ? [outer, inner] : [inner, outer];
  if (x1 - x0 <= 0.005) return;
  ctx.fillStyle = steel(0.4);
  ctx.fillRect(x0, -SHAFT_HALF, x1 - x0, SHAFT_HALF * 2);
  ctx.strokeStyle = rgba(BLACK, 0.45);
  ctx.lineWidth = 0.02;
  ctx.beginPath();
  for (let y = -SHAFT_HALF + 0.1; y < SHAFT_HALF; y += 0.1) {
    ctx.moveTo(x0 + 0.03, y);
    ctx.lineTo(x1 - 0.03, y);
  }
  ctx.stroke();
  ctx.strokeStyle = PROP_EDGE;
  ctx.lineWidth = 0.025;
  ctx.strokeRect(x0, -SHAFT_HALF, x1 - x0, SHAFT_HALF * 2);
}

/**
 * Anchor: TILE CENTER. The exit hatch in the floor: a steel frame marked in
 * yellow and black around two leaves. As `open` rises the leaves slide
 * apart and the green-white light outside shines up between them; a lamp on
 * the frame burns red while it is locked and pulses green once it opens.
 */
export function drawExitHatch(ctx: CanvasRenderingContext2D, o: ExitHatchOpts): void {
  const t = clamp01(o.open);
  const wave = pulseWave(o.pulse);
  ctx.save();
  try {
    footShadow(ctx, 0, 0.05, 0.55, 0.5);
    ctx.beginPath();
    roundRectPath(ctx, -HATCH_HALF, -HATCH_HALF, HATCH_HALF * 2, HATCH_HALF * 2, 0.06);
    ctx.fillStyle = steel(0.82);
    ctx.fill();
    ctx.lineWidth = OUTLINE;
    ctx.strokeStyle = PROP_EDGE;
    ctx.stroke();
    drawHatchStripes(ctx, t > 0);
    const gap = t * SHAFT_HALF;
    if (gap > 0) {
      ctx.fillStyle = cachedGradient(ctx, buildShaftGradient, '');
      ctx.fillRect(-gap, -SHAFT_HALF, gap * 2, SHAFT_HALF * 2);
      softEllipse(ctx, 0, 0, 0.5, 0.5, DONE_GREEN, 0.35 * t * (0.75 + 0.25 * wave), 'lighter');
    }
    drawHatchLeaf(ctx, -SHAFT_HALF, -gap);
    drawHatchLeaf(ctx, SHAFT_HALF, gap);
    ctx.beginPath();
    addCircle(ctx, 0, -HATCH_HALF + 0.045, 0.035);
    ctx.fillStyle = t > 0 ? css(DONE_GREEN) : css(sink(EMERGENCY, 0.3));
    ctx.globalAlpha *= t > 0 ? 0.55 + 0.45 * wave : 0.8;
    ctx.fill();
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
  /** the world's text at this zoom (worldText); the label in plain tiles when left out */
  text?: WorldText;
  /** the thing alone — no foot shadow, glow or label: what its silhouette is baked from */
  bare?: boolean;
}

const READ_LABEL = css(lift(READ_BLUE, 0.3));
/** Lengths of the lines of print on a page, top to bottom. */
const PRINT = [0.2, 0.17, 0.21, 0.12, 0.19] as const;
const C_PAPER = css(PAPER);
const PAPER_PRINT = rgba(sink(WOOD, 0.6), 0.5);
/** Laid over the paper of a manual object that is not needed right now. */
const PAPER_DIM = rgba(BLACK, 0.3);
/** The ink of a printed heading, and the blue of a book's cover. */
const PRINT_BLUE = sink(READ_BLUE, 0.65);
/** A ribbon, a pin: an orange-red accent. */
const RIBBON = css(sink(REACTOR, 0.25));
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
  ctx.fillStyle = css(PRINT_BLUE);
  ctx.fill();
  ctx.beginPath();
  addPage(ctx, -1);
  addPage(ctx, 1);
  ctx.fillStyle = C_PAPER;
  ctx.fill();
  if (!active) {
    ctx.fillStyle = PAPER_DIM;
    ctx.fill();
  }
  ctx.fillStyle = rgba(sink(WOOD, 0.55), 0.22);
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
  ctx.fillStyle = RIBBON;
  ctx.fill();
}

/** Foot, column and a slanted desk with a lip, the open book on top. */
function drawLectern(ctx: CanvasRenderingContext2D, active: boolean): void {
  ctx.beginPath();
  roundRectPath(ctx, -0.17, 0.27, 0.34, 0.09, 0.04);
  ctx.fillStyle = steel(0.82);
  ctx.fill();
  ctx.fillStyle = steel(0.75);
  ctx.fillRect(-0.05, 0.04, 0.1, 0.25);
  ctx.fillStyle = rgba(WHITE, 0.06);
  ctx.fillRect(-0.05, 0.04, 0.018, 0.25);
  ctx.beginPath();
  ctx.moveTo(-0.33, -0.3);
  ctx.lineTo(0.33, -0.3);
  ctx.lineTo(0.39, 0.07);
  ctx.lineTo(-0.39, 0.07);
  ctx.closePath();
  ctx.fillStyle = steel(0.62);
  ctx.fill();
  ctx.lineWidth = OUTLINE;
  ctx.strokeStyle = PROP_EDGE;
  ctx.stroke();
  ctx.fillStyle = steel(0.78);
  ctx.fillRect(-0.39, 0.05, 0.78, 0.05);
  drawOpenBook(ctx, active);
}

function buildPlanGradient(ctx: CanvasRenderingContext2D): CanvasGradient {
  const g = ctx.createLinearGradient(0, PLAN_Y, 0, PLAN_Y + PLAN_H);
  g.addColorStop(0, css(sink(READ_BLUE, 0.75)));
  g.addColorStop(1, PROP_EDGE);
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
  ctx.strokeStyle = rgba(READ_BLUE, 0.3);
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
    ctx.strokeStyle = C_BLUE;
    ctx.globalAlpha = alpha * (0.35 + 0.45 * wave);
    ctx.stroke();
  }
  ctx.globalAlpha = alpha;
}

/** Upright cabinet: the plan on its screen, a keyboard ledge and vents. */
function drawTerminal(ctx: CanvasRenderingContext2D, active: boolean, wave: number): void {
  ctx.beginPath();
  roundRectPath(ctx, -0.29, -0.44, 0.58, 0.8, 0.05);
  ctx.fillStyle = steel(0.76);
  ctx.fill();
  ctx.lineWidth = OUTLINE;
  ctx.strokeStyle = PROP_EDGE;
  ctx.stroke();
  ctx.fillStyle = EDGE_LIGHT;
  ctx.fillRect(-0.24, -0.43, 0.48, 0.012);
  ctx.beginPath();
  roundRectPath(ctx, -0.25, -0.39, 0.5, 0.36, 0.03);
  ctx.fillStyle = steel(0.9);
  ctx.fill();
  ctx.beginPath();
  roundRectPath(ctx, PLAN_X, PLAN_Y, PLAN_W, PLAN_H, 0.02);
  ctx.fillStyle = cachedGradient(ctx, buildPlanGradient, '');
  ctx.fill();
  drawPlan(ctx, active, wave);
  ctx.beginPath();
  roundRectPath(ctx, -0.33, 0.01, 0.66, 0.1, 0.03);
  ctx.fillStyle = steel(0.66);
  ctx.fill();
  ctx.lineWidth = 0.02;
  ctx.strokeStyle = PROP_EDGE;
  ctx.stroke();
  ctx.fillStyle = rgba(READ_BLUE, 0.22);
  for (let i = 0; i < 6; i++) ctx.fillRect(-0.27 + i * 0.09, 0.035, 0.07, 0.025);
  ctx.fillStyle = VENT;
  for (let i = 0; i < 3; i++) ctx.fillRect(-0.18, 0.18 + i * 0.045, 0.36, 0.016);
}

/** A ruled table with a column of colour swatches, as printed on the chart. */
function drawChartTable(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = rgba(PRINT_BLUE, 0.75);
  ctx.fillRect(-0.34, -0.42, 0.68, 0.075);
  ctx.fillStyle = css(ALARM);
  ctx.fillRect(-0.3, -0.31, 0.12, 0.045);
  ctx.fillStyle = C_AMBER;
  ctx.fillRect(-0.3, -0.23, 0.12, 0.045);
  ctx.fillStyle = C_TEAL;
  ctx.fillRect(-0.3, -0.15, 0.12, 0.045);
  ctx.fillStyle = C_BLUE;
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
  ctx.strokeStyle = rgba(sink(STEEL, 0.6), 0.5);
  ctx.stroke();
  ctx.fillStyle = rgba(sink(STEEL, 0.6), 0.55);
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
  ctx.strokeStyle = steel(0.58);
  ctx.stroke();
  ctx.beginPath();
  roundRectPath(ctx, -0.38, -0.46, 0.76, 0.56, 0.03);
  ctx.fillStyle = steel(0.58);
  ctx.fill();
  ctx.lineWidth = OUTLINE;
  ctx.strokeStyle = PROP_EDGE;
  ctx.stroke();
  ctx.fillStyle = css(lift(LABEL, 0.45));
  ctx.fillRect(-0.34, -0.42, 0.68, 0.48);
  drawChartTable(ctx);
  if (!active) {
    ctx.fillStyle = PAPER_DIM;
    ctx.fillRect(-0.34, -0.42, 0.68, 0.48);
  }
  ctx.fillStyle = steel(0.45);
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
  ctx.fillStyle = C_PAPER;
  ctx.fill();
  if (!active) {
    ctx.fillStyle = PAPER_DIM;
    ctx.fill();
  }
  ctx.fillStyle = rgba(PRINT_BLUE, 0.75);
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
  ctx.fillStyle = steel(0.58);
  ctx.fill();
  ctx.translate(0, HOOK_Y);
  ctx.rotate(-0.05);
  ctx.translate(0, -HOOK_Y);
  ctx.beginPath();
  roundRectPath(ctx, -0.17, -0.41, 0.4, 0.6, 0.035);
  ctx.fillStyle = rgba(BLACK, 0.4);
  ctx.fill();
  ctx.beginPath();
  roundRectPath(ctx, -0.2, -0.44, 0.4, 0.6, 0.035);
  ctx.fillStyle = css(sink(WOOD, 0.2));
  ctx.fill();
  ctx.lineWidth = 0.02;
  ctx.strokeStyle = css(sink(WOOD, 0.6));
  ctx.stroke();
  drawSheet(ctx, -0.16, -0.35, 0.32, 0.46, active);
  ctx.beginPath();
  roundRectPath(ctx, -0.05, -0.5, 0.1, 0.05, 0.018);
  ctx.fillStyle = css(sink(LABEL, 0.1));
  ctx.fill();
  ctx.beginPath();
  roundRectPath(ctx, -0.11, -0.47, 0.22, 0.09, 0.025);
  ctx.fillStyle = css(lift(STEEL, 0.33));
  ctx.fill();
  ctx.lineWidth = 0.012;
  ctx.strokeStyle = steel(0.55);
  ctx.stroke();
  ctx.fillStyle = rgba(WHITE, 0.35);
  ctx.fillRect(-0.08, -0.455, 0.16, 0.012);
}

const LOCKER_X = -0.23;
const LOCKER_TOP = -0.42;
const LOCKER_W = 0.46;
const LOCKER_H = 0.72;

/** Four slits pressed into a locker door from `y` down, each with a lit lower lip. */
function drawLouvres(ctx: CanvasRenderingContext2D, y: number): void {
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = rgba(BLACK, 0.55);
    ctx.fillRect(-0.13, y + i * 0.04, 0.26, 0.016);
    ctx.fillStyle = EDGE_LIGHT;
    ctx.fillRect(-0.13, y + i * 0.04 + 0.016, 0.26, 0.008);
  }
}

/** The shut door: louvres top and bottom, a name card and the handle. */
function drawLockerDoor(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  roundRectPath(ctx, LOCKER_X, LOCKER_TOP, LOCKER_W, LOCKER_H, 0.025);
  ctx.fillStyle = steel(0.27);
  ctx.fill();
  ctx.lineWidth = 0.014;
  ctx.strokeStyle = rgba(BLACK, 0.55);
  ctx.stroke();
  ctx.fillStyle = rgba(WHITE, 0.08);
  ctx.fillRect(LOCKER_X + 0.02, LOCKER_TOP + 0.012, LOCKER_W - 0.04, 0.012);
  drawLouvres(ctx, -0.35);
  drawLouvres(ctx, 0.13);
  ctx.fillStyle = css(sink(PAPER, 0.15));
  ctx.fillRect(-0.08, -0.16, 0.16, 0.06);
  ctx.beginPath();
  roundRectPath(ctx, 0.12, -0.08, 0.045, 0.17, 0.018);
  ctx.fillStyle = css(lift(STEEL, 0.33));
  ctx.fill();
  ctx.lineWidth = 0.012;
  ctx.strokeStyle = PROP_EDGE;
  ctx.stroke();
}

/** Searched: the door swung out past its hinge, a shelf inside and a sheet of rules. */
function drawLockerOpen(ctx: CanvasRenderingContext2D, active: boolean): void {
  ctx.beginPath();
  roundRectPath(ctx, LOCKER_X, LOCKER_TOP, LOCKER_W, LOCKER_H, 0.025);
  ctx.fillStyle = steel(0.88);
  ctx.fill();
  ctx.fillStyle = steel(0.4);
  ctx.fillRect(LOCKER_X, -0.27, LOCKER_W, 0.03);
  ctx.fillStyle = rgba(WHITE, 0.08);
  ctx.fillRect(LOCKER_X, -0.27, LOCKER_W, 0.008);
  ctx.save();
  ctx.rotate(0.05);
  drawSheet(ctx, -0.1, -0.17, 0.22, 0.32, active);
  ctx.restore();
  ctx.beginPath();
  addCircle(ctx, 0.008, -0.155, 0.018);
  ctx.fillStyle = RIBBON;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(LOCKER_X, LOCKER_TOP);
  ctx.lineTo(LOCKER_X - 0.16, LOCKER_TOP - 0.05);
  ctx.lineTo(LOCKER_X - 0.16, LOCKER_TOP + LOCKER_H + 0.05);
  ctx.lineTo(LOCKER_X, LOCKER_TOP + LOCKER_H);
  ctx.closePath();
  ctx.fillStyle = steel(0.42);
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
  ctx.strokeStyle = rgba(BLACK, 0.5);
  ctx.stroke();
}

/** A grey steel locker, shut or — once searched — standing open with the rules inside. */
function drawLocker(ctx: CanvasRenderingContext2D, active: boolean, opened: boolean): void {
  ctx.beginPath();
  roundRectPath(ctx, -0.27, -0.47, 0.54, 0.84, 0.04);
  ctx.fillStyle = steel(0.58);
  ctx.fill();
  ctx.lineWidth = OUTLINE;
  ctx.strokeStyle = PROP_EDGE;
  ctx.stroke();
  ctx.fillStyle = EDGE_LIGHT;
  ctx.fillRect(-0.23, -0.46, 0.46, 0.012);
  if (opened) drawLockerOpen(ctx, active);
  else drawLockerDoor(ctx);
}

const DRAWER_X = -0.26;
const DRAWER_W = 0.52;
const DRAWER_H = 0.22;
/** Tops of the cabinet's three drawers, top to bottom. */
const DRAWER_TOPS = [-0.38, -0.13, 0.12] as const;
const DRAWER_FRONT = css(sink(LINO, 0.55));
/** A drawer pulled out catches more of the light. */
const DRAWER_FRONT_OUT = css(sink(LINO, 0.45));
/** Tabs of the hanging files in the open drawer. */
const FILE_TABS = [css(ALARM), C_BLUE, C_AMBER, css(DONE_GREEN), C_TEAL] as const;
/** The brass of a padlock, warmer than a plaque's. */
const PADLOCK_BRASS = mix(BRASS, AMBER, 0.3);

/** A drawer front with its label card and pull handle, `top` its upper edge. */
function drawDrawer(ctx: CanvasRenderingContext2D, top: number, front: string): void {
  ctx.beginPath();
  roundRectPath(ctx, DRAWER_X, top, DRAWER_W, DRAWER_H, 0.02);
  ctx.fillStyle = front;
  ctx.fill();
  ctx.lineWidth = 0.012;
  ctx.strokeStyle = rgba(BLACK, 0.55);
  ctx.stroke();
  ctx.fillStyle = EDGE_LIGHT;
  ctx.fillRect(DRAWER_X + 0.02, top + 0.01, DRAWER_W - 0.04, 0.01);
  ctx.fillStyle = css(sink(PAPER, 0.13));
  ctx.fillRect(-0.07, top + 0.04, 0.14, 0.05);
  ctx.beginPath();
  roundRectPath(ctx, -0.1, top + 0.125, 0.2, 0.04, 0.016);
  ctx.fillStyle = css(lift(LINO, 0.25));
  ctx.fill();
  ctx.lineWidth = 0.01;
  ctx.strokeStyle = PROP_EDGE;
  ctx.stroke();
}

/** A hasp over the top drawer and a brass padlock hanging from it. */
function drawPadlock(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  roundRectPath(ctx, 0.15, -0.43, 0.05, 0.17, 0.015);
  ctx.fillStyle = css(sink(LINO, 0.3));
  ctx.fill();
  ctx.lineWidth = 0.012;
  ctx.strokeStyle = PROP_EDGE;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0.125, -0.21);
  ctx.arc(0.175, -0.25, 0.05, Math.PI, 0);
  ctx.lineTo(0.225, -0.21);
  ctx.lineWidth = 0.024;
  ctx.strokeStyle = css(lift(LABEL, 0.35));
  ctx.stroke();
  ctx.beginPath();
  roundRectPath(ctx, 0.095, -0.225, 0.16, 0.13, 0.03);
  ctx.fillStyle = css(PADLOCK_BRASS);
  ctx.fill();
  ctx.lineWidth = 0.014;
  ctx.strokeStyle = css(sink(BRASS, 0.65));
  ctx.stroke();
  ctx.fillStyle = rgba(WHITE, 0.3);
  ctx.fillRect(0.115, -0.212, 0.12, 0.014);
  ctx.beginPath();
  addCircle(ctx, 0.175, -0.17, 0.017);
  ctx.rect(0.168, -0.165, 0.014, 0.035);
  ctx.fillStyle = css(sink(BRASS, 0.75));
  ctx.fill();
}

/** Unlocked: the top drawer pulled out, its files and a sheet of rules standing up in it. */
function drawOpenDrawer(ctx: CanvasRenderingContext2D, active: boolean): void {
  const top = DRAWER_TOPS[0];
  const front = top + 0.15;
  ctx.fillStyle = css(sink(LINO, 0.92));
  ctx.fillRect(DRAWER_X, top, DRAWER_W, DRAWER_H);
  for (let i = 0; i < FILE_TABS.length; i++) {
    const x = DRAWER_X + 0.04 + i * 0.09;
    ctx.fillStyle = i % 2 === 0 ? css(mix(BRASS, PAPER, 0.3)) : css(sink(BRASS, 0.15));
    ctx.fillRect(x, top + 0.03, 0.08, front - top);
    ctx.fillStyle = FILE_TABS[i] ?? C_AMBER;
    ctx.fillRect(x + 0.012, top + 0.005, 0.035, 0.03);
  }
  drawSheet(ctx, -0.09, top - 0.1, 0.18, 0.24, active);
  drawDrawer(ctx, front, DRAWER_FRONT_OUT);
}

/** A filing cabinet under a padlock or — once unlocked — with its top drawer pulled out. */
function drawCabinet(ctx: CanvasRenderingContext2D, active: boolean, opened: boolean): void {
  ctx.beginPath();
  roundRectPath(ctx, -0.3, -0.43, 0.6, 0.8, 0.035);
  ctx.fillStyle = css(sink(LINO, 0.75));
  ctx.fill();
  ctx.lineWidth = OUTLINE;
  ctx.strokeStyle = PROP_EDGE;
  ctx.stroke();
  ctx.fillStyle = EDGE_LIGHT;
  ctx.fillRect(-0.26, -0.42, 0.52, 0.012);
  for (const top of opened ? DRAWER_TOPS.slice(1) : DRAWER_TOPS) drawDrawer(ctx, top, DRAWER_FRONT);
  if (opened) drawOpenDrawer(ctx, active);
  else drawPadlock(ctx);
}

/** Anchor: TILE CENTER. Where printed rules lie: an open book on a lectern, a terminal
 * showing a plan, a chart on an easel, a clipboard on a hook in the wall above, a grey locker
 * (ajar once searched, the rules inside) or a filing cabinet under a padlock (gone once
 * unlocked, the top drawer pulled out). Covering the armed station = blue glow (strength
 * follows pulse) and lit paper or screen; label under it (world text, dark halo). */
export function drawManualObject(ctx: CanvasRenderingContext2D, o: ManualObjectOpts): void {
  const wave = pulseWave(o.pulse);
  const dressed = o.bare !== true;
  ctx.save();
  try {
    // A clipboard hangs on the wall and casts its shadow there.
    if (dressed && o.kind !== 'clipboard') footShadow(ctx, 0, 0.36, 0.42, 0.12);
    if (dressed && o.active) {
      softEllipse(ctx, 0, -0.12, 0.85, 0.75, READ_BLUE, 0.14 + 0.26 * wave, 'lighter');
    }
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
    if (dressed) {
      const color = o.active ? READ_LABEL : IDLE_LABEL;
      drawHaloText(ctx, o.label, 0, 0.41, (o.text ?? TILE_TEXT).label, color, 'top');
    }
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
  /** the world's text at this zoom (worldText); the label in plain tiles when left out */
  text?: WorldText;
}

/** Brushed brass, lit from the top. */
function buildPlaqueGradient(ctx: CanvasRenderingContext2D): CanvasGradient {
  const g = ctx.createLinearGradient(0, -0.31, 0, 0.07);
  g.addColorStop(0, css(BRASS));
  g.addColorStop(1, css(sink(BRASS, 0.42)));
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
  ctx.fillStyle = rgba(lift(BRASS, 0.75), 0.28);
  ctx.fill();
  ctx.beginPath();
  addSerial(ctx, 0);
  ctx.rect(-0.2, -0.235, 0.4, 0.014);
  addCircle(ctx, -0.1, -0.025, 0.022);
  addCircle(ctx, 0, -0.025, 0.022);
  addCircle(ctx, 0.1, -0.025, 0.022);
  ctx.fillStyle = rgba(sink(BRASS, 0.8), 0.8);
  ctx.fill();
}

function drawSeenTick(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.arc(0.3, -0.3, 0.07, 0, TAU);
  ctx.fillStyle = C_TEAL;
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
  ctx.strokeStyle = css(sink(TEAL, 0.85));
  ctx.stroke();
}

/** Anchor: TILE CENTER. The Laborkennung: a brass plaque on two posts, a serial's outline
 * and three lamps engraved; amber glow (strength follows pulse) until this player has read
 * it, then a teal tick. Label under it (world text, dark halo). */
export function drawSign(ctx: CanvasRenderingContext2D, o: SignOpts): void {
  const wave = pulseWave(o.pulse);
  ctx.save();
  try {
    footShadow(ctx, 0, 0.33, 0.3, 0.09);
    softEllipse(ctx, 0, -0.12, 0.75, 0.6, AMBER, o.seen ? 0.06 : 0.12 + 0.22 * wave, 'lighter');
    ctx.fillStyle = steel(0.75);
    ctx.fillRect(-0.2, 0.04, 0.05, 0.28);
    ctx.fillRect(0.15, 0.04, 0.05, 0.28);
    ctx.beginPath();
    roundRectPath(ctx, -0.32, -0.31, 0.64, 0.38, 0.04);
    ctx.fillStyle = cachedGradient(ctx, buildPlaqueGradient, '');
    ctx.fill();
    ctx.lineWidth = OUTLINE;
    ctx.strokeStyle = PROP_EDGE;
    ctx.stroke();
    ctx.fillStyle = rgba(WHITE, 0.22);
    ctx.fillRect(-0.28, -0.3, 0.56, 0.012);
    ctx.beginPath();
    addCircle(ctx, -0.27, -0.26, 0.016);
    addCircle(ctx, 0.27, -0.26, 0.016);
    addCircle(ctx, -0.27, 0.02, 0.016);
    addCircle(ctx, 0.27, 0.02, 0.016);
    ctx.fillStyle = css(sink(BRASS, 0.75));
    ctx.fill();
    drawEngraving(ctx);
    if (o.seen) drawSeenTick(ctx);
    const color = o.seen ? IDLE_LABEL : css(lift(AMBER, 0.2));
    drawHaloText(ctx, o.label, 0, 0.36, (o.text ?? TILE_TEXT).label, color, 'top');
  } finally {
    ctx.restore();
  }
}

// ---- Emergency lamp ------------------------------------------------------------------

export interface EmergencyLampOpts {
  /** how far it burns, 0 (the power still on: dark glass) to 1 */
  glow: number;
  /** on a wall, the way it shines in radians (0 east, π/2 south); null on the ceiling */
  facing: number | null;
}

const LAMP_HOUSING = steel(0.58);
const LAMP_GLASS_DARK = css(sink(EMERGENCY, 0.72));
/** The white-hot middle of a burning lens. */
const LAMP_CORE: Rgb = lift(EMERGENCY, 0.78);

/** The lens: dark red glass, or burning red with a white-hot core. */
function drawLampLens(ctx: CanvasRenderingContext2D, cy: number, r: number, glow: number): void {
  ctx.beginPath();
  ctx.ellipse(0, cy, r, r * 0.7, 0, 0, TAU);
  ctx.fillStyle = glow > 0 ? rgba(EMERGENCY, 0.45 + 0.55 * glow) : LAMP_GLASS_DARK;
  ctx.fill();
  ctx.lineWidth = 0.014;
  ctx.strokeStyle = PROP_EDGE;
  ctx.stroke();
  if (glow > 0) {
    softEllipse(ctx, 0, cy, r * 0.55, r * 0.4, LAMP_CORE, 0.8 * glow, 'lighter');
    softEllipse(ctx, 0, cy, r * 3, r * 2.4, EMERGENCY, 0.35 * glow, 'lighter');
  }
}

/**
 * Anchor: WHERE ITS LIGHT COMES FROM (light.ts `lampMount`). A small emergency lamp: on a
 * wall, a housing on the wall's face with its lens toward the floor; on the ceiling, a round
 * housing seen from below with the lens in its middle. Dark red glass while the power is on,
 * burning red once the lights are out; the light it throws is the light pass's.
 */
export function drawEmergencyLamp(ctx: CanvasRenderingContext2D, o: EmergencyLampOpts): void {
  const glow = clamp01(o.glow);
  ctx.save();
  try {
    if (o.facing === null) {
      ctx.beginPath();
      addCircle(ctx, 0, 0, 0.17);
      ctx.fillStyle = LAMP_HOUSING;
      ctx.fill();
      ctx.lineWidth = 0.02;
      ctx.strokeStyle = PROP_EDGE;
      ctx.stroke();
      drawLampLens(ctx, 0, 0.11, glow);
      return;
    }
    // Local +y points the way it shines; the housing sits on the wall behind the anchor.
    ctx.rotate(o.facing - Math.PI / 2);
    ctx.beginPath();
    roundRectPath(ctx, -0.18, -0.22, 0.36, 0.17, 0.04);
    ctx.fillStyle = LAMP_HOUSING;
    ctx.fill();
    ctx.lineWidth = 0.02;
    ctx.strokeStyle = PROP_EDGE;
    ctx.stroke();
    ctx.fillStyle = rgba(WHITE, 0.12);
    ctx.fillRect(-0.15, -0.205, 0.3, 0.012);
    drawLampLens(ctx, -0.06, 0.12, glow);
  } finally {
    ctx.restore();
  }
}

// ---- A note of the last shift ---------------------------------------------------------

export interface PinnedNoteOpts {
  /** on a wall, the way its face looks in radians (0 east, π/2 south); null on the floor */
  facing: number | null;
  /** somebody of the crew has read it: no call for attention any more */
  read: boolean;
  /** 0..1 looping pulse driven by the caller */
  pulse: number;
}

/** The sheet's paper, a shade warmer than a printed page: it was torn off a pad. */
const NOTE_PAPER = css(mix(PAPER, WHITE, 0.35));
/** The last shift's ballpoint. */
const NOTE_INK = rgba(sink(READ_BLUE, 0.55), 0.85);
/** The pin's head: the lab's alarm red, a highlight on its top left. */
const PIN_HEAD = css(sink(ALARM, 0.2));
const PIN_SHINE = rgba(WHITE, 0.6);
/** Lines of handwriting, as fractions of the sheet's width; the last one short. */
const SCRAWL = [0.82, 0.7, 0.86, 0.48] as const;

/** A sheet of `w` × `h` tiles round the origin's top, with its lines of handwriting. */
function drawNoteSheet(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = rgba(BLACK, 0.35);
  ctx.fillRect(-w / 2 + 0.025, 0.03, w, h);
  ctx.beginPath();
  ctx.moveTo(-w / 2, 0);
  ctx.lineTo(w / 2, 0);
  ctx.lineTo(w / 2, h - 0.07);
  ctx.lineTo(w / 2 - 0.07, h);
  ctx.lineTo(-w / 2, h);
  ctx.closePath();
  ctx.fillStyle = NOTE_PAPER;
  ctx.fill();
  ctx.lineWidth = OUTLINE * 0.7;
  ctx.strokeStyle = PROP_EDGE;
  ctx.stroke();
  // The dog-ear at the foot, folded back.
  ctx.beginPath();
  ctx.moveTo(w / 2, h - 0.07);
  ctx.lineTo(w / 2 - 0.07, h - 0.07);
  ctx.lineTo(w / 2 - 0.07, h);
  ctx.closePath();
  ctx.fillStyle = css(sink(PAPER, 0.2));
  ctx.fill();
  ctx.beginPath();
  SCRAWL.forEach((length, i) => {
    const y = 0.09 + i * ((h - 0.14) / SCRAWL.length);
    const x = -w / 2 + 0.05;
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + (w - 0.1) * length * 0.5, y - 0.012, x + (w - 0.1) * length, y);
  });
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.014;
  ctx.strokeStyle = NOTE_INK;
  ctx.stroke();
}

/** The pin at the origin: a red head with its shine, its shadow down and right. */
function drawPin(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  addCircle(ctx, 0.018, 0.022, 0.034);
  ctx.fillStyle = rgba(BLACK, 0.4);
  ctx.fill();
  ctx.beginPath();
  addCircle(ctx, 0, 0, 0.034);
  ctx.fillStyle = PIN_HEAD;
  ctx.fill();
  ctx.lineWidth = 0.01;
  ctx.strokeStyle = PROP_EDGE;
  ctx.stroke();
  ctx.beginPath();
  addCircle(ctx, -0.01, -0.011, 0.011);
  ctx.fillStyle = PIN_SHINE;
  ctx.fill();
}

/**
 * Anchor: WHERE IT HANGS (notes.ts `noteMount`). A note of the last shift: on
 * a wall, a sheet pinned to the face that looks into the floor it is read
 * from, its pin at the top, a little askew; on the floor, the sheet lying
 * there, turned. Handwriting in blue ballpoint, a dog-ear. Until somebody of
 * the crew has read it, a faint reading-blue glow (strength follows pulse)
 * calls for attention.
 */
export function drawPinnedNote(ctx: CanvasRenderingContext2D, o: PinnedNoteOpts): void {
  const call = o.read ? 0 : 0.08 + 0.14 * pulseWave(o.pulse);
  ctx.save();
  try {
    if (o.facing === null) {
      ctx.rotate(-0.32);
      softEllipse(ctx, 0, 0, 0.42, 0.34, READ_BLUE, call, 'lighter');
      ctx.translate(0, -SHEET_ON_FLOOR);
      drawNoteSheet(ctx, 0.36, 0.3);
      return;
    }
    // Local +y points away from the wall, toward the floor; the sheet hangs on the face.
    ctx.rotate(o.facing - Math.PI / 2);
    softEllipse(ctx, 0, -0.36, 0.4, 0.34, READ_BLUE, call, 'lighter');
    ctx.translate(0, -SHEET_ON_WALL);
    ctx.rotate(-0.07);
    drawNoteSheet(ctx, 0.3, 0.38);
    drawPin(ctx);
  } finally {
    ctx.restore();
  }
}

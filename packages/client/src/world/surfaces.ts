import type { RoomKind } from '@escapelab/core';
import { OUTLINE, seededRandom } from './brush.js';
import {
  AMBER,
  BLACK,
  CONCRETE,
  css,
  inLight,
  INK,
  lift,
  LINO,
  mix,
  PAPER,
  rgba,
  SERVER_BLUE,
  sink,
  STEEL,
  WALL_CROWN,
  WALL_FACE,
  WHITE,
  WOOD,
  type Rgb,
} from './palette.js';

/**
 * The lab's floors and walls, as the atlas bakes them (atlas.ts): a floor
 * for every kind of room in a few variants — concrete with its wear, the
 * archive's planks, the server room's raised panels, the reactor's tread
 * plate and hazard stripes — and walls seen from above in three quarters: a
 * crown, lighter, and where the room south of a wall looks at it a face,
 * darker and painted after that room, casting a soft shadow a tile long onto
 * the floor below. All in tile space: 1 is a tile, drawn into a context
 * scaled to the sprite's pixels.
 */

/** What a floor is laid for: a room's kind, or a plain lab room. */
export type FloorKind = RoomKind | 'plain';

/** Floor variants: four plain ones, a worn band across or along, dust in one corner. */
export const FLOOR_BASE = 4;
export const WORN_ACROSS = 4;
export const WORN_ALONG = 5;
export const CORNER_NW = 6;
export const CORNER_NE = 7;
export const CORNER_SW = 8;
export const CORNER_SE = 9;
export const FLOOR_VARIANTS = 10;

/** A wall's neighbours that are floor, as bits: north, east, south, west. */
export const FLOOR_N = 1;
export const FLOOR_E = 2;
export const FLOOR_S = 4;
export const FLOOR_W = 8;

/** How far down a wall with a face its crown reaches, in tiles; the face fills the rest. */
export const CROWN_H = 0.38;
/** How dark the wall's shadow falls onto the floor right below it. */
const DROP_SHADOW = 0.4;

/** A sprite to bake: a floor tile, or a wall tile with the floor round it. */
export type SurfaceSpec =
  | { floor: FloorKind; variant: number; lit: boolean }
  | { wall: FloorKind; mask: number; lit: boolean; faceLit: boolean };

/** Whether a wall tile shows a face: the floor south of it looks at it. */
export function hasFace(mask: number): boolean {
  return (mask & FLOOR_S) !== 0;
}

/** How many tiles tall a surface's sprite is: a wall with a face casts its shadow below. */
export function spriteHeight(spec: SurfaceSpec): number {
  return 'wall' in spec && hasFace(spec.mask) ? 2 : 1;
}

/** A material in the light of the sprite, as a CSS colour. */
type Paint = (rgb: Rgb) => string;

const painter =
  (lit: boolean): Paint =>
  (rgb) =>
    css(inLight(rgb, lit));

// ── floors ─────────────────────────────────────────────────────────────────

/** Each kind's floor material. */
const FLOOR_BASE_COLOUR: Readonly<Record<FloorKind, Rgb>> = {
  plain: mix(CONCRETE, STEEL, 0.45),
  corridor: CONCRETE,
  archive: WOOD,
  server: lift(mix(STEEL, CONCRETE, 0.3), 0.2),
  machine: sink(mix(CONCRETE, LINO, 0.22), 0.38),
  lab: LINO,
  reactor: sink(STEEL, 0.28),
  control: mix(sink(STEEL, 0.4), SERVER_BLUE, 0.08),
};

/** Specks of grit scattered over a tile, lighter and darker than the floor. */
function grit(g: CanvasRenderingContext2D, base: Rgb, paint: Paint, rand: () => number): void {
  for (let i = 0; i < 46; i++) {
    const light = rand() < 0.5;
    g.fillStyle = paint(light ? lift(base, 0.12) : sink(base, 0.16));
    const r = 0.006 + rand() * 0.012;
    g.fillRect(rand(), rand(), r, r);
  }
}

/** The joints a slab floor is laid with: a dark line on the tile's top and left edge. */
function joints(g: CanvasRenderingContext2D, base: Rgb, paint: Paint, px: number): void {
  g.fillStyle = paint(sink(base, 0.42));
  g.fillRect(0, 0, 1, 1.5 / px);
  g.fillRect(0, 0, 1.5 / px, 1);
  g.fillStyle = paint(lift(base, 0.08));
  g.fillRect(1.5 / px, 1.5 / px, 1, 1 / px);
}

/** A dark blot, a stain on the floor. */
function stain(g: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number): void {
  g.fillStyle = rgba(BLACK, alpha);
  g.beginPath();
  g.ellipse(x, y, r, r * 0.7, 0.4, 0, Math.PI * 2);
  g.ellipse(x + r * 0.6, y + r * 0.3, r * 0.45, r * 0.35, 0, 0, Math.PI * 2);
  g.fill();
}

function concreteFloor(g: CanvasRenderingContext2D, variant: number, ctx: FloorCtx): void {
  const { base, paint, rand, px } = ctx;
  grit(g, base, paint, rand);
  joints(g, base, paint, px);
  if (variant === 1) {
    g.beginPath();
    g.moveTo(0.15, 0.35);
    g.lineTo(0.38, 0.47);
    g.lineTo(0.52, 0.44);
    g.lineTo(0.78, 0.62);
    g.lineWidth = 1 / px;
    g.strokeStyle = paint(sink(base, 0.28));
    g.stroke();
  } else if (variant === 2) {
    stain(g, 0.55, 0.6, 0.16, 0.16);
  } else if (variant === 3) {
    // A round drain cover let into the slab.
    g.beginPath();
    g.arc(0.5, 0.5, 0.17, 0, Math.PI * 2);
    g.fillStyle = paint(sink(STEEL, 0.45));
    g.fill();
    g.lineWidth = OUTLINE;
    g.strokeStyle = paint(sink(base, 0.55));
    g.stroke();
    g.fillStyle = paint(sink(STEEL, 0.7));
    for (let i = -2; i <= 2; i++) g.fillRect(0.5 + i * 0.05 - 0.012, 0.4, 0.024, 0.2);
  }
}

function plankFloor(g: CanvasRenderingContext2D, variant: number, ctx: FloorCtx): void {
  const { base, paint, rand, px } = ctx;
  for (let i = 0; i < 4; i++) {
    const tone = (rand() - 0.5) * 0.14;
    g.fillStyle = paint(tone > 0 ? lift(base, tone) : sink(base, -tone));
    g.fillRect(0, i * 0.25, 1, 0.25);
    g.strokeStyle = paint(sink(base, 0.2));
    g.lineWidth = 1 / px;
    g.beginPath();
    for (let k = 0; k < 3; k++) {
      const y = i * 0.25 + 0.05 + rand() * 0.15;
      g.moveTo(0, y);
      g.bezierCurveTo(0.3, y + 0.02, 0.6, y - 0.02, 1, y);
    }
    g.stroke();
    g.fillStyle = paint(sink(base, 0.55));
    g.fillRect(0, i * 0.25, 1, 1.3 / px);
    g.fillRect(((i * 0.37 + variant * 0.21) % 0.8) + 0.1, i * 0.25, 1.3 / px, 0.25);
  }
  if (variant === 2) {
    g.beginPath();
    g.ellipse(0.62, 0.42, 0.1, 0.07, 0, 0, Math.PI * 2);
    g.lineWidth = 2 / px;
    g.strokeStyle = rgba(BLACK, 0.18);
    g.stroke();
  } else if (variant === 3) {
    // A sheet of paper dropped on the floor.
    g.save();
    g.translate(0.48, 0.55);
    g.rotate(-0.35);
    g.fillStyle = paint(sink(PAPER, 0.05));
    g.fillRect(-0.14, -0.18, 0.28, 0.36);
    g.fillStyle = paint(sink(PAPER, 0.4));
    for (let k = 0; k < 5; k++) g.fillRect(-0.1, -0.12 + k * 0.06, 0.16 + (k % 2) * 0.03, 0.015);
    g.restore();
  }
}

/** A square panel with a bevel, lit top and left, `inset` a gap round it. */
function panel(
  g: CanvasRenderingContext2D,
  [x, y, s]: readonly [number, number, number],
  base: Rgb,
  paint: Paint,
  px: number,
): void {
  g.fillStyle = paint(base);
  g.fillRect(x, y, s, s);
  g.fillStyle = paint(lift(base, 0.14));
  g.fillRect(x, y, s, 1.5 / px);
  g.fillRect(x, y, 1.5 / px, s);
  g.fillStyle = paint(sink(base, 0.3));
  g.fillRect(x, y + s - 1.5 / px, s, 1.5 / px);
  g.fillRect(x + s - 1.5 / px, y, 1.5 / px, s);
}

function raisedFloor(g: CanvasRenderingContext2D, variant: number, ctx: FloorCtx): void {
  const { base, paint, px } = ctx;
  g.fillStyle = paint(sink(base, 0.6));
  g.fillRect(0, 0, 1, 1);
  for (let i = 0; i < 4; i++) {
    const x = (i % 2) * 0.5 + 0.012;
    const y = Math.floor(i / 2) * 0.5 + 0.012;
    panel(g, [x, y, 0.476], base, paint, px);
    if (variant === 2 && i % 3 === 0) {
      g.fillStyle = paint(sink(base, 0.5));
      for (let k = 0; k < 36; k++) {
        g.fillRect(x + 0.06 + (k % 6) * 0.065, y + 0.06 + Math.floor(k / 6) * 0.065, 0.02, 0.02);
      }
    }
  }
  if (variant === 3) {
    g.fillStyle = paint(sink(base, 0.75));
    g.fillRect(0.62, 0.62, 0.22, 0.12);
    g.fillStyle = paint(sink(base, 0.9));
    g.fillRect(0.64, 0.665, 0.18, 0.03);
  }
}

function oilyFloor(g: CanvasRenderingContext2D, variant: number, ctx: FloorCtx): void {
  const { base, paint, rand, px } = ctx;
  grit(g, base, paint, rand);
  joints(g, base, paint, px);
  stain(g, 0.3 + rand() * 0.4, 0.3 + rand() * 0.4, 0.1, 0.1);
  if (variant === 2) {
    // An oil puddle: dark and glossy, a streak of the light on it.
    g.fillStyle = paint(sink(base, 0.72));
    g.beginPath();
    g.ellipse(0.5, 0.55, 0.28, 0.17, 0.2, 0, Math.PI * 2);
    g.ellipse(0.32, 0.5, 0.12, 0.1, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = rgba(WHITE, 0.16);
    g.lineWidth = 2 / px;
    g.beginPath();
    g.moveTo(0.4, 0.47);
    g.lineTo(0.6, 0.5);
    g.stroke();
  } else if (variant === 3) {
    // A drain grate.
    g.fillStyle = paint(sink(STEEL, 0.55));
    g.fillRect(0.3, 0.3, 0.4, 0.4);
    g.fillStyle = paint(sink(STEEL, 0.9));
    for (let k = 0; k < 5; k++) g.fillRect(0.34 + k * 0.07, 0.34, 0.035, 0.32);
    g.strokeStyle = paint(INK);
    g.lineWidth = OUTLINE;
    g.strokeRect(0.3, 0.3, 0.4, 0.4);
  }
}

function linoFloor(g: CanvasRenderingContext2D, variant: number, ctx: FloorCtx): void {
  const { base, paint, px } = ctx;
  for (let i = 0; i < 4; i++) {
    const x = (i % 2) * 0.5;
    const y = Math.floor(i / 2) * 0.5;
    g.fillStyle = paint((i === 0 || i === 3) === (variant % 2 === 0) ? base : lift(base, 0.1));
    g.fillRect(x, y, 0.5, 0.5);
  }
  g.fillStyle = paint(sink(base, 0.25));
  g.fillRect(0, 0, 1, 1 / px);
  g.fillRect(0, 0.5, 1, 1 / px);
  g.fillRect(0, 0, 1 / px, 1);
  g.fillRect(0.5, 0, 1 / px, 1);
  if (variant === 2) {
    g.fillStyle = rgba(WHITE, 0.16);
    g.beginPath();
    g.ellipse(0.62, 0.38, 0.13, 0.09, 0.5, 0, Math.PI * 2);
    g.fill();
  } else if (variant === 3) {
    g.fillStyle = paint(sink(AMBER, 0.2));
    g.fillRect(0, 0.82, 1, 0.07);
  }
}

/** Raised diamonds pressed into steel plate, alternating their slant. */
function treadPlate(g: CanvasRenderingContext2D, base: Rgb, paint: Paint): void {
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 6; col++) {
      const x = col / 6 + (row % 2) * (1 / 12);
      const y = row / 6 + 1 / 12;
      g.save();
      g.translate(x, y);
      g.rotate((row + col) % 2 === 0 ? 0.6 : -0.6);
      g.fillStyle = paint(lift(base, 0.16));
      g.fillRect(-0.045, -0.011, 0.09, 0.022);
      g.fillStyle = paint(sink(base, 0.3));
      g.fillRect(-0.045, 0.011, 0.09, 0.008);
      g.restore();
    }
  }
}

/** Yellow and black stripes slanting across the whole tile: the reactor's warning, worn dull. */
function hazardStripes(g: CanvasRenderingContext2D, paint: Paint): void {
  g.fillStyle = paint(mix(sink(AMBER, 0.45), STEEL, 0.4));
  g.fillRect(0, 0, 1, 1);
  g.fillStyle = paint(mix(INK, STEEL, 0.45));
  for (let k = -2; k < 3; k++) {
    g.beginPath();
    g.moveTo(k * 0.5, 0);
    g.lineTo(k * 0.5 + 0.25, 0);
    g.lineTo(k * 0.5 + 1.25, 1);
    g.lineTo(k * 0.5 + 1, 1);
    g.closePath();
    g.fill();
  }
}

function reactorFloor(g: CanvasRenderingContext2D, variant: number, ctx: FloorCtx): void {
  const { base, paint, px } = ctx;
  if (variant === 3) {
    hazardStripes(g, paint);
    joints(g, base, paint, px);
    return;
  }
  treadPlate(g, base, paint);
  joints(g, base, paint, px);
  if (variant === 2) {
    g.strokeStyle = paint(sink(base, 0.55));
    g.lineWidth = OUTLINE;
    g.strokeRect(0.18, 0.18, 0.64, 0.64);
    g.fillStyle = paint(lift(base, 0.3));
    for (const [x, y] of [
      [0.24, 0.24],
      [0.76, 0.24],
      [0.24, 0.76],
      [0.76, 0.76],
    ] as const) {
      g.beginPath();
      g.arc(x, y, 0.025, 0, Math.PI * 2);
      g.fill();
    }
  }
}

function controlFloor(g: CanvasRenderingContext2D, variant: number, ctx: FloorCtx): void {
  const { base, paint, rand, px } = ctx;
  g.fillStyle = paint(lift(base, 0.05));
  g.fillRect(0.02, 0.02, 0.46, 0.46);
  g.fillRect(0.52, 0.52, 0.46, 0.46);
  g.fillStyle = paint(sink(base, 0.35));
  g.fillRect(0, 0.5, 1, 1 / px);
  g.fillRect(0.5, 0, 1 / px, 1);
  grit(g, base, paint, rand);
  if (variant === 2) {
    // A cable cover strip across the floor.
    g.fillStyle = paint(sink(base, 0.55));
    g.fillRect(0, 0.42, 1, 0.16);
    g.fillStyle = paint(lift(base, 0.08));
    for (let k = 0; k < 10; k++) g.fillRect(k * 0.1, 0.44, 0.05, 0.12);
  } else if (variant === 3) {
    g.fillStyle = paint(sink(STEEL, 0.5));
    g.fillRect(0.6, 0.6, 0.22, 0.22);
    g.fillStyle = paint(lift(STEEL, 0.1));
    g.fillRect(0.63, 0.63, 0.16, 0.03);
  }
}

function plainFloor(g: CanvasRenderingContext2D, variant: number, ctx: FloorCtx): void {
  const { base, paint, px } = ctx;
  for (let i = 0; i < 4; i++) {
    panel(g, [(i % 2) * 0.5, Math.floor(i / 2) * 0.5, 0.5], base, paint, px);
    const x = (i % 2) * 0.5;
    const y = Math.floor(i / 2) * 0.5;
    g.fillStyle = rgba(BLACK, 0.35);
    for (const [dx, dy] of [
      [0.07, 0.07],
      [0.4, 0.07],
      [0.07, 0.4],
      [0.4, 0.4],
    ] as const) {
      g.fillRect(x + dx, y + dy, 2 / px, 2 / px);
    }
  }
  if (variant === 2) stain(g, 0.6, 0.35, 0.12, 0.12);
}

/** What a floor's drawing gets: its material, the light, noise and the pixels a tile. */
interface FloorCtx {
  base: Rgb;
  paint: Paint;
  rand: () => number;
  px: number;
}

const FLOOR_DRAWINGS: Readonly<
  Record<FloorKind, (g: CanvasRenderingContext2D, variant: number, ctx: FloorCtx) => void>
> = {
  plain: plainFloor,
  corridor: concreteFloor,
  archive: plankFloor,
  server: raisedFloor,
  machine: oilyFloor,
  lab: linoFloor,
  reactor: reactorFloor,
  control: controlFloor,
};

/** A band polished pale by feet, through the middle of the tile, across or along. */
function wear(g: CanvasRenderingContext2D, across: boolean, rand: () => number, px: number): void {
  const grad = across
    ? g.createLinearGradient(0, 0.2, 0, 0.8)
    : g.createLinearGradient(0.2, 0, 0.8, 0);
  grad.addColorStop(0, rgba(WHITE, 0));
  grad.addColorStop(0.5, rgba(WHITE, 0.08));
  grad.addColorStop(1, rgba(WHITE, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, 1, 1);
  g.strokeStyle = rgba(BLACK, 0.1);
  g.lineWidth = 1 / px;
  g.beginPath();
  for (let k = 0; k < 5; k++) {
    const at = 0.35 + rand() * 0.3;
    const from = rand() * 0.6;
    if (across) {
      g.moveTo(from, at);
      g.lineTo(from + 0.25, at + (rand() - 0.5) * 0.04);
    } else {
      g.moveTo(at, from);
      g.lineTo(at + (rand() - 0.5) * 0.04, from + 0.25);
    }
  }
  g.stroke();
}

/** Dust gathered in a corner where two walls meet: `cx`, `cy` the corner. */
function cornerDust(g: CanvasRenderingContext2D, cx: number, cy: number, rand: () => number): void {
  const grad = g.createRadialGradient(cx, cy, 0, cx, cy, 0.55);
  grad.addColorStop(0, rgba(BLACK, 0.34));
  grad.addColorStop(0.5, rgba(BLACK, 0.12));
  grad.addColorStop(1, rgba(BLACK, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, 1, 1);
  g.fillStyle = rgba(mix(CONCRETE, WHITE, 0.3), 0.22);
  for (let k = 0; k < 14; k++) {
    const r = rand() * 0.3;
    const a = rand() * Math.PI * 0.5;
    const x = Math.abs(cx - Math.cos(a) * r);
    const y = Math.abs(cy - Math.sin(a) * r);
    g.fillRect(x, y, 0.012, 0.012);
  }
}

const CORNERS: Readonly<Record<number, readonly [number, number]>> = {
  [CORNER_NW]: [0, 0],
  [CORNER_NE]: [1, 0],
  [CORNER_SW]: [0, 1],
  [CORNER_SE]: [1, 1],
};

/** A number for a name, to seed a drawing's noise with: the same name, the same noise. */
function nameSeed(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) >>> 0;
  return h;
}

/** A floor tile of `kind` in `variant`, lit by the ceiling lights or found in the dark. */
function drawFloor(
  g: CanvasRenderingContext2D,
  kind: FloorKind,
  variant: number,
  lit: boolean,
  px: number,
): void {
  const base = FLOOR_BASE_COLOUR[kind];
  const paint = painter(lit);
  const rand = seededRandom(0xf1004 + nameSeed(kind) + variant * 131);
  g.fillStyle = paint(base);
  g.fillRect(0, 0, 1, 1);
  const own = variant < FLOOR_BASE ? variant : 0;
  FLOOR_DRAWINGS[kind](g, own, { base, paint, rand, px });
  if (variant === WORN_ACROSS || variant === WORN_ALONG) {
    wear(g, variant === WORN_ACROSS, rand, px);
  }
  const corner = CORNERS[variant];
  if (corner !== undefined) {
    cornerDust(g, corner[0], corner[1], rand);
  }
}

// ── walls ──────────────────────────────────────────────────────────────────

/** A wall's face as each kind of room paints it: the main colour and an accent. */
const FACE_PAINT: Readonly<Record<FloorKind, { face: Rgb; accent: Rgb }>> = {
  plain: { face: WALL_FACE, accent: sink(WALL_FACE, 0.25) },
  corridor: { face: lift(WALL_FACE, 0.1), accent: sink(AMBER, 0.45) },
  archive: { face: mix(WALL_FACE, PAPER, 0.3), accent: sink(WOOD, 0.25) },
  server: { face: mix(WALL_FACE, SERVER_BLUE, 0.18), accent: sink(SERVER_BLUE, 0.6) },
  machine: { face: sink(mix(WALL_FACE, LINO, 0.4), 0.12), accent: sink(LINO, 0.55) },
  lab: { face: mix(WALL_FACE, WHITE, 0.42), accent: mix(WALL_FACE, WHITE, 0.25) },
  reactor: { face: sink(STEEL, 0.32), accent: sink(AMBER, 0.15) },
  control: { face: mix(sink(WALL_FACE, 0.25), SERVER_BLUE, 0.12), accent: sink(STEEL, 0.55) },
};

/** The crown, the wall's top, with its outline where floor lies beside it. */
function drawCrown(g: CanvasRenderingContext2D, mask: number, paint: Paint, px: number): void {
  const bottom = hasFace(mask) ? CROWN_H : 1;
  const grad = g.createLinearGradient(0, 0, 1, bottom);
  grad.addColorStop(0, paint(lift(WALL_CROWN, 0.06)));
  grad.addColorStop(1, paint(sink(WALL_CROWN, 0.12)));
  g.fillStyle = grad;
  g.fillRect(0, 0, 1, bottom);
  const ink = paint(INK);
  const light = rgba(WHITE, 0.16);
  const dark = rgba(BLACK, 0.22);
  const line = 1.5 / px;
  if ((mask & FLOOR_N) !== 0) {
    g.fillStyle = ink;
    g.fillRect(0, 0, 1, OUTLINE);
    g.fillStyle = light;
    g.fillRect(0, OUTLINE, 1, line);
  }
  if ((mask & FLOOR_W) !== 0) {
    g.fillStyle = ink;
    g.fillRect(0, 0, OUTLINE, bottom);
    g.fillStyle = light;
    g.fillRect(OUTLINE, 0, line, bottom);
  }
  if ((mask & FLOOR_E) !== 0) {
    g.fillStyle = ink;
    g.fillRect(1 - OUTLINE, 0, OUTLINE, bottom);
    g.fillStyle = dark;
    g.fillRect(1 - OUTLINE - line, 0, line, bottom);
  }
}

/** The wall's face toward the room south of it: painted after `kind`, seams, a dark foot. */
function drawFace(
  g: CanvasRenderingContext2D,
  kind: FloorKind,
  mask: number,
  paint: Paint,
  px: number,
): void {
  const { face, accent } = FACE_PAINT[kind];
  const grad = g.createLinearGradient(0, CROWN_H, 0, 1);
  grad.addColorStop(0, paint(lift(face, 0.1)));
  grad.addColorStop(1, paint(sink(face, 0.18)));
  g.fillStyle = grad;
  g.fillRect(0, CROWN_H, 1, 1 - CROWN_H);
  FACE_DETAILS[kind](g, { face, accent, paint, px });
  // The crown's front edge catches the light; the face starts in its shadow.
  g.fillStyle = rgba(WHITE, 0.22);
  g.fillRect(0, CROWN_H - 2 / px, 1, 2 / px);
  g.fillStyle = rgba(BLACK, 0.35);
  g.fillRect(0, CROWN_H, 1, 2 / px);
  // Seam between two wall panels, on the tile's edge.
  g.fillStyle = rgba(BLACK, 0.3);
  g.fillRect(0, CROWN_H, 1.5 / px, 1 - CROWN_H);
  g.fillStyle = rgba(WHITE, 0.06);
  g.fillRect(1.5 / px, CROWN_H, 1 / px, 1 - CROWN_H);
  // The foot, where the wall meets the floor: the bottom edge darker.
  g.fillStyle = paint(sink(face, 0.55));
  g.fillRect(0, 0.95, 1, 0.05);
  const ink = paint(INK);
  if ((mask & FLOOR_W) !== 0) {
    g.fillStyle = ink;
    g.fillRect(0, CROWN_H, OUTLINE, 1 - CROWN_H);
  }
  if ((mask & FLOOR_E) !== 0) {
    g.fillStyle = ink;
    g.fillRect(1 - OUTLINE, CROWN_H, OUTLINE, 1 - CROWN_H);
  }
}

interface FaceCtx {
  face: Rgb;
  accent: Rgb;
  paint: Paint;
  px: number;
}

type FaceDetail = (g: CanvasRenderingContext2D, ctx: FaceCtx) => void;

const FACE_H = 1 - CROWN_H;

/** A horizontal panel seam across the face, `at` of the way down. */
function seam(g: CanvasRenderingContext2D, at: number, px: number): void {
  const y = CROWN_H + FACE_H * at;
  g.fillStyle = rgba(BLACK, 0.3);
  g.fillRect(0, y, 1, 1.5 / px);
  g.fillStyle = rgba(WHITE, 0.07);
  g.fillRect(0, y + 1.5 / px, 1, 1 / px);
}

function rivets(g: CanvasRenderingContext2D, ys: readonly number[], px: number): void {
  for (const y of ys) {
    for (const x of [0.1, 0.9]) {
      g.fillStyle = rgba(BLACK, 0.4);
      g.fillRect(x + 1 / px, y + 1 / px, 2.5 / px, 2.5 / px);
      g.fillStyle = rgba(WHITE, 0.14);
      g.fillRect(x, y, 2.5 / px, 2.5 / px);
    }
  }
}

const FACE_DETAILS: Readonly<Record<FloorKind, FaceDetail>> = {
  plain: (g, { px }) => {
    seam(g, 0.62, px);
    rivets(g, [CROWN_H + 0.08, 0.86], px);
  },
  corridor: (g, { face, accent, paint, px }) => {
    g.fillStyle = paint(sink(face, 0.22));
    g.fillRect(0, CROWN_H + FACE_H * 0.62, 1, FACE_H * 0.38);
    g.fillStyle = paint(accent);
    g.fillRect(0, CROWN_H + FACE_H * 0.6, 1, 3 / px);
  },
  archive: (g, { accent, paint, px }) => {
    const top = CROWN_H + FACE_H * 0.45;
    g.fillStyle = paint(accent);
    g.fillRect(0, top, 1, 1 - top);
    g.fillStyle = paint(sink(accent, 0.3));
    for (let k = 0; k < 4; k++) g.fillRect(k * 0.25 + 0.12, top, 1.5 / px, 1 - top);
    g.fillStyle = paint(lift(accent, 0.2));
    g.fillRect(0, top, 1, 2 / px);
  },
  server: (g, { accent, paint, px }) => {
    seam(g, 0.5, px);
    g.fillStyle = paint(accent);
    for (let k = 0; k < 10; k++) g.fillRect(0.06 + k * 0.09, 0.84, 0.035, 0.035);
  },
  machine: (g, { px }) => {
    seam(g, 0.4, px);
    seam(g, 0.75, px);
    rivets(g, [CROWN_H + 0.06, CROWN_H + FACE_H * 0.55, 0.88], px);
  },
  lab: (g, { accent, paint, px }) => {
    g.fillStyle = paint(accent);
    for (let k = 1; k < 8; k++) g.fillRect(k * 0.125, CROWN_H, 1 / px, FACE_H);
    for (let k = 1; k < 5; k++) g.fillRect(0, CROWN_H + k * (FACE_H / 5), 1, 1 / px);
  },
  reactor: (g, { accent, paint, px }) => {
    rivets(g, [CROWN_H + 0.07, CROWN_H + FACE_H * 0.5], px);
    g.save();
    g.beginPath();
    g.rect(0, 0.82, 1, 0.12);
    g.clip();
    g.fillStyle = paint(accent);
    g.fillRect(0, 0.82, 1, 0.12);
    g.fillStyle = paint(INK);
    for (let k = -1; k < 6; k++) {
      g.beginPath();
      g.moveTo(k * 0.2, 0.94);
      g.lineTo(k * 0.2 + 0.1, 0.94);
      g.lineTo(k * 0.2 + 0.22, 0.82);
      g.lineTo(k * 0.2 + 0.12, 0.82);
      g.closePath();
      g.fill();
    }
    g.restore();
  },
  control: (g, { accent, paint, px }) => {
    g.fillStyle = paint(accent);
    for (let k = 0; k < 12; k++) g.fillRect(0.04 + k * 0.08, CROWN_H + 0.05, 1 / px, FACE_H * 0.8);
    seam(g, 0.88, px);
  },
};

/** The wall's soft shadow on the floor below it, fading out over a tile. */
function drawDropShadow(g: CanvasRenderingContext2D): void {
  const grad = g.createLinearGradient(0, 1, 0, 2);
  grad.addColorStop(0, rgba(BLACK, DROP_SHADOW));
  grad.addColorStop(0.35, rgba(BLACK, DROP_SHADOW * 0.4));
  grad.addColorStop(1, rgba(BLACK, 0));
  g.fillStyle = grad;
  g.fillRect(0, 1, 1, 1);
}

/**
 * A wall tile: its crown, in the light of the wall itself, and where the room
 * south of it looks at it, its face — in that room's light — and its shadow.
 */
function drawWall(
  g: CanvasRenderingContext2D,
  spec: Extract<SurfaceSpec, { wall: FloorKind }>,
  px: number,
): void {
  drawCrown(g, spec.mask, painter(spec.lit), px);
  if (hasFace(spec.mask)) {
    drawFace(g, spec.wall, spec.mask, painter(spec.faceLit), px);
    drawDropShadow(g);
  }
}

// ── baking ─────────────────────────────────────────────────────────────────

/** Adds grey noise of ±`amp` levels to the top `rows` pixel rows of `g`'s canvas. */
function addNoise(
  g: CanvasRenderingContext2D,
  rows: number,
  rand: () => number,
  amp: number,
): void {
  const { width } = g.canvas;
  const image = g.getImageData(0, 0, width, rows);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() * 2 - 1) * amp;
    d[i] = (d[i] ?? 0) + n;
    d[i + 1] = (d[i + 1] ?? 0) + n;
    d[i + 2] = (d[i + 2] ?? 0) + n * 1.2;
  }
  g.putImageData(image, 0, 0);
}

/**
 * Draws the surface `spec` into `g`, its canvas sized for it at `px` pixels a
 * tile (spriteHeight tiles tall), with fine noise over the tile itself.
 */
export function paintSurface(g: CanvasRenderingContext2D, spec: SurfaceSpec, px: number): void {
  g.save();
  g.setTransform(px, 0, 0, px, 0, 0);
  if ('floor' in spec) {
    drawFloor(g, spec.floor, spec.variant, spec.lit, px);
  } else {
    drawWall(g, spec, px);
  }
  g.restore();
  addNoise(g, px, seededRandom(0x3a115eed ^ px), 'floor' in spec ? 2.2 : 1.6);
}

/** A canvas of `width` × `height` pixels with its 2D context. */
function canvasOf(
  width: number,
  height: number,
): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  if (g === null) {
    throw new Error('surfaces: canvas.getContext("2d") returned null; cannot bake a sprite.');
  }
  return [canvas, g];
}

/** The tile of `spec` alone, `px` pixels square: a wall without its shadow below. */
export function surfaceTile(px: number, spec: SurfaceSpec): HTMLCanvasElement {
  const [canvas, g] = canvasOf(px, px);
  paintSurface(g, spec, px);
  return canvas;
}

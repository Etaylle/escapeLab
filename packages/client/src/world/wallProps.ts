import { addCircle, hashTile, OUTLINE, roundRectPath, seededRandom, TAU } from './brush.js';
import type { WallPropKind } from './dress.js';
import {
  ALARM,
  AMBER,
  BLACK,
  BRASS,
  css,
  DONE_GREEN,
  EMERGENCY,
  inLight,
  INK,
  lift,
  mix,
  PAPER,
  PHOSPHOR,
  READ_BLUE,
  rgba,
  SERVER_BLUE,
  sink,
  STEEL,
  WHITE,
  WOOD,
  type Rgb,
} from './palette.js';
import { CROWN_H } from './surfaces.js';

/**
 * What hangs on the walls' faces (dress.ts picks it), drawn in the wall
 * tile's own space — 0 to 1 across, the face from CROWN_H down to its foot:
 * the still part the atlas bakes, lit or in the dark; the parts that move —
 * a fan behind its grille, a gauge's needle, a clock's hands — drawn every
 * frame under the darkness; and the parts that glow — screens scrolling
 * phosphor text once their room is lit, a standby dot while it is dark,
 * rack LEDs blinking — drawn over the darkness, as light is.
 */

/** A material in the light of the sprite. */
type Paint = (rgb: Rgb) => string;

/** The face's top and foot, in the wall tile's space. */
const TOP = CROWN_H + 0.04;
const FOOT = 0.93;

function pipeRun(
  g: CanvasRenderingContext2D,
  [y, r]: readonly [number, number],
  metal: Rgb,
  paint: Paint,
): void {
  g.fillStyle = paint(metal);
  g.fillRect(0, y - r, 1, r * 2);
  g.fillStyle = paint(lift(metal, 0.35));
  g.fillRect(0, y - r * 0.7, 1, r * 0.35);
  g.fillStyle = paint(sink(metal, 0.45));
  g.fillRect(0, y + r * 0.45, 1, r * 0.55);
  g.fillStyle = paint(INK);
  g.fillRect(0, y - r - OUTLINE / 2, 1, OUTLINE / 2);
  g.fillRect(0, y + r, 1, OUTLINE / 2);
}

function drawPipes(g: CanvasRenderingContext2D, variant: number, paint: Paint): void {
  const upper = variant === 1 ? mix(BRASS, sink(AMBER, 0.4), 0.3) : STEEL;
  g.fillStyle = paint(sink(STEEL, 0.6));
  g.fillRect(0.22, 0.46, 0.06, 0.24);
  pipeRun(g, [0.5, 0.045], upper, paint);
  pipeRun(g, [0.64, 0.035], sink(STEEL, 0.1), paint);
  if (variant === 2) {
    g.fillStyle = paint(lift(STEEL, 0.1));
    g.fillRect(0.47, 0.44, 0.06, 0.12);
    g.strokeStyle = paint(INK);
    g.lineWidth = OUTLINE / 2;
    g.strokeRect(0.47, 0.44, 0.06, 0.12);
  } else if (variant === 3) {
    g.strokeStyle = paint(sink(AMBER, 0.3));
    g.lineWidth = 0.025;
    g.beginPath();
    g.arc(0.62, 0.64, 0.07, 0, TAU);
    g.moveTo(0.55, 0.64);
    g.lineTo(0.69, 0.64);
    g.moveTo(0.62, 0.57);
    g.lineTo(0.62, 0.71);
    g.stroke();
  }
}

function drawTray(g: CanvasRenderingContext2D, variant: number, paint: Paint): void {
  g.fillStyle = paint(sink(STEEL, 0.62));
  g.fillRect(0, 0.47, 1, 0.12);
  const cables = [sink(AMBER, 0.5), sink(ALARM, 0.45), sink(READ_BLUE, 0.5), sink(STEEL, 0.75)];
  cables.forEach((colour, i) => {
    g.strokeStyle = paint(colour);
    g.lineWidth = 0.022;
    g.beginPath();
    const y = 0.5 + i * 0.022;
    g.moveTo(0, y);
    g.quadraticCurveTo(0.5, y + 0.012, 1, y);
    g.stroke();
  });
  g.fillStyle = paint(lift(STEEL, 0.05));
  g.fillRect(0, 0.46, 1, 0.018);
  g.fillRect(0, 0.585, 1, 0.018);
  g.fillStyle = paint(INK);
  g.fillRect(0, 0.6, 1, OUTLINE / 2);
  if (variant === 2) {
    g.strokeStyle = paint(sink(STEEL, 0.75));
    g.lineWidth = 0.024;
    g.beginPath();
    g.moveTo(0.7, 0.6);
    g.bezierCurveTo(0.72, 0.72, 0.66, 0.8, 0.7, FOOT);
    g.stroke();
  } else if (variant === 3) {
    box(g, [0.38, 0.66, 0.2, 0.16], paint(sink(STEEL, 0.35)), paint);
    g.fillStyle = paint(sink(AMBER, 0.1));
    g.fillRect(0.44, 0.7, 0.08, 0.035);
  }
}

/** A filled rectangle with the outline. */
function box(
  g: CanvasRenderingContext2D,
  [x, y, w, h]: readonly [number, number, number, number],
  fill: string,
  paint: Paint,
): void {
  g.fillStyle = fill;
  g.fillRect(x, y, w, h);
  g.strokeStyle = paint(INK);
  g.lineWidth = OUTLINE;
  g.strokeRect(x, y, w, h);
}

function drawStripes(g: CanvasRenderingContext2D, variant: number, paint: Paint): void {
  const top = variant % 2 === 0 ? 0.68 : 0.6;
  g.save();
  g.beginPath();
  g.rect(0, top, 1, FOOT - top);
  g.clip();
  g.fillStyle = paint(sink(AMBER, 0.08));
  g.fillRect(0, top, 1, FOOT - top);
  g.fillStyle = paint(INK);
  for (let k = -2; k < 7; k++) {
    g.beginPath();
    g.moveTo(k * 0.2, FOOT);
    g.lineTo(k * 0.2 + 0.1, FOOT);
    g.lineTo(k * 0.2 + 0.1 + (FOOT - top), top);
    g.lineTo(k * 0.2 + (FOOT - top), top);
    g.closePath();
    g.fill();
  }
  g.restore();
  g.fillStyle = paint(INK);
  g.fillRect(0, top - OUTLINE / 2, 1, OUTLINE / 2);
}

function drawExtinguisher(g: CanvasRenderingContext2D, variant: number, paint: Paint): void {
  const x = 0.42 + (variant - 1.5) * 0.06;
  const red = sink(EMERGENCY, 0.18);
  box(g, [x + 0.01, TOP + 0.02, 0.14, 0.09], paint(sink(EMERGENCY, 0.1)), paint);
  g.fillStyle = paint(WHITE);
  g.fillRect(x + 0.05, TOP + 0.04, 0.06, 0.05);
  g.beginPath();
  roundRectPath(g, x, 0.56, 0.16, 0.34, 0.06, 0.03);
  g.fillStyle = paint(red);
  g.fill();
  g.strokeStyle = paint(INK);
  g.lineWidth = OUTLINE;
  g.stroke();
  g.fillStyle = paint(lift(red, 0.35));
  g.fillRect(x + 0.03, 0.6, 0.025, 0.24);
  g.fillStyle = paint(sink(STEEL, 0.4));
  g.fillRect(x + 0.05, 0.52, 0.06, 0.05);
  g.strokeStyle = paint(INK);
  g.lineWidth = 0.02;
  g.beginPath();
  g.moveTo(x + 0.11, 0.54);
  g.quadraticCurveTo(x + 0.26, 0.6, x + 0.19, 0.78);
  g.stroke();
}

function drawPoster(g: CanvasRenderingContext2D, variant: number, paint: Paint): void {
  g.save();
  g.translate(0.5, 0.64);
  g.rotate(variant === 1 ? -0.06 : variant === 3 ? 0.04 : 0);
  const blueprint = variant === 2;
  box(g, [-0.2, -0.19, 0.4, 0.38], paint(blueprint ? sink(READ_BLUE, 0.45) : PAPER), paint);
  const ink = blueprint ? rgba(WHITE, 0.6) : paint(sink(PAPER, 0.62));
  if (blueprint) {
    g.strokeStyle = ink;
    g.lineWidth = 0.012;
    g.strokeRect(-0.14, -0.13, 0.28, 0.2);
    g.strokeRect(-0.06, -0.06, 0.12, 0.1);
  } else {
    g.fillStyle = paint(variant === 3 ? sink(AMBER, 0.1) : sink(ALARM, 0.15));
    g.beginPath();
    g.moveTo(0, -0.15);
    g.lineTo(0.1, 0.02);
    g.lineTo(-0.1, 0.02);
    g.closePath();
    g.fill();
    g.fillStyle = ink;
    g.fillRect(-0.015, -0.09, 0.03, 0.06);
  }
  g.fillStyle = ink;
  for (let k = 0; k < 3; k++) g.fillRect(-0.14, 0.07 + k * 0.035, 0.28 - k * 0.06, 0.016);
  g.restore();
}

const CLOCK = { x: 0.5, y: 0.63, r: 0.15 } as const;

function drawClock(g: CanvasRenderingContext2D, _variant: number, paint: Paint): void {
  g.beginPath();
  g.arc(CLOCK.x, CLOCK.y, CLOCK.r, 0, TAU);
  g.fillStyle = paint(lift(PAPER, 0.4));
  g.fill();
  g.lineWidth = 0.03;
  g.strokeStyle = paint(sink(STEEL, 0.55));
  g.stroke();
  g.strokeStyle = paint(INK);
  g.lineWidth = 0.012;
  g.beginPath();
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU;
    const inner = k % 3 === 0 ? 0.1 : 0.12;
    g.moveTo(CLOCK.x + Math.cos(a) * inner, CLOCK.y + Math.sin(a) * inner);
    g.lineTo(CLOCK.x + Math.cos(a) * 0.135, CLOCK.y + Math.sin(a) * 0.135);
  }
  g.stroke();
}

function drawWhiteboard(g: CanvasRenderingContext2D, variant: number, paint: Paint): void {
  box(g, [0.06, TOP + 0.02, 0.88, 0.4], paint(lift(PAPER, 0.55)), paint);
  const rand = seededRandom(0xb0a4d + variant);
  const inks = [READ_BLUE, ALARM, sink(STEEL, 0.6)];
  for (let line = 0; line < 4; line++) {
    g.strokeStyle = paint(sink(inks[(line + variant) % inks.length] ?? READ_BLUE, 0.2));
    g.lineWidth = 0.012;
    g.beginPath();
    let x = 0.12 + rand() * 0.08;
    const y = TOP + 0.08 + line * 0.08;
    g.moveTo(x, y);
    while (x < 0.8) {
      const step = 0.03 + rand() * 0.05;
      g.quadraticCurveTo(x + step / 2, y - 0.025 + rand() * 0.05, x + step, y);
      x += step + (rand() < 0.2 ? 0.04 : 0);
      g.moveTo(x, y);
    }
    g.stroke();
  }
  g.fillStyle = paint(sink(STEEL, 0.3));
  g.fillRect(0.2, TOP + 0.43, 0.6, 0.03);
  g.fillStyle = paint(sink(ALARM, 0.2));
  g.fillRect(0.3, TOP + 0.415, 0.08, 0.02);
}

const VENT = { x: 0.28, y: 0.5, w: 0.44, h: 0.36 } as const;

function drawVent(g: CanvasRenderingContext2D, _variant: number, paint: Paint): void {
  box(g, [VENT.x, VENT.y, VENT.w, VENT.h], paint(sink(STEEL, 0.85)), paint);
  g.strokeStyle = paint(sink(STEEL, 0.3));
  g.lineWidth = 0.02;
  g.strokeRect(VENT.x + 0.02, VENT.y + 0.02, VENT.w - 0.04, VENT.h - 0.04);
}

const STEAM_OUTLET = { x: 0.5, y: 0.66, r: 0.11 } as const;
/** A steam vent's status lamp, beside its outlet. */
const STEAM_LAMP = { x: 0.73, y: 0.56 } as const;

function drawSteamVent(g: CanvasRenderingContext2D, variant: number, paint: Paint): void {
  g.fillStyle = paint(sink(STEEL, 0.25));
  g.fillRect(STEAM_OUTLET.x - 0.04, TOP - 0.04, 0.08, STEAM_OUTLET.y - TOP);
  g.beginPath();
  g.arc(STEAM_OUTLET.x, STEAM_OUTLET.y, STEAM_OUTLET.r, 0, TAU);
  g.fillStyle = paint(sink(STEEL, 0.2));
  g.fill();
  g.lineWidth = OUTLINE;
  g.strokeStyle = paint(INK);
  g.stroke();
  g.beginPath();
  g.arc(STEAM_OUTLET.x, STEAM_OUTLET.y, STEAM_OUTLET.r * 0.65, 0, TAU);
  g.fillStyle = paint(sink(STEEL, 0.85));
  g.fill();
  g.strokeStyle = paint(sink(STEEL, 0.4));
  g.lineWidth = 0.014;
  g.beginPath();
  for (let k = -1; k <= 1; k++) {
    g.moveTo(STEAM_OUTLET.x - 0.06, STEAM_OUTLET.y + k * 0.03);
    g.lineTo(STEAM_OUTLET.x + 0.06, STEAM_OUTLET.y + k * 0.03);
  }
  g.stroke();
  // The status lamp's housing: its light is the glow pass's.
  g.beginPath();
  g.arc(STEAM_LAMP.x, STEAM_LAMP.y, 0.04, 0, TAU);
  g.fillStyle = paint(sink(STEEL, 0.75));
  g.fill();
  g.lineWidth = OUTLINE / 2;
  g.strokeStyle = paint(INK);
  g.stroke();
  if (variant >= 2) {
    g.fillStyle = paint(sink(AMBER, 0.1));
    g.fillRect(0.18, 0.5, 0.12, 0.08);
  }
}

/** Where a gauge's dial sits, by variant: one large, or two small side by side. */
function dialsOf(variant: number): readonly { x: number; y: number; r: number }[] {
  return variant === 1
    ? [
        { x: 0.32, y: 0.62, r: 0.09 },
        { x: 0.6, y: 0.62, r: 0.09 },
      ]
    : [{ x: 0.42, y: 0.63, r: 0.12 }];
}

function drawGauge(g: CanvasRenderingContext2D, variant: number, paint: Paint): void {
  box(g, [0.18, 0.47, 0.64, 0.33], paint(sink(STEEL, 0.5)), paint);
  for (const dial of dialsOf(variant)) {
    g.beginPath();
    g.arc(dial.x, dial.y, dial.r, 0, TAU);
    g.fillStyle = paint(lift(PAPER, 0.3));
    g.fill();
    g.lineWidth = 0.018;
    g.strokeStyle = paint(INK);
    g.stroke();
    g.beginPath();
    g.arc(dial.x, dial.y, dial.r * 0.78, -0.4, 0.5);
    g.lineWidth = 0.02;
    g.strokeStyle = paint(sink(EMERGENCY, 0.2));
    g.stroke();
  }
  g.beginPath();
  g.arc(0.7, 0.56, 0.03, 0, TAU);
  g.fillStyle = paint(sink(STEEL, 0.85));
  g.fill();
}

const SCREEN = { x: 0.22, y: 0.5, w: 0.56, h: 0.32 } as const;

function drawScreen(g: CanvasRenderingContext2D, variant: number, paint: Paint): void {
  g.beginPath();
  roundRectPath(g, 0.16, 0.44, 0.68, 0.44, 0.04);
  g.fillStyle = paint(variant % 2 === 0 ? sink(STEEL, 0.55) : mix(PAPER, STEEL, 0.55));
  g.fill();
  g.strokeStyle = paint(INK);
  g.lineWidth = OUTLINE;
  g.stroke();
  g.beginPath();
  roundRectPath(g, SCREEN.x, SCREEN.y, SCREEN.w, SCREEN.h, 0.03);
  g.fillStyle = paint(mix(sink(PHOSPHOR, 0.92), INK, 0.4));
  g.fill();
  g.fillStyle = rgba(WHITE, 0.06);
  g.beginPath();
  g.moveTo(SCREEN.x + 0.03, SCREEN.y + 0.02);
  g.lineTo(SCREEN.x + 0.25, SCREEN.y + 0.02);
  g.lineTo(SCREEN.x + 0.03, SCREEN.y + 0.18);
  g.closePath();
  g.fill();
}

const RACK = { x: 0.1, y: 0.42, w: 0.8, h: 0.52 } as const;

function drawRackFront(g: CanvasRenderingContext2D, variant: number, paint: Paint): void {
  box(g, [RACK.x, RACK.y, RACK.w, RACK.h], paint(sink(STEEL, 0.78)), paint);
  for (let unit = 0; unit < 5; unit++) {
    const y = RACK.y + 0.04 + unit * 0.095;
    g.fillStyle = paint(sink(STEEL, unit % 2 === variant % 2 ? 0.55 : 0.65));
    g.fillRect(RACK.x + 0.04, y, RACK.w - 0.08, 0.08);
    g.fillStyle = rgba(BLACK, 0.5);
    for (let k = 0; k < 6; k++) g.fillRect(RACK.x + 0.3 + k * 0.06, y + 0.025, 0.04, 0.03);
    g.fillStyle = rgba(WHITE, 0.06);
    g.fillRect(RACK.x + 0.04, y, RACK.w - 0.08, 0.008);
  }
}

/** Binders on an archive's shelf: their colours, muted, and paper boxes. */
const BINDERS: readonly Rgb[] = [
  sink(READ_BLUE, 0.45),
  sink(ALARM, 0.42),
  sink(DONE_GREEN, 0.5),
  sink(PAPER, 0.15),
  sink(WOOD, 0.1),
  sink(AMBER, 0.4),
];

/** A row of binders standing on a board from `x0` to `x1`, their feet at `foot`. */
function binderRow(
  g: CanvasRenderingContext2D,
  [x0, x1, foot]: readonly [number, number, number],
  rand: () => number,
  paint: Paint,
): void {
  let x = x0;
  while (x < x1 - 0.04) {
    const w = 0.035 + rand() * 0.04;
    const h = 0.12 + rand() * 0.05;
    const colour = BINDERS[Math.floor(rand() * BINDERS.length)] ?? PAPER;
    g.fillStyle = paint(colour);
    g.fillRect(x, foot - h, Math.min(w, x1 - x), h);
    g.fillStyle = rgba(WHITE, 0.25);
    g.fillRect(x + w * 0.25, foot - h * 0.7, w * 0.5, 0.025);
    g.fillStyle = rgba(BLACK, 0.35);
    g.fillRect(x + w - 0.004, foot - h, 0.004, h);
    x += w + (rand() < 0.15 ? 0.04 : 0.003);
  }
}

function drawShelf(g: CanvasRenderingContext2D, variant: number, paint: Paint): void {
  const board = paint(sink(WOOD, 0.2));
  const back = paint(sink(WOOD, 0.62));
  box(g, [0.04, TOP, 0.92, FOOT - TOP], back, paint);
  const rand = seededRandom(0x5e1f + variant * 7);
  binderRow(g, [0.07, 0.93, 0.66], rand, paint);
  binderRow(g, [0.07, 0.93, 0.9], rand, paint);
  g.fillStyle = board;
  g.fillRect(0.04, 0.66, 0.92, 0.035);
  g.fillRect(0.04, 0.9, 0.92, 0.03);
  g.fillStyle = paint(lift(WOOD, 0.15));
  g.fillRect(0.04, 0.66, 0.92, 0.008);
}

const STILL_PROPS: Readonly<
  Record<WallPropKind, (g: CanvasRenderingContext2D, variant: number, paint: Paint) => void>
> = {
  pipes: drawPipes,
  tray: drawTray,
  stripes: drawStripes,
  extinguisher: drawExtinguisher,
  poster: drawPoster,
  clock: drawClock,
  whiteboard: drawWhiteboard,
  vent: drawVent,
  steam: drawSteamVent,
  gauge: drawGauge,
  screen: drawScreen,
  rack: drawRackFront,
  shelf: drawShelf,
};

/**
 * The still part of a wall prop of `kind` in `variant`, lit by the ceiling
 * lights or found in the dark: what the atlas bakes. Wall tile space.
 */
export function drawWallProp(
  g: CanvasRenderingContext2D,
  kind: WallPropKind,
  variant: number,
  lit: boolean,
): void {
  const paint: Paint = (rgb) => css(inLight(rgb, lit));
  g.save();
  try {
    STILL_PROPS[kind](g, variant, paint);
  } finally {
    g.restore();
  }
}

// ── what moves and what glows ──────────────────────────────────────────────

/** How a wall prop is doing this frame. */
export interface PropState {
  /** the animation clock, s, stepped at most 15 times a second (anim.ts) */
  t: number;
  /** how far its room's power is on, 0 (dark: standby) to 1, flickering as it comes on */
  on: number;
  /** the wall clock, epoch ms: a clock's hands */
  now: number;
  /** under reduced motion nothing turns or scrolls; lights still blink */
  reduced: boolean;
  /** lit by the ceiling lights: the moving parts in the lit colours */
  lit: boolean;
}

function drawFan(ctx: CanvasRenderingContext2D, state: PropState): void {
  const cx = VENT.x + VENT.w / 2;
  const cy = VENT.y + VENT.h / 2;
  const turn = state.reduced ? 0.4 : state.t * 2.2;
  const paint: Paint = (rgb) => css(inLight(rgb, state.lit));
  ctx.fillStyle = paint(sink(STEEL, 0.35));
  ctx.beginPath();
  for (let k = 0; k < 4; k++) {
    const a = turn + (k / 4) * TAU;
    ctx.moveTo(cx, cy);
    ctx.ellipse(
      cx + Math.cos(a) * 0.08,
      cy + Math.sin(a) * 0.08,
      0.085,
      0.035,
      a,
      0,
      TAU,
    );
  }
  ctx.fill();
  ctx.fillStyle = paint(sink(STEEL, 0.6));
  ctx.beginPath();
  addCircle(ctx, cx, cy, 0.03);
  ctx.fill();
  ctx.strokeStyle = paint(sink(STEEL, 0.15));
  ctx.lineWidth = 0.014;
  ctx.beginPath();
  for (let k = 1; k < 6; k++) {
    const y = VENT.y + (VENT.h * k) / 6;
    ctx.moveTo(VENT.x + 0.03, y);
    ctx.lineTo(VENT.x + VENT.w - 0.03, y);
  }
  ctx.stroke();
}

function drawNeedles(ctx: CanvasRenderingContext2D, variant: number, state: PropState): void {
  const paint: Paint = (rgb) => css(inLight(rgb, state.lit));
  ctx.strokeStyle = paint(sink(EMERGENCY, 0.15));
  ctx.lineWidth = 0.014;
  ctx.lineCap = 'round';
  ctx.beginPath();
  dialsOf(variant).forEach((dial, i) => {
    const wobble = state.reduced ? 0 : Math.sin(state.t * (1.3 + i * 0.7) + variant) * 0.25;
    const a = -2.2 + 1.6 * (0.4 + 0.3 * state.on) + wobble;
    ctx.moveTo(dial.x, dial.y);
    ctx.lineTo(dial.x + Math.cos(a) * dial.r * 0.8, dial.y + Math.sin(a) * dial.r * 0.8);
  });
  ctx.stroke();
}

function drawHands(ctx: CanvasRenderingContext2D, state: PropState): void {
  const date = new Date(state.now);
  const minutes = date.getMinutes() + date.getSeconds() / 60;
  const hours = (date.getHours() % 12) + minutes / 60;
  const hand = (turns: number, length: number, width: number): void => {
    const a = turns * TAU - Math.PI / 2;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(CLOCK.x, CLOCK.y);
    ctx.lineTo(CLOCK.x + Math.cos(a) * length, CLOCK.y + Math.sin(a) * length);
    ctx.stroke();
  };
  ctx.strokeStyle = css(inLight(INK, state.lit));
  ctx.lineCap = 'round';
  hand(hours / 12, 0.07, 0.02);
  hand(minutes / 60, 0.11, 0.014);
}

/**
 * The parts of a wall prop that move, under the darkness: a fan turning
 * behind its grille, a gauge's needles twitching, a clock's hands. Nothing
 * for the rest. Wall tile space.
 */
export function drawWallPropMotion(
  ctx: CanvasRenderingContext2D,
  kind: WallPropKind,
  variant: number,
  state: PropState,
): void {
  ctx.save();
  try {
    if (kind === 'vent') drawFan(ctx, state);
    else if (kind === 'gauge') drawNeedles(ctx, variant, state);
    else if (kind === 'clock') drawHands(ctx, state);
  } finally {
    ctx.restore();
  }
}

/** Whether a wall prop has anything that moves: the rest bake whole. */
export function moves(kind: WallPropKind): boolean {
  return kind === 'vent' || kind === 'gauge' || kind === 'clock';
}

/** Whether a wall prop has anything that glows. */
export function glows(kind: WallPropKind): boolean {
  return kind === 'screen' || kind === 'rack' || kind === 'gauge' || kind === 'steam';
}

/** Phosphor text scrolling up a screen that is on, or its standby dot while it is dark. */
function screenGlow(ctx: CanvasRenderingContext2D, variant: number, state: PropState): void {
  const { x, y, w, h } = SCREEN;
  if (state.on <= 0.02) {
    ctx.fillStyle = rgba(AMBER, 0.85);
    ctx.beginPath();
    addCircle(ctx, x + w - 0.04, y + h + 0.03, 0.018);
    ctx.fill();
    return;
  }
  ctx.fillStyle = rgba(PHOSPHOR, 0.16 * state.on);
  ctx.fillRect(x, y, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 0.02, y + 0.02, w - 0.04, h - 0.04);
  ctx.clip();
  const line = 0.045;
  // The text runs up a line at a time; each line keeps its length as it goes.
  const travelled = state.reduced ? 0 : state.t * 0.12;
  const first = Math.floor(travelled / line);
  const scroll = travelled - first * line;
  ctx.fillStyle = rgba(PHOSPHOR, 0.8 * state.on);
  for (let k = 0; k < 8; k++) {
    const n = first + k;
    const length = (0.15 + (hashTile(variant, n, 7) % 100) * 0.0032) * (n % 4 === 3 ? 0.5 : 1);
    ctx.fillRect(x + 0.04, y + 0.04 + k * line - scroll, length, 0.018);
  }
  ctx.restore();
}

/** Rack LEDs in a row per unit, each blinking in a pattern of its own; they run in the dark too. */
function rackGlow(ctx: CanvasRenderingContext2D, variant: number, state: PropState): void {
  for (let unit = 0; unit < 5; unit++) {
    const y = RACK.y + 0.065 + unit * 0.095;
    for (let k = 0; k < 3; k++) {
      const id = unit * 3 + k + variant * 17;
      const rate = 1.5 + (id % 5) * 0.9;
      const lit = (Math.floor(state.t * rate + id * 0.37) + id) % 3 !== 0;
      if (!lit) continue;
      const colour = id % 7 === 0 ? AMBER : id % 3 === 0 ? DONE_GREEN : SERVER_BLUE;
      ctx.fillStyle = rgba(colour, 0.95);
      ctx.fillRect(RACK.x + 0.08 + k * 0.05, y, 0.025, 0.018);
    }
  }
}

/**
 * A status lamp at (x, y): green with the power on; on the emergency supply a
 * dull red, slowly blinking — the machine room's standby glow.
 */
function statusLamp(ctx: CanvasRenderingContext2D, x: number, y: number, state: PropState): void {
  const on = state.on > 0.5;
  const blink = on || Math.floor(state.t * 0.8 + x * 3) % 2 === 0;
  const colour = on ? DONE_GREEN : EMERGENCY;
  ctx.fillStyle = rgba(colour, 0.26 * (blink ? 1 : 0.4));
  ctx.beginPath();
  addCircle(ctx, x, y, 0.1);
  ctx.fill();
  ctx.fillStyle = rgba(colour, blink ? 0.95 : 0.35);
  ctx.beginPath();
  addCircle(ctx, x, y, 0.026);
  ctx.fill();
}

/**
 * The parts of a wall prop that glow, drawn over the darkness: a screen's
 * text or standby dot, a rack's LEDs, a gauge's lamp. Wall tile space.
 */
export function drawWallPropGlow(
  ctx: CanvasRenderingContext2D,
  kind: WallPropKind,
  variant: number,
  state: PropState,
): void {
  ctx.save();
  try {
    if (kind === 'screen') screenGlow(ctx, variant, state);
    else if (kind === 'rack') rackGlow(ctx, variant, state);
    else if (kind === 'gauge') statusLamp(ctx, 0.7, 0.56, state);
    else if (kind === 'steam') statusLamp(ctx, STEAM_LAMP.x, STEAM_LAMP.y, state);
  } finally {
    ctx.restore();
  }
}

/** Where steam leaves a steam vent, in its wall tile's space. */
export const STEAM_SPOT = { x: STEAM_OUTLET.x, y: STEAM_OUTLET.y } as const;

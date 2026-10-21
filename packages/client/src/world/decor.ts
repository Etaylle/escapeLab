import type { DecorKind } from '@escapelab/core';
import {
  addCircle,
  footShadow,
  hashTile,
  OUTLINE,
  pulseWave,
  roundRectPath,
  seededRandom,
  TAU,
} from './brush.js';
import {
  ALARM,
  AMBER,
  BLACK,
  css,
  DONE_GREEN,
  EMERGENCY,
  GLASS,
  inLight,
  INK,
  lift,
  LINO,
  mix,
  PAPER,
  PHOSPHOR,
  REACTOR,
  READ_BLUE,
  rgba,
  SERVER_BLUE,
  sink,
  STEEL,
  WHITE,
  WOOD,
  type Rgb,
} from './palette.js';
import type { PropState } from './wallProps.js';

/**
 * The lab's furniture (map.decor), drawn with the origin at its TILE'S
 * CENTRE in tile units, seen from above in three quarters: a lighter top,
 * a darker front, the 2 px outline, a soft foot shadow, and never taller
 * than its tile. The still part is what the atlas bakes, lit or in the
 * dark; what glows — rack LEDs, the reactor's core, a desk's screen, a
 * generator's lamp — is drawn over the darkness every frame.
 */

/** A material in the light of the sprite. */
type Paint = (rgb: Rgb) => string;

/** A rectangle: left, top, width, height. */
type Rect = readonly [number, number, number, number];

/** A box with a top face and a front, both outlined: the bible's two-tone shading. */
function block(
  g: CanvasRenderingContext2D,
  [x, y, w, h]: Rect,
  top: number,
  colour: Rgb,
  paint: Paint,
): void {
  g.beginPath();
  roundRectPath(g, x, y, w, h, 0.03);
  g.fillStyle = paint(sink(colour, 0.25));
  g.fill();
  g.fillStyle = paint(lift(colour, 0.12));
  g.fillRect(x, y, w, top);
  g.fillStyle = rgba(WHITE, 0.14);
  g.fillRect(x + 0.02, y + 0.012, w - 0.04, 0.012);
  g.fillStyle = rgba(BLACK, 0.28);
  g.fillRect(x, y + top, w, 0.012);
  g.beginPath();
  roundRectPath(g, x, y, w, h, 0.03);
  g.strokeStyle = paint(INK);
  g.lineWidth = OUTLINE;
  g.stroke();
}

/** Binder colours, muted. */
const BINDERS: readonly Rgb[] = [
  sink(READ_BLUE, 0.45),
  sink(ALARM, 0.42),
  sink(DONE_GREEN, 0.5),
  sink(PAPER, 0.15),
  sink(AMBER, 0.42),
];

function drawShelf(g: CanvasRenderingContext2D, variant: number, paint: Paint): void {
  const frame = variant < 2 ? sink(WOOD, 0.1) : STEEL;
  footShadow(g, 0, 0.38, 0.46, 0.1);
  block(g, [-0.44, -0.46, 0.88, 0.84], 0.1, frame, paint);
  g.fillStyle = paint(sink(frame, 0.65));
  g.fillRect(-0.39, -0.33, 0.78, 0.66);
  const rand = seededRandom(0x5e1f0 + variant);
  for (const foot of [-0.1, 0.13, 0.33]) {
    let x = -0.37;
    while (x < 0.33) {
      const w = 0.04 + rand() * 0.05;
      const h = 0.13 + rand() * 0.07;
      if (rand() < 0.12) {
        g.fillStyle = paint(sink(PAPER, 0.2));
        g.fillRect(x, foot - 0.09, 0.16, 0.09);
        x += 0.18;
        continue;
      }
      g.fillStyle = paint(BINDERS[Math.floor(rand() * BINDERS.length)] ?? PAPER);
      g.fillRect(x, foot - h, w, h);
      g.fillStyle = rgba(WHITE, 0.22);
      g.fillRect(x + w * 0.25, foot - h * 0.7, w * 0.5, 0.025);
      x += w + 0.006;
    }
    g.fillStyle = paint(lift(frame, 0.05));
    g.fillRect(-0.4, foot, 0.8, 0.035);
  }
}

function drawCart(g: CanvasRenderingContext2D, variant: number, paint: Paint): void {
  footShadow(g, 0, 0.36, 0.36, 0.09);
  g.fillStyle = paint(sink(STEEL, 0.7));
  for (const x of [-0.27, 0.27]) {
    g.beginPath();
    addCircle(g, x, 0.33, 0.045);
    g.fill();
  }
  g.fillStyle = paint(sink(STEEL, 0.2));
  g.fillRect(-0.3, -0.05, 0.03, 0.36);
  g.fillRect(0.27, -0.05, 0.03, 0.36);
  block(g, [-0.34, 0.12, 0.68, 0.14], 0.05, STEEL, paint);
  block(g, [-0.34, -0.12, 0.68, 0.14], 0.05, STEEL, paint);
  const rand = seededRandom(0xca47 + variant);
  for (let k = 0; k < 3; k++) {
    const w = 0.16 + rand() * 0.06;
    const x = -0.3 + k * 0.21;
    const colour = k === 1 ? sink(PAPER, 0.25) : sink(WOOD, 0.05 + rand() * 0.2);
    block(g, [x, -0.34 + rand() * 0.06, w, 0.22], 0.06, colour, paint);
  }
  g.strokeStyle = paint(sink(STEEL, 0.1));
  g.lineWidth = 0.025;
  g.beginPath();
  g.moveTo(0.3, -0.12);
  g.lineTo(0.4, -0.3);
  g.stroke();
}

/** A flask, beaker or bottle on a bench top: glass, a coloured liquid, a highlight. */
function glassware(
  g: CanvasRenderingContext2D,
  [x, y, size]: readonly [number, number, number],
  liquid: Rgb,
  round: boolean,
  paint: Paint,
): void {
  g.beginPath();
  if (round) {
    g.arc(x, y, size, 0, TAU);
    g.rect(x - size * 0.3, y - size * 2.1, size * 0.6, size * 1.4);
  } else {
    g.rect(x - size * 0.7, y - size * 1.6, size * 1.4, size * 2.1);
  }
  g.fillStyle = rgba(GLASS, 0.35);
  g.fill();
  g.strokeStyle = paint(INK);
  g.lineWidth = OUTLINE * 0.6;
  g.stroke();
  g.fillStyle = paint(liquid);
  if (round) {
    g.beginPath();
    g.arc(x, y, size * 0.8, 0.1, Math.PI - 0.1);
    g.fill();
  } else {
    g.fillRect(x - size * 0.6, y - size * 0.4, size * 1.2, size * 0.8);
  }
  g.fillStyle = rgba(WHITE, 0.5);
  g.fillRect(x - size * 0.45, y - size * 0.9, size * 0.18, size * 0.6);
}

function drawBench(g: CanvasRenderingContext2D, variant: number, paint: Paint): void {
  footShadow(g, 0, 0.38, 0.47, 0.09);
  block(g, [-0.46, -0.2, 0.92, 0.56], 0.22, lift(LINO, 0.15), paint);
  g.fillStyle = paint(sink(LINO, 0.35));
  g.fillRect(-0.42, 0.06, 0.4, 0.27);
  g.fillRect(0.02, 0.06, 0.4, 0.27);
  g.fillStyle = paint(lift(STEEL, 0.3));
  g.fillRect(-0.06, 0.16, 0.025, 0.07);
  g.fillRect(0.04, 0.16, 0.025, 0.07);
  const liquids: readonly Rgb[] = [sink(PHOSPHOR, 0.25), sink(READ_BLUE, 0.2), sink(AMBER, 0.15)];
  const rand = seededRandom(0xbe7c + variant);
  for (let k = 0; k < 3; k++) {
    const x = -0.32 + k * 0.24 + rand() * 0.06;
    const liquid = liquids[(k + variant) % liquids.length] ?? PHOSPHOR;
    glassware(g, [x, -0.06, 0.05 + rand() * 0.015], liquid, (k + variant) % 2 === 0, paint);
  }
  if (variant === 3) {
    // A microscope at the bench's end.
    g.fillStyle = paint(sink(STEEL, 0.5));
    g.fillRect(0.3, -0.14, 0.1, 0.05);
    g.fillRect(0.33, -0.3, 0.035, 0.18);
    g.fillStyle = paint(lift(STEEL, 0.2));
    g.fillRect(0.31, -0.33, 0.06, 0.05);
  }
}

function drawHood(g: CanvasRenderingContext2D, _variant: number, paint: Paint): void {
  footShadow(g, 0, 0.38, 0.46, 0.09);
  block(g, [-0.44, -0.47, 0.88, 0.84], 0.1, lift(STEEL, 0.15), paint);
  g.fillStyle = paint(sink(STEEL, 0.75));
  g.fillRect(-0.36, -0.32, 0.72, 0.36);
  glassware(g, [-0.15, -0.04, 0.05], sink(PHOSPHOR, 0.3), true, paint);
  glassware(g, [0.12, -0.04, 0.045], sink(AMBER, 0.2), false, paint);
  g.fillStyle = rgba(GLASS, 0.18);
  g.fillRect(-0.36, -0.32, 0.72, 0.2);
  g.strokeStyle = paint(sink(STEEL, 0.3));
  g.lineWidth = 0.02;
  g.strokeRect(-0.36, -0.32, 0.72, 0.36);
  g.fillStyle = paint(sink(STEEL, 0.2));
  g.fillRect(-0.36, -0.13, 0.72, 0.03);
  g.fillStyle = paint(sink(STEEL, 0.35));
  g.fillRect(-0.4, 0.1, 0.38, 0.22);
  g.fillRect(0.02, 0.1, 0.38, 0.22);
  g.fillStyle = paint(sink(AMBER, 0.1));
  g.fillRect(0.22, -0.43, 0.14, 0.04);
}

/** A server rack's front: units with vents; its LEDs glow on their own (drawDecorGlow). */
function drawRack(g: CanvasRenderingContext2D, variant: number, paint: Paint): void {
  footShadow(g, 0, 0.38, 0.44, 0.09);
  block(g, [-0.4, -0.47, 0.8, 0.84], 0.09, sink(STEEL, 0.62), paint);
  for (let unit = 0; unit < 6; unit++) {
    const y = -0.34 + unit * 0.11;
    g.fillStyle = paint(sink(STEEL, (unit + variant) % 3 === 0 ? 0.55 : 0.7));
    g.fillRect(-0.34, y, 0.68, 0.09);
    g.fillStyle = rgba(BLACK, 0.55);
    for (let k = 0; k < 7; k++) g.fillRect(-0.06 + k * 0.05, y + 0.03, 0.03, 0.03);
    g.fillStyle = rgba(WHITE, 0.07);
    g.fillRect(-0.34, y, 0.68, 0.008);
  }
}

function drawGenerator(g: CanvasRenderingContext2D, variant: number, paint: Paint): void {
  const body = sink(mix(LINO, STEEL, 0.5), 0.3);
  footShadow(g, 0, 0.38, 0.47, 0.1);
  block(g, [-0.45, -0.36, 0.9, 0.72], 0.26, body, paint);
  g.strokeStyle = paint(sink(body, 0.45));
  g.lineWidth = 0.018;
  g.beginPath();
  for (let k = 0; k < 7; k++) {
    g.moveTo(-0.38 + k * 0.07, -0.32);
    g.lineTo(-0.38 + k * 0.07, -0.13);
  }
  g.stroke();
  g.beginPath();
  g.ellipse(0.22, -0.23, 0.15, 0.09, 0, 0, TAU);
  g.fillStyle = paint(sink(STEEL, 0.2));
  g.fill();
  g.strokeStyle = paint(INK);
  g.lineWidth = OUTLINE;
  g.stroke();
  g.fillStyle = paint(sink(AMBER, 0.08));
  g.beginPath();
  g.moveTo(-0.2, 0.0);
  g.lineTo(-0.1, 0.17);
  g.lineTo(-0.3, 0.17);
  g.closePath();
  g.fill();
  g.fillStyle = paint(INK);
  g.fillRect(-0.21, 0.05, 0.02, 0.07);
  g.beginPath();
  g.arc(0.2, 0.1, 0.08, 0, TAU);
  g.fillStyle = paint(lift(PAPER, 0.3));
  g.fill();
  g.strokeStyle = paint(INK);
  g.lineWidth = 0.015;
  g.stroke();
  if (variant % 2 === 1) {
    g.fillStyle = paint(sink(EMERGENCY, 0.3));
    g.fillRect(0.34, 0.18, 0.06, 0.08);
  }
}

/** An upright pipe as a cylinder seen from above: its front and its cut top. */
function upright(
  g: CanvasRenderingContext2D,
  [x, top, r]: readonly [number, number, number],
  paint: Paint,
): void {
  g.fillStyle = paint(STEEL);
  g.fillRect(x - r, top, r * 2, 0.34 - top);
  g.fillStyle = paint(lift(STEEL, 0.3));
  g.fillRect(x - r * 0.6, top, r * 0.4, 0.34 - top);
  g.fillStyle = paint(sink(STEEL, 0.4));
  g.fillRect(x + r * 0.4, top, r * 0.6, 0.34 - top);
  g.beginPath();
  g.ellipse(x, top, r, r * 0.45, 0, 0, TAU);
  g.fillStyle = paint(sink(STEEL, 0.6));
  g.fill();
  g.strokeStyle = paint(INK);
  g.lineWidth = OUTLINE * 0.8;
  g.stroke();
  g.strokeRect(x - r, top, r * 2, 0.34 - top);
}

function drawPipes(g: CanvasRenderingContext2D, variant: number, paint: Paint): void {
  footShadow(g, 0, 0.36, 0.42, 0.09);
  g.fillStyle = paint(sink(STEEL, 0.5));
  g.fillRect(-0.4, 0.28, 0.8, 0.08);
  upright(g, [-0.24, -0.38, 0.09], paint);
  upright(g, [0.04, -0.22, 0.075], paint);
  upright(g, [0.27, -0.42, 0.08], paint);
  g.fillStyle = paint(sink(STEEL, 0.15));
  g.fillRect(-0.24, -0.08, 0.51, 0.06);
  g.strokeStyle = paint(INK);
  g.lineWidth = OUTLINE * 0.7;
  g.strokeRect(-0.24, -0.08, 0.51, 0.06);
  const wheel = variant % 2 === 0 ? sink(AMBER, 0.25) : sink(EMERGENCY, 0.3);
  g.strokeStyle = paint(wheel);
  g.lineWidth = 0.025;
  g.beginPath();
  g.arc(0.04, 0.1, 0.075, 0, TAU);
  g.moveTo(-0.035, 0.1);
  g.lineTo(0.115, 0.1);
  g.moveTo(0.04, 0.025);
  g.lineTo(0.04, 0.175);
  g.stroke();
}

/** A drum's paint by variant: steel blue, rust, hazard yellow, green. */
const DRUMS: readonly Rgb[] = [
  sink(READ_BLUE, 0.4),
  sink(REACTOR, 0.5),
  sink(AMBER, 0.15),
  sink(mix(LINO, DONE_GREEN, 0.3), 0.45),
];

function drawBarrel(g: CanvasRenderingContext2D, variant: number, paint: Paint): void {
  const drum = DRUMS[variant % DRUMS.length] ?? STEEL;
  footShadow(g, 0, 0.36, 0.3, 0.08);
  g.fillStyle = paint(sink(drum, 0.15));
  g.fillRect(-0.24, -0.26, 0.48, 0.6);
  g.fillStyle = paint(lift(drum, 0.18));
  g.fillRect(-0.18, -0.26, 0.07, 0.6);
  g.fillStyle = paint(sink(drum, 0.45));
  g.fillRect(0.12, -0.26, 0.12, 0.6);
  g.fillStyle = paint(sink(drum, 0.5));
  g.fillRect(-0.24, -0.06, 0.48, 0.03);
  g.fillRect(-0.24, 0.16, 0.48, 0.03);
  g.strokeStyle = paint(INK);
  g.lineWidth = OUTLINE;
  g.strokeRect(-0.24, -0.26, 0.48, 0.6);
  g.beginPath();
  g.ellipse(0, -0.26, 0.24, 0.1, 0, 0, TAU);
  g.fillStyle = paint(lift(drum, 0.08));
  g.fill();
  g.stroke();
  g.fillStyle = paint(sink(drum, 0.6));
  g.beginPath();
  addCircle(g, 0.1, -0.27, 0.025);
  g.fill();
  if (variant === 2) {
    g.fillStyle = paint(INK);
    g.beginPath();
    g.moveTo(0, 0.0);
    g.lineTo(0.07, 0.12);
    g.lineTo(-0.07, 0.12);
    g.closePath();
    g.fill();
  }
}

/** The core's housing: a steel ring of bolts round its glowing heart, its drum below. */
function drawCore(g: CanvasRenderingContext2D, _variant: number, paint: Paint): void {
  footShadow(g, 0, 0.38, 0.48, 0.1);
  g.fillStyle = paint(sink(STEEL, 0.3));
  g.fillRect(-0.4, -0.1, 0.8, 0.44);
  g.fillStyle = paint(sink(STEEL, 0.5));
  for (let k = 0; k < 6; k++) g.fillRect(-0.36 + k * 0.14, -0.08, 0.04, 0.4);
  g.strokeStyle = paint(INK);
  g.lineWidth = OUTLINE;
  g.strokeRect(-0.4, -0.1, 0.8, 0.44);
  g.beginPath();
  g.ellipse(0, -0.12, 0.42, 0.3, 0, 0, TAU);
  g.fillStyle = paint(lift(STEEL, 0.05));
  g.fill();
  g.stroke();
  g.fillStyle = paint(sink(STEEL, 0.4));
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * TAU;
    g.beginPath();
    addCircle(g, Math.cos(a) * 0.35, -0.12 + Math.sin(a) * 0.245, 0.018);
    g.fill();
  }
  g.beginPath();
  g.ellipse(0, -0.12, 0.25, 0.17, 0, 0, TAU);
  g.fillStyle = paint(sink(REACTOR, 0.62));
  g.fill();
  g.strokeStyle = paint(INK);
  g.lineWidth = OUTLINE;
  g.stroke();
  g.fillStyle = paint(sink(AMBER, 0.1));
  g.fillRect(-0.12, 0.2, 0.24, 0.06);
}

/** Fat cables across the floor toward the core, or coiled beside a junction box. */
function drawCables(g: CanvasRenderingContext2D, variant: number, paint: Paint): void {
  const sheath = sink(STEEL, 0.72);
  const run = (y: number, sag: number, band: Rgb): void => {
    g.strokeStyle = paint(INK);
    g.lineWidth = 0.11;
    g.beginPath();
    g.moveTo(-0.5, y);
    g.bezierCurveTo(-0.15, y + sag, 0.15, y - sag, 0.5, y);
    g.stroke();
    g.strokeStyle = paint(sheath);
    g.lineWidth = 0.08;
    g.stroke();
    g.strokeStyle = paint(band);
    g.lineWidth = 0.014;
    g.stroke();
  };
  if (variant >= 2) {
    footShadow(g, 0.1, 0.25, 0.3, 0.08);
    block(g, [-0.05, -0.2, 0.36, 0.44], 0.1, sink(STEEL, 0.2), paint);
    g.fillStyle = paint(sink(AMBER, 0.1));
    g.fillRect(0.04, -0.02, 0.18, 0.06);
    run(0.28, -0.08, sink(REACTOR, 0.2));
    return;
  }
  g.save();
  if (variant === 1) g.scale(-1, 1);
  run(-0.12, 0.12, sink(REACTOR, 0.15));
  run(0.12, -0.1, sink(AMBER, 0.2));
  g.restore();
}

/** A console desk: a slanted panel of keys and lamps, its screen at the back. */
function drawDesk(g: CanvasRenderingContext2D, variant: number, paint: Paint): void {
  footShadow(g, 0, 0.38, 0.47, 0.09);
  g.beginPath();
  roundRectPath(g, -0.3, -0.46, 0.6, 0.36, 0.04);
  g.fillStyle = paint(variant % 2 === 0 ? sink(STEEL, 0.45) : mix(PAPER, STEEL, 0.55));
  g.fill();
  g.strokeStyle = paint(INK);
  g.lineWidth = OUTLINE;
  g.stroke();
  g.beginPath();
  roundRectPath(g, -0.24, -0.41, 0.48, 0.26, 0.03);
  g.fillStyle = paint(mix(sink(PHOSPHOR, 0.92), INK, 0.4));
  g.fill();
  block(g, [-0.46, -0.1, 0.92, 0.46], 0.2, sink(STEEL, 0.25), paint);
  const lamps: readonly Rgb[] = [AMBER, DONE_GREEN, ALARM, READ_BLUE];
  for (let k = 0; k < 8; k++) {
    const lamp = lamps[(k + variant) % lamps.length] ?? AMBER;
    g.fillStyle = paint(sink(lamp, k % 3 === 0 ? 0.1 : 0.5));
    g.fillRect(-0.4 + k * 0.1, -0.06, 0.06, 0.04);
  }
  g.fillStyle = paint(sink(STEEL, 0.6));
  for (let k = 0; k < 6; k++) g.fillRect(-0.36 + k * 0.13, 0.02, 0.09, 0.05);
}

const STILL_DECOR: Readonly<
  Record<DecorKind, (g: CanvasRenderingContext2D, variant: number, paint: Paint) => void>
> = {
  shelf: drawShelf,
  cart: drawCart,
  bench: drawBench,
  hood: drawHood,
  rack: drawRack,
  generator: drawGenerator,
  pipes: drawPipes,
  barrel: drawBarrel,
  core: drawCore,
  cables: drawCables,
  desk: drawDesk,
};

/**
 * The still part of a piece of furniture of `kind` in `variant`, lit by the
 * ceiling lights or found in the dark: what the atlas bakes. Anchor: TILE CENTRE.
 */
export function drawDecor(
  g: CanvasRenderingContext2D,
  kind: DecorKind,
  variant: number,
  lit: boolean,
): void {
  const paint: Paint = (rgb) => css(inLight(rgb, lit));
  g.save();
  try {
    STILL_DECOR[kind](g, variant, paint);
  } finally {
    g.restore();
  }
}

/** A piece's look when its mission names none: from its tile, the same every run. */
export function decorVariant(piece: { x: number; y: number; variant?: number }): number {
  return piece.variant ?? hashTile(0xdec0, piece.x, piece.y) % 4;
}

/** A rack's LEDs, blinking in patterns of their own, in the dark too. */
function rackLeds(ctx: CanvasRenderingContext2D, variant: number, t: number): void {
  for (let unit = 0; unit < 6; unit++) {
    const y = -0.31 + unit * 0.11;
    for (let k = 0; k < 4; k++) {
      const id = unit * 4 + k + variant * 31;
      const rate = 1.2 + (id % 6) * 0.8;
      if ((Math.floor(t * rate + id * 0.29) + id) % 3 === 0) continue;
      const colour = id % 9 === 0 ? AMBER : id % 4 === 0 ? DONE_GREEN : SERVER_BLUE;
      ctx.fillStyle = rgba(colour, 0.95);
      ctx.fillRect(-0.3 + k * 0.05, y, 0.025, 0.02);
    }
  }
}

/** The core's heart: orange, pulsing slowly, whatever the lab's power. */
function coreHeart(ctx: CanvasRenderingContext2D, t: number): void {
  const beat = pulseWave((t / 2.4) % 1);
  ctx.beginPath();
  ctx.ellipse(0, -0.12, 0.23, 0.155, 0, 0, TAU);
  ctx.fillStyle = rgba(REACTOR, 0.55 + 0.35 * beat);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, -0.12, 0.12, 0.08, 0, 0, TAU);
  ctx.fillStyle = rgba(lift(REACTOR, 0.55), 0.7 + 0.3 * beat);
  ctx.fill();
}

/** The generator's lamp: green running, amber blinking slowly on standby, a halo round it. */
function generatorLamp(ctx: CanvasRenderingContext2D, state: PropState): void {
  const running = state.on > 0.5;
  const lit = running || Math.floor(state.t * 1.2) % 2 === 0;
  const colour = running ? DONE_GREEN : AMBER;
  ctx.fillStyle = rgba(colour, lit ? 0.28 : 0.08);
  ctx.beginPath();
  addCircle(ctx, 0.36, -0.02, 0.12);
  ctx.fill();
  ctx.fillStyle = rgba(colour, lit ? 0.95 : 0.3);
  ctx.beginPath();
  addCircle(ctx, 0.36, -0.02, 0.032);
  ctx.fill();
}

/** A desk's screen: phosphor text once its room is lit, a standby dot while it is dark. */
function deskScreen(ctx: CanvasRenderingContext2D, variant: number, state: PropState): void {
  if (state.on <= 0.02) {
    ctx.fillStyle = rgba(AMBER, 0.85);
    ctx.beginPath();
    addCircle(ctx, 0.19, -0.13, 0.016);
    ctx.fill();
    return;
  }
  ctx.fillStyle = rgba(PHOSPHOR, 0.18 * state.on);
  ctx.fillRect(-0.24, -0.41, 0.48, 0.26);
  ctx.fillStyle = rgba(PHOSPHOR, 0.8 * state.on);
  const step = state.reduced ? 0 : Math.floor(state.t * 1.5);
  for (let k = 0; k < 5; k++) {
    const length = 0.1 + (hashTile(variant, k + step, 3) % 100) * 0.0025;
    ctx.fillRect(-0.2, -0.38 + k * 0.045, length, 0.016);
  }
}

/**
 * What glows on a piece of furniture, over the darkness: a rack's LEDs, the
 * core's heart, a desk's screen, a generator's lamp, the hood's light, a
 * flask's green. Anchor: TILE CENTRE.
 */
export function drawDecorGlow(
  ctx: CanvasRenderingContext2D,
  kind: DecorKind,
  variant: number,
  state: PropState,
): void {
  ctx.save();
  try {
    if (kind === 'rack') rackLeds(ctx, variant, state.t);
    else if (kind === 'core') coreHeart(ctx, state.t);
    else if (kind === 'desk') deskScreen(ctx, variant, state);
    else if (kind === 'generator') generatorLamp(ctx, state);
    else if (kind === 'hood' && state.on > 0.02) {
      ctx.fillStyle = rgba(lift(GLASS, 0.5), 0.3 * state.on);
      ctx.fillRect(-0.36, -0.32, 0.72, 0.18);
    } else if (kind === 'bench' && variant % 2 === 0) {
      ctx.fillStyle = rgba(PHOSPHOR, 0.55);
      ctx.beginPath();
      ctx.arc(-0.32, -0.06, 0.035, 0, TAU);
      ctx.fill();
    }
  } finally {
    ctx.restore();
  }
}

/** Whether a piece of furniture has anything that glows. */
export function decorGlows(kind: DecorKind, variant: number): boolean {
  return (
    kind === 'rack' ||
    kind === 'core' ||
    kind === 'desk' ||
    kind === 'generator' ||
    kind === 'hood' ||
    (kind === 'bench' && variant % 2 === 0)
  );
}

/** Whether steam leaks from a piece of furniture: the valves of a pipe stack. */
export function decorSteams(kind: DecorKind, variant: number): boolean {
  return kind === 'pipes' && variant % 2 === 1;
}

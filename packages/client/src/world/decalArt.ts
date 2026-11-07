import { TAU } from './brush.js';
import type { Decal, DecalKind } from './decals.js';
import {
  AMBER,
  BLACK,
  DONE_GREEN,
  GLASS,
  inLight,
  PAPER,
  READ_BLUE,
  rgba,
  sink,
  STEEL,
  WOOD,
  type Rgb,
} from './palette.js';

/**
 * How the marks on the floor look (decals.ts), drawn in tile space round their middle and
 * turned their way, in the light of the tile they lie on — as the floor under them is
 * (surfaces.ts): faint, small and flat, so that nothing on the floor reads as a thing to find.
 */

/** The colour `rgb` at `alpha` in the tile's light. */
function paint(rgb: Rgb, alpha: number, lit: boolean): string {
  return rgba(inLight(rgb, lit), alpha);
}

/** A ring a mug left: an arc of coffee, a second one beside it on another look. */
function drawCoffee(g: CanvasRenderingContext2D, variant: number, lit: boolean): void {
  g.strokeStyle = paint(sink(WOOD, 0.45), 0.4, lit);
  g.lineWidth = 0.022;
  const rings = variant === 1 ? [[0, 0], [0.09, 0.05]] : [[0, 0]];
  for (const [x = 0, y = 0] of rings) {
    g.beginPath();
    g.arc(x, y, 0.085, 0.3, TAU - 0.5);
    g.stroke();
  }
}

/** A sheet or two dropped: paper with its lines of print. */
function drawPapers(g: CanvasRenderingContext2D, variant: number, lit: boolean): void {
  const sheets = variant === 2 ? 2 : 1;
  for (let k = 0; k < sheets; k++) {
    g.save();
    g.rotate(k * 0.5);
    g.translate(k * 0.08, k * 0.05);
    g.fillStyle = paint(PAPER, 0.8, lit);
    g.fillRect(-0.11, -0.14, 0.22, 0.28);
    g.fillStyle = paint(sink(PAPER, 0.5), 0.6, lit);
    for (let line = 0; line < 4; line++) {
      g.fillRect(-0.07, -0.09 + line * 0.05, line === 3 ? 0.08 : 0.14, 0.012);
    }
    g.restore();
  }
}

/** A puddle of `rgb`: a few round blots run together, a rim a shade darker. */
function drawPuddle(g: CanvasRenderingContext2D, rgb: Rgb, alpha: number, lit: boolean): void {
  g.fillStyle = paint(rgb, alpha, lit);
  g.beginPath();
  for (const [x, y, r] of [
    [0, 0, 0.13],
    [0.1, 0.05, 0.08],
    [-0.08, 0.06, 0.07],
    [0.04, -0.09, 0.06],
  ] as const) {
    g.moveTo(x + r, y);
    g.arc(x, y, r, 0, TAU);
  }
  g.fill();
}

/** Tyre marks of a trolley turning: two treads side by side, curving. */
function drawTyres(g: CanvasRenderingContext2D, lit: boolean): void {
  g.strokeStyle = paint(sink(STEEL, 0.75), 0.28, lit);
  g.lineWidth = 0.035;
  g.setLineDash([0.04, 0.025]);
  for (const r of [0.28, 0.4]) {
    g.beginPath();
    g.arc(-0.3, 0.25, r, -1.2, -0.3);
    g.stroke();
  }
  g.setLineDash([]);
}

/** Cable ties cut off and dropped, a few colours. */
function drawTies(g: CanvasRenderingContext2D, lit: boolean): void {
  const ties: [number, number, number, Rgb][] = [
    [-0.08, 0, 0.4, READ_BLUE],
    [0.05, 0.05, -0.7, DONE_GREEN],
    [0.02, -0.07, 1.2, sink(PAPER, 0.1)],
  ];
  for (const [x, y, turn, rgb] of ties) {
    g.save();
    g.translate(x, y);
    g.rotate(turn);
    g.fillStyle = paint(rgb, 0.7, lit);
    g.fillRect(-0.06, -0.008, 0.12, 0.016);
    g.restore();
  }
}

/** Soot where something shorted: dark at its heart, fading out raggedly. */
function drawScorch(g: CanvasRenderingContext2D, lit: boolean): void {
  const soot = g.createRadialGradient(0, 0, 0, 0, 0, 0.32);
  soot.addColorStop(0, paint(BLACK, 0.55, lit));
  soot.addColorStop(0.5, paint(BLACK, 0.28, lit));
  soot.addColorStop(1, paint(BLACK, 0, lit));
  g.fillStyle = soot;
  g.beginPath();
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * TAU;
    const r = k % 2 === 0 ? 0.32 : 0.2;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
}

/** Shoes' scuffs: short dark strokes, curved. */
function drawScuff(g: CanvasRenderingContext2D, lit: boolean): void {
  g.strokeStyle = paint(sink(STEEL, 0.8), 0.22, lit);
  g.lineWidth = 0.02;
  g.beginPath();
  g.arc(0, 0.2, 0.2, -2.2, -1.4);
  g.moveTo(0.05, 0.1);
  g.arc(0.05, 0.28, 0.18, -2.0, -1.3);
  g.stroke();
}

/** A torn strip of yellow floor tape. */
function drawTape(g: CanvasRenderingContext2D, lit: boolean): void {
  g.fillStyle = paint(AMBER, 0.55, lit);
  g.beginPath();
  g.moveTo(-0.16, -0.03);
  g.lineTo(0.15, -0.03);
  g.lineTo(0.12, 0);
  g.lineTo(0.16, 0.03);
  g.lineTo(-0.16, 0.03);
  g.closePath();
  g.fill();
}

/** Screws dropped and left: three small steel heads. */
function drawScrews(g: CanvasRenderingContext2D, lit: boolean): void {
  g.fillStyle = paint(STEEL, 0.85, lit);
  for (const [x, y] of [
    [0, 0],
    [0.07, 0.04],
    [-0.05, 0.06],
  ] as const) {
    g.beginPath();
    g.arc(x, y, 0.018, 0, TAU);
    g.fill();
  }
}

/** The corridor's floor paint: yellow, worn. */
const FLOOR_PAINT = sink(AMBER, 0.15);

/** A dash of the lane line, along its way. */
function drawLane(g: CanvasRenderingContext2D, lit: boolean): void {
  g.fillStyle = paint(FLOOR_PAINT, 0.4, lit);
  g.fillRect(-0.22, -0.025, 0.44, 0.05);
}

/** An arrow painted on the floor, pointing the way to the exit. */
function drawArrow(g: CanvasRenderingContext2D, lit: boolean): void {
  g.fillStyle = paint(FLOOR_PAINT, 0.45, lit);
  g.beginPath();
  g.moveTo(0.26, 0);
  g.lineTo(0.06, -0.15);
  g.lineTo(0.06, -0.05);
  g.lineTo(-0.24, -0.05);
  g.lineTo(-0.24, 0.05);
  g.lineTo(0.06, 0.05);
  g.lineTo(0.06, 0.15);
  g.closePath();
  g.fill();
}

/** Each mark's drawing, round its middle, facing along +x. */
const DRAW: Readonly<
  Record<DecalKind, (g: CanvasRenderingContext2D, variant: number, lit: boolean) => void>
> = {
  coffee: drawCoffee,
  papers: drawPapers,
  spill: (g, _v, lit) => drawPuddle(g, sink(GLASS, 0.15), 0.22, lit),
  oil: (g, _v, lit) => drawPuddle(g, sink(WOOD, 0.85), 0.32, lit),
  tyres: (g, _v, lit) => drawTyres(g, lit),
  ties: (g, _v, lit) => drawTies(g, lit),
  scorch: (g, _v, lit) => drawScorch(g, lit),
  scuff: (g, _v, lit) => drawScuff(g, lit),
  tape: (g, _v, lit) => drawTape(g, lit),
  screws: (g, _v, lit) => drawScrews(g, lit),
  lane: (g, _v, lit) => drawLane(g, lit),
  arrow: (g, _v, lit) => drawArrow(g, lit),
};

/** Draws `decal` over `g` (tile space), in the light of its tile (`lit`). */
export function drawDecal(g: CanvasRenderingContext2D, decal: Decal, lit: boolean): void {
  g.save();
  g.translate(decal.x, decal.y);
  g.rotate(decal.angle);
  DRAW[decal.kind](g, decal.variant, lit);
  g.restore();
}

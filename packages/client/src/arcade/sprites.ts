/**
 * The machine's own pixel art (the reference's src/sprites.js): the ferret, the ducks with their
 * marks, the Great Drake, the visitor, the pickups and the shield. Every cell snaps to the device
 * pixel grid, so the art stays crisp at any size: `snap` takes the transform once per sprite, and
 * `rect` rounds each edge on it.
 */

type Ctx = CanvasRenderingContext2D;
type Grid = Pick<DOMMatrix, 'a' | 'd' | 'e' | 'f'>;

let grid: Grid = { a: 1, d: 1, e: 0, f: 0 };

/** Takes the canvas's transform for the cells drawn next. */
export function snap(ctx: Ctx): void {
  grid = ctx.getTransform();
}

/** A rectangle whose edges fall on device pixels under the transform `snap` took. */
export function rect(ctx: Ctx, x: number, y: number, width: number, height: number): void {
  const { a, d, e, f } = grid;
  const x0 = Math.round(a * x + e);
  const y0 = Math.round(d * y + f);
  ctx.fillRect(
    (x0 - e) / a,
    (y0 - f) / d,
    (Math.round(a * (x + width) + e) - x0) / a,
    (Math.round(d * (y + height) + f) - y0) / d,
  );
}

const P: Readonly<Record<string, string>> = {
  b: '#543a45',
  c: '#fff2cb',
  s: '#b98668',
  d: '#211f31',
  p: '#f6a4a5',
  w: '#ffffff',
  o: '#ffad45',
  y: '#ffe17c',
  g: '#76bca3',
  v: '#b69af4',
  a: '#5e8fe0',
  m: '#b7cbd0',
  t: '#64efd3',
};
const FERRET = [
  '....................bb..bb..',
  '...................bppbbppb.',
  '...bb...bbbbbbbbbbbbccccccb.',
  '..bssbbbssssssssssbccccccccb',
  '.bssbsssssssssssssbcddccddcb',
  'bssb.sssssssssssssbcdwccdwcp',
  'bssb.bccccccccccccbcccccccb.',
  '.bb...bccccccccccccccccccb..',
  '.......bccccccccccccccbb...',
  '........bbbbbbbbbbbbbb.....',
  '.........cc.......cc.......',
];
const DUCK = [
  '........kkkkkk........',
  '......kkkkkkkkkk......',
  '.....kkkkkkkkkkkk.....',
  '.....kkkwwkkkkwwk.....',
  '.....kkkdwkkkkdwkooo..',
  '.....kkkkkkkkkkkooooo.',
  '.....kkkkkkkkkkkoooo..',
  '....kkkkkkkkkkkkk.....',
  '...kkkkcccccckkkkk....',
  '..kkkkcccccccckkkkk...',
  '...kkkcccccccckkkk....',
  '....kkkkcccckkkkk.....',
  '......kkkkkkkkk.......',
  '.......oo..oo.........',
  '......ooo..ooo........',
];

function pixels(
  ctx: Ctx,
  map: readonly string[],
  x: number,
  y: number,
  scale: number,
  colors: Readonly<Record<string, string>> = P,
): void {
  map.forEach((row, j) => {
    [...row].forEach((code, i) => {
      const color = colors[code];
      if (color === undefined) return;
      ctx.fillStyle = color;
      rect(ctx, x + i * scale, y + j * scale, scale, scale);
    });
  });
}

export interface FerretPose {
  scale: number;
  moving: boolean;
  recoil: number;
  dead: boolean;
  flip: boolean;
  flash: boolean;
}
const FERRET_POSE: FerretPose = {
  scale: 2,
  moving: false,
  recoil: 0,
  dead: false,
  flip: false,
  flash: false,
};
function muzzle(ctx: Ctx, scale: number): void {
  ctx.fillStyle = P['y'] ?? '';
  rect(ctx, 8 * scale, -9 * scale, scale, 3 * scale);
  rect(ctx, 7 * scale, -8 * scale, 3 * scale, scale);
}
function paws(ctx: Ctx, scale: number, t: number): void {
  ctx.fillStyle = P['c'] ?? '';
  rect(ctx, -5 * scale, 5 * scale + Math.sin(t * 22) * 2, 2 * scale, scale);
  rect(ctx, 5 * scale, 5 * scale - Math.sin(t * 22) * 2, 2 * scale, scale);
}
export function drawFerret(ctx: Ctx, x: number, y: number, t: number, pose: Partial<FerretPose> = {}) {
  const { scale, moving, recoil, dead, flip, flash } = { ...FERRET_POSE, ...pose };
  ctx.save();
  ctx.translate(x, y + Math.sin(t * 3) * 1.2 + recoil * 18);
  if (flip) ctx.scale(-1, 1);
  snap(ctx);
  if (dead) ctx.globalAlpha = 0.4;
  const bob = moving ? Math.sin(t * 22) * 1.5 : 0;
  pixels(ctx, FERRET, (-28 * scale) / 2, (-11 * scale) / 2 + bob, scale);
  ctx.fillStyle = P['b'] ?? '';
  rect(ctx, (-24 * scale) / 2, -2 * scale + Math.sin(t * 9) * 1.5, 3 * scale, 2 * scale);
  if (moving) paws(ctx, scale, t);
  if (flash) muzzle(ctx, scale);
  ctx.restore();
}

export const duckColor = (row: number): string =>
  row === 0 ? '#b69af4' : row < 3 ? '#76bca3' : '#ffe17c';
const wingColor = (row: number): string =>
  row === 0 ? '#8b6dc4' : row < 3 ? '#4b957f' : '#eebc50';

/** Shape marks tell the duck families apart without colour: shades, a tuft, a cap. */
function duckMarks(ctx: Ctx, row: number, scale: number): void {
  if (row === 0) {
    ctx.fillStyle = '#211f31';
    rect(ctx, -5 * scale, -4 * scale, 11 * scale, 2 * scale);
    ctx.fillStyle = '#a3eae1';
    rect(ctx, -4 * scale, -4 * scale, scale, scale);
    rect(ctx, 3 * scale, -4 * scale, scale, scale);
  } else if (row < 3) {
    ctx.fillStyle = '#4b957f';
    rect(ctx, -1 * scale, -9 * scale, scale, 2 * scale);
    rect(ctx, 0, -10 * scale, scale, 3 * scale);
    rect(ctx, scale, -9 * scale, scale, scale);
  } else {
    ctx.fillStyle = '#5e8fe0';
    rect(ctx, -4 * scale, -9 * scale, 7 * scale, 2 * scale);
    rect(ctx, -2 * scale, -7 * scale, 9 * scale, scale);
  }
}
function helmet(ctx: Ctx, scale: number): void {
  ctx.fillStyle = '#55666e';
  rect(ctx, -6 * scale, -8.5 * scale, 13 * scale, 4 * scale);
  ctx.fillStyle = '#b7cbd0';
  rect(ctx, -5 * scale, -9.5 * scale, 11 * scale, 3 * scale);
  ctx.fillStyle = '#eef6f7';
  rect(ctx, -3 * scale, -9 * scale, scale, scale);
  rect(ctx, 2 * scale, -9 * scale, scale, scale);
}
function openBill(ctx: Ctx, scale: number): void {
  ctx.fillStyle = '#211f31';
  rect(ctx, 5.5 * scale, -2 * scale, 4 * scale, scale);
}

export interface DuckLook {
  armor: number;
  beak: boolean;
  squash: number;
  flap: number;
}
const DUCK_LOOK: DuckLook = { armor: 0, beak: false, squash: 0, flap: 8 };

export function drawDuck(
  ctx: Ctx,
  x: number,
  y: number,
  row: number,
  t: number,
  scale = 2,
  look: Partial<DuckLook> = {},
): void {
  const { armor, beak, squash, flap } = { ...DUCK_LOOK, ...look };
  const bob = Math.sin(t * 5 + x * 0.08) * 1.5;
  ctx.save();
  ctx.translate(x, y + bob);
  if (squash) ctx.scale(1 + squash * 0.06, 1 - squash * 0.08);
  snap(ctx);
  pixels(ctx, DUCK, -11 * scale, -7.5 * scale, scale, { ...P, k: duckColor(row) });
  ctx.fillStyle = wingColor(row);
  rect(ctx, -7 * scale, Math.round(Math.sin(t * flap) * 1.5) * scale, 5 * scale, 3 * scale);
  duckMarks(ctx, row, scale);
  if (armor > 0) helmet(ctx, scale);
  if (beak) openBill(ctx, scale);
  ctx.restore();
}

/** The wave boss: a big drake in a captain's cap, frowning, with a gold medal. */
export function drawBoss(ctx: Ctx, x: number, y: number, t: number, hurt = 0): void {
  drawDuck(ctx, x, y, 1, t * 0.6, 4.5, { beak: Math.sin(t * 2) > 0.7 });
  ctx.save();
  ctx.translate(x, y + Math.sin(t * 3 + x * 0.08) * 1.5);
  snap(ctx);
  const s = 4.5;
  ctx.fillStyle = '#1d2a44';
  rect(ctx, -7 * s, -10 * s, 15 * s, 3 * s);
  rect(ctx, -2 * s, -7 * s, 12 * s, s);
  ctx.fillStyle = '#ffe17c';
  rect(ctx, -7 * s, -8 * s, 15 * s, s * 0.6);
  rect(ctx, -s, -11 * s, 3 * s, s);
  ctx.fillStyle = '#211f31';
  rect(ctx, -1 * s, -5 * s, 3 * s, s * 0.7);
  rect(ctx, 4 * s, -5 * s, 3 * s, s * 0.7);
  ctx.fillStyle = '#ffad45';
  rect(ctx, -3 * s, 3 * s, 2 * s, 2 * s);
  if (hurt > 0) {
    ctx.globalAlpha = Math.min(0.6, hurt * 4);
    ctx.fillStyle = '#ffffff';
    rect(ctx, -10 * s, -8 * s, 20 * s, 15 * s);
  }
  ctx.restore();
}

const PICKUP_COLORS: Readonly<Record<string, string>> = {
  spread: '#ffad45',
  shield: '#64efd3',
  slow: '#b69af4',
};
/** Pickups differ in shape as well as colour: a fan of bolts, a ring, an hourglass. */
const PICKUP_ICONS: Readonly<Record<string, readonly string[]>> = {
  spread: ['x...x', '.x.x.', '..x..', '..x..', '..x..'],
  shield: ['.xxx.', 'x...x', 'x...x', 'x...x', '.xxx.'],
  slow: ['xxxxx', '.x.x.', '..x..', '.x.x.', 'xxxxx'],
};
export const pickupColor = (kind: string): string => PICKUP_COLORS[kind] ?? '#ffffff';

export function drawPickup(ctx: Ctx, x: number, y: number, kind: string, t: number): void {
  ctx.save();
  ctx.translate(x, y + Math.sin(t * 4) * 2);
  snap(ctx);
  ctx.fillStyle = '#0e1714';
  rect(ctx, -13, -13, 26, 26);
  ctx.fillStyle = pickupColor(kind);
  rect(ctx, -13, -13, 26, 2);
  rect(ctx, -13, 11, 26, 2);
  rect(ctx, -13, -13, 2, 26);
  rect(ctx, 11, -13, 2, 26);
  (PICKUP_ICONS[kind] ?? []).forEach((row, j) => {
    [...row].forEach((c, i) => {
      if (c === 'x') rect(ctx, -10 + i * 4, -10 + j * 4, 4, 4);
    });
  });
  ctx.restore();
}

export function drawShield(ctx: Ctx, x: number, y: number, t: number): void {
  ctx.save();
  ctx.translate(x, y);
  snap(ctx);
  ctx.globalAlpha = 0.55 + Math.sin(t * 4) * 0.15;
  ctx.fillStyle = '#64efd3';
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    rect(ctx, Math.cos(a) * 36 - 2, Math.sin(a) * 24 - 2, 4, 4);
  }
  ctx.restore();
}

export function drawSaucer(ctx: Ctx, x: number, y: number, t: number): void {
  ctx.save();
  ctx.translate(x, y);
  snap(ctx);
  ctx.fillStyle = '#64efd3';
  rect(ctx, -15, -17, 30, 15);
  ctx.fillStyle = '#244950';
  rect(ctx, -11, -14, 22, 11);
  ctx.fillStyle = '#ffe17c';
  rect(ctx, -4, -12, 8, 8);
  ctx.fillStyle = '#ffad45';
  rect(ctx, 4, -9, 4, 3);
  ctx.fillStyle = '#d4e5e6';
  rect(ctx, -25, -3, 50, 9);
  rect(ctx, -34, 0, 68, 4);
  ctx.fillStyle = '#667e8e';
  rect(ctx, -21, 6, 42, 4);
  ctx.fillStyle = Math.sin(t * 12) > 0 ? '#64efd3' : '#ffad45';
  for (const lx of [-17, 0, 17]) rect(ctx, lx - 2, 2, 4, 3);
  ctx.restore();
}

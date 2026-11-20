/**
 * The marsh of Ferret Flush (the reference's src/scene.js): five times of day, the sky, the far
 * bank, the lake, the reeds behind and the grass in front. It is built in layers, like cut paper
 * in a box, so that the ducks and the ferret can go between them. Far layers follow the sight a
 * little, near layers go against it.
 */
import { TAU, css, curve, ellipse, lerp, mixRgb, rgb, seeded, type Point, type Rgb } from './kit.js';
import { W, H } from './rules.js';

type Ctx = CanvasRenderingContext2D;

export const HORIZON = 424;
const MOON: Point = [0.8 * W, 0.22 * H];

const COLOUR_KEYS = [
  'sky0',
  'sky1',
  'sky2',
  'sun',
  'cloud',
  'cloudLit',
  'hill0',
  'hill1',
  'hill2',
  'water0',
  'water1',
  'glint',
  'reed0',
  'reed1',
  'cattail',
  'grass0',
  'grass1',
  'bank',
  'path',
  'pathLit',
  'mist',
  'amb',
] as const;
const NUMBER_KEYS = ['sunX', 'sunY', 'moon', 'stars', 'mistA', 'ambK', 'flies', 'pollen'] as const;
export type ColourKey = (typeof COLOUR_KEYS)[number];
type NumberKey = (typeof NUMBER_KEYS)[number];
type SkySpec = { name: string } & Record<ColourKey, string> & Record<NumberKey, number>;

/** The colours of a time of day as CSS, its numbers, and its colours as [r, g, b] (`raw`). */
export type Sky = { name: string; raw: Record<ColourKey, Rgb> } & Record<ColourKey, string> &
  Record<NumberKey, number>;

/** Five times of day, one per round in turn. `amb` is the light that falls on the animals. */
const SKIES: readonly SkySpec[] = [
  {
    name: 'Morgengrauen',
    sky0: '#2b3a78', sky1: '#c0719a', sky2: '#ffc9a4',
    sun: '#fff1d0', sunX: 0.83, sunY: 0.42, moon: 0, stars: 0.18,
    cloud: '#f7b9b4', cloudLit: '#ffe3d4',
    hill0: '#b497c2', hill1: '#8a73ab', hill2: '#5d548f',
    water0: '#f6b9a9', water1: '#8573ab', glint: '#fff3e0',
    reed0: '#5d7c80', reed1: '#456468', cattail: '#6b4a3a',
    grass0: '#2f4d55', grass1: '#223c45', bank: '#1c333c', path: '#152a33', pathLit: '#24424c',
    mist: '#ffd9c8', mistA: 0.42, amb: '#ff9f8f', ambK: 0.1, flies: 0, pollen: 0.5,
  },
  {
    name: 'Heller Morgen',
    sky0: '#2a7fd0', sky1: '#74bdea', sky2: '#d5eef5',
    sun: '#fff9d6', sunX: 0.62, sunY: 0.2, moon: 0, stars: 0,
    cloud: '#eaf6fb', cloudLit: '#ffffff',
    hill0: '#9fcbc7', hill1: '#6fb19a', hill2: '#3f8d69',
    water0: '#b5e5ea', water1: '#3f93b5', glint: '#ffffff',
    reed0: '#79b35c', reed1: '#5a9a4b', cattail: '#7a4e2c',
    grass0: '#3f8a43', grass1: '#2d7038', bank: '#25602f', path: '#1d4f27', pathLit: '#3a7a3c',
    mist: '#ffffff', mistA: 0.2, amb: '#ffffff', ambK: 0, flies: 0, pollen: 0.8,
  },
  {
    name: 'Goldene Stunde',
    sky0: '#4c79b5', sky1: '#f0b170', sky2: '#ffe3a3',
    sun: '#fff4c7', sunX: 0.3, sunY: 0.4, moon: 0, stars: 0,
    cloud: '#ffd08a', cloudLit: '#fff0c2',
    hill0: '#dba878', hill1: '#b97f4c', hill2: '#85582f',
    water0: '#ffd88f', water1: '#c47a40', glint: '#fffbe3',
    reed0: '#a39a45', reed1: '#857d35', cattail: '#5f3a1e',
    grass0: '#6b6f2b', grass1: '#535821', bank: '#454a1c', path: '#373c17', pathLit: '#5c6126',
    mist: '#ffe6b0', mistA: 0.35, amb: '#ffae45', ambK: 0.14, flies: 0.15, pollen: 1,
  },
  {
    name: 'Letztes Licht',
    sky0: '#1c1a52', sky1: '#7c3d86', sky2: '#f6806c',
    sun: '#ffb38c', sunX: 0.2, sunY: 0.56, moon: 0, stars: 0.5,
    cloud: '#a8527f', cloudLit: '#f08f86',
    hill0: '#6c4788', hill1: '#4c336e', hill2: '#2f2350',
    water0: '#e0787c', water1: '#3d2c6a', glint: '#ffd2c0',
    reed0: '#3b4266', reed1: '#2c3252', cattail: '#241a2e',
    grass0: '#232a4a', grass1: '#1a203c', bank: '#151a33', path: '#10142a', pathLit: '#1f2748',
    mist: '#ff9ea6', mistA: 0.28, amb: '#5a3a8a', ambK: 0.25, flies: 0.8, pollen: 0,
  },
  {
    name: 'Mondlicht',
    sky0: '#050a22', sky1: '#0e214d', sky2: '#2a487a',
    sun: '#ffb38c', sunX: 0.83, sunY: 0.78, moon: 1, stars: 1,
    cloud: '#1c3462', cloudLit: '#3a5a94',
    hill0: '#1b3158', hill1: '#132647', hill2: '#0c1a35',
    water0: '#3b6098', water1: '#0d1c3b', glint: '#dfeaff',
    reed0: '#1b3a55', reed1: '#142d44', cattail: '#0c1626',
    grass0: '#102437', grass1: '#0b1a2a', bank: '#091524', path: '#060f1c', pathLit: '#11263b',
    mist: '#a3c2ff', mistA: 0.2, amb: '#20336a', ambK: 0.33, flies: 1, pollen: 0,
  },
];

const skyAt = (i: number): SkySpec => SKIES[i] ?? (SKIES[0] as SkySpec);

export const SKY_COUNT = SKIES.length;

/** The colours between two times of day: at t = 0 the first, at 1 the second. */
export function skyBetween(from: number, to: number, t: number): Sky {
  const a = skyAt(from);
  const b = skyAt(to);
  const raw = {} as Record<ColourKey, Rgb>;
  const sky = { name: b.name, raw } as Sky;
  for (const key of COLOUR_KEYS) {
    raw[key] = mixRgb(rgb(a[key]), rgb(b[key]), t);
    sky[key] = css(raw[key]);
  }
  for (const key of NUMBER_KEYS) sky[key] = lerp(a[key], b[key], t);
  return sky;
}

/** Paint for the animals: their own colour, pulled a little toward the light of the hour. */
export type Ink = (hex: string) => string;

export function inkFor(sky: Sky): Ink {
  const known = new Map<string, string>();
  return (hex) => {
    let paint = known.get(hex);
    if (paint === undefined) {
      paint = css(mixRgb(rgb(hex), sky.raw.amb, sky.ambK));
      known.set(hex, paint);
    }
    return paint;
  };
}

/** A strip of land with a wavy top, down to the bottom of the picture. */
function land(rng: () => number, top: number, waves: readonly (readonly [number, number])[]): Path2D {
  const path = new Path2D();
  const phases = waves.map(() => rng() * TAU);
  path.moveTo(-80, H + 40);
  for (let x = -80; x <= W + 80; x += 12) {
    let y = top;
    waves.forEach(([height, rate], i) => {
      y -= height * Math.sin(x * rate + (phases[i] ?? 0));
    });
    path.lineTo(x, y);
  }
  path.lineTo(W + 80, H + 40);
  path.closePath();
  return path;
}

/** The far shore: a strip of land with pines and round trees on it. */
function farBank(rng: () => number): Path2D {
  const path = new Path2D();
  path.rect(-80, HORIZON - 8, W + 160, 12);
  for (let x = -70; x < W + 70; x += 14 + rng() * 26) {
    const tall = 14 + rng() * 34;
    if (rng() < 0.4) {
      path.moveTo(x - tall * 0.3, HORIZON - 6);
      path.lineTo(x, HORIZON - 8 - tall * 1.3);
      path.lineTo(x + tall * 0.3, HORIZON - 6);
      path.closePath();
    } else {
      const r = tall * 0.5;
      path.moveTo(x + r, HORIZON - 6 - r * 0.8);
      path.arc(x, HORIZON - 6 - r * 0.8, r, 0, TAU);
    }
  }
  return path;
}

interface Cloud {
  body: Path2D;
  lit: Path2D;
  x: number;
  y: number;
  size: number;
  speed: number;
}

function makeCloud(rng: () => number, index: number): Cloud {
  const body = new Path2D();
  const lit = new Path2D();
  const puffs = 4 + Math.floor(rng() * 3);
  const width = 34 * puffs;
  body.rect(-width / 2, -12, width, 26);
  for (let i = 0; i < puffs; i++) {
    const x = (i / (puffs - 1) - 0.5) * width;
    const r = 24 + rng() * 20 - Math.abs(i - (puffs - 1) / 2) * 5;
    body.moveTo(x + r, -6);
    body.arc(x, -6, r, 0, TAU);
    lit.moveTo(x - 4 + r * 0.7, -12);
    lit.arc(x - 4, -12, r * 0.7, 0, TAU);
  }
  return {
    body,
    lit,
    x: (index + rng()) * (W / 5),
    y: 70 + rng() * 190,
    size: 0.6 + rng() * 0.7,
    speed: 5 + rng() * 9,
  };
}

interface Dot {
  x: number;
  y: number;
  r: number;
  p: number;
}

function dots(rng: () => number, count: number, top: number, bottom: number): Dot[] {
  return Array.from({ length: count }, () => ({
    x: rng() * W,
    y: lerp(top, bottom, rng()),
    r: rng(),
    p: rng() * TAU,
  }));
}

export interface Blade {
  x: number;
  base: number;
  h: number;
  w: number;
  lean: number;
  tone: number;
}

function blades(
  rng: () => number,
  count: number,
  { base, low, high, width }: { base: number; low: number; high: number; width: number },
): Blade[] {
  return Array.from({ length: count }, (_, i) => ({
    x: ((i + rng()) * (W + 120)) / count - 60,
    base: base + rng() * 8,
    h: lerp(low, high, rng() ** 1.6),
    w: width * (0.7 + rng() * 0.6),
    lean: (rng() - 0.5) * 44,
    tone: rng() < 0.5 ? 0 : 1,
  }));
}

export interface Scene {
  ridges: [Path2D, Path2D];
  farBank: Path2D;
  bank: Path2D;
  path: Path2D;
  clouds: Cloud[];
  stars: Dot[];
  glints: Dot[];
  motes: Dot[];
  pads: Dot[];
  reeds: Blade[];
  cattails: Blade[];
  grass: Blade[];
  tufts: Blade[];
}

/** Everything that keeps its shape: made once, the same on every visit. */
export function createScene(): Scene {
  const rng = seeded(11);
  return {
    ridges: [
      land(rng, 336, [
        [22, 0.0042],
        [11, 0.011],
        [5, 0.027],
      ]),
      land(rng, 380, [
        [14, 0.0052],
        [8, 0.013],
        [4, 0.031],
      ]),
    ],
    farBank: farBank(rng),
    bank: land(rng, 634, [
      [5, 0.011],
      [3, 0.029],
    ]),
    path: land(rng, 678, [
      [2.5, 0.013],
      [1.5, 0.037],
    ]),
    clouds: Array.from({ length: 6 }, (_, i) => makeCloud(rng, i)),
    stars: dots(rng, 110, 0, 380),
    glints: dots(rng, 34, HORIZON + 12, 600),
    motes: dots(rng, 30, 400, 690),
    pads: dots(rng, 9, 478, 560),
    reeds: blades(rng, 104, { base: 624, low: 70, high: 178, width: 10 }),
    cattails: blades(rng, 15, { base: 626, low: 132, high: 198, width: 3 }),
    grass: blades(rng, 150, { base: 684, low: 44, high: 108, width: 9 }),
    tufts: blades(rng, 48, { base: H + 6, low: 18, high: 46, width: 8 }),
  };
}

function slide(ctx: Ctx, path: Path2D, colour: string, shift: number): void {
  ctx.save();
  ctx.translate(shift, 0);
  ctx.fillStyle = colour;
  ctx.fill(path);
  ctx.restore();
}

function paintSky(ctx: Ctx, scene: Scene, sky: Sky, t: number): void {
  const air = ctx.createLinearGradient(0, 0, 0, HORIZON + 20);
  air.addColorStop(0, sky.sky0);
  air.addColorStop(0.6, sky.sky1);
  air.addColorStop(1, sky.sky2);
  ctx.fillStyle = air;
  ctx.fillRect(-40, -40, W + 80, H + 80);
  ctx.fillStyle = '#ffffff';
  for (const star of scene.stars) {
    ctx.globalAlpha = sky.stars * (0.35 + 0.65 * Math.sin(t * 1.4 + star.p) ** 2);
    ellipse(ctx, star.x, star.y, 0.6 + star.r, 0.6 + star.r);
  }
  ctx.fillStyle = sky.sun;
  for (const [radius, alpha] of [
    [124, 0.08],
    [80, 0.14],
    [46, 1],
  ] as const) {
    ctx.globalAlpha = alpha * (1 - sky.moon);
    ellipse(ctx, sky.sunX * W, sky.sunY * H, radius, radius);
  }
  paintMoon(ctx, sky.moon);
  ctx.globalAlpha = 1;
}

function paintMoon(ctx: Ctx, alpha: number): void {
  const [x, y] = MOON;
  ctx.fillStyle = '#f3f6ff';
  for (const [radius, glow] of [
    [98, 0.06],
    [62, 0.1],
    [38, 1],
  ] as const) {
    ctx.globalAlpha = glow * alpha;
    ellipse(ctx, x, y, radius, radius);
  }
  ctx.fillStyle = '#cfd8ee';
  ellipse(ctx, x - 12, y - 8, 8, 8);
  ellipse(ctx, x + 10, y + 12, 5.5, 5.5);
  ellipse(ctx, x + 13, y - 13, 3.5, 3.5);
}

function paintCloud(ctx: Ctx, sky: Sky, cloud: Cloud, t: number, shift: number): void {
  const reach = W + 400;
  const x = ((cloud.x + t * cloud.speed) % reach) - 200 + shift;
  ctx.save();
  ctx.translate(x, cloud.y);
  ctx.scale(cloud.size, cloud.size);
  ctx.beginPath();
  ctx.rect(-400, -140, 800, 152);
  ctx.clip();
  ctx.fillStyle = sky.cloud;
  ctx.fill(cloud.body);
  ctx.fillStyle = sky.cloudLit;
  ctx.fill(cloud.lit);
  ctx.restore();
}

/** The far shore upside down in the lake. */
function reflection(ctx: Ctx, scene: Scene, sky: Sky, shift: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(-40, HORIZON, W + 80, 80);
  ctx.clip();
  ctx.translate(shift, HORIZON * 2);
  ctx.scale(1, -1);
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = sky.hill2;
  ctx.fill(scene.farBank);
  ctx.restore();
}

/** The lake: the far shore upside down in it, and light that flickers under the sun or moon. */
function paintWater(ctx: Ctx, scene: Scene, sky: Sky, t: number, shift: number): void {
  const water = ctx.createLinearGradient(0, HORIZON, 0, 640);
  water.addColorStop(0, sky.water0);
  water.addColorStop(1, sky.water1);
  ctx.fillStyle = water;
  ctx.fillRect(-40, HORIZON, W + 80, H - HORIZON + 40);
  reflection(ctx, scene, sky, shift);
  ctx.fillStyle = sky.glint;
  const column = lerp(sky.sunX * W, MOON[0], sky.moon);
  for (let i = 0; i < 12; i++) {
    const half = (10 + i * 5) * (0.6 + 0.4 * Math.sin(t * 2.2 + i * 1.9));
    ctx.globalAlpha = 0.5 * (0.5 + 0.5 * Math.sin(t * 3.1 + i * 2.4));
    ctx.fillRect(column - half + Math.sin(t + i) * 6, HORIZON + 10 + i * 13, half * 2, 2.5);
  }
  for (const glint of scene.glints) {
    ctx.globalAlpha = 0.35 * Math.max(0, Math.sin(t * 1.7 + glint.p));
    ctx.fillRect(glint.x, glint.y, 10 + glint.r * 14, 2);
  }
  ctx.globalAlpha = 1;
}

function paintMist(ctx: Ctx, sky: Sky): void {
  const mist = ctx.createLinearGradient(0, HORIZON - 80, 0, HORIZON + 70);
  mist.addColorStop(0, css(sky.raw.mist, 0));
  mist.addColorStop(0.55, css(sky.raw.mist, sky.mistA));
  mist.addColorStop(1, css(sky.raw.mist, 0));
  ctx.fillStyle = mist;
  ctx.fillRect(-40, HORIZON - 80, W + 80, 150);
}

/** Everything behind the reeds: sky, clouds, hills, lake, far shore, mist, lily pads. */
export function drawBackdrop(ctx: Ctx, scene: Scene, sky: Sky, t: number, drift: number): void {
  paintSky(ctx, scene, sky, t);
  ctx.globalAlpha = 0.92;
  for (const item of scene.clouds) paintCloud(ctx, sky, item, t, drift * 14);
  ctx.globalAlpha = 1;
  slide(ctx, scene.ridges[0], sky.hill0, drift * 12);
  slide(ctx, scene.ridges[1], sky.hill1, drift * 9);
  paintWater(ctx, scene, sky, t, drift * 7);
  slide(ctx, scene.farBank, sky.hill2, drift * 7);
  paintMist(ctx, sky);
  ctx.fillStyle = sky.reed1;
  for (const pad of scene.pads) {
    ellipse(ctx, pad.x + drift * 4, pad.y, 13 + pad.r * 12, 3.5 + pad.r * 3);
  }
}

/** Something that went through the reeds a moment ago: where, how hard, how far, how long ago. */
export interface Rustle {
  x: number;
  power: number;
  reach: number;
  age: number;
  life: number;
}

/**
 * How far the tip of a blade at x leans: the breeze, plus whatever just went through the reeds.
 * `wind` (units a second, from the modern rules) bends every blade the same way.
 */
function swayAt(rustles: readonly Rustle[], x: number, t: number, wind: number): number {
  const breeze = Math.sin(t * 1.15 + x * 0.007) * 5 + Math.sin(t * 2.6 + x * 0.019) * 2.2;
  let lean = breeze * (1 + Math.abs(wind) / 60) + wind * 0.16;
  for (const rustle of rustles) {
    const near = 1 - Math.abs(x - rustle.x) / rustle.reach;
    if (near <= 0) continue;
    const fade = Math.exp(-rustle.age * 3.4);
    lean += rustle.power * near * fade * Math.sin(rustle.age * 24 + x * 0.3);
  }
  return lean;
}

function bladePath(ctx: Ctx, blade: Blade, sway: number, shift: number): void {
  const { base, h, w } = blade;
  const x = blade.x + shift;
  const tipX = x + blade.lean + (sway * h) / 60;
  const midX = x + blade.lean * 0.25 + (sway * h) / 240;
  ctx.moveTo(x - w / 2, base);
  ctx.quadraticCurveTo(midX - w * 0.3, base - h * 0.5, tipX, base - h);
  ctx.quadraticCurveTo(midX + w * 0.3, base - h * 0.5, x + w / 2, base);
}

function fillBlades(
  ctx: Ctx,
  list: readonly Blade[],
  colours: readonly string[],
  rustles: readonly Rustle[],
  t: number,
  shift: number,
  wind: number,
): void {
  colours.forEach((colour, tone) => {
    ctx.fillStyle = colour;
    ctx.beginPath();
    for (const blade of list) {
      if (blade.tone !== tone) continue;
      bladePath(ctx, blade, swayAt(rustles, blade.x, t, wind), shift);
    }
    ctx.fill();
  });
}

function drawCattails(
  ctx: Ctx,
  list: readonly Blade[],
  sky: Sky,
  rustles: readonly Rustle[],
  t: number,
  wind: number,
): void {
  ctx.strokeStyle = sky.reed1;
  ctx.lineWidth = 3;
  ctx.fillStyle = sky.cattail;
  for (const stalk of list) {
    const sway = swayAt(rustles, stalk.x, t, wind);
    const bend: Point = [stalk.x, stalk.base - stalk.h * 0.55];
    const tip: Point = [stalk.x + stalk.lean * 0.5 + (sway * stalk.h) / 70, stalk.base - stalk.h];
    const at = curve([stalk.x, stalk.base], bend, tip);
    ctx.beginPath();
    ctx.moveTo(stalk.x, stalk.base);
    ctx.quadraticCurveTo(bend[0], bend[1], tip[0], tip[1]);
    ctx.stroke();
    const [hx, hy] = at(0.82);
    const [ax, ay] = at(0.7);
    ellipse(ctx, hx, hy, 5.5, 17, Math.atan2(hy - ay, hx - ax) - Math.PI / 2);
  }
}

/** The tall reeds and cattails the ducks rise in front of. */
export function drawReeds(
  ctx: Ctx,
  scene: Scene,
  sky: Sky,
  rustles: readonly Rustle[],
  t: number,
  wind = 0,
): void {
  fillBlades(ctx, scene.reeds, [sky.reed0, sky.reed1], rustles, t, 0, wind);
  drawCattails(ctx, scene.cattails, sky, rustles, t, wind);
}

/** The bank and the grass in front of the ducks, and the path the ferret runs on. */
export function drawBank(
  ctx: Ctx,
  scene: Scene,
  sky: Sky,
  rustles: readonly Rustle[],
  t: number,
  drift: number,
  wind = 0,
): void {
  slide(ctx, scene.bank, sky.bank, -drift * 8);
  fillBlades(ctx, scene.grass, [sky.grass0, sky.grass1], rustles, t, -drift * 8, wind);
  slide(ctx, scene.path, sky.path, -drift * 12);
  ctx.fillStyle = sky.pathLit;
  ellipse(ctx, W / 2 - drift * 12, 706, W * 0.6, 12);
}

/** The nearest grass, in front of the ferret's feet. */
export function drawTufts(
  ctx: Ctx,
  scene: Scene,
  sky: Sky,
  rustles: readonly Rustle[],
  t: number,
  drift: number,
  wind = 0,
): void {
  fillBlades(ctx, scene.tufts, [sky.path, sky.bank], rustles, t, -drift * 18, wind);
}

/** Fireflies after sunset, drifting seeds by day. */
export function drawMotes(ctx: Ctx, scene: Scene, sky: Sky, t: number): void {
  for (const mote of scene.motes) {
    const x = mote.x + Math.sin(t * 0.31 + mote.p) * 46;
    const y = mote.y + Math.cos(t * 0.23 + mote.p * 2) * 26;
    const glow = sky.flies * Math.max(0, Math.sin(t * 1.9 + mote.p * 3)) ** 2;
    ctx.fillStyle = '#f2ff9a';
    ctx.globalAlpha = glow * 0.07;
    ellipse(ctx, x, y, 14, 14);
    ctx.globalAlpha = glow * 0.14;
    ellipse(ctx, x, y, 7, 7);
    ctx.globalAlpha = glow;
    ellipse(ctx, x, y, 2.2, 2.2);
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = sky.pollen * 0.3;
    ellipse(ctx, (x + t * 14 + mote.p * 200) % W, y - 240 + mote.r * 120, 1.7, 1.7);
  }
  ctx.globalAlpha = 1;
}

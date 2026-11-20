/**
 * What Ferret Flush's rules do not know about (the reference's src/fx.js): feathers, leaves,
 * shards, score numbers, shaking reeds, the kick of the sight and the banners. `react` turns one
 * event of the rules into effects, and `updateFx` moves them on. The modern rules have a few
 * events of their own at the end. The words of the banners are the machine's own, in German.
 */
import { TAU, ease, ellipse, lerp } from './kit.js';
import { LAUNCH_TIME, REED_LINE, W, type FlushEvent, type Game } from './rules.js';
import { featherColours } from './birds.js';
import { GOLDEN } from './modern.js';
import type { ColourKey, Ink, Rustle, Sky } from './scene.js';

type Ctx = CanvasRenderingContext2D;
type Shape = 'feather' | 'leaf' | 'shard';

const GOLD = ['#ffd75e', '#fff1b0', '#e8a92a'];
const WOOD = ['#9a6a3e', '#c89462', '#5e3d22'];

export interface Particle {
  shape: Shape;
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  drag: number;
  sway: number;
  size: number;
  life: number;
  age: number;
  rot: number;
  vr: number;
  p: number;
  colour?: string;
  tone?: ColourKey;
}
export interface Notice {
  title: string;
  note: string;
  age: number;
  life: number;
}
export interface Toast {
  text: string;
  age: number;
  life: number;
}
export interface Popup {
  x: number;
  y: number;
  text: string;
  age: number;
  life: number;
}
export interface Ring {
  x: number;
  y: number;
  to: number;
  life: number;
  solid: boolean;
  age: number;
}
export interface Drop {
  slot: number;
  age: number;
  life: number;
}
interface Later {
  in: number;
  run: () => void;
}
interface Dash {
  from: number;
  to: number;
  age: number;
  stepIn: number;
}

export interface Fx {
  clock: number;
  calm: boolean;
  shake: number;
  kick: number;
  shown: number;
  shedIn: number;
  particles: Particle[];
  popups: Popup[];
  rings: Ring[];
  rustles: Rustle[];
  drops: Drop[];
  later: Later[];
  pips: number[];
  banner: Notice | null;
  toast: Toast | null;
  scurry: Dash | null;
  wind: number;
  windNote: string;
  cheer: number;
}

export function createFx(): Fx {
  return {
    clock: 0,
    calm: false,
    shake: 0,
    kick: 0,
    shown: 0,
    shedIn: 0,
    particles: [],
    popups: [],
    rings: [],
    rustles: [],
    drops: [],
    later: [],
    pips: Array<number>(10).fill(0),
    banner: null,
    toast: null,
    scurry: null,
    wind: 0,
    windNote: '',
    cheer: 0,
  };
}

const random = (low: number, high: number): number => lerp(low, high, Math.random());

type Made = Omit<Particle, 'age' | 'rot' | 'vr' | 'sway' | 'p'> & Partial<Pick<Particle, 'sway'>>;

function scatter(fx: Fx, count: number, make: (i: number) => Made): void {
  for (let i = 0; i < count; i++) {
    fx.particles.push({
      age: 0,
      rot: random(0, TAU),
      vr: random(-8, 8),
      sway: 0,
      p: random(0, TAU),
      ...make(i),
    });
  }
}

const pickOf = (colours: readonly string[], i: number): string =>
  colours[i % colours.length] ?? '#ffffff';

function feathers(
  fx: Fx,
  x: number,
  y: number,
  colours: readonly string[],
  count: number,
  speed: number,
): void {
  scatter(fx, count, (i) => {
    const angle = random(0, TAU);
    const v = speed * random(0.3, 1);
    return {
      shape: 'feather',
      x,
      y,
      vx: Math.cos(angle) * v,
      vy: Math.sin(angle) * v - 60,
      g: 190,
      drag: 2.4,
      sway: random(40, 90),
      size: random(7, 14),
      colour: pickOf(colours, i),
      life: random(1.4, 2.6),
    };
  });
}

function leaves(fx: Fx, x: number, y: number, count: number): void {
  scatter(fx, count, (i) => ({
    shape: 'leaf',
    x: x + random(-30, 30),
    y,
    vx: random(-170, 170),
    vy: random(-420, -180),
    g: 760,
    drag: 1.4,
    size: random(6, 11),
    tone: i % 2 ? 'reed0' : 'grass0',
    life: random(0.7, 1.2),
  }));
}

function shards(
  fx: Fx,
  x: number,
  y: number,
  scale: number,
  colours: readonly string[] = ['#ea7237', '#ea7237', '#a3401d'],
): void {
  scatter(fx, 9, (i) => {
    const angle = (i / 9) * TAU + random(-0.3, 0.3);
    const v = random(120, 330) * scale;
    return {
      shape: 'shard',
      x,
      y,
      vx: Math.cos(angle) * v,
      vy: Math.sin(angle) * v - 80 * scale,
      g: 900,
      drag: 0.5,
      size: random(6, 12) * scale,
      colour: pickOf(colours, i % 3),
      life: random(0.5, 0.9),
    };
  });
}

function rustle(fx: Fx, x: number, power: number, reach: number): void {
  fx.rustles.push({ x, power, reach, age: 0, life: 1.3 });
}

function ring(fx: Fx, x: number, y: number, to: number, life: number, solid = false): void {
  fx.rings.push({ x, y, to, life, solid, age: 0 });
}

function reedsPart(fx: Fx, x: number, power: number, leafCount: number): void {
  rustle(fx, x, power, 90 + power * 2);
  leaves(fx, x, REED_LINE - 26, leafCount);
}

/** An event's number fields, as the reactions read them: 0 where the event leaves one out. */
const n = (value: number | undefined): number => value ?? 0;

type Reaction = (fx: Fx, event: FlushEvent) => void;

const MODERN_REACTIONS: Readonly<Record<string, Reaction>> = {
  wind(fx, event) {
    fx.windNote = ` · Wind aus ${n(event.wind) > 0 ? 'Westen' : 'Osten'}`;
  },
  streak(fx, event) {
    fx.toast = { text: `Serie ×${n(event.factor)}`, age: 0, life: 1.2 };
  },
  golden(fx, event) {
    fx.toast = { text: 'Goldener Vogel', age: 0, life: 1.4 };
    ring(fx, n(event.x), n(event.y), 110, 0.5);
  },
  'sure-shot'(fx, event) {
    if (fx.banner) fx.banner.note = `Keine Patrone vergeudet: Bonus ${n(event.bonus)}`;
  },
  bonus(fx, event) {
    const note = `${n(event.count)} Lockenten, Patronen ohne Ende`;
    fx.banner = { title: 'Lockenten-Reihe', note, age: 0, life: 2.2 };
  },
  'bonus-shot'(fx, event) {
    fx.shake = 0.1;
    fx.kick = 1;
    ring(fx, n(event.x), n(event.y), 30, 0.1, true);
  },
  'bonus-miss'(fx, event) {
    ring(fx, n(event.x), n(event.y), 34, 0.4);
  },
  decoy(fx, event) {
    const [x, y] = [n(event.x), n(event.y)];
    shards(fx, x, y, 1, WOOD);
    ring(fx, x, y, 60, 0.3);
    fx.popups.push({ x, y: y - 40, text: `+${n(event.value)}`, age: 0, life: 0.9 });
    fx.cheer = 0.8;
  },
  'bonus-end'(fx, event) {
    const all = n(event.bonus) > 0;
    const note = all ? `Alle getroffen: Bonus ${n(event.bonus)}` : 'Weiter zur nächsten Runde';
    const title = `${n(event.hits)} von ${n(event.count)} getroffen`;
    fx.banner = { title, note, age: 0, life: 1.8 };
    if (all) feathers(fx, W / 2, 150, GOLD, 40, 520);
  },
};

/** A hit: a ring, the points rising, feathers or shards — gold ones for a golden bird. */
function hit(fx: Fx, event: FlushEvent): void {
  const [x, y] = [n(event.x), n(event.y)];
  fx.shake = 0.24;
  ring(fx, x, y, 70, 0.3);
  const times = n(event.streak) > 1 ? `  ×${n(event.streak)}` : '';
  fx.popups.push({ x, y: y - 40, text: `+${n(event.value)}${times}`, age: 0, life: 1.1 });
  const golden = event.look === GOLDEN;
  if (event.target === 'clay') shards(fx, x, y, event.scale ?? 1, golden ? GOLD : undefined);
  else feathers(fx, x, y, featherColours(n(event.look)), 18, 260);
  if (golden) feathers(fx, x, y, GOLD, 16, 420);
}

const REACTIONS: Readonly<Record<string, Reaction>> = {
  start(fx) {
    const fresh = { shown: 0, banner: null, toast: null, scurry: null, later: [], drops: [] };
    Object.assign(fx, fresh);
  },
  round(fx, event) {
    const note = `${n(event.quota)} von 10 zum Bestehen${fx.windNote}`;
    fx.windNote = '';
    fx.banner = { title: `Runde ${n(event.round)}`, note, age: 0, life: 2.2 };
    fx.pips.fill(0);
  },
  flush(fx, event) {
    reedsPart(fx, n(event.x), 26, 12);
  },
  scurry(fx, event) {
    fx.scurry = { from: n(event.from), to: n(event.to), age: 0, stepIn: 0 };
  },
  pull(fx) {
    fx.toast = { text: 'Hopp!', age: 0, life: 0.7 };
  },
  launch(fx, event) {
    if (event.target === 'clay') ring(fx, n(event.x), n(event.y) - 20, 34, 0.3);
    else reedsPart(fx, n(event.x), 16, 6);
  },
  shot(fx, event) {
    fx.shake = 0.14;
    fx.kick = 1;
    fx.drops.push({ slot: n(event.shells), age: 0, life: 0.6 });
    ring(fx, n(event.x), n(event.y), 30, 0.1, true);
  },
  miss(fx, event) {
    ring(fx, n(event.x), n(event.y), 34, 0.4);
  },
  hit,
  landed(fx, event) {
    reedsPart(fx, n(event.x), 22, 10);
  },
  lost(fx, event) {
    ring(fx, n(event.x), n(event.y), 14, 0.4);
  },
  away(fx) {
    fx.toast = { text: 'Entkommen', age: 0, life: 1.3 };
  },
  popup(fx, event) {
    const x = n(event.x);
    reedsPart(fx, x, 18, 7);
    if (event.mood !== 'flop') return;
    fx.later.push({ in: 1.85, run: () => reedsPart(fx, x, 24, 10) });
  },
  tick(fx, event) {
    if (event.hit) fx.pips[n(event.index)] = 1;
  },
  cleared(fx, event) {
    const title = event.perfect ? 'Perfekte Runde' : 'Runde geschafft';
    const note = event.perfect ? `Bonus ${n(event.bonus)}` : 'Weiter zur nächsten';
    fx.banner = { title, note, age: 0, life: 2.4 };
    if (event.perfect) feathers(fx, W / 2, 150, ['#ffc24a', '#fff3d9', '#ff7d6a'], 40, 520);
  },
  failed(fx, event) {
    const note = `${n(event.hits)} getroffen, ${n(event.quota)} nötig`;
    fx.banner = { title: 'Runde verloren', note, age: 0, life: 2.6 };
  },
  ...MODERN_REACTIONS,
};

/** Turns one event of the rules into effects. */
export function react(fx: Fx, event: FlushEvent): void {
  if (Object.hasOwn(REACTIONS, event.type)) REACTIONS[event.type]?.(fx, event);
}

function aged<T extends { age: number; life: number }>(list: T[], dt: number): T[] {
  for (const item of list) item.age += dt;
  return list.filter((item) => item.age < item.life);
}

function moveParticles(fx: Fx, dt: number): void {
  for (const p of fx.particles) {
    p.vx -= p.vx * p.drag * dt;
    p.vy += (p.g - p.vy * p.drag) * dt;
    p.x += (p.vx + Math.sin(p.age * 5 + p.p) * p.sway + fx.wind * 0.8) * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
  }
}

/** The hidden ferret on its way to the next spot: the reeds shake along its path. */
function scurry(fx: Fx, dt: number): void {
  const dash = fx.scurry;
  if (!dash) return;
  dash.age += dt;
  dash.stepIn -= dt;
  if (dash.age >= LAUNCH_TIME) fx.scurry = null;
  else if (dash.stepIn <= 0) {
    dash.stepIn = 0.06;
    rustle(fx, lerp(dash.from, dash.to, ease.inOut(dash.age / LAUNCH_TIME)), 9, 70);
  }
}

/** A duck that tumbles down loses feathers on the way. */
function shed(fx: Fx, dt: number, game: Game): void {
  fx.shedIn -= dt;
  if (fx.shedIn > 0) return;
  fx.shedIn = 0.07;
  for (const bird of game.birds) {
    const golden = bird.look === GOLDEN;
    if (golden && bird.state !== 'falling') feathers(fx, bird.x, bird.y, GOLD, 1, 40);
    if (bird.state !== 'falling' || n(bird.stun) > 0) continue;
    feathers(fx, bird.x, bird.y, featherColours(bird.look ?? bird.kind), 1, 60);
  }
}

function runLater(fx: Fx, dt: number): void {
  for (const job of fx.later) job.in -= dt;
  const due = fx.later.filter((job) => job.in <= 0);
  fx.later = fx.later.filter((job) => job.in > 0);
  for (const job of due) job.run();
}

function fadeNotice<T extends { age: number; life: number }>(notice: T | null, dt: number): T | null {
  if (!notice) return null;
  notice.age += dt;
  return notice.age < notice.life ? notice : null;
}

/** The score shown counts up to the score earned. */
function countUp(fx: Fx, dt: number, score: number): void {
  fx.shown += (score - fx.shown) * Math.min(1, dt * 9);
  if (Math.abs(score - fx.shown) < 1) fx.shown = score;
}

export function updateFx(fx: Fx, dt: number, game: Game): void {
  fx.clock += dt;
  fx.wind = game.modern?.wind ?? 0;
  fx.cheer = Math.max(0, fx.cheer - dt);
  fx.shake = Math.max(0, fx.shake - dt);
  fx.kick = Math.max(0, fx.kick - dt * 7);
  countUp(fx, dt, game.score);
  for (let i = 0; i < fx.pips.length; i++) fx.pips[i] = Math.max(0, n(fx.pips[i]) - dt * 3);
  fx.particles = aged(fx.particles, dt);
  fx.popups = aged(fx.popups, dt);
  fx.rings = aged(fx.rings, dt);
  fx.rustles = aged(fx.rustles, dt);
  fx.drops = aged(fx.drops, dt);
  fx.banner = fadeNotice(fx.banner, dt);
  fx.toast = fadeNotice(fx.toast, dt);
  moveParticles(fx, dt);
  runLater(fx, dt);
  scurry(fx, dt);
  shed(fx, dt, game);
}

const SHAPES: Readonly<Record<Shape, (ctx: Ctx, size: number) => void>> = {
  feather(ctx, size) {
    ctx.beginPath();
    ctx.moveTo(-size, 0);
    ctx.quadraticCurveTo(0, -size * 0.55, size, 0);
    ctx.quadraticCurveTo(0, size * 0.55, -size, 0);
    ctx.fill();
  },
  leaf(ctx, size) {
    ctx.beginPath();
    ctx.moveTo(-size, 0);
    ctx.quadraticCurveTo(0, -size * 0.35, size, 0);
    ctx.quadraticCurveTo(0, size * 0.35, -size, 0);
    ctx.fill();
  },
  shard(ctx, size) {
    ctx.beginPath();
    ctx.moveTo(-size, -size * 0.4);
    ctx.lineTo(size, 0);
    ctx.lineTo(-size * 0.5, size * 0.6);
    ctx.fill();
  },
};

/** Feathers, leaves and shards: between the reeds and the grass in front. */
export function drawParticles(ctx: Ctx, fx: Fx, sky: Sky, ink: Ink): void {
  for (const p of fx.particles) {
    ctx.globalAlpha = Math.min(1, (p.life - p.age) / 0.35);
    ctx.fillStyle = p.tone ? sky[p.tone] : ink(p.colour ?? '#ffffff');
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    SHAPES[p.shape](ctx, p.size);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

/** The flash of a shot and the rings where it went. */
export function drawRings(ctx: Ctx, fx: Fx): void {
  ctx.fillStyle = '#fff6d8';
  ctx.strokeStyle = '#fff6d8';
  for (const mark of fx.rings) {
    const p = mark.age / mark.life;
    ctx.globalAlpha = 1 - p;
    const size = mark.to * (0.5 + p * 0.5);
    if (mark.solid) ellipse(ctx, mark.x, mark.y, size, size);
    else {
      ctx.lineWidth = 1 + 4 * (1 - p);
      ctx.beginPath();
      ctx.arc(mark.x, mark.y, mark.to * ease.out(p), 0, TAU);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * The machine's effects (the reference's src/fx.js): feathers, sparks, falling ducks, floating
 * text and a gentle shake. Nothing here feeds back into the simulation, so effects may use their
 * own chance. Under reduced motion (the lab's `data-motion`) nothing shakes, nothing stops the
 * game for a hit, and half as many bits fly.
 */
import { drawDuck, duckColor, pickupColor, rect, snap } from './sprites.js';
import { PICKUP_LABELS } from './texts.js';
import type { GameEvent } from './rules.js';

type Ctx = CanvasRenderingContext2D;
type Kind = 'feather' | 'spark' | 'ghost' | 'text';

interface Bit {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  phase: number;
  row: number;
  label: string;
  size: number;
}

const FUR = ['#fff2cb', '#b98668', '#543a45'];
const GOLD = ['#ffe17c', '#64efd3'];
/** Hit-stop seconds and shake strength per cue. */
const PUNCH: Readonly<Record<string, readonly [number, number]>> = {
  death: [0.12, 9],
  bonus: [0.05, 4],
  clang: [0.03, 2],
  'boss-hit': [0.02, 2],
  'boss-down': [0.18, 12],
  'shield-break': [0.06, 5],
};
const num = (v: number | string): number => (typeof v === 'number' ? v : 0);
const SPAWN: Readonly<Record<string, (fx: Fx, e: GameEvent) => void>> = {
  explosion(fx, { x, y, value }) {
    fx.burst(x, y, [duckColor(num(value)), '#fff2cb'], 9, 120, 'feather');
    fx.add('ghost', x, y, { row: num(value), vy: -40, life: 0.55, max: 0.55 });
  },
  death: (fx, { x, y }) => fx.burst(x, y, FUR, 26, 170, 'feather'),
  bonus: (fx, { x, y }) => fx.burst(x, y, GOLD, 24, 220),
  'boss-down'(fx, { x, y }) {
    fx.burst(x, y, GOLD, 24, 220);
    fx.burst(x, y, [duckColor(1), '#fff2cb'], 30, 200, 'feather');
  },
  clang: (fx, { x, y }) => fx.burst(x, y - 14, ['#eef6f7', '#b7cbd0', '#55666e'], 10, 140),
  'boss-hit': (fx, { x, y }) => fx.burst(x, y, ['#ffffff', '#76bca3'], 6, 110),
  'shield-break': (fx, { x, y }) => fx.burst(x, y, ['#64efd3', '#d4e5e6'], 20, 190),
  impact: (fx, { x, y }) => fx.burst(x, y, ['#70cda5', '#365a4e'], 4, 60),
  pickup(fx, { x, y, value }) {
    const kind = String(value);
    fx.burst(x, y, [pickupColor(kind), '#ffffff'], 14, 150);
    fx.text(x, y - 30, PICKUP_LABELS[kind] ?? '', pickupColor(kind), 20);
  },
  combo: (fx, { x, y, value }) => fx.text(x, y - 28, `KOMBO ×${value}`, '#ffad45', 22),
  points: (fx, { x, y, value }) => fx.text(x, y - 10, `+${value}`, '#fff2cb', 16),
};

export class Fx {
  items: Bit[] = [];
  shakePower = 0;
  time = 0;

  constructor(
    public reduced = false,
    private readonly random: () => number = Math.random,
  ) {}

  clear(): void {
    this.items = [];
    this.shakePower = 0;
  }
  private spread(n: number): number {
    return this.reduced ? Math.ceil(n / 2) : n;
  }
  add(kind: Kind, x: number, y: number, extra: Partial<Bit> = {}): void {
    this.items.push({
      kind,
      x,
      y,
      vx: 0,
      vy: 0,
      life: 1,
      max: 1,
      color: '#ffffff',
      phase: 0,
      row: 0,
      label: '',
      size: 16,
      ...extra,
    });
  }
  burst(x: number, y: number, colors: readonly string[], count: number, speed: number, kind: Kind = 'spark'): void {
    for (let i = 0; i < this.spread(count); i++) {
      const a = this.random() * Math.PI * 2;
      const v = speed * (0.4 + this.random() * 0.6);
      const life = kind === 'feather' ? 1 + this.random() * 0.6 : 0.35 + this.random() * 0.3;
      this.add(kind, x, y, {
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - (kind === 'feather' ? 40 : 0),
        life,
        max: life,
        color: colors[i % colors.length] ?? '#ffffff',
        phase: this.random() * 6,
      });
    }
  }
  text(x: number, y: number, label: string, color: string, size: number): void {
    this.add('text', x, y, { vy: -28, life: 0.9, max: 0.9, label, color, size });
  }
  /** Starts the effects of one simulation event; returns the hit-stop it asks for, s. */
  spawn(e: GameEvent): number {
    SPAWN[e.type]?.(this, e);
    const [stop, shake] = PUNCH[e.type] ?? [0, 0];
    if (!this.reduced) this.shakePower = Math.max(this.shakePower, shake);
    return this.reduced ? 0 : stop;
  }
  update(dt: number): void {
    this.time += dt;
    this.shakePower = this.shakePower < 0.2 ? 0 : this.shakePower * Math.exp(-dt * 9);
    for (const p of this.items) move(p, dt, this.time);
    this.items = this.items.filter((p) => p.life > 0);
  }
  /** A smooth wobble that dies down within a fraction of a second. */
  get shake(): [number, number] {
    const s = this.shakePower;
    return [Math.sin(this.time * 61) * s * 0.6, Math.cos(this.time * 47) * s * 0.4];
  }
  draw(ctx: Ctx, t: number): void {
    for (const p of this.items) {
      ctx.globalAlpha = Math.max(0, Math.min(1, (p.life / p.max) * 2.5));
      if (p.kind === 'ghost') drawDuck(ctx, p.x, p.y, p.row, t, 2, { squash: 1 });
      else if (p.kind === 'text') drawText(ctx, p);
      else drawBit(ctx, p, this.time);
    }
    ctx.globalAlpha = 1;
  }
}
function move(p: Bit, dt: number, time: number): void {
  p.life -= dt;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  if (p.kind === 'feather') {
    p.vx *= Math.exp(-dt * 2.5);
    p.vy = Math.min(55, p.vy + 150 * dt);
    p.x += Math.sin(time * 5 + p.phase) * 22 * dt;
  } else if (p.kind === 'spark') p.vy += 260 * dt;
  else if (p.kind === 'ghost') p.vy += 700 * dt;
}
function drawBit(ctx: Ctx, p: Bit, time: number): void {
  snap(ctx);
  ctx.fillStyle = p.color;
  if (p.kind === 'spark') rect(ctx, p.x - 1.5, p.y - 1.5, 3, 3);
  else if (Math.sin(time * 5 + p.phase) > 0) rect(ctx, p.x - 1, p.y - 3, 3, 7);
  else rect(ctx, p.x - 3, p.y - 1, 7, 3);
}
function drawText(ctx: Ctx, p: Bit): void {
  ctx.font = `bold ${p.size}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#080d11';
  ctx.fillText(p.label, p.x + 2, p.y + 2);
  ctx.fillStyle = p.color;
  ctx.fillText(p.label, p.x, p.y);
}

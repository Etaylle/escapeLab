/**
 * The machine's field on its canvas (the reference's src/render.js), in the 800 × 680 units of
 * the field whatever the canvas's size: the night sky, the shelters, the flock, the boss and the
 * pickups, the ferret, the shots and the effects, each moving thing placed between the last two
 * steps (`View.previous`, `View.alpha`). Without a view's modern layers it draws what the
 * original drew.
 */
import { DEFENSE, HEIGHT, WIDTH, current, duckX, duckY, type Actions, type Duck, type Game, type Player } from './rules.js';
import { drawBoss, drawDuck, drawFerret, drawPickup, drawSaucer, drawShield, rect, snap, type DuckLook } from './sprites.js';
import type { Fx } from './fx.js';
import type { Snapshot } from './clock.js';

type Ctx = CanvasRenderingContext2D;

/** What drawing knows beyond the simulation: interpolation, effects, the modern layers. */
export interface View {
  modern: boolean;
  alpha: number;
  previous: Snapshot | null;
  fx: Fx | null;
  facing: number;
  marchAt: number;
  firedAt: Map<number, number>;
  bossHurt: number;
}
export const PLAIN: Readonly<View> = {
  modern: false,
  alpha: 1,
  previous: null,
  fx: null,
  facing: 1,
  marchAt: -1,
  firedAt: new Map(),
  bossHurt: 0,
};

/** Where an object is between the previous and the latest step. */
function lerp(view: View, object: object, index: 0 | 1, value: number): number {
  const before = view.previous?.get(object);
  return before ? before[index] + (value - before[index]) * view.alpha : value;
}
function classicStars(ctx: Ctx): void {
  for (let i = 0; i < 65; i++) {
    ctx.fillStyle = i % 4 === 0 ? '#334b48' : '#1b2b30';
    ctx.fillRect((i * 137 + 37) % WIDTH, (i * 79 + 19) % HEIGHT, i % 4 === 0 ? 2 : 1, 2);
  }
}
const wrap = (x: number): number => ((x % WIDTH) + WIDTH) % WIDTH;
const LAYERS = [
  { count: 65, drift: 2, parallax: 0.01, colors: ['#334b48', '#1b2b30'], seed: 137 },
  { count: 32, drift: 6, parallax: 0.03, colors: ['#4d6a63'], seed: 211 },
  { count: 12, drift: 13, parallax: 0.06, colors: ['#8fb6a6'], seed: 89 },
] as const;
function hills(ctx: Ctx, offset: number): void {
  ctx.fillStyle = '#0b1316';
  for (let x = 0; x < WIDTH; x += 8) {
    const h = 18 + Math.sin((x + offset) * 0.011) * 10 + Math.sin((x + offset) * 0.027) * 6;
    ctx.fillRect(x, HEIGHT - h, 8, h);
  }
}
function moonShade(x: number, y: number): string {
  if ((x + 8) ** 2 + (y - 6) ** 2 < 300) return '#1a2627';
  return x * x + y * y > 520 ? '#2f4440' : '#24343a';
}
function moon(ctx: Ctx): void {
  for (let y = -26; y <= 26; y += 2) {
    for (let x = -26; x <= 26; x += 2) {
      if (x * x + y * y > 676) continue;
      ctx.fillStyle = moonShade(x, y);
      ctx.fillRect(716 + x, 40 + y, 2, 2);
    }
  }
}
/** A slowly drifting three-layer night sky that shifts a little as the ferret runs. */
function sky(ctx: Ctx, time: number, ferretX: number): void {
  const lean = ferretX - WIDTH / 2;
  moon(ctx);
  LAYERS.forEach((layer, depth) => {
    for (let i = 0; i < layer.count; i++) {
      const x = wrap(((i * layer.seed + 37) % WIDTH) + time * layer.drift - lean * layer.parallax);
      const y = (i * 79 + 19 + depth * 31) % (HEIGHT - 60);
      ctx.globalAlpha = depth === 2 ? 0.55 + 0.45 * Math.sin(time * 0.9 + i) : 1;
      ctx.fillStyle = layer.colors[i % 4 === 0 ? 0 : layer.colors.length - 1] ?? '#334b48';
      ctx.fillRect(Math.round(x), y, depth || i % 4 ? 1 : 2, 2);
    }
  });
  ctx.globalAlpha = 1;
  hills(ctx, lean * 0.12);
}
const ATTRACT = [
  ['#b69af4', 'DER COOLE'],
  ['#76bca3', 'DIE QUAK-BANDE'],
  ['#ffe17c', 'DER NEULING'],
] as const;
function attract(ctx: Ctx, time: number): void {
  ctx.font = '16px monospace';
  ctx.textAlign = 'center';
  ATTRACT.forEach(([color, name], i) => {
    drawDuck(ctx, 250 + i * 150, 360, i * 2, time, 3.6);
    ctx.fillStyle = color;
    ctx.fillText(name, 250 + i * 150, 420);
  });
  drawFerret(ctx, 400, 529, time, { scale: 4, moving: true });
  ctx.fillStyle = '#6b8e83';
  ctx.fillText('EIN FRETTCHEN. KEINE VERSTÄRKUNG. GANZ VIEL HERZ.', 400, 590);
}
function shelters(ctx: Ctx, p: Player): void {
  snap(ctx);
  ctx.fillStyle = '#70cda5';
  for (const s of p.shelters) {
    for (let i = 0; i < s.pixels.length; i++) {
      if (s.pixels[i]) {
        rect(ctx, s.x + (i % s.w) * s.cell, s.y + Math.floor(i / s.w) * s.cell, s.cell, s.cell);
      }
    }
  }
}
function duckLook(d: Duck, t: number, view: View, squash: number): Partial<DuckLook> {
  if (!view.modern) return {};
  return {
    armor: d.armor ?? 0,
    squash: d.dive ? 0 : squash,
    beak: t - (view.firedAt.get(d.id) ?? -1) < 0.25,
    flap: d.dive ? 22 : 8,
  };
}
function ducks(ctx: Ctx, g: Game, p: Player, view: View): void {
  const t = g.time;
  const squash = view.modern && t - view.marchAt < 0.09 ? 1 : 0;
  for (const d of p.ducks) {
    if (!d.alive) continue;
    const x = d.dive ? d.x + lerp(view, d, 0, d.ox ?? 0) : duckX(d);
    const y = d.dive ? d.y + lerp(view, d, 1, d.oy ?? 0) : duckY(d);
    drawDuck(ctx, x, y, d.row, t, 2, duckLook(d, t, view, squash));
  }
}
function ferret(ctx: Ctx, g: Game, p: Player, actions: Actions, view: View): void {
  const t = g.time;
  if (g.state === 'death' && g.timer <= 0.9) return;
  // A gentle 2 Hz pulse marks the safe respawn without flashing.
  ctx.globalAlpha = p.invincible > 0 ? 0.6 + Math.sin(t * Math.PI * 4) * 0.25 : 1;
  const x = lerp(view, p, 0, p.x);
  drawFerret(ctx, x, 617, t, {
    moving: actions.left === true || actions.right === true,
    recoil: p.recoil,
    dead: g.state === 'death',
    flip: view.facing < 0,
    flash: view.modern && p.recoil > 0.07,
  });
  ctx.globalAlpha = 1;
  if (view.modern && p.boosts.shield > 0) drawShield(ctx, x, 614, t);
}
function wiggle(kind: number, t: number, j: number): number {
  if (kind === 0) return Math.sin(t * 20 + j) * 3;
  if (kind === 1) return j % 2 ? 3 : -3;
  return Math.sin(t * 25 + j * 2) * 4;
}
function shots(ctx: Ctx, g: Game, p: Player, view: View): void {
  snap(ctx);
  for (const s of p.shots) {
    const x = lerp(view, s, 0, s.x);
    const y = lerp(view, s, 1, s.y);
    const ferretShot = s.owner === 'ferret';
    ctx.fillStyle = ferretShot ? '#fff2cb' : s.kind === 0 ? '#ff9968' : '#f47587';
    if (ferretShot) {
      rect(ctx, x - 2, y - 7, 4, 14);
      continue;
    }
    for (let j = 0; j < 4; j++) rect(ctx, Math.round(x + wiggle(s.kind ?? 0, g.time, j)), y + j * 3 - 6, 3, 3);
  }
}
function burst(ctx: Ctx, e: Game['effects'][number]): void {
  const dist = (1 - e.life / (e.type === 'death' ? 1.2 : 0.55)) * 40;
  ctx.globalAlpha = Math.min(1, e.life * 3);
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    ctx.fillStyle = i % 3 === 0 ? '#fff8d8' : e.type === 'death' ? '#b98668' : '#ffe17c';
    ctx.fillRect(
      Math.round(e.x + Math.cos(a) * dist),
      Math.round(e.y + Math.sin(a) * dist),
      i % 2 ? 3 : 5,
      i % 2 ? 5 : 3,
    );
  }
  ctx.globalAlpha = 1;
}
function bursts(ctx: Ctx, g: Game): void {
  for (const e of g.effects) {
    if (e.type !== 'bonus') {
      burst(ctx, e);
      continue;
    }
    ctx.fillStyle = '#ffe17c';
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`+${e.value}`, e.x, e.y - (1.2 - e.life) * 22);
  }
}
function overlays(ctx: Ctx, p: Player): void {
  const b = p.boss;
  if (b) {
    ctx.fillStyle = '#d4e5e6';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('THE GREAT DRAKE', WIDTH / 2, 26);
    ctx.fillStyle = '#1b2b30';
    ctx.fillRect(250, 34, 300, 8);
    ctx.fillStyle = '#f47587';
    ctx.fillRect(250, 34, (300 * b.hp) / b.max, 8);
  }
  if (p.boosts.slow > 0) {
    ctx.fillStyle = '#b69af414';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
}
function footer(ctx: Ctx, p: Player): void {
  ctx.fillStyle = '#365a4e';
  ctx.font = '14px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('DEN BAU VERTEIDIGEN', 30, 668);
  for (let i = 0; i < p.lives; i++) drawFerret(ctx, WIDTH - 40 - i * 34, 662, 0, { scale: 1 });
}
function defenseLine(ctx: Ctx): void {
  ctx.strokeStyle = '#18332d';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(28, DEFENSE);
  ctx.lineTo(WIDTH - 28, DEFENSE);
  ctx.stroke();
}
function field(ctx: Ctx, g: Game, p: Player, actions: Actions, view: View): void {
  ctx.save();
  if (view.fx) ctx.translate(...view.fx.shake);
  defenseLine(ctx);
  shelters(ctx, p);
  ducks(ctx, g, p, view);
  if (view.modern && p.boss) {
    const b = p.boss;
    drawBoss(ctx, lerp(view, b, 0, b.x), lerp(view, b, 1, b.y), g.time, view.bossHurt);
  }
  if (view.modern) {
    for (const c of p.pickups) drawPickup(ctx, lerp(view, c, 0, c.x), lerp(view, c, 1, c.y), c.kind, g.time);
  }
  if (p.saucer) drawSaucer(ctx, lerp(view, p.saucer, 0, p.saucer.x), p.saucer.y, g.time);
  ferret(ctx, g, p, actions, view);
  shots(ctx, g, p, view);
  bursts(ctx, g);
  view.fx?.draw(ctx, g.time);
  ctx.restore();
}
/** Draws the field of `g` — or, with no game, the machine's attract screen — at page time `time`, s. */
export function render(ctx: Ctx, g: Game | null, time: number, actions: Actions, view: View = PLAIN): void {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = '#080d11';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const p = g && current(g);
  if (view.modern) sky(ctx, time, p ? p.x : WIDTH / 2);
  else classicStars(ctx);
  if (!g || !p) {
    attract(ctx, time);
    return;
  }
  field(ctx, g, p, actions, view);
  if (view.modern) overlays(ctx, p);
  footer(ctx, p);
}

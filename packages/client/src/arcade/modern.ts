/**
 * The machine's modern rules (the reference's src/modern.js), laid over the classic hooks from
 * wave 2 on, so that wave 1 plays as the original: a multiplier for hits in a row, pickups the
 * visitor drops, ducks that dive, helmet ducks, formations, and the Great Drake every fifth wave.
 */
import {
  CLASSIC,
  DIFFICULTIES,
  WIDTH,
  advance,
  award,
  current,
  duckX,
  duckY,
  emit,
  exposed,
  findDuck,
  finishTurn,
  fireBolt,
  formation,
  hitPlayer,
  hitSaucer,
  killDuck,
  nextWave,
  rowScore,
  type Actions,
  type Boss,
  type Duck,
  type Game,
  type Mode,
  type PickupKind,
  type Player,
  type Shot,
} from './rules.js';

export const BOOSTS: Readonly<Record<PickupKind, number>> = { spread: 6, shield: 8, slow: 5 };
export const PICKUP_KINDS: readonly PickupKind[] = ['spread', 'shield', 'slow'];
export const SPREAD_VX = 150;
export const BOSS_HIT_POINTS = 20;
export const BOSS_BONUS = 500;
const SLOW_FACTOR = 0.5;
const DIVE_SECONDS = 2.8;
const BOSS_Y = 120;

export type Shape = 'grid' | 'stagger' | 'wedge';

export const enhanced = (p: Player): boolean => p.wave >= 2;
export const isBossWave = (wave: number): boolean => wave >= 5 && wave % 5 === 0;
/** Hits 1–5 score ×1, 6–10 ×2, 11–15 ×3, from the 16th in a row ×4. */
export const multiplier = (chain: number): number =>
  Math.min(4, 1 + Math.floor(Math.max(0, chain - 1) / 5));
export const bossHealth = (wave: number): number => 12 + (wave / 5 - 1) * 4;
export const maxDivers = (wave: number): number => (wave >= 6 ? 2 : 1);
export const diveDelay = (wave: number): number => Math.max(2.5, 6 - wave * 0.3);
const SHAPES: readonly Shape[] = ['grid', 'stagger', 'wedge'];
export const formationName = (wave: number): Shape =>
  wave < 2 || isBossWave(wave) ? 'grid' : (SHAPES[(wave - 2) % 3] ?? 'grid');
const armoured = (wave: number, d: Duck): boolean =>
  (wave >= 3 && d.row === 1 && d.col % 2 === 0) || (wave >= 6 && d.row === 2 && d.col % 2 === 1);

/** The flock of a wave: the classic grid, varied in shape and armour from wave 2. */
export function waveFormation(wave: number): Duck[] {
  const ducks = formation(wave);
  if (wave < 2) return ducks;
  const shape = formationName(wave);
  for (const d of ducks) {
    if (shape === 'stagger' && d.row % 2 === 1) d.x += 27;
    if (shape === 'wedge') d.y += (5 - Math.abs(d.col - 5)) * 6;
    if (armoured(wave, d)) d.armor = 1;
  }
  return isBossWave(wave) ? ducks.filter((d) => d.row >= 2) : ducks;
}
export function makeBoss(wave: number): Boss {
  const hp = bossHealth(wave);
  return { x: WIDTH / 2, y: BOSS_Y, hp, max: hp, direction: 1, fire: 1.5, t: 0 };
}
function fire(g: Game, p: Player, input: Actions): void {
  if (!fireBolt(g, p, input)) return;
  p.volleyHit = false;
  if (p.boosts.spread <= 0) return;
  for (const vx of [-SPREAD_VX, SPREAD_VX])
    p.shots.push({ x: p.x, y: 596, owner: 'ferret', vx, vy: -540 });
}
function scoreHit(g: Game, p: Player, points: number, x: number, y: number): number {
  p.chain++;
  p.bestChain = Math.max(p.bestChain, p.chain);
  p.volleyHit = true;
  const m = multiplier(p.chain);
  if (m > multiplier(p.chain - 1)) emit(g, 'combo', x, y, m);
  if (m > 1) emit(g, 'points', x, y, points * m);
  return points * m;
}
function bossDown(g: Game, p: Player, b: Boss): void {
  const bonus = BOSS_BONUS * (p.wave / 5);
  award(g, bonus);
  emit(g, 'boss-down', b.x, b.y, bonus);
  p.boss = null;
}
function hitBoss(g: Game, p: Player, s: Shot): boolean {
  const b = p.boss;
  if (!b || Math.abs(s.x - b.x) >= 46 || Math.abs(s.y - b.y) >= 30) return false;
  s.dead = true;
  b.hp--;
  p.hits++;
  award(g, scoreHit(g, p, BOSS_HIT_POINTS, b.x, b.y));
  emit(g, 'boss-hit', s.x, s.y, b.hp);
  if (b.hp <= 0) bossDown(g, p, b);
  return true;
}
function dropPickup(g: Game, p: Player, x: number, y: number): void {
  const kind = PICKUP_KINDS[Math.floor(g.random() * PICKUP_KINDS.length)] ?? 'spread';
  p.pickups.push({ x, y, kind, vy: 95 });
  emit(g, 'pickup-drop', x, y, kind);
}
function hitDuck(g: Game, p: Player, s: Shot, d: Duck): void {
  if (d.armor) {
    d.armor--;
    s.dead = true;
    p.volleyHit = true;
    emit(g, 'clang', duckX(d), duckY(d), d.id);
    return;
  }
  const points = rowScore(d.row) * (d.dive ? 2 : 1);
  killDuck(g, d, s, scoreHit(g, p, points, duckX(d), duckY(d)));
}
function strike(g: Game, p: Player, s: Shot): void {
  if (!enhanced(p)) {
    CLASSIC.strike(g, p, s);
    return;
  }
  const d = findDuck(p, s);
  if (d) hitDuck(g, p, s, d);
  else if (!hitBoss(g, p, s)) {
    const saucer = p.saucer;
    if (saucer !== null && hitSaucer(g, p, s)) dropPickup(g, p, saucer.x, saucer.y);
  }
}
/** A volley that ends without hitting anything breaks the chain. */
function lost(_g: Game, p: Player): void {
  if (!enhanced(p) || p.volleyHit) return;
  if (!p.shots.some((s) => s.owner === 'ferret' && !s.dead)) p.chain = 0;
}
function hurt(g: Game): void {
  const p = current(g);
  if (p.boosts.shield > 0 && p.invincible <= 0) {
    p.boosts.shield = 0;
    p.invincible = 1;
    emit(g, 'shield-break', p.x, 617);
    return;
  }
  hitPlayer(g);
}
function startDive(g: Game, p: Player): void {
  const divers = p.ducks.filter((d) => d.alive && d.dive).length;
  const candidates = exposed(p).filter((d) => 605 - d.y >= 40);
  p.diveTimer = diveDelay(p.wave);
  if (divers >= maxDivers(p.wave) || !candidates.length) return;
  const d = candidates[Math.floor(g.random() * candidates.length)];
  if (d === undefined) return;
  d.dive = { t: 0, tx: p.x - d.x, depth: 605 - d.y, side: d.x < p.x ? 1 : -1 };
  emit(g, 'dive', d.x, d.y, d.id);
}
function moveDiver(g: Game, p: Player, d: Duck, dt: number): void {
  const v = d.dive;
  if (!v) return;
  v.t += dt;
  const u = Math.min(1, v.t / DIVE_SECONDS);
  const arc = Math.sin(Math.PI * u);
  d.ox = v.tx * arc + 46 * v.side * Math.sin(2 * Math.PI * u);
  d.oy = v.depth * arc;
  if (u >= 1) {
    d.dive = null;
    d.ox = d.oy = 0;
  } else if (Math.abs(duckX(d) - p.x) < 30 && Math.abs(duckY(d) - 617) < 24) {
    if (p.invincible > 0) return;
    d.alive = false;
    emit(g, 'explosion', duckX(d), duckY(d), d.row);
    hurt(g);
  }
}
function moveBoss(g: Game, p: Player, b: Boss, dt: number): void {
  b.t += dt;
  b.x += b.direction * 90 * dt;
  if (b.x < 90 || b.x > WIDTH - 90) {
    b.x = Math.max(90, Math.min(WIDTH - 90, b.x));
    b.direction *= -1;
  }
  b.y = BOSS_Y + Math.sin(b.t * 1.5) * 10;
  b.fire -= dt;
  if (b.fire > 0) return;
  b.fire = Math.max(1.1, 2 - p.wave * 0.05);
  const vy = DIFFICULTIES[g.difficulty].bullet * 0.8;
  for (const vx of [-70, 0, 70])
    p.shots.push({ x: b.x, y: b.y + 30, owner: 'duck', kind: 2, vx, vy });
  emit(g, 'boss-fire', b.x, b.y);
}
function movePickups(g: Game, p: Player, dt: number): void {
  for (const k of PICKUP_KINDS) p.boosts[k] = Math.max(0, p.boosts[k] - dt);
  for (const c of p.pickups) {
    c.y += c.vy * dt;
    if (Math.abs(c.x - p.x) < 30 && c.y >= 597 && c.y <= 640) {
      c.taken = true;
      p.boosts[c.kind] = BOOSTS[c.kind];
      emit(g, 'pickup', c.x, c.y, c.kind);
    }
  }
  p.pickups = p.pickups.filter((c) => !c.taken && c.y < 700);
}
function extras(g: Game, p: Player, dt: number, duckDt: number): void {
  if (!enhanced(p)) return;
  movePickups(g, p, dt);
  if (p.boss) moveBoss(g, p, p.boss, duckDt);
  p.diveTimer -= duckDt;
  if (p.diveTimer <= 0) startDive(g, p);
  for (const d of p.ducks) {
    if (d.alive && d.dive && g.state === 'playing') moveDiver(g, p, d, duckDt);
  }
}
/** A lost life ends every running dive, boost, falling pickup and the chain. */
export function clearRun(p: Player): void {
  p.chain = 0;
  p.pickups = [];
  for (const k of PICKUP_KINDS) p.boosts[k] = 0;
  for (const d of p.ducks) {
    d.dive = null;
    d.ox = d.oy = 0;
  }
}
function modernNextWave(g: Game): void {
  nextWave(g);
  const p = current(g);
  p.ducks = waveFormation(p.wave);
  p.boss = isBossWave(p.wave) ? makeBoss(p.wave) : null;
  p.pickups = [];
  p.diveTimer = 4;
  emit(g, 'wave-start', 0, 0, p.wave);
}
export const MODERN: Readonly<Mode> = {
  duckTime: (_g, p, dt) => (p.boosts.slow > 0 ? dt * SLOW_FACTOR : dt),
  fire,
  extras,
  strike,
  lost,
  hurt,
  cleared: (p) => CLASSIC.cleared(p) && !p.boss,
  finishTurn(g) {
    clearRun(current(g));
    finishTurn(g);
  },
  nextWave: modernNextWave,
};
export function stepModern(g: Game, input: Actions, dt: number): void {
  advance(g, input, dt, MODERN);
}

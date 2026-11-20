/**
 * The break-room machine's simulation, „Ferret vs Ducks" as Uros made it (the reference's
 * src/rules.js): pure — no page, drawing, sound, wall clock or storage; time comes as `dt` and
 * chance as `game.random`. The classic rules step for step as the original (`CLASSIC`, `step`);
 * the modern rules swap some of its hooks (modern.ts). The texts it keeps (`reason`) are the
 * original's, which the Classic test compares; the machine's screen says them in German (texts.ts).
 */

export const WIDTH = 800;
export const HEIGHT = 680;
export const DEFENSE = 592;

export type Difficulty = 'Easy' | 'Normal' | 'Hard';
export const DIFFICULTIES: Readonly<
  Record<Difficulty, { readonly march: number; readonly fire: number; readonly bullet: number }>
> = {
  Easy: { march: 0.86, fire: 1.7, bullet: 160 },
  Normal: { march: 0.66, fire: 1.15, bullet: 200 },
  Hard: { march: 0.47, fire: 0.8, bullet: 240 },
};
export const BONUS: readonly number[] = [
  100, 50, 50, 100, 150, 100, 100, 50, 300, 100, 100, 100, 50, 150, 100,
];

export type PickupKind = 'spread' | 'shield' | 'slow';
export type GameState = 'playing' | 'death' | 'wave-clear' | 'turn-change' | 'paused' | 'game-over';

export interface Dive {
  t: number;
  tx: number;
  depth: number;
  side: number;
}
export interface Duck {
  id: number;
  col: number;
  row: number;
  x: number;
  y: number;
  alive: boolean;
  armor?: number;
  dive?: Dive | null;
  ox?: number;
  oy?: number;
}
export interface Shot {
  x: number;
  y: number;
  owner: 'ferret' | 'duck';
  vx: number;
  vy: number;
  kind?: number;
  dead?: boolean;
}
export interface Shelter {
  x: number;
  y: number;
  w: number;
  h: number;
  cell: number;
  pixels: boolean[];
}
export interface Saucer {
  x: number;
  y: number;
  direction: number;
}
export interface Boss {
  x: number;
  y: number;
  hp: number;
  max: number;
  direction: number;
  fire: number;
  t: number;
}
export interface Pickup {
  x: number;
  y: number;
  kind: PickupKind;
  vy: number;
  taken?: boolean;
}
export interface Player {
  x: number;
  lives: number;
  score: number;
  wave: number;
  extra: boolean;
  dead: boolean;
  ducks: Duck[];
  shelters: Shelter[];
  direction: number;
  march: number;
  fire: number;
  saucerTimer: number;
  saucer: Saucer | null;
  shots: Shot[];
  shotCount: number;
  attack: number;
  invincible: number;
  recoil: number;
  hits: number;
  chain: number;
  bestChain: number;
  volleyHit: boolean;
  boosts: Record<PickupKind, number>;
  pickups: Pickup[];
  boss: Boss | null;
  diveTimer: number;
}
export interface GameEvent {
  type: string;
  x: number;
  y: number;
  value: number | string;
}
export interface Effect extends GameEvent {
  life: number;
}
export interface Game {
  difficulty: Difficulty;
  classic: boolean;
  players: Player[];
  active: number;
  state: GameState;
  previous: GameState | null;
  timer: number;
  time: number;
  events: GameEvent[];
  effects: Effect[];
  reason: string;
  random: () => number;
}
export interface Actions {
  left?: boolean;
  right?: boolean;
  fire?: boolean;
}

export const rowScore = (row: number): number => (row === 0 ? 30 : row < 3 ? 20 : 10);
export const saucerBonus = (shots: number): number =>
  BONUS[(((shots - 1) % BONUS.length) + BONUS.length) % BONUS.length] ?? 0;

function shelterPixels(): boolean[] {
  return Array.from({ length: 308 }, (_, i) => {
    const px = i % 22;
    const py = Math.floor(i / 22);
    return !(py < 3 && (px < 3 - py || px > 18 + py)) && !(py > 7 && px > 6 && px < 15);
  });
}
export function shelters(): Shelter[] {
  return [106, 276, 446, 616].map((x) => ({
    x,
    y: 492,
    w: 22,
    h: 14,
    cell: 3,
    pixels: shelterPixels(),
  }));
}
export function formation(wave = 1): Duck[] {
  return Array.from({ length: 55 }, (_, i) => ({
    id: i,
    col: i % 11,
    row: Math.floor(i / 11),
    x: 92 + (i % 11) * 54,
    y: 128 + Math.floor(i / 11) * 49 + Math.min(wave - 1, 6) * 12,
    alive: true,
  }));
}
export function player(): Player {
  return {
    x: 400,
    lives: 3,
    score: 0,
    wave: 1,
    extra: false,
    dead: false,
    ducks: formation(),
    shelters: shelters(),
    direction: 1,
    march: 0,
    fire: 0,
    saucerTimer: 14,
    saucer: null,
    shots: [],
    shotCount: 0,
    attack: 0,
    invincible: 1.5,
    recoil: 0,
    hits: 0,
    chain: 0,
    bestChain: 0,
    volleyHit: false,
    boosts: { spread: 0, shield: 0, slow: 0 },
    pickups: [],
    boss: null,
    diveTimer: 4,
  };
}
export function createGame(
  difficulty: Difficulty = 'Normal',
  count = 1,
  { classic = false }: { classic?: boolean } = {},
): Game {
  return {
    difficulty,
    classic,
    players: Array.from({ length: count === 2 ? 2 : 1 }, player),
    active: 0,
    state: 'playing',
    previous: null,
    timer: 0,
    time: 0,
    events: [],
    effects: [],
    reason: '',
    random: Math.random,
  };
}
export function current(g: Game): Player {
  const p = g.players[g.active];
  if (p === undefined) throw new Error(`arcade: no player ${g.active}`);
  return p;
}
export function emit(g: Game, type: string, x = 0, y = 0, value: number | string = 0): void {
  g.events.push({ type, x, y, value });
}
export function award(g: Game, points: number): void {
  const p = current(g);
  p.score += points;
  if (!p.extra && p.score >= 1500) {
    p.extra = true;
    p.lives++;
    emit(g, 'extra', p.x, 615);
  }
}
const PAUSABLE: readonly GameState[] = ['playing', 'death', 'wave-clear', 'turn-change'];
export function pause(g: Game): void {
  if (PAUSABLE.includes(g.state)) {
    g.previous = g.state;
    g.state = 'paused';
  }
}
export function resume(g: Game): void {
  if (g.state === 'paused') {
    g.state = g.previous ?? 'playing';
    g.previous = null;
  }
}
export function marchInterval(g: Game): number {
  const p = current(g);
  const alive = p.ducks.filter((d) => d.alive).length;
  return Math.max(
    0.045,
    (DIFFICULTIES[g.difficulty].march * (0.12 + (0.88 * alive) / 55)) /
      (1 + Math.min(p.wave - 1, 12) * 0.075),
  );
}
/** The lowest living duck of each column, none of them diving: the ones that may fire. */
export function exposed(p: Player): Duck[] {
  const columns = new Map<number, Duck>();
  for (const d of p.ducks) {
    const low = columns.get(d.col);
    if (d.alive && !d.dive && (low === undefined || low.y < d.y)) columns.set(d.col, d);
  }
  return [...columns.values()];
}
function shooter(eligible: Duck[], kind: number, p: Player): Duck | undefined {
  if (kind !== 0) return eligible[(p.attack * 7) % eligible.length];
  return eligible.reduce((a, b) => (Math.abs(a.x - p.x) < Math.abs(b.x - p.x) ? a : b));
}
export function enemyFire(g: Game): void {
  const p = current(g);
  const eligible = exposed(p);
  if (!eligible.length || p.shots.filter((s) => s.owner === 'duck').length >= 3) return;
  const kind = p.attack++ % 3;
  const d = shooter(eligible, kind, p);
  if (d === undefined) return;
  emit(g, 'duck-fire', d.x, d.y, d.id);
  p.shots.push({
    x: d.x,
    y: d.y + 16,
    owner: 'duck',
    kind,
    vx: kind === 0 ? Math.max(-55, Math.min(55, (p.x - d.x) * 0.2)) : 0,
    vy: DIFFICULTIES[g.difficulty].bullet + Math.min(p.wave - 1, 10) * 8,
  });
}
/** Clears the cells within a radius of √5 cells around (cx, cy). */
function erode(s: Shelter, cx: number, cy: number): void {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const xx = cx + dx;
      const yy = cy + dy;
      const inside = xx >= 0 && xx < s.w && yy >= 0 && yy < s.h;
      if (inside && dx * dx + dy * dy <= 5) s.pixels[yy * s.w + xx] = false;
    }
  }
}
/** The cell of `s` under (x, y) where it stands, else null. */
function cellAt(s: Shelter, x: number, y: number): [number, number] | null {
  const cx = Math.floor((x - s.x) / s.cell);
  const cy = Math.floor((y - s.y) / s.cell);
  const inside = cx >= 0 && cx < s.w && cy >= 0 && cy < s.h;
  return inside && s.pixels[cy * s.w + cx] === true ? [cx, cy] : null;
}
export function shelterHit(p: Player, x: number, y: number, wear = true): boolean {
  for (const s of p.shelters) {
    const cell = cellAt(s, x, y);
    if (cell === null) continue;
    if (wear) erode(s, cell[0], cell[1]);
    return true;
  }
  return false;
}
export function hitPlayer(g: Game, invasion = false): void {
  if (g.state !== 'playing') return;
  const p = current(g);
  if (!invasion && p.invincible > 0) return;
  p.lives = invasion ? 0 : p.lives - 1;
  p.dead = p.lives <= 0;
  p.shots = [];
  g.state = 'death';
  g.timer = 1.25;
  g.reason = invasion ? 'The flock crossed the defense line.' : 'The flock got through.';
  emit(g, 'death', p.x, 615);
}
export function finishTurn(g: Game): void {
  const p = current(g);
  const next = g.players.findIndex((q, i) => i !== g.active && !q.dead);
  if (next >= 0) {
    g.active = next;
    g.state = 'turn-change';
    g.timer = 0;
    current(g).shots = [];
    current(g).invincible = 2;
  } else if (p.dead) {
    g.state = 'game-over';
  } else {
    p.x = 400;
    p.invincible = 2;
    g.state = 'playing';
  }
}
export function nextWave(g: Game): void {
  const p = current(g);
  p.wave++;
  p.ducks = formation(p.wave);
  p.shelters = shelters();
  p.direction = 1;
  p.march = 0;
  p.fire = 0;
  p.saucer = null;
  p.saucerTimer = 14;
  p.invincible = 2;
  p.x = 400;
  g.state = 'playing';
}
/** A duck's drawn and hit position: its formation slot plus any dive offset. */
export const duckX = (d: Duck): number => d.x + (d.ox || 0);
export const duckY = (d: Duck): number => d.y + (d.oy || 0);
export function findDuck(p: Player, s: Shot): Duck | undefined {
  return p.ducks.find(
    (d) =>
      d.alive && Math.abs(s.x - duckX(d)) < 21 && s.y >= duckY(d) - 16 && s.y <= duckY(d) + 18,
  );
}
export function killDuck(g: Game, d: Duck, s: Shot, points: number): void {
  d.alive = false;
  s.dead = true;
  current(g).hits++;
  award(g, points);
  emit(g, 'explosion', duckX(d), duckY(d), d.row);
}
export function hitSaucer(g: Game, p: Player, s: Shot): boolean {
  const saucer = p.saucer;
  if (saucer === null || Math.abs(s.x - saucer.x) >= 34 || Math.abs(s.y - saucer.y) >= 15) {
    return false;
  }
  const bonus = saucerBonus(p.shotCount);
  award(g, bonus);
  emit(g, 'bonus', saucer.x, saucer.y, bonus);
  p.saucer = null;
  s.dead = true;
  return true;
}
export function fireBolt(g: Game, p: Player, input: Actions): boolean {
  if (!input.fire || p.shots.some((s) => s.owner === 'ferret')) return false;
  p.shots.push({ x: p.x, y: 596, owner: 'ferret', vx: 0, vy: -540 });
  p.shotCount++;
  p.recoil = 0.13;
  emit(g, 'shoot', p.x, 598);
  return true;
}

/** What a set of rules decides at each step; the modern rules replace some (modern.ts). */
export interface Mode {
  duckTime: (g: Game, p: Player, dt: number) => number;
  fire: (g: Game, p: Player, input: Actions) => unknown;
  extras: (g: Game, p: Player, dt: number, duckDt: number) => void;
  strike: (g: Game, p: Player, s: Shot) => void;
  lost: (g: Game, p: Player) => void;
  hurt: (g: Game) => void;
  cleared: (p: Player) => boolean;
  finishTurn: (g: Game) => void;
  nextWave: (g: Game) => void;
}
/** The original arcade rules. */
export const CLASSIC: Readonly<Mode> = {
  duckTime: (_g, _p, dt) => dt,
  fire: fireBolt,
  extras: () => undefined,
  strike(g, p, s) {
    const d = findDuck(p, s);
    if (d) killDuck(g, d, s, rowScore(d.row));
    else hitSaucer(g, p, s);
  },
  lost: () => undefined,
  hurt: (g) => hitPlayer(g),
  cleared: (p) => p.ducks.every((d) => !d.alive),
  finishTurn,
  nextWave,
};
function movePlayer(p: Player, input: Actions, dt: number): void {
  p.invincible = Math.max(0, p.invincible - dt);
  p.recoil = Math.max(0, p.recoil - dt);
  const way = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  p.x = Math.max(28, Math.min(WIDTH - 28, p.x + way * 300 * dt));
}
function marchFlock(g: Game, p: Player, dt: number): void {
  p.march += dt;
  if (p.march < marchInterval(g)) return;
  p.march = 0;
  const alive = p.ducks.filter((d) => d.alive);
  const edge = alive.some(
    (d) => d.x + p.direction * 12 < 28 || d.x + p.direction * 12 > WIDTH - 28,
  );
  for (const d of alive) {
    if (edge) d.y += 22;
    else d.x += p.direction * 12;
  }
  if (edge) p.direction *= -1;
  emit(g, 'march');
}
function crush(p: Player, d: Duck): void {
  for (const s of p.shelters) {
    if (d.y + 18 < s.y || d.y - 18 > s.y + s.h * s.cell) continue;
    for (let i = 0; i < s.pixels.length; i++) {
      const x = s.x + (i % s.w) * s.cell;
      const y = s.y + Math.floor(i / s.w) * s.cell;
      if (Math.abs(x - d.x) < 22 && Math.abs(y - d.y) < 18) s.pixels[i] = false;
    }
  }
}
/** Ducks crush the shelters they touch; one crossing the defense line ends the game. */
function invaded(g: Game, p: Player): boolean {
  for (const d of p.ducks.filter((d) => d.alive)) {
    if (d.y + 16 >= DEFENSE) {
      hitPlayer(g, true);
      return true;
    }
    crush(p, d);
  }
  return false;
}
function flockFire(g: Game, p: Player, dt: number): void {
  p.fire += dt;
  const delay = Math.max(
    0.32,
    DIFFICULTIES[g.difficulty].fire / (1 + Math.min(p.wave - 1, 10) * 0.08),
  );
  if (p.fire >= delay) {
    p.fire = 0;
    enemyFire(g);
  }
}
function moveSaucer(g: Game, p: Player, dt: number): void {
  p.saucerTimer -= dt;
  if (!p.saucer && p.saucerTimer <= 0) {
    const direction = g.random() < 0.5 ? 1 : -1;
    p.saucer = { x: direction === 1 ? -40 : WIDTH + 40, y: 72, direction };
    p.saucerTimer = 20;
    emit(g, 'saucer');
  }
  if (p.saucer) {
    p.saucer.x += p.saucer.direction * 110 * dt;
    if (p.saucer.x < -60 || p.saucer.x > WIDTH + 60) p.saucer = null;
  }
}
function throughShelters(g: Game, p: Player, s: Shot, old: number): boolean {
  const down = s.vy > 0;
  for (let y = old; down ? y <= s.y : y >= s.y; y += down ? 2 : -2) {
    if (shelterHit(p, s.x, y)) {
      s.dead = true;
      emit(g, 'impact', s.x, y);
      return true;
    }
  }
  return false;
}
function leaveField(g: Game, p: Player, s: Shot, mode: Mode): void {
  if (s.y >= 0 && s.y <= HEIGHT) return;
  const missed = s.owner === 'ferret' && !s.dead;
  s.dead = true;
  if (missed) mode.lost(g, p);
}
/** Moves one shot and resolves what it meets; false when it ended the ferret's turn. */
function moveShot(g: Game, p: Player, s: Shot, t: number, mode: Mode): boolean {
  const ferret = s.owner === 'ferret';
  const old = s.y;
  s.x += s.vx * t;
  s.y += s.vy * t;
  if (throughShelters(g, p, s, old)) {
    if (ferret) mode.lost(g, p);
    return true;
  }
  if (ferret) mode.strike(g, p, s);
  else if (Math.abs(s.x - p.x) < 24 && Math.abs(s.y - 617) < 18) {
    s.dead = true;
    mode.hurt(g);
    if (g.state !== 'playing') return false;
  }
  leaveField(g, p, s, mode);
  return true;
}
function moveShots(g: Game, p: Player, dt: number, duckDt: number, mode: Mode): boolean {
  for (const s of p.shots) {
    if (!s.dead && !moveShot(g, p, s, s.owner === 'ferret' ? dt : duckDt, mode)) return false;
  }
  return true;
}
function collideShots(g: Game, p: Player): void {
  for (const a of p.shots) {
    for (const b of p.shots) {
      const meet = Math.abs(a.x - b.x) < 7 && Math.abs(a.y - b.y) < 12;
      if (!a.dead && !b.dead && a.owner !== b.owner && meet) {
        a.dead = b.dead = true;
        emit(g, 'impact', a.x, a.y);
      }
    }
  }
}
function transition(g: Game, dt: number, mode: Mode): void {
  g.timer -= dt;
  if (g.timer > 0) return;
  if (g.state === 'death') mode.finishTurn(g);
  else mode.nextWave(g);
}
const STEPPING: readonly GameState[] = ['playing', 'death', 'wave-clear'];
/** One step of `dt` seconds under `mode`. */
export function advance(g: Game, input: Actions, dt: number, mode: Readonly<Mode>): void {
  if (!STEPPING.includes(g.state)) return;
  g.time += dt;
  const p = current(g);
  g.effects = g.effects.filter((e) => (e.life -= dt) > 0);
  if (g.state === 'death' || g.state === 'wave-clear') {
    transition(g, dt, mode);
    return;
  }
  const duckDt = mode.duckTime(g, p, dt);
  movePlayer(p, input, dt);
  mode.fire(g, p, input);
  marchFlock(g, p, duckDt);
  if (invaded(g, p)) return;
  flockFire(g, p, duckDt);
  moveSaucer(g, p, dt);
  mode.extras(g, p, dt, duckDt);
  if (g.state !== 'playing' || !moveShots(g, p, dt, duckDt, mode)) return;
  collideShots(g, p);
  p.shots = p.shots.filter((s) => !s.dead);
  if (mode.cleared(p)) {
    p.shots = [];
    g.state = 'wave-clear';
    g.timer = 2;
    emit(g, 'clear');
  }
}
/** One step under the classic rules. */
export function step(g: Game, input: Actions, dt: number): void {
  advance(g, input, dt, CLASSIC);
}

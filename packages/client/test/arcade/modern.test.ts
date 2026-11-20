import { describe, expect, it } from 'vitest';
import * as original from './rules-49dc727.js';
import {
  DEFENSE,
  HEIGHT,
  WIDTH,
  createGame,
  current,
  formation,
  hitPlayer,
  marchInterval,
  pause,
  type Actions,
  type Duck,
  type Game,
} from '../../src/arcade/rules.js';
import {
  BOOSTS,
  BOSS_BONUS,
  MODERN,
  bossHealth,
  formationName,
  isBossWave,
  multiplier,
  stepModern,
  waveFormation,
} from '../../src/arcade/modern.js';
import { FixedClock, advanceGame } from '../../src/arcade/clock.js';
import { Input } from '../../src/arcade/input.js';
import { InfoMenu } from '../../src/arcade/info.js';
import {
  DEFAULT_SETTINGS,
  SCORE_KEYS,
  SETTINGS_KEY,
  Scores,
  Settings,
} from '../../src/arcade/scores.js';

/**
 * The machine's modern rules (the reference's tests/modern.test.js): the multiplier, the pickups,
 * the divers, the helmets and the boss, all from wave 2; the fixed step's determinism; dragging
 * and auto-fire; the settings and bests it keeps; the Info menu's pause; the field's size.
 */

const DT = 1 / 120;
const tick = (g: Game, seconds: number, input: Actions = {}): void => {
  for (let i = 0; i < Math.round(seconds * 120); i++) stepModern(g, input, DT);
};
/** A modern game at the start of the given wave with the flock's own fire switched off. */
function atWave(wave: number, options: { classic?: boolean } = {}): Game {
  const g = createGame('Normal', 1, options);
  const p = current(g);
  p.wave = wave - 1;
  MODERN.nextWave(g);
  p.fire = -1000;
  p.saucerTimer = 1000;
  p.diveTimer = 1000;
  p.shelters = [];
  p.invincible = 0;
  g.events = [];
  return g;
}
const bolt = (x: number, y: number, vx = 0) => ({ x, y, owner: 'ferret' as const, vx, vy: -540 });
const shootDuck = (g: Game, d: Duck): void => {
  current(g).shots = [bolt(d.x + (d.ox ?? 0), d.y + (d.oy ?? 0) + 20)];
  stepModern(g, {}, DT);
};
/** `x`, which the test expects there. */
function found<T>(x: T | undefined | null): T {
  if (x === undefined || x === null) throw new Error('expected a value');
  return x;
}
/** A Map behind the storage calls. */
function memoryStore() {
  const db = new Map<string, string>();
  return { db, store: { getItem: (k: string) => db.get(k) ?? null, setItem: (k: string, v: string) => void db.set(k, v) } };
}

describe('the machine’s modern rules', () => {
it('the multiplier climbs every five consecutive hits and stops at four', () => {
  expect([0, 1, 5, 6, 10, 11, 15, 16, 40].map(multiplier)).toEqual([1, 1, 1, 2, 2, 3, 3, 4, 4]);
});

it('consecutive hits from wave 2 score with the multiplier; a miss resets the chain', () => {
  const g = atWave(2),
    p = current(g),
    bottom = p.ducks.filter((d) => d.row === 4);
  for (const d of bottom.slice(0, 6)) shootDuck(g, d);
  expect(p.chain).toBe(6);
  expect(p.score).toBe(5 * 10 + 10 * 2);
  expect(g.events.some((e) => e.type === 'combo' && e.value === 2)).toBeTruthy();
  p.x = 28;
  stepModern(g, { fire: true }, DT);
  tick(g, 1.3);
  expect(p.chain, 'the bolt flew past the flock').toBe(0);
  expect(p.bestChain).toBe(6);
});

it('wave 1 keeps classic scoring and the visitor drops nothing', () => {
  const g = atWave(1),
    p = current(g);
  for (const d of p.ducks.filter((d) => d.row === 4).slice(0, 7)) shootDuck(g, d);
  expect(p.score).toBe(70);
  expect(p.chain).toBe(0);
  p.saucer = { x: 400, y: 72, direction: 1 };
  p.shots = [bolt(400, 85)];
  stepModern(g, {}, DT);
  expect(p.saucer).toBe(null);
  expect(p.pickups).toEqual([]);
});

it('from wave 2 the visitor drops a seeded pickup that the ferret catches', () => {
  for (const [random, kind] of [
    [0, 'spread'],
    [0.5, 'shield'],
    [0.99, 'slow'],
  ] as const) {
    const g = atWave(2),
      p = current(g);
    g.random = () => random;
    p.shotCount = 9;
    p.saucer = { x: p.x, y: 72, direction: 1 };
    p.shots = [bolt(p.x, 85)];
    stepModern(g, {}, DT);
    expect(p.score, 'the visitor keeps its classic bonus').toBe(300);
    expect(p.pickups[0]?.kind).toBe(kind);
    tick(g, 6);
    expect(p.pickups.length).toBe(0);
    expect(p.boosts[kind] > BOOSTS[kind] - 1.5, `${kind} is active`).toBeTruthy();
    expect(g.events.some((e) => e.type === 'pickup' && e.value === kind)).toBeTruthy();
  }
});

it('a missed pickup falls away and boosts run out', () => {
  const g = atWave(2),
    p = current(g);
  p.pickups = [{ x: 60, y: 500, kind: 'shield', vy: 95 }];
  p.x = 700;
  tick(g, 3);
  expect(p.pickups.length).toBe(0);
  expect(p.boosts.shield).toBe(0);
  p.boosts.slow = 1;
  tick(g, 1.1);
  expect(p.boosts.slow).toBe(0);
});

it('spread shot fires a fan of three bolts as one volley', () => {
  const g = atWave(2),
    p = current(g);
  p.boosts.spread = 3;
  stepModern(g, { fire: true }, DT);
  expect(p.shots.map((s) => Math.sign(s.vx)).sort()).toEqual([-1, 0, 1]);
  expect(p.shotCount).toBe(1);
  stepModern(g, { fire: true }, DT);
  expect(p.shots.length, 'no new volley while one is flying').toBe(3);
});

it('a volley with one hit keeps the chain even when its other bolts miss', () => {
  const g = atWave(2),
    p = current(g),
    d = found(p.ducks.find((d) => d.row === 4 && d.col === 5));
  p.chain = 3;
  p.volleyHit = false;
  p.shots = [bolt(30, 2), bolt(d.x, d.y + 150), bolt(770, 300)];
  tick(g, 1);
  expect(p.chain).toBe(4);
});

it('a shield absorbs one hit and leaves a short immunity', () => {
  const g = atWave(2),
    p = current(g);
  p.boosts.shield = 5;
  MODERN.hurt(g);
  expect(p.lives).toBe(3);
  expect(p.boosts.shield).toBe(0);
  expect(p.invincible > 0).toBeTruthy();
  p.invincible = 0;
  MODERN.hurt(g);
  expect(p.lives).toBe(2);
  expect(g.state).toBe('death');
});

it('slow time halves the flock’s clock but not the ferret’s', () => {
  const normal = atWave(2),
    slowed = atWave(2);
  current(slowed).boosts.slow = 5;
  tick(normal, 0.3, { right: true });
  tick(slowed, 0.3, { right: true });
  const a = current(normal),
    b = current(slowed);
  expect(a.x).toBe(b.x);
  expect(Math.abs(b.march - a.march / 2) < 1e-9 || b.march < a.march).toBeTruthy();
  b.shots = [{ x: 100, y: 200, owner: 'duck', vx: 0, vy: 200, kind: 1 }];
  a.shots = [{ x: 100, y: 200, owner: 'duck', vx: 0, vy: 200, kind: 1 }];
  tick(normal, 0.5);
  tick(slowed, 0.5);
  expect(Math.abs(found(b.shots[0]).y - 200 - (found(a.shots[0]).y - 200) / 2)).toBeLessThan(1e-6);
});

it('later waves vary the formation, add armour, and wave 5 brings a boss', () => {
  expect(waveFormation(1)).toEqual(formation(1));
  expect([2, 3, 4, 5, 6, 7].map(formationName)).toEqual(['grid', 'stagger', 'wedge', 'grid', 'stagger', 'wedge']);
  expect(found(waveFormation(3).find((d) => d.row === 1 && d.col === 1)).x).toBe(92 + 54 + 27);
  const wedge = waveFormation(4);
  expect(found(wedge.find((d) => d.col === 5)).y > found(wedge.find((d) => d.col === 0)).y).toBeTruthy();
  expect(waveFormation(2).filter((d) => d.armor).length).toBe(0);
  expect(waveFormation(3).filter((d) => d.armor).length).toBe(6);
  expect(waveFormation(6).filter((d) => d.armor).length).toBe(11);
  expect([4, 5, 9, 10].map(isBossWave)).toEqual([false, true, false, true]);
  expect(waveFormation(5).length).toBe(33);
  expect(bossHealth(5)).toBe(12);
  expect(current(atWave(5)).boss?.hp).toBe(12);
  expect(current(atWave(4)).boss).toBe(null);
});

it('armoured ducks take two hits and score once', () => {
  const g = atWave(3),
    p = current(g),
    d = found(p.ducks.find((d) => d.armor));
  shootDuck(g, d);
  expect(d.alive).toBe(true);
  expect(d.armor).toBe(0);
  expect(g.events.some((e) => e.type === 'clang')).toBeTruthy();
  expect(p.score).toBe(0);
  shootDuck(g, d);
  expect(d.alive).toBe(false);
  expect(p.score).toBe(20);
});

it('a diving duck leaves the formation, swoops at the ferret and returns to its slot', () => {
  const g = atWave(2),
    p = current(g);
  g.random = () => 0;
  p.x = 200;
  p.diveTimer = 0;
  p.invincible = 100;
  stepModern(g, {}, DT);
  const d = found(p.ducks.find((d) => d.dive));
  expect(d, 'a duck dives').toBeTruthy();
  expect(d.row).toBe(4);
  tick(g, 1.4);
  expect(d.y + (d.oy ?? 0) > 560, 'the dive reaches the ferret’s row').toBeTruthy();
  tick(g, 1.5);
  expect(d.dive).toBe(null);
  expect(d.oy).toBe(0);
  expect(d.alive).toBe(true);
});

it('a diver hit mid-dive scores double; one that reaches the ferret costs a life', () => {
  const g = atWave(2),
    p = current(g),
    d = found(p.ducks.find((d) => d.row === 4 && d.col === 3));
  d.dive = { t: 1.4, tx: 0, depth: 200, side: 1 };
  d.ox = 0;
  d.oy = 200;
  shootDuck(g, d);
  expect(d.alive).toBe(false);
  expect(p.score).toBe(20);
  const h = atWave(2),
    q = current(h),
    e = found(q.ducks.find((d) => d.row === 4 && d.col === 5));
  q.x = e.x;
  e.dive = { t: 1.35, tx: 0, depth: 617 - e.y, side: 1 };
  stepModern(h, {}, DT);
  expect(e.alive).toBe(false);
  expect(q.lives).toBe(2);
  expect(h.state).toBe('death');
});

it('the boss soaks hits, fires fans, and the wave is cleared only when it falls', () => {
  const g = atWave(5),
    p = current(g),
    b = found(p.boss);
  for (const d of p.ducks) d.alive = false;
  b.fire = 0;
  stepModern(g, {}, DT);
  expect(p.shots.filter((s) => s.owner === 'duck').length).toBe(3);
  expect(g.state, 'the boss keeps the wave going').toBe('playing');
  p.shots = [];
  for (let i = 0; i < 12; i++) {
    b.fire = 100;
    p.shots = [bolt(b.x, b.y + 20)];
    stepModern(g, {}, DT);
  }
  expect(p.boss).toBe(null);
  expect(p.score >= BOSS_BONUS + 12 * 20).toBeTruthy();
  expect(g.events.some((e) => e.type === 'boss-down')).toBeTruthy();
  stepModern(g, {}, DT);
  expect(g.state).toBe('wave-clear');
  tick(g, 2.1);
  expect(p.wave).toBe(6);
  expect(g.events.some((e) => e.type === 'wave-start' && e.value === 6)).toBeTruthy();
});

it('a lost life ends boosts, pickups, dives and the chain', () => {
  const g = atWave(2),
    p = current(g);
  p.chain = 9;
  p.boosts.spread = 4;
  p.pickups = [{ x: 1, y: 1, kind: 'slow', vy: 95 }];
  found(p.ducks[50]).dive = { t: 1, tx: 0, depth: 100, side: 1 };
  hitPlayer(g);
  tick(g, 1.3);
  expect(g.state).toBe('playing');
  expect(p.chain).toBe(0);
  expect(p.boosts.spread).toBe(0);
  expect(p.pickups).toEqual([]);
  expect(p.ducks[50]?.dive).toBe(null);
});

it('Classic games never use the modern rules, even in later waves', () => {
  const g = createGame('Normal', 1, { classic: true }),
    p = current(g);
  p.wave = 4;
  MODERN.nextWave(g);
  for (const d of p.ducks) d.armor = 1;
  const d = found(p.ducks.find((d) => d.row === 4));
  p.shelters = [];
  p.shots = [bolt(d.x, d.y + 20)];
  p.boosts.spread = 5;
  advanceGame(g, {}, DT);
  expect(d.alive, 'armour means nothing to the classic rules').toBe(false);
  advanceGame(g, { fire: true }, DT);
  expect(p.shots.filter((s) => s.owner === 'ferret').length).toBe(1);
  expect(marchInterval(g) > 0).toBeTruthy();
});

it('the modern game is the same at 30, 60 and 144 Hz frames', () => {
  const states = [];
  for (const fps of [30, 60, 144]) {
    const g = atWave(2),
      clock = new FixedClock();
    let seed = 9;
    g.random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    current(g).diveTimer = 0.5;
    current(g).saucerTimer = 1;
    current(g).fire = 0;
    clock.tick(0, g, {});
    for (let i = 1; i <= fps * 6; i++)
      clock.tick((i * 1000) / fps, g, { fire: true });
    states.push(JSON.stringify(current(g)));
  }
  expect(states[0]).toBe(states[1]);
  expect(states[1]).toBe(states[2]);
});

it('dragging steers to the finger, stops close to it; auto-fire holds the trigger', () => {
  const i = new Input();
  i.steer(7, 300);
  expect(i.actionsFor(400)).toEqual({ left: true, right: false, fire: false });
  expect(i.actionsFor(200, true)).toEqual({ left: false, right: true, fire: true });
  expect(i.actionsFor(302)).toEqual({ left: false, right: false, fire: false });
  i.release(7);
  expect(i.actionsFor(400)).toEqual({ left: false, right: false, fire: false });
  i.steer(8, 100);
  i.clear();
  expect(i.drag).toBe(null);
});

it('settings persist, reject malformed values and fall back to defaults', () => {
  const { db, store: storage } = memoryStore();
  const a = new Settings(storage);
  expect(a.values).toEqual(DEFAULT_SETTINGS);
  a.set('rules', 'classic');
  a.set('music', 0.2);
  expect(() => a.set('music', 3)).toThrow(/invalid setting music/);
  expect(new Settings(storage).values).toEqual({
    ...DEFAULT_SETTINGS,
    rules: 'classic',
    music: 0.2,
  });
  db.set(SETTINGS_KEY, JSON.stringify({ rules: 'arcade', effects: -1, autofire: 'yes' }));
  expect(new Settings(storage).values).toEqual(DEFAULT_SETTINGS);
  db.set(SETTINGS_KEY, '{');
  expect(new Settings(storage).values).toEqual(DEFAULT_SETTINGS);
  expect(new Scores(storage, SCORE_KEYS.modern).record('Hard', 10)).toBe(true);
  expect(new Scores(storage, SCORE_KEYS.classic).values.Hard, 'modern bests never touch the classic table').toBe(0);
});

it('the info menu pauses a running game and resumes it on close', () => {
  const g = createGame(),
    menu = new InfoMenu();
  expect(menu.show(g)).toBe(true);
  expect(g.state).toBe('paused');
  expect(menu.show(g), 'opening twice changes nothing').toBe(false);
  tick(g, 1, { right: true });
  expect(current(g).x, 'the field stands still behind the menu').toBe(400);
  expect(menu.hide(g)).toBe(true);
  expect(g.state).toBe('playing');
  expect(menu.hide(g)).toBe(false);
});

it('the info menu opened from the pause screen returns to the pause screen', () => {
  const g = createGame(),
    menu = new InfoMenu();
  pause(g);
  menu.show(g);
  menu.hide(g);
  expect(g.state).toBe('paused');
  const over = createGame();
  over.state = 'game-over';
  menu.show(over);
  menu.hide(over);
  expect(over.state).toBe('game-over');
  expect(menu.show(null), 'the start screen has no game to pause').toBe(true);
  expect(menu.hide(null)).toBe(true);
});

it('the field keeps the original logical size whatever the screen', () => {
  expect([WIDTH, HEIGHT, DEFENSE]).toEqual([original.WIDTH, original.HEIGHT, original.DEFENSE]);
  expect([WIDTH, HEIGHT]).toEqual([800, 680]);
});
});

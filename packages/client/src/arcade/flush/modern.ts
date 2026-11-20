/**
 * Ferret Flush's modern rules (the reference's src/modern.js): the classic rules with a few hooks
 * replaced. Round one plays exactly as the original; from round two a streak of hits multiplies
 * the points, a rare golden bird turns up, a round without a wasted shell earns a bonus and every
 * second round ends with a decoy line; from round three the wind blows and the ducks fly in
 * patterns. Nothing here draws.
 */
import { TAU, clamp } from './kit.js';
import {
  CLASSIC,
  CLAY_HIT_R,
  CLEARED_TIME,
  FIELD,
  W,
  multiplier,
  setPhase,
  startRound,
  type Bird,
  type Decoy,
  type Duck,
  type FlushEvent,
  type Game,
  type Input,
  type ModernRecord,
  type Rules,
} from './rules.js';

/** The first round with modern layers, and the first with wind and flight patterns. */
export const MODERN_FROM = 2;
export const WIND_FROM = 3;
/** The look of a golden bird: a fourth look after the three ducks. */
export const GOLDEN = 3;
export const GOLDEN_FACTOR = 10;
export const GOLDEN_CHANCE = 0.07;
export const GOLDEN_SPEED = 1.15;
/** Hits in a row for double and for triple points. */
export const STREAK_STEPS: readonly number[] = [4, 8];
export const SURE_SHOT_BONUS = 500;
/** Units a tap adds to the hit circle of a duck and of a disc, when touch aim is on. */
export const TOUCH_REACH = { duck: 14, clay: 10 } as const;
export const PATTERNS: readonly string[] = ['glide', 'weave', 'dart'];
/** From round two a far disc keeps a hit circle of at least this many units (Classic: 18). */
export const CLAY_FLOOR = 32;

export const DECOY = {
  intro: 1.4,
  outro: 1.8,
  count: 12,
  every: 0.5,
  radius: 42,
  points: 50,
  allBonus: 500,
  rails: [205, 330],
} as const;

/** How many times the streak multiplies the points of a hit. */
export function streakFactor(streak: number): number {
  return 1 + STREAK_STEPS.filter((step) => streak >= step).length;
}

/** The decoy line follows every second round, from round two. */
export function bonusAfter(round: number): boolean {
  return round >= MODERN_FROM && round % 2 === 0;
}

/** Pixels per second across the field: none before round three, then a breeze that grows. */
export function windFor(round: number, roll: number): number {
  if (round < WIND_FROM) return 0;
  const strength = Math.min(45, 14 + 6 * (round - WIND_FROM));
  return roll < 0.5 ? -strength : strength;
}

export function decoySpeed(round: number): number {
  return Math.min(460, 270 + 14 * round);
}

const on = (game: Game): boolean => game.round >= MODERN_FROM;

/** The record of the modern rules; a game under them always has one (`start`). */
export function recordOf(game: Game): ModernRecord {
  if (!game.modern) throw new Error('ferret flush: a modern game without its record');
  return game.modern;
}

function freshRecord(): ModernRecord {
  return {
    streak: 0,
    bestStreak: 0,
    golden: 0,
    goldenThisRound: false,
    misses: 0,
    sureShots: 0,
    wind: 0,
    bonusPoints: 0,
    decoys: [],
    decoyHits: 0,
    lineOver: null,
  };
}

function gilded(game: Game, bird: Bird): void {
  const record = recordOf(game);
  if (record.goldenThisRound || game.rng() >= GOLDEN_CHANCE) return;
  record.goldenThisRound = true;
  bird.look = GOLDEN;
  if (bird.type === 'duck') bird.speed = (bird.speed ?? 0) * GOLDEN_SPEED;
}

function spawn(game: Game, bird: Bird): Bird {
  if (!on(game)) return bird;
  gilded(game, bird);
  const { wind } = recordOf(game);
  if (bird.type === 'clay') {
    const drift = wind * (bird.life ?? 0) * 0.6;
    bird.x1 = clamp((bird.x1 ?? 0) + drift, FIELD.left + 40, FIELD.right - 40);
  } else if (game.round >= WIND_FROM) {
    bird.pattern = PATTERNS[Math.floor(game.rng() * PATTERNS.length)] ?? 'glide';
    bird.cruise = bird.speed ?? 0;
    bird.beat = game.rng() * TAU;
  }
  return bird;
}

/** Weavers wiggle as they go, darters fly in bursts, gliders fly as before; all feel the wind. */
function fly(game: Game, duck: Duck, dt: number): void {
  duck.x += recordOf(game).wind * dt;
  const swing = duck.age * 7 + (duck.beat ?? 0);
  if (duck.pattern === 'weave') duck.heading += Math.cos(swing) * 2.4 * dt;
  if (duck.pattern === 'dart') {
    duck.speed = (duck.cruise ?? 0) * (1 + 0.5 * Math.max(0, Math.sin(swing * 0.4)) ** 3);
  }
}

/** A tap reaches a little further; from round two a far disc is not quite so small. */
function reach(game: Game, bird: Bird, touch: boolean): number {
  const tap = touch ? TOUCH_REACH[bird.type] : 0;
  if (bird.type !== 'clay' || !on(game)) return tap;
  return tap + Math.max(0, CLAY_FLOOR - Math.max(18, CLAY_HIT_R * (bird.scale ?? 1)));
}

function round(game: Game): void {
  const record = recordOf(game);
  record.misses = 0;
  record.goldenThisRound = false;
  record.decoys = [];
  record.wind = game.round >= WIND_FROM ? windFor(game.round, game.rng()) : 0;
  if (record.wind) game.events.push({ type: 'wind', wind: record.wind });
}

function scoreHit(game: Game, event: FlushEvent): void {
  const record = recordOf(game);
  record.streak++;
  record.bestStreak = Math.max(record.bestStreak, record.streak);
  const factor = streakFactor(record.streak);
  const golden = event.look === GOLDEN;
  const value = event.value ?? 0;
  const total = value * factor * (golden ? GOLDEN_FACTOR : 1);
  game.score += total - value;
  Object.assign(event, { value: total, streak: factor });
  const { x, y } = event;
  const rose = factor > streakFactor(record.streak - 1);
  if (rose) game.events.push({ type: 'streak', factor, x, y });
  if (golden) {
    record.golden++;
    game.events.push({ type: 'golden', x, y });
  }
}

function broken(game: Game): void {
  const record = recordOf(game);
  if (record.streak >= (STREAK_STEPS[0] ?? 4)) game.events.push({ type: 'streak-lost' });
  record.streak = 0;
}

function sureShot(game: Game): void {
  const record = recordOf(game);
  if (record.misses > 0) return;
  const bonus = SURE_SHOT_BONUS * multiplier(game.round);
  record.sureShots++;
  game.score += bonus;
  game.events.push({ type: 'sure-shot', bonus });
}

const NOTES: Readonly<Record<string, (game: Game, event: FlushEvent) => void>> = {
  hit: scoreHit,
  miss(game) {
    recordOf(game).misses++;
    broken(game);
  },
  away: broken,
  lost: broken,
  cleared: sureShot,
};

function after(game: Game, from: number): void {
  if (!on(game)) return;
  const end = game.events.length;
  for (let i = from; i < end; i++) {
    const event = game.events[i];
    if (event && Object.hasOwn(NOTES, event.type)) NOTES[event.type]?.(game, event);
  }
}

/** The decoys of a line: half go left to right on the high rail, half the other way below. */
function lineUp(round: number): Decoy[] {
  const speed = decoySpeed(round);
  return Array.from({ length: DECOY.count }, (_, i) => {
    const rail = i % 2;
    const dir = rail ? -1 : 1;
    return {
      id: i,
      rail,
      dir,
      at: DECOY.intro + i * DECOY.every,
      vx: dir * speed,
      x: dir > 0 ? -60 : W + 60,
      y: DECOY.rails[rail] ?? 205,
      state: 'waiting' as const,
      downAt: 0,
    };
  });
}

/** Where a decoy is at the clock of the bonus stage. */
export function decoyAt(
  decoy: Pick<Decoy, 'at' | 'dir' | 'vx' | 'rail' | 'id'>,
  clock: number,
): { x: number; y: number } {
  const run = clock - decoy.at;
  const x = (decoy.dir > 0 ? -60 : W + 60) + decoy.vx * Math.max(0, run);
  return { x, y: (DECOY.rails[decoy.rail] ?? 205) + Math.sin(run * 5 + decoy.id) * 6 };
}

/** One decoy on its rope at the clock of the bonus stage: up when its time comes, gone past the edge. */
function moveDecoy(decoy: Decoy, clock: number): void {
  Object.assign(decoy, decoyAt(decoy, clock));
  if (decoy.state === 'waiting' && clock >= decoy.at) decoy.state = 'up';
  const out = decoy.dir > 0 ? decoy.x > W + 60 : decoy.x < -60;
  if (decoy.state === 'up' && out) decoy.state = 'gone';
}

function moveDecoys(game: Game): void {
  for (const decoy of recordOf(game).decoys) {
    if (decoy.state !== 'down' && decoy.state !== 'gone') moveDecoy(decoy, game.phaseTime);
  }
}

function decoyHit(game: Game, input: Input): Decoy | null {
  const touch = input.touch === true ? TOUCH_REACH.duck : 0;
  let nearest: Decoy | null = null;
  let least = DECOY.radius + touch;
  for (const decoy of recordOf(game).decoys) {
    const distance = Math.hypot(decoy.x - input.x, decoy.y - input.y);
    if (decoy.state === 'up' && distance <= least) {
      nearest = decoy;
      least = distance;
    }
  }
  return nearest;
}

/** In the decoy line the shells do not run out: every shot is one more chance. */
function shootDecoy(game: Game, input: Input): void {
  const { x, y } = input;
  game.events.push({ type: 'bonus-shot', x, y });
  const decoy = decoyHit(game, input);
  if (!decoy) {
    game.events.push({ type: 'bonus-miss', x, y });
    return;
  }
  const record = recordOf(game);
  const value = DECOY.points * multiplier(game.round);
  decoy.state = 'down';
  decoy.downAt = game.phaseTime;
  record.decoyHits++;
  record.bonusPoints += value;
  game.score += value;
  game.events.push({ type: 'decoy', x: decoy.x, y: decoy.y, value });
}

function finishLine(game: Game): void {
  const record = recordOf(game);
  const decoys = record.decoys;
  const hits = decoys.filter((decoy) => decoy.state === 'down').length;
  const all = hits === decoys.length;
  const bonus = all ? DECOY.allBonus * multiplier(game.round) : 0;
  game.score += bonus;
  record.bonusPoints += bonus;
  record.lineOver = game.phaseTime;
  game.events.push({ type: 'bonus-end', hits, count: decoys.length, bonus });
}

const busy = (decoy: Decoy): boolean => decoy.state === 'up' || decoy.state === 'waiting';

function bonus(game: Game, _dt: number, input: Input): void {
  const record = recordOf(game);
  if (record.lineOver === null) {
    moveDecoys(game);
    if (input.fire && game.phaseTime >= DECOY.intro) shootDecoy(game, input);
    if (!record.decoys.some(busy)) finishLine(game);
  } else if (game.phaseTime >= record.lineOver + DECOY.outro) startRound(game);
}

function startBonus(game: Game): void {
  setPhase(game, 'bonus');
  const record = recordOf(game);
  record.decoys = lineUp(game.round);
  record.lineOver = null;
  game.events.push({ type: 'bonus', count: DECOY.count });
}

/** After the banner of a passed round: the decoy line when one is due, else the next round. */
function cleared(game: Game): void {
  if (game.phaseTime < CLEARED_TIME) return;
  if (bonusAfter(game.round)) startBonus(game);
  else startRound(game);
}

export const MODERN: Readonly<Rules> = {
  ...CLASSIC,
  name: 'modern',
  phases: { ...CLASSIC.phases, cleared, bonus },
  start(game) {
    game.modern = freshRecord();
  },
  round,
  spawn,
  fly,
  reach,
  after,
};

/** The hit rate of a game in whole percent: hits for shells fired, or nothing yet. */
export function hitRate(stats: { shots: number; hits: number }): number {
  return stats.shots ? Math.round((100 * stats.hits) / stats.shots) : 0;
}

/** Where a decoy that was shot is in its fall: 0 upright, 1 flat on its back. */
export function decoyFall(decoy: Decoy, clock: number): number {
  return decoy.state === 'down' ? clamp((clock - decoy.downAt) / 0.35, 0, 1) : 0;
}

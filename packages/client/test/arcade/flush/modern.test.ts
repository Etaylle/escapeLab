// The modern rules, tested without a browser: streaks, golden birds, the sure-shot bonus, the decoy
// line, wind and flight patterns, the touch aim and how far a casual player gets.
import { expect, it as test } from 'vitest';
import { seeded } from '../../../src/arcade/flush/kit.js';
import {
  CLASSIC, DUCK_HIT_R, FIELD, ROUND_TARGETS, SHELLS, W, createGame, hitCount, startRound,
  update, type Game, type Input, type Mode, type Rules
} from '../../../src/arcade/flush/rules.js';
import {
  DECOY, GOLDEN, GOLDEN_FACTOR, MODERN, PATTERNS, SURE_SHOT_BONUS, TOUCH_REACH, bonusAfter,
  decoyAt, hitRate, streakFactor, windFor
} from '../../../src/arcade/flush/modern.js';

const FRAME = 1 / 120;
const IDLE: Input = { x: 0, y: 0, fire: false, choose: null };

function found<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('expected a value, found none');
  return value;
}

/** The record of the modern rules, there in every game this file plays. */
const modern = (game: Game): NonNullable<Game['modern']> => found(game.modern);
const last = (game: Game): Game['events'][number] => found(game.events.at(-1));

interface Setup {
  mode?: Mode;
  round?: number;
  rng?: () => number;
  rules?: Rules;
}

/** A modern game of `mode`, moved on to `round` with a fresh tracker. */
function modernGame({ mode = 'single', round = 1, rng = () => 0.5, rules = MODERN }: Setup = {}): Game {
  const game = createGame({ rng, rules });
  update(game, FRAME, { ...IDLE, choose: mode });
  if (round > 1) {
    game.round = round - 1;
    startRound(game);
  }
  return game;
}

function runUntil(game: Game, done: (game: Game) => boolean, seconds = 40): void {
  for (let t = 0; t < seconds; t += FRAME) {
    if (done(game)) return;
    update(game, FRAME, IDLE);
  }
  throw new Error(`never got there: ${game.screen} ${game.phase} round ${game.round}`);
}

const toFlight = (game: Game): void => runUntil(game, (g) => g.phase === 'flight');
const fireAt = (game: Game, x: number, y: number, touch = false): void =>
  update(game, FRAME, { x, y, fire: true, choose: null, touch });
const types = (game: Game): string[] => game.events.map((event) => event.type);

/** Plays a round, downing every target dead centre until `wanted` are hit, then missing. */
function playRound(game: Game, wanted: number): void {
  for (let wave = 0; wave * (game.mode === 'single' ? 1 : 2) < ROUND_TARGETS; wave++) {
    toFlight(game);
    for (const bird of [...game.birds]) {
      runUntil(game, () => bird.state !== 'waiting');
      if (hitCount(game) < wanted) fireAt(game, bird.x, bird.y);
    }
    if (hitCount(game) >= wanted) for (let i = 0; i < SHELLS; i++) fireAt(game, 0, 0);
    runUntil(game, (g) => !['flight', 'settle', 'retrieve'].includes(g.phase));
  }
}

test('a streak doubles the points from the fourth hit in a row and triples from the eighth', () => {
  expect([0, 1, 3, 4, 7, 8, 30].map(streakFactor)).toEqual([1, 1, 1, 2, 2, 3, 3]);
  const game = modernGame({ round: 2 });
  playRound(game, 5);
  expect(modern(game).bestStreak).toBe(5);
  expect(game.score).toBe(3 * 100 + 2 * 200);
  expect(types(game).includes('streak')).toBeTruthy();
  expect(modern(game).streak, 'a miss ends the streak').toBe(0);
});

test('round one keeps the classic points however long the streak', () => {
  const game = modernGame();
  playRound(game, 10);
  runUntil(game, (g) => g.phase === 'cleared');
  expect(game.score).toBe(10 * 100 + 1000);
  expect(modern(game).bestStreak).toBe(0);
});

test('a golden duck is rare, faster, worth ten times as much and held up by the ferret', () => {
  const roll = (value: number) => (): number => value;
  const plain = modernGame({ round: 2, rng: roll(0.5) });
  toFlight(plain);
  expect(found(plain.birds[0]).look).toBe(undefined);
  const game = modernGame({ round: 2, rng: roll(0.01) });
  toFlight(game);
  const duck = found(game.birds[0]);
  expect(duck.look).toBe(GOLDEN);
  expect(found(duck.speed) > found(found(plain.birds[0]).speed)).toBeTruthy();
  fireAt(game, duck.x, duck.y);
  expect(last(game).type).toBe('golden');
  expect(game.score, 'a low roll also makes it a ruddy duck').toBe(250 * GOLDEN_FACTOR);
  runUntil(game, (g) => g.phase === 'retrieve');
  expect(game.ferret.catch).toEqual([GOLDEN]);
  runUntil(game, (g) => g.phase === 'flight');
  expect(found(game.birds[0]).look, 'one golden bird per round at most').toBe(undefined);
});

test('a round without a wasted shell earns the sure-shot bonus, from round two', () => {
  const game = modernGame({ round: 3 });
  for (let wave = 0; wave < ROUND_TARGETS; wave++) {
    toFlight(game);
    const duck = found(game.birds[0]);
    if (wave < 7) fireAt(game, duck.x, duck.y);
    runUntil(game, (g) => !['flight', 'settle', 'retrieve'].includes(g.phase));
  }
  runUntil(game, (g) => g.phase === 'cleared');
  expect(last(game).type).toBe('sure-shot');
  expect(last(game).bonus).toBe(SURE_SHOT_BONUS);
  expect(modern(game).sureShots).toBe(1);
  const wasteful = modernGame({ round: 3 });
  playRound(wasteful, 7);
  runUntil(wasteful, (g) => g.phase === 'cleared');
  expect(!types(wasteful).includes('sure-shot')).toBeTruthy();
});

test('the decoy line follows rounds two, four and six, with shells that never run out', () => {
  expect([1, 2, 3, 4, 5, 6].map(bonusAfter)).toEqual([false, true, false, true, false, true]);
  const game = modernGame({ round: 2 });
  playRound(game, 6);
  runUntil(game, (g) => g.phase === 'bonus');
  expect(modern(game).decoys.length).toBe(DECOY.count);
  runUntil(game, (g) => modern(g).decoys.some((decoy) => decoy.state === 'up'));
  for (let shot = 0; shot < 8; shot++) {
    const decoy = found(modern(game).decoys.find((item) => item.state === 'up'));
    fireAt(game, decoy.x, decoy.y);
    runUntil(game, (g) => modern(g).decoys.some((item) => item.state === 'up'));
  }
  expect(modern(game).decoyHits).toBe(8);
  expect(modern(game).bonusPoints).toBe(8 * DECOY.points);
  runUntil(game, (g) => g.round === 3);
  expect(types(game).includes('bonus-end')).toBeTruthy();
  expect(game.phase).toBe('intro');
});

test('a decoy line hit in full earns its bonus, and round one or three has none', () => {
  const game = modernGame({ round: 4 });
  playRound(game, 6);
  runUntil(game, (g) => g.phase === 'bonus');
  while (game.phase === 'bonus' && game.round === 4) {
    const decoy = modern(game).decoys.find((item) => item.state === 'up');
    if (decoy) fireAt(game, decoy.x, decoy.y);
    else update(game, FRAME, IDLE);
  }
  expect(modern(game).decoyHits).toBe(DECOY.count);
  const end = game.events.find((event) => event.type === 'bonus-end');
  expect(found(end).bonus).toBe(DECOY.allBonus);
  for (const round of [1, 3]) {
    const other = modernGame({ round });
    playRound(other, 6);
    runUntil(other, (g) => g.round === round + 1);
    expect(!types(other).includes('bonus')).toBeTruthy();
  }
});

test('a decoy left alone stays up until it is 60 past the edge it rides to, either way', () => {
  const game = modernGame({ round: 2 });
  playRound(game, 6);
  runUntil(game, (g) => g.phase === 'bonus');
  const seen = new Set<number>();
  while (game.phase === 'bonus' && game.round === 2) {
    update(game, FRAME, IDLE);
    for (const decoy of modern(game).decoys) {
      const past = decoy.dir > 0 ? decoy.x - (W + 60) : -60 - decoy.x;
      if (decoy.state === 'up') expect(past).toBeLessThanOrEqual(0);
      if (decoy.state === 'gone') seen.add(decoy.dir);
      if (decoy.state === 'gone') expect(past).toBeGreaterThan(0);
    }
  }
  expect([...seen].sort()).toEqual([-1, 1]);
});

test('a decoy rides its rail across the whole field', () => {
  const decoy = { id: 0, rail: 0, dir: 1, at: 2, vx: 300 };
  expect(decoyAt(decoy, 1).x).toBe(-60);
  expect(decoyAt(decoy, 3).x).toBe(240);
  expect(Math.abs(decoyAt(decoy, 3).y - DECOY.rails[0]) <= 6).toBeTruthy();
});

test('wind blows from round three on and grows, and ducks fly in patterns', () => {
  expect([1, 2].map((round) => windFor(round, 0.9))).toEqual([0, 0]);
  expect(windFor(3, 0.9) > 0 && windFor(3, 0.1) < 0).toBeTruthy();
  expect(windFor(8, 0.9) > windFor(3, 0.9)).toBeTruthy();
  expect(windFor(40, 0.9)).toBe(windFor(90, 0.9));
  const calm = modernGame({ round: 2, rng: seeded(3) });
  expect(modern(calm).wind).toBe(0);
  const seen = new Set();
  for (let seed = 1; seed < 12; seed++) {
    const game = modernGame({ round: 3, rng: seeded(seed) });
    expect(modern(game).wind).not.toBe(0);
    toFlight(game);
    seen.add(found(game.birds[0]).pattern);
  }
  expect([...seen].sort()).toEqual([...PATTERNS].sort());
});

test('ducks in the wind and in patterns still stay in the field', () => {
  const game = modernGame({ mode: 'pair', round: 12, rng: seeded(9) });
  toFlight(game);
  const slack = 600 * FRAME + 60 * FRAME + 1;
  for (let t = 0; t < 6; t += FRAME) {
    update(game, FRAME, IDLE);
    for (const duck of game.birds.filter((bird) => bird.state === 'flying')) {
      expect(duck.x > FIELD.left - slack && duck.x < FIELD.right + slack, `x ${duck.x}`).toBeTruthy();
      expect(duck.y > FIELD.top - slack && duck.y < FIELD.bottom + slack, `y ${duck.y}`).toBeTruthy();
    }
  }
});

test('a tap reaches a little further in the modern rules only', () => {
  const shotFrom = (rules: Rules, touch: boolean): string | undefined => {
    const game = modernGame({ rules });
    toFlight(game);
    const duck = found(game.birds[0]);
    fireAt(game, duck.x + DUCK_HIT_R + TOUCH_REACH.duck - 2, duck.y, touch);
    return game.tracker[0];
  };
  expect(shotFrom(MODERN, true)).toBe('hit');
  expect(shotFrom(MODERN, false)).toBe('live');
  expect(shotFrom(CLASSIC, true)).toBe('live');
});

test('the hit rate is counted in whole percent', () => {
  expect(hitRate({ shots: 0, hits: 0 })).toBe(0);
  expect(hitRate({ shots: 3, hits: 2 })).toBe(67);
});

/** A casual player: slow to react, aims where the target was a moment ago, and not precisely. */
type Seen = [number, number][];

function casualInput(game: Game, dice: () => number, memory: Seen[]): Input {
  if (game.screen !== 'playing') return IDLE;
  if (game.phase === 'bonus') {
    const decoy = modern(game).decoys.find((item) => item.state === 'up');
    const fire = decoy !== undefined && dice() < 0.03;
    return fire ? { x: decoy.x + (dice() - 0.5) * 80, y: decoy.y, fire, choose: null } : IDLE;
  }
  const targets = game.birds.filter((bird) => bird.state === 'flying' || bird.state === 'rising');
  memory.push(targets.map((bird): [number, number] => [bird.x, bird.y]));
  const seen = memory.length > 8 ? memory.shift() : null;
  if (!seen?.length || game.phaseTime < 0.6 || dice() > 0.025) return IDLE;
  const [x, y] = found(seen[Math.floor(dice() * seen.length)]);
  const spread = () => (dice() + dice() - 1) * 55;
  return { x: x + spread(), y: y + spread(), fire: true, choose: null };
}

test('a casual player who passes round one reaches round three in every kind of game', () => {
  for (const mode of ['single', 'pair', 'clay'] as const) {
    const reached: number[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      const game = modernGame({ mode, rng: seeded(seed) });
      const dice = seeded(seed + 50);
      const memory: Seen[] = [];
      for (let t = 0; t < 400 && game.screen === 'playing' && game.round < 3; t += FRAME) {
        update(game, FRAME, casualInput(game, dice, memory));
      }
      reached.push(game.round);
    }
    const passed = reached.filter((round) => round >= 2);
    const third = reached.filter((round) => round >= 3);
    expect(passed.length >= 14, `${mode}: round one, as in the original, passed ${passed}`).toBeTruthy();
    expect(third.length >= passed.length - 1, `${mode}: rounds reached ${reached}`).toBeTruthy();
  }
});

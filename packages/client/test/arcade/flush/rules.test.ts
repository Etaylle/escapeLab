// The rules of the game, tested without a browser. A fixed random source makes every run the same.
import { expect, it as test } from 'vitest';
import { seeded } from '../../../src/arcade/flush/kit.js';
import {
  W, FIELD, REED_LINE, SHELLS, ROUND_TARGETS, MODES, KINDS, PERFECT_BONUS, SPECTATOR_X,
  createGame, update, introPlan, quotaFor, multiplier, pointsFor, duckSpeed, flightTime,
  clayTime, hitCount, type Game, type Input, type Mode
} from '../../../src/arcade/flush/rules.js';

const FRAME = 1 / 60;
const IDLE: Input = { x: 0, y: 0, fire: false, choose: null };

function found<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('expected a value, found none');
  return value;
}

const last = (game: Game): Game['events'][number] => found(game.events.at(-1));

function newGame(mode: Mode = 'single', rng = (): number => 0.5): Game {
  const game = createGame({ rng });
  update(game, FRAME, { ...IDLE, choose: mode });
  return game;
}

function run(game: Game, seconds: number): void {
  for (let t = 0; t < seconds; t += FRAME) update(game, FRAME, IDLE);
}

/** Runs frames until `done` is true; fails when it never is. */
function runUntil(game: Game, done: (game: Game) => boolean, seconds = 30): void {
  for (let t = 0; t < seconds; t += FRAME) {
    if (done(game)) return;
    update(game, FRAME, IDLE);
  }
  throw new Error('the game never got there');
}

function toFlight(game: Game): void {
  runUntil(game, (g) => g.phase === 'flight');
}

function fireAt(game: Game, x: number, y: number): void {
  update(game, FRAME, { x, y, fire: true, choose: null });
}

function types(game: Game): string[] {
  return game.events.map((event) => event.type);
}

function count(game: Game, type: string): number {
  return types(game).filter((name) => name === type).length;
}

/** Shoots every target of the flush, dead centre. */
function downAll(game: Game): void {
  for (const bird of [...game.birds]) {
    runUntil(game, () => bird.state !== 'waiting');
    fireAt(game, bird.x, bird.y);
  }
}

/** Plays the ten targets of a round and hits the first `wanted` of them. */
function playRound(game: Game, wanted: number): void {
  const waves = ROUND_TARGETS / MODES[game.mode].perWave;
  for (let wave = 0; wave < waves; wave++) {
    toFlight(game);
    if (hitCount(game) < wanted) downAll(game);
    else for (let i = 0; i < SHELLS; i++) fireAt(game, 0, 0);
    runUntil(game, (g) => !['flight', 'settle', 'retrieve'].includes(g.phase));
  }
}

test('the game waits on the first screen until one of the three games is chosen', () => {
  const game = createGame();
  update(game, FRAME, IDLE);
  update(game, FRAME, { ...IDLE, fire: true, choose: 'nonsense' });
  expect(game.screen).toBe('title');
  update(game, FRAME, { ...IDLE, choose: 'pair' });
  expect(game.screen).toBe('playing');
  expect(game.mode).toBe('pair');
  expect(game.round).toBe(1);
  expect(game.tracker).toEqual(Array(ROUND_TARGETS).fill('wait'));
});

test('round one opens with the long entrance of the ferret, later rounds with a short one', () => {
  expect(introPlan(1).sniff > 0).toBeTruthy();
  expect(introPlan(2).sniff).toBe(0);
  expect(introPlan(2).total < introPlan(1).total).toBeTruthy();
  const game = newGame();
  run(game, introPlan(1).total - 0.1);
  expect(game.phase).toBe('intro');
  expect(types(game)).toEqual(['start', 'round', 'sniff', 'alert', 'pounce']);
  run(game, 0.2);
  expect(game.phase).toBe('flight');
  expect(types(game).slice(-2)).toEqual(['flush', 'launch']);
});

test('a flush gives three shells and one duck, or two in the game of pairs', () => {
  const single = newGame('single');
  toFlight(single);
  expect(single.shells).toBe(SHELLS);
  expect(single.birds.length).toBe(1);
  expect(found(single.birds[0]).y).toBe(REED_LINE);
  expect(single.tracker.slice(0, 2)).toEqual(['live', 'wait']);
  const pair = newGame('pair');
  toFlight(pair);
  expect(pair.shells).toBe(SHELLS);
  expect(pair.birds.length).toBe(2);
  expect(found(pair.birds[0]).facing).not.toBe(found(pair.birds[1]).facing);
  expect(pair.tracker.slice(0, 3)).toEqual(['live', 'live', 'wait']);
});

test('every shot uses a shell and the fourth pull only clicks', () => {
  const game = newGame();
  toFlight(game);
  for (let i = 0; i < SHELLS; i++) fireAt(game, 0, 0);
  expect(game.shells).toBe(0);
  expect(count(game, 'shot')).toBe(3);
  expect(count(game, 'miss')).toBe(3);
  fireAt(game, 0, 0);
  expect(count(game, 'shot')).toBe(3);
  expect(count(game, 'dry')).toBe(1);
  expect(game.stats.shots).toBe(3);
});

test('a click while the ferret is still on its way uses no shell', () => {
  const game = newGame();
  fireAt(game, 640, 300);
  expect(game.phase).toBe('intro');
  expect(game.shells).toBe(SHELLS);
  expect(count(game, 'shot')).toBe(0);
});

test('a shot inside the hit circle brings the duck down and scores it', () => {
  const game = newGame();
  toFlight(game);
  const duck = found(game.birds[0]);
  fireAt(game, duck.x + 20, duck.y - 20);
  expect(duck.state).toBe('falling');
  expect(game.score).toBe(found(KINDS[found(duck.kind)]).points);
  expect(game.tracker[0]).toBe('hit');
  expect(game.shells).toBe(SHELLS - 1);
  expect(game.stats).toEqual({ shots: 1, hits: 1 });
  expect(last(game).type).toBe('hit');
  expect(last(game).value).toBe(100);
});

test('a shot outside the hit circle misses', () => {
  const game = newGame();
  toFlight(game);
  const duck = found(game.birds[0]);
  fireAt(game, duck.x + 60, duck.y);
  expect(duck.state).toBe('rising');
  expect(game.score).toBe(0);
  expect(last(game).type).toBe('miss');
});

test('the duck falls into the reeds and the ferret comes up with it', () => {
  const game = newGame();
  toFlight(game);
  run(game, 1.5);
  const duck = found(game.birds[0]);
  fireAt(game, duck.x, duck.y);
  const fellFrom = duck.x;
  runUntil(game, (g) => g.phase === 'retrieve');
  expect(types(game).includes('landed')).toBeTruthy();
  expect(game.ferret.mood).toBe('proud');
  expect(game.ferret.catch).toEqual([duck.kind]);
  expect(Math.abs(game.ferret.popX - fellFrom) < 120).toBeTruthy();
  expect(game.birds.length).toBe(0);
});

test('a duck leaves when the shells are gone, and the ferret flops', () => {
  const game = newGame();
  toFlight(game);
  for (let i = 0; i < SHELLS; i++) fireAt(game, 0, 0);
  runUntil(game, (g) => g.phase === 'retrieve', 5);
  expect(game.tracker[0]).toBe('miss');
  expect(count(game, 'away')).toBe(1);
  expect(game.ferret.mood).toBe('flop');
  expect(game.ferret.catch).toEqual([]);
});

test('a duck leaves on its own when its time is up', () => {
  const game = newGame();
  toFlight(game);
  run(game, flightTime(1, 1) - 0.2);
  expect(game.tracker[0]).toBe('live');
  run(game, 0.4);
  expect(game.tracker[0]).toBe('miss');
  expect(game.shells).toBe(SHELLS);
  expect(game.birds[0]?.state ?? 'fleeing').toBe('fleeing');
});

test('ducks stay in the field while they fly, however fast', () => {
  const game = newGame('pair', seeded(7));
  toFlight(game);
  for (const duck of game.birds) duck.speed = 700;
  const slack = 700 * FRAME + 1;
  let checked = 0;
  for (let t = 0; t < 6; t += FRAME) {
    update(game, FRAME, IDLE);
    for (const duck of game.birds.filter((bird) => bird.state === 'flying')) {
      expect(duck.x > FIELD.left - slack && duck.x < FIELD.right + slack, `x ${duck.x}`).toBeTruthy();
      expect(duck.y > FIELD.top - slack && duck.y < FIELD.bottom + slack, `y ${duck.y}`).toBeTruthy();
      checked++;
    }
  }
  expect(checked > 500).toBeTruthy();
});

test('one shell brings down only the nearest of two ducks', () => {
  const game = newGame('pair');
  toFlight(game);
  const near = found(game.birds[0]);
  const far = found(game.birds[1]);
  Object.assign(near, { x: 600, y: 300 });
  Object.assign(far, { x: 624, y: 300 });
  fireAt(game, 598, 300);
  expect(near.state).toBe('falling');
  expect(far.state).not.toBe('falling');
  expect(game.shells).toBe(SHELLS - 1);
});

test('two ducks down make the ferret dance with both', () => {
  const game = newGame('pair');
  toFlight(game);
  downAll(game);
  runUntil(game, (g) => g.phase === 'retrieve');
  expect(game.ferret.mood).toBe('double');
  expect(game.ferret.catch.length).toBe(2);
  expect(game.tracker.slice(0, 2)).toEqual(['hit', 'hit']);
});

test('the pass mark rises from six of ten to ten of ten', () => {
  expect([1, 5, 6, 11, 16, 21, 60].map(quotaFor)).toEqual([6, 6, 7, 8, 9, 10, 10]);
});

test('targets are worth more every five rounds, up to four times', () => {
  expect([1, 5, 6, 11, 16, 40].map(multiplier)).toEqual([1, 1, 2, 3, 4, 4]);
  expect(pointsFor('duck', 0, 1)).toBe(100);
  expect(pointsFor('duck', 2, 6)).toBe(500);
  expect(pointsFor('clay', 0, 11)).toBe(300);
});

test('each round is faster and shorter, up to a limit', () => {
  expect(duckSpeed(2, 0) > duckSpeed(1, 0)).toBeTruthy();
  expect(duckSpeed(1, 2) > duckSpeed(1, 0)).toBeTruthy();
  expect(duckSpeed(23, 0)).toBe(duckSpeed(60, 0));
  expect(flightTime(2, 1) < flightTime(1, 1)).toBeTruthy();
  expect(flightTime(1, 2) > flightTime(1, 1)).toBeTruthy();
  expect(flightTime(40, 1)).toBe(flightTime(90, 1));
  expect(clayTime(2) < clayTime(1)).toBeTruthy();
  expect(clayTime(40)).toBe(clayTime(90));
});

test('rarer ducks come with a low roll of the dice', () => {
  const kindWith = (roll: number): number | undefined => {
    const game = newGame('single', () => roll);
    toFlight(game);
    return found(game.birds[0]).kind;
  };
  expect([0.01, 0.2, 0.5].map(kindWith)).toEqual([2, 1, 0]);
});

test('six of ten passes round one and round two begins', () => {
  const game = newGame();
  playRound(game, 6);
  expect(game.phase).toBe('tally');
  runUntil(game, (g) => g.phase === 'cleared');
  expect(count(game, 'tick')).toBe(ROUND_TARGETS);
  const cleared = last(game);
  expect([cleared.type, cleared.perfect, cleared.bonus]).toEqual(['cleared', false, 0]);
  expect(game.score).toBe(600);
  runUntil(game, (g) => g.round === 2);
  expect(game.phase).toBe('intro');
  expect(game.tracker).toEqual(Array(ROUND_TARGETS).fill('wait'));
  expect(game.score).toBe(600);
});

test('five of ten ends the game and the best score is kept', () => {
  const game = newGame();
  playRound(game, 5);
  runUntil(game, (g) => g.screen === 'over');
  expect(types(game).includes('failed')).toBeTruthy();
  expect(game.score).toBe(500);
  expect(game.best.single).toBe(500);
  expect(game.newBest).toBe(true);
  expect(game.stats).toEqual({ shots: 5 + 5 * SHELLS, hits: 5 });
});

test('ten of ten earns the bonus of a perfect round', () => {
  const game = newGame();
  playRound(game, ROUND_TARGETS);
  runUntil(game, (g) => g.phase === 'cleared');
  expect(game.tally.perfect).toBe(true);
  expect(game.score).toBe(10 * 100 + PERFECT_BONUS);
});

test('play again starts the same game anew, the menu goes back to the first screen', () => {
  const game = newGame('pair');
  playRound(game, 0);
  runUntil(game, (g) => g.screen === 'over');
  update(game, FRAME, { ...IDLE, choose: 'again' });
  expect([game.screen, game.mode, game.round, game.score]).toEqual(['playing', 'pair', 1, 0]);
  update(game, FRAME, { ...IDLE, choose: 'menu' });
  expect(game.screen).toBe('title');
  expect(game.best.pair).toBe(0);
});

test('two clay discs leave one trap, the second a moment later and the other way', () => {
  const game = newGame('clay');
  expect(game.phase).toBe('intro');
  toFlight(game);
  expect(types(game).includes('pull')).toBeTruthy();
  const first = found(game.birds[0]);
  const second = found(game.birds[1]);
  expect([first.state, second.state]).toEqual(['flying', 'waiting']);
  run(game, 0.6);
  expect(second.state).toBe('flying');
  expect(first.x0).toBe(second.x0);
  const way = (disc: typeof first): number => Math.sign(found(disc.x1) - found(disc.x0));
  expect(way(first)).toBe(-way(second));
  expect(count(game, 'launch')).toBe(2);
});

test('a disc shrinks as it flies away, and a far disc is harder to hit', () => {
  const near = newGame('clay');
  toFlight(near);
  run(near, 0.1);
  const big = found(near.birds[0]);
  fireAt(near, big.x + 30, big.y);
  expect(near.tracker[0]).toBe('hit');
  const far = newGame('clay');
  toFlight(far);
  run(far, clayTime(1) - 0.5);
  const small = found(far.birds[0]);
  expect(found(small.scale) < 0.5).toBeTruthy();
  expect(small.y < REED_LINE - 150).toBeTruthy();
  fireAt(far, small.x + 30, small.y);
  expect(far.tracker[0]).toBe('live');
  fireAt(far, small.x + 10, small.y);
  expect(far.tracker[0]).toBe('hit');
});

test('a disc that lands unbroken is lost, and the ferret watches from its corner', () => {
  const moodAfter = (shots: number): string => {
    const game = newGame('clay');
    toFlight(game);
    for (const disc of game.birds.slice(0, shots)) {
      runUntil(game, () => disc.state !== 'waiting');
      fireAt(game, disc.x, disc.y);
    }
    runUntil(game, (g) => g.phase === 'retrieve');
    expect(game.ferret.popX).toBe(SPECTATOR_X);
    expect(count(game, 'lost')).toBe(2 - shots);
    return game.ferret.mood;
  };
  expect([0, 1, 2].map(moodAfter)).toEqual(['shrug', 'nod', 'cheer']);
});

test('ten discs make a round: five flushes of two', () => {
  const game = newGame('clay');
  playRound(game, 7);
  runUntil(game, (g) => g.phase === 'cleared');
  expect(hitCount(game)).toBe(8);
  expect(game.score).toBe(800);
  expect(game.ferret.flushX > 0 && game.ferret.flushX < W).toBeTruthy();
});

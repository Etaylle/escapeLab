/**
 * The rules of Ferret Flush (the reference's src/rules.js), with no drawing and no page in them:
 * three games, rounds of ten targets, three shells per flush, a pass mark that rises, ducks and
 * clay discs that get faster, and what the ferret is busy with. `update` moves a game by `dt`
 * seconds and lists what happened in `game.events`. The hooks of the classic rules (`CLASSIC`)
 * are what the modern rules (modern.ts) replace. The original's keys and words stay as they were
 * — the Classic test compares them —; the machine's screen says them in German (texts.ts).
 */
import { angleDelta, clamp, lerp } from './kit.js';

export const W = 1280;
export const H = 720;
/** The sky the ducks fly in: they turn back at its edges. */
export const FIELD = { left: 70, right: W - 70, top: 112, bottom: 452 } as const;
/** Ducks rise from behind the bank at this height and fall back to it. */
export const REED_LINE = 640;
export const SHELLS = 3;
export const ROUND_TARGETS = 10;
export const DUCK_HIT_R = 50;
export const CLAY_HIT_R = 36;
export const CLAY_POINTS = 100;
export const PERFECT_BONUS = 1000;
/** Where the ferret watches the clay discs from. */
export const SPECTATOR_X = 150;

export type Mode = 'single' | 'pair' | 'clay';
export type Target = 'duck' | 'clay';
export const MODES: Readonly<Record<Mode, { target: Target; perWave: number }>> = {
  single: { target: 'duck', perWave: 1 },
  pair: { target: 'duck', perWave: 2 },
  clay: { target: 'clay', perWave: 2 },
};
export const isMode = (value: unknown): value is Mode =>
  typeof value === 'string' && Object.hasOwn(MODES, value);

/** The rarer the duck, the faster it flies and turns, and the more it is worth. */
export const KINDS: readonly { name: string; points: number; speed: number; turn: number }[] = [
  { name: 'mallard', points: 100, speed: 1, turn: 1 },
  { name: 'pintail', points: 150, speed: 1.12, turn: 1.3 },
  { name: 'ruddy duck', points: 250, speed: 1.25, turn: 1.7 },
];
const kindOf = (kind: number) => KINDS[kind] ?? { name: 'mallard', points: 100, speed: 1, turn: 1 };

export const CLAY_INTRO = 1.7;
export const LAUNCH_TIME = 0.7;
export const HIT_STUN = 0.24;
export type Mood = 'idle' | 'proud' | 'double' | 'flop' | 'cheer' | 'nod' | 'shrug';
/** Seconds the ferret is up after a flush, by its mood. */
export const RETRIEVE_TIME: Readonly<Record<Exclude<Mood, 'idle'>, number>> = {
  proud: 1.7,
  double: 2.1,
  flop: 2.2,
  cheer: 1,
  nod: 0.9,
  shrug: 1,
};
export const TALLY_STEP = 0.13;
export const TALLY_HOLD = 0.7;
export const CLEARED_TIME = 2.6;
export const FAILED_TIME = 2.8;

const TURN_RATE = 5.5;
const MAX_PITCH = 0.95;
const GRAVITY = 1500;
const OUT_OF_SHELLS_WAIT = 0.3;
type BirdState = 'waiting' | 'rising' | 'flying' | 'fleeing' | 'falling' | 'gone';
const IN_THE_AIR = new Set<BirdState>(['waiting', 'rising', 'flying']);
const CAN_BE_HIT = new Set<BirdState>(['rising', 'flying']);

/** A duck or a clay disc in the air; the fields of the other kind stay unset. */
export interface Bird {
  id: number;
  type: Target;
  kind: number;
  slot: number;
  state: BirdState;
  x: number;
  y: number;
  age: number;
  /** the golden look of the modern rules (modern.ts GOLDEN) */
  look?: number;
  // a duck's
  heading?: number;
  target?: number;
  turnIn?: number;
  speed?: number;
  facing?: number;
  flip?: number;
  stun?: number;
  vx?: number;
  vy?: number;
  angle?: number;
  spin?: number;
  pattern?: string;
  cruise?: number;
  beat?: number;
  // a disc's
  dir?: number;
  x0?: number;
  x1?: number;
  y1?: number;
  arc?: number;
  delay?: number;
  life?: number;
  scale?: number;
}
/** A duck as its moves see it: every duck field set. */
export type Duck = Bird & Required<Pick<Bird, 'heading' | 'target' | 'turnIn' | 'speed' | 'facing' | 'flip' | 'stun' | 'vx' | 'vy' | 'angle' | 'spin'>>;
/** A disc as its flight sees it. */
export type Clay = Bird & Required<Pick<Bird, 'dir' | 'x0' | 'x1' | 'y1' | 'arc' | 'delay' | 'life' | 'scale'>>;

/** What happened in a frame: its cue and what the cue needs, every field optional but `type`. */
export interface FlushEvent {
  type: string;
  mode?: Mode | undefined;
  round?: number | undefined;
  quota?: number | undefined;
  x?: number | undefined;
  y?: number | undefined;
  from?: number | undefined;
  to?: number | undefined;
  target?: Target | undefined;
  kind?: number | undefined;
  look?: number | undefined;
  scale?: number | undefined;
  value?: number | undefined;
  shells?: number | undefined;
  count?: number | undefined;
  mood?: Mood | undefined;
  index?: number | undefined;
  hit?: boolean | undefined;
  hits?: number | undefined;
  perfect?: boolean | undefined;
  bonus?: number | undefined;
  score?: number | undefined;
  newBest?: boolean | undefined;
  streak?: number | undefined;
  factor?: number | undefined;
  wind?: number | undefined;
}

export interface Ferret {
  side: number;
  flushX: number;
  fromX: number;
  popX: number;
  mood: Mood;
  catch: number[];
}

export interface Decoy {
  id: number;
  rail: number;
  dir: number;
  at: number;
  vx: number;
  x: number;
  y: number;
  state: 'waiting' | 'up' | 'down' | 'gone';
  downAt: number;
}

/** What the modern rules keep of a game (modern.ts); null under the classic rules. */
export interface ModernRecord {
  streak: number;
  bestStreak: number;
  golden: number;
  goldenThisRound: boolean;
  misses: number;
  sureShots: number;
  wind: number;
  bonusPoints: number;
  decoys: Decoy[];
  decoyHits: number;
  lineOver: number | null;
}

export type Screen = 'title' | 'playing' | 'over';
export type Phase =
  | 'intro'
  | 'launch'
  | 'flight'
  | 'settle'
  | 'retrieve'
  | 'tally'
  | 'cleared'
  | 'failed'
  | 'bonus';
export type Mark = 'wait' | 'live' | 'hit' | 'miss';

export interface Input {
  x: number;
  y: number;
  fire: boolean;
  choose: string | null;
  touch?: boolean;
}

export interface Game {
  rng: () => number;
  rules: Rules;
  screen: Screen;
  mode: Mode;
  phase: Phase;
  phaseTime: number;
  time: number;
  round: number;
  score: number;
  best: Record<Mode, number>;
  newBest: boolean;
  shells: number;
  wave: number;
  tracker: Mark[];
  birds: Bird[];
  caught: number[];
  nextId: number;
  flightLeft: number;
  fleeIn: number | null;
  lastX: number;
  ferret: Ferret;
  tally: { shown: number; hits: number; perfect: boolean; bonus: number };
  stats: { shots: number; hits: number };
  events: FlushEvent[];
  modern?: ModernRecord | null;
}

/** A rule book: the phases of play and the hooks the modern rules replace. */
export interface Rules {
  name: 'classic' | 'modern';
  phases: Readonly<Partial<Record<Phase, (game: Game, dt: number, input: Input) => void>>>;
  start: (game: Game) => void;
  round: (game: Game) => void;
  spawn: (game: Game, bird: Bird) => Bird;
  fly: (game: Game, duck: Duck, dt: number) => void;
  reach: (game: Game, bird: Bird, touch: boolean) => number;
  after: (game: Game, from: number) => void;
}

/** The ferret's entrance in seconds: it runs in, sniffs, stands alert and pounces. */
export function introPlan(round: number) {
  const [run, sniff, alert, pounce] = round === 1 ? [1.5, 1.2, 0.7, 0.7] : [0.9, 0, 0.4, 0.6];
  return { run, sniff, alert, pounce, total: run + sniff + alert + pounce };
}

/** How many of the ten targets a round needs: six at first, one more every five rounds. */
export function quotaFor(round: number): number {
  return clamp(6 + Math.floor((round - 1) / 5), 6, ROUND_TARGETS);
}

/** Points are worth more every five rounds, up to four times. */
export function multiplier(round: number): number {
  return clamp(1 + Math.floor((round - 1) / 5), 1, 4);
}

export function pointsFor(target: Target, kind: number, round: number): number {
  return (target === 'clay' ? CLAY_POINTS : kindOf(kind).points) * multiplier(round);
}

/** Pixels per second: every round is faster, up to round 23. */
export function duckSpeed(round: number, kind: number): number {
  return (235 + 17 * Math.min(round - 1, 22)) * kindOf(kind).speed;
}

/** Seconds before the ducks of a flush leave on their own. */
export function flightTime(round: number, perWave: number): number {
  return Math.max(3.4, 5.6 - 0.09 * (round - 1)) + (perWave - 1) * 1.6;
}

/** Seconds a clay disc stays in the air. */
export function clayTime(round: number): number {
  return Math.max(1.7, 3 - 0.065 * (round - 1));
}

/** Targets hit so far in this round. */
export function hitCount(game: Game): number {
  return game.tracker.filter((mark) => mark === 'hit').length;
}

export function createGame({
  rng = Math.random,
  best = {},
  rules = CLASSIC,
}: { rng?: () => number; best?: Partial<Record<Mode, number>>; rules?: Rules } = {}): Game {
  return {
    rng,
    rules,
    screen: 'title',
    mode: 'single',
    phase: 'intro',
    phaseTime: 0,
    time: 0,
    round: 0,
    score: 0,
    best: { single: 0, pair: 0, clay: 0, ...best },
    newBest: false,
    shells: SHELLS,
    wave: 0,
    tracker: [],
    birds: [],
    caught: [],
    nextId: 1,
    flightLeft: 0,
    fleeIn: null,
    lastX: W / 2,
    ferret: { side: 1, flushX: W / 2, fromX: W / 2, popX: W / 2, mood: 'idle', catch: [] },
    tally: { shown: 0, hits: 0, perfect: false, bonus: 0 },
    stats: { shots: 0, hits: 0 },
    events: [],
  };
}

/** A new game of one of the three kinds: score and rounds from the start. */
export function startGame(game: Game, mode: Mode): void {
  game.mode = mode;
  game.screen = 'playing';
  game.round = 0;
  game.score = 0;
  game.newBest = false;
  game.stats = { shots: 0, hits: 0 };
  game.rules.start(game);
  game.events.push({ type: 'start', mode });
  startRound(game);
}

/** One frame. `input` is where the sight is, whether it fired, and a choice made on a menu. */
export function update(game: Game, dt: number, input: Input): void {
  game.time += dt;
  if (game.screen === 'title') {
    if (isMode(input.choose)) startGame(game, input.choose);
  } else if (input.choose === 'menu') {
    game.screen = 'title';
    game.birds = [];
  } else if (game.screen === 'over') {
    if (input.choose === 'again') startGame(game, game.mode);
  } else {
    const from = game.events.length;
    game.phaseTime += dt;
    game.rules.phases[game.phase]?.(game, dt, input);
    game.rules.after(game, from);
  }
}

const clayGame = (game: Game): boolean => MODES[game.mode].target === 'clay';

export function setPhase(game: Game, phase: Phase): void {
  game.phase = phase;
  game.phaseTime = 0;
}

/** A place in the reeds for the next flush, away from the edges. */
function spot(game: Game): number {
  return lerp(260, W - 260, game.rng());
}

export function startRound(game: Game): void {
  game.round++;
  game.wave = 0;
  game.tracker = Array<Mark>(ROUND_TARGETS).fill('wait');
  game.birds = [];
  game.shells = SHELLS;
  game.tally = { shown: 0, hits: 0, perfect: false, bonus: 0 };
  game.ferret.side = game.rng() < 0.5 ? 1 : -1;
  game.ferret.flushX = spot(game);
  game.ferret.mood = 'idle';
  setPhase(game, 'intro');
  game.rules.round(game);
  game.events.push({ type: 'round', round: game.round, quota: quotaFor(game.round) });
}

/** True in the one frame in which the clock of the phase passes `at`. */
function passes(game: Game, dt: number, at: number): boolean {
  return game.phaseTime >= at && game.phaseTime - dt < at;
}

function intro(game: Game, dt: number): void {
  if (clayGame(game)) {
    if (game.phaseTime >= CLAY_INTRO) beginLaunch(game);
    return;
  }
  const plan = introPlan(game.round);
  if (plan.sniff && passes(game, dt, plan.run)) game.events.push({ type: 'sniff' });
  if (passes(game, dt, plan.run + plan.sniff)) game.events.push({ type: 'alert' });
  if (passes(game, dt, plan.total - plan.pounce)) game.events.push({ type: 'pounce' });
  if (game.phaseTime < plan.total) return;
  game.events.push({ type: 'flush', x: game.ferret.flushX });
  launchWave(game);
}

/** The pause between two flushes: the hidden ferret dashes to a new spot, or a disc is called. */
function beginLaunch(game: Game): void {
  const { ferret } = game;
  ferret.fromX = ferret.popX;
  setPhase(game, 'launch');
  if (clayGame(game)) {
    game.events.push({ type: 'pull' });
    return;
  }
  ferret.flushX = spot(game);
  game.events.push({ type: 'scurry', from: ferret.fromX, to: ferret.flushX });
}

function launch(game: Game): void {
  if (game.phaseTime >= LAUNCH_TIME) launchWave(game);
}

function launchWave(game: Game): void {
  const { target, perWave } = MODES[game.mode];
  game.shells = SHELLS;
  game.caught = [];
  game.fleeIn = null;
  game.flightLeft = flightTime(game.round, perWave);
  for (let i = 0; i < perWave; i++) {
    const slot = game.wave * perWave + i;
    game.tracker[slot] = 'live';
    const bird = target === 'clay' ? makeClay(game, slot, i) : makeDuck(game, slot, i);
    game.birds.push(game.rules.spawn(game, bird));
  }
  setPhase(game, 'flight');
  for (const bird of game.birds) if (bird.state !== 'waiting') announce(game, bird);
}

function announce(game: Game, bird: Bird): void {
  const { type: target, kind, x, y } = bird;
  game.events.push({ type: 'launch', target, kind, x, y });
}

/** Mallards are common; pintails and ruddy ducks turn up more often in later rounds. */
function pickKind(game: Game): number {
  const roll = game.rng();
  const ruddy = Math.min(0.06 + 0.02 * game.round, 0.3);
  const pintail = Math.min(0.18 + 0.03 * game.round, 0.4);
  if (roll < ruddy) return 2;
  return roll < ruddy + pintail ? 1 : 0;
}

function makeDuck(game: Game, slot: number, index: number): Duck {
  const kind = pickKind(game);
  const first = game.birds[0];
  const side = first ? -(first.facing ?? 1) : game.rng() < 0.5 ? -1 : 1;
  const heading = -Math.PI / 2 + side * (0.3 + game.rng() * 0.45);
  return {
    id: game.nextId++,
    type: 'duck',
    kind,
    slot,
    state: 'rising',
    x: clamp(game.ferret.flushX + index * side * 70, FIELD.left + 30, FIELD.right - 30),
    y: REED_LINE,
    heading,
    target: heading,
    turnIn: 0,
    speed: duckSpeed(game.round, kind),
    facing: side,
    flip: side,
    age: 0,
    stun: 0,
    vx: 0,
    vy: 0,
    angle: 0,
    spin: 0,
  };
}

/** Two discs leave one trap in opposite directions, the second a moment after the first. */
function makeClay(game: Game, slot: number, index: number): Clay {
  const first = game.birds[0];
  const x0 = first ? (first.x0 ?? 0) : lerp(W / 2 - 280, W / 2 + 280, game.rng());
  const dir = first ? -(first.dir ?? 1) : game.rng() < 0.5 ? -1 : 1;
  return {
    id: game.nextId++,
    type: 'clay',
    kind: 0,
    slot,
    state: index ? 'waiting' : 'flying',
    dir,
    x0,
    x1: clamp(x0 + dir * (140 + game.rng() * 330), FIELD.left + 40, FIELD.right - 40),
    y1: 395 + game.rng() * 30,
    arc: 290 + game.rng() * 90,
    delay: index * 0.45,
    age: 0,
    life: clayTime(game.round),
    x: x0,
    y: REED_LINE,
    scale: 1.2,
  };
}

/** A new direction: mostly onward, sometimes back, never straight up or down. */
function retarget(game: Game, duck: Duck): void {
  const onward = Math.cos(duck.heading) < 0 ? -1 : 1;
  const side = game.rng() < 0.32 ? -onward : onward;
  const pitch = (game.rng() * 2 - 1) * MAX_PITCH;
  duck.target = side > 0 ? pitch : Math.PI - pitch;
  duck.turnIn = (0.35 + game.rng() * 0.85) / kindOf(duck.kind).turn;
}

function advanceDuck(duck: Duck, dt: number): void {
  const turn = TURN_RATE * kindOf(duck.kind).turn * dt;
  duck.heading += clamp(angleDelta(duck.heading, duck.target), -turn, turn);
  duck.x += Math.cos(duck.heading) * duck.speed * dt;
  duck.y += Math.sin(duck.heading) * duck.speed * dt;
  const across = Math.cos(duck.heading);
  if (Math.abs(across) > 0.25) duck.facing = across < 0 ? -1 : 1;
  duck.flip = clamp(duck.flip + clamp(duck.facing - duck.flip, -9 * dt, 9 * dt), -1, 1);
}

const beyond = (value: number, low: number, high: number, motion: number): boolean =>
  (value < low && motion < 0) || (value > high && motion > 0);

/** A duck that reaches an edge of the field bounces off it. */
function turnBack(duck: Duck): void {
  if (beyond(duck.x, FIELD.left, FIELD.right, Math.cos(duck.heading))) {
    duck.heading = Math.PI - duck.heading;
    duck.target = Math.PI - duck.target;
  }
  const free = duck.state === 'flying';
  if (free && beyond(duck.y, FIELD.top, FIELD.bottom, Math.sin(duck.heading))) {
    duck.heading = -duck.heading;
    duck.target = -duck.target;
  }
}

const DUCK_MOVES: Partial<Record<BirdState, (game: Game, duck: Duck, dt: number) => void>> = {
  rising(_game, duck, dt) {
    advanceDuck(duck, dt);
    turnBack(duck);
    if (duck.y < FIELD.bottom - 50) duck.state = 'flying';
  },
  flying(game, duck, dt) {
    duck.turnIn -= dt;
    if (duck.turnIn <= 0) retarget(game, duck);
    advanceDuck(duck, dt);
    game.rules.fly(game, duck, dt);
    turnBack(duck);
  },
  fleeing(_game, duck, dt) {
    advanceDuck(duck, dt);
    if (duck.y < -90) duck.state = 'gone';
  },
  falling(game, duck, dt) {
    duck.stun -= dt;
    if (duck.stun > 0) return;
    duck.vy += GRAVITY * dt;
    duck.x += duck.vx * dt;
    duck.y += duck.vy * dt;
    duck.angle += duck.spin * dt;
    if (duck.y < REED_LINE) return;
    duck.state = 'gone';
    game.lastX = duck.x;
    game.events.push({ type: 'landed', x: duck.x, kind: duck.kind });
  },
};

/** A disc flies away from you: it slows on the screen and shrinks until it lands far off. */
function moveClay(game: Game, clay: Clay, dt: number): void {
  clay.age += dt;
  if (clay.state === 'waiting') {
    if (clay.age < clay.delay) return;
    clay.state = 'flying';
    clay.age = 0;
    announce(game, clay);
  }
  const away = 1 - (1 - Math.min(clay.age / clay.life, 1)) ** 1.7;
  clay.x = lerp(clay.x0, clay.x1, away);
  clay.y = lerp(REED_LINE, clay.y1, away) - clay.arc * 4 * away * (1 - away);
  clay.scale = lerp(1.2, 0.34, away);
  if (clay.age < clay.life) return;
  clay.state = 'gone';
  game.tracker[clay.slot] = 'miss';
  game.events.push({ type: 'lost', x: clay.x, y: clay.y });
}

function moveBirds(game: Game, dt: number): void {
  for (const bird of game.birds) {
    if (bird.type === 'clay') moveClay(game, bird as Clay, dt);
    else {
      bird.age += dt;
      DUCK_MOVES[bird.state]?.(game, bird as Duck, dt);
    }
  }
  game.birds = game.birds.filter((bird) => bird.state !== 'gone');
}

/** The target nearest to the shot and inside its hit circle, or null. A far disc is small. */
function targetAt(game: Game, { x, y, touch }: Input): Bird | null {
  let nearest: Bird | null = null;
  let least = Infinity;
  for (const bird of game.birds) {
    if (!CAN_BE_HIT.has(bird.state)) continue;
    const circle =
      bird.type === 'clay' ? Math.max(18, CLAY_HIT_R * (bird.scale ?? 1)) : DUCK_HIT_R;
    const reach = circle + game.rules.reach(game, bird, touch === true);
    const distance = Math.hypot(bird.x - x, bird.y - y);
    if (distance <= reach && distance < least) {
      nearest = bird;
      least = distance;
    }
  }
  return nearest;
}

function strike(game: Game, bird: Bird): void {
  const { type: target, kind, x, y } = bird;
  const look = bird.look ?? kind;
  const value = pointsFor(target, kind, game.round);
  game.score += value;
  game.stats.hits++;
  game.tracker[bird.slot] = 'hit';
  game.caught.push(look);
  game.events.push({ type: 'hit', target, kind, look, x, y, scale: bird.scale ?? 1, value });
  if (target === 'clay') {
    bird.state = 'gone';
    return;
  }
  const duck = bird as Duck;
  duck.state = 'falling';
  duck.stun = HIT_STUN;
  duck.vx = Math.cos(duck.heading) * duck.speed * 0.25;
  duck.vy = -190;
  duck.spin = duck.facing * (7 + game.rng() * 4);
}

/** One shell: it brings down at most one target. Without shells the hammer only clicks. */
function shoot(game: Game, input: Input): void {
  const { x, y } = input;
  if (game.shells === 0) {
    game.events.push({ type: 'dry' });
    return;
  }
  game.shells--;
  game.stats.shots++;
  game.events.push({ type: 'shot', x, y, shells: game.shells });
  const bird = targetAt(game, input);
  if (bird) strike(game, bird);
  else game.events.push({ type: 'miss', x, y });
  if (game.shells === 0) game.fleeIn = OUT_OF_SHELLS_WAIT;
}

/** Ducks that were not hit leave over the top: when the time is up or the shells are gone. */
function flee(game: Game, ducks: Bird[]): void {
  for (const bird of ducks) {
    const duck = bird as Duck;
    duck.state = 'fleeing';
    duck.target = -Math.PI / 2 + duck.facing * 0.3;
    duck.speed *= 1.7;
    game.tracker[duck.slot] = 'miss';
    game.lastX = duck.x;
  }
  game.events.push({ type: 'away', count: ducks.length });
}

function flight(game: Game, dt: number, input: Input): void {
  if (input.fire) shoot(game, input);
  moveBirds(game, dt);
  game.flightLeft -= dt;
  if (game.fleeIn !== null) game.fleeIn -= dt;
  const aloft = game.birds.filter((bird) => IN_THE_AIR.has(bird.state));
  if (aloft.length === 0) {
    setPhase(game, 'settle');
    return;
  }
  const spent = game.fleeIn !== null && game.fleeIn <= 0;
  if (!clayGame(game) && (spent || game.flightLeft <= 0)) flee(game, aloft);
}

const CLAY_MOODS: readonly Mood[] = ['shrug', 'nod', 'cheer'];
const DUCK_MOODS: readonly Mood[] = ['flop', 'proud', 'double'];

/** After the shooting: hit ducks fall into the reeds, the others leave the sky. */
function settle(game: Game, dt: number): void {
  moveBirds(game, dt);
  if (game.birds.length > 0) return;
  const clay = clayGame(game);
  const { ferret } = game;
  ferret.mood = (clay ? CLAY_MOODS : DUCK_MOODS)[game.caught.length] ?? 'idle';
  ferret.catch = clay ? [] : game.caught;
  ferret.popX = clay ? SPECTATOR_X : clamp(game.lastX, 190, W - 190);
  setPhase(game, 'retrieve');
  game.events.push({ type: 'popup', mood: ferret.mood, x: ferret.popX });
}

/** The ferret shows what it found, or what it thinks; then the next flush or the count. */
function retrieve(game: Game): void {
  const mood = game.ferret.mood;
  if (mood !== 'idle' && game.phaseTime < RETRIEVE_TIME[mood]) return;
  game.wave++;
  game.ferret.mood = 'idle';
  if (game.wave * MODES[game.mode].perWave < ROUND_TARGETS) beginLaunch(game);
  else setPhase(game, 'tally');
}

function judge(game: Game): void {
  const count = game.tally;
  const quota = quotaFor(game.round);
  if (count.hits < quota) {
    setPhase(game, 'failed');
    game.events.push({ type: 'failed', hits: count.hits, quota });
    return;
  }
  count.perfect = count.hits === ROUND_TARGETS;
  count.bonus = count.perfect ? PERFECT_BONUS * multiplier(game.round) : 0;
  game.score += count.bonus;
  setPhase(game, 'cleared');
  const { perfect, bonus } = count;
  game.events.push({ type: 'cleared', round: game.round, perfect, bonus });
}

/** The ten targets are counted one by one; then the round is passed or lost. */
function tally(game: Game): void {
  const count = game.tally;
  const due = Math.min(ROUND_TARGETS, Math.floor(game.phaseTime / TALLY_STEP));
  while (count.shown < due) {
    const hit = game.tracker[count.shown] === 'hit';
    if (hit) count.hits++;
    game.events.push({ type: 'tick', index: count.shown, hit, hits: count.hits });
    count.shown++;
  }
  if (game.phaseTime < ROUND_TARGETS * TALLY_STEP + TALLY_HOLD) return;
  judge(game);
}

function cleared(game: Game): void {
  if (game.phaseTime >= CLEARED_TIME) startRound(game);
}

function failed(game: Game): void {
  if (game.phaseTime < FAILED_TIME) return;
  game.screen = 'over';
  game.newBest = game.score > game.best[game.mode];
  if (game.newBest) game.best[game.mode] = game.score;
  game.events.push({ type: 'over', score: game.score, newBest: game.newBest });
}

const PHASES = { intro, launch, flight, settle, retrieve, tally, cleared, failed };

/** The original rules: every hook leaves the game as it was. modern.ts replaces some of them. */
export const CLASSIC: Readonly<Rules> = {
  name: 'classic',
  phases: PHASES,
  /** A new game begins: a classic game keeps no record of the modern rules. */
  start(game) {
    game.modern = null;
  },
  round: () => undefined,
  spawn: (_game, bird) => bird,
  fly: () => undefined,
  reach: () => 0,
  after: () => undefined,
};

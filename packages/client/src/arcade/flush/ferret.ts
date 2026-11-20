/**
 * The ferret of Ferret Flush (the reference's src/ferret.js): running in, sniffing, standing
 * alert and pouncing along the path, and popping up from the reeds with its catch, or with an
 * opinion. Every pose is worked out from the clocks of the game, so the picture always matches
 * the rules. In the modern rules it also cheers a passed round, dances with a golden bird and
 * calls the shots of the decoy line from its corner.
 */
import { TAU, curve, ease, ellipse, lerp, line, span, tube, type Point } from './kit.js';
import {
  W,
  CLEARED_TIME,
  MODES,
  RETRIEVE_TIME,
  SPECTATOR_X,
  introPlan,
  type Game,
} from './rules.js';
import { GOLDEN } from './modern.js';
import { drawCatch } from './birds.js';
import type { Ink } from './scene.js';

type Ctx = CanvasRenderingContext2D;

const FUR = '#93643f';
const DARK = '#4b2f1f';
const SHADE = '#3a2317';
const CREAM = '#f3e0bd';
const SNOW = '#fff8ea';
const PINK = '#eb8f93';
const EAR = '#c9907c';
const BLACK = '#0f0d0c';
/** Where the feet are on the path, and where the body leaves the reeds when it pops up. */
const PATH_LEVEL = 698;
const POP_BASE = 652;
const TITLE_X = W - 218;

/**
 * A side-on pose, facing right, measured from the feet: where hips and chest are, how high the
 * back arches, where the head is from the chest and how far it nods, how far the legs swing
 * forward, and how high the tail is carried.
 */
interface SidePose {
  hip: Point;
  chest: Point;
  arch: number;
  head: Point;
  nod: number;
  fore: number;
  hind: number;
  tail: number;
}

const POSES: Readonly<Record<'stretch' | 'tuck' | 'sniff' | 'stand' | 'leap', SidePose>> = {
  stretch: {
    hip: [-60, -27], chest: [56, -30], arch: 5, head: [30, -13],
    nod: -0.12, fore: 0.95, hind: -0.95, tail: -0.1,
  },
  tuck: {
    hip: [-26, -25], chest: [40, -36], arch: 22, head: [30, -8],
    nod: 0.2, fore: -0.55, hind: 0.75, tail: 0.5,
  },
  sniff: {
    hip: [-56, -30], chest: [44, -23], arch: 8, head: [31, 11],
    nod: 0.75, fore: 0.1, hind: 0, tail: 0.2,
  },
  stand: {
    hip: [-6, -28], chest: [12, -108], arch: -9, head: [12, -30],
    nod: -0.5, fore: 0.5, hind: 0, tail: -0.5,
  },
  leap: {
    hip: [-64, -10], chest: [62, -10], arch: -3, head: [32, -6],
    nod: -0.15, fore: 1.25, hind: -1.3, tail: 0,
  },
};

const mixPoint = (a: Point, b: Point, t: number): Point => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];

function mixPose(a: SidePose, b: SidePose, t: number): SidePose {
  return {
    hip: mixPoint(a.hip, b.hip, t),
    chest: mixPoint(a.chest, b.chest, t),
    arch: lerp(a.arch, b.arch, t),
    head: mixPoint(a.head, b.head, t),
    nod: lerp(a.nod, b.nod, t),
    fore: lerp(a.fore, b.fore, t),
    hind: lerp(a.hind, b.hind, t),
    tail: lerp(a.tail, b.tail, t),
  };
}

/** The ferret on the path: where, which way, how tilted, in front of the bank or behind it. */
export interface Runner {
  x: number;
  y: number;
  side: number;
  turn: number;
  layer: 'front' | 'back';
  pose: SidePose;
  /** seconds into the sniffing, while it sniffs */
  sniff?: number;
  /** how far the alert mark over its head has popped up */
  spark?: number;
}

/** The bounding run of a ferret: stretched in the air, tucked on the ground. */
function running(start: number, stop: number, side: number, p: number): Runner {
  const x = lerp(start, stop, 1 - (1 - p) ** 2);
  const stride = (Math.abs(x - start) / 135) % 1;
  const reach = 0.5 + 0.5 * Math.cos(stride * TAU);
  return {
    x,
    y: PATH_LEVEL - reach * 8,
    side,
    turn: 0,
    layer: 'front',
    pose: mixPose(POSES.tuck, POSES.stretch, reach),
  };
}

function sniffing(arrived: Runner, clock: number): Runner {
  const pose = mixPose(arrived.pose, POSES.sniff, ease.out(span(clock, 0, 0.25)));
  pose.head[1] += Math.sin(clock * 30) * 1.3;
  return { ...arrived, y: PATH_LEVEL, pose, sniff: clock };
}

function standing(from: Runner, clock: number): Runner {
  const up = ease.back(span(clock, 0, 0.28));
  return {
    ...from,
    y: PATH_LEVEL,
    pose: mixPose(from.pose, POSES.stand, up),
    spark: span(clock, 0.04, 0.3),
  };
}

/** A short crouch, then an arc over the grass that ends behind the bank. */
function leaping(from: Runner, toX: number, p: number): Runner {
  const q = span(p, 0.16, 1);
  if (q === 0) {
    const crouch = ease.out(span(p, 0, 0.16));
    return { ...from, y: PATH_LEVEL, pose: mixPose(POSES.stand, POSES.tuck, crouch) };
  }
  const climb = 170 * 4 * (1 - 2 * q);
  return {
    ...from,
    x: lerp(from.x, toX, q),
    y: PATH_LEVEL - 20 + 12 * q - 170 * 4 * q * (1 - q),
    turn: Math.atan2(12 - climb, Math.abs(toX - from.x)),
    pose: mixPose(POSES.tuck, POSES.leap, span(q, 0, 0.2)),
    layer: q > 0.5 ? 'back' : 'front',
  };
}

/** Where the ferret is on its way in, and in which pose: null when it is not on the path. */
export function runnerAt(game: Game): Runner | null {
  const ducks = MODES[game.mode].target === 'duck';
  if (game.screen !== 'playing' || game.phase !== 'intro' || !ducks) return null;
  const plan = introPlan(game.round);
  const { side, flushX } = game.ferret;
  const start = side > 0 ? -170 : W + 170;
  const stop = flushX - side * 200;
  const clock = game.phaseTime;
  if (clock < plan.run) return running(start, stop, side, clock / plan.run);
  return afterRun(running(start, stop, side, 1), plan, flushX, clock - plan.run);
}

/** What follows the run: the sniffing (in round one), the alert stand and the pounce. */
function afterRun(
  arrived: Runner,
  plan: ReturnType<typeof introPlan>,
  flushX: number,
  clock: number,
): Runner {
  if (clock < plan.sniff) return sniffing(arrived, clock);
  const from = plan.sniff ? { ...arrived, pose: POSES.sniff } : arrived;
  const stood = clock - plan.sniff;
  if (stood < plan.alert) return standing(from, stood);
  return leaping(from, flushX, (stood - plan.alert) / plan.pounce);
}

/** The back and the neck as one line from the hips to the head. */
function spineOf(pose: SidePose): (u: number) => Point {
  const [hx, hy] = pose.hip;
  const [cx, cy] = pose.chest;
  const length = Math.hypot(cx - hx, cy - hy) || 1;
  const lift = pose.arch * 2;
  const bend: Point = [
    (hx + cx) / 2 + ((cy - hy) / length) * lift,
    (hy + cy) / 2 - ((cx - hx) / length) * lift,
  ];
  const back = curve(pose.hip, bend, pose.chest);
  const head: Point = [cx + pose.head[0], cy + pose.head[1]];
  return (u) => {
    if (u < 0.8) return back(u / 0.8);
    const along = (u - 0.8) / 0.2;
    return [lerp(cx, head[0], along), lerp(cy, head[1], along)];
  };
}

/** The same line, moved toward the belly. */
function beside(at: (u: number) => Point, distance: number): (u: number) => Point {
  return (u) => {
    const [ax, ay] = at(Math.max(0, u - 0.03));
    const [bx, by] = at(Math.min(1, u + 0.03));
    const length = Math.hypot(bx - ax, by - ay) || 1;
    const [x, y] = at(u);
    return [x - ((by - ay) / length) * distance, y + ((bx - ax) / length) * distance];
  };
}

function legs(ctx: Ctx, ink: Ink, pose: SidePose, shift: number, colour: string): void {
  ctx.strokeStyle = ink(colour);
  ctx.lineWidth = 11;
  ctx.lineCap = 'round';
  const pairs: readonly (readonly [Point, number, number])[] = [
    [pose.hip, pose.hind, 6],
    [pose.chest, pose.fore, -4],
  ];
  for (const [joint, swing, inset] of pairs) {
    const x = joint[0] + shift + inset;
    const y = joint[1] + 8;
    line(ctx, x, y, x + Math.sin(swing) * 24, y + Math.cos(swing) * 24);
  }
}

function tail(ctx: Ctx, ink: Ink, pose: SidePose, t: number): void {
  const [x, y] = pose.hip;
  const lift = pose.tail + Math.sin(t * 9) * 0.06;
  const at = curve([x - 8, y + 2], [x - 46, y + 14 - lift * 30], [x - 84, y - 4 - lift * 54]);
  ctx.fillStyle = ink(DARK);
  tube(ctx, at, (u) => lerp(10.5, 6.5, u), 28);
}

function sniffMarks(ctx: Ctx, clock: number): void {
  ctx.strokeStyle = SNOW;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const puff = (clock * 2.6 + i / 3) % 1;
    ctx.globalAlpha = 0.7 * (1 - puff);
    ctx.beginPath();
    ctx.arc(26 + puff * 16, 6, 4 + i * 2.5, -0.9, 0.9);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function sideHead(ctx: Ctx, ink: Ink, pose: SidePose, runner: Runner): void {
  ctx.save();
  ctx.translate(pose.chest[0] + pose.head[0], pose.chest[1] + pose.head[1]);
  ctx.rotate(pose.nod);
  ctx.fillStyle = ink(FUR);
  ellipse(ctx, 0, 0, 19, 15.5);
  ctx.fillStyle = ink(DARK);
  ellipse(ctx, -10, -12, 7.5, 7.5);
  ctx.fillStyle = ink(EAR);
  ellipse(ctx, -10, -12, 4, 4);
  ctx.fillStyle = ink(CREAM);
  ellipse(ctx, 12, 4, 13, 9.5);
  ellipse(ctx, 1, -9, 11, 4.5, -0.3);
  ctx.fillStyle = ink(DARK);
  ellipse(ctx, 6, -3, 8, 6, -0.25);
  ctx.fillStyle = BLACK;
  ellipse(ctx, 7, -3.5, 3.2, 3.2);
  ctx.fillStyle = '#ffffff';
  ellipse(ctx, 8, -4.6, 1.1, 1.1);
  ctx.fillStyle = ink(PINK);
  ellipse(ctx, 23, 3, 3.6, 3.2);
  if (runner.sniff !== undefined) sniffMarks(ctx, runner.sniff);
  ctx.restore();
}

/** The mark over its head when it has noticed the ducks. */
function spark(ctx: Ctx, pose: SidePose, pop: number): void {
  const x = pose.chest[0] + pose.head[0] + 4;
  const y = pose.chest[1] + pose.head[1] - 30;
  const size = ease.back(pop);
  ctx.fillStyle = '#ffc24a';
  ctx.beginPath();
  ctx.roundRect(x - 4 * size, y - 30 * size, 8 * size, 20 * size, 4 * size);
  ctx.fill();
  ellipse(ctx, x, y - 3 * size, 4.5 * size, 4.5 * size);
}

/** Its shadow on the path, smaller the higher it leaps. */
function shadow(ctx: Ctx, runner: Runner): void {
  const height = PATH_LEVEL - runner.y;
  ctx.fillStyle = '#000000';
  ctx.globalAlpha = 0.2 * (1 - span(height, 0, 150));
  ellipse(ctx, runner.x, PATH_LEVEL + 5, 72 - Math.min(height, 150) * 0.2, 7);
  ctx.globalAlpha = 1;
}

/** The ferret from the side, on the path or in the air. */
export function drawRunner(ctx: Ctx, ink: Ink, runner: Runner, t: number): void {
  const { pose } = runner;
  if (runner.layer === 'front') shadow(ctx, runner);
  ctx.save();
  ctx.translate(runner.x, runner.y);
  ctx.scale(runner.side, 1);
  ctx.rotate(runner.turn);
  const spine = spineOf(pose);
  const belly = beside(spine, 9);
  tail(ctx, ink, pose, t);
  legs(ctx, ink, pose, -5, SHADE);
  ctx.fillStyle = ink(FUR);
  tube(ctx, spine, (u) => 19 - 5 * span(u, 0.7, 1));
  ctx.fillStyle = ink(CREAM);
  tube(ctx, (u) => belly(0.08 + u * 0.89), 9.5, 36);
  legs(ctx, ink, pose, 4, DARK);
  sideHead(ctx, ink, pose, runner);
  if (runner.spark) spark(ctx, pose, runner.spark);
  ctx.restore();
}

/** Something the eyes can follow: the sight, a disc, a decoy. */
interface Seen {
  x: number;
  y: number;
}

/** Where the eyes go: toward a point, gently. */
function gaze(x: number, y: number, target: Seen | null | undefined): Point {
  if (!target) return [0, 0];
  const dx = target.x - x;
  const dy = target.y - y;
  const far = Math.hypot(dx, dy) || 1;
  const pull = Math.min(1, far / 160);
  return [(dx / far) * pull, (dy / far) * pull];
}

/** The ferret up out of the reeds, from the front: how far, how it leans and looks and holds. */
export interface Popper {
  x: number;
  rise: number;
  lean: number;
  hop: number;
  look: Point;
  lids: number;
  droop: number;
  glad: boolean;
  blink: boolean;
  arms: 'rest' | 'hold' | 'cheer';
  catch: number[];
  time: number;
  shine?: boolean;
}

/** Up out of the reeds, paws on its chest, following something with its eyes. */
function watching(x: number, target: Seen | null | undefined, t: number): Popper {
  return {
    x,
    rise: 178,
    lean: Math.sin(t * 1.3) * 0.02,
    hop: 0,
    look: gaze(x, POP_BASE - 140, target),
    lids: 0,
    droop: 0,
    glad: false,
    blink: t % 3.7 < 0.13,
    arms: 'rest',
    catch: [],
    time: t,
  };
}

/** At the clay discs the ferret stays up in its corner, watches them and says what it thinks. */
function spectating(game: Game, seen: Seen | null, t: number): Popper {
  const disc = game.birds.find((bird) => bird.state === 'flying');
  const pop = watching(SPECTATOR_X, disc ?? seen, t);
  const clock = game.phaseTime;
  if (game.phase === 'intro' && game.round === 1) pop.rise *= ease.back(span(clock, 0.3, 0.75));
  if (game.phase !== 'retrieve') return pop;
  const still: Popper = { ...pop, look: [0, 0], blink: false };
  const bounce = Math.abs(Math.sin(clock * 11));
  const { mood } = game.ferret;
  if (mood === 'cheer') return { ...still, arms: 'cheer', glad: true, hop: bounce * 14 };
  if (mood === 'nod') return { ...still, glad: true, hop: bounce * 6 };
  const lids = 0.6 * span(clock, 0, 0.2);
  return { ...still, lids, droop: 1, lean: Math.sin(clock * 10) * 0.05 };
}

/** Up with the catch held over its head; with two ducks it cannot keep still. */
function presenting(game: Game): Popper {
  const { mood, popX, catch: kinds } = game.ferret;
  const clock = game.phaseTime;
  const total = mood === 'idle' ? 0 : RETRIEVE_TIME[mood];
  const up = ease.back(span(clock, 0, 0.3)) - ease.in(span(clock, total - 0.25, total));
  const golden = kinds.includes(GOLDEN);
  const dance = mood === 'double' || golden ? span(clock, 0.35, 0.5) : 0;
  return {
    shine: golden,
    ...watching(popX, null, clock),
    rise: 196 * up,
    lean: dance * Math.sin(clock * 12) * 0.09,
    hop: dance * Math.abs(Math.sin(clock * 12)) * 12,
    glad: true,
    blink: false,
    arms: 'hold',
    catch: kinds,
  };
}

/** Nothing caught: it watches the ducks go, gives the shooter a long look and keels over. */
function flopping(game: Game): Popper {
  const clock = game.phaseTime;
  const side = game.ferret.popX < W / 2 ? 1 : -1;
  const toYou = ease.inOut(span(clock, 0.75, 1));
  const up = ease.back(span(clock, 0, 0.3)) * (1 - span(clock, 1.8, 2.05));
  return {
    ...watching(game.ferret.popX, null, clock),
    rise: 172 * up,
    lean: ease.in(span(clock, 1.35, 1.9)) * 1.5 * side,
    look: [0.3 * side * (1 - toYou), toYou - 1],
    lids: 0.6 * toYou,
    droop: toYou,
    blink: false,
  };
}

/** A modern round passed: up in the reeds (or in its corner at the discs), arms high, hopping. */
function celebrating(game: Game, t: number): Popper {
  const clock = game.phaseTime;
  const clay = MODES[game.mode].target === 'clay';
  const leave = ease.in(span(clock, CLEARED_TIME - 0.4, CLEARED_TIME));
  const up = clay ? 1 : ease.back(span(clock, 0.2, 0.6)) - leave;
  const hop = Math.abs(Math.sin(clock * 9)) * 12;
  const pop = watching(clay ? SPECTATOR_X : W / 2, null, t);
  return { ...pop, rise: 186 * up, arms: 'cheer', glad: true, hop };
}

/** The decoy line: up in its corner, following a decoy, and cheering every one that falls. */
function calling(game: Game, cheer: number, t: number): Popper {
  const decoy = game.modern?.decoys.find((item) => item.state === 'up');
  const pop = watching(SPECTATOR_X, decoy, t);
  pop.rise *= ease.back(span(game.phaseTime, 0.1, 0.5));
  if (cheer <= 0) return pop;
  const hop = Math.abs(Math.sin(cheer * 12)) * 12;
  return { ...pop, look: [0, 0], arms: 'cheer', glad: true, hop };
}

/** Where the sight is, and whether it is over the field. */
export interface Pointer {
  x: number;
  y: number;
  inside: boolean;
  hover?: string | null;
}

/** How the ferret shows itself from the reeds right now: null when it is out of sight. */
export function popperAt(game: Game, pointer: Pointer, t: number, cheer = 0): Popper | null {
  const seen = pointer.inside ? pointer : null;
  if (game.screen !== 'playing') {
    const tired = game.screen === 'over' ? 1 : 0;
    return { ...watching(TITLE_X, seen, t), lids: 0.5 * tired, droop: tired };
  }
  return inPlay(game, seen, t, cheer);
}

/** The ferret during a game: calling, celebrating, watching the discs or bringing the catch. */
function inPlay(game: Game, seen: Pointer | null, t: number, cheer: number): Popper | null {
  if (game.phase === 'bonus') return calling(game, cheer, t);
  if (game.modern && game.phase === 'cleared') return celebrating(game, t);
  if (MODES[game.mode].target === 'clay') return spectating(game, seen, t);
  if (game.phase !== 'retrieve') return null;
  return game.ferret.mood === 'flop' ? flopping(game) : presenting(game);
}

function hands(pop: Popper, top: number): [Point, Point] {
  if (pop.arms === 'hold') {
    return [
      [-46, top - 4],
      [46, top - 4],
    ];
  }
  const wave = Math.sin(pop.time * 14) * 8;
  return [
    [-66, top + 4 + wave],
    [66, top + 4 - wave],
  ];
}

function raisedArms(ctx: Ctx, ink: Ink, pop: Popper, top: number): void {
  ctx.fillStyle = ink(DARK);
  for (const [x, y] of hands(pop, top)) {
    const s = Math.sign(x);
    tube(ctx, curve([s * 24, top + 96], [s * 62, top + 56], [x, y]), 8, 26);
  }
}

function restingArms(ctx: Ctx, ink: Ink, top: number): void {
  ctx.fillStyle = ink(DARK);
  for (const s of [-1, 1]) {
    tube(ctx, curve([s * 25, top + 98], [s * 26, top + 116], [s * 11, top + 124]), 7.5, 16);
    ellipse(ctx, s * 10, top + 125, 8.5, 7.5);
  }
}

/** Closed eyes: a happy arc, or a line for a blink. */
function shutEye(ctx: Ctx, ink: Ink, glad: boolean, ex: number, y: number): void {
  ctx.strokeStyle = ink(SNOW);
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (glad) ctx.arc(ex, y + 3, 5.5, Math.PI * 1.15, Math.PI * 1.85);
  else {
    ctx.moveTo(ex - 5, y);
    ctx.lineTo(ex + 5, y);
  }
  ctx.stroke();
}

function eyes(ctx: Ctx, ink: Ink, pop: Popper, x: number, y: number): void {
  for (const s of [-1, 1]) {
    const ex = x + s * 15.5;
    if (pop.glad || pop.blink) {
      shutEye(ctx, ink, pop.glad, ex, y);
      continue;
    }
    ctx.fillStyle = BLACK;
    ellipse(ctx, ex, y, 6.2, 6.8);
    ctx.fillStyle = '#ffffff';
    ellipse(ctx, ex + 2, y - 2.4, 2, 2);
    ctx.fillStyle = ink(DARK);
    if (pop.lids > 0) ctx.fillRect(ex - 8, y - 8, 16, 2 + pop.lids * 11);
  }
}

function mouth(ctx: Ctx, ink: Ink, pop: Popper, x: number, y: number): void {
  if (pop.glad) {
    ctx.fillStyle = '#5a1f24';
    ctx.beginPath();
    ctx.arc(x, y + 1.5, 6, 0, Math.PI);
    ctx.fill();
    ctx.fillStyle = ink(PINK);
    ellipse(ctx, x, y + 5, 3.2, 2.2);
    return;
  }
  ctx.strokeStyle = ink(DARK);
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  if (pop.lids > 0.3) {
    line(ctx, x - 5, y + 3.5, x + 5, y + 3.5);
    return;
  }
  ctx.beginPath();
  ctx.arc(x - 3.5, y + 0.5, 3.5, Math.PI * 0.15, Math.PI * 0.95);
  ctx.moveTo(x + 7, y + 1.5);
  ctx.arc(x + 3.5, y + 0.5, 3.5, Math.PI * 0.05, Math.PI * 0.85);
  ctx.stroke();
}

function whiskers(ctx: Ctx, ink: Ink, x: number, y: number): void {
  ctx.strokeStyle = ink(SNOW);
  ctx.lineWidth = 1.2;
  ctx.globalAlpha = 0.55;
  for (const s of [-1, 1]) {
    for (const [dx, dy] of [
      [31, -4],
      [33, 3],
      [29, 10],
    ] as const) {
      line(ctx, x + s * 12, y + 1, x + s * dx, y + dy);
    }
  }
  ctx.globalAlpha = 1;
}

function muzzle(ctx: Ctx, ink: Ink, pop: Popper, x: number, y: number): void {
  whiskers(ctx, ink, x, y);
  ctx.fillStyle = ink(SNOW);
  ellipse(ctx, x, y, 15, 11.5);
  ctx.fillStyle = ink(PINK);
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 5, y - 7.5);
  ctx.lineTo(x + 5, y - 7.5);
  ctx.lineTo(x, y - 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  mouth(ctx, ink, pop, x, y);
}

/** The ears and the face's shape: cream under fur, with dark patches round the eyes. */
function face(ctx: Ctx, ink: Ink, pop: Popper, x: number, y: number): void {
  for (const s of [-1, 1]) {
    ctx.fillStyle = ink(FUR);
    ellipse(ctx, x + s * 31, y - 25 + pop.droop * 7, 13, 13);
    ctx.fillStyle = ink(EAR);
    ellipse(ctx, x + s * 31, y - 24 + pop.droop * 7, 7.5, 8);
  }
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(x, y, 41, 33, 0, 0, TAU);
  ctx.fillStyle = ink(CREAM);
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = ink(FUR);
  ellipse(ctx, x, y - 34, 36, 20);
  ellipse(ctx, x - 47, y + 8, 16, 24);
  ellipse(ctx, x + 47, y + 8, 16, 24);
  ctx.restore();
  ctx.fillStyle = ink(DARK);
  ellipse(ctx, x - 16, y - 4, 14, 10.5, 0.28);
  ellipse(ctx, x + 16, y - 4, 14, 10.5, -0.28);
  ctx.fillRect(x - 8, y - 9, 16, 9);
}

function frontHead(ctx: Ctx, ink: Ink, pop: Popper, centre: number): void {
  const [lx, ly] = pop.look;
  const x = lx * 6;
  const y = centre + ly * 4;
  face(ctx, ink, pop, x, y);
  eyes(ctx, ink, pop, x + lx * 3, y - 4 + ly * 2.5);
  muzzle(ctx, ink, pop, x + lx * 4, y + 12 + ly * 2);
}

function heldCatch(ctx: Ctx, ink: Ink, pop: Popper, top: number): void {
  pop.catch.forEach((kind, i) => {
    const swing = Math.sin(pop.time * 7 + i);
    ctx.save();
    ctx.translate(i * 6 - 4, top - 30 - i * 40);
    ctx.rotate((i ? 0.12 : -0.08) + swing * 0.03);
    ctx.scale(i % 2 ? -1 : 1, 1);
    drawCatch(ctx, ink, kind, swing);
    ctx.restore();
  });
}

/** Four-pointed glints that turn around a golden catch. */
function sparkles(ctx: Ctx, pop: Popper, top: number): void {
  ctx.fillStyle = '#fff1b0';
  for (let i = 0; i < 5; i++) {
    const turn = pop.time * 1.6 + (i * TAU) / 5;
    const x = Math.cos(turn) * 74;
    const y = top - 60 + Math.sin(turn) * 34;
    const r = 5 + 3 * Math.sin(pop.time * 4 + i) ** 2;
    ctx.beginPath();
    ctx.moveTo(x, y - r * 2);
    ctx.lineTo(x + r * 0.5, y);
    ctx.lineTo(x, y + r * 2);
    ctx.lineTo(x - r * 0.5, y);
    ctx.moveTo(x - r * 2, y);
    ctx.lineTo(x, y + r * 0.5);
    ctx.lineTo(x + r * 2, y);
    ctx.lineTo(x, y - r * 0.5);
    ctx.fill();
  }
}

/** The neck and chest, cream down the front. */
function chest(ctx: Ctx, ink: Ink, pop: Popper, top: number): void {
  const neck = top + 84;
  const bend: Point = [-pop.lean * 40, neck / 2 + 23];
  ctx.fillStyle = ink(FUR);
  tube(ctx, curve([0, 46], bend, [0, neck]), 31, 18);
  ctx.fillStyle = ink(CREAM);
  tube(ctx, curve([0, 46], bend, [0, neck + 10]), 15.5, 18);
}

/** The ferret from the front, as far out of the reeds as `rise` says. */
export function drawPopper(ctx: Ctx, ink: Ink, pop: Popper): void {
  if (pop.rise < 6) return;
  const top = -pop.rise - pop.hop;
  ctx.save();
  ctx.translate(pop.x, POP_BASE);
  ctx.rotate(pop.lean);
  if (pop.arms !== 'rest') raisedArms(ctx, ink, pop, top);
  chest(ctx, ink, pop, top);
  if (pop.arms === 'rest') restingArms(ctx, ink, top);
  frontHead(ctx, ink, pop, top + 44);
  heldCatch(ctx, ink, pop, top);
  if (pop.shine) sparkles(ctx, pop, top);
  if (pop.arms !== 'rest') {
    ctx.fillStyle = ink(DARK);
    for (const [x, y] of hands(pop, top)) ellipse(ctx, x, y, 10, 9);
  }
  ctx.restore();
}

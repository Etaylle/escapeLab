/**
 * The three ducks and the clay disc of Ferret Flush (the reference's src/birds.js), drawn as
 * paper cut-outs. A duck is painted facing right around the middle of its body; wings beat with
 * its age, and it tilts the way it flies. The modern rules add a golden bird with a crest and two
 * streamers, and the wooden decoys.
 */
import { TAU, clamp, ellipse, lerp, line } from './kit.js';
import { HIT_STUN, type Bird, type Decoy, type Game } from './rules.js';
import { DECOY, decoyAt, decoyFall } from './modern.js';
import type { Ink } from './scene.js';

type Ctx = CanvasRenderingContext2D;

const SIZE = 1.22;

type Shape = 'curl' | 'pin' | 'fan' | 'streamer';
interface Look {
  body: string;
  belly: string;
  breast: string;
  head: string;
  neck: string;
  bill: string;
  wing: string;
  wingFar: string;
  tip: string;
  patch: string;
  tail: string;
  feet: string;
  shape: Shape;
  beat: number;
  ring?: boolean;
  cap?: string;
  cheek?: string;
  crest?: string;
}

/** Mallard, pintail and ruddy duck, and the golden bird. `beat` is wing beats per second. */
const LOOKS: readonly Look[] = [
  {
    body: '#c2bdb4', belly: '#e4e0d8', breast: '#8c4b35', head: '#1f7550', neck: '#1f7550',
    bill: '#f0c032', wing: '#a39e96', wingFar: '#77736d', tip: '#5f5b56', patch: '#3f73d6',
    tail: '#f4f1ea', feet: '#f08b32', shape: 'curl', beat: 5.6, ring: true,
  },
  {
    body: '#cfcac1', belly: '#f3efe6', breast: '#f6f2e9', head: '#70482f', neck: '#f6f2e9',
    bill: '#62707f', wing: '#948f88', wingFar: '#6f6b65', tip: '#4f4b46', patch: '#3f946d',
    tail: '#3a3531', feet: '#7d8791', shape: 'pin', beat: 6.4,
  },
  {
    body: '#b9562d', belly: '#d98a5a', breast: '#c8683c', head: '#b9562d', neck: '#b9562d',
    bill: '#5cb8ea', wing: '#7f3d23', wingFar: '#5d2b18', tip: '#45200f', patch: '#e2c9a6',
    tail: '#3b2218', feet: '#7d8791', shape: 'fan', beat: 7.6, cap: '#2b1c17', cheek: '#fbf6ea',
  },
  {
    body: '#e9b949', belly: '#fbe7a1', breast: '#d4952a', head: '#f6cf5a', neck: '#f6cf5a',
    bill: '#fff1c4', wing: '#dba63b', wingFar: '#a97a22', tip: '#8a5e14', patch: '#fff6d8',
    tail: '#fff1c4', feet: '#e07b2a', shape: 'streamer', beat: 6.8, crest: '#fff6d8',
  },
];
const lookOf = (kind: number): Look => LOOKS[kind] ?? (LOOKS[0] as Look);

const TAILS: Readonly<Record<Shape, readonly [number, number, number, number, number, number]>> = {
  curl: [-34, -10, -60, -17, -37, 3],
  pin: [-34, -9, -80, -21, -37, 0],
  fan: [-32, -8, -56, -39, -44, -1],
  streamer: [-34, -10, -92, -34, -37, 2],
};

interface Pose {
  wing: number;
  eye: 'open' | 'wide' | 'shut';
  squawk: boolean;
}
const STUNNED: Pose = { wing: 0.9, eye: 'wide', squawk: true };

/** The colours of the feathers a duck of this kind loses. */
export function featherColours(kind: number): string[] {
  const look = lookOf(kind);
  return [look.head, look.body, look.wing, '#ffffff'];
}

/** The bar of colour across the near wing. */
function wingPatch(ctx: Ctx, ink: Ink, look: Look, tipX: number, tipY: number): void {
  ctx.clip();
  ctx.fillStyle = ink(look.tip);
  ellipse(ctx, tipX - 4, tipY, 22, 20);
  ctx.strokeStyle = ink(look.patch);
  ctx.lineWidth = 8;
  ctx.lineCap = 'butt';
  const [x, y] = [tipX - 16, tipY * 0.55];
  line(ctx, lerp(-20, x, 0.22), lerp(-2, y, 0.22), lerp(-20, x, 0.6), lerp(-2, y, 0.6));
}

function wing(ctx: Ctx, ink: Ink, look: Look, lift: number, far: boolean): void {
  const tipX = -16 - (1 - Math.abs(lift)) * 12 + (far ? 6 : 0);
  const tipY = -6 - lift * 58 - (far ? 3 : 0);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(22, -9);
  ctx.quadraticCurveTo(12, (tipY - 9) * 0.6, tipX + 6, tipY);
  ctx.quadraticCurveTo(tipX - 14, tipY * 0.92, tipX - 18, tipY * 0.5 - 2);
  ctx.quadraticCurveTo(-30, tipY * 0.12 - 2, -20, -2);
  ctx.closePath();
  ctx.fillStyle = ink(far ? look.wingFar : look.wing);
  ctx.fill();
  if (!far) wingPatch(ctx, ink, look, tipX, tipY);
  ctx.restore();
}

/** The golden bird's streamer, or a mallard's curled tail feather. */
function tailFeather(ctx: Ctx, ink: Ink, look: Look): void {
  if (look.shape === 'streamer') {
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-36, -2);
    ctx.quadraticCurveTo(-64, 4, -90, -6);
    ctx.stroke();
    return;
  }
  if (look.shape !== 'curl') return;
  ctx.strokeStyle = ink('#2b2b2b');
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(-44, -16, 5.5, Math.PI * 0.2, Math.PI * 1.5);
  ctx.stroke();
}

function tail(ctx: Ctx, ink: Ink, look: Look): void {
  const [ax, ay, bx, by, cx, cy] = TAILS[look.shape];
  ctx.fillStyle = ink(look.tail);
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.lineTo(cx, cy);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  tailFeather(ctx, ink, look);
}

function body(ctx: Ctx, ink: Ink, look: Look): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-40, -6);
  ctx.bezierCurveTo(-26, -27, 16, -27, 32, -12);
  ctx.bezierCurveTo(42, -2, 36, 14, 16, 18);
  ctx.bezierCurveTo(-4, 23, -30, 17, -40, -6);
  ctx.fillStyle = ink(look.body);
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = ink(look.belly);
  ellipse(ctx, -6, 19, 34, 9);
  ctx.fillStyle = ink(look.breast);
  ellipse(ctx, 34, 4, 19, 24);
  ctx.restore();
}

function eye(ctx: Ctx, ink: Ink, kind: Pose['eye']): void {
  if (kind === 'shut') {
    ctx.strokeStyle = ink('#22262e');
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    line(ctx, 41, -34, 47, -28);
    line(ctx, 47, -34, 41, -28);
    return;
  }
  const wide = kind === 'wide';
  ctx.fillStyle = ink('#ffffff');
  ellipse(ctx, 44, -31, wide ? 5.6 : 4, wide ? 5.6 : 4);
  ctx.fillStyle = '#161a22';
  ellipse(ctx, 45, -31, wide ? 1.8 : 2.4, wide ? 1.8 : 2.4);
}

function bill(ctx: Ctx, ink: Ink, look: Look, open: boolean): void {
  ctx.fillStyle = ink(look.bill);
  ctx.beginPath();
  ctx.moveTo(50, -34);
  ctx.quadraticCurveTo(66, -34, 72, -28);
  ctx.quadraticCurveTo(62, -24, 50, -25);
  ctx.fill();
  if (!open) return;
  ctx.beginPath();
  ctx.moveTo(50, -26);
  ctx.lineTo(67, -18);
  ctx.lineTo(50, -21);
  ctx.fill();
}

/** The neck, a mallard's white ring, and the golden bird's crest. */
function neck(ctx: Ctx, ink: Ink, look: Look): void {
  ctx.lineCap = 'round';
  ctx.strokeStyle = ink(look.neck);
  ctx.lineWidth = 15;
  line(ctx, 24, -9, 38, -25);
  if (look.ring) {
    ctx.lineCap = 'butt';
    ctx.strokeStyle = ink('#ffffff');
    ctx.lineWidth = 4.5;
    line(ctx, 22.5, -20, 34, -9.5);
  }
  if (look.crest) {
    ctx.fillStyle = ink(look.crest);
    ctx.beginPath();
    ctx.moveTo(34, -38);
    ctx.quadraticCurveTo(22, -60, 12, -54);
    ctx.quadraticCurveTo(24, -50, 28, -32);
    ctx.fill();
  }
}

/** A ruddy duck's dark cap and white cheek. */
function cap(ctx: Ctx, ink: Ink, look: Look): void {
  if (!look.cap) return;
  ctx.save();
  ctx.beginPath();
  ctx.arc(40, -28, 13.5, 0, TAU);
  ctx.clip();
  ctx.fillStyle = ink(look.cap);
  ctx.fillRect(24, -44, 32, 13);
  ctx.fillStyle = ink(look.cheek ?? look.head);
  ellipse(ctx, 41, -22.5, 9.5, 7);
  ctx.restore();
}

function head(ctx: Ctx, ink: Ink, look: Look, pose: Pose): void {
  neck(ctx, ink, look);
  ctx.fillStyle = ink(look.head);
  ellipse(ctx, 40, -28, 13.5, 13.5);
  cap(ctx, ink, look);
  bill(ctx, ink, look, pose.squawk);
  eye(ctx, ink, pose.eye);
}

function paintDuck(ctx: Ctx, ink: Ink, look: Look, pose: Pose): void {
  wing(ctx, ink, look, pose.wing * 0.92, true);
  tail(ctx, ink, look);
  ctx.fillStyle = ink(look.feet);
  ellipse(ctx, -30, 14, 9, 3.6, -0.25);
  body(ctx, ink, look);
  head(ctx, ink, look, pose);
  wing(ctx, ink, look, pose.wing, false);
}

/** A hit duck: swollen for a moment, then falling limp. */
function fallingDuck(ctx: Ctx, ink: Ink, look: Look, duck: Bird): void {
  const stun = duck.stun ?? 0;
  const pop = SIZE * (1 + 0.35 * clamp(stun / HIT_STUN, 0, 1));
  const limp: Pose = { wing: 0.55 + Math.sin(duck.age * 22) * 0.25, eye: 'shut', squawk: true };
  ctx.rotate(duck.angle ?? 0);
  ctx.scale((duck.facing ?? 1) * pop, pop);
  paintDuck(ctx, ink, look, stun > 0 ? STUNNED : limp);
}

/** A duck on the wing, beating faster as it rises or flees. */
function flyingDuck(ctx: Ctx, ink: Ink, look: Look, duck: Bird): void {
  const hurry = duck.state === 'flying' ? 1 : 1.3;
  const beat = Math.sin(duck.age * look.beat * hurry * TAU);
  ctx.scale((duck.flip ?? 1) * SIZE, SIZE);
  ctx.rotate(Math.asin(clamp(Math.sin(duck.heading ?? 0), -1, 1)) * 0.5);
  ctx.translate(0, beat * 3);
  paintDuck(ctx, ink, look, { wing: beat, eye: 'open', squawk: false });
}

function drawDuck(ctx: Ctx, ink: Ink, duck: Bird): void {
  const look = lookOf(duck.look ?? duck.kind);
  ctx.save();
  ctx.translate(duck.x, duck.y);
  if (duck.state === 'falling') fallingDuck(ctx, ink, look, duck);
  else flyingDuck(ctx, ink, look, duck);
  ctx.restore();
}

/** A clay disc in four layers; a golden one is gold and has a ring round its middle. */
const DISCS: readonly (readonly [string, string, string, string])[] = [
  ['#a3401d', '#ea7237', '#f79d60', '#ffd6ad'],
  ['#8a5e14', '#e2a93a', '#f6cf5a', '#fff6d8'],
];

function drawClay(ctx: Ctx, ink: Ink, clay: Bird): void {
  if (clay.state !== 'flying') return;
  const golden = clay.look !== undefined;
  const [edge, face, top, shine] = DISCS[golden ? 1 : 0] ?? ['', '', '', ''];
  const scale = clay.scale ?? 1;
  ctx.save();
  ctx.translate(clay.x, clay.y);
  ctx.rotate((clay.dir ?? 1) * 0.14 + Math.sin(clay.age * 9) * 0.06);
  ctx.scale(scale, scale);
  ctx.fillStyle = ink(edge);
  ellipse(ctx, 0, 4, 30, 10.5);
  ctx.fillStyle = ink(face);
  ellipse(ctx, 0, 0, 30, 10);
  ctx.fillStyle = ink(top);
  ellipse(ctx, 0, -3, 19, 6);
  ctx.fillStyle = ink(shine);
  ellipse(ctx, -6, -5, 7, 2);
  if (golden) {
    ctx.strokeStyle = ink(edge);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(0, -1, 25, 8, 0, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

/** Every target in the air. */
export function drawBirds(ctx: Ctx, ink: Ink, game: Pick<Game, 'birds'>): void {
  for (const bird of game.birds) {
    if (bird.type === 'clay') drawClay(ctx, ink, bird);
    else drawDuck(ctx, ink, bird);
  }
}

/** A caught duck, hanging limp: drawn around the point it is held by. */
export function drawCatch(ctx: Ctx, ink: Ink, kind: number, sway: number): void {
  paintDuck(ctx, ink, lookOf(kind), { wing: -0.35 + sway * 0.06, eye: 'shut', squawk: false });
}

/** A wooden decoy on its peg: flat-sided, painted, with a target ring on its flank. */
function paintDecoy(ctx: Ctx, ink: Ink): void {
  ctx.fillStyle = ink('#5e3d22');
  ctx.fillRect(-3, 10, 6, 26);
  ctx.fillStyle = ink('#9a6a3e');
  ctx.beginPath();
  ctx.moveTo(-34, -2);
  ctx.quadraticCurveTo(-30, -20, 4, -18);
  ctx.quadraticCurveTo(30, -18, 30, 0);
  ctx.quadraticCurveTo(28, 14, 0, 14);
  ctx.quadraticCurveTo(-30, 14, -34, -2);
  ctx.fill();
  ctx.fillStyle = ink('#2f6b4f');
  ellipse(ctx, 22, -24, 11, 10);
  ctx.fillStyle = ink('#e0b13a');
  ellipse(ctx, 35, -22, 8, 3.4);
  ctx.fillStyle = ink('#fff3d9');
  ellipse(ctx, -2, -1, 11, 8);
  ctx.fillStyle = ink('#c2452f');
  ellipse(ctx, -2, -1, 6, 4.4);
  ctx.fillStyle = '#161a22';
  ellipse(ctx, 25, -26, 1.8, 1.8);
}

/** The decoy line at `clock` of the bonus stage: two ropes, and the decoys riding them. */
export function drawDecoys(ctx: Ctx, ink: Ink, decoys: readonly Decoy[], clock: number): void {
  ctx.strokeStyle = ink('#5e3d22');
  ctx.lineWidth = 2;
  for (const rail of DECOY.rails) line(ctx, -20, rail + 36, 1300, rail + 36);
  for (const decoy of decoys) {
    if (decoy.state === 'waiting' || decoy.state === 'gone') continue;
    const fall = decoyFall(decoy, clock);
    const { x, y } = decoy.state === 'up' ? decoyAt(decoy, clock) : decoy;
    ctx.save();
    ctx.translate(x, y + 36);
    ctx.scale(decoy.dir * 1.2, 1.2 * Math.cos((fall * Math.PI) / 2));
    ctx.translate(0, -36);
    ctx.globalAlpha = 1 - fall * 0.4;
    paintDecoy(ctx, ink);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

/**
 * One frame of Ferret Flush (the reference's src/draw.js), from the back to the front: sky and
 * lake, the tall reeds, the birds and the ferret behind the bank, the grass in front, the path,
 * and on top what is written. Round, score and shells are in the HUD bar of the page; on a small
 * screen the menus are too (`frame.compact`).
 */
import { W, H, type Game } from './rules.js';
import { ease } from './kit.js';
import {
  SKY_COUNT,
  createScene,
  drawBackdrop,
  drawBank,
  drawMotes,
  drawReeds,
  drawTufts,
  inkFor,
  skyBetween,
  type Ink,
  type Scene,
  type Sky,
} from './scene.js';
import { drawBirds, drawDecoys } from './birds.js';
import { STEP } from './clock.js';
import { drawPopper, drawRunner, popperAt, runnerAt, type Pointer } from './ferret.js';
import { drawParticles, drawRings, type Fx } from './fx.js';
import { drawBanners, drawOver, drawPause, drawPopups, drawSight, drawTitle } from './hud.js';

type Ctx = CanvasRenderingContext2D;

/** Seconds the light takes to turn from one time of day to the next. */
const DAY_TURN = 2.4;

/** What the picture keeps from frame to frame: the marsh, the hour, the lean of the sight. */
export interface View {
  scene: Scene;
  hour: number;
  from: number;
  turned: number;
  sky: Sky;
  ink: Ink;
  drift: number;
  wind: number;
  shade?: CanvasGradient;
}

/** What a frame knows besides the game: time passed, the place between steps, the page's state. */
export interface Frame {
  dt: number;
  alpha: number;
  paused: boolean;
  muted: boolean;
  fullScreen: boolean;
  compact: boolean;
}

export function createView(): View {
  const sky = skyBetween(0, 0, 1);
  const scene = createScene();
  return { scene, hour: 0, from: 0, turned: 1, sky, ink: inkFor(sky), drift: 0, wind: 0 };
}

/** The hour follows the round; the first screen is always first light. */
function turnSky(view: View, game: Game, dt: number): void {
  const hour = game.screen === 'title' ? 0 : (game.round - 1) % SKY_COUNT;
  if (hour !== view.hour) {
    view.from = view.hour;
    view.hour = hour;
    view.turned = 0;
  }
  if (view.turned >= 1) return;
  view.turned = Math.min(1, view.turned + dt / DAY_TURN);
  view.sky = skyBetween(view.from, view.hour, ease.inOut(view.turned));
  view.ink = inkFor(view.sky);
}

/** The decoys of the bonus stage, between two steps of the rules. */
function decoyLine(ctx: Ctx, ink: Ink, game: Game, frame: Frame): void {
  if (game.phase === 'bonus' && game.screen === 'playing' && game.modern) {
    drawDecoys(ctx, ink, game.modern.decoys, game.phaseTime - (1 - frame.alpha) * STEP);
  }
}

function world(ctx: Ctx, view: View, game: Game, fx: Fx, pointer: Pointer, frame: Frame): void {
  const { scene, sky, ink, drift, wind } = view;
  const t = fx.clock;
  const runner = runnerAt(game);
  const popper = popperAt(game, pointer, t, fx.cheer);
  drawBackdrop(ctx, scene, sky, t, drift);
  drawReeds(ctx, scene, sky, fx.rustles, t, wind);
  decoyLine(ctx, ink, game, frame);
  drawBirds(ctx, ink, game);
  if (popper) drawPopper(ctx, ink, popper);
  if (runner?.layer === 'back') drawRunner(ctx, ink, runner, t);
  drawParticles(ctx, fx, sky, ink);
  drawBank(ctx, scene, sky, fx.rustles, t, drift, wind);
  if (runner?.layer === 'front') drawRunner(ctx, ink, runner, t);
  drawTufts(ctx, scene, sky, fx.rustles, t, drift, wind);
  drawMotes(ctx, scene, sky, t);
  drawRings(ctx, fx);
}

/** On a small screen the menus are panels of the page, and the field shows only the marsh. */
function written(ctx: Ctx, game: Game, fx: Fx, pointer: Pointer, frame: Frame): void {
  const menus = !frame.compact;
  if (game.screen === 'title') {
    if (menus) drawTitle(ctx, game, pointer.hover, fx.clock, frame);
  } else {
    drawPopups(ctx, fx);
    drawBanners(ctx, fx);
  }
  if (game.screen === 'over' && menus) drawOver(ctx, game, pointer.hover);
  if (frame.paused && menus) drawPause(ctx);
}

/** The dark round the edges of the picture, made once. */
function shadeOf(ctx: Ctx, view: View): CanvasGradient {
  if (!view.shade) {
    view.shade = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 1.02);
    view.shade.addColorStop(0, 'rgba(8,12,24,0)');
    view.shade.addColorStop(1, 'rgba(8,12,24,0.42)');
  }
  return view.shade;
}

/**
 * `frame`: the time that passed, how far the picture is between two steps of the rules, and
 * whether the game is paused, muted, may go full screen and shows its menus as page panels.
 */
export function draw(ctx: Ctx, view: View, game: Game, fx: Fx, pointer: Pointer, frame: Frame): void {
  turnSky(view, game, frame.dt);
  const lean = fx.calm || !pointer.inside ? 0 : (pointer.x - W / 2) / (W / 2);
  view.drift += (lean - view.drift) * Math.min(1, frame.dt * 4);
  view.wind += (fx.wind - view.wind) * Math.min(1, frame.dt * 1.5);
  ctx.save();
  if (fx.shake > 0 && !fx.calm && !frame.paused) {
    ctx.translate((Math.random() - 0.5) * fx.shake * 44, (Math.random() - 0.5) * fx.shake * 44);
  }
  world(ctx, view, game, fx, pointer, frame);
  ctx.restore();
  ctx.fillStyle = shadeOf(ctx, view);
  ctx.fillRect(0, 0, W, H);
  written(ctx, game, fx, pointer, frame);
  drawSight(ctx, game, fx, pointer);
}

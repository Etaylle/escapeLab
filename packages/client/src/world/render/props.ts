import { animTime, paperFlutter, spinFan, type FanState } from '../anim.js';
import { dressedFor } from '../artKit.js';
import { addCircle, OUTLINE, TAU } from '../brush.js';
import type { CeilingFan } from '../dress.js';
import { BLACK, css, INK, inLight, lift, PAPER, rgba, sink, STEEL, type Rgb } from '../palette.js';
import { powerAt } from '../sources.js';
import type { Frame } from './frame.js';

/**
 * The lab's ceiling fans (dress.ts `fans`): each over the middle of a
 * machine room, turning while the room has its power, spinning up as its
 * lights come on and coasting to a stop without them (anim.ts spinFan). Its
 * blades hang a room's height over the floor, over whoever walks under them
 * (`drawFans`, the actors' pass); on the floor below lie their shadow,
 * sweeping round under the ceiling lights, and a sheet of paper fluttering
 * in the draught (`drawFloor`, the objects' pass). Under reduced motion the
 * blades stand still and the paper lies flat. Tile space.
 */

/** How far over the floor the blades hang, tiles up the picture: a room's height. */
export const FAN_HEIGHT = 0.62;
/** A blade's length from the hub and its width, tiles; seen from below, foreshortened down. */
const BLADE = { length: 0.4, width: 0.1, foreshorten: 0.55 } as const;
/** Where the sheet lies under the fan, from the fan's tile middle, and its size, tiles. */
const SHEET = { x: -0.2, y: 0.16, w: 0.22, h: 0.16, turn: 0.35 } as const;
/** How far the sheet's corner lifts at most in the draught, tiles. */
const LIFT = 0.07;

/**
 * The spin of `fan` at this frame's animation step, stepped on from the step it was last at —
 * at most ANIM_HZ times a second, as the motion rule has it — kept in the art's kit.
 */
export function fanSpin(frame: Frame, fan: CeilingFan): FanState {
  const fans = frame.kit.art.fans;
  const key = `${fan.x},${fan.y}`;
  const now = animTime(frame.time);
  const last = fans.get(key) ?? { angle: 0, speed: 0, at: now };
  if (last.at === now) {
    fans.set(key, last);
    return last;
  }
  const power = powerAt(frame, fan.x, fan.y, fan.room);
  const state = { ...spinFan(last, power, now - last.at, frame.reduced), at: now };
  fans.set(key, state);
  return state;
}

/** The fans of the map on show whose tile the world shows. */
function fansShown(frame: Frame): CeilingFan[] {
  const { dressing } = dressedFor(frame.kit.art, frame.map, frame.missionId);
  return dressing.fans.filter((fan) => frame.light.shown(fan.x, fan.y));
}

/** A blade at `angle` round a hub at the origin, foreshortened as seen from below. */
function blade(ctx: CanvasRenderingContext2D, angle: number): void {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle) * BLADE.foreshorten;
  const mx = cos * BLADE.length * 0.55;
  const my = sin * BLADE.length * 0.55;
  ctx.moveTo(cos * BLADE.length, sin * BLADE.length);
  ctx.ellipse(mx, my, BLADE.length * 0.5, BLADE.width / 2, Math.atan2(sin, cos), 0, TAU);
}

/**
 * The fans' blades a room's height over their tiles, after the crew: a downrod from the
 * ceiling, the hub, four blades turning, a blur round them as they spin fast.
 */
export function drawFans(ctx: CanvasRenderingContext2D, frame: Frame): void {
  for (const fan of fansShown(frame)) {
    const spin = fanSpin(frame, fan);
    const lit = powerAt(frame, fan.x, fan.y, fan.room) > 0.5;
    const paint = (rgb: Rgb): string => css(inLight(rgb, lit));
    ctx.save();
    ctx.translate(fan.x + 0.5, fan.y + 0.5 - FAN_HEIGHT);
    ctx.fillStyle = rgba(BLACK, 0.1 * Math.min(1, spin.speed / 5));
    ctx.beginPath();
    ctx.ellipse(0, 0, BLADE.length, BLADE.length * BLADE.foreshorten, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      blade(ctx, spin.angle + (k / 4) * TAU);
    }
    ctx.fillStyle = paint(sink(STEEL, 0.35));
    ctx.fill();
    ctx.lineWidth = OUTLINE * 0.75;
    ctx.strokeStyle = paint(INK);
    ctx.stroke();
    ctx.fillStyle = paint(sink(STEEL, 0.15));
    ctx.fillRect(-0.015, -0.16, 0.03, 0.16);
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.09, 0.06, 0, 0, TAU);
    ctx.fillStyle = paint(lift(STEEL, 0.1));
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

/** The blades' shadow on the floor, sweeping round under the ceiling lights of a lit room. */
function drawShadow(ctx: CanvasRenderingContext2D, angle: number, power: number): void {
  ctx.fillStyle = rgba(BLACK, 0.16 * power);
  ctx.beginPath();
  for (let k = 0; k < 4; k++) {
    blade(ctx, angle + (k / 4) * TAU);
  }
  addCircle(ctx, 0, 0, 0.07);
  ctx.fill();
}

/**
 * A sheet of paper lying on the floor, its corner lifting `lift` (0 to 1) in the fan's
 * draught: the sheet, its raised corner's shadow and the underside showing.
 */
function drawSheet(ctx: CanvasRenderingContext2D, lift01: number): void {
  const { x, y, w, h, turn } = SHEET;
  const up = LIFT * lift01;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(turn);
  ctx.fillStyle = rgba(BLACK, 0.18);
  ctx.fillRect(-w / 2 + 0.01, -h / 2 + 0.012, w, h);
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h / 2);
  ctx.lineTo(w / 2 - 0.05, -h / 2);
  ctx.lineTo(w / 2, -h / 2 + 0.05 - up);
  ctx.lineTo(w / 2, h / 2);
  ctx.lineTo(-w / 2, h / 2);
  ctx.closePath();
  ctx.fillStyle = css(PAPER);
  ctx.fill();
  ctx.lineWidth = OUTLINE * 0.5;
  ctx.strokeStyle = css(sink(PAPER, 0.55));
  ctx.stroke();
  ctx.fillStyle = css(sink(PAPER, 0.25));
  ctx.beginPath();
  ctx.moveTo(w / 2 - 0.05, -h / 2);
  ctx.lineTo(w / 2, -h / 2 + 0.05 - up);
  ctx.lineTo(w / 2 - 0.05 + up * 0.4, -h / 2 - up * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgba(sink(PAPER, 0.6), 0.5);
  for (let line = 0; line < 3; line++) {
    ctx.fillRect(-w / 2 + 0.025, -h / 2 + 0.035 + line * 0.035, w * (0.65 - line * 0.12), 0.012);
  }
  ctx.restore();
}

/**
 * Under each fan the world shows: the blades' shadow sweeping round while its room is lit,
 * and the sheet lying there, fluttering in the draught as the fan turns.
 */
export function drawFloor(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const t = animTime(frame.time);
  for (const fan of fansShown(frame)) {
    const spin = fanSpin(frame, fan);
    const power = powerAt(frame, fan.x, fan.y, fan.room);
    ctx.save();
    ctx.translate(fan.x + 0.5, fan.y + 0.5);
    if (power > 0) {
      ctx.save();
      ctx.translate(0.06, 0.04);
      drawShadow(ctx, spin.angle, power);
      ctx.restore();
    }
    const lift01 = frame.reduced ? 0 : paperFlutter(spin.speed, t, fan.x * 7 + fan.y);
    drawSheet(ctx, lift01);
    ctx.restore();
  }
}

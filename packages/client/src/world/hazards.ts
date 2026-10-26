import type { DronePosition } from '@escapelab/core';
import { drawPropLabel, type WorldText } from './art.js';
import {
  ALARM,
  AMBER,
  BLACK,
  BRASS,
  css,
  DONE_GREEN,
  EMERGENCY,
  INK,
  LABEL,
  lift,
  mix,
  PAPER,
  READ_BLUE,
  rgba,
  sink,
  STEEL,
  TEAL,
  WHITE,
} from './palette.js';

/**
 * Security drone: a hovering scanner whose cone of vision is drawn into the
 * world so players can read and dodge it. Both functions expect a context
 * scaled to tile units with the origin at the drone's position.
 */

/**
 * The sweeping cone, drawn under the body so the drone sits on top of it.
 * A frozen drone sees nothing, so it has none.
 */
export function drawDroneCone(
  ctx: CanvasRenderingContext2D,
  drone: DronePosition,
  pulse: number,
): void {
  if (drone.frozen) {
    return;
  }
  const half = (drone.halfAngleDeg * Math.PI) / 180;
  const tint = drone.alerted ? ALARM : AMBER;
  const gradient = ctx.createRadialGradient(0, 0, 0.2, 0, 0, drone.range);
  gradient.addColorStop(0, rgba(tint, drone.alerted ? 0.4 : 0.26));
  gradient.addColorStop(1, rgba(tint, 0));
  ctx.save();
  ctx.rotate(drone.facing);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, drone.range, -half, half);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = rgba(tint, 0.3 + 0.25 * pulse);
  ctx.lineWidth = 0.035;
  ctx.stroke();
  ctx.restore();
}

/** What a carryable looks like on the floor and in hand. */
export type CarryableKind = 'fuse' | 'key' | 'crate';

/**
 * A carryable's look, told from its label: a „Sicherung" is a fuse cartridge,
 * a „Schlüssel" a key, anything else a crate.
 */
export function carryableKind(label: string): CarryableKind {
  if (/sicherung/i.test(label)) {
    return 'fuse';
  }
  return /schl(?:ü|ue)ssel/i.test(label) ? 'key' : 'crate';
}

export interface CarryableOpts {
  /** the item's label: its look follows from it, and the floor shows it under the item */
  label: string;
  /** 0..1 looping pulse driven by the caller */
  pulse: number;
  /** riding above its carrier's head: a size smaller, with no shadow, glow or label */
  carried: boolean;
  /** the world's text at this zoom (art.ts's worldText); plain tiles when left out */
  text?: WorldText;
  /** how far the item rises off its shadow, in tiles: one named by the E prompt bobs */
  lift?: number;
  /**
   * what lies between its shadow and the item, drawn round its anchor as far up as the item
   * rises: the glow of one the E prompt names (render/highlight.ts)
   */
  glow?: (ctx: CanvasRenderingContext2D) => void;
  /** the thing alone — no shadow, glow or label: what its silhouette is baked from */
  bare?: boolean;
}

/** A carried item against one on the floor. */
const IN_HAND = 0.82;
/** A carryable's label, in the blue of its glow and its edge marker. */
const ITEM_LABEL = css(lift(READ_BLUE, 0.3));
const ITEM_EDGE = css(INK);
const C_BLUE = css(READ_BLUE);

/** The shadow under an item on the floor, and its blue glow. */
function drawItemGround(ctx: CanvasRenderingContext2D, pulse: number): void {
  ctx.fillStyle = rgba(BLACK, 0.45);
  ctx.beginPath();
  ctx.ellipse(0, 0.29, 0.32, 0.13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgba(READ_BLUE, 0.1 + 0.08 * pulse);
  ctx.beginPath();
  ctx.arc(0, 0, 0.8, 0, Math.PI * 2);
  ctx.fill();
}

/** A crate with a lit cross on its lid. */
function drawCrate(ctx: CanvasRenderingContext2D, pulse: number): void {
  const s = 0.36;
  ctx.fillStyle = css(sink(mix(STEEL, READ_BLUE, 0.4), 0.6));
  ctx.strokeStyle = C_BLUE;
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  ctx.roundRect(-s, -s, s * 2, s * 2, 0.07);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = rgba(READ_BLUE, 0.6 + 0.3 * pulse);
  ctx.lineWidth = 0.055;
  ctx.beginPath();
  ctx.moveTo(-s, 0);
  ctx.lineTo(s, 0);
  ctx.moveTo(0, -s);
  ctx.lineTo(0, s);
  ctx.stroke();
}

/** A cartridge fuse lying aslant: a ceramic body, metal caps, a blue band lit by the pulse. */
function drawFuse(ctx: CanvasRenderingContext2D, pulse: number): void {
  ctx.rotate(-0.4);
  ctx.strokeStyle = ITEM_EDGE;
  ctx.lineWidth = 0.022;
  ctx.fillStyle = css(lift(STEEL, 0.4));
  ctx.beginPath();
  ctx.roundRect(-0.31, -0.1, 0.12, 0.2, 0.025);
  ctx.roundRect(0.19, -0.1, 0.12, 0.2, 0.025);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = css(lift(PAPER, 0.3));
  ctx.beginPath();
  ctx.rect(-0.2, -0.08, 0.4, 0.16);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = rgba(BLACK, 0.16);
  ctx.fillRect(-0.2, 0.015, 0.4, 0.065);
  ctx.fillStyle = rgba(READ_BLUE, 0.65 + 0.3 * pulse);
  ctx.fillRect(-0.04, -0.08, 0.08, 0.16);
  ctx.fillStyle = rgba(WHITE, 0.4);
  ctx.fillRect(-0.3, -0.085, 0.1, 0.018);
  ctx.fillRect(0.2, -0.085, 0.1, 0.018);
}

/** A brass key lying aslant: a ring for a bow, a shaft with two bits, a glint on the bow. */
function drawKey(ctx: CanvasRenderingContext2D, pulse: number): void {
  ctx.rotate(-0.55);
  ctx.fillStyle = css(mix(BRASS, AMBER, 0.45));
  ctx.strokeStyle = css(sink(BRASS, 0.75));
  ctx.lineWidth = 0.02;
  ctx.beginPath();
  ctx.moveTo(-0.07, -0.032);
  for (const [x, y] of [
    [0.27, -0.032],
    [0.27, 0.095],
    [0.215, 0.095],
    [0.215, 0.032],
    [0.19, 0.032],
    [0.19, 0.075],
    [0.14, 0.075],
    [0.14, 0.032],
    [-0.07, 0.032],
  ] as const) {
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(-0.17, 0, 0.115, 0, Math.PI * 2);
  ctx.moveTo(-0.12, 0);
  ctx.arc(-0.17, 0, 0.05, 0, Math.PI * 2);
  ctx.fill('evenodd');
  ctx.stroke();
  ctx.fillStyle = rgba(WHITE, 0.35 + 0.4 * pulse);
  ctx.beginPath();
  ctx.arc(-0.21, -0.06, 0.02, 0, Math.PI * 2);
  ctx.fill();
}

/** The item itself, as its kind looks. */
function drawItem(ctx: CanvasRenderingContext2D, kind: CarryableKind, pulse: number): void {
  if (kind === 'fuse') {
    drawFuse(ctx, pulse);
  } else if (kind === 'key') {
    drawKey(ctx, pulse);
  } else {
    drawCrate(ctx, pulse);
  }
}

/**
 * A carryable: a fuse cartridge, a key, or a crate for anything else, as its
 * label says. On the floor it lies on its shadow in a blue glow — or hovers
 * `lift` over it, with its `glow` — its label under it like any prop's.
 * Anchor: its own centre, scaled to tile units.
 */
export function drawCarryable(ctx: CanvasRenderingContext2D, o: CarryableOpts): void {
  const dressed = !o.carried && o.bare !== true;
  ctx.save();
  if (dressed) {
    drawItemGround(ctx, o.pulse);
  }
  ctx.save();
  if (o.carried) {
    ctx.scale(IN_HAND, IN_HAND);
  }
  const lift = o.lift ?? 0;
  if (lift !== 0) {
    ctx.translate(0, -lift);
  }
  o.glow?.(ctx);
  drawItem(ctx, carryableKind(o.label), o.pulse);
  ctx.restore();
  if (dressed) {
    drawPropLabel(ctx, o.label.toUpperCase(), 0.41, ITEM_LABEL, o.text);
  }
  ctx.restore();
}

/** The marked spot a carryable has to end up on. */
export function drawDropZone(
  ctx: CanvasRenderingContext2D,
  filled: boolean,
  pulse: number,
): void {
  const accent = filled ? DONE_GREEN : READ_BLUE;
  ctx.save();
  ctx.strokeStyle = rgba(accent, 0.5 + 0.35 * pulse);
  ctx.lineWidth = 0.07;
  ctx.setLineDash([0.14, 0.1]);
  ctx.beginPath();
  ctx.roundRect(-0.42, -0.42, 0.84, 0.84, 0.08);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = css(accent);
  ctx.globalAlpha = filled ? 0.25 : 0.12 + 0.08 * pulse;
  ctx.fill();
  ctx.restore();
}

/**
 * Emergency valve panel, drawn at the tile centre: a wheel that glows red
 * while unmanned and locks in teal once someone is standing on it.
 */
export function drawSabotagePanel(
  ctx: CanvasRenderingContext2D,
  occupied: boolean,
  pulse: number,
): void {
  const accent = css(occupied ? TEAL : ALARM);
  ctx.save();
  ctx.fillStyle = occupied ? rgba(TEAL, 0.14 + 0.08 * pulse) : rgba(ALARM, 0.16 + 0.16 * pulse);
  ctx.beginPath();
  ctx.arc(0, 0, 0.85, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = css(sink(STEEL, 0.82));
  ctx.strokeStyle = accent;
  ctx.lineWidth = 0.06;
  ctx.beginPath();
  ctx.arc(0, 0, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // valve spokes, turning slowly while the emergency runs
  ctx.rotate(pulse * Math.PI);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 0.05;
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0.26, 0);
    ctx.stroke();
  }
  ctx.restore();
}

/** A drone's chassis, its rim, and the steel of the padlock over a frozen one. */
const CHASSIS = css(sink(STEEL, 0.75));
const CHASSIS_RIM = css(sink(mix(STEEL, READ_BLUE, 0.3), 0.45));
const LOCK = css(lift(LABEL, 0.55));

/** A padlock hanging over a frozen drone, upright whichever way the drone faces. */
function drawFrozenLock(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.translate(0, -0.44);
  ctx.strokeStyle = LOCK;
  ctx.lineWidth = 0.035;
  ctx.beginPath();
  ctx.moveTo(-0.055, 0.01);
  ctx.arc(0, -0.03, 0.055, Math.PI, 0);
  ctx.lineTo(0.055, 0.01);
  ctx.stroke();
  ctx.fillStyle = LOCK;
  ctx.beginPath();
  ctx.roundRect(-0.085, 0, 0.17, 0.12, 0.025);
  ctx.fill();
  ctx.fillStyle = CHASSIS;
  ctx.beginPath();
  ctx.arc(0, 0.05, 0.018, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * The „!" a drone wears for a second after an alarm (alarm.ts): a red badge
 * over it, upright whichever way it faces. It pops up at once and fades in
 * its last quarter; `age` runs from 0 to 1 over its second. Anchor: the
 * drone's position, scaled to tile units.
 */
export function drawAlarmMark(ctx: CanvasRenderingContext2D, age: number): void {
  if (age < 0 || age >= 1) {
    return;
  }
  const pop = 1 + 0.45 * Math.max(0, 1 - age * 8);
  ctx.save();
  ctx.globalAlpha *= Math.min(1, (1 - age) * 4);
  ctx.translate(0, -0.66);
  ctx.scale(pop, pop);
  ctx.fillStyle = css(EMERGENCY);
  ctx.strokeStyle = css(sink(EMERGENCY, 0.85));
  ctx.lineWidth = 0.035;
  ctx.beginPath();
  ctx.moveTo(-0.07, 0.15);
  ctx.lineTo(0, 0.29);
  ctx.lineTo(0.07, 0.15);
  ctx.arc(0, 0, 0.19, Math.PI * 0.32, Math.PI * 0.68, true);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = css(lift(EMERGENCY, 0.96));
  ctx.beginPath();
  ctx.roundRect(-0.032, -0.125, 0.064, 0.15, 0.02);
  ctx.moveTo(0.036, 0.085);
  ctx.arc(0, 0.085, 0.036, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * The drone itself: dark chassis, a glowing lens and a blinking beacon.
 * Frozen by its plate it hangs dimmed, lens grey and beacon off, under a lock.
 */
export function drawDroneBody(
  ctx: CanvasRenderingContext2D,
  drone: DronePosition,
  pulse: number,
): void {
  const accent = css(drone.frozen ? sink(LABEL, 0.1) : drone.alerted ? ALARM : AMBER);
  const alpha = drone.frozen ? 0.5 : 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = rgba(BLACK, 0.4);
  ctx.beginPath();
  ctx.ellipse(0, 0.26, 0.3, 0.12, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.rotate(drone.facing);
  ctx.fillStyle = CHASSIS;
  ctx.strokeStyle = CHASSIS_RIM;
  ctx.lineWidth = 0.035;
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.3, 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // lens on the facing side
  ctx.fillStyle = accent;
  ctx.globalAlpha = alpha * 0.85;
  ctx.beginPath();
  ctx.arc(0.18, 0, 0.09, 0, Math.PI * 2);
  ctx.fill();

  // beacon on top, blinking with the caller's pulse
  if (!drone.frozen) {
    ctx.globalAlpha = 0.35 + 0.65 * pulse;
    ctx.beginPath();
    ctx.arc(-0.14, 0, 0.055, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  if (drone.frozen) {
    drawFrozenLock(ctx);
  }
}

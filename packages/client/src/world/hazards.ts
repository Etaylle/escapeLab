import type { DronePosition } from '@escapelab/core';
import { drawPropLabel, type WorldText } from './art.js';

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
  const tint = drone.alerted ? '248,113,113' : '251,191,36';
  const gradient = ctx.createRadialGradient(0, 0, 0.2, 0, 0, drone.range);
  gradient.addColorStop(0, `rgba(${tint},${drone.alerted ? 0.4 : 0.26})`);
  gradient.addColorStop(1, `rgba(${tint},0)`);
  ctx.save();
  ctx.rotate(drone.facing);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, drone.range, -half, half);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = `rgba(${tint},${0.3 + 0.25 * pulse})`;
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
}

/** A carried item against one on the floor. */
const IN_HAND = 0.82;
/** A carryable's label, in the blue of its glow and its edge marker. */
const ITEM_LABEL = '#93c5fd';
const ITEM_EDGE = '#05080b';

/** The shadow under an item on the floor, and its blue glow. */
function drawItemGround(ctx: CanvasRenderingContext2D, pulse: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.ellipse(0, 0.29, 0.32, 0.13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `rgba(96,165,250,${0.1 + 0.08 * pulse})`;
  ctx.beginPath();
  ctx.arc(0, 0, 0.8, 0, Math.PI * 2);
  ctx.fill();
}

/** A crate with a lit cross on its lid. */
function drawCrate(ctx: CanvasRenderingContext2D, pulse: number): void {
  const s = 0.36;
  ctx.fillStyle = '#243447';
  ctx.strokeStyle = '#60a5fa';
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  ctx.roundRect(-s, -s, s * 2, s * 2, 0.07);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = `rgba(96,165,250,${0.6 + 0.3 * pulse})`;
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
  ctx.fillStyle = '#a7b1bc';
  ctx.beginPath();
  ctx.roundRect(-0.31, -0.1, 0.12, 0.2, 0.025);
  ctx.roundRect(0.19, -0.1, 0.12, 0.2, 0.025);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#e4dccb';
  ctx.beginPath();
  ctx.rect(-0.2, -0.08, 0.4, 0.16);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fillRect(-0.2, 0.015, 0.4, 0.065);
  ctx.fillStyle = `rgba(96,165,250,${0.65 + 0.3 * pulse})`;
  ctx.fillRect(-0.04, -0.08, 0.08, 0.16);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillRect(-0.3, -0.085, 0.1, 0.018);
  ctx.fillRect(0.2, -0.085, 0.1, 0.018);
}

/** A brass key lying aslant: a ring for a bow, a shaft with two bits, a glint on the bow. */
function drawKey(ctx: CanvasRenderingContext2D, pulse: number): void {
  ctx.rotate(-0.55);
  ctx.fillStyle = '#d4a63a';
  ctx.strokeStyle = '#3d2c0a';
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
  ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.4 * pulse})`;
  ctx.beginPath();
  ctx.arc(-0.21, -0.06, 0.02, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * A carryable: a fuse cartridge, a key, or a crate for anything else, as its
 * label says. On the floor it lies on its shadow in a blue glow, its label
 * under it like any prop's. Anchor: its own centre, scaled to tile units.
 */
export function drawCarryable(ctx: CanvasRenderingContext2D, o: CarryableOpts): void {
  const kind = carryableKind(o.label);
  ctx.save();
  if (!o.carried) {
    drawItemGround(ctx, o.pulse);
  }
  ctx.save();
  if (o.carried) {
    ctx.scale(IN_HAND, IN_HAND);
  }
  if (kind === 'fuse') {
    drawFuse(ctx, o.pulse);
  } else if (kind === 'key') {
    drawKey(ctx, o.pulse);
  } else {
    drawCrate(ctx, o.pulse);
  }
  ctx.restore();
  if (!o.carried) {
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
  const accent = filled ? '#4ade80' : '#60a5fa';
  ctx.save();
  ctx.strokeStyle = `rgba(${filled ? '74,222,128' : '96,165,250'},${0.5 + 0.35 * pulse})`;
  ctx.lineWidth = 0.07;
  ctx.setLineDash([0.14, 0.1]);
  ctx.beginPath();
  ctx.roundRect(-0.42, -0.42, 0.84, 0.84, 0.08);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = accent;
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
  const accent = occupied ? '#2dd4bf' : '#f87171';
  ctx.save();
  ctx.fillStyle = occupied
    ? `rgba(45,212,191,${0.14 + 0.08 * pulse})`
    : `rgba(248,113,113,${0.16 + 0.16 * pulse})`;
  ctx.beginPath();
  ctx.arc(0, 0, 0.85, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#131d26';
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

/** A padlock hanging over a frozen drone, upright whichever way the drone faces. */
function drawFrozenLock(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.translate(0, -0.44);
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 0.035;
  ctx.beginPath();
  ctx.moveTo(-0.055, 0.01);
  ctx.arc(0, -0.03, 0.055, Math.PI, 0);
  ctx.lineTo(0.055, 0.01);
  ctx.stroke();
  ctx.fillStyle = '#cbd5e1';
  ctx.beginPath();
  ctx.roundRect(-0.085, 0, 0.17, 0.12, 0.025);
  ctx.fill();
  ctx.fillStyle = '#1b2733';
  ctx.beginPath();
  ctx.arc(0, 0.05, 0.018, 0, Math.PI * 2);
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
  const accent = drone.frozen ? '#7d8f9e' : drone.alerted ? '#f87171' : '#fbbf24';
  const alpha = drone.frozen ? 0.5 : 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(0, 0.26, 0.3, 0.12, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.rotate(drone.facing);
  ctx.fillStyle = '#1b2733';
  ctx.strokeStyle = '#3b4c5e';
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

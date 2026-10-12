import type { DronePosition } from '@escapelab/core';

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

/** A carryable crate. Anchor: its own centre, scaled to tile units. */
export function drawCarryable(ctx: CanvasRenderingContext2D, pulse: number, carried: boolean): void {
  const s = carried ? 0.3 : 0.36;
  ctx.save();
  if (!carried) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(0, s * 0.8, s * 0.9, s * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(96,165,250,${0.1 + 0.08 * pulse})`;
    ctx.beginPath();
    ctx.arc(0, 0, 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
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

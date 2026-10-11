import type { DronePosition } from '@escapelab/core';

/**
 * Security drone: a hovering scanner whose cone of vision is drawn into the
 * world so players can read and dodge it. Both functions expect a context
 * scaled to tile units with the origin at the drone's position.
 */

/** The sweeping cone, drawn under the body so the drone sits on top of it. */
export function drawDroneCone(
  ctx: CanvasRenderingContext2D,
  drone: DronePosition,
  pulse: number,
): void {
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

/** The drone itself: dark chassis, a glowing lens and a blinking beacon. */
export function drawDroneBody(
  ctx: CanvasRenderingContext2D,
  drone: DronePosition,
  pulse: number,
): void {
  const accent = drone.alerted ? '#f87171' : '#fbbf24';
  ctx.save();
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
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.arc(0.18, 0, 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // beacon on top, blinking with the caller's pulse
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.35 + 0.65 * pulse;
  ctx.beginPath();
  ctx.arc(-0.14, 0, 0.055, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

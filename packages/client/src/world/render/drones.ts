import type { DronePosition } from '@escapelab/core';
import { figurePhase } from '../figure.js';
import {
  HOTSPOT_R,
  hotspotOf,
  navLights,
  navSpots,
  searchColour,
  type NavLights,
} from '../droneLights.js';
import { DONE_GREEN, EMERGENCY, lift, type Rgb } from '../palette.js';
import { toScreen, type Frame } from './frame.js';
import { drawRadial, type RadialStops } from './radial.js';

/**
 * The drones' lights over the picture (world/droneLights.ts), on either path alike, added over
 * the light as the flashlights' glints are (render/beam.ts): each eye's hotspot on the floor
 * ahead of it, amber-white or red as it is alerted, and the glow of the nav lights that burn.
 */

/** How strongly a hotspot is added over the floor. */
const HOTSPOT_ALPHA = 0.5;
/** How far a nav light's glow reaches, tiles. */
const NAV_GLOW = 0.2;

/** A hotspot's light in `rgb`: bright in its middle, soft out to its rim. */
function hotspotStops(rgb: Rgb): RadialStops {
  return [
    [0, lift(rgb, 0.4), 0.55],
    [0.45, rgb, 0.22],
    [1, rgb, 0],
  ];
}

/** A nav light's glow in `rgb`: a hot dot, its colour round it. */
function navStops(rgb: Rgb): RadialStops {
  return [
    [0, lift(rgb, 0.7), 0.95],
    [0.3, rgb, 0.55],
    [1, rgb, 0],
  ];
}

const HOTSPOT = {
  calm: hotspotStops(searchColour(false)),
  alerted: hotspotStops(searchColour(true)),
};
const NAV = { port: navStops(EMERGENCY), starboard: navStops(DONE_GREEN) };

/** How brightly the nav lights of the drone `id` burn this frame. */
export function navOf(frame: Frame, id: string): NavLights {
  return navLights(frame.time * 1000, figurePhase(id), frame.reduced);
}

/** Lays the radial `stops` round the world point (x, y), `r` tiles out, at `alpha`. */
function glowAt(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  [x, y, r]: readonly [number, number, number],
  [stops, alpha]: readonly [RadialStops, number],
): void {
  const [sx, sy] = toScreen(frame, x, y);
  ctx.globalAlpha = alpha;
  drawRadial(ctx, frame.kit.radials, stops, [sx, sy, r * frame.camera.scale], frame);
}

/** The lights of one drone: its eye's hotspot where it looks, its nav lights that burn. */
function drawDrone(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  [id, drone]: readonly [string, DronePosition],
): void {
  const eye = frame.light.eyes.get(id);
  const spot = eye === undefined ? null : hotspotOf(drone, eye.sight);
  if (spot !== null) {
    const stops = drone.alerted ? HOTSPOT.alerted : HOTSPOT.calm;
    glowAt(ctx, frame, [spot.x, spot.y, HOTSPOT_R], [stops, HOTSPOT_ALPHA]);
  }
  if (drone.frozen) {
    return;
  }
  const nav = navOf(frame, id);
  const { port, starboard } = navSpots(drone);
  if (nav.port > 0) {
    glowAt(ctx, frame, [port.x, port.y, NAV_GLOW], [NAV.port, nav.port]);
  }
  if (nav.starboard > 0) {
    glowAt(ctx, frame, [starboard.x, starboard.y, NAV_GLOW], [NAV.starboard, nav.starboard]);
  }
}

/** The drones' hotspots and nav lights, added over the picture. */
export function drawDroneFlares(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const drones = Object.entries(frame.drones);
  if (drones.length === 0) {
    return;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  for (const entry of drones) {
    drawDrone(ctx, frame, entry);
  }
  ctx.restore();
}

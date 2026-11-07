import type { DronePosition, Sight } from '@escapelab/core';
import { clearAlong } from './beam.js';
import { TAU } from './brush.js';
import { ALARM, AMBER, lift, type Rgb } from './palette.js';

/**
 * A security drone as one reads at a glance in the dark: two nav lights blinking red and green
 * at NAV_HZ, port and starboard, half a beat apart; its searchlight's hotspot on the floor ahead
 * where its eye looks, sweeping with it as it turns — amber-white, red while it is alerted, as
 * its cone is (hazards.ts); its rotors a blur round its body. Under reduced motion the nav lights
 * burn steadily and the rotors' blur holds still. Pure: render/drones.ts lays the lights over
 * the picture on either path, hazards.ts draws the body.
 */

/** How often a nav light blinks, a second. */
export const NAV_HZ = 1;
/** How much of each beat a nav light burns. */
export const NAV_ON = 0.3;
/** Where a drone's nav lights sit from its middle, tiles: a little aft, either side across. */
export const NAV_AFT = 0.03;
export const NAV_SIDE = 0.24;

/** How brightly a drone's nav lights burn, 0 to 1: port red, starboard green. */
export interface NavLights {
  port: number;
  starboard: number;
}

/** Whether a light blinking at NAV_HZ burns `beat` beats into its blinking. */
function burns(beat: number): number {
  return beat - Math.floor(beat) < NAV_ON ? 1 : 0;
}

/**
 * A drone's nav lights `ms` into the run, `phase` (0 to 1) its own offset into the beat: each
 * burning NAV_ON of a beat, the green half a beat after the red; both steady under reduced
 * motion.
 */
export function navLights(ms: number, phase: number, reduced: boolean): NavLights {
  if (reduced) {
    return { port: 1, starboard: 1 };
  }
  const beat = (ms / 1000) * NAV_HZ + phase;
  return { port: burns(beat), starboard: burns(beat + 0.5) };
}

/**
 * Where a drone's nav lights hang in the world, tiles: port on its left as it faces — north of
 * a drone facing east, the screen's y growing downward — starboard on its right.
 */
export function navSpots(
  drone: Pick<DronePosition, 'x' | 'y' | 'facing'>,
): { port: { x: number; y: number }; starboard: { x: number; y: number } } {
  const cos = Math.cos(drone.facing);
  const sin = Math.sin(drone.facing);
  const at = (side: number) => ({
    x: drone.x - cos * NAV_AFT - sin * side,
    y: drone.y - sin * NAV_AFT + cos * side,
  });
  return { port: at(-NAV_SIDE), starboard: at(NAV_SIDE) };
}

/** Where along its eye a drone's hotspot falls, a share of its range. */
export const HOTSPOT_AT = 0.55;
/** How far the hotspot spreads round its middle, tiles. */
export const HOTSPOT_R = 0.8;

/**
 * Where a drone's searchlight falls brightest on the floor: HOTSPOT_AT of its range ahead where
 * its eye looks — nearer where its sight (`sight`) ends before — sweeping with it as it turns.
 * None for a frozen drone, which sees nothing, nor where the floor ahead ends within half that.
 */
export function hotspotOf(
  drone: DronePosition,
  sight: Pick<Sight, 'tiles'>,
): { x: number; y: number } | null {
  if (drone.frozen) {
    return null;
  }
  const want = drone.range * HOTSPOT_AT;
  const free = clearAlong(sight, drone, want);
  if (free < want / 2) {
    return null;
  }
  const d = Math.min(want, free);
  return { x: drone.x + Math.cos(drone.facing) * d, y: drone.y + Math.sin(drone.facing) * d };
}

/** The colour of a drone's searchlight: amber-white, red while it is alerted. */
export function searchColour(alerted: boolean): Rgb {
  return alerted ? ALARM : lift(AMBER, 0.55);
}

/** How many turns a second a drone's rotors make, as their blur shows them. */
export const ROTOR_HZ = 3;

/** How far a drone's rotors' blur has turned `ms` into the run, radians: still when reduced. */
export function rotorAngle(ms: number, reduced: boolean): number {
  return reduced ? 0 : (((ms / 1000) * ROTOR_HZ) % 1) * TAU;
}

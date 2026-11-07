import { TAU } from './brush.js';
import type { LampMount, Stops, TintStops } from './light.js';
import { EMERGENCY, lift, type Rgb } from './palette.js';

/**
 * The emergency lamps as the rotating beacons they turn into once the lights fail — the way
 * Alien: Isolation lights its corridors: each burning lamp turns two lobes of red light, opposite
 * each other, round the place it hangs, a full turn every BEACON_TURN_MS — a slow sweep of
 * BEACON_TURN_REDUCED_MS where the player asked for less motion — each lamp at a phase of its own
 * from where it hangs, so that no two sweep in step. The lobes turn smoothly, frame by frame:
 * their tips outrun a walking crew member, as only a short's sparks may besides (the art bible's
 * motion rule). Pure: the WebGL light layer lights each lobe as a moving light with its falloff,
 * walls and shut doors stopping it (gl/sources.ts), and the Canvas pass lays each lobe from a
 * sprite baked a step of the turn at a time (render/beacons.ts).
 */

/** One full turn of a beacon, ms; and of one under reduced motion, a slow sweep. */
export const BEACON_TURN_MS = 3000;
export const BEACON_TURN_REDUCED_MS = 6000;
/** How far a lobe reaches from its lamp, tiles, and how wide it opens either way of its axis. */
export const LOBE_REACH = 2.7;
export const LOBE_HALF = 0.3;
/** How far, radians, a lobe's edge fades out past LOBE_HALF on the light layer. */
export const LOBE_SOFT = 0.16;

/** How deep a lobe clears the darkness along its reach: the floor in its path lit. */
export const BEACON_STOPS: Stops = [
  [0, 0.7],
  [0.3, 0.42],
  [1, 0],
];

/** The red a lobe adds over the dark, from its lamp out: whiter where it leaves the lens. */
export const BEACON_TINT: TintStops = [
  [0, lift(EMERGENCY, 0.42), 0.62],
  [0.12, lift(EMERGENCY, 0.12), 0.38],
  [0.5, EMERGENCY, 0.13],
  [1, EMERGENCY, 0],
];
/** The soft red bloom round a burning beacon's lens on the Canvas pass: its colour and reach. */
export const BLOOM_RGB: Rgb = lift(EMERGENCY, 0.2);
export const BLOOM_REACH = 0.8;

/** A share of 1 that a number always gives, its neighbours not. */
function share(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

/** Where in its turn the beacon hanging at `mount` starts, 0 to 1: its own, from where it hangs. */
export function beaconPhase(mount: Pick<LampMount, 'x' | 'y'>): number {
  return share(Math.round(mount.x * 97) * 31 + Math.round(mount.y * 89) + 0.5);
}

/** How long a beacon takes to turn once, ms: slower where the player asked for less motion. */
export function beaconTurnMs(reduced: boolean): number {
  return reduced ? BEACON_TURN_REDUCED_MS : BEACON_TURN_MS;
}

/**
 * Where the first lobe of a beacon at `phase` points `ms` into its sweep, radians from 0 (east)
 * toward π/2 (south), 0 to 2π: a full turn every BEACON_TURN_MS, or BEACON_TURN_REDUCED_MS.
 */
export function beaconAngle(ms: number, phase: number, reduced: boolean): number {
  const turns = ms / beaconTurnMs(reduced) + phase;
  return (turns - Math.floor(turns)) * TAU;
}

/** The two lobes of a beacon whose first points at `angle`: opposite each other, 0 to 2π. */
export function lobesAt(angle: number): readonly [number, number] {
  const back = angle + Math.PI;
  return [angle, back >= TAU ? back - TAU : back];
}

/** How far a lobe's light spreads either way of its axis at the most, radians: its soft edge. */
export const LOBE_SPREAD = LOBE_HALF * 1.3;

/**
 * The lobes of a beacon at `mount` whose first points at `angle` that reach out into the room:
 * both for a lamp on the ceiling; for one on a wall (`facing`, the way its face looks), those
 * whose light leaves the wall's plane — the one turned into the wall lights nothing but the wall
 * beside the lens, which its bloom covers.
 */
export function lobesOut(mount: Pick<LampMount, 'facing'>, angle: number): number[] {
  const lobes = lobesAt(angle);
  const { facing } = mount;
  if (facing === null) {
    return [...lobes];
  }
  return lobes.filter((lobe) => {
    const off = Math.abs(Math.atan2(Math.sin(lobe - facing), Math.cos(lobe - facing)));
    return off < Math.PI / 2 + LOBE_SPREAD;
  });
}

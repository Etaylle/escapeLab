import type { MapView } from '@escapelab/core';
import { smooth } from './ease.js';

/**
 * The lab's doors as the world draws them: a door that opens slides open
 * over DOOR_SLIDE_MS — with the hiss of audio.ts's `doorSlide` — and slides
 * back as it shuts; and where an open door joins a lit room to the dark, a
 * wedge of the room's light falls through it onto the dark side. Pure.
 */

/** A door slides open, or shut, over this long, ms. */
export const DOOR_SLIDE_MS = 350;
/** The wedge of light through a door: how far it reaches into the dark, in tiles … */
export const SPILL_REACH = 3.2;
/** … and how wide it opens on each side of its middle, radians. */
export const SPILL_HALF_ANGLE = 0.62;
/** Where in the doorway the wedge starts: this far from the door's middle towards the dark. */
const SPILL_INSET = 0.42;

type Door = MapView['doors'][number];

/** A door on its way: from how far open to how far (0 shut, 1 open), since when (epoch ms). */
export interface DoorMotion {
  from: number;
  to: number;
  since: number;
}

/** How far open the door is at `now`, 0 to 1: it eases in and out along its slide. */
export function doorOpenness(motion: DoorMotion, now: number): number {
  return motion.from + (motion.to - motion.from) * smooth((now - motion.since) / DOOR_SLIDE_MS);
}

/**
 * The door's motion now that the view says it is `open`: one seen for the
 * first time stands as it is; one that turns slides from wherever it stands
 * — from halfway, if it turns halfway — and `moved` says so.
 */
export function doorTurned(
  motion: DoorMotion | undefined,
  open: boolean,
  now: number,
): { motion: DoorMotion; moved: boolean } {
  const to = open ? 1 : 0;
  if (motion === undefined) {
    return { motion: { from: to, to, since: now - DOOR_SLIDE_MS }, moved: false };
  }
  if (motion.to === to) {
    return { motion, moved: false };
  }
  return { motion: { from: doorOpenness(motion, now), to, since: now }, moved: true };
}

/** Whether a door's bar runs left to right: walls, or other doors, on either side of it. */
export function isHorizontalDoor(map: Pick<MapView, 'tiles' | 'doors'>, door: Door): boolean {
  const doorCells = new Set(map.doors.map((d) => `${d.x},${d.y}`));
  const barrier = (bx: number, by: number): boolean =>
    map.tiles[by]?.charAt(bx) === '#' || doorCells.has(`${bx},${by}`);
  return barrier(door.x - 1, door.y) && barrier(door.x + 1, door.y);
}

/** Light falling through a door into the dark: from the doorway's dark edge, which way (radians). */
export interface Spill {
  doorId: string;
  x: number;
  y: number;
  facing: number;
}

/**
 * Where a lit room's light spills through `door` — open at least a crack —
 * when the floor on one side of it is lit (`lit`, by tile) and on the other
 * dark: from its doorway onto the dark side. Null for a shut door, and for
 * one with light or dark on both sides.
 */
export function spillThrough(
  map: Pick<MapView, 'tiles' | 'doors'>,
  door: Door,
  openness: number,
  lit: (x: number, y: number) => boolean,
): Spill | null {
  if (openness <= 0) {
    return null;
  }
  // Across a bar that runs left to right the rooms lie north and south of it.
  const [dx, dy] = isHorizontalDoor(map, door) ? [0, 1] : [1, 0];
  const before = lit(door.x - dx, door.y - dy);
  const after = lit(door.x + dx, door.y + dy);
  if (before === after) {
    return null;
  }
  // The light runs from the lit side to the dark one.
  const [sx, sy] = before ? [dx, dy] : [-dx, -dy];
  return {
    doorId: door.id,
    x: door.x + 0.5 + sx * SPILL_INSET,
    y: door.y + 0.5 + sy * SPILL_INSET,
    facing: Math.atan2(sy, sx),
  };
}

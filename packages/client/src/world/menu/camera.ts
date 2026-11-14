import { smooth } from '../ease.js';
import type { Spot } from './places.js';

/**
 * The scene's camera between the menu's places (places.ts): where on its bake a frame starts,
 * device px, travelling to the place of the item attended — or back to the drift, whose frame
 * moves on meanwhile — in a slow pan, easing out of where it stood and into where it goes; a new
 * aim starts a new travel from wherever the last has come to, and under reduced motion the camera
 * stands there at once. Pure.
 */

/** How long a travel takes: from its least, for a short way, to its most for the longest, ms. */
export const TRAVEL_MS = { least: 1200, most: 2000 } as const;
/** How much longer a travel takes for each CSS px of its way, ms. */
const MS_PER_PX = 1.1;

/** The camera as it goes: what it goes to, where it stood at the last frame, its travel. */
export interface SceneCamera {
  /** the item whose place it goes to or stands at; null for the drift */
  aimed: string | null;
  /** where on its bake its frame started at the last frame, device px; null before the first */
  at: Spot | null;
  /** the travel it is on: from where, since when and how long, ms; null once it has arrived */
  travel: { from: Spot; since: number; ms: number } | null;
}

/** A camera that has framed nothing yet: its first frame stands where it is aimed. */
export function newCamera(): SceneCamera {
  return { aimed: null, at: null, travel: null };
}

/** How long a travel of `distance` device px takes at `dpr` device px a CSS px, ms. */
export function travelMs(distance: number, dpr: number): number {
  const css = distance / Math.max(1, dpr);
  return Math.min(TRAVEL_MS.most, TRAVEL_MS.least + css * MS_PER_PX);
}

/** The point `share` of the way from `a` to `b`, in whole pixels. */
function between(a: Spot, b: Spot, share: number): Spot {
  return { x: Math.round(a.x + (b.x - a.x) * share), y: Math.round(a.y + (b.y - a.y) * share) };
}

/**
 * Where `camera` stands at `now`, device px on its bake, aimed at `aim` — an item's place, or
 * null for the drift — whose frame starts at `goal` now: a new travel where the aim has changed,
 * from where the camera stood; at the goal once a travel is over, or at once under `reduced` and
 * on the camera's first frame.
 */
export function cameraAt(
  camera: SceneCamera,
  [aim, goal]: readonly [string | null, Spot],
  now: number,
  [dpr, reduced]: readonly [number, boolean],
): Spot {
  const from = camera.at;
  if (from === null || reduced) {
    Object.assign(camera, { aimed: aim, at: goal, travel: null });
    return goal;
  }
  if (aim !== camera.aimed) {
    const distance = Math.hypot(goal.x - from.x, goal.y - from.y);
    camera.aimed = aim;
    camera.travel = { from, since: now, ms: travelMs(distance, dpr) };
  }
  const { travel } = camera;
  const u = travel === null ? 1 : Math.min(1, Math.max(0, (now - travel.since) / travel.ms));
  const at = travel === null ? goal : between(travel.from, goal, smooth(u));
  camera.travel = u >= 1 ? null : travel;
  camera.at = at;
  return at;
}

/** Whether `camera` is on its way somewhere: a frame now draws the scene anew. */
export function travelling(camera: SceneCamera): boolean {
  return camera.travel !== null;
}

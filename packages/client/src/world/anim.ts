/**
 * The bible's motion rule as a clock: the lab's ambient motion — fans,
 * scrolling screens, blinking LEDs, the core's pulse, steam and dust — moves
 * slowly and in small steps, updated at most ANIM_HZ times a second however
 * fast the frames come, and nothing in it outruns a walking crew member but
 * the sparks of a short.
 */

/** How often a second the ambient motion and the particles step. */
export const ANIM_HZ = 15;

/** How fast the crew walks, tiles a second (sim.ts): nothing ambient moves faster. */
export const WALK_SPEED = 4.2;

/** The step of the animation clock at sim time `time` (s): it counts ANIM_HZ a second. */
export function animTick(time: number): number {
  return Math.floor(time * ANIM_HZ);
}

/** The animation clock at sim time `time` (s), s: `time` held still between two steps. */
export function animTime(time: number): number {
  return animTick(time) / ANIM_HZ;
}

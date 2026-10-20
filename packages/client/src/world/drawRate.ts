/**
 * How often the world's canvas is drawn: on every animation frame while the
 * player moves in it, but on every LOCKED_DRAW_EVERY-th one only while a
 * panel, a source or a pause lies over it (input locked). Behind those it
 * shows dimmed, and redrawing it at full rate there only keeps the compositor
 * busy. The simulation and the position stream do not ask: they run on every
 * frame, so remote avatars move on and presence is unaffected.
 */

/** Under an open panel, the world is drawn on every LOCKED_DRAW_EVERY-th frame. */
export const LOCKED_DRAW_EVERY = 3;

/**
 * Whether the world is drawn on animation frame number `frame`, counted up
 * from the loop's start. The audience's world is always locked, for want of
 * controls rather than under a panel, so it keeps every frame.
 */
export function drawsFrame(
  frame: number,
  world: { locked: boolean; spectator: boolean },
): boolean {
  return !world.locked || world.spectator || frame % LOCKED_DRAW_EVERY === 0;
}

/** `t` held to 0…1 and eased in and out (smoothstep): a move that starts and stops softly. */
export function smooth(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

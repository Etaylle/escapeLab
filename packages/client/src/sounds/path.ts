/** The audition page's address: reached by it alone, as no menu leads there. */
export const SOUNDS_PATH = '/sounds';

/** Whether the address `pathname` opens the audition page rather than the game. */
export function opensSounds(pathname: string): boolean {
  return pathname === SOUNDS_PATH || pathname === `${SOUNDS_PATH}/`;
}

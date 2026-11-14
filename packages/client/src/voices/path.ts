/** The audition page of the radio's voices: reached by its address, as no menu leads there. */
export const VOICES_PATH = '/voices';

/** Whether the address `pathname` opens the voices' audition page rather than the game. */
export function opensVoices(pathname: string): boolean {
  return pathname === VOICES_PATH || pathname === `${VOICES_PATH}/`;
}

/** The recording page's address: reached by it alone, as no menu leads there. */
export const RECORD_PATH = '/record';

/** Whether the address `pathname` opens the recording page rather than the game. */
export function opensRecording(pathname: string): boolean {
  return pathname === RECORD_PATH || pathname === `${RECORD_PATH}/`;
}

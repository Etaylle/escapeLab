/**
 * The room's last chat lines on this page, the quick chat's and the typed ones alike, newest
 * last: what the chat's log shows (screens/TypedChat.tsx). Kept in memory only, and only for
 * the room the page is in — another room joined, or the room left, starts it empty. The world's bubbles and the
 * HUD's line read their own queue (ws.ts `chats`), which the render loop drains.
 */

/** How many lines the log keeps. */
export const CHAT_LOG_LINES = 8;

export interface LoggedLine {
  /** counts up for every line this page took in: a key for the list */
  n: number;
  playerId: string;
  text: string;
}

let lines: readonly LoggedLine[] = [];
/** the room the lines were said in */
let room: string | null = null;
let taken = 0;
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** A line said in the room. */
export function logLine(playerId: string, text: string): void {
  taken += 1;
  lines = [...lines, { n: taken, playerId, text }].slice(-CHAT_LOG_LINES);
  changed();
}

/** The page is in room `code` now, or in none (null): the lines of another room go. */
export function logRoom(code: string | null): void {
  if (code !== room) {
    room = code;
    lines = [];
    changed();
  }
}

/** For useSyncExternalStore: the lines now, the same array until a line comes or they go. */
export function loggedLines(): readonly LoggedLine[] {
  return lines;
}

/** For useSyncExternalStore: hears every change of the log. */
export function onLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

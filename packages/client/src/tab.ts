import type { Comeback } from './line.js';
import { resumeOf } from './snapshots.js';

/**
 * Where the tab keeps the room it is in, by its code: a reload or a new socket comes back to
 * it (`comebackOfTab`) — on the seat of the browser's pass (pass.ts), which every tab shares, or
 * for a tab that only watches, to the room's audience.
 */
const STORAGE_KEY = 'escapelab-session';

/** The room this tab is in: its code, and whether the tab only watches it. */
export interface TabRoom {
  code: string;
  watching: boolean;
}

/** The room this tab is in; null for none, or for what the tab cannot read back. */
export function tabRoom(): TabRoom | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const kept: unknown = raw === null ? null : JSON.parse(raw);
    if (typeof kept !== 'object' || kept === null) {
      return null;
    }
    const { code, watching } = kept as { code?: unknown; watching?: unknown };
    return typeof code === 'string' ? { code, watching: watching === true } : null;
  } catch {
    return null;
  }
}

/** The code of the room this tab is in; null for none. */
export function roomOfTab(): string | null {
  return tabRoom()?.code ?? null;
}

/** The tab is in `room` from now: every socket of it comes back there. */
export function keepTab(room: TabRoom): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(room));
}

/** The tab is in no room any more: no socket of it comes back to one. */
export function leaveTab(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

/**
 * What a socket of this tab says first as it opens (line.ts `Comeback`): its seat resumed on
 * the browser's pass, with the snapshot kept of the room (snapshots.ts), or the room watched
 * again; null where the tab is in no room.
 */
export function comebackOfTab(): Comeback | null {
  const room = tabRoom();
  if (room === null) {
    return null;
  }
  return room.watching ? { kind: 'spectate', code: room.code } : resumeOf(room.code);
}

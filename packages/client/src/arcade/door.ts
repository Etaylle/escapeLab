/**
 * The break-room machine's door, the little of it the page carries before the machine is opened
 * (the machine itself is a chunk of its own, Machine.tsx): where a player may open it, when it
 * closes by itself, and what the plant says as it does. The machine has no say in a room — it
 * sends nothing and changes nothing there — and stands open only while the player waits:
 *
 * - off any room: the main menu's „Arcade";
 * - in a lobby, until the run starts;
 * - in a run, only while the player waits — for the own line (`line`), for the server's
 *   maintenance (`pause`), or for somebody of the crew who is away (`crew`).
 *
 * The moment the thing waited for happens, the machine closes, its game paused, and one line in
 * the plant's voice says why (`closingLine`).
 */
import { useSyncExternalStore } from 'react';

/** What the player waits for where the machine may stand open; null where it may not. */
export type Wait = 'menu' | 'lobby' | 'line' | 'pause' | 'crew' | null;

/** The waits of a run: from one to another the machine stays open. */
const RUN_WAITS: readonly Wait[] = ['line', 'pause', 'crew'];

/** What the page knows of its room, as far as the waits need it. */
export interface WaitFacts {
  /** off any room, the audience left out */
  offRoom: boolean;
  /** the room's phase; null off any room */
  phase: 'lobby' | 'playing' | 'won' | 'lost' | null;
  /** the own line down in a run, or its comeback awaited (screens/Line.tsx `lineLost`) */
  lineLost: boolean;
  /** the run stands still for the server's maintenance (`pausedAt`) */
  maintenance: boolean;
  /** the crew misses somebody away it has not gone on without (screens/Pause.tsx) */
  missing: boolean;
}

/** What the player waits for, by the facts of the room. */
export function waitOf(f: WaitFacts): Wait {
  if (f.offRoom) return 'menu';
  if (f.phase === 'lobby') return 'lobby';
  if (f.phase !== 'playing') return null;
  if (f.lineLost) return 'line';
  if (f.maintenance) return 'pause';
  return f.missing ? 'crew' : null;
}

/** What the plant says as the machine closes because the wait `from` is over. */
const LINES: Readonly<Record<'lobby' | 'line' | 'pause' | 'crew', string>> = {
  lobby: 'Die Schicht beginnt.',
  line: 'Die Leitung steht wieder.',
  pause: 'Die Anlage läuft wieder.',
  crew: 'Der Einsatz geht weiter.',
};
/** What the plant says where a run is over while the machine stood open. */
export const RUN_OVER_LINE = 'Der Einsatz ist vorbei.';

/**
 * Whether the machine closes as the wait goes from `from` to `to`, and the line said then:
 * `undefined` where it stays open — the same wait, or one wait of a run for another —, a line
 * where the thing waited for came, null where it closes without a word (a room left, the menu
 * left for a room).
 */
export function closingLine(
  from: Wait,
  to: Wait,
  phase: WaitFacts['phase'],
): string | null | undefined {
  if (from === to || (RUN_WAITS.includes(from) && RUN_WAITS.includes(to))) return undefined;
  if (phase === 'won' || phase === 'lost') return from === 'menu' ? null : RUN_OVER_LINE;
  return lineAfter(from, to, phase);
}

/** The line for a wait of the lobby or a run that is over, where the run goes on. */
function lineAfter(from: Wait, to: Wait, phase: WaitFacts['phase']): string | null {
  if (from === 'lobby') return phase === 'playing' ? LINES.lobby : null;
  return (from === 'line' || from === 'pause' || from === 'crew') && to === null ? LINES[from] : null;
}

/** The machine as the page holds it: open or not, and the line its closing left. */
export interface Door {
  open: boolean;
  /** what the plant said as the machine closed by itself; null for none */
  line: string | null;
}

let door: Door = { open: false, line: null };
const listeners = new Set<() => void>();

function set(next: Door): void {
  door = next;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
/** The machine's door now. */
export function doorNow(): Door {
  return door;
}
/** The machine's door, kept up to date. */
export function useDoor(): Door {
  return useSyncExternalStore(subscribe, doorNow, doorNow);
}
/** Opens the machine — only where `wait` lets it. */
export function openArcade(wait: Wait): void {
  if (wait !== null && !door.open) set({ open: true, line: null });
}
/** Closes the machine: by the player (no line), or because what was waited for came. */
export function closeArcade(line: string | null = null): void {
  if (door.open || line !== door.line) set({ open: false, line });
}
/** The line said as the machine closed has been read. */
export function clearLine(): void {
  if (door.line !== null) set({ ...door, line: null });
}

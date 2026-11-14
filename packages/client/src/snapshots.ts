import {
  SNAPSHOT_MAX_AGE_MS,
  type ClientMessage,
  type PlayerView,
  type Seat,
  type ServerMessage,
} from '@escapelab/core';
import { localStore, type NoteStore } from './notes.js';
import { crewPass } from './pass.js';

/**
 * The newest snapshot of the room the browser sits in (server seal.ts), kept in its local
 * storage beside what the join screen's card shows of the room — the mission, the code, the
 * crew, the clock: a server that knows the room no more, after a deploy or a restart, takes it
 * up again from it. Every resume carries it; it goes once the run is over, the seat is given up,
 * or the server will not have the seat back.
 */

/** Where the snapshot of a room is kept: this, then the room's code. */
export const SNAPSHOT_KEY = 'escapelab-snapshot:';

/** A room's snapshot as the server sent it. */
export type SnapshotMessage = Extract<ServerMessage, { kind: 'snapshot' }>;

/** A snapshot as the browser keeps it, with the room's card as it comes back from it. */
export interface KeptSnapshot {
  blob: string;
  seq: number;
  /** epoch ms, by the server's clock, the snapshot was taken */
  at: number;
  seat: Seat;
}

const keyOf = (code: string): string => `${SNAPSHOT_KEY}${code.toUpperCase()}`;

/**
 * The room `code` as its card shows it once it is taken up again from a snapshot taken at `at`
 * of what `view` shows: a run on stands still for the crew from then, its clock where the
 * snapshot left it.
 */
export function seatOf(code: string, view: PlayerView, at: number): Seat {
  const running = view.phase !== 'lobby';
  const clock = view.pausedAt ?? at;
  return {
    code,
    missionTitle: view.missionTitle,
    phase: running ? 'playing' : 'lobby',
    paused: running,
    crew: view.players.map((player) => player.name),
    leftMs: view.deadlineAt === null ? null : Math.max(0, view.deadlineAt - clock),
  };
}

/** Writes `value` under `key`; a browser that keeps nothing keeps none, and the page goes on. */
function write(store: NoteStore | null, key: string, value: string): void {
  try {
    store?.setItem(key, value);
  } catch (err) {
    console.warn(`[escapelab] no snapshot of the room is kept: ${String(err)}`);
  }
}

/**
 * Keeps `snapshot` of the room `code` — sent as the room goes on, or as the server goes down
 * for a restart — the newest, with its card as `view` shows the room.
 */
export function keepSnapshot(
  code: string,
  snapshot: Pick<SnapshotMessage, 'blob' | 'seq' | 'at'>,
  view: PlayerView,
  store: NoteStore | null = localStore(),
): void {
  const { blob, seq, at } = snapshot;
  const kept: KeptSnapshot = { blob, seq, at, seat: seatOf(code, view, at) };
  write(store, keyOf(code), JSON.stringify(kept));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPhase = (value: unknown): value is Seat['phase'] =>
  value === 'lobby' || value === 'playing';

const isNames = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((name) => typeof name === 'string');

const isClock = (value: unknown): value is number | null =>
  value === null || typeof value === 'number';

/** Whether `value` is a card as a kept snapshot carries it. */
function isSeat(value: unknown): value is Seat {
  if (!isRecord(value)) {
    return false;
  }
  const { code, missionTitle, phase, paused, crew, leftMs } = value;
  return (
    typeof code === 'string' &&
    typeof missionTitle === 'string' &&
    isPhase(phase) &&
    typeof paused === 'boolean' &&
    isNames(crew) &&
    isClock(leftMs)
  );
}

/** What `raw` keeps, where it is a kept snapshot; null for anything else. */
function keptOf(raw: string | null): KeptSnapshot | null {
  try {
    const value: unknown = raw === null ? null : JSON.parse(raw);
    if (!isRecord(value)) {
      return null;
    }
    const { blob, seq, at, seat } = value;
    const sound =
      typeof blob === 'string' && typeof seq === 'number' && typeof at === 'number' && isSeat(seat);
    return sound ? { blob, seq, at, seat } : null;
  } catch {
    return null;
  }
}

/** The snapshot kept of the room `code`; null for none, or for what cannot be read back. */
export function keptSnapshot(
  code: string,
  store: NoteStore | null = localStore(),
): KeptSnapshot | null {
  try {
    return keptOf(store?.getItem(keyOf(code)) ?? null);
  } catch {
    return null;
  }
}

/** What looking through every snapshot the browser keeps needs of its storage. */
export type KeptStore = Pick<Storage, 'length' | 'key' | 'getItem' | 'removeItem'>;

/**
 * Every snapshot `store` keeps, of whatever room, taken no more than SNAPSHOT_MAX_AGE_MS before
 * `now`. One older than that the server takes up again no more, and one that cannot be read
 * back is none: both go, so that the rooms a browser left without seeing their end never fill
 * its storage.
 */
function freshKept(store: KeptStore, now: number): KeptSnapshot[] {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key?.startsWith(SNAPSHOT_KEY) === true) {
      keys.push(key);
    }
  }
  const fresh: KeptSnapshot[] = [];
  for (const key of keys) {
    const kept = keptOf(store.getItem(key));
    if (kept !== null && now - kept.at <= SNAPSHOT_MAX_AGE_MS) {
      fresh.push(kept);
    } else {
      store.removeItem(key);
    }
  }
  return fresh;
}

/**
 * The card of the newest snapshot the browser keeps, taken no more than SNAPSHOT_MAX_AGE_MS
 * before `now` (`freshKept`): the room the join screen offers the way back to while the server
 * has none for the pass — after a deploy or a restart, before anybody of its crew is back; null
 * for none.
 */
export function keptSeat(
  store: KeptStore | null = localStore(),
  now: number = Date.now(),
): Seat | null {
  const fresh = store === null ? [] : freshKept(store, now);
  return fresh.sort((a, b) => b.at - a.at)[0]?.seat ?? null;
}

/**
 * Where the pass sits, as the join screen shows it: where the server says, and where it says
 * nowhere, the room of the newest snapshot the browser keeps (`keptSeat`).
 */
export function seatShown(seat: Seat | null): Seat | null {
  return seat ?? keptSeat();
}

/** The snapshot of the room `code` goes: the run is over, or the seat is no more the pass's. */
export function dropSnapshot(code: string, store: NoteStore | null = localStore()): void {
  store?.removeItem(keyOf(code));
}

/**
 * Every snapshot the browser keeps goes: the pass they were sent to is the device's no more — it
 * signed out, or switched accounts — and their seats wait for its account, not for this device.
 */
export function dropSnapshots(store: KeptStore | null = localStore()): void {
  if (store === null) {
    return;
  }
  const keys = Array.from({ length: store.length }, (_, i) => store.key(i));
  for (const key of keys) {
    if (key?.startsWith(SNAPSHOT_KEY) === true) {
      store.removeItem(key);
    }
  }
}

/** Back onto the seat in the room `code` on the browser's pass, with the snapshot kept of it. */
export function resumeOf(
  code: string,
  store: NoteStore | null = localStore(),
): Extract<ClientMessage, { kind: 'resume' }> {
  const blob = keptSnapshot(code, store)?.blob;
  return { kind: 'resume', code, pass: crewPass(store), ...(blob === undefined ? {} : { blob }) };
}

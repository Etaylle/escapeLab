import type { PlayerPosition } from '@escapelab/core';

/**
 * Where your own avatar stands by the server's word: where a run starts it,
 * and where a refused step puts it back. Every positions broadcast carries
 * the run it belongs to, by its `startedAt`; positions from another run —
 * the one before a rematch, say — tell nothing about this one.
 */

export interface Spot {
  x: number;
  y: number;
}

/** The latest positions broadcast: where everybody stands, and in which run. */
export interface KnownPositions {
  run: number | null;
  players: Record<string, PlayerPosition>;
}

/** A position this client streamed, and when (`performance.now()`). */
export interface Streamed extends Spot {
  at: number;
}

/** How far the server may have you from where you stand before you follow it, in tiles. */
export const SNAP_DISTANCE = 1;
/** How long a streamed position may take to come back in a broadcast, in ms. */
export const ECHO_MS = 1000;

/** The positions of `run`; none while the latest broadcast still belongs to another run. */
export function positionsOf(
  known: KnownPositions,
  run: number | null,
): Record<string, PlayerPosition> {
  return known.run === run ? known.players : {};
}

/**
 * Where your avatar starts `run`: where the server has you in this run —
 * which matters to a client coming back mid-run — or else the spawn you drew.
 */
export function startingSpot(
  known: KnownPositions,
  you: string,
  map: { yourSpawn: Spot },
  run: number | null,
): Spot {
  const placed = positionsOf(known, run)[you];
  return placed === undefined
    ? { x: map.yourSpawn.x + 0.5, y: map.yourSpawn.y + 0.5 }
    : { x: placed.x, y: placed.y };
}

/**
 * Where the server puts your avatar back, or null while it agrees with you.
 * A refused step leaves you where the server last took you, which then lies
 * more than SNAP_DISTANCE from where you stand. A position you streamed in
 * the last ECHO_MS is no correction: it is your own step, still on its way
 * back while you walked on.
 */
export function correction(
  known: KnownPositions,
  you: string,
  run: number | null,
  self: Spot,
  streamed: readonly Streamed[],
  now: number,
): Spot | null {
  const server = positionsOf(known, run)[you];
  if (server === undefined || Math.hypot(server.x - self.x, server.y - self.y) <= SNAP_DISTANCE) {
    return null;
  }
  const echo = streamed.some(
    (sent) => now - sent.at <= ECHO_MS && sent.x === server.x && sent.y === server.y,
  );
  return echo ? null : { x: server.x, y: server.y };
}

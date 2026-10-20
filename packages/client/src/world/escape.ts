import { useEffect, useRef } from 'react';
import type { MapView, PlayerView } from '@escapelab/core';
import { exitGrind, startSiren, stopSiren } from './audio.js';
import { STALE_MS } from './coldOpen.js';
import { smooth } from './ease.js';

/**
 * Act three, the escape: once every station is solved the hatch opens and
 * the crew has to get out. On this screen a siren starts, the world's light
 * turns from warm to red over RED_SHIFT_MS, and the hatch grinds open over
 * EXIT_GRIND_MS, a green-white glow spilling out of it — from the moment the
 * view with the hatch open arrived. A screen that comes in later than
 * STALE_MS after it opened — a reconnect, a late audience — finds it open
 * and the light red. Pure but for the hook at the end.
 */

/** The world's light turns from warm to red over this long, ms. */
export const RED_SHIFT_MS = 1000;
/** The hatch grinds open over this long, ms. */
export const EXIT_GRIND_MS = 2000;
/** It moves in this many jerks, each pushing a part of the way and then sticking. */
const JERKS = 4;
/** Of each jerk, the part spent moving; the rest it sticks. */
const PUSH = 0.7;

type Exit = NonNullable<MapView['exit']>;

/** Whether a run is in its escape: the hatch stands open. */
export function escaping(map: Pick<MapView, 'exit'> | null): boolean {
  return map?.exit?.open === true;
}

/**
 * When the escape began on this screen, epoch ms by its clock, for a view of
 * the hatch that arrived at `arrivedAt`: then — unless it opened more than
 * STALE_MS before, when it counts as long over. Null while it is shut.
 */
export function escapeSince(exit: Exit | null, arrivedAt: number): number | null {
  if (exit === null || !exit.open) {
    return null;
  }
  const openedAt = exit.openedAt ?? arrivedAt;
  const over = Math.max(RED_SHIFT_MS, EXIT_GRIND_MS);
  return arrivedAt - openedAt > STALE_MS ? arrivedAt - over : arrivedAt;
}

/** How far the light has turned from warm to red `ms` into the escape, 0 to 1. */
export function redShift(ms: number): number {
  return smooth(ms / RED_SHIFT_MS);
}

/**
 * How far the hatch has ground open `ms` into the escape, 0 to 1: heavy
 * leaves that move in jerks, sticking a moment after each push.
 */
export function exitOpening(ms: number): number {
  if (ms >= EXIT_GRIND_MS) {
    return 1;
  }
  if (ms <= 0) {
    return 0;
  }
  const jerks = (ms / EXIT_GRIND_MS) * JERKS;
  const done = Math.floor(jerks);
  return (done + smooth((jerks - done) / PUSH)) / JERKS;
}

/** A crew member on the escape's checklist: ticked off once on the hatch. */
export interface Mate {
  id: string;
  name: string;
  color: string;
  out: boolean;
}

/** The checklist of the escape: the connected crew in its order, ticked off on the hatch. */
export function escapeChecklist(players: PlayerView['players'], exit: Exit): Mate[] {
  return players
    .filter((player) => player.connected)
    .map(({ id, name, color }) => ({ id, name, color, out: exit.atExit.includes(id) }));
}

/** An escape that began on this screen this recently, ms, began here: its hatch grinds open. */
const FRESH_MS = 250;

/**
 * The escape's sounds on this screen: the siren for as long as it runs
 * (`live`: the run goes on), and the hatch grinding open where this screen
 * sees it open.
 */
export function useEscapeSounds(since: number | null, live: boolean): void {
  const on = since !== null && live;
  useEffect(() => {
    if (!on) {
      return undefined;
    }
    startSiren();
    return () => stopSiren();
  }, [on]);
  useEffect(() => {
    if (since !== null && Date.now() - since < FRESH_MS) {
      exitGrind();
    }
  }, [since]);
}

/**
 * When the escape began on this screen, kept for the run: null while the
 * hatch is shut, then `escapeSince` of the first view that had it open. A new
 * run starts over.
 */
export function useEscapeSince(exit: Exit | null, run: number | null): number | null {
  const kept = useRef<{ run: number | null; since: number | null }>({ run, since: null });
  if (kept.current.run !== run || exit === null || !exit.open) {
    kept.current = { run, since: null };
  }
  if (exit !== null && exit.open && kept.current.since === null) {
    kept.current.since = escapeSince(exit, Date.now());
  }
  return kept.current.since;
}

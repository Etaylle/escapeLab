import { useEffect, useRef, useState } from 'react';
import type { Lights } from '@escapelab/core';
import type { BlackoutCue } from './audio.js';

/**
 * The cold open: the lights failing on screen. A mission with an intro
 * starts with the power on — the lab lit and warm, the clock standing
 * still. The first view with the lights out starts a sequence on this
 * client's clock, from the moment that view arrived:
 *
 *   0–0.9 s   the light flickers: the whole scene drops a few times
 *   0.9 s     a bang, the hum dies, the screen goes black
 *   1.3 s     a click: the flashlights fade in over 0.3 s, the clock starts
 *             counting, the goal line comes up and mission control speaks
 *
 * Under reduced motion the flicker is one fade to black over the last
 * FADE_MS before the bang; the bang and the click stay. A view whose lights
 * went out more than STALE_MS ago — a reconnect, an audience that came late —
 * lands in the dark straight away. Pure but for the two hooks at the end,
 * which keep that moment for a screen.
 */

/** The light flickers this long, ms into the sequence; then the bang. */
export const FLICKER_MS = 900;
/** The click: the flashlights come up, and with them the clock and the goal. */
export const REVEAL_MS = 1300;
/** How long the flashlights take to come up after the click. */
export const BEAM_MS = 300;
/** The whole sequence. */
export const SEQUENCE_MS = REVEAL_MS + BEAM_MS;
/** Lights out longer ago than this when the view arrives: no sequence, straight into the dark. */
export const STALE_MS = 3000;

/** The flicker's drops of the whole scene: from, to (ms) and how deep, 0 to 1. */
const DROPS: readonly (readonly [number, number, number])[] = [
  [100, 170, 0.6],
  [290, 340, 0.85],
  [470, 510, 0.5],
  [640, 760, 0.9],
];
/** After the last drop the light limps back this dim until the bang. */
const BROWNOUT = 0.3;
/** Under reduced motion the light fades to black over this long before the bang, ms. */
export const FADE_MS = 300;

/**
 * When the sequence starts on this client, epoch ms by its own clock, for a
 * view of the lights that arrived at `arrivedAt` in the run started at
 * `startedAt`: then — unless the lights went out longer than STALE_MS
 * before, or were out from the start, as in a mission without an intro;
 * then the sequence counts as long over. Null while the lights are on.
 */
export function darkSince(
  lights: Lights,
  startedAt: number | null,
  arrivedAt: number,
): number | null {
  if (!lights.out) {
    return null;
  }
  const outAt = lights.outAt ?? arrivedAt;
  const missed = outAt === startedAt || arrivedAt - outAt > STALE_MS;
  return missed ? arrivedAt - SEQUENCE_MS : arrivedAt;
}

/** Whether a run opens with the power on: its lights are on, or went out after its start. */
export function opensLit(lights: Lights, startedAt: number | null): boolean {
  return !lights.out || lights.outAt !== startedAt;
}

/** The world at one moment of the cold open. */
export interface ColdOpenFrame {
  /** the power on: the lab lit and warm, no darkness, every object drawn */
  lit: boolean;
  /** how far black covers the world, 0 to 1 */
  cover: number;
}

/**
 * The world `ms` into the sequence; null while the lights are on. The cover
 * stays black from the bang to the click, then lifts as the lamps come up.
 * Under reduced motion (`reduced`) the light fades out once instead of
 * flickering.
 */
export function coldOpenFrame(ms: number | null, reduced = false): ColdOpenFrame {
  if (ms === null) {
    return { lit: true, cover: 0 };
  }
  if (ms < FLICKER_MS) {
    return { lit: true, cover: reduced ? fade(ms) : flicker(ms) };
  }
  if (ms < REVEAL_MS) {
    return { lit: false, cover: 1 };
  }
  return { lit: false, cover: Math.max(0, 1 - (ms - REVEAL_MS) / BEAM_MS) };
}

/** How far the flickering light has dropped `ms` into the sequence, 0 to 1. */
function flicker(ms: number): number {
  const drop = DROPS.find(([from, to]) => ms >= from && ms < to);
  if (drop !== undefined) {
    return drop[2];
  }
  const last = DROPS.at(-1);
  return last !== undefined && ms >= last[1] ? BROWNOUT : 0;
}

/** How far the light has faded out `ms` into the sequence under reduced motion, 0 to 1. */
function fade(ms: number): number {
  return Math.min(1, Math.max(0, (ms - (FLICKER_MS - FADE_MS)) / FADE_MS));
}

/**
 * When the sounds of the sequence come, `elapsed` ms into it: the drops
 * still ahead, the bang and the click, in seconds from now — so that they
 * fall where the screen shows them. Under reduced motion the light drops
 * nowhere, so nothing arcs: the bang and the click alone.
 */
export function blackoutCue(elapsed: number, reduced = false): BlackoutCue {
  const ahead = (ms: number): number => Math.max(0, (ms - elapsed) / 1000);
  const drops = reduced ? [] : DROPS.filter(([, to]) => to > elapsed);
  return {
    drops: drops.map(([from, to]) => [ahead(from), ahead(to)]),
    bang: ahead(FLICKER_MS),
    click: ahead(REVEAL_MS),
  };
}

/** Whether the sequence started at `since` (epoch ms) has come to the click by `now`. */
export function revealed(since: number | null, now: number): boolean {
  return since !== null && now >= since + REVEAL_MS;
}

/**
 * The moment the lights went out on this screen, kept for the run: null
 * while they are on, then `darkSince` of the first view that had them out.
 * A new run — a rematch — starts over.
 */
export function useDarkSince(lights: Lights, run: number | null): number | null {
  const kept = useRef<{ run: number | null; since: number | null }>({ run, since: null });
  if (kept.current.run !== run || !lights.out) {
    kept.current = { run, since: null };
  }
  if (lights.out && kept.current.since === null) {
    kept.current.since = darkSince(lights, run, Date.now());
  }
  return kept.current.since;
}

/** Whether the sequence started at `since` has come to the click, re-rendering when it does. */
export function useRevealed(since: number | null): boolean {
  const [, setTick] = useState(0);
  const wait = since === null ? null : since + REVEAL_MS - Date.now();
  useEffect(() => {
    if (wait === null || wait <= 0) {
      return undefined;
    }
    const timer = setTimeout(() => setTick((t) => t + 1), wait);
    return () => clearTimeout(timer);
  }, [wait]);
  return revealed(since, Date.now());
}

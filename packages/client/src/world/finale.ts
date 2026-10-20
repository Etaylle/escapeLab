import { useEffect, useRef, useState } from 'react';
import type { MapView, Phase, RunOutcome } from '@escapelab/core';
import { useMedia } from '../hooks.js';
import {
  klaxonFade,
  lightsOnClick,
  powerDrain,
  startPowerHum,
  stopAmbience,
} from './audio.js';
import { STALE_MS } from './coldOpen.js';
import { smooth } from './ease.js';
import { warmUp } from './rooms.js';

/**
 * The end of a run on screen, mirroring the cold open (coldOpen.ts). From
 * the moment the view of the end arrived:
 *
 *   won    0–1.2 s  the siren stops, every room's light comes on warm — the
 *                   whole lab lit, no darkness left — and the camera pulls
 *                   back to show all of it
 *          1.2 s    a white fade over 0.6 s
 *          1.8 s    the end screen, its title card coming up out of the white
 *   lost   0–1.5 s  the hum dies (time) or the klaxon fades (alarms) while the
 *                   light dies to black
 *          1.5 s    the end screen, its card coming up out of the black
 *
 * A screen whose view of the end arrives more than STALE_MS after it — a
 * reconnect, an audience come late — or that never saw the run lands on the
 * end screen straight away. Under reduced motion the camera cuts instead of
 * moving, the lights come on without flicker and every fade takes a third
 * as long. Pure but for the hook at the end.
 */

/** How a run ended, as the end screen tells it; the run report's outcome. */
export type Ending = RunOutcome;

/** Won: the camera pulls back over the lab this long, ms … */
export const PULLBACK_MS = 1200;
/** … then the picture fades to white over this long. */
export const WHITE_MS = 600;
/** Lost: the light dies to black over this long. */
export const DIM_MS = 1500;
/** Under reduced motion a fade takes this share of its time. */
const REDUCED_FADE = 1 / 3;
/** The media query of a player who asked for less motion. */
export const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** What the ending reads off a view, a player's or the audience's. */
export interface FinaleSource {
  phase: Phase;
  startedAt: number | null;
  finishedAt: number | null;
  alarms: { count: number; limit: number | null };
  map: MapView | null;
}

/**
 * How the run of `view` ended; null while it runs. Only the alarm that
 * reaches the limit ends a run early, so a lost run at the limit hit it —
 * the run report's reading (core/report.ts).
 */
export function endingOf(view: Pick<FinaleSource, 'phase' | 'alarms'>): Ending | null {
  if (view.phase === 'won') {
    return 'won';
  }
  if (view.phase !== 'lost') {
    return null;
  }
  const { count, limit } = view.alarms;
  return limit !== null && count >= limit ? 'lost:alarms' : 'lost:time';
}

/** The fade that closes the ending: from when into it (ms), over how long, to which colour. */
export interface Veil {
  delay: number;
  duration: number;
  tone: 'white' | 'black';
}

export function veilOf(ending: Ending, reduced: boolean): Veil {
  const fade = reduced ? REDUCED_FADE : 1;
  return ending === 'won'
    ? { delay: PULLBACK_MS, duration: WHITE_MS * fade, tone: 'white' }
    : { delay: 0, duration: DIM_MS * fade, tone: 'black' };
}

/** How long the ending runs on a screen that plays it, ms. */
export function finaleMs(ending: Ending, reduced: boolean): number {
  const veil = veilOf(ending, reduced);
  return veil.delay + veil.duration;
}

/** The world at one moment of the ending. */
export interface FinaleFrame {
  /** how far every room's light is up, 0 to 1: the darkness lifts as it rises */
  lit: number;
  /** how far the camera has pulled back from the player to the whole lab, 0 to 1 */
  pull: number;
  /** how far the light has died, 0 to 1 */
  dark: number;
}

/** The world `ms` into the ending. */
export function finaleFrame(ending: Ending, ms: number, reduced = false): FinaleFrame {
  if (ending !== 'won') {
    return { lit: 0, pull: 0, dark: smooth(ms / veilOf(ending, reduced).duration) };
  }
  return {
    lit: reduced ? 1 : warmUp(ms),
    pull: reduced ? 1 : smooth(ms / PULLBACK_MS),
    dark: 0,
  };
}

/**
 * When the ending starts on this screen, epoch ms by its clock, for the view
 * of the end that arrived at `arrivedAt`: then, where the screen saw the run
 * and the end came no more than STALE_MS before. Otherwise — a reload on the
 * end screen, a reconnect, a late audience — `duration` before, so that it
 * counts as over, and it was not played here.
 */
export function finaleStart(
  finishedAt: number | null,
  sawRun: boolean,
  arrivedAt: number,
  duration: number,
): { since: number; played: boolean } {
  const played = sawRun && finishedAt !== null && arrivedAt - finishedAt <= STALE_MS;
  return { since: played ? arrivedAt : arrivedAt - duration, played };
}

/** The ending as a screen lives it. */
export interface Finale {
  ending: Ending;
  /** when it started on this screen, epoch ms; long ago where it was skipped */
  since: number;
  /** the last map of the run this screen showed: the world plays the ending on it */
  map: MapView | null;
  /** the world still plays it: the end screen waits */
  running: boolean;
  /** this screen played it, so the end screen comes up out of its fade */
  played: boolean;
}

interface Kept {
  run: number | null;
  map: MapView | null;
  start: { since: number; played: boolean } | null;
}

/**
 * The ending of the run `view` shows, kept for the run: null while it
 * runs, then when it ended on this screen — re-rendering when it is over —
 * with the last map of the run. A new run starts over.
 */
export function useFinale(view: FinaleSource | null): Finale | null {
  const reduced = useMedia(REDUCED_MOTION);
  const run = view?.startedAt ?? null;
  const kept = useRef<Kept>({ run, map: null, start: null });
  if (kept.current.run !== run) {
    kept.current = { run, map: null, start: null };
  }
  const k = kept.current;
  if (view?.phase === 'playing' && view.map !== null) {
    k.map = view.map;
  }
  const ending = view === null ? null : endingOf(view);
  if (ending === null) {
    k.start = null;
  } else {
    k.start ??= finaleStart(
      view?.finishedAt ?? null,
      k.map !== null,
      Date.now(),
      finaleMs(ending, reduced),
    );
  }
  const end = ending === null || k.start === null ? null : k.start.since + finaleMs(ending, reduced);
  useRerenderAt(end);
  if (ending === null || k.start === null || end === null) {
    return null;
  }
  const { since, played } = k.start;
  return { ending, since, map: k.map, running: Date.now() < end, played };
}

/**
 * The ending's sounds, once as it starts on this screen: won, the lights
 * click on and the lab's hum comes back; lost on time, the hum of the dark
 * lab dies as the power drains; lost on alarms, the klaxon fades out.
 */
export function useFinaleSounds(cue: { ending: Ending; since: number } | null): void {
  const ending = cue?.ending ?? null;
  const since = cue?.since ?? null;
  useEffect(() => {
    if (ending === null || since === null) {
      return;
    }
    if (ending === 'won') {
      lightsOnClick();
      startPowerHum();
      return;
    }
    stopAmbience();
    if (ending === 'lost:time') {
      powerDrain();
    } else {
      klaxonFade();
    }
  }, [ending, since]);
}

/** Renders the component again at `at`, epoch ms; nothing for null or a moment past. */
function useRerenderAt(at: number | null): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const wait = at === null ? 0 : at - Date.now();
    if (wait <= 0) {
      return undefined;
    }
    const timer = setTimeout(() => setTick((t) => t + 1), wait);
    return () => clearTimeout(timer);
  }, [at]);
}

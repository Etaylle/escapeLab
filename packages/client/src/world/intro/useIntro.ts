import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ClientMessage, PlayerView } from '@escapelab/core';
import { typing } from '../../hooks.js';
import { addProbes } from '../../probes.js';
import { traceRequested } from '../frameTrace.js';
import { cutAnnouncement, paProbe, startAnnouncement, stopAnnouncement } from '../pa.js';
import { cueProbe, CUE_FADE_S, startCue, stopCue } from './cue.js';
import {
  bangAt,
  filmed,
  hintShown,
  introPhase,
  nextChange,
  skippable,
  titleAt,
  type IntroCue,
} from './sequence.js';

/**
 * The run's opening as one screen keeps it (sequence.ts): which opening it plays, when it began
 * here, when this player skipped it and when the lights went out on this screen — the
 * announcement over the loudspeakers (pa.ts) and the music (cue.ts) with it, Space or a tap to
 * skip, and a redraw at every moment the opening changes by itself.
 */

/** A mission's name card shows only on a screen that was there as its run started, ms. */
export const NAME_CARD_FRESH_MS = 4000;

/**
 * The opening this screen plays of the run in `view`, seen first at `now` (epoch ms): a
 * mission's intro while its lights still burn — skipped already where the server says this
 * player had seen enough of it before, as after a reload — or the name card of a mission
 * without one, on a screen there from the start; null for none.
 */
export function openingOf(view: PlayerView, now: number): IntroCue | null {
  if (view.phase !== 'playing' || view.startedAt === null) {
    return null;
  }
  const intro = view.intro;
  if (intro === undefined) {
    const fresh = now - view.startedAt < NAME_CARD_FRESH_MS;
    const card = { since: now, lightsSec: null, skippedAt: null, outAt: null, closing: false };
    return fresh ? card : null;
  }
  if (view.lights.out) {
    return null;
  }
  const skippedAt = intro.done.includes(view.you.id) ? now : null;
  return { since: now, lightsSec: intro.lightsSec, skippedAt, outAt: null, closing: false };
}

/**
 * Whether this player's skip would end the intro for the whole crew: everybody else present
 * has said so already, and the lights go out on it.
 */
export function closesIntro(view: PlayerView): boolean {
  const done = view.intro?.done ?? [];
  return view.players
    .filter((player) => player.connected && player.id !== view.you.id)
    .every((player) => done.includes(player.id));
}

/**
 * What a press to skip does at `now`: the opening skipped from then — `closing` it for the
 * whole crew where the rest have skipped already — and whether the room is told: an intro's
 * skip counts towards the lights going out, a name card's is this screen's alone; null where
 * nothing can be skipped now.
 */
export function skipAt(
  cue: IntroCue | null,
  now: number,
  closing = false,
): { cue: IntroCue; tells: boolean } | null {
  if (cue === null || !skippable(cue, now)) {
    return null;
  }
  const intro = cue.lightsSec !== null;
  return { cue: { ...cue, skippedAt: now, closing: intro && closing }, tells: intro };
}

/** Whether a key going down asks to skip: Space, on its own, not repeated, not into a field. */
export function skipKey(
  e: Pick<KeyboardEvent, 'key' | 'repeat' | 'altKey' | 'ctrlKey' | 'metaKey'>,
): boolean {
  return e.key === ' ' && !e.repeat && !e.altKey && !e.ctrlKey && !e.metaKey && !typing();
}

/** What the opening on this screen is, and how to skip it. */
export interface Intro {
  /** the opening as this screen lives it; null where it plays none */
  readonly cue: IntroCue | null;
  /** skips it, where it can be skipped now */
  readonly skip: () => void;
}

/** What the walkthrough reads of the opening (`window.__escapelab.intro`). */
export interface IntroProbe {
  phase: string | null;
  filmed: boolean;
  hint: boolean;
  title: number;
  skipped: boolean;
  pa: ReturnType<typeof paProbe>;
  cue: ReturnType<typeof cueProbe>;
}

/** The probe of the opening `cue` at `now`. */
function probeOf(cue: IntroCue | null, now: number): IntroProbe {
  return {
    phase: cue === null ? null : introPhase(cue, now),
    filmed: cue !== null && filmed(cue, now),
    hint: cue !== null && hintShown(cue, now),
    title: cue === null ? 0 : titleAt(cue, now),
    skipped: cue?.skippedAt != null,
    pa: paProbe(),
    cue: cueProbe(),
  };
}

/** The opening this screen keeps for the run, kept from render to render. */
function useKeptCue(view: PlayerView): React.MutableRefObject<{
  run: number | null;
  cue: IntroCue | null;
}> {
  const kept = useRef<{ run: number | null; cue: IntroCue | null }>({ run: null, cue: null });
  const now = Date.now();
  if (kept.current.run !== view.startedAt) {
    kept.current = { run: view.startedAt, cue: openingOf(view, now) };
  }
  const cue = kept.current.cue;
  if (cue !== null && cue.lightsSec !== null && cue.outAt === null && view.lights.out) {
    kept.current.cue = { ...cue, outAt: now };
  }
  return kept;
}

/**
 * The announcement and the music of the opening that began at `since`: from its start, the
 * music only for a player still watching; both stop with the run or the screen.
 */
function useOpeningSound(kept: React.MutableRefObject<{ cue: IntroCue | null }>, pa: string[]) {
  const lines = useRef(pa);
  lines.current = pa;
  const since = kept.current.cue?.lightsSec == null ? null : kept.current.cue.since;
  useEffect(() => {
    const cue = kept.current.cue;
    if (since === null || cue === null) {
      return undefined;
    }
    startAnnouncement(lines.current, since);
    if (cue.skippedAt === null) {
      startCue(since);
    }
    return () => {
      stopAnnouncement();
      stopCue(0);
    };
  }, [since, kept]);
  // The power goes under the loudspeakers at the bang: the line on breaks off, the music too.
  const bang = kept.current.cue === null ? null : bangAt(kept.current.cue);
  useEffect(() => {
    if (bang === null) {
      return undefined;
    }
    const timer = setTimeout(() => {
      cutAnnouncement();
      stopCue(0);
    }, Math.max(0, bang - Date.now()));
    return () => clearTimeout(timer);
  }, [bang]);
}

/** Space skips the opening where it can be skipped; nothing else hears that press then. */
function useSkipKey(kept: React.MutableRefObject<{ cue: IntroCue | null }>, skip: () => void) {
  const latest = useRef(skip);
  latest.current = skip;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!skipKey(e) || skipAt(kept.current.cue, Date.now()) === null) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      latest.current();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [kept]);
}

/** `?trace=1`: the walkthrough reads the opening off the page (`IntroProbe`). */
function useIntroProbe(kept: React.MutableRefObject<{ cue: IntroCue | null }>): void {
  useEffect(() => {
    if (!traceRequested(location.search)) {
      return undefined;
    }
    return addProbes({
      get intro() {
        return probeOf(kept.current.cue, Date.now());
      },
    });
  }, [kept]);
}

/** The run's opening on this screen, for the run in `view`; `send` tells the room of a skip. */
export function useIntro(view: PlayerView, send: (msg: ClientMessage) => void): Intro {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const kept = useKeptCue(view);
  const tell = useRef(send);
  tell.current = send;
  useOpeningSound(kept, view.intro?.pa ?? []);
  const latestView = useRef(view);
  latestView.current = view;
  const skip = useCallback(() => {
    const skipped = skipAt(kept.current.cue, Date.now(), closesIntro(latestView.current));
    if (skipped === null) return;
    kept.current.cue = skipped.cue;
    if (skipped.tells) {
      tell.current({ kind: 'intro-done' });
      // The skip that ends the intro meets the blackout's beat, which cuts the music itself.
      if (!skipped.cue.closing) stopCue(CUE_FADE_S);
    }
    redraw();
  }, [kept]);
  useSkipKey(kept, skip);
  useIntroProbe(kept);
  const cue = kept.current.cue;
  const next = cue === null ? null : nextChange(cue, Date.now());
  useEffect(() => {
    if (next === null) {
      return undefined;
    }
    const timer = setTimeout(redraw, Math.max(0, next - Date.now()) + 5);
    return () => clearTimeout(timer);
  }, [next]);
  return { cue, skip };
}

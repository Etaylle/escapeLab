import { useEffect, useState } from 'react';
import type { PlayerView, PuzzleView } from '@escapelab/core';
import { firstSight, SHOWN_MARKS, type CoachMark } from '../puzzles/coach.js';
import type { FinaleCue } from './finale.js';
import { carriedItem, opensCabinet, TOUCH } from './interact.js';
import type { WorldMap } from './render/frame.js';

/** How long a tip stays up at most. */
const TIP_MS = 6500;

/**
 * The one sentence a newcomer needs right now, about the world. Over an open
 * station nothing: the device's line lies in its own frame (Game.tsx), and
 * the world the panel covers can wait. On a touch screen, which has no keys,
 * a tip names the ⚡ button instead. The escape needs none: its checklist
 * calls everybody to the hatch.
 */
function coachTip(
  map: WorldMap,
  youId: string,
  carried: WorldMap['items'][number] | undefined,
  station: PuzzleView | null,
  keyboard: boolean,
): CoachMark | null {
  if (station !== null) {
    return null;
  }
  if (map.sabotage !== null) {
    return {
      id: 'sabotage',
      text: 'Notfall! Jede Person an ein eigenes Ventil — sofort losrennen.',
    };
  }
  if (carried !== undefined) {
    return carryTip(map, carried, keyboard);
  }
  if (map.plates.some((plate) => plate.pressed && !plate.freezesDrone)) {
    return {
      id: 'plate',
      text: 'Solange jemand auf der Platte steht, bleibt die Tür offen — nicht runtergehen!',
    };
  }
  void youId;
  return null;
}

/** The tip for full hands: where a key goes, or where a part is brought and how it is put down. */
function carryTip(map: WorldMap, carried: WorldMap['items'][number], keyboard: boolean): CoachMark {
  // A key has no marked spot: it goes into a cabinet, found or not yet.
  if (carried.deliverTo === null || opensCabinet(map, carried.id)) {
    const there = keyboard ? 'dort E drücken' : 'dort ⚡ tippen';
    return { id: 'key', text: `Ein Schlüssel: Er schließt einen Aktenschrank auf — ${there}.` };
  }
  return {
    id: 'carry',
    text: keyboard
      ? 'Du trägst etwas: Bring es zur markierten Fläche und drücke E. Mit Q legst du es ab.'
      : 'Du trägst etwas: Bring es zur markierten Fläche und tippe ⚡. Mit 📦 legst du es ab.',
  };
}

/**
 * Puts up `next` where it is seen for the first time, and takes the tip up
 * now (`tip`) down where it no longer fits.
 */
function showTip(
  next: CoachMark | null,
  tip: CoachMark | null,
  setTip: (tip: CoachMark | null) => void,
): void {
  const fresh = firstSight(next, SHOWN_MARKS);
  if (fresh !== null) {
    SHOWN_MARKS.add(fresh.id);
    setTip(fresh);
  } else if (next?.id !== tip?.id) {
    setTip(null);
  }
}

/**
 * The world's tip up now. Coach marks react to the view, not to the render
 * loop: a new view comes with every move anyone makes, so a tip stays up
 * while it still fits, for TIP_MS at most. The world's tips wait while the
 * objective bar carries a notice (`holdTips`), so the two never stack, and
 * while a station's panel is up.
 */
export function useWorldTip(
  view: PlayerView,
  station: PuzzleView | null,
  spectator: boolean,
  holdTips: boolean,
  finale: FinaleCue | null,
): CoachMark | null {
  const [tip, setTip] = useState<CoachMark | null>(null);
  useEffect(() => {
    if (spectator || view.map === null || finale !== null || holdTips) {
      setTip(null);
      return;
    }
    const keyboard = !window.matchMedia(TOUCH).matches;
    const carried = carriedItem(view.map, view.you.id);
    showTip(coachTip(view.map, view.you.id, carried, station, keyboard), tip, setTip);
  }, [view, station, spectator, holdTips, tip, finale]);

  useEffect(() => {
    if (tip === null) {
      return undefined;
    }
    const timer = setTimeout(() => setTip(null), TIP_MS);
    return () => clearTimeout(timer);
  }, [tip]);
  return tip;
}

import type { MapView } from '@escapelab/core';

/** A thing worth walking to, and how its arrow should look. */
export interface MarkerTarget {
  /** world position in tiles */
  x: number;
  y: number;
  color: string;
  label: string;
}

/** Where the arrow and its caption end up on screen, all in device pixels. */
export interface MarkerPlacement {
  x: number;
  y: number;
  /** rotation so the arrow points away from the centre, towards the target */
  angle: number;
  captionY: number;
}

const TEAL = '#2dd4bf';
const RED = '#f87171';
const BLUE = '#60a5fa';
const GREEN = '#4ade80';

/**
 * What the player is meant to head for right now, most urgent first.
 *
 * An emergency overrides everything and needs every valve at once, since the
 * crew has to split up. Otherwise there is one errand at a time, except that a
 * loose part and the station waiting for it are shown together — they are two
 * legs of the same trip.
 */
export function markerTargets(map: MapView, youId: string): MarkerTarget[] {
  if (map.sabotage !== null) {
    return map.sabotage.panels.map((panel) => ({
      x: panel.x + 0.5,
      y: panel.y + 0.5,
      color: panel.occupied ? TEAL : RED,
      label: 'VENTIL',
    }));
  }
  const carried = map.items.find((item) => item.carriedBy === youId && !item.delivered);
  if (carried !== undefined) {
    return [
      { x: carried.deliverTo.x + 0.5, y: carried.deliverTo.y + 0.5, color: BLUE, label: 'ABGABE' },
    ];
  }
  if (map.exit !== null && map.exit.open) {
    return [{ x: map.exit.x + 0.5, y: map.exit.y + 0.5, color: GREEN, label: 'AUSGANG' }];
  }
  const out: MarkerTarget[] = [];
  const loose = map.items.find((item) => !item.delivered && item.carriedBy === null);
  if (loose !== undefined) {
    out.push({ x: loose.x, y: loose.y, color: BLUE, label: 'TEIL' });
  }
  const armed = map.stations.find((station) => station.status === 'armed');
  if (armed !== undefined) {
    out.push({ x: armed.x + 0.5, y: armed.y + 0.5, color: TEAL, label: 'STATION' });
  }
  return out;
}

/** All in CSS pixels; the canvas works in device pixels, hence the `dpr`. */
const MARGIN = 34;
/** gap between the objective bar and an arrow pinned to the top edge */
const BAR_GAP = 16;
const CAPTION_BELOW = 26;
const CAPTION_ABOVE = 20;

/**
 * Pins an off-screen target to the inside of the frame. `safeTopCss` is the
 * measured height of the objective bar lying on the canvas: an arrow at the
 * top edge has to clear it, or it is drawn on the mission title.
 *
 * Returns null while the target is on screen — everything an arrow points at
 * lights its own patch of the darkness, so the arrow would only cover it up.
 */
export function placeMarker(
  px: number,
  py: number,
  w: number,
  h: number,
  safeTopCss: number,
  dpr: number,
): MarkerPlacement | null {
  if (px >= 0 && px <= w && py >= 0 && py <= h) {
    return null;
  }
  const margin = MARGIN * dpr;
  const top = Math.max(margin, (safeTopCss + BAR_GAP) * dpr);
  const x = Math.min(w - margin, Math.max(margin, px));
  const y = Math.min(h - margin, Math.max(top, py));
  return {
    x,
    y,
    angle: Math.atan2(py - h / 2, px - w / 2),
    // Caption below the arrow, except near the bottom where that would push it
    // off the frame.
    captionY: py > h / 2 ? y - CAPTION_ABOVE * dpr : y + CAPTION_BELOW * dpr,
  };
}

import type { MapView } from '@escapelab/core';
import { consoleName } from './consoles.js';

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
 * What the crew knows it still has to bring. A key's target stays unknown
 * until its cabinet has been come across, and so does the key: naming it
 * earlier would give the cabinet away.
 */
export function toBring(map: MapView): MapView['items'] {
  return map.items.filter((item) => !item.delivered && item.deliverTo !== null);
}

type Spot = MapView['stations'][number];

/** Of the armed station's spots the one nearest to `self`: of two consoles, the one to go to. */
function nearestArmed(map: MapView, self: { x: number; y: number }): Spot | undefined {
  const away = (spot: Spot): number => Math.hypot(spot.x + 0.5 - self.x, spot.y + 0.5 - self.y);
  return map.stations
    .filter((station) => station.status === 'armed')
    .sort((a, b) => away(a) - away(b))[0];
}

/**
 * What the player standing at `self` is meant to head for right now, most
 * urgent first.
 *
 * An emergency overrides everything and needs every valve at once, since the
 * crew has to split up. Otherwise there is one errand at a time, except that a
 * loose part, the station waiting for it and the manual objects printing its
 * rules are shown together — the crew splits up between them. Of a station
 * with two consoles, the nearer one is shown, named by its console.
 */
export function markerTargets(
  map: MapView,
  youId: string,
  self: { x: number; y: number },
): MarkerTarget[] {
  if (map.sabotage !== null) {
    return map.sabotage.panels.map((panel) => ({
      x: panel.x + 0.5,
      y: panel.y + 0.5,
      color: panel.occupied ? TEAL : RED,
      label: 'VENTIL',
    }));
  }
  const carried = map.items.find((item) => item.carriedBy === youId && !item.delivered);
  if (carried !== undefined && carried.deliverTo !== null) {
    const goal = carried.deliverTo;
    return [{ x: goal.x + 0.5, y: goal.y + 0.5, color: BLUE, label: 'ABGABE' }];
  }
  if (map.exit !== null && map.exit.open) {
    return [{ x: map.exit.x + 0.5, y: map.exit.y + 0.5, color: GREEN, label: 'AUSGANG' }];
  }
  const out: MarkerTarget[] = [];
  const loose = toBring(map).find((item) => item.carriedBy === null);
  if (loose !== undefined) {
    out.push({ x: loose.x, y: loose.y, color: BLUE, label: 'TEIL' });
  }
  const armed = nearestArmed(map, self);
  if (armed !== undefined) {
    const label =
      armed.console === undefined ? 'STATION' : consoleName(armed.console).toUpperCase();
    out.push({ x: armed.x + 0.5, y: armed.y + 0.5, color: TEAL, label });
    for (const manual of map.manuals.filter((m) => m.puzzleIds.includes(armed.puzzleId))) {
      out.push({ x: manual.x + 0.5, y: manual.y + 0.5, color: BLUE, label: 'LESEN' });
    }
  }
  return out;
}

/** All in CSS pixels; the canvas works in device pixels, hence the `dpr`. */
const MARGIN = 34;
/** gap between the objective bar and an arrow pinned to the top edge */
const BAR_GAP = 16;
const CAPTION_BELOW = 26;
const CAPTION_ABOVE = 20;
/** how far an arrow reaches from its middle, however it is turned */
const ARROW_REACH = 13;
/** how far a caption's letters rise above and drop below its baseline */
const CAPTION_RISE = 8;
const CAPTION_DROP = 3;
/** air left between two markers on one edge */
const MARKER_AIR = 4;

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

/** A target where it lies on screen, and how wide its caption is drawn; device pixels. */
export interface MarkerPoint {
  px: number;
  py: number;
  captionWidth: number;
}

type Edge = 'left' | 'right' | 'top' | 'bottom';

const onSide = (edge: Edge): boolean => edge === 'left' || edge === 'right';

/** A pinned marker on its edge: where along it, and the room it takes before and after that. */
interface Slot {
  index: number;
  edge: Edge;
  at: number;
  before: number;
  after: number;
}

/**
 * On a side the arrow and its caption stack, so a marker takes room up and
 * down; along the top and the bottom the caption is the wider of the two.
 */
function slotOf(
  index: number,
  at: MarkerPlacement,
  point: MarkerPoint,
  w: number,
  dpr: number,
): Slot {
  if (point.px < 0 || point.px > w) {
    const below = at.captionY > at.y;
    return {
      index,
      edge: point.px < 0 ? 'left' : 'right',
      at: at.y,
      before: (below ? ARROW_REACH : CAPTION_ABOVE + CAPTION_RISE) * dpr,
      after: (below ? CAPTION_BELOW + CAPTION_DROP : ARROW_REACH) * dpr,
    };
  }
  const half = Math.max(ARROW_REACH * dpr, point.captionWidth / 2);
  return { index, edge: point.py < 0 ? 'top' : 'bottom', at: at.x, before: half, after: half };
}

/** Moves the slots of one edge apart in their order along it, backing up from its end `hi`. */
function spread(slots: Slot[], lo: number, hi: number, air: number): void {
  slots.sort((a, b) => a.at - b.at);
  let prev: Slot | null = null;
  for (const slot of slots) {
    if (prev !== null) {
      slot.at = Math.max(slot.at, prev.at + prev.after + slot.before + air);
    }
    prev = slot;
  }
  let next: Slot | null = null;
  for (const slot of [...slots].reverse()) {
    const limit = next === null ? hi : next.at - slot.after - next.before - air;
    slot.at = Math.max(lo, Math.min(slot.at, limit));
    next = slot;
  }
}

/**
 * Every target pinned as by placeMarker, then the markers sharing an edge
 * moved along it until none covers another: on a side they stack, each arrow
 * clear of its neighbour's caption; along the top and the bottom the captions
 * stand side by side. A stack that would run off its edge backs up.
 */
export function placeMarkers(
  points: readonly MarkerPoint[],
  w: number,
  h: number,
  safeTopCss: number,
  dpr: number,
): (MarkerPlacement | null)[] {
  const placed = points.map((point) => placeMarker(point.px, point.py, w, h, safeTopCss, dpr));
  const slots = points.flatMap((point, index) => {
    const at = placed[index];
    return at == null ? [] : [slotOf(index, at, point, w, dpr)];
  });
  const margin = MARGIN * dpr;
  const top = Math.max(margin, (safeTopCss + BAR_GAP) * dpr);
  for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
    const [lo, hi] = onSide(edge) ? [top, h - margin] : [margin, w - margin];
    spread(slots.filter((slot) => slot.edge === edge), lo, hi, MARKER_AIR * dpr);
  }
  for (const slot of slots) {
    const at = placed[slot.index];
    if (at != null) {
      placed[slot.index] = onSide(slot.edge)
        ? { ...at, y: slot.at, captionY: at.captionY + slot.at - at.y }
        : { ...at, x: slot.at };
    }
  }
  return placed;
}

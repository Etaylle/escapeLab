import type { MapView } from '@escapelab/core';
import { consoleName } from './consoles.js';
import { carriedItem } from './interact.js';
import { overlaps, type Box, type Viewport } from './viewport.js';

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
type Point = { x: number; y: number };

/** A crew member this close to a console stands at it, in tiles — as the server counts it. */
const AT_CONSOLE = 1.6;

/**
 * Of the armed station's spots the one to go to from `self`: of two
 * consoles, the one nobody else of the crew stands at, by their live
 * positions; with both or neither taken, the nearer one.
 */
function armedSpotFor(map: MapView, self: Point, others: readonly Point[]): Spot | undefined {
  const away = (spot: Spot, from: Point): number =>
    Math.hypot(spot.x + 0.5 - from.x, spot.y + 0.5 - from.y);
  const armed = map.stations.filter((station) => station.status === 'armed');
  const free = armed.filter((spot) => others.every((other) => away(spot, other) > AT_CONSOLE));
  return (free.length > 0 ? free : armed).sort((a, b) => away(a, self) - away(b, self))[0];
}

/**
 * What the player standing at `self` is meant to head for right now, most
 * urgent first; `crew` holds the live positions of the crew by player id.
 *
 * An emergency overrides everything and needs every valve at once, since the
 * crew has to split up. Otherwise there is one errand at a time, except that a
 * loose part, the station waiting for it and the manual objects printing its
 * rules are shown together — the crew splits up between them. Of a station
 * with two consoles, the one nobody else stands at is shown, else the nearer
 * one, named by its console.
 */
export function markerTargets(
  map: MapView,
  youId: string,
  self: Point,
  crew: Readonly<Record<string, Point>> = {},
): MarkerTarget[] {
  if (map.sabotage !== null) {
    return map.sabotage.panels.map((panel) => ({
      x: panel.x + 0.5,
      y: panel.y + 0.5,
      color: panel.occupied ? TEAL : RED,
      label: 'VENTIL',
    }));
  }
  const carried = carriedItem(map, youId);
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
  const others = Object.entries(crew).flatMap(([id, at]) => (id === youId ? [] : [at]));
  const armed = armedSpotFor(map, self, others);
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
/** gap between an overlay along an edge — the objective bar, the controls — and an arrow there */
const BAR_GAP = 16;
const CAPTION_BELOW = 26;
const CAPTION_ABOVE = 20;
/** how far an arrow reaches from its middle, however it is turned */
const ARROW_REACH = 13;
/** how far a caption's letters rise above and drop below its baseline */
const CAPTION_RISE = 8;
const CAPTION_DROP = 3;
/** air left between two markers on one edge, and between a marker and a box */
const MARKER_AIR = 4;

/** How high and how low an arrow may sit: clear of the objective bar and of the controls. */
function heights(view: Viewport): [number, number] {
  const margin = MARGIN * view.dpr;
  const gap = BAR_GAP * view.dpr;
  return [Math.max(margin, view.top + gap), view.h - Math.max(margin, view.bottom + gap)];
}

/**
 * Pins an off-screen target to the inside of the frame, clear of what lies
 * over its top and bottom edges: an arrow at the top has to clear the
 * objective bar, or it is drawn on the mission title, and one at the bottom
 * the control cluster.
 *
 * Returns null while the target is on screen — everything an arrow points at
 * lights its own patch of the darkness, so the arrow would only cover it up.
 */
export function placeMarker(px: number, py: number, view: Viewport): MarkerPlacement | null {
  const { w, h, dpr } = view;
  if (px >= 0 && px <= w && py >= 0 && py <= h) {
    return null;
  }
  const margin = MARGIN * dpr;
  const [top, bottom] = heights(view);
  const x = Math.min(w - margin, Math.max(margin, px));
  const y = Math.min(bottom, Math.max(top, py));
  return {
    x,
    y,
    angle: Math.atan2(py - h / 2, px - w / 2),
    // Caption below the arrow, except near the bottom where that would push it
    // off the frame.
    captionY: py > h / 2 ? y - CAPTION_ABOVE * dpr : y + CAPTION_BELOW * dpr,
  };
}

/** What a placed marker covers: its arrow, and its caption `captionWidth` wide. */
export function markerBoxes(at: MarkerPlacement, captionWidth: number, dpr: number): Box[] {
  const reach = ARROW_REACH * dpr;
  return [
    { left: at.x - reach, top: at.y - reach, right: at.x + reach, bottom: at.y + reach },
    {
      left: at.x - captionWidth / 2,
      top: at.captionY - CAPTION_RISE * dpr,
      right: at.x + captionWidth / 2,
      bottom: at.captionY + CAPTION_DROP * dpr,
    },
  ];
}

/** A target where it lies on screen, and how wide its caption is drawn; device pixels. */
export interface MarkerPoint {
  px: number;
  py: number;
  captionWidth: number;
}

type Edge = 'left' | 'right' | 'top' | 'bottom';

const onSide = (edge: Edge): boolean => edge === 'left' || edge === 'right';

/**
 * A pinned marker on its edge: where along it, the room it takes before and
 * after that, and how far it reaches across the edge from its arrow's line.
 */
interface Slot {
  index: number;
  edge: Edge;
  at: number;
  before: number;
  after: number;
  across: number;
}

/**
 * On a side the arrow and its caption stack, so a marker takes room up and
 * down; along the top and the bottom the caption is the wider of the two.
 */
function slotOf(index: number, at: MarkerPlacement, point: MarkerPoint, view: Viewport): Slot {
  const { w, dpr } = view;
  const half = Math.max(ARROW_REACH * dpr, point.captionWidth / 2);
  if (point.px < 0 || point.px > w) {
    const below = at.captionY > at.y;
    return {
      index,
      edge: point.px < 0 ? 'left' : 'right',
      at: at.y,
      before: (below ? ARROW_REACH : CAPTION_ABOVE + CAPTION_RISE) * dpr,
      after: (below ? CAPTION_BELOW + CAPTION_DROP : ARROW_REACH) * dpr,
      across: half,
    };
  }
  const top = point.py < 0;
  return {
    index,
    edge: top ? 'top' : 'bottom',
    at: at.x,
    before: half,
    after: half,
    across: (top ? CAPTION_BELOW + CAPTION_DROP : CAPTION_ABOVE + CAPTION_RISE) * dpr,
  };
}

/** A stretch along an edge, from one end to the other. */
type Span = readonly [number, number];

/** The strip along `edge` that its markers' arrows and captions cover. */
function laneOf(edge: Edge, slots: readonly Slot[], view: Viewport): Box {
  const { w, h } = view;
  const margin = MARGIN * view.dpr;
  const [top, bottom] = heights(view);
  const across = Math.max(...slots.map((slot) => slot.across));
  switch (edge) {
    case 'left':
      return { left: 0, top: 0, right: margin + across, bottom: h };
    case 'right':
      return { left: w - margin - across, top: 0, right: w, bottom: h };
    case 'top':
      return { left: 0, top: 0, right: w, bottom: top + across };
    case 'bottom':
      return { left: 0, top: bottom - across, right: w, bottom: h };
  }
}

/** `[lo, hi]` with the cuts taken out, their ends still usable; all of it where nothing is left. */
function freeSpans(lo: number, hi: number, cuts: readonly Span[]): Span[] {
  let spans: Span[] = [[lo, hi]];
  for (const [a, b] of cuts) {
    spans = spans.flatMap(([from, to]): Span[] => {
      if (b < from || a > to) {
        return [[from, to]];
      }
      const kept: Span[] = [];
      if (a >= from) {
        kept.push([from, a]);
      }
      if (b <= to) {
        kept.push([b, to]);
      }
      return kept;
    });
  }
  return spans.length > 0 ? spans : [[lo, hi]];
}

/**
 * Where along `edge` its markers may sit: inside the frame, clear of the bars,
 * and off every box lying in their lane — the minimap — by the room a marker
 * takes before and after its middle.
 */
function spansOf(edge: Edge, slots: readonly Slot[], view: Viewport): Span[] {
  const margin = MARGIN * view.dpr;
  const air = MARKER_AIR * view.dpr;
  const [lo, hi] = onSide(edge) ? heights(view) : [margin, view.w - margin];
  const lane = laneOf(edge, slots, view);
  const before = Math.max(...slots.map((slot) => slot.before));
  const after = Math.max(...slots.map((slot) => slot.after));
  const cuts = view.boxes
    .filter((box) => overlaps(box, lane))
    .map((box): Span => {
      const [a, b] = onSide(edge) ? [box.top, box.bottom] : [box.left, box.right];
      return [a - after - air, b + before + air];
    });
  return freeSpans(lo, hi, cuts);
}

/** Which of `spans` lies nearest to `at`: the one holding it, else the closest. */
function nearestSpan(at: number, spans: readonly Span[]): number {
  let nearest = 0;
  let least = Infinity;
  spans.forEach(([from, to], i) => {
    const off = Math.max(from - at, at - to, 0);
    if (off < least) {
      nearest = i;
      least = off;
    }
  });
  return nearest;
}

/**
 * Moves the slots of a stretch apart in their order along it, from its start
 * `lo` on — a slot may lie before it, cut off by a box — backing up from its
 * end `hi`.
 */
function spread(slots: Slot[], lo: number, hi: number, air: number): void {
  slots.sort((a, b) => a.at - b.at);
  let prev: Slot | null = null;
  for (const slot of slots) {
    const first = prev === null ? lo : prev.at + prev.after + slot.before + air;
    slot.at = Math.max(slot.at, first);
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
 * moved along it until none covers another or a box such as the minimap: on
 * a side they stack, each arrow clear of its neighbour's caption; along the
 * top and the bottom the captions stand side by side. A box cuts its edge in
 * stretches, and each marker keeps to the stretch nearest it; a stack that
 * would run off its stretch backs up.
 */
export function placeMarkers(
  points: readonly MarkerPoint[],
  view: Viewport,
): (MarkerPlacement | null)[] {
  const placed = points.map((point) => placeMarker(point.px, point.py, view));
  const slots = points.flatMap((point, index) => {
    const at = placed[index];
    return at == null ? [] : [slotOf(index, at, point, view)];
  });
  for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
    const mine = slots.filter((slot) => slot.edge === edge);
    if (mine.length === 0) {
      continue;
    }
    const spans = spansOf(edge, mine, view);
    const groups = spans.map((): Slot[] => []);
    for (const slot of mine) {
      groups[nearestSpan(slot.at, spans)]?.push(slot);
    }
    spans.forEach(([lo, hi], i) => spread(groups[i] ?? [], lo, hi, MARKER_AIR * view.dpr));
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

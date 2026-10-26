import {
  drawFusebox,
  drawLeverBox,
  drawManualObject,
  drawPinnedNote,
  drawStation,
} from '../art.js';
import { atlasLevel } from '../atlas.js';
import { TAU } from '../brush.js';
import { PX } from '../figure.js';
import { carryableKind, drawCarryable, drawDropZone } from '../hazards.js';
import type { Subject } from '../interact.js';
import { noteMount } from '../notes.js';
import {
  CORE,
  glowBounds,
  glowSprite,
  HALO,
  paintSilhouette,
  type GlowBounds,
  type Shape,
} from '../silhouette.js';
import type { Frame, WorldMap } from './frame.js';

/**
 * The one thing the E prompt names glows in its own shape, as games mark
 * what can be used — no box round it: a halo baked from its silhouette once
 * for each zoom level (silhouette.ts), breathing, and a tighter core,
 * steady, laid under it by the objects pass (render/objects.ts) in two
 * blits. A part that can be picked up bobs a pixel up and down with its
 * glow; stations and sources stand still. Where motion is reduced the halo
 * holds and nothing bobs. On the WebGL light layer the glow lies under the
 * light map like every other thing; the prompt only names what lies within
 * reach of the player's own light.
 */

/** The halo's strength: faint to full and back over BREATH_S, s; held where motion is reduced. */
export const HALO_FAINT = 0.45;
export const HALO_FULL = 0.9;
export const BREATH_S = 1.2;
export const HALO_STILL = 0.7;
/** The core's strength, steady. */
export const CORE_ALPHA = 0.3;
/** How far a named part that can be picked up rises and sinks, tiles, and over how long, s. */
export const BOB = PX;
export const BOB_S = 2;

/** The box a prop's drawing stays within round its anchor, tiles; a note's turns with its wall. */
const PROP_BOX = { x: -0.5, y: -0.6, w: 1, h: 1.1 };
const NOTE_BOX = { x: -0.7, y: -0.7, w: 1.4, h: 1.4 };

type Station = WorldMap['stations'][number];
type Manual = WorldMap['manuals'][number];

/** How strong the halo is at sim time `time`, s: a sine from HALO_FAINT to HALO_FULL. */
export function haloAlpha(time: number, reduced: boolean): number {
  if (reduced) {
    return HALO_STILL;
  }
  const wave = 0.5 + 0.5 * Math.sin((time / BREATH_S) * TAU);
  return HALO_FAINT + (HALO_FULL - HALO_FAINT) * wave;
}

/** How far a named part that can be picked up rises at sim time `time`, s, in tiles; up is more. */
export function bobLift(time: number, reduced: boolean): number {
  return reduced ? 0 : BOB * Math.sin((time / BOB_S) * TAU);
}

/** A station's console, a fuse box or a main switch as objects.ts draws it, without dressing. */
export function stationShape(
  station: Pick<Station, 'status' | 'console' | 'look'>,
  levers: number,
): Shape {
  const { status } = station;
  if (station.look === 'lever') {
    const look = { status, pulse: 0, levers, bare: true };
    return { key: `lever:${status}:${levers}`, box: PROP_BOX, draw: (g) => drawLeverBox(g, look) };
  }
  const letter = station.console ?? null;
  const look = { status, pulse: 0, console: letter, bare: true };
  const fuse = station.look === 'fusebox';
  return {
    key: `${fuse ? 'fusebox' : 'station'}:${status}:${letter ?? '-'}`,
    box: PROP_BOX,
    draw: (g) => (fuse ? drawFusebox(g, look) : drawStation(g, look)),
  };
}

/** A source as objects.ts draws it, without its shadow, glow and label: shut or open. */
export function manualShape(manual: Pick<Manual, 'kind' | 'opened' | 'label'>): Shape {
  const { kind, opened, label } = manual;
  const look = { kind, label, active: false, opened, pulse: 0, bare: true };
  return {
    key: `manual:${kind}:${opened ? 'open' : 'shut'}`,
    box: PROP_BOX,
    draw: (g) => drawManualObject(g, look),
  };
}

/** A note of the last shift on its wall facing `facing`, or on the floor (null): sheet and pin. */
export function noteShape(facing: number | null): Shape {
  // Read, a note calls for nobody: no glow of its own round it.
  const look = { facing, read: true, pulse: 0 };
  return { key: `note:${facing ?? 'floor'}`, box: NOTE_BOX, draw: (g) => drawPinnedNote(g, look) };
}

/** A part lying about, by its label: the fuse, the key or a crate itself. */
export function itemShape(label: string): Shape {
  const look = { label, pulse: 0, carried: false, bare: true };
  return {
    key: `item:${carryableKind(label)}`,
    box: PROP_BOX,
    draw: (g) => drawCarryable(g, look),
  };
}

/** A drop-off: its marked square, at its strongest. */
export const DROP_SHAPE: Shape = {
  key: 'drop',
  box: PROP_BOX,
  draw: (g) => drawDropZone(g, false, 1),
};

/** What the E prompt names this frame, as the objects pass draws it. */
export interface Named {
  subject: Subject;
  /** where its drawing is anchored, in tiles */
  x: number;
  y: number;
  shape: Shape;
  /** how far it rises off the floor now, tiles: a part that can be picked up bobs */
  lift: number;
}

type Place = Pick<Named, 'x' | 'y' | 'shape'>;

function stationPlace(frame: Frame, at: { x: number; y: number }): Place | null {
  const station = frame.map.stations.find((s) => s.x === at.x && s.y === at.y);
  const levers = frame.players.filter((p) => p.connected).length;
  return station === undefined
    ? null
    : { x: station.x + 0.5, y: station.y + 0.5, shape: stationShape(station, levers) };
}

function manualPlace(map: WorldMap, id: string): Place | null {
  const manual = map.manuals.find((m) => m.id === id);
  return manual === undefined
    ? null
    : { x: manual.x + 0.5, y: manual.y + 0.5, shape: manualShape(manual) };
}

function notePlace(map: WorldMap, index: number): Place | null {
  const note = map.notes.find((n) => n.index === index);
  const mount = note === undefined ? null : noteMount(map, note);
  return mount === null ? null : { x: mount.x, y: mount.y, shape: noteShape(mount.facing) };
}

/** A part lying about where light has fallen on it, as objects.ts shows it. */
function itemPlace({ map, light }: Frame, id: string): Place | null {
  const item = map.items.find((i) => i.id === id && i.carriedBy === null && !i.delivered);
  return item === undefined || !light.shown(item.x, item.y)
    ? null
    : { x: item.x, y: item.y, shape: itemShape(item.label) };
}

/** The drop-off of the part `id`, where light has fallen on it, as objects.ts shows it. */
function dropPlace({ map, light }: Frame, id: string): Place | null {
  const zone = map.items.find((i) => i.id === id)?.deliverTo ?? null;
  return zone === null || !light.shown(zone.x, zone.y)
    ? null
    : { x: zone.x + 0.5, y: zone.y + 0.5, shape: DROP_SHAPE };
}

/** Where the drawing of what `subject` names is anchored, and its shape; null where none shows. */
function placeOf(frame: Frame, subject: Subject): Place | null {
  switch (subject.of) {
    case 'station':
      return stationPlace(frame, subject);
    case 'manual':
      return manualPlace(frame.map, subject.id);
    case 'note':
      return notePlace(frame.map, subject.index);
    case 'item':
      return itemPlace(frame, subject.id);
    case 'drop':
      return dropPlace(frame, subject.id);
  }
}

/** What the E prompt names this frame, where the objects pass draws it; null for nothing. */
export function namedThing(frame: Frame): Named | null {
  const subject = frame.action?.subject;
  const place = subject === undefined ? null : placeOf(frame, subject);
  if (subject === undefined || place === null) {
    return null;
  }
  const lift = subject.of === 'item' ? bobLift(frame.time, frame.reduced) : 0;
  return { subject, ...place, lift };
}

/**
 * Lays the glow of `shape` round the origin, tile space, as light: its halo
 * breathing, its core steady — each one blit of its bake at the frame's
 * zoom level, baked on the first frame that asks.
 */
export function drawGlow(ctx: CanvasRenderingContext2D, frame: Frame, shape: Shape): void {
  const level = atlasLevel(frame.camera.scale);
  const { glows } = frame.kit.art;
  const halo = glowSprite(glows, level, shape, HALO);
  const core = glowSprite(glows, level, shape, CORE);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = haloAlpha(frame.time, frame.reduced);
  ctx.drawImage(halo.canvas, halo.x, halo.y, halo.w, halo.h);
  ctx.globalAlpha = CORE_ALPHA;
  ctx.drawImage(core.canvas, core.x, core.y, core.w, core.h);
  ctx.restore();
}

/** The halo of a glow and its shape's silhouette, as the walkthrough reads them back. */
export interface GlowPixels extends GlowBounds {
  /** the zoom level it was baked at, px a tile */
  level: number;
  /** the halo's alpha and its silhouette's, row by row, 0 to 255, both over the halo's bounds */
  halo: number[];
  silhouette: number[];
}

/** What the walkthrough reads of the glow off the page (probes.ts), for the frame last drawn. */
export interface HighlightProbe {
  subject: Subject;
  /** where the glowing thing is anchored, tiles */
  x: number;
  y: number;
  /** how strong its halo was, and how far it rose, tiles */
  halo: number;
  lift: number;
  /** the halo and the silhouette it was baked from, read back off their canvases */
  pixels: () => GlowPixels;
}

/** The alpha of every pixel of `canvas`, row by row. */
function alphaOf(canvas: HTMLCanvasElement): number[] {
  const g = canvas.getContext('2d');
  if (g === null) {
    throw new Error('highlight: canvas.getContext("2d") returned null; cannot read a glow back.');
  }
  const { data } = g.getImageData(0, 0, canvas.width, canvas.height);
  const alpha: number[] = [];
  for (let i = 3; i < data.length; i += 4) {
    alpha.push(data[i] ?? 0);
  }
  return alpha;
}

/** The halo of `shape` at the zoom of `frame` and its silhouette, painted anew over its bounds. */
function glowPixels(frame: Frame, shape: Shape): GlowPixels {
  const level = atlasLevel(frame.camera.scale);
  const { glows } = frame.kit.art;
  const halo = glowSprite(glows, level, shape, HALO);
  const bounds = glowBounds(shape, level, HALO);
  const silhouette = paintSilhouette(glows.make, shape, level, bounds);
  return { level, ...bounds, halo: alphaOf(halo.canvas), silhouette: alphaOf(silhouette) };
}

/** The glow of `frame` as the walkthrough reads it; null while the prompt names nothing. */
export function highlightProbe(frame: Frame): HighlightProbe | null {
  const named = namedThing(frame);
  if (named === null) {
    return null;
  }
  return {
    subject: named.subject,
    x: named.x,
    y: named.y,
    halo: haloAlpha(frame.time, frame.reduced),
    lift: named.lift,
    pixels: () => glowPixels(frame, named.shape),
  };
}

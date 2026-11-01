import {
  drawDoor,
  drawEmergencyLamp,
  drawExitHatch,
  drawFusebox,
  drawLeverBox,
  drawManualObject,
  drawPinnedNote,
  drawPlate,
  drawSign,
  drawStation,
  LABEL_BELOW,
  plateCaption,
  SIGN_LABEL_BELOW,
  textBox,
  type Tube,
} from '../art.js';
import { placeLabels, type PropLabel } from '../labelLayout.js';
import { animTime, crtFlicker, propSeed, rollAt } from '../anim.js';
import { doorOpenness, isHorizontalDoor } from '../doors.js';
import { burning } from '../frameLight.js';
import {
  drawCarryable,
  drawDropZone,
  drawSabotagePanel,
  type CarryableOpts,
} from '../hazards.js';
import { coversArmed, opensCabinet } from '../interact.js';
import { noteMount } from '../notes.js';
import { inTiles, profiled, type Frame, type WorldMap } from './frame.js';
import { drawGlow, namedThing, type Named } from './highlight.js';
import * as props from './props.js';

/**
 * The lab's things, in tile space. Objects show only where some light has
 * fallen — a cabinet behind a wall stays unseen. Sources and the notes of
 * the last shift reach the map once found; a station that is up or done, the
 * sign, the hatch and the valves always show. The one thing the E prompt
 * names glows in its own shape under it (highlight.ts) — over the plates and
 * doors, under the things. Then the emergency lamps on their walls and
 * ceilings. The furniture is baked with the floor it stands on
 * (render/tiles.ts). The labels under plates, sources, the sign and the parts
 * lying about are placed first, so that none lies on another (labelLayout.ts).
 */
export function draw(ctx: CanvasRenderingContext2D, frame: Frame): void {
  inTiles(ctx, frame);
  const named = namedThing(frame);
  const labels = labelSpots(ctx, frame);
  drawPlates(ctx, frame, labels);
  profiled(frame.kit, 'props', ctx, () => props.drawFloor(ctx, frame));
  drawDoors(ctx, frame);
  drawGlowUnder(ctx, frame, named);
  drawStations(ctx, frame);
  drawManuals(ctx, frame, labels);
  drawNotes(ctx, frame);
  drawFixtures(ctx, frame, labels);
  drawItems(ctx, frame, named, labels);
  drawLamps(ctx, frame);
}

/** Where each thing's label goes this frame, by key: its top under the anchor, or null. */
type LabelSpots = ReadonlyMap<string, number | null>;

/**
 * How much a label matters: what calls for the crew now — the source of the armed station,
 * the sign not yet read — then the plates and the parts lying about, then the rest.
 */
const RANK = { calling: 3, plate: 2, item: 2, quiet: 1 } as const;

/** A label as the layout takes it, before its size is measured. */
interface Labelled {
  key: string;
  words: string;
  x: number;
  y: number;
  below: number;
  rank: number;
}

/** The labels of the things this frame shows, each placed clear of the others. */
function labelSpots(ctx: CanvasRenderingContext2D, frame: Frame): LabelSpots {
  const { map, light } = frame;
  const shown: Labelled[] = [];
  for (const plate of map.plates.filter((p) => light.shown(p.x, p.y))) {
    const words = plateCaption(plate).toUpperCase();
    const at = { x: plate.x + 0.5, y: plate.y + 0.5, below: LABEL_BELOW, rank: RANK.plate };
    shown.push({ key: `plate:${plate.id}`, words, ...at });
  }
  for (const manual of map.manuals) {
    const rank = coversArmed(map, manual) ? RANK.calling : RANK.quiet;
    const at = { x: manual.x + 0.5, y: manual.y + 0.5, below: LABEL_BELOW, rank };
    shown.push({ key: `manual:${manual.id}`, words: manual.label, ...at });
  }
  const sign = map.edgeworkSign;
  if (sign !== null) {
    const rank = frame.signSeen ? RANK.quiet : RANK.calling;
    const at = { x: sign.x + 0.5, y: sign.y + 0.5, below: SIGN_LABEL_BELOW, rank };
    shown.push({ key: 'sign', words: SIGN_LABEL, ...at });
  }
  for (const item of map.items.filter((i) => looseAndShown(frame, i))) {
    const at = { x: item.x, y: item.y, below: LABEL_BELOW, rank: RANK.item };
    shown.push({ key: `item:${item.id}`, words: item.label.toUpperCase(), ...at });
  }
  const labels = shown.map(({ words, ...label }): PropLabel => ({
    ...label,
    ...textBox(ctx, words, frame.text.label),
  }));
  return placeLabels(labels);
}

/** The sign's label. */
const SIGN_LABEL = 'LABORKENNUNG';

/** Where `key`'s label goes this frame: the place it was given, null for none, else `own`. */
function labelAt(spots: LabelSpots, key: string, own: number): number | null {
  const spot = spots.get(key);
  return spot === undefined ? own : spot;
}

/** Draws with `draw` with the origin moved to (x, y), the context as it was after. */
function at(ctx: CanvasRenderingContext2D, x: number, y: number, draw: () => void): void {
  ctx.save();
  ctx.translate(x, y);
  draw();
  ctx.restore();
}

/** The pressure plates light has fallen on, each label where `labels` puts it. */
function drawPlates(ctx: CanvasRenderingContext2D, frame: Frame, labels: LabelSpots): void {
  const { map, light, text } = frame;
  for (const plate of map.plates.filter((p) => light.shown(p.x, p.y))) {
    const look = {
      pressed: plate.pressed,
      label: plateCaption(plate),
      camera: plate.freezesDrone,
      text,
      labelAt: labelAt(labels, `plate:${plate.id}`, LABEL_BELOW),
    };
    at(ctx, plate.x + 0.5, plate.y + 0.5, () => drawPlate(ctx, look));
  }
}

/**
 * The glow round what the E prompt names, where it stands: a part lying
 * about takes its own between its shadow and itself, bobbing with it (drawLoose).
 */
function drawGlowUnder(ctx: CanvasRenderingContext2D, frame: Frame, named: Named | null): void {
  if (named !== null && named.subject.of !== 'item') {
    at(ctx, named.x, named.y, () => drawGlow(ctx, frame, named.shape));
  }
}

/** Every door, as far open as its slide has come. */
function drawDoors(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const { map } = frame;
  for (const door of map.doors) {
    const motion = frame.doors.get(door.id);
    const openT = motion === undefined ? Number(door.open) : doorOpenness(motion, frame.now);
    const horizontal = isHorizontalDoor(map, door);
    at(ctx, door.x + 0.5, door.y + 0.5, () => drawDoor(ctx, { openT, horizontal }));
  }
}

/**
 * Every station's spot: a station with two consoles stands twice, both lit while it is armed.
 * A main switch has a lever for each of the crew; a circuit's box is a fuse box. A locked
 * station shows where light fell.
 */
function drawStations(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const { map, light, pulse } = frame;
  const levers = frame.players.filter((p) => p.connected).length;
  for (const station of map.stations) {
    if (station.status !== 'locked' || light.shown(station.x, station.y)) {
      const look = {
        status: station.status,
        pulse,
        console: station.console ?? null,
        tube: tubeAt(frame, station.x, station.y),
      };
      const draw =
        station.look === 'lever'
          ? () => drawLeverBox(ctx, { status: look.status, pulse, levers })
          : station.look === 'fusebox'
            ? () => drawFusebox(ctx, look)
            : () => drawStation(ctx, look);
      at(ctx, station.x + 0.5, station.y + 0.5, draw);
    }
  }
}

/**
 * The tube of the screen on the tile (x, y) this frame: flickering and its roll bar drifting
 * down (anim.ts), each screen out of step with the others.
 */
export function tubeAt(frame: Frame, x: number, y: number): Tube {
  const t = animTime(frame.time);
  const seed = propSeed(x, y);
  return { burn: crtFlicker(t, seed), roll: rollAt(t, seed, frame.reduced) };
}

/**
 * The sources found so far, the ones printing the armed station's rules lit up, each label
 * where `labels` puts it.
 */
function drawManuals(ctx: CanvasRenderingContext2D, frame: Frame, labels: LabelSpots): void {
  const { map, pulse, text } = frame;
  for (const manual of map.manuals) {
    const active = coversArmed(map, manual);
    const { kind, label, opened } = manual;
    const tube = tubeAt(frame, manual.x, manual.y);
    const place = labelAt(labels, `manual:${manual.id}`, LABEL_BELOW);
    const look = { kind, label, active, opened, pulse, text, tube, labelAt: place };
    at(ctx, manual.x + 0.5, manual.y + 0.5, () => drawManualObject(ctx, look));
  }
}

/** The notes of the last shift found so far, on their walls or the floor, unread ones calling. */
function drawNotes(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const { map, pulse } = frame;
  for (const note of map.notes) {
    const mount = noteMount(map, note);
    if (mount !== null) {
      const look = { facing: mount.facing, read: note.read, pulse };
      at(ctx, mount.x, mount.y, () => drawPinnedNote(ctx, look));
    }
  }
}

/** The Laborkennung, its label where `labels` puts it, the hatch and an emergency's valves. */
function drawFixtures(ctx: CanvasRenderingContext2D, frame: Frame, labels: LabelSpots): void {
  const { map, pulse, text } = frame;
  const sign = map.edgeworkSign;
  if (sign !== null) {
    const place = labelAt(labels, 'sign', SIGN_LABEL_BELOW);
    const look = { label: SIGN_LABEL, seen: frame.signSeen, pulse, text, labelAt: place };
    at(ctx, sign.x + 0.5, sign.y + 0.5, () => drawSign(ctx, look));
  }
  const exit = map.exit;
  if (exit !== null) {
    const look = { open: frame.hatch, pulse };
    at(ctx, exit.x + 0.5, exit.y + 0.5, () => drawExitHatch(ctx, look));
  }
  for (const panel of map.sabotage?.panels ?? []) {
    at(ctx, panel.x + 0.5, panel.y + 0.5, () => drawSabotagePanel(ctx, panel.occupied, pulse));
  }
}

type Item = WorldMap['items'][number];

/** Drop-offs and the crates, fuses and keys lying about, where light has fallen on them. */
function drawItems(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  named: Named | null,
  labels: LabelSpots,
): void {
  for (const item of frame.map.items) {
    drawZone(ctx, frame, item);
    drawLoose(ctx, frame, item, named, labelAt(labels, `item:${item.id}`, LABEL_BELOW));
  }
}

/** Whether `item` lies about where light has fallen on it: neither carried nor put in. */
function looseAndShown(frame: Frame, item: Item): boolean {
  return !item.delivered && item.carriedBy === null && frame.light.shown(item.x, item.y);
}

/** The drop-off of `item` where light has fallen on it; none for a cabinet's key. */
function drawZone(ctx: CanvasRenderingContext2D, frame: Frame, item: Item): void {
  const { map, light, pulse } = frame;
  const zone = item.deliverTo;
  if (zone !== null && !opensCabinet(map, item.id) && light.shown(zone.x, zone.y)) {
    at(ctx, zone.x + 0.5, zone.y + 0.5, () => drawDropZone(ctx, item.delivered, pulse));
  }
}

/**
 * `item` lying about where light has fallen on it, as the E prompt has it (`hovering`), its
 * label's top `label` under it, or none.
 */
function drawLoose(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  item: Item,
  named: Named | null,
  label: number | null,
): void {
  const { pulse, text } = frame;
  if (!looseAndShown(frame, item)) {
    return;
  }
  const look = {
    label: item.label,
    pulse,
    carried: false,
    text,
    labelAt: label,
    ...hovering(frame, item, named),
  };
  at(ctx, item.x, item.y, () => drawCarryable(ctx, look));
}

/**
 * How `item` lies: named by the E prompt, it bobs, its glow under it and over
 * its shadow, rising with it; else just as it is.
 */
function hovering(
  frame: Frame,
  item: Item,
  named: Named | null,
): Pick<CarryableOpts, 'lift' | 'glow'> {
  if (named?.subject.of !== 'item' || named.subject.id !== item.id) {
    return {};
  }
  return { lift: named.lift, glow: (g) => drawGlow(g, frame, named.shape) };
}

/**
 * The emergency lamps on their walls and ceilings, pulsing where their
 * room is dark — dark glass while the power is on, and in a room whose
 * lights are back.
 */
function drawLamps(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const powered = frame.scene.lit || frame.whole > 0;
  const glow = powered ? 0 : frame.burn;
  for (const mount of frame.mounts) {
    ctx.save();
    ctx.translate(mount.x, mount.y);
    const own = burning(mount, frame.litTiles) ? glow : 0;
    drawEmergencyLamp(ctx, { glow: own, facing: mount.facing });
    ctx.restore();
  }
}

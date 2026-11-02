import type { KnownPart, MapPart, MapSource } from '@escapelab/core';
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
  type ManualObjectOpts,
  type Tube,
} from '../art.js';
import type { PlacedLabels } from '../labelLayout.js';
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
import { statusOf } from '../known.js';
import { noteMount } from '../notes.js';
import { inTiles, profiled, type Frame } from './frame.js';
import { drawGlow, namedThing, type Named } from './highlight.js';
import {
  labelAt,
  looseAndShown,
  propLabels,
  SIGN,
  SIGN_LABEL,
  sourceShows,
} from './labels.js';
import * as props from './props.js';

/**
 * The lab's things, in tile space. Objects show only where some light has
 * fallen — a cabinet behind a wall stays unseen —, sources and the notes of
 * the last shift also wherever the crew knows of them; a station that is up
 * or done, the sign, the hatch and the valves always show. A thing shows its
 * name and calls for attention only once this player has found it
 * (labelFade.ts): till then it is drawn as what it is. The one thing the E prompt
 * names glows in its own shape under it (highlight.ts) — over the plates and
 * doors, under the things. Then the emergency lamps on their walls and
 * ceilings. The furniture is baked with the floor it stands on
 * (render/tiles.ts). The labels under plates, sources, the sign and the parts
 * lying about go where they were placed, none on another (labels.ts).
 */
export function draw(ctx: CanvasRenderingContext2D, frame: Frame): void {
  inTiles(ctx, frame);
  const named = namedThing(frame);
  const labels = propLabels(ctx, frame);
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

/** Draws with `draw` with the origin moved to (x, y), the context as it was after. */
function at(ctx: CanvasRenderingContext2D, x: number, y: number, draw: () => void): void {
  ctx.save();
  ctx.translate(x, y);
  draw();
  ctx.restore();
}

/** The pressure plates light has fallen on, each label where `labels` puts it. */
function drawPlates(ctx: CanvasRenderingContext2D, frame: Frame, labels: PlacedLabels): void {
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
    const status = statusOf(station);
    if (status !== 'locked' || light.shown(station.x, station.y)) {
      const look = {
        status,
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
 * How `manual` looks this frame, its label's top at `place`: one nobody has found as what it
 * is, shut, holding nothing; one the crew knows of whole, named as far as this player has found
 * it — and only then lit up where it prints the armed station's rules.
 */
function sourceLook(frame: Frame, manual: MapSource, place: number | null): ManualObjectOpts {
  const { pulse, text } = frame;
  const found = frame.labels({ of: 'source', id: manual.id });
  const tube = tubeAt(frame, manual.x, manual.y);
  const look = { kind: manual.kind, active: false, opened: false, pulse, text, tube, found };
  if (!manual.known) {
    return { ...look, labelAt: place };
  }
  const active = found > 0 && coversArmed(frame.map, manual);
  return { ...look, label: manual.label, active, opened: manual.opened, labelAt: place };
}

/** The sources where light has fallen or the crew knows of them, as `sourceLook` has them. */
function drawManuals(ctx: CanvasRenderingContext2D, frame: Frame, labels: PlacedLabels): void {
  for (const manual of frame.map.manuals) {
    if (sourceShows(frame, manual)) {
      const look = sourceLook(frame, manual, labelAt(labels, `manual:${manual.id}`, LABEL_BELOW));
      at(ctx, manual.x + 0.5, manual.y + 0.5, () => drawManualObject(ctx, look));
    }
  }
}

/**
 * The notes of the last shift where light has fallen or the crew knows of them, on their walls
 * or the floor, unread ones calling as far as this player has found them.
 */
function drawNotes(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const { map, light, pulse } = frame;
  for (const note of map.notes) {
    const mount = noteMount(map, note);
    if (mount !== null && (note.known || light.shown(mount.spot.x, mount.spot.y))) {
      const found = frame.labels({ of: 'note', index: note.index });
      // Nobody has read a note nobody has found.
      const look = { facing: mount.facing, read: note.known && note.read, pulse, found };
      at(ctx, mount.x, mount.y, () => drawPinnedNote(ctx, look));
    }
  }
}

/** The Laborkennung, its label where `labels` puts it, the hatch and an emergency's valves. */
function drawFixtures(ctx: CanvasRenderingContext2D, frame: Frame, labels: PlacedLabels): void {
  const { map, pulse, text } = frame;
  const sign = map.edgeworkSign;
  if (sign !== null) {
    const place = labelAt(labels, 'sign', SIGN_LABEL_BELOW);
    const found = frame.labels(SIGN);
    const look = { label: SIGN_LABEL, seen: frame.signSeen, pulse, text, labelAt: place, found };
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

/**
 * Drop-offs of the parts the crew knows of, and the crates, fuses and keys lying about, where
 * light has fallen on them.
 */
function drawItems(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  named: Named | null,
  labels: PlacedLabels,
): void {
  for (const item of frame.map.items) {
    if (item.known) {
      drawZone(ctx, frame, item);
    }
    drawLoose(ctx, frame, item, named, labelAt(labels, `item:${item.id}`, LABEL_BELOW));
  }
}

/** The drop-off of `item` where light has fallen on it; none for a cabinet's key. */
function drawZone(ctx: CanvasRenderingContext2D, frame: Frame, item: KnownPart): void {
  const { map, light, pulse } = frame;
  const zone = item.deliverTo;
  if (zone !== null && !opensCabinet(map, item.id) && light.shown(zone.x, zone.y)) {
    at(ctx, zone.x + 0.5, zone.y + 0.5, () => drawDropZone(ctx, item.delivered, pulse));
  }
}

/**
 * `item` lying about where light has fallen on it, as the E prompt has it (`hovering`), its
 * label's top `label` under it, or none — named as far as this player has found it.
 */
function drawLoose(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  item: MapPart,
  named: Named | null,
  label: number | null,
): void {
  const { pulse, text } = frame;
  if (!looseAndShown(frame, item)) {
    return;
  }
  const look = {
    kind: item.kind,
    ...(item.known ? { label: item.label } : {}),
    pulse,
    carried: false,
    text,
    labelAt: label,
    found: frame.labels({ of: 'item', id: item.id }),
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
  item: MapPart,
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

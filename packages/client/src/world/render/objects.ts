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
  plateCaption,
} from '../art.js';
import { doorOpenness, isHorizontalDoor } from '../doors.js';
import { burning } from '../frameLight.js';
import { drawCarryable, drawDropZone, drawSabotagePanel } from '../hazards.js';
import { coversArmed, opensCabinet } from '../interact.js';
import { noteMount } from '../notes.js';
import { inTiles, type Frame } from './frame.js';

/**
 * The lab's things, in tile space. Objects show only where some light has
 * fallen — a cabinet behind a wall stays unseen. Sources and the notes of
 * the last shift reach the map once found; a station that is up or done, the
 * sign, the hatch and the valves always show. Then the emergency lamps on
 * their walls and ceilings. The furniture is baked with the floor it stands
 * on (render/tiles.ts).
 */
export function draw(ctx: CanvasRenderingContext2D, frame: Frame): void {
  inTiles(ctx, frame);
  drawPlates(ctx, frame);
  drawDoors(ctx, frame);
  drawStations(ctx, frame);
  drawManuals(ctx, frame);
  drawNotes(ctx, frame);
  drawFixtures(ctx, frame);
  drawItems(ctx, frame);
  drawLamps(ctx, frame);
}

/** Draws with `draw` with the origin moved to (x, y), the context as it was after. */
function at(ctx: CanvasRenderingContext2D, x: number, y: number, draw: () => void): void {
  ctx.save();
  ctx.translate(x, y);
  draw();
  ctx.restore();
}

/** The pressure plates light has fallen on. */
function drawPlates(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const { map, light, text } = frame;
  for (const plate of map.plates.filter((p) => light.shown(p.x, p.y))) {
    const look = {
      pressed: plate.pressed,
      label: plateCaption(plate),
      camera: plate.freezesDrone,
      text,
    };
    at(ctx, plate.x + 0.5, plate.y + 0.5, () => drawPlate(ctx, look));
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
      const look = { status: station.status, pulse, console: station.console ?? null };
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

/** The sources found so far, the ones printing the armed station's rules lit up. */
function drawManuals(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const { map, pulse, text } = frame;
  for (const manual of map.manuals) {
    const active = coversArmed(map, manual);
    const { kind, label, opened } = manual;
    const look = { kind, label, active, opened, pulse, text };
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

/** The Laborkennung, the hatch and an emergency's valves: always in sight. */
function drawFixtures(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const { map, pulse, text } = frame;
  const sign = map.edgeworkSign;
  if (sign !== null) {
    const look = { label: 'LABORKENNUNG', seen: frame.signSeen, pulse, text };
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

/** Drop-offs and the crates, fuses and keys lying about, where light has fallen on them. */
function drawItems(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const { map, light, pulse, text } = frame;
  for (const item of map.items) {
    const zone = item.deliverTo;
    if (zone !== null && !opensCabinet(map, item.id) && light.shown(zone.x, zone.y)) {
      at(ctx, zone.x + 0.5, zone.y + 0.5, () => drawDropZone(ctx, item.delivered, pulse));
    }
    if (!item.delivered && item.carriedBy === null && light.shown(item.x, item.y)) {
      const look = { label: item.label, pulse, carried: false, text };
      at(ctx, item.x, item.y, () => drawCarryable(ctx, look));
    }
  }
}

/**
 * The emergency lamps on their walls and ceilings, pulsing where their
 * room is dark — dark glass while the power is on, and in a room whose
 * lights are back.
 */
function drawLamps(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const powered = frame.scene.lit || (frame.ending?.lit ?? 0) > 0;
  const glow = powered ? 0 : frame.burn;
  for (const mount of frame.mounts) {
    ctx.save();
    ctx.translate(mount.x, mount.y);
    const own = burning(mount, frame.litTiles) ? glow : 0;
    drawEmergencyLamp(ctx, { glow: own, facing: mount.facing });
    ctx.restore();
  }
}

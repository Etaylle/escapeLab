import { bake, bakeBox, drawBaked } from '../baked.js';
import { coversArmed } from '../interact.js';
import {
  CREW_GLOW_STOPS,
  DRONE_BEAM_STOPS,
  EMERGENCY_GLOW,
  EMERGENCY_STOPS,
  objectGlowStops,
  OWN_BEAM_STOPS,
  OWN_GLOW_STOPS,
  SPILL_STOPS,
  type Lit,
  type Run,
  type Stops,
} from '../light.js';
import { litGroups, warmUp, type LitGroup } from '../rooms.js';
import { inTiles, toScreen, type Frame, type FrameLit } from './frame.js';

/**
 * The darkness over the picture (render/light.ts lays it on): a canvas of
 * its own, filled dark every frame — deeper in the last minute and all
 * through the escape — kept clear over the lit rooms and, with the power on,
 * over your room, and cut open by every light where its lamp can see.
 */

/** How long one turn of the escape's siren takes, s: the red light swells with it. */
const SIREN_TURN = 1.25;
/**
 * How much of a lit room's light the escape takes back, at most and at
 * least as the siren turns: the lab on its alarm lighting, your lamp cutting
 * through again.
 */
const ALARM_DIM = [0.62, 0.42] as const;

/** Cuts a radial glow of `radius` tiles into the darkness at (wx, wy), as its `stops` say. */
type Punch = (wx: number, wy: number, radius: number, stops: Stops) => void;

/** The three ways light is cut into the darkness. */
interface Cutters {
  /** a radial glow round a point */
  punch: Punch;
  /** a lamp's beam, its cone fading out along `stops` */
  beam: (lit: Lit, stops: Stops) => void;
  /** whatever `draw` cuts, only where the lamp of `lit` can see */
  within: (lit: FrameLit, draw: () => void) => void;
}

/** The escape's siren turning, 0 to 1 and back: what the red light swells with. */
export function sirenSwell(frame: Frame): number {
  return frame.reduced ? 0.5 : 0.5 + 0.5 * Math.sin((frame.time / SIREN_TURN) * Math.PI * 2);
}

/** How far the lights of a room that came on at `since` (sim time) are up now. */
export function roomUp(frame: Frame, since: number): number {
  return warmUp((frame.time - since) * 1000, frame.reduced);
}

/** A radial gradient cutting darkness `stops` deep round (x, y) out to `r`, in `g`'s space. */
function cutGradient(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  stops: Stops,
): CanvasGradient {
  const gradient = g.createRadialGradient(x, y, 0, x, y, r);
  for (const [offset, depth] of stops) {
    gradient.addColorStop(offset, `rgba(0,0,0,${depth})`);
  }
  return gradient;
}

/**
 * The darkness of the overlay `cut` — deeper in the last minute and all
 * through the escape — none over the lit rooms and, with the power on, over
 * your room, and the light every lamp cuts into it where it can see.
 */
export function cutDarkness(cut: CanvasRenderingContext2D, frame: Frame): void {
  const base = fillDarkness(cut, frame);
  litDarkness(cut, frame, base);
  for (const run of frame.light.room?.light.runs ?? []) {
    clearRun(cut, frame, run);
  }
  cut.globalCompositeOperation = 'destination-out';
  const cutters = lightCutters(cut, frame);
  cutLamps(frame, cutters);
  glowObjects(frame, cutters.punch);
  cutDrones(frame, cutters);
  // The open hatch, and a lit room through an open door, as far as each stands open.
  cutHatch(cut, frame);
  const { beam, within } = cutters;
  for (const { lit, open } of frame.light.spills) {
    within(lit, () => beam(lit, SPILL_STOPS.map(([offset, depth]) => [offset, depth * open])));
  }
}

/** Fills the overlay with the darkness, breathing; returns how deep it is this frame. */
function fillDarkness(cut: CanvasRenderingContext2D, frame: Frame): number {
  const { w, h } = frame.viewport;
  cut.setTransform(1, 0, 0, 1, 0, 0);
  cut.globalCompositeOperation = 'source-over';
  const { deadlineAt } = frame;
  const pressed =
    frame.escapeSince !== null || (deadlineAt !== null && deadlineAt - frame.now < 60_000);
  const base = (pressed ? 0.945 : 0.92) + 0.02 * Math.sin(frame.time * (pressed ? 3.2 : 1.7));
  cut.clearRect(0, 0, w, h);
  cut.fillStyle = `rgba(3,5,9,${base})`;
  cut.fillRect(0, 0, w, h);
  return base;
}

/**
 * Your light in the dark: a lit circle round you and a flashlight cone in
 * facing direction; everybody else's softer glow. Each lights what it can
 * see, and nothing behind a wall — so the walls cut a clean edge into the
 * circle. With the power on, your room was cleared whole before. The
 * emergency lamps open the dark a little round them; their red comes after.
 */
function cutLamps(frame: Frame, { punch, beam, within }: Cutters): void {
  const own = frame.light.own;
  if (own !== null) {
    within(own, () => {
      punch(own.lamp.x, own.lamp.y, own.lamp.glow, OWN_GLOW_STOPS);
      beam(own, OWN_BEAM_STOPS);
    });
  }
  for (const lit of frame.light.crew) {
    within(lit, () => punch(lit.lamp.x, lit.lamp.y, lit.lamp.glow, CREW_GLOW_STOPS));
  }
  const dim: Stops = EMERGENCY_STOPS.map(([offset, depth]) => [offset, depth * frame.burn]);
  for (const { mount, lit } of frame.light.lamps) {
    within(lit, () => punch(mount.x, mount.y, EMERGENCY_GLOW, dim));
  }
}

/**
 * Drone cones light their own path as far as the drone sees, which is what
 * makes them readable; a frozen drone has no cone, only a glimmer around its body.
 */
function cutDrones(frame: Frame, { punch, beam, within }: Cutters): void {
  for (const [id, drone] of Object.entries(frame.drones)) {
    const eye = frame.light.eyes.get(id);
    if (eye === undefined) {
      punch(drone.x, drone.y, 0.9, objectGlowStops(0.5));
      continue;
    }
    within(eye, () => beam(eye, DRONE_BEAM_STOPS));
    punch(drone.x, drone.y, 1.1, objectGlowStops(0.75));
  }
}

/**
 * How light is cut into the darkness of `cut` at this frame's zoom: a glow,
 * a beam, and the clip to what a lamp can see.
 */
function lightCutters(cut: CanvasRenderingContext2D, frame: Frame): Cutters {
  const s = frame.camera.scale;
  const punch: Punch = (wx, wy, radius, stops) => {
    const [sx, sy] = toScreen(frame, wx, wy);
    const r = radius * s;
    cut.fillStyle = cutGradient(cut, sx, sy, r, stops);
    cut.fillRect(sx - r, sy - r, r * 2, r * 2);
  };
  /** A beam from `lamp`: its cone, fading out along the gradient `stops`. */
  const beam = ({ lamp }: Lit, stops: Stops): void => {
    if (lamp.beam === null) {
      return;
    }
    const { facing, halfAngle, reach } = lamp.beam;
    const [sx, sy] = toScreen(frame, lamp.x, lamp.y);
    const r = reach * s;
    cut.save();
    cut.beginPath();
    cut.moveTo(sx, sy);
    cut.arc(sx, sy, r, facing - halfAngle, facing + halfAngle);
    cut.closePath();
    cut.clip();
    cut.fillStyle = cutGradient(cut, sx, sy, r, stops);
    cut.fillRect(sx - r, sy - r, r * 2, r * 2);
    cut.restore();
  };
  /** Cuts light into the darkness only where `lit` can see: walls and shut doors stop it. */
  const within = (lit: FrameLit, draw: () => void): void => {
    cut.save();
    inTiles(cut, frame);
    cut.clip(lit.clip);
    cut.setTransform(1, 0, 0, 1, 0, 0);
    draw();
    cut.restore();
  };
  return { punch, beam, within };
}

/** A glow an object gives off on its own: `radius` tiles round (wx, wy), `strength` deep. */
type Glow = (wx: number, wy: number, radius: number, strength: number) => void;

/**
 * The glow the lab's objects give off on their own: the armed station's
 * beacon, the sources found, the sign, the open hatch, the valves — and,
 * on tiles light has fallen on, plates worth finding, crates and drop-offs.
 */
function glowObjects(frame: Frame, punch: Punch): void {
  const glow: Glow = (wx, wy, radius, strength) =>
    punch(wx, wy, radius, objectGlowStops(strength));
  glowStations(frame, glow);
  glowSources(frame, glow);
  glowPlatesAndValves(frame, glow);
  glowItems(frame, glow);
}

/** The armed station's beacon, and a faint one where a station is done. */
function glowStations(frame: Frame, glow: Glow): void {
  for (const station of frame.map.stations) {
    if (station.status === 'armed') {
      glow(station.x + 0.5, station.y + 0.5, 2.4, 0.85);
    } else if (station.status === 'done') {
      glow(station.x + 0.5, station.y + 0.5, 1.1, 0.4);
    }
  }
}

/** The sources found, brighter where they print the armed station's rules, and the sign. */
function glowSources(frame: Frame, glow: Glow): void {
  const { map } = frame;
  for (const manual of map.manuals) {
    const active = coversArmed(map, manual);
    glow(manual.x + 0.5, manual.y + 0.5, active ? 2.1 : 1.3, active ? 0.8 : 0.5);
  }
  if (map.edgeworkSign !== null) {
    glow(map.edgeworkSign.x + 0.5, map.edgeworkSign.y + 0.5, 1.4, 0.6);
  }
}

/** A plate pressed or worth finding where light has fallen, and an emergency's valves. */
function glowPlatesAndValves(frame: Frame, glow: Glow): void {
  const { map, light } = frame;
  // A camera plate is worth finding before anybody stands on it.
  for (const plate of map.plates.filter((p) => light.shown(p.x, p.y))) {
    if (plate.pressed || plate.freezesDrone) {
      glow(plate.x + 0.5, plate.y + 0.5, 1.0, 0.5);
    }
  }
  for (const panel of map.sabotage?.panels ?? []) {
    glow(panel.x + 0.5, panel.y + 0.5, 2.4, 0.9);
  }
}

/** Crates lying about and drop-offs, where light has fallen on them. */
function glowItems(frame: Frame, glow: Glow): void {
  const { light } = frame;
  for (const item of frame.map.items) {
    if (!item.delivered && item.carriedBy === null && light.shown(item.x, item.y)) {
      glow(item.x, item.y, 1.6, 0.7);
    }
    const zone = item.deliverTo;
    if (zone !== null && light.shown(zone.x, zone.y)) {
      glow(zone.x + 0.5, zone.y + 0.5, 1.4, 0.6);
    }
  }
}

/** The lit rooms' tiles grouped by the rooms lighting them, worked out again as rooms come on. */
function litTileGroups(frame: Frame): LitGroup[] {
  const { kit } = frame;
  const lit = [...frame.lit.keys()].join('\n');
  if (kit.groups?.lit !== lit) {
    const rooms = new Map([...frame.lit].map(([label, room]) => [label, room.tiles]));
    kit.groups = { lit, groups: litGroups(rooms) };
  }
  return kit.groups.groups;
}

/**
 * A lit room keeps no darkness at all, walls and doors included — some
 * while its lights are still coming on, and on the escape's alarm
 * lighting: a tile keeps of the overlay's darkness, `base` deep, what
 * every room lighting it leaves. Its pixels are cleared and filled anew,
 * whole ones, so that neighbouring tiles meet without seams; the lamps
 * cut into it after.
 */
function litDarkness(cut: CanvasRenderingContext2D, frame: Frame, base: number): void {
  const groups = litTileGroups(frame);
  const [most, least] = ALARM_DIM;
  const alarmDim = frame.red * (most + (least - most) * sirenSwell(frame));
  const left = (room: string): number =>
    1 - roomUp(frame, frame.lit.get(room)?.since ?? -Infinity) * (1 - alarmDim);
  for (const { rooms, runs } of groups) {
    const keep = rooms.reduce((dark, room) => dark * left(room), 1);
    cut.fillStyle = `rgba(3,5,9,${base * keep})`;
    for (const run of runs) {
      const [x0, y0, x1, y1] = clearRun(cut, frame, run);
      if (keep > 0) {
        cut.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
    }
  }
}

/**
 * Clears the darkness of `cut` over a run of tiles, whole pixels, so that
 * neighbouring runs meet without seams; returns the pixels cleared, left,
 * top, right and bottom.
 */
function clearRun(
  cut: CanvasRenderingContext2D,
  frame: Frame,
  run: Run,
): [number, number, number, number] {
  const [sx0, sy0] = toScreen(frame, run.x, run.y);
  const [sx1, sy1] = toScreen(frame, run.x + run.length, run.y + 1);
  const x0 = Math.round(sx0);
  const y0 = Math.round(sy0);
  const x1 = Math.round(sx1);
  const y1 = Math.round(sy1);
  cut.clearRect(x0, y0, x1 - x0, y1 - y0);
  return [x0, y0, x1, y1];
}

/**
 * Cuts the open hatch's light into the darkness as far as it stands open,
 * where it can see — baked once for that sight (baked.ts), so a frame
 * cuts it in one go.
 */
function cutHatch(cut: CanvasRenderingContext2D, frame: Frame): void {
  const exit = frame.light.exit;
  if (exit === null) {
    return;
  }
  const { kit } = frame;
  const { lit } = exit;
  if (kit.hatchCut?.sight !== lit.sight) {
    const { x, y, glow: r } = lit.lamp;
    const box = bakeBox(frame.map, [], [{ x, y, r }]);
    const draw = (g: CanvasRenderingContext2D): void => {
      g.clip(lit.clip);
      g.fillStyle = cutGradient(g, x, y, r, objectGlowStops(0.95));
      g.fillRect(x - r, y - r, r * 2, r * 2);
    };
    const into = kit.hatchCut?.baked?.canvas;
    kit.hatchCut = { sight: lit.sight, baked: box === null ? null : bake(box, draw, into) };
  }
  if (kit.hatchCut.baked === null) {
    return;
  }
  cut.save();
  inTiles(cut, frame);
  cut.globalAlpha = exit.open;
  drawBaked(cut, kit.hatchCut.baked);
  cut.restore();
}

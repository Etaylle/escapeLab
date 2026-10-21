import type { DronePosition, Sight } from '@escapelab/core';
import { doorOpenness, spillThrough, SPILL_HALF_ANGLE, SPILL_REACH } from './doors.js';
import {
  doorsShut,
  emergencyLamp,
  lampMount,
  lightClip,
  lightMemory,
  reachOf,
  type Lamp,
  type LampMount,
  type LightMemory,
} from './light.js';
import type { FrameLight, FrameLit, PoweredRoom, WorldMap } from './render/frame.js';
import { powerRoom } from './rooms.js';
import type { Sim } from './sim.js';

/**
 * This frame's light, worked out before anything is drawn: which lamps burn,
 * what each of them sees — cut off by walls and shut doors (light.ts) — and
 * where its light may fall as a path, and what the world shows because of
 * them. It remembers what this run's light has fallen on in the simulation
 * (`Sim.light`), and keeps the room the power lights round you (`Sim.room`).
 */

/** Your lamp: a glow all round, and a flashlight cone where you face — in tiles and radians. */
const OWN_GLOW = 3.2;
const CONE_REACH = 7.5;
const CONE_HALF_ANGLE = 0.5;
/** The glow of the lamp everybody else of the crew carries, in tiles. */
const CREW_GLOW = 2.8;
/** How far the green-white light out of the open hatch reaches, in tiles. */
const EXIT_GLOW = 3.2;

/** What a frame's light is worked out from. */
export interface LightScene {
  map: WorldMap;
  sim: Sim;
  drones: Readonly<Record<string, DronePosition>>;
  spectator: boolean;
  /** the run, by its `startedAt` */
  run: number | null;
  /** the wall clock, epoch ms: how far each door has slid */
  now: number;
  /** how far the hatch stands open on this screen, 0 to 1 */
  hatch: number;
  /** where the map's emergency lamps hang */
  mounts: readonly LampMount[];
  /** clip paths in tiles, by the sight they were made from: a lamp standing still reuses its own */
  clips: WeakMap<Sight, Path2D>;
}

/** A frame's lights, before what they show is worked out. */
type FrameLamps = Pick<FrameLight, 'own' | 'room' | 'crew' | 'eyes' | 'lamps' | 'exit' | 'spills'>;

/** Makes a lamp a light of this frame: what it sees from where it hangs, and its clip. */
type LightUp = (lamp: Lamp) => FrameLit;

/** An emergency lamp burns while its room is dark; with the room's lights back, it goes out. */
export function burning(mount: LampMount, litTiles: ReadonlySet<string>): boolean {
  return !litTiles.has(`${Math.floor(mount.x)},${Math.floor(mount.y)}`);
}

/** Where the map's emergency lamps hang; one that hangs nowhere is left out. */
export function mountedLamps(map: WorldMap): LampMount[] {
  return map.lamps.flatMap((lamp) => {
    const mount = lampMount(map, lamp);
    return mount === null ? [] : [mount];
  });
}

/**
 * What the run `run` has lit so far: a fresh memory once a new run has
 * started, the lit rooms seen from the start.
 */
export function runLight(sim: Sim, run: number | null): LightMemory {
  if (sim.light.run !== run) {
    sim.light = lightMemory(run);
    for (const key of sim.litTiles) {
      sim.light.seen.add(key);
    }
  }
  return sim.light;
}

/** Where a light falls, as a path in tiles: the floor it sees and the walls it lights whole. */
function clipPath(clips: WeakMap<Sight, Path2D>, sight: Sight): Path2D {
  const known = clips.get(sight);
  if (known !== undefined) {
    return known;
  }
  const { outline, walls } = lightClip(sight);
  const path = new Path2D();
  outline.forEach((spot, i) =>
    i === 0 ? path.moveTo(spot.x, spot.y) : path.lineTo(spot.x, spot.y),
  );
  path.closePath();
  for (const run of walls) {
    path.rect(run.x, run.y, run.length, 1);
  }
  clips.set(sight, path);
  return path;
}

/**
 * This frame's light, each cut off by walls and shut doors: in the dark
 * your lamp, the crew's lamps, the drones' eyes, the emergency lamps, the
 * open hatch and lit rooms through open doors; while the lab has its
 * power (`powered`), your room lit whole instead — the rest of the lab
 * dark. And what the world shows — whatever lies where light falls now, in
 * a lit room, or fell earlier this run. The audience sees the whole lab,
 * and the drones' cones only; so does everybody once the lab is lit
 * `whole` again, as at the end of a run won.
 */
export function frameLight(scene: LightScene, powered: boolean, whole: boolean): FrameLight {
  const { map, spectator, clips } = scene;
  const memory = runLight(scene.sim, scene.run);
  const shut = doorsShut(map);
  const lit: LightUp = (lamp) => {
    const sight = memory.look(map, lamp, reachOf(lamp), shut);
    return { lamp, sight, clip: clipPath(clips, sight) };
  };
  const lamps = powered ? powerLights(scene) : darkLights(scene, lit);
  const falling = remember(memory, lamps);
  const everything = spectator || whole;
  const shown = (x: number, y: number): boolean =>
    everything || memory.seen.has(`${Math.floor(x)},${Math.floor(y)}`);
  const inPower = (x: number, y: number): boolean =>
    whole || (powered && (spectator || falling.has(`${x},${y}`)));
  const crewShown = (x: number, y: number): boolean =>
    everything || !powered || falling.has(`${Math.floor(x)},${Math.floor(y)}`);
  return { ...lamps, shown, powered: inPower, crewShown };
}

/**
 * The light while the lab has its power: your room's own, whole, to its
 * walls and doors (`ownRoom`) — nothing behind them. Nobody needs a lamp,
 * and the emergency lamps are dark glass. The audience sees the lab whole.
 */
function powerLights(scene: LightScene): FrameLamps {
  return {
    own: null,
    room: scene.spectator ? null : ownRoom(scene.sim, scene.map),
    crew: [],
    eyes: new Map(),
    lamps: [],
    exit: null,
    spills: [],
  };
}

/**
 * The room the power lights round you: the one whose floor you stand on,
 * kept while you stand on a door between two — worked out anew only as
 * you step onto another room's floor.
 */
function ownRoom(sim: Sim, map: WorldMap): PoweredRoom | null {
  const here = `${Math.floor(sim.self.x)},${Math.floor(sim.self.y)}`;
  if (sim.room?.light.keys.has(here) === true) {
    return sim.room;
  }
  const light = powerRoom(map, sim.self);
  if (light !== null) {
    const path = new Path2D();
    for (const run of light.runs) {
      path.rect(run.x, run.y, run.length, 1);
    }
    sim.room = { light, path };
  }
  return sim.room;
}

/**
 * The lights of the dark: your flashlight, the crew's lamps, the drones'
 * eyes, the emergency lamps, the open hatch and the lit rooms' light
 * through open doors.
 */
function darkLights(scene: LightScene, lit: LightUp): FrameLamps {
  const { sim, spectator } = scene;
  const cone = { facing: sim.self.facing, halfAngle: CONE_HALF_ANGLE, reach: CONE_REACH };
  const own = spectator ? null : lit({ x: sim.self.x, y: sim.self.y, glow: OWN_GLOW, beam: cone });
  const crew = spectator
    ? []
    : [...sim.others.values()].map((o) => lit({ x: o.rx, y: o.ry, glow: CREW_GLOW, beam: null }));
  return {
    own,
    room: null,
    crew,
    eyes: droneEyes(scene.drones, lit),
    lamps: burningLamps(scene, lit),
    exit: exitLight(scene, lit),
    spills: doorSpills(scene, lit),
  };
}

/** The open hatch's green-white light, as far as it has ground open; null while it is shut. */
function exitLight(scene: LightScene, lit: LightUp): FrameLight['exit'] {
  const exit = scene.map.exit;
  const open = scene.hatch;
  if (exit === null || open <= 0) {
    return null;
  }
  return { lit: lit({ x: exit.x + 0.5, y: exit.y + 0.5, glow: EXIT_GLOW, beam: null }), open };
}

/** Each lit room's light falling through an open door into the dark: a wedge (doors.ts). */
function doorSpills(scene: LightScene, lit: LightUp): FrameLight['spills'] {
  const { map, sim, now } = scene;
  const inLight = (x: number, y: number): boolean => sim.litTiles.has(`${x},${y}`);
  return map.doors.flatMap((door) => {
    const motion = sim.doors.get(door.id);
    const open = motion === undefined ? Number(door.open) : doorOpenness(motion, now);
    const spill = spillThrough(map, door, open, inLight);
    if (spill === null) {
      return [];
    }
    const beam = { facing: spill.facing, halfAngle: SPILL_HALF_ANGLE, reach: SPILL_REACH };
    return [{ lit: lit({ x: spill.x, y: spill.y, glow: 0, beam }), open }];
  });
}

/** The drones' eyes, by drone id: a frozen drone looks nowhere. */
function droneEyes(
  drones: Readonly<Record<string, DronePosition>>,
  lit: LightUp,
): Map<string, FrameLit> {
  const eyes = new Map<string, FrameLit>();
  for (const [id, drone] of Object.entries(drones)) {
    if (drone.frozen) {
      continue;
    }
    const halfAngle = (drone.halfAngleDeg * Math.PI) / 180;
    const beam = { facing: drone.facing, halfAngle, reach: drone.range };
    eyes.set(id, lit({ x: drone.x, y: drone.y, glow: 0, beam }));
  }
  return eyes;
}

/**
 * Marks the tiles `lamps` light now as seen in `memory`, as a lit room's
 * are from the moment its lights come on (GameWorld.tsx's `lightRoom`):
 * whatever lies there stays drawn this run. Returns the tiles lit now —
 * with the power on, your room's.
 */
function remember(memory: LightMemory, lamps: FrameLamps): Set<string> {
  const falling = new Set<string>(lamps.room?.light.keys);
  const { own, crew, eyes, exit, spills } = lamps;
  const lights = [
    ...(own === null ? [] : [own]),
    ...crew,
    ...eyes.values(),
    ...lamps.lamps.map((l) => l.lit),
    ...(exit === null ? [] : [exit.lit]),
    ...spills.map((spill) => spill.lit),
  ];
  for (const { lamp, sight } of lights) {
    for (const key of memory.lights(lamp, sight)) {
      falling.add(key);
    }
  }
  for (const key of falling) {
    memory.seen.add(key);
  }
  return falling;
}

/**
 * The emergency lamps burning this frame, each with where its light falls:
 * it lights what lies on its tile and round it. The audience, which sees
 * everything anyway, gets none.
 */
function burningLamps(scene: LightScene, lit: LightUp): FrameLight['lamps'] {
  if (scene.spectator) {
    return [];
  }
  return scene.mounts
    .filter((mount) => burning(mount, scene.sim.litTiles))
    .map((mount) => ({ mount, lit: lit(emergencyLamp(mount)) }));
}

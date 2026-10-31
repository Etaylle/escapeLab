import { canSee, type DronePosition, type MapView, type SightMap } from '@escapelab/core';
import {
  audioEngine,
  biquad,
  capped,
  chain,
  claim,
  gain,
  LOOKAHEAD,
  playingEngine,
  playLoop,
  playSample,
  pick,
  release,
  startSample,
  STEP_LEVEL,
  type Engine,
} from './audio.js';
import { stepRate, stepTake, surfaceAt, type Surface } from './footsteps.js';
import { doorsShut } from './light.js';
import type { Spot } from './movement.js';
import { sample, type SfxId } from './samples.js';

/**
 * A partner you can locate: the crew's steps, the drones and the doors sound from where they
 * are — panned by how far to the side they stand, quieter with the distance and, through a wall
 * or a shut door, muffled, turned down and a moment late, by the sight lines everybody uses (core
 * sight.ts `canSee`). The distance works as Web Audio's inverse model does: in full within
 * REF_TILES, falling off beyond with ROLLOFF; a sound beyond MAX_TILES is not started at all,
 * which saves its voice. A partner steps as often as you do (sim.ts: a step every half tile
 * walked), each step one of the three takes of the floor under them (footsteps.ts) played into
 * the stages that place that partner, kept while they are within earshot, within the budget of
 * audio.ts (`CAPS`); the nearest drone within earshot buzzes — a recorded loop — and falls
 * silent, stopped, beyond it; a drone that comes close past you whooshes by (`flyBy`); a drone
 * chirps once as it catches somebody — the moment its lens turns red — a recording placed where
 * it flies. A door that slides open or shut is heard from where it is (`doorMoved`). Your own
 * steps are the same takes, unplaced (audio.ts `footstep`). The audience hears none of it but
 * the doors, unplaced: it hears the crew through the audience link. `hearCrew` moves it all, ten
 * times a second, never per frame. Pure but for the runtime from `hearCrew` on.
 */

/** Tiles to the side at which a sound comes from one side only. */
export const PAN_SPAN = 6;
/** Within this many tiles a sound plays in full; beyond, it falls off inversely. */
export const REF_TILES = 4;
/** How fast it falls off beyond REF_TILES: the inverse model's rolloff factor. */
export const ROLLOFF = 1.2;
/** A sound further away than this many tiles is not started: it saves a voice. */
export const MAX_TILES = 12;
/** Through a wall or a shut door a sound loses what lies above this, Hz… */
export const MUFFLE_HZ = 600;
/** …comes 6 dB down… */
export const WALL_DB = -6;
/** …and this much later, s: the way round the wall. */
export const WALL_DELAY_S = 0.015;
/** With nothing between, the lowpass stands out of the way. */
const OPEN_HZ = 20000;
/** A partner steps once every this many tiles walked: as you do (sim.ts). */
export const STEP_TILES = 0.5;
/** A drone's rotor at full, at the master gain: faint — its loop's RMS at −20 dBFS. */
const ROTOR_LEVEL = 0.02;
/** A drone's chirp at full. */
const CHIRP_LEVEL = 0.03;
/** A drone passing close at full: its whoosh over the rotor. */
const PASS_LEVEL = 0.035;
/** A drone that comes within this many tiles of you passes by: its whoosh plays. */
export const PASS_TILES = 2.5;
/** A drone whooshes by no oftener than this, s: one that hovers about you buzzes. */
export const PASS_EVERY_S = 6;
/** A door sliding at full. */
const DOOR_LEVEL = 0.04;
/** A door shutting: one of these, at random. */
export const DOOR_CLOSES: readonly [SfxId, SfxId] = ['door-close-1', 'door-close-2'];
/** How often `hearCrew` is called, s: the steps of one call are spread over this. */
export const HEAR_EVERY_S = 0.1;
/** How fast the rotor and a partner's feet follow their place, s (a time constant). */
const GLIDE_S = 0.08;

/**
 * Where a sound sits for a listener: left −1 to right 1, how loud, a wall between or not, and
 * whether it is heard at all — within MAX_TILES.
 */
export interface Place {
  pan: number;
  gain: number;
  muffled: boolean;
  heard: boolean;
}

/** The pan of a sound `dx` tiles to the right (left for less than 0): ±1 at PAN_SPAN. */
export function panOf(dx: number): number {
  return Math.max(-1, Math.min(1, dx / PAN_SPAN));
}

/**
 * How loud a sound `distance` tiles away plays, by the inverse model: in full within REF_TILES,
 * then REF_TILES / (REF_TILES + ROLLOFF · (distance − REF_TILES)).
 */
export function distanceGain(distance: number): number {
  const beyond = Math.max(0, distance - REF_TILES);
  return REF_TILES / (REF_TILES + ROLLOFF * beyond);
}

/**
 * Where a sound at `to` sits for a listener at `from`, both in tiles, on `map` with the doors
 * `shut`: panned by the side, turned down by the distance and — with no line of sight between —
 * muffled and WALL_DB further down; not heard at all beyond MAX_TILES.
 */
export function placeOf(map: SightMap, shut: ReadonlySet<string>, from: Spot, to: Spot): Place {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const heard = distance <= MAX_TILES;
  const muffled = heard && !canSee(map, from, to, shut);
  const near = heard ? distanceGain(distance) : 0;
  const level = muffled ? near * 10 ** (WALL_DB / 20) : near;
  return { pan: panOf(to.x - from.x), gain: level, muffled, heard };
}

// --- the runtime -------------------------------------------------------------------------

/**
 * The stages that place a voice: its level, the muffle, the delay round a wall and the pan,
 * and a wall between or not.
 */
interface Placing {
  readonly level: GainNode;
  readonly muffle: BiquadFilterNode;
  readonly delay: DelayNode;
  readonly pan: StereoPannerNode;
  muffled: boolean;
}

/**
 * A partner as their steps are counted: where they were drawn last, the way since a step, the
 * floor of their last step and the stages their steps play into — kept while they are within
 * earshot, null beyond it.
 */
interface Walker {
  x: number;
  y: number;
  walked: number;
  surface: Surface;
  feet: Placing | null;
}

/** The rotor's voice: its loop and the stages that place it. */
interface Rotor extends Placing {
  readonly loop: AudioBufferSourceNode;
}

interface Spatial {
  readonly walkers: Map<string, Walker>;
  rotor: Rotor | null;
  /** the drones that had caught somebody at the last call */
  readonly alerted: Set<string>;
  /** each drone close by at the last call, and when each last whooshed by (audio time) */
  readonly close: Set<string>;
  readonly passed: Map<string, number>;
  /** where the nearest partner sounds from, as the last call placed them */
  partner: Place | null;
}

function nobody(): Spatial {
  return {
    walkers: new Map(),
    rotor: null,
    alerted: new Set(),
    close: new Set(),
    passed: new Map(),
    partner: null,
  };
}

let spatial = nobody();

/** Somebody else of the crew where this screen draws them, and whether they walk. */
interface Drawn {
  readonly rx: number;
  readonly ry: number;
  readonly moving: boolean;
}

/** What the crew's and the drones' sounds follow, ten times a second. */
export interface CrewScene {
  readonly map: SightMap & Pick<MapView, 'doors'>;
  /** where you stand, tiles */
  readonly self: Spot;
  /** the rest of the crew, where this screen draws them (sim.ts `others`) */
  readonly others: ReadonlyMap<string, Drawn>;
  readonly drones: Readonly<Record<string, DronePosition>>;
}

/**
 * Called ten times a second for a player (never for the audience): a partner's steps since the
 * last call sound, placed and spread over the next tenth; the rotor follows the nearest drone
 * within earshot; a drone that comes close whooshes by; a drone that just caught somebody
 * chirps; and the nearest partner's place is kept for the probe.
 */
export function hearCrew(scene: CrewScene): void {
  try {
    const shut = doorsShut(scene.map);
    countSteps(scene, shut);
    hearRotor(scene, shut);
    flyBy(scene, shut);
    chirps(scene, shut);
    spatial.partner = nearestPartner(scene, shut);
  } catch {
    // Deliberately silent: the crew and the drones still show.
  }
}

/** Every partner's steps since the last call; a partner gone from the crew is let go. */
function countSteps(scene: CrewScene, shut: ReadonlySet<string>): void {
  const { walkers } = spatial;
  for (const [id, other] of scene.others) {
    const walker = walkers.get(id);
    if (walker === undefined) {
      const surface = surfaceAt(Math.floor(other.rx), Math.floor(other.ry)) ?? 'concrete';
      walkers.set(id, { x: other.rx, y: other.ry, walked: 0, surface, feet: null });
    } else {
      walk(scene, shut, walker, other);
    }
  }
  for (const [id, walker] of walkers) {
    if (!scene.others.has(id)) {
      letFeetGo(walker);
      walkers.delete(id);
    }
  }
}

/**
 * A partner's way since the last call: each STEP_TILES of it walked is a step into their feet —
 * the rest carried over, so that the steps keep their pace — on the floor under them, spread
 * over the next call's tenth.
 */
function walk(scene: CrewScene, shut: ReadonlySet<string>, walker: Walker, other: Drawn): void {
  const moved = Math.hypot(other.rx - walker.x, other.ry - walker.y);
  walker.x = other.rx;
  walker.y = other.ry;
  walker.surface = surfaceAt(Math.floor(other.rx), Math.floor(other.ry)) ?? walker.surface;
  walker.walked = other.moving ? walker.walked + moved : 0;
  const steps = Math.floor(walker.walked / STEP_TILES);
  walker.walked -= steps * STEP_TILES;
  if (steps === 0 && walker.feet === null) return;
  const feet = feetOf(walker, placeOf(scene.map, shut, scene.self, { x: other.rx, y: other.ry }));
  for (let i = 0; i < steps && feet !== null; i++) {
    partnerStep(feet, walker.surface, (i * HEAR_EVERY_S) / steps);
  }
}

/**
 * The stages a partner's steps play into, moved to where they are now: made as their first step
 * within earshot comes, let go as they leave it. Null out of earshot.
 */
function feetOf(walker: Walker, place: Place): Placing | null {
  const engine = playingEngine();
  if (engine === null || !place.heard) {
    letFeetGo(walker);
    return null;
  }
  if (walker.feet === null) {
    walker.feet = placing(engine.ctx, engine.effects, place, STEP_LEVEL);
  } else {
    moveTo(walker.feet, place, STEP_LEVEL);
  }
  return walker.feet;
}

/** A partner's feet unwired: out of earshot, or gone. */
function letFeetGo(walker: Walker): void {
  walker.feet?.pan.disconnect();
  walker.feet = null;
}

/** The stages placing a voice into `dest`, standing at `place` already, at `full`. */
function placing(ctx: BaseAudioContext, dest: AudioNode, place: Place, full: number): Placing {
  const level = gain(ctx, full * place.gain);
  const muffle = biquad(ctx, 'lowpass', place.muffled ? MUFFLE_HZ : OPEN_HZ, 0);
  const delay = ctx.createDelay(WALL_DELAY_S * 2);
  delay.delayTime.value = place.muffled ? WALL_DELAY_S : 0;
  const pan = ctx.createStereoPanner();
  pan.pan.value = place.pan;
  chain(level, muffle, delay, pan, dest);
  return { level, muffle, delay, pan, muffled: place.muffled };
}

/**
 * Moves `stages` on to `place` at `full`, gliding; the muffle and the delay round the wall
 * switched as a wall comes or goes.
 */
function moveTo(stages: Placing, place: Place, full: number): void {
  const now = stages.level.context.currentTime;
  stages.level.gain.setTargetAtTime(full * place.gain, now, GLIDE_S);
  stages.pan.pan.setTargetAtTime(place.pan, now, GLIDE_S);
  if (place.muffled !== stages.muffled) {
    stages.muffled = place.muffled;
    const hz = stages.muffle.frequency;
    hz.setValueAtTime(place.muffled ? OPEN_HZ : MUFFLE_HZ, now);
    hz.linearRampToValueAtTime(place.muffled ? MUFFLE_HZ : OPEN_HZ, now + 0.05);
    stages.delay.delayTime.setTargetAtTime(place.muffled ? WALL_DELAY_S : 0, now, GLIDE_S);
  }
}

/**
 * A partner's footstep on `surface` into their `feet`, `delay` s from now: one of its takes at
 * random, ±5 % in speed.
 */
function partnerStep(feet: Placing, surface: Surface, delay: number): void {
  const { context } = feet.level;
  const at = context.currentTime + LOOKAHEAD + delay;
  playSample(context, sample(stepTake(surface)), feet.level, at, stepRate());
}

/** The nearest drone in flight within earshot; none where there is none. */
function nearestDrone(scene: CrewScene): DronePosition | undefined {
  let nearest: DronePosition | undefined;
  let best = MAX_TILES;
  for (const drone of Object.values(scene.drones)) {
    const away = Math.hypot(drone.x - scene.self.x, drone.y - scene.self.y);
    if (!drone.frozen && away < best) {
      best = away;
      nearest = drone;
    }
  }
  return nearest;
}

/**
 * The rotor follows the nearest drone in flight within earshot: placed anew each call, its
 * muffle switched only as a wall comes or goes; with none, it stops — a stopped loop costs
 * nothing — and starts again as one comes near.
 */
function hearRotor(scene: CrewScene, shut: ReadonlySet<string>): void {
  const engine = audioEngine();
  const drone = nearestDrone(scene);
  if (engine === null || drone === undefined) {
    stopRotor();
    return;
  }
  const place = placeOf(scene.map, shut, scene.self, drone);
  const rotor = spatial.rotor ?? startRotor(engine, place);
  if (rotor !== null) moveTo(rotor, place, ROTOR_LEVEL);
}

/**
 * The rotor's voice at `place`, silent until moved there — it glides in; null while its
 * recording loads or the budget is full.
 */
function startRotor(engine: Engine, place: Place): Rotor | null {
  const loop = sample('drone-rotor');
  if (loop === null || !claim({ loop: 1 })) return null;
  const { ctx } = engine;
  const stages = placing(ctx, engine.effects, place, 0);
  const source = playLoop(ctx, loop.buffer, stages.level, ctx.currentTime + LOOKAHEAD);
  source.onended = () => {
    release({ loop: 1 });
    stages.pan.disconnect();
  };
  spatial.rotor = { ...stages, loop: source };
  return spatial.rotor;
}

/** The rotor fades out and stops: no drone near any more, or the world is gone. */
function stopRotor(): void {
  const rotor = spatial.rotor;
  spatial.rotor = null;
  if (rotor === null) return;
  const now = rotor.level.context.currentTime;
  rotor.level.gain.setTargetAtTime(0, now, GLIDE_S);
  rotor.loop.stop(now + 0.4);
}

/**
 * A drone in flight that has just come within PASS_TILES whooshes by — its rotors rising and
 * falling away, placed where it flies — once in PASS_EVERY_S at most.
 */
function flyBy(scene: CrewScene, shut: ReadonlySet<string>): void {
  const engine = playingEngine();
  const now = engine?.ctx.currentTime ?? 0;
  for (const [id, drone] of Object.entries(scene.drones)) {
    const away = Math.hypot(drone.x - scene.self.x, drone.y - scene.self.y);
    const close = !drone.frozen && away < PASS_TILES;
    const rested = now - (spatial.passed.get(id) ?? -Infinity) >= PASS_EVERY_S;
    if (close && !spatial.close.has(id) && rested && engine !== null) {
      spatial.passed.set(id, now);
      placedOnce(engine, 'drone-pass', placeOf(scene.map, shut, scene.self, drone), PASS_LEVEL);
    }
    if (close) spatial.close.add(id);
    else spatial.close.delete(id);
  }
}

/** A drone that has just caught somebody chirps once, from where it is. */
function chirps(scene: CrewScene, shut: ReadonlySet<string>): void {
  for (const [id, drone] of Object.entries(scene.drones)) {
    if (drone.alerted && !spatial.alerted.has(id)) {
      const engine = playingEngine();
      const place = placeOf(scene.map, shut, scene.self, drone);
      if (engine !== null) placedOnce(engine, 'drone-alert', place, CHIRP_LEVEL);
    }
  }
  spatial.alerted.clear();
  for (const [id, drone] of Object.entries(scene.drones)) {
    if (drone.alerted) spatial.alerted.add(id);
  }
}

/**
 * The recording `id` once at `place`, at `level` in full: a voice of the budget, placed as it is
 * heard; nothing beyond earshot, or where it is not loaded.
 */
function placedOnce(engine: Engine, id: SfxId, place: Place, level: number): void {
  const recording = sample(id);
  if (recording === null || !place.heard) return;
  const { ctx } = engine;
  const t = ctx.currentTime + LOOKAHEAD;
  capped(ctx, engine.effects, { voice: 1 }, (out) => [
    startSample(ctx, recording, placing(ctx, out, place, level).level, t),
  ]);
}

/** A door of the map as it slides: where it is, and whether it now stands open. */
export interface MovingDoor {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly open: boolean;
}

/**
 * A door that has started to slide (GameWorld.tsx, the frame it turns): opening, its pneumatic
 * slide; shutting, one of DOOR_CLOSES — heard from where it is by a player at `listener`, its
 * own leaf no wall between; unplaced for the audience (`listener` null).
 */
export function doorMoved(
  map: SightMap & Pick<MapView, 'doors'>,
  listener: Spot | null,
  door: MovingDoor,
): void {
  try {
    const engine = playingEngine();
    if (engine === null) return;
    const id: SfxId = door.open ? 'door-slide' : pick(DOOR_CLOSES);
    const shut = doorsShut(map);
    shut.delete(`${door.x},${door.y}`);
    const middle = { x: door.x + 0.5, y: door.y + 0.5 };
    const unplaced: Place = { pan: 0, gain: 1, muffled: false, heard: true };
    const place = listener === null ? unplaced : placeOf(map, shut, listener, middle);
    placedOnce(engine, id, place, DOOR_LEVEL);
  } catch {
    // Deliberately silent: the door slides on screen as well.
  }
}

/** Where the nearest partner sounds from now; null with nobody else about. */
function nearestPartner(scene: CrewScene, shut: ReadonlySet<string>): Place | null {
  let nearest: Spot | null = null;
  let best = Infinity;
  for (const other of scene.others.values()) {
    const away = Math.hypot(other.rx - scene.self.x, other.ry - scene.self.y);
    if (away < best) {
      best = away;
      nearest = { x: other.rx, y: other.ry };
    }
  }
  return nearest === null ? null : placeOf(scene.map, shut, scene.self, nearest);
}

/** The world is gone: the rotor falls silent, and nobody's steps are counted any more. */
export function stopSpatial(): void {
  try {
    stopRotor();
    for (const walker of spatial.walkers.values()) letFeetGo(walker);
  } catch {
    // Deliberately silent: the rotor's and the feet's nodes go with the context at the latest.
  }
  spatial = nobody();
}

/** Where the nearest partner sounds from: their pan and gain; null with nobody about. */
export interface SpatialProbe {
  partnerPan: number | null;
  partnerGain: number | null;
}

export function spatialProbe(): SpatialProbe {
  const { partner } = spatial;
  return { partnerPan: partner?.pan ?? null, partnerGain: partner?.gain ?? null };
}

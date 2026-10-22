import { canSee, type DronePosition, type MapView, type SightMap } from '@escapelab/core';
import { WALL_SHARE } from '../voice/rules.js';
import {
  audioEngine,
  biquad,
  capped,
  chain,
  claim,
  FOOTSTEP_LEVEL,
  gain,
  LOOKAHEAD,
  loopOf,
  modulate,
  noiseBuffer,
  playingEngine,
  playLoop,
  playSample,
  rand,
  release,
  sampleOf,
  stepInto,
  tone,
  type Engine,
} from './audio.js';
import { doorsShut } from './light.js';
import type { Spot } from './movement.js';

/**
 * A partner you can locate: the crew's steps and the drones' rotors sound from where they are —
 * panned by how far to the side they stand, quieter with the distance and muffled through a
 * wall or a shut door, by the sight lines everybody uses (core sight.ts `canSee`) and the
 * voice's rule for a wall between (voice/rules.ts WALL_SHARE). A partner steps as often as you
 * do (sim.ts: a step every half tile walked), each step a sample rendered once and played into
 * the stages that place that partner, kept while they are within earshot, within the budget of
 * audio.ts (`CAPS`); the nearest drone within earshot buzzes — a loop rendered once — and
 * falls silent, stopped, beyond it; a drone chirps once as it catches somebody — the moment its
 * lens turns red. Your own steps stay as they are (audio.ts `footstep`). The audience hears
 * none of it: it hears the crew through the audience link. `hearCrew` moves it all, ten times
 * a second, never per frame. Pure but for the runtime from `hearCrew` on.
 */

/** Tiles to the side at which a sound comes from one side only. */
export const PAN_SPAN = 6;
/** Within this many tiles a sound plays at full… */
export const FULL_WITHIN = 2;
/** …and at this many it has faded away. */
export const SILENT_AT = 10;
/** Through a wall or a shut door a sound loses what lies above this, Hz. */
export const MUFFLE_HZ = 600;
/** With nothing between, the lowpass stands out of the way. */
const OPEN_HZ = 20000;
/** A partner steps once every this many tiles walked: as you do (sim.ts). */
export const STEP_TILES = 0.5;
/** A drone's rotor at full, at the master gain: faint. */
const ROTOR_LEVEL = 0.012;
/** A drone's chirp at full. */
const CHIRP_LEVEL = 0.03;
/** How often `hearCrew` is called, s: the steps of one call are spread over this. */
export const HEAR_EVERY_S = 0.1;
/** How fast the rotor and a partner's feet follow their place, s (a time constant). */
const GLIDE_S = 0.08;
/** A partner's step is rendered in this many takes, each with its own scuff of the noise… */
const STEP_TAKES = 3;
/** …each this long, s. */
const STEP_S = 0.1;

/** Where a sound sits for a listener: left −1 to right 1, how loud, and a wall between or not. */
export interface Place {
  pan: number;
  gain: number;
  muffled: boolean;
}

/** The pan of a sound `dx` tiles to the right (left for less than 0): ±1 at PAN_SPAN. */
export function panOf(dx: number): number {
  return Math.max(-1, Math.min(1, dx / PAN_SPAN));
}

/** How loud a sound `distance` tiles away plays: in full within FULL_WITHIN, gone at SILENT_AT. */
export function distanceGain(distance: number): number {
  const fade = (distance - FULL_WITHIN) / (SILENT_AT - FULL_WITHIN);
  return Math.max(0, Math.min(1, 1 - fade));
}

/**
 * Where a sound at `to` sits for a listener at `from`, both in tiles, on `map` with the doors
 * `shut`: panned by the side, faded by the distance, and — with no line of sight between —
 * muffled and turned down to the share a voice keeps through a wall.
 */
export function placeOf(map: SightMap, shut: ReadonlySet<string>, from: Spot, to: Spot): Place {
  const near = distanceGain(Math.hypot(to.x - from.x, to.y - from.y));
  const muffled = near > 0 && !canSee(map, from, to, shut);
  return { pan: panOf(to.x - from.x), gain: muffled ? near * WALL_SHARE : near, muffled };
}

// --- the runtime -------------------------------------------------------------------------

/** The stages that place a voice: its level, the muffle and the pan, and a wall between or not. */
interface Placing {
  readonly level: GainNode;
  readonly muffle: BiquadFilterNode;
  readonly pan: StereoPannerNode;
  muffled: boolean;
}

/**
 * A partner as their steps are counted: where they were drawn last, the way since a step, and
 * the stages their steps play into — kept while they are within earshot, null beyond it.
 */
interface Walker {
  x: number;
  y: number;
  walked: number;
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
  /** where the nearest partner sounds from, as the last call placed them */
  partner: Place | null;
}

function nobody(): Spatial {
  return { walkers: new Map(), rotor: null, alerted: new Set(), partner: null };
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
 * within earshot; a drone that just caught somebody chirps; and the nearest partner's place is
 * kept for the probe.
 */
export function hearCrew(scene: CrewScene): void {
  try {
    prepareSteps();
    const shut = doorsShut(scene.map);
    countSteps(scene, shut);
    hearRotor(scene, shut);
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
      walkers.set(id, { x: other.rx, y: other.ry, walked: 0, feet: null });
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
 * the rest carried over, so that the steps keep their pace — spread over the next call's tenth.
 */
function walk(scene: CrewScene, shut: ReadonlySet<string>, walker: Walker, other: Drawn): void {
  const moved = Math.hypot(other.rx - walker.x, other.ry - walker.y);
  walker.x = other.rx;
  walker.y = other.ry;
  walker.walked = other.moving ? walker.walked + moved : 0;
  const steps = Math.floor(walker.walked / STEP_TILES);
  walker.walked -= steps * STEP_TILES;
  if (steps === 0 && walker.feet === null) return;
  const feet = feetOf(walker, placeOf(scene.map, shut, scene.self, { x: other.rx, y: other.ry }));
  for (let i = 0; i < steps && feet !== null; i++) partnerStep(feet, (i * HEAR_EVERY_S) / steps);
}

/**
 * The stages a partner's steps play into, moved to where they are now: made as their first step
 * within earshot comes, let go as they leave it. Null out of earshot.
 */
function feetOf(walker: Walker, place: Place): Placing | null {
  const engine = playingEngine();
  if (engine === null || place.gain <= 0.01) {
    letFeetGo(walker);
    return null;
  }
  if (walker.feet === null) {
    walker.feet = placing(engine.ctx, engine.master, place, FOOTSTEP_LEVEL);
  } else {
    moveTo(walker.feet, place, FOOTSTEP_LEVEL);
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
  const pan = ctx.createStereoPanner();
  pan.pan.value = place.pan;
  chain(level, muffle, pan, dest);
  return { level, muffle, pan, muffled: place.muffled };
}

/** Moves `stages` on to `place` at `full`, gliding; the muffle switched as a wall comes or goes. */
function moveTo(stages: Placing, place: Place, full: number): void {
  const now = stages.level.context.currentTime;
  stages.level.gain.setTargetAtTime(full * place.gain, now, GLIDE_S);
  stages.pan.pan.setTargetAtTime(place.pan, now, GLIDE_S);
  if (place.muffled !== stages.muffled) {
    stages.muffled = place.muffled;
    const hz = stages.muffle.frequency;
    hz.setValueAtTime(place.muffled ? OPEN_HZ : MUFFLE_HZ, now);
    hz.linearRampToValueAtTime(place.muffled ? MUFFLE_HZ : OPEN_HZ, now + 0.05);
  }
}

/** The take `n` of a partner's step, rendered once at half the live rate; null while it renders. */
function stepTake(n: number, rate: number): AudioBuffer | null {
  return sampleOf(`spatial/step ${n}`, (ctx, dest) => stepInto(ctx, dest, 0, 1), STEP_S, rate);
}

/** Sets every take of the step rendering, before a partner's first step: they are ready by it. */
function prepareSteps(): void {
  const engine = audioEngine();
  if (engine === null) return;
  noiseBuffer(engine.ctx); // the shared noise at the live rate, before a take is cut from it
  for (let n = 0; n < STEP_TAKES; n++) stepTake(n, engine.ctx.sampleRate / 2);
}

/** A partner's footstep into their `feet`, `delay` s from now: a take at random, ±10 % in pitch. */
function partnerStep(feet: Placing, delay: number): void {
  const { context } = feet.level;
  const take = stepTake(Math.floor(Math.random() * STEP_TAKES), context.sampleRate / 2);
  const at = context.currentTime + LOOKAHEAD + delay;
  playSample(context, take, feet.level, at, rand(0.9, 1.1));
}

/** The nearest drone in flight within earshot, and how far it is; none where there is none. */
function nearestDrone(scene: CrewScene): DronePosition | undefined {
  let nearest: DronePosition | undefined;
  let best = SILENT_AT;
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
 * The rotor's voice at `place`, silent until moved there — it glides in; null while its loop
 * renders or the budget is full.
 */
function startRotor(engine: Engine, place: Place): Rotor | null {
  const loop = rotorLoopOf(engine);
  if (loop === null || !claim({ loop: 1 })) return null;
  const { ctx } = engine;
  const stages = placing(ctx, engine.master, place, 0);
  const source = playLoop(ctx, loop, stages.level, ctx.currentTime + LOOKAHEAD);
  source.onended = () => {
    release({ loop: 1 });
    stages.pan.disconnect();
  };
  spatial.rotor = { ...stages, loop: source };
  return spatial.rotor;
}

/**
 * A drone's rotor: two detuned saws beating in a band, fluttering with the blades at 31 Hz —
 * all whole cycles in its loop of two seconds.
 */
function rotor(ctx: BaseAudioContext, dest: AudioNode): void {
  const flutter = gain(ctx, 0.6);
  flutter.connect(dest);
  const band = biquad(ctx, 'bandpass', 900, 1.1);
  band.connect(flutter);
  const blades = ctx.createOscillator();
  blades.frequency.value = 31;
  modulate(ctx, blades, 0.4, flutter.gain);
  blades.start(0);
  for (const frequency of [118, 121.5]) {
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = frequency;
    saw.connect(band);
    saw.start(0);
  }
}

/** The rotor's loop, rendered once at half the live rate; null while it renders. */
function rotorLoopOf(engine: Engine): AudioBuffer | null {
  return loopOf('spatial/rotor', rotor, 2, engine.ctx.sampleRate / 2);
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

/** A drone that has just caught somebody chirps once, from where it is. */
function chirps(scene: CrewScene, shut: ReadonlySet<string>): void {
  for (const [id, drone] of Object.entries(scene.drones)) {
    if (drone.alerted && !spatial.alerted.has(id)) {
      alertChirp(placeOf(scene.map, shut, scene.self, drone));
    }
  }
  spatial.alerted.clear();
  for (const [id, drone] of Object.entries(scene.drones)) {
    if (drone.alerted) spatial.alerted.add(id);
  }
}

/** A drone's chirp at its place: two quick rising blips. */
function alertChirp(place: Place): void {
  const engine = playingEngine();
  if (engine === null || place.gain <= 0.01) return;
  const { ctx } = engine;
  const t = ctx.currentTime + LOOKAHEAD;
  capped(ctx, engine.master, { voice: 2 }, (out) => {
    const band = biquad(ctx, 'bandpass', 1800, 1.5);
    band.connect(placing(ctx, out, place, CHIRP_LEVEL).level);
    return (
      [
        [t, 1500, 0.05],
        [t + 0.08, 2200, 0.07],
      ] as const
    ).map(([at, hz, hold]) => {
      const blip = { type: 'square', at, from: hz, to: hz, peak: 0.7, hold } as const;
      return tone(ctx, band, { ...blip, attack: 0.003, decay: 0.04 });
    });
  });
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

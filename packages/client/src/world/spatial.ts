import { canSee, type DronePosition, type MapView, type SightMap } from '@escapelab/core';
import { WALL_SHARE } from '../voice/rules.js';
import {
  audioEngine,
  biquad,
  chain,
  FOOTSTEP_LEVEL,
  gain,
  LOOKAHEAD,
  modulate,
  onAllEnded,
  playingEngine,
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
 * do (sim.ts: a step every half tile walked); a drone buzzes for as long as it flies, and chirps
 * once as it catches somebody — the moment its lens turns red. Your own steps stay as they are
 * (audio.ts `footstep`). The audience hears none of it: it hears the crew through the audience
 * link. Pure but for the runtime from `hearCrew` on.
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
/** How often the drones and the partner are placed anew, ms. */
const PLACE_MS = 100;
/** How fast a rotor follows its drone's place, s (a time constant). */
const GLIDE_S = 0.08;

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

/** A partner as their steps are counted: where they were drawn last, and the way since a step. */
interface Walker {
  x: number;
  y: number;
  walked: number;
}

/** A drone's rotor: its sources and the stages that place it. */
interface Rotor {
  readonly sources: OscillatorNode[];
  readonly level: GainNode;
  readonly muffle: BiquadFilterNode;
  readonly pan: StereoPannerNode;
  alerted: boolean;
}

interface Spatial {
  readonly walkers: Map<string, Walker>;
  readonly rotors: Map<string, Rotor>;
  /** performance.now() of the last placing round; −∞ before the first */
  placedAt: number;
  /** where the nearest partner sounds from, as the last round placed them */
  partner: Place | null;
}

function nobody(): Spatial {
  return { walkers: new Map(), rotors: new Map(), placedAt: -Infinity, partner: null };
}

let spatial = nobody();

/** Somebody else of the crew where this screen draws them, and whether they walk. */
interface Drawn {
  readonly rx: number;
  readonly ry: number;
  readonly moving: boolean;
}

/** What the crew's and the drones' sounds follow this frame. */
export interface CrewScene {
  readonly map: SightMap & Pick<MapView, 'doors'>;
  /** where you stand, tiles */
  readonly self: Spot;
  /** the rest of the crew, where this screen draws them (sim.ts `others`) */
  readonly others: ReadonlyMap<string, Drawn>;
  readonly drones: Readonly<Record<string, DronePosition>>;
  /** the page's clock, ms (performance.now()) */
  readonly now: number;
}

/**
 * Called every frame for a player (never for the audience): a partner who walked another half
 * tile steps, placed; every PLACE_MS the drones' rotors follow them and the nearest partner's
 * place is kept for the probe. Nothing is made in a frame without a sound in it.
 */
export function hearCrew(scene: CrewScene): void {
  try {
    countSteps(scene);
    if (scene.now - spatial.placedAt >= PLACE_MS) {
      spatial.placedAt = scene.now;
      const shut = doorsShut(scene.map);
      placeRotors(scene, shut);
      spatial.partner = nearestPartner(scene, shut);
    }
  } catch {
    // Deliberately silent: the crew and the drones still show.
  }
}

/** Every partner's way since their last step; one past STEP_TILES steps, placed. */
function countSteps(scene: CrewScene): void {
  const { walkers } = spatial;
  for (const [id, other] of scene.others) {
    const walker = walkers.get(id);
    if (walker === undefined) {
      walkers.set(id, { x: other.rx, y: other.ry, walked: 0 });
      continue;
    }
    const moved = Math.hypot(other.rx - walker.x, other.ry - walker.y);
    walker.x = other.rx;
    walker.y = other.ry;
    walker.walked = other.moving ? walker.walked + moved : 0;
    if (walker.walked > STEP_TILES) {
      walker.walked = 0;
      const at = { x: other.rx, y: other.ry };
      partnerStep(placeOf(scene.map, doorsShut(scene.map), scene.self, at));
    }
  }
  for (const id of walkers.keys()) {
    if (!scene.others.has(id)) walkers.delete(id);
  }
}

/** A stage chain placing a sound: its level, the muffle and the pan, into the master gain. */
function placed(engine: Engine, place: Place, level: number): { input: GainNode; out: AudioNode } {
  const { ctx } = engine;
  const input = gain(ctx, level * place.gain);
  const pan = ctx.createStereoPanner();
  pan.pan.value = place.pan;
  chain(input, biquad(ctx, 'lowpass', place.muffled ? MUFFLE_HZ : OPEN_HZ, 0), pan, engine.master);
  return { input, out: pan };
}

/** A partner's footstep where they are; none they would not be heard at. */
function partnerStep(place: Place): void {
  const engine = playingEngine();
  if (engine === null || place.gain <= 0.01) return;
  const { input, out } = placed(engine, place, FOOTSTEP_LEVEL);
  const sources = stepInto(engine.ctx, input, engine.ctx.currentTime + LOOKAHEAD);
  onAllEnded(sources, () => out.disconnect());
}

/** The drones' rotors follow them, a new drone starts buzzing, one gone falls silent. */
function placeRotors(scene: CrewScene, shut: ReadonlySet<string>): void {
  const engine = audioEngine();
  if (engine === null) return;
  const now = engine.ctx.currentTime;
  for (const [id, drone] of Object.entries(scene.drones)) {
    const place = placeOf(scene.map, shut, scene.self, drone);
    const rotor = spatial.rotors.get(id) ?? addRotor(engine, id);
    rotor.level.gain.setTargetAtTime(drone.frozen ? 0 : ROTOR_LEVEL * place.gain, now, GLIDE_S);
    rotor.pan.pan.setTargetAtTime(place.pan, now, GLIDE_S);
    rotor.muffle.frequency.setTargetAtTime(place.muffled ? MUFFLE_HZ : OPEN_HZ, now, GLIDE_S);
    if (drone.alerted && !rotor.alerted) alertChirp(place);
    rotor.alerted = drone.alerted;
  }
  for (const [id, rotor] of spatial.rotors) {
    if (scene.drones[id] === undefined) {
      spatial.rotors.delete(id);
      stopRotor(rotor, now);
    }
  }
}

/**
 * A drone's rotor, silent until placed: two detuned saws beating in a band, fluttering with
 * its blades at ~31 Hz.
 */
function addRotor(engine: Engine, id: string): Rotor {
  const { ctx } = engine;
  const at = ctx.currentTime;
  const level = gain(ctx, 0);
  const muffle = biquad(ctx, 'lowpass', OPEN_HZ, 0);
  const pan = ctx.createStereoPanner();
  chain(level, muffle, pan, engine.master);
  const flutter = gain(ctx, 0.6);
  chain(flutter, level);
  const band = biquad(ctx, 'bandpass', 900, 1.1);
  band.connect(flutter);
  const blades = ctx.createOscillator();
  blades.frequency.value = 31;
  modulate(ctx, blades, 0.4, flutter.gain);
  const saws = [118, 121.5].map((frequency) => {
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = frequency;
    saw.connect(band);
    return saw;
  });
  const sources = [...saws, blades];
  for (const source of sources) source.start(at);
  const rotor: Rotor = { sources, level, muffle, pan, alerted: false };
  spatial.rotors.set(id, rotor);
  return rotor;
}

function stopRotor(rotor: Rotor, now: number): void {
  rotor.level.gain.setTargetAtTime(0, now, GLIDE_S);
  for (const source of rotor.sources) source.stop(now + 0.4);
  onAllEnded(rotor.sources, () => rotor.pan.disconnect());
}

/** A drone that caught somebody chirps once from where it is: two quick rising blips. */
function alertChirp(place: Place): void {
  const engine = playingEngine();
  if (engine === null || place.gain <= 0.01) return;
  const { ctx } = engine;
  const { input, out } = placed(engine, place, CHIRP_LEVEL);
  const band = biquad(ctx, 'bandpass', 1800, 1.5);
  band.connect(input);
  const t = ctx.currentTime + LOOKAHEAD;
  const blips = (
    [
      [t, 1500, 0.05],
      [t + 0.08, 2200, 0.07],
    ] as const
  ).map(([at, hz, hold]) => {
    const blip = { type: 'square', at, from: hz, to: hz, peak: 0.7, hold } as const;
    return tone(ctx, band, { ...blip, attack: 0.003, decay: 0.04 });
  });
  onAllEnded(blips, () => out.disconnect());
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

/** The world is gone: every rotor falls silent, and nobody's steps are counted any more. */
export function stopSpatial(): void {
  try {
    const now = audioEngine()?.ctx.currentTime ?? 0;
    for (const rotor of spatial.rotors.values()) stopRotor(rotor, now);
  } catch {
    // Deliberately silent: the rotors' nodes are released with the context at the latest.
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


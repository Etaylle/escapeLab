import type { DronePosition, MapView, SightMap } from '@escapelab/core';
import { addProbes } from '../probes.js';
import {
  biquad,
  capped,
  chain,
  gain,
  LOOKAHEAD,
  playingEngine,
  startSample,
} from './audio.js';
import { traceRequested } from './frameTrace.js';
import { doorsShut } from './light.js';
import type { MarkerTarget } from './markers.js';
import type { Spot } from './movement.js';
import { ALARM, css } from './palette.js';
import { sample } from './samples.js';
import { MUFFLE_HZ, placeOf, type Place } from './spatial.js';

/**
 * The danger sense: a drone in flight within DANGER_TILES that comes nearer — it flies at
 * this player, or the player walks into it — ticks, faster and higher the nearer it comes, from
 * where it flies (spatial.ts `placeOf`: panned, quieter with the distance, muffled through a
 * wall); and the screen's edge glows toward it, through the marker system (markers.ts: a
 * target with a glow). At every difficulty. A drone held still by its plate, one flying off or
 * one further away is quiet. Looked at ten times a second with the rest of the lab's sound
 * (GameWorld.tsx `hearTheLab`), never per frame.
 */

/** How near a drone has to come to be sensed, tiles. */
export const DANGER_TILES = 5;
/** How far back a look compares, s: the positions stream too often for one step to tell. */
export const LOOK_BACK_S = 0.4;
/** A drone comes nearer when it is this much nearer than LOOK_BACK_S ago, tiles. */
export const CLOSING_TILES = 0.1;
/** The tick at the edge of the sense and right beside: how far apart, ms. */
const TICK_FAR_MS = 900;
const TICK_NEAR_MS = 220;
/** How fast the tick plays there: its pitch climbs as the drone comes. */
const RATE_FAR = 1.15;
const RATE_NEAR = 1.75;
/** The tick: the ping's recording, cut this short, s, at this level before its place. */
const TICK_S = 0.07;
const TICK_LEVEL = 0.03;

/** A drone closing in: which, where it flies, and how far it is, tiles. */
export interface Sensed {
  id: string;
  x: number;
  y: number;
  distance: number;
}

/** How near `distance` is within the sense: 0 at its edge, 1 right beside. */
function nearness(distance: number): number {
  return Math.min(1, Math.max(0, 1 - distance / DANGER_TILES));
}

/** How far apart the ticks come for a drone `distance` tiles away, ms. */
export function tickEvery(distance: number): number {
  return TICK_FAR_MS + (TICK_NEAR_MS - TICK_FAR_MS) * nearness(distance);
}

/** How fast the tick plays for a drone `distance` tiles away: higher the nearer. */
export function tickRate(distance: number): number {
  return RATE_FAR + (RATE_NEAR - RATE_FAR) * nearness(distance);
}

/** How strongly the edge glows toward a drone `distance` tiles away, 0 to 1. */
export function glowOf(distance: number): number {
  return 0.35 + 0.65 * nearness(distance);
}

/**
 * Of `drones`, the nearest one in flight within DANGER_TILES of `self` that is nearer than at
 * the look LOOK_BACK_S ago (`before`: each drone's distance then) — or, where `held` names the
 * drone sensed last, still within the sense and not flying off. Null where none closes in.
 */
export function closingDrone(
  self: Spot,
  drones: Readonly<Record<string, DronePosition>>,
  before: ReadonlyMap<string, number>,
  held: string | null,
): Sensed | null {
  let nearest: Sensed | null = null;
  for (const [id, drone] of Object.entries(drones)) {
    const distance = Math.hypot(drone.x - self.x, drone.y - self.y);
    const then = before.get(id);
    if (drone.frozen || distance > DANGER_TILES || then === undefined) {
      continue;
    }
    const closing = distance < then - CLOSING_TILES;
    const staying = id === held && distance <= then + CLOSING_TILES;
    if ((closing || staying) && (nearest === null || distance < nearest.distance)) {
      nearest = { id, x: drone.x, y: drone.y, distance };
    }
  }
  return nearest;
}

/** What the sense keeps from look to look. */
interface Danger {
  /** every look's distances, the newest last, each with its time (ms) */
  looks: { at: number; distances: Map<string, number> }[];
  sensed: Sensed | null;
  /** when the next tick is due, ms (performance.now) */
  tickAt: number;
  ticks: number;
  dropProbe: (() => void) | null;
}

function nothing(): Danger {
  return { looks: [], sensed: null, tickAt: 0, ticks: 0, dropProbe: null };
}

let danger = nothing();

/** The distances of the look nearest LOOK_BACK_S before `now`: what „nearer" compares with. */
function lookBack(now: number): ReadonlyMap<string, number> {
  const due = now - LOOK_BACK_S * 1000;
  const old = danger.looks.filter((look) => look.at <= due).at(-1);
  return old?.distances ?? new Map();
}

/** One tick for the drone at `place`: the ping's recording, short and pitched up, placed. */
function tick(place: Place, rate: number): void {
  const engine = playingEngine();
  const ping = sample('ping');
  if (engine === null || ping === null || place.gain <= 0.01) {
    return;
  }
  const { ctx } = engine;
  const at = ctx.currentTime + LOOKAHEAD;
  try {
    capped(ctx, engine.effects, { voice: 1 }, (out) => {
      const level = gain(ctx, TICK_LEVEL * place.gain);
      const pan = ctx.createStereoPanner();
      pan.pan.value = place.pan;
      if (place.muffled) {
        chain(level, biquad(ctx, 'lowpass', MUFFLE_HZ, 0), pan, out);
      } else {
        chain(level, pan, out);
      }
      const source = startSample(ctx, ping, level, at, rate);
      source.stop(at + TICK_S);
      return [source];
    });
  } catch {
    // Deliberately silent: a missed tick is harmless, the edge still glows toward the drone.
  }
}

/** What the sense hears from: the map with its doors, where the player stands, the drones. */
export interface DangerScene {
  readonly map: SightMap & Pick<MapView, 'doors'>;
  readonly self: Spot;
  readonly drones: Readonly<Record<string, DronePosition>>;
}

/**
 * One look, at `now` (ms, performance.now): the drone closing in sensed, if any, and its tick
 * where one is due — the first at once. A tick the audio cannot play is skipped (`tick`).
 */
export function senseDanger(scene: DangerScene, now: number): void {
  probeOnce();
  const before = lookBack(now);
  const sensed = closingDrone(scene.self, scene.drones, before, danger.sensed?.id ?? null);
  const { self } = scene;
  const distances = new Map(
    Object.entries(scene.drones).map(([id, d]) => [id, Math.hypot(d.x - self.x, d.y - self.y)]),
  );
  const recent = danger.looks.filter((look) => look.at > now - 2000);
  danger.looks = [...recent, { at: now, distances }];
  const fresh = sensed !== null && danger.sensed?.id !== sensed.id;
  danger.sensed = sensed;
  if (sensed === null || (!fresh && now < danger.tickAt)) {
    return;
  }
  danger.tickAt = now + tickEvery(sensed.distance);
  danger.ticks += 1;
  tick(placeOf(scene.map, doorsShut(scene.map), scene.self, sensed), tickRate(sensed.distance));
}

/** The marker toward the drone sensed: an edge glow, as strong as it is near; none without. */
export function dangerMarker(): MarkerTarget | null {
  const sensed = danger.sensed;
  if (sensed === null) {
    return null;
  }
  const glow = glowOf(sensed.distance);
  return { x: sensed.x, y: sensed.y, color: css(ALARM), label: 'DROHNE', glow };
}

/** What the walkthrough reads of the sense: the drone sensed and how far, the ticks so far. */
export interface DangerProbe {
  drone: string | null;
  distance: number | null;
  ticks: number;
}

/** With `?trace=1`, the sense's probe goes on the page at its first look. */
function probeOnce(): void {
  if (danger.dropProbe !== null || typeof location === 'undefined') {
    return;
  }
  if (!traceRequested(location.search)) {
    danger.dropProbe = () => undefined;
    return;
  }
  danger.dropProbe = addProbes({
    get danger(): DangerProbe {
      const { sensed, ticks } = danger;
      return { drone: sensed?.id ?? null, distance: sensed?.distance ?? null, ticks };
    },
  });
}

/** The world is gone: nothing sensed any more, the probe off. */
export function stopDanger(): void {
  danger.dropProbe?.();
  danger = nothing();
}

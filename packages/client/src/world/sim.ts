import type { PlayerPosition } from '@escapelab/core';
import type { DoorMotion } from './doors.js';
import { lightMemory, type LightMemory } from './light.js';
import {
  correction,
  startingSpot,
  type KnownPositions,
  type Streamed,
} from './movement.js';
import type {
  Caption,
  LitRoom,
  MapPing,
  OtherAvatar,
  PoweredRoom,
  WorldMap,
} from './render/frame.js';

/**
 * What one mounted world simulates from animation frame to animation frame
 * (GameWorld.tsx): your avatar and the crew's, the doors' slides, the camera,
 * the lit rooms and what this run's light has shown. The movement here is
 * pure; the sounds it makes are the component's.
 */

const SPEED = 4.2; // tiles per second
const RADIUS = 0.28; // collision half-size

export const MOVE_KEYS: Record<string, [number, number]> = {
  arrowup: [0, -1],
  w: [0, -1],
  arrowdown: [0, 1],
  s: [0, 1],
  arrowleft: [-1, 0],
  a: [-1, 0],
  arrowright: [1, 0],
  d: [1, 0],
};

export interface Sim {
  /** the run `self` was placed for, by its `startedAt`; null before the first frame */
  run: number | null;
  self: { x: number; y: number; facing: number; moving: boolean };
  /** what this client streamed lately: its own steps coming back are no correction */
  streamed: Streamed[];
  others: Map<string, OtherAvatar>;
  keys: Set<string>;
  /** each door's slide, by door id (doors.ts) */
  doors: Map<string, DoorMotion>;
  walkPhase: number;
  stepAcc: number;
  cam: { x: number; y: number };
  /** how far the objective bar reaches down, CSS pixels, eased: the camera glides as it grows */
  topCss: number;
  /** `cam` clamped to the map bounds; everything on screen uses this one */
  draw: { x: number; y: number };
  /** device pixels per tile, as the last frame drew it */
  scale: number;
  time: number;
  /** pings already sounded, so the blip fires once per ping */
  seenPings: WeakSet<MapPing>;
  minimap: boolean;
  sabotageWasOn: boolean;
  /** last whole second announced by the countdown, so each tick fires once */
  lastBeepAt: number;
  /** the map as the last frame saw it, to tell what changed since; null before the first */
  seen: WorldMap | null;
  /** „… entdeckt" over sources the crew has just come across, `at` in sim time */
  captions: Caption[];
  /**
   * lit rooms by label: the tiles their lights reach, as a path in tiles,
   * and the sim time they came on
   */
  lit: Map<string, LitRoom>;
  /** rooms lit while something lay over the world: they come on once it is gone */
  pendingLit: string[];
  /** the room the power lights round you while the lab has it, with its tiles as a path */
  room: PoweredRoom | null;
  /** the tiles of every lit room, by key: drawn in the colours of the lab with its power on */
  litTiles: Set<string>;
  /** what this run's lamps and drones have lit so far, and their sights */
  light: LightMemory;
}

/** A world before its first frame, the objective bar reaching `topCss` down. */
export function newSim(topCss: number): Sim {
  return {
    run: null,
    self: { x: 0, y: 0, facing: 0, moving: false },
    streamed: [],
    others: new Map(),
    keys: new Set(),
    doors: new Map(),
    walkPhase: 0,
    stepAcc: 0,
    cam: { x: 0, y: 0 },
    topCss,
    draw: { x: 0, y: 0 },
    scale: 48,
    time: 0,
    seenPings: new WeakSet<MapPing>(),
    minimap: true,
    sabotageWasOn: false,
    lastBeepAt: Number.POSITIVE_INFINITY,
    seen: null,
    captions: [],
    lit: new Map(),
    pendingLit: [],
    room: null,
    litTiles: new Set(),
    light: lightMemory(null),
  };
}

/**
 * Your avatar by the server's word: every run starts it on its spawn — on
 * the first frame, and after a rematch with the world still up — and a
 * step the server refused puts it back where the server kept it.
 */
export function followServer(
  sim: Sim,
  known: KnownPositions,
  map: WorldMap,
  youId: string,
  run: number | null,
): void {
  if (sim.run !== run) {
    const start = startingSpot(known, youId, map, run);
    Object.assign(sim.self, start);
    sim.cam.x = start.x;
    sim.cam.y = start.y;
    sim.run = run;
    sim.streamed = [];
    sim.room = null;
    return;
  }
  const back = correction(known, youId, run, sim.self, sim.streamed, performance.now());
  if (back !== null) {
    Object.assign(sim.self, back);
  }
}

function blocked(map: WorldMap, closedDoors: Set<string>, x: number, y: number): boolean {
  for (const dx of [-RADIUS, RADIUS]) {
    for (const dy of [-RADIUS, RADIUS]) {
      const tx = Math.floor(x + dx);
      const ty = Math.floor(y + dy);
      if (map.tiles[ty]?.charAt(tx) !== '.' || closedDoors.has(`${tx},${ty}`)) {
        return true;
      }
    }
  }
  return false;
}

/** The way the keys held point, not yet of unit length; none while input is locked. */
function heading(keys: ReadonlySet<string>, locked: boolean): [number, number] {
  let dx = 0;
  let dy = 0;
  if (!locked) {
    for (const [key, [kx, ky]] of Object.entries(MOVE_KEYS)) {
      if (keys.has(key)) {
        dx += kx;
        dy += ky;
      }
    }
  }
  return [dx, dy];
}

/**
 * One frame's walk from the keys held (input → velocity): the facing, the
 * step as far as no wall or shut door stands in the way, and the gait.
 * Returns whether a footstep falls in it.
 */
export function walk(sim: Sim, map: WorldMap, dt: number, locked: boolean): boolean {
  let [dx, dy] = heading(sim.keys, locked);
  const len = Math.hypot(dx, dy);
  sim.self.moving = len > 0;
  if (!(len > 0)) {
    return false;
  }
  dx /= len;
  dy /= len;
  sim.self.facing = Math.atan2(dy, dx);
  const closedDoors = new Set(map.doors.filter((d) => !d.open).map((d) => `${d.x},${d.y}`));
  const nx = sim.self.x + dx * SPEED * dt;
  if (!blocked(map, closedDoors, nx, sim.self.y)) {
    sim.self.x = nx;
  }
  const ny = sim.self.y + dy * SPEED * dt;
  if (!blocked(map, closedDoors, sim.self.x, ny)) {
    sim.self.y = ny;
  }
  sim.walkPhase = (sim.walkPhase + dt * 2.4) % 1;
  sim.stepAcc += SPEED * dt;
  if (sim.stepAcc > 0.5) {
    sim.stepAcc = 0;
    return true;
  }
  return false;
}

/** Remote avatars ease toward their streamed positions (`live`); one gone from them goes. */
export function easeOthers(
  sim: Sim,
  live: Record<string, PlayerPosition>,
  youId: string,
  dt: number,
): void {
  const k = 1 - Math.exp(-dt * 12);
  for (const [id, pos] of Object.entries(live)) {
    if (id === youId) {
      continue;
    }
    const other = sim.others.get(id);
    if (other === undefined) {
      sim.others.set(id, { ...pos, rx: pos.x, ry: pos.y, phase: 0 });
    } else {
      other.x = pos.x;
      other.y = pos.y;
      other.facing = pos.facing;
      other.moving = pos.moving;
      other.rx += (pos.x - other.rx) * k;
      other.ry += (pos.y - other.ry) * k;
      if (pos.moving) {
        other.phase = (other.phase + dt * 2.4) % 1;
      }
    }
  }
  for (const id of sim.others.keys()) {
    if (live[id] === undefined) {
      sim.others.delete(id);
    }
  }
}

/**
 * The camera following your avatar, and the objective bar's reach (`topCss`)
 * as gently: a radio line growing the bar moves it no faster.
 */
export function follow(sim: Sim, dt: number, topCss: number): void {
  const ck = 1 - Math.exp(-dt * 6);
  sim.cam.x += (sim.self.x - sim.cam.x) * ck;
  sim.cam.y += (sim.self.y - sim.cam.y) * ck;
  sim.topCss += (topCss - sim.topCss) * ck;
}

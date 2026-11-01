import { SPRINT_FACTOR, WALK_SPEED, walkable, type RelayedPosition } from '@escapelab/core';
import { MOVE_ACTIONS, MOVES, type Held } from '../input/bindings.js';
import { NO_STEER, type Steer } from '../input/pad.js';
import type { DoorMotion } from './doors.js';
import { gaitStep } from './figure.js';
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
import { drawnAt, hear, newTrail, type Trail } from './trail.js';

/**
 * What one mounted world simulates from animation frame to animation frame
 * (GameWorld.tsx): your avatar and the crew's, the doors' slides, the camera,
 * the lit rooms and what this run's light has shown. The movement here is
 * pure; the sounds it makes are the component's. The avatar walks at core's
 * WALK_SPEED and sprints SPRINT_FACTOR times as fast, as the server's step
 * guard expects (core/src/map.ts).
 */

const RADIUS = 0.28; // collision half-size
/**
 * How far apart two footfalls land, in tiles: a sprint, covering more ground in the same time,
 * lands them faster.
 */
const STRIDE = 0.5;

/** How far the camera looks ahead of a walking avatar, in tiles. */
export const LEAD_TILES = 0.6;
/** How quickly the camera's lead comes and goes, s: about 95 % of the way in 300 ms. */
export const LEAD_TAU = 0.1;

/** A footfall in a frame's walk: at a walk, or at a sprint — quicker, and a little louder. */
export type Footfall = 'walk' | 'sprint';

export interface Sim {
  /** the run `self` was placed for, by its `startedAt`; null before the first frame */
  run: number | null;
  self: { x: number; y: number; facing: number; moving: boolean };
  /** when `self` was true: the frame it was walked in, on the page's timeline (performance.now) */
  selfAt: number;
  /** what this client streamed lately: its own steps coming back are no correction */
  streamed: Streamed[];
  /**
   * the run's opening holds this screen's avatar (intro/sequence.ts `filmed`): it walks
   * nowhere, and no position goes out
   */
  held: boolean;
  others: Map<string, OtherAvatar>;
  /** each partner's samples as the server relayed them, by player id (trail.ts) */
  trails: Map<string, Trail>;
  /**
   * what is held down to walk and sprint, by action — the keys as the settings bind them, the
   * touch screen's pad (input/bindings.ts `Held`)
   */
  keys: Set<Held>;
  /** how a controller steers this frame (input/padRuntime.ts `padSteer`); still without one */
  pad: Steer;
  /** each door's slide, by door id (doors.ts) */
  doors: Map<string, DoorMotion>;
  walkPhase: number;
  stepAcc: number;
  /** footfalls your avatar has made so far: the walkthrough reads their pace off the probe */
  footfalls: number;
  /** how far the camera looks ahead of your avatar, in tiles: eased in and out (`leadOn`) */
  lead: { x: number; y: number };
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
    selfAt: 0,
    streamed: [],
    held: false,
    others: new Map(),
    trails: new Map(),
    keys: new Set(),
    pad: NO_STEER,
    doors: new Map(),
    walkPhase: 0,
    stepAcc: 0,
    footfalls: 0,
    lead: { x: 0, y: 0 },
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
    sim.lead = { x: 0, y: 0 };
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

/** Whether an avatar at (x, y) would stand in a wall, a shut door or a piece of furniture. */
function blocked(map: WorldMap, closedDoors: Set<string>, x: number, y: number): boolean {
  for (const dx of [-RADIUS, RADIUS]) {
    for (const dy of [-RADIUS, RADIUS]) {
      const tx = Math.floor(x + dx);
      const ty = Math.floor(y + dy);
      if (!walkable(map, tx, ty) || closedDoors.has(`${tx},${ty}`)) {
        return true;
      }
    }
  }
  return false;
}

/** Where the avatar is steered: a way of unit length, and how much of a full walk. */
interface Heading {
  dx: number;
  dy: number;
  /** 1 by the keys, the stick's lean past its dead zone by a controller; 0 standing */
  lean: number;
}

const STANDING: Heading = { dx: 0, dy: 0, lean: 0 };

/**
 * Where the moves held point (`sim.keys`), at a full walk — or, with none held, where the
 * controller steers (`sim.pad`), as far as its stick leans; standing while input is locked.
 */
function heading(sim: Sim, locked: boolean): Heading {
  if (locked) {
    return STANDING;
  }
  let dx = 0;
  let dy = 0;
  for (const move of MOVE_ACTIONS) {
    if (sim.keys.has(move)) {
      dx += MOVES[move][0];
      dy += MOVES[move][1];
    }
  }
  const keyed = Math.hypot(dx, dy);
  if (keyed > 0) {
    return { dx: dx / keyed, dy: dy / keyed, lean: 1 };
  }
  const { x, y } = sim.pad;
  const lean = Math.hypot(x, y);
  return lean > 0 ? { dx: x / lean, dy: y / lean, lean: Math.min(1, lean) } : STANDING;
}

/**
 * One frame's walk from the keys held or the controller's stick (input → velocity): the
 * facing, the step as far as no wall, shut door or furniture stands in the way, and the gait —
 * SPRINT_FACTOR times as fast with sprint held, no stamina; a stick leant part of the way walks
 * that part as fast. The avatar walks (`self.moving`) only where it covers ground: pushing
 * into a wall it stands, as its partners then see it (trail.ts). Returns the footfall that
 * lands in it, if one does.
 */
export function walk(sim: Sim, map: WorldMap, dt: number, locked: boolean): Footfall | null {
  const { dx, dy, lean } = heading(sim, locked);
  sim.self.moving = false;
  if (!(lean > 0)) {
    return null;
  }
  const from = { x: sim.self.x, y: sim.self.y };
  sim.self.facing = Math.atan2(dy, dx);
  const sprinting = sim.keys.has('sprint') || sim.pad.sprint;
  const pace = sprinting ? SPRINT_FACTOR : 1;
  const speed = WALK_SPEED * pace * lean;
  const closedDoors = new Set(map.doors.filter((d) => !d.open).map((d) => `${d.x},${d.y}`));
  const nx = sim.self.x + dx * speed * dt;
  if (!blocked(map, closedDoors, nx, sim.self.y)) {
    sim.self.x = nx;
  }
  const ny = sim.self.y + dy * speed * dt;
  if (!blocked(map, closedDoors, sim.self.x, ny)) {
    sim.self.y = ny;
  }
  sim.self.moving = sim.self.x !== from.x || sim.self.y !== from.y;
  sim.walkPhase = gaitStep(sim.walkPhase, speed * dt);
  sim.stepAcc += speed * dt;
  if (sim.stepAcc > STRIDE) {
    sim.stepAcc = 0;
    sim.footfalls += 1;
    return sprinting ? 'sprint' : 'walk';
  }
  return null;
}

/**
 * The crew as this screen draws them at `at` (server time, epoch ms: REMOTE_DELAY_MS before
 * now, trail.ts): each relayed position (`live`) is a sample of their walk, and each figure is
 * drawn where its samples put it then — the newest position kept beside it. One gone from the
 * positions goes.
 */
export function followOthers(
  sim: Sim,
  live: Record<string, RelayedPosition>,
  youId: string,
  at: number,
): void {
  for (const [id, pos] of Object.entries(live)) {
    if (id === youId) {
      continue;
    }
    const trail = sim.trails.get(id) ?? newTrail();
    sim.trails.set(id, trail);
    hear(trail, pos);
    const drawn = drawnAt(trail, at) ?? pos;
    const other = sim.others.get(id);
    if (other === undefined) {
      const { facing, moving } = drawn;
      sim.others.set(id, { x: pos.x, y: pos.y, facing, moving, rx: drawn.x, ry: drawn.y, phase: 0 });
      continue;
    }
    const step = Math.hypot(drawn.x - other.rx, drawn.y - other.ry);
    Object.assign(other, { x: pos.x, y: pos.y, facing: drawn.facing, moving: drawn.moving });
    other.rx = drawn.x;
    other.ry = drawn.y;
    // The legs keep pace with the ground the figure covers on this screen (figure.ts).
    if (drawn.moving) {
      other.phase = gaitStep(other.phase, step);
    }
  }
  for (const id of sim.others.keys()) {
    if (live[id] === undefined) {
      sim.others.delete(id);
      sim.trails.delete(id);
    }
  }
}

/**
 * The camera's lead: up to LEAD_TILES the way your avatar walks while it
 * walks, eased in and out over about 300 ms (LEAD_TAU), back to nothing as it
 * stands — and nothing at all where the player asked for less motion.
 */
export function leadOn(sim: Sim, dt: number, reduced: boolean): void {
  const reach = sim.self.moving && !reduced ? LEAD_TILES : 0;
  const k = 1 - Math.exp(-dt / LEAD_TAU);
  sim.lead.x += (Math.cos(sim.self.facing) * reach - sim.lead.x) * k;
  sim.lead.y += (Math.sin(sim.self.facing) * reach - sim.lead.y) * k;
}

/**
 * The camera following your avatar, a little ahead of it as it walks
 * (`leadOn`), and the objective bar's reach (`topCss`) as gently: a radio
 * line growing the bar moves it no faster. The frame clamps where it looks
 * (assemble.ts), lead and all.
 */
export function follow(sim: Sim, dt: number, topCss: number, reduced = false): void {
  leadOn(sim, dt, reduced);
  const ck = 1 - Math.exp(-dt * 6);
  sim.cam.x += (sim.self.x + sim.lead.x - sim.cam.x) * ck;
  sim.cam.y += (sim.self.y + sim.lead.y - sim.cam.y) * ck;
  sim.topCss += (topCss - sim.topCss) * ck;
}

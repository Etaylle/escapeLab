import {
  audioEngine,
  capped,
  claim,
  fadeTo,
  levelAt,
  LOOKAHEAD,
  outlet,
  pick,
  playLoop,
  rand,
  release,
  startSample,
  still,
  type Engine,
  type Fade,
} from './audio.js';
import type { Dressing } from './dress.js';
import { warmUp, WARM_UP_MS } from './rooms.js';
import { sample, type Sample, type SfxId } from './samples.js';
import type { FloorKind } from './surfaces.js';

/**
 * Rooms you can hear. Every room plays a bed after its kind (its label's, as the art bible
 * dresses it; a label without one is a plain lab room), in two layers: what runs on the lab's
 * power — fans, hums, whines — and what lives without it — the rumble of a machine room or a
 * reactor. Each layer is a recorded seamless loop (samples.ts: ElevenLabs made them) played
 * round and round at its room's own level, so a bed costs the audio thread a source or two.
 * The room the player stands in plays both its layers at full and its sporadic sounds —
 * drips, creaks, strokes, a clank down the corridor, the core's beat, a console's tick, each a
 * recording; the two nearest rooms behind an open door or an opening play their main layer
 * 12 dB under it; the rest nothing, stopped. A change crossfades over 1.2 s. While the lab has
 * its power every powered layer runs, under the power hum (audio.ts); when the lights fail
 * they spin down with it, slowing as they fade, and a room whose lights come back warms its
 * layer up as they do (rooms.ts `warmUp`). The audience, standing nowhere, hears no beds.
 * Everything here keeps within the budget of audio.ts (`CAPS`), and it moves only when
 * `hearRooms` is called, ten times a second, never per frame. Pure up to `startAmbience`.
 */

/** What a bed is made for: a room's kind, or a plain lab room. */
export type BedKind = FloorKind;

/** A change of room crossfades the beds over this long, s. */
export const ROOM_FADE_S = 1.2;
/** A room behind an open door or an opening plays this far under the player's own: −12 dB. */
export const NEIGHBOUR_LEVEL = 10 ** (-12 / 20);
/** How many rooms behind open ways are heard: the nearest. */
export const MAX_NEIGHBOURS = 2;
/**
 * A bed at full, at the master gain: under the effects (audio.ts EFFECTS_LEVEL). Every bed's
 * recording comes in at −20 dBFS RMS (scripts/sfx.ts); each layer's own level sets the rooms
 * apart.
 */
export const BED_LEVEL = 0.03;
/** The powered layers spin down over this long once the lights fail, s. */
export const POWER_DIE_S = 1.4;
/** How far a dying layer slows — its hums fall in pitch as the power hum's do (audio.ts). */
const HUM_FALL = 0.25;

/**
 * A way between two rooms: through the door `door`, or an opening (null), always open; at
 * (x, y), tiles, where it is.
 */
export interface RoomLink {
  readonly a: string;
  readonly b: string;
  readonly door: string | null;
  readonly x: number;
  readonly y: number;
}

/** The rooms of a map as the beds hear them: by tile, their kinds and the ways between them. */
export interface RoomPlan {
  readonly width: number;
  /** each tile's room by its label, row by row; null for walls, doors and unclaimed floor */
  readonly rooms: readonly (string | null)[];
  readonly kinds: ReadonlyMap<string, BedKind>;
  readonly links: readonly RoomLink[];
}

/** A door of the map, as the view gives it. */
export interface DoorSpot {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * The rooms of a dressed map (dress.ts: the floor shared out to its labels) and the ways
 * between them: every door with a room on two of its sides, and every opening where the floor
 * of one room meets another's with no door between — at the first place they meet.
 */
export function roomPlan(
  dressing: Pick<Dressing, 'width' | 'rooms' | 'kinds'>,
  doors: readonly DoorSpot[],
): RoomPlan {
  const { width, rooms } = dressing;
  const roomOf = (x: number, y: number): string | null =>
    x < 0 || x >= width ? null : (rooms[y * width + x] ?? null);
  const kinds = new Map<string, BedKind>();
  const links = new Map<string, RoomLink>();
  const link = (a: string, b: string, door: string | null, x: number, y: number): void => {
    const [first, second] = a < b ? [a, b] : [b, a];
    const key = `${first}\n${second}\n${door ?? ''}`;
    if (!links.has(key)) links.set(key, { a: first, b: second, door, x, y });
  };
  rooms.forEach((room, i) => {
    if (room === null) return;
    if (!kinds.has(room)) kinds.set(room, dressing.kinds[i] ?? 'plain');
    const x = i % width;
    const y = Math.floor(i / width);
    const east = roomOf(x + 1, y);
    const south = roomOf(x, y + 1);
    if (east !== null && east !== room) link(room, east, null, x + 1, y + 0.5);
    if (south !== null && south !== room) link(room, south, null, x + 0.5, y + 1);
  });
  for (const door of doors) {
    const beside = [...new Set(SIDES.map(([dx, dy]) => roomOf(door.x + dx, door.y + dy)))];
    const named = beside.filter((room): room is string => room !== null);
    named.forEach((a, i) =>
      named.slice(i + 1).forEach((b) => link(a, b, door.id, door.x + 0.5, door.y + 0.5)),
    );
  }
  return { width, rooms, kinds, links: [...links.values()] };
}

/**
 * The room of the tile (x, y): its label's; on a door, a wall or floor no label claims, the
 * room the player was in before (`previous`), so that a doorway never flips the beds.
 */
export function roomAt(
  plan: RoomPlan,
  x: number,
  y: number,
  previous: string | null,
): string | null {
  if (x < 0 || x >= plan.width) return previous;
  return plan.rooms[y * plan.width + x] ?? previous;
}

/**
 * How loud each room's bed plays for a player at `at` in `room`, by room: their own at full,
 * the MAX_NEIGHBOURS nearest rooms an opening or a door in `open` joins to it — by how far the
 * player stands from the way — at NEIGHBOUR_LEVEL, the rest not at all (left out). Nothing
 * where the player is in no room, as the audience is.
 */
export function bedLevels(
  plan: RoomPlan,
  room: string | null,
  open: ReadonlySet<string>,
  at: { readonly x: number; readonly y: number },
): Map<string, number> {
  if (room === null) return new Map();
  const nearest = new Map<string, number>();
  for (const { a, b, door, x, y } of plan.links) {
    const other = a === room ? b : b === room ? a : null;
    if (other !== null && (door === null || open.has(door))) {
      const away = Math.hypot(x - at.x, y - at.y);
      nearest.set(other, Math.min(away, nearest.get(other) ?? Infinity));
    }
  }
  const heard = [...nearest].sort(([, p], [, q]) => p - q).slice(0, MAX_NEIGHBOURS);
  return new Map([[room, 1], ...heard.map(([name]): [string, number] => [name, NEIGHBOUR_LEVEL])]);
}

/** Whether the lab has its power, as the beds follow it. */
export interface Power {
  /** when the lights fail, or failed: the cold open's bang, epoch ms; null while they burn */
  readonly outAt: number | null;
  /** the rooms whose lights the crew has brought back: since when, in sim time */
  readonly lit: ReadonlyMap<string, { readonly since: number }>;
  /** a run won: the whole lab lit again */
  readonly won: boolean;
}

/**
 * Whether the powered layer of `room` runs, at the sim time `time`: alive while the lab has its
 * power, once a run is won, and once the room's lights are back — `warm` seconds into their
 * warm-up then (≥ WARM_UP_MS/1000: up in full); dead otherwise, from `outAt`.
 */
export function bedPower(
  room: string,
  power: Power,
  time: number,
): { alive: true; warm: number } | { alive: false; from: number } {
  const since = power.lit.get(room)?.since;
  if (since !== undefined) {
    return { alive: true, warm: Math.max(0, time - since) };
  }
  if (power.won || power.outAt === null) {
    return { alive: true, warm: Infinity };
  }
  return { alive: false, from: power.outAt };
}

// --- the beds' layers: recorded loops ------------------------------------------------------

/** A bed's layer: its recorded loop, and how far it plays from BED_LEVEL, dB. */
export interface BedLayer {
  readonly sample: SfxId;
  readonly db: number;
}

/**
 * What each kind of room runs on the lab's power, as a seamless loop: fans and hums, at a level
 * of its own, so that a server room roars and an archive hushes.
 */
export const POWERED: Readonly<Partial<Record<BedKind, BedLayer>>> = {
  server: { sample: 'bed-server', db: 3 },
  archive: { sample: 'bed-archive', db: -8 },
  corridor: { sample: 'bed-corridor', db: -2 },
  lab: { sample: 'bed-lab', db: -3 },
  reactor: { sample: 'bed-reactor', db: 0 },
  control: { sample: 'bed-control', db: -3 },
  plain: { sample: 'bed-plain', db: -3 },
};

/** What each kind of room keeps without it, as a seamless loop: the rumble of what stands still. */
export const IDLE: Readonly<Partial<Record<BedKind, BedLayer>>> = {
  machine: { sample: 'bed-machine-idle', db: 0 },
  reactor: { sample: 'bed-reactor-idle', db: 0 },
};

/** A bed's loops: its powered layer, its unpowered one. */
type Layer = 'power' | 'idle';

/**
 * Which loops a bed plays: the player's own room each layer it has — the powered one while
 * alive; a room behind a door its main layer only, the powered one while alive, else the
 * unpowered one.
 */
export function loopsOf(kind: BedKind, alive: boolean, neighbour: boolean): Record<Layer, boolean> {
  const power = alive && POWERED[kind] !== undefined;
  const idle = IDLE[kind] !== undefined && !(neighbour && power);
  return { power, idle };
}

// --- the own room's sporadic sounds -----------------------------------------------------

/**
 * The core's beat as its light pulses (sources.ts CORE_PULSE, gl/pack.ts `pulseAt`): a
 * period of 2.4 s on the simulation's clock, at the top of it 0.6 s in.
 */
export const CORE_PERIOD_S = 2.4;
const CORE_PEAK_S = 0.6;
/** The throb's recording swells this long to its peak. */
const CORE_LEAD_S = 0.35;

/** The first top of the core's beat after the sim time `time`. */
export function nextCorePeak(time: number): number {
  return CORE_PEAK_S + CORE_PERIOD_S * Math.ceil((time - CORE_PEAK_S) / CORE_PERIOD_S + 1e-9);
}

/**
 * A sporadic sound of the own room's bed: on its powered layer or its unpowered one, every
 * [min, max] seconds or on the core's beat; one of its recordings at random, at its level
 * against the bed's full — a recording's peak stands at −3 dBFS — and up to `vary` faster or
 * slower each time, so that no two sound alike. Each takes a voice of the budget.
 */
interface Occasion {
  readonly layer: Layer;
  readonly every: readonly [number, number] | 'core';
  readonly samples: readonly [SfxId, ...SfxId[]];
  readonly level: number;
  readonly vary: number;
}

const CREAK: Occasion = {
  layer: 'idle',
  every: [20, 40],
  samples: ['creak'],
  level: 0.35,
  vary: 0.12,
};

/** The sporadic sounds of each kind of room. */
export const OCCASIONS: Readonly<Record<BedKind, readonly Occasion[]>> = {
  server: [{ ...CREAK, every: [15, 35] }],
  machine: [
    { layer: 'power', every: [1.6, 1.6], samples: ['machine-stroke'], level: 1, vary: 0.02 },
    { layer: 'power', every: [8, 20], samples: ['steam-hiss'], level: 0.4, vary: 0.08 },
  ],
  archive: [{ layer: 'idle', every: [7, 12], samples: ['drip'], level: 0.7, vary: 0.15 }],
  corridor: [{ layer: 'idle', every: [20, 40], samples: ['far-clank'], level: 0.4, vary: 0.1 }],
  lab: [
    { layer: 'power', every: [10, 25], samples: ['bubbling'], level: 0.35, vary: 0.1 },
    CREAK,
  ],
  reactor: [{ layer: 'idle', every: 'core', samples: ['core-throb'], level: 0.8, vary: 0 }],
  control: [
    { layer: 'power', every: [1, 1], samples: ['console-tick'], level: 0.15, vary: 0.03 },
    CREAK,
  ],
  // Far off in a plain lab: mostly a clank, a creak about every third time.
  plain: [
    {
      layer: 'idle',
      every: [7, 15],
      samples: ['creak', 'far-clank', 'far-clank'],
      level: 0.4,
      vary: 0.12,
    },
  ],
};

// --- the runtime -------------------------------------------------------------------------

/** One room's bed, built while it is heard. */
interface Bed {
  readonly room: string;
  readonly kind: BedKind;
  /** the room's level, BED_LEVEL at full */
  readonly out: GainNode;
  /** each layer's stage: the powered one 0 (dead) to 1, the unpowered one 1 */
  readonly stages: Record<Layer, GainNode>;
  level: Fade;
  powerFade: Fade;
  alive: boolean;
  /** heard behind a door: its main layer only, none of its sporadic sounds */
  neighbour: boolean;
  /** the loops playing, by layer: each takes a loop of the budget while it plays */
  readonly playing: Record<Layer, AudioBufferSourceNode | null>;
  /** the audio time each of its occasions comes next */
  readonly next: number[];
  /** the last top of the core's beat it throbbed to, sim time */
  corePeak: number;
}

/** What one update heard last, to tell whether anything changed since. */
interface Heard {
  map: object;
  tile: string | null;
  lit: number;
  outAt: number | null;
  won: boolean;
}

interface Ambience {
  readonly engine: Engine;
  /** the simulation's clock, s: the core beats on it */
  readonly clock: () => number;
  readonly beds: Map<string, Bed>;
  readonly plans: WeakMap<object, RoomPlan>;
  room: string | null;
  heard: Heard | null;
}

/** How far ahead the own room's sporadic sounds are scheduled, s: past the next update. */
const AHEAD_S = 0.4;

let ambience: Ambience | null = null;

/** Idempotent. The beds' runtime for a world: silent until `hearRooms` says where you are. */
export function startAmbience(clock: () => number): void {
  try {
    if (ambience !== null) return;
    const engine = audioEngine();
    if (engine === null) return;
    const beds = new Map<string, Bed>();
    const plans = new WeakMap<object, RoomPlan>();
    ambience = { engine, clock, beds, plans, room: null, heard: null };
  } catch {
    // Deliberately silent: a quiet lab is better than a broken game.
  }
}

/** Fades every bed out over ~0.5 s and stops it. Safe when none plays. */
export function stopAmbience(): void {
  try {
    const amb = ambience;
    ambience = null;
    if (amb === null) return;
    const now = amb.engine.ctx.currentTime;
    for (const bed of amb.beds.values()) {
      bed.level = fadeTo(bed.out.gain, bed.level, now, [now, now + 0.5], 0);
      letGo(bed, now + 0.55);
    }
  } catch {
    // Deliberately silent: the beds' nodes are released with the context at the latest.
  }
}

/** Where the beds are heard from: the player's room, the doors, the power. */
export interface RoomScene {
  /** the view's map: its doors, and a new object for every view */
  readonly map: { readonly doors: readonly (DoorSpot & { readonly open: boolean })[] };
  /** its dressing (dress.ts), which shares the floor out to the rooms */
  readonly dressing: Pick<Dressing, 'width' | 'rooms' | 'kinds'>;
  /** where the player stands, tiles */
  readonly at: { readonly x: number; readonly y: number };
  readonly power: Power;
  /** the simulation's clock now, s */
  readonly time: number;
}

/**
 * The beds follow the player, the doors and the power: called ten times a second. Where the
 * tile, the view, the rooms lit or the power changed, each bed heard crossfades to its level,
 * beds come and go and powered layers die or warm up; every call the loops due start, those
 * done stop, and the own room's sporadic sounds are scheduled on the audio clock.
 */
export function hearRooms(scene: RoomScene): void {
  try {
    const amb = ambience;
    if (amb === null) return;
    const heard = heardOf(scene);
    const now = amb.engine.ctx.currentTime;
    if (amb.heard === null || !sameHeard(amb.heard, heard)) {
      amb.heard = heard;
      follow(amb, scene, now);
    }
    tend(amb, now);
  } catch {
    // Deliberately silent: the room still looks like itself.
  }
}

/** The beds take in a changed scene: their levels, who is a neighbour, their power. */
function follow(amb: Ambience, scene: RoomScene, now: number): void {
  const plan = planOf(amb, scene);
  const { at } = scene;
  const room = roomAt(plan, Math.floor(at.x), Math.floor(at.y), amb.room);
  amb.room = room;
  const open = new Set(scene.map.doors.filter((door) => door.open).map((door) => door.id));
  const levels = bedLevels(plan, room, open, at);
  for (const [name, level] of levels) {
    const bed = amb.beds.get(name) ?? addBed(amb, name, plan.kinds.get(name) ?? 'plain', now);
    bed.neighbour = name !== room;
    setLevel(bed, level, now);
  }
  for (const bed of amb.beds.values()) {
    if (!levels.has(bed.room)) setLevel(bed, 0, now);
    setPower(bed, bedPower(bed.room, scene.power, scene.time), now);
  }
}

function heardOf(scene: RoomScene): Heard {
  const tile = `${Math.floor(scene.at.x)},${Math.floor(scene.at.y)}`;
  const { lit, outAt, won } = scene.power;
  return { map: scene.map, tile, lit: lit.size, outAt, won };
}

function sameHeard(a: Heard, b: Heard): boolean {
  const same = a.map === b.map && a.tile === b.tile && a.lit === b.lit;
  return same && a.outAt === b.outAt && a.won === b.won;
}

/** The plan of the scene's dressing, worked out once for it. */
function planOf(amb: Ambience, scene: RoomScene): RoomPlan {
  const known = amb.plans.get(scene.dressing);
  if (known !== undefined) return known;
  const plan = roomPlan(scene.dressing, scene.map.doors);
  amb.plans.set(scene.dressing, plan);
  return plan;
}

/**
 * The loop of `kind`'s `layer` and the level it plays at against the bed, linear; null where
 * the kind has no such layer, or its recording is not loaded (yet).
 */
function bedLoop(kind: BedKind, layer: Layer): { loop: Sample; level: number } | null {
  const made = (layer === 'power' ? POWERED : IDLE)[kind];
  const loop = made === undefined ? null : sample(made.sample);
  return made === undefined || loop === null ? null : { loop, level: 10 ** (made.db / 20) };
}

/** A new bed for `room`, silent, its loops to start as they are due: into the beds' bus. */
function addBed(amb: Ambience, room: string, kind: BedKind, now: number): Bed {
  const { ctx, beds } = amb.engine;
  const out = outlet(ctx, beds, 0);
  const stages = { power: outlet(ctx, out, 0), idle: outlet(ctx, out, 1) };
  const next = OCCASIONS[kind].map((occasion) => firstAt(occasion, now));
  const bed: Bed = {
    room,
    kind,
    out,
    stages,
    level: still(0),
    powerFade: still(0),
    alive: false,
    neighbour: false,
    playing: { power: null, idle: null },
    next,
    corePeak: -Infinity,
  };
  amb.beds.set(room, bed);
  return bed;
}

/** When an occasion first comes: somewhere in its first interval, so beds never sound in step. */
function firstAt(occasion: Occasion, now: number): number {
  return occasion.every === 'core' ? now : now + rand(0, occasion.every[1]);
}

/** The bed crossfades to `level` (0, NEIGHBOUR_LEVEL, 1) over ROOM_FADE_S, unless headed there. */
function setLevel(bed: Bed, level: number, now: number): void {
  if (bed.level.to === level * BED_LEVEL) return;
  bed.level = fadeTo(bed.out.gain, bed.level, now, [now, now + ROOM_FADE_S], level * BED_LEVEL);
}

/** The bed's powered layer as `state` says: warmed up, or spun down from its moment. */
function setPower(bed: Bed, state: ReturnType<typeof bedPower>, now: number): void {
  if (state.alive && !bed.alive) {
    bed.alive = true;
    warmUpLayer(bed, state.warm, now);
  } else if (!state.alive && bed.alive) {
    bed.alive = false;
    dieDown(bed, Math.max(now, now + (state.from - Date.now()) / 1000));
  }
}

/** Samples of the lights' warm-up (rooms.ts), for the powered layer to come up along. */
const WARM_STEPS = 26;

/** The powered layer comes up with the room's lights: along their warm-up, `warm` s into it. */
function warmUpLayer(bed: Bed, warm: number, now: number): void {
  const param = bed.stages.power.gain;
  const left = WARM_UP_MS / 1000 - warm;
  param.cancelScheduledValues(now);
  if (!(left > 0.05)) {
    param.setValueAtTime(1, now);
    bed.powerFade = still(1);
    return;
  }
  const curve = new Float32Array(WARM_STEPS);
  for (let i = 0; i < WARM_STEPS; i++) {
    curve[i] = warmUp((warm + (left * i) / (WARM_STEPS - 1)) * 1000);
  }
  param.setValueCurveAtTime(curve, now, left);
  bed.powerFade = { from: curve[0] ?? 0, to: 1, start: now, end: now + left };
}

/** The powered layer spins down from `at`: it fades and slows — its hums fall — then stops. */
function dieDown(bed: Bed, at: number): void {
  const end = at + POWER_DIE_S;
  bed.powerFade = fadeTo(bed.stages.power.gain, bed.powerFade, at, [at, end], 0);
  const loop = bed.playing.power;
  bed.playing.power = null;
  if (loop !== null) {
    loop.playbackRate.setValueAtTime(1, at);
    loop.playbackRate.exponentialRampToValueAtTime(HUM_FALL, end);
    loop.stop(end + 0.05);
  }
}

/** Every round: beds faded out go, the loops due start or stop, the own room's sounds come. */
function tend(amb: Ambience, now: number): void {
  for (const bed of [...amb.beds.values()]) {
    if (bed.level.to === 0 && now > bed.level.end + 0.1) {
      amb.beds.delete(bed.room);
      letGo(bed, now);
      continue;
    }
    syncLoops(amb, bed, now);
    if (bed.room === amb.room && amb.engine.ctx.state === 'running') {
      scheduleOccasions(amb, bed, now);
    }
  }
}

/**
 * The bed's loops as `loopsOf` has them: one due starts once its recording is loaded and the
 * budget has a loop left — else it is tried again next round — through a stage at its layer's
 * level, and one no longer due stops.
 */
function syncLoops(amb: Ambience, bed: Bed, now: number): void {
  const due = loopsOf(bed.kind, bed.alive, bed.neighbour);
  for (const layer of ['power', 'idle'] as const) {
    const playing = bed.playing[layer];
    if (!due[layer] && playing !== null) {
      bed.playing[layer] = null;
      playing.stop(now + 0.05);
    } else if (due[layer] && playing === null) {
      const made = bedLoop(bed.kind, layer);
      if (made !== null && claim({ loop: 1 })) {
        const { ctx } = amb.engine;
        const level = outlet(ctx, bed.stages[layer], made.level);
        const source = playLoop(ctx, made.loop.buffer, level, now + LOOKAHEAD);
        source.onended = () => {
          level.disconnect();
          release({ loop: 1 });
        };
        bed.playing[layer] = source;
      }
    }
  }
}

/**
 * Stops every loop of the bed at `at` — each gives its loop back to the budget as it ends
 * (syncLoops) — and lets the bed's nodes go once they all have.
 */
function letGo(bed: Bed, at: number): void {
  const loops = [bed.playing.power, bed.playing.idle].filter(
    (loop): loop is AudioBufferSourceNode => loop !== null,
  );
  bed.playing.power = null;
  bed.playing.idle = null;
  let left = loops.length;
  const ended = (): void => {
    left -= 1;
    if (left <= 0) bed.out.disconnect();
  };
  if (left === 0) ended();
  for (const loop of loops) {
    loop.addEventListener('ended', ended, { once: true });
    loop.stop(at);
  }
}

/** The own room's sounds due before now + AHEAD_S, each on its layer while that layer is up. */
function scheduleOccasions(amb: Ambience, bed: Bed, now: number): void {
  OCCASIONS[bed.kind].forEach((occasion, i) => {
    if (occasion.every === 'core') {
      throbOnTheBeat(amb, bed, occasion, now);
      return;
    }
    const due = bed.next[i] ?? now;
    if (due > now + AHEAD_S) return;
    const at = Math.max(due, now + LOOKAHEAD);
    if (occasion.layer === 'idle' || bed.alive) {
      playOccasion(amb, bed, occasion, at);
    }
    bed.next[i] = at + rand(occasion.every[0], occasion.every[1]);
  });
}

/**
 * One of the occasion's recordings into its layer from `at`, at its level and a little faster
 * or slower: a voice of the budget, let go as it ends. Nothing where the budget is full or the
 * recording is not loaded.
 */
function playOccasion(amb: Ambience, bed: Bed, occasion: Occasion, at: number): void {
  const recording = sample(pick(occasion.samples));
  if (recording === null) return;
  const { ctx } = amb.engine;
  const rate = rand(1 - occasion.vary, 1 + occasion.vary);
  const stage = bed.stages[occasion.layer];
  const play = (out: GainNode): AudioScheduledSourceNode[] => [
    startSample(ctx, recording, out, at, rate),
  ];
  capped(ctx, stage, { voice: 1 }, play, occasion.level);
}

/** The core's throb, once a beat, swelling so that it peaks with the core's light. */
function throbOnTheBeat(amb: Ambience, bed: Bed, occasion: Occasion, now: number): void {
  const time = amb.clock();
  const peak = nextCorePeak(time);
  const at = now + (peak - time) - CORE_LEAD_S;
  if (peak <= bed.corePeak || at > now + AHEAD_S) return;
  bed.corePeak = peak;
  playOccasion(amb, bed, occasion, Math.max(at, now + LOOKAHEAD));
}

/** How many beds are built now. */
export function bedCount(): number {
  return ambience?.beds.size ?? 0;
}

/** What the beds play now: the room, each kind heard and how far its powered layer is up. */
export interface BedProbe {
  /** the player's room by its label; null before the first update and for the audience */
  room: string | null;
  kind: BedKind | null;
  /** each kind heard, by its level: 1 for the own room, NEIGHBOUR_LEVEL behind a door */
  beds: Record<string, number>;
  /** each kind heard, by how far its powered layer is up: 0 dead, 1 alive */
  power: Record<string, number>;
}

/** The beds as they stand on the audio clock now. */
export function bedProbe(): BedProbe {
  const amb = ambience;
  const probe: BedProbe = { room: null, kind: null, beds: {}, power: {} };
  if (amb === null) return probe;
  const now = amb.engine.ctx.currentTime;
  for (const bed of amb.beds.values()) {
    const level = levelAt(bed.level, now) / BED_LEVEL;
    probe.beds[bed.kind] = Math.max(probe.beds[bed.kind] ?? 0, level);
    probe.power[bed.kind] = Math.max(probe.power[bed.kind] ?? 0, levelAt(bed.powerFade, now));
  }
  probe.room = amb.room;
  probe.kind = amb.room === null ? null : (amb.beds.get(amb.room)?.kind ?? null);
  return probe;
}


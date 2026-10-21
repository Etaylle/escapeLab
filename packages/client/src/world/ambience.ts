import {
  audioEngine,
  biquad,
  chain,
  fadeTo,
  gain,
  levelAt,
  LOOKAHEAD,
  midKnock,
  modulate,
  noiseBurst,
  noiseLoop,
  onAllEnded,
  outlet,
  rand,
  still,
  strike,
  tick,
  tone,
  type Engine,
  type Fade,
  type ToneSpec,
} from './audio.js';
import type { Dressing } from './dress.js';
import { warmUp, WARM_UP_MS } from './rooms.js';
import type { FloorKind } from './surfaces.js';

/**
 * Rooms you can hear. Every room plays a bed after its kind (its label's, as the art bible
 * dresses it; a label without one is a plain lab room), in two layers: what runs on the lab's
 * power — fans, hums, whines, a machine's thump, a console's tick — and what lives without
 * it — drips, rumble, creaks, a clank down the corridor, the core's beat. The room the player
 * stands in plays at full, the rooms behind an open door or an opening 12 dB under it and the
 * rest not at all; a change crossfades over 1.2 s. The audience, standing nowhere, hears every
 * room 12 dB under. While the lab has its power every powered layer runs, under the power hum
 * (audio.ts); when the lights fail they spin down with it, and a room whose lights come back
 * warms its layer up as they do (rooms.ts `warmUp`). A bed is built when it becomes audible
 * and torn down once it has faded out; its sporadic sounds are scheduled ahead on the audio
 * clock by a timer of their own, never by the frame loop. Pure up to `startAmbience`.
 */

/** What a bed is made for: a room's kind, or a plain lab room. */
export type BedKind = FloorKind;

/** A change of room crossfades the beds over this long, s. */
export const ROOM_FADE_S = 1.2;
/** A room behind an open door or an opening plays this far under the player's own: −12 dB. */
export const NEIGHBOUR_LEVEL = 10 ** (-12 / 20);
/** A bed at full, at the master gain: under the effects (audio.ts EFFECTS_LEVEL). */
export const BED_LEVEL = 0.02;
/** The powered layers spin down over this long once the lights fail, s; the hums fall with it. */
export const POWER_DIE_S = 1.4;
/** How far a dying hum's pitch falls: as the power hum's does (audio.ts). */
const HUM_FALL = 0.25;

/** A way between two rooms: through the door `door`, or an opening (null), always open. */
export interface RoomLink {
  readonly a: string;
  readonly b: string;
  readonly door: string | null;
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
 * of one room meets another's with no door between.
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
  const link = (a: string, b: string, door: string | null): void => {
    const [first, second] = a < b ? [a, b] : [b, a];
    links.set(`${first}\n${second}\n${door ?? ''}`, { a: first, b: second, door });
  };
  rooms.forEach((room, i) => {
    if (room === null) return;
    if (!kinds.has(room)) kinds.set(room, dressing.kinds[i] ?? 'plain');
    const x = i % width;
    const y = Math.floor(i / width);
    for (const other of [roomOf(x + 1, y), roomOf(x, y + 1)]) {
      if (other !== null && other !== room) link(room, other, null);
    }
  });
  for (const door of doors) {
    const beside = [...new Set(SIDES.map(([dx, dy]) => roomOf(door.x + dx, door.y + dy)))];
    const named = beside.filter((room): room is string => room !== null);
    named.forEach((a, i) => named.slice(i + 1).forEach((b) => link(a, b, door.id)));
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
 * How loud each room's bed plays for a player in `room`, by room: their own at full, those a
 * door in `open` or an opening joins to it at NEIGHBOUR_LEVEL, the rest not at all (left out).
 * For the audience (`room` null) every room at NEIGHBOUR_LEVEL.
 */
export function bedLevels(
  plan: RoomPlan,
  room: string | null,
  open: ReadonlySet<string>,
): Map<string, number> {
  if (room === null) {
    return new Map([...plan.kinds.keys()].map((name) => [name, NEIGHBOUR_LEVEL]));
  }
  const levels = new Map<string, number>([[room, 1]]);
  for (const { a, b, door } of plan.links) {
    const other = a === room ? b : b === room ? a : null;
    if (other !== null && (door === null || open.has(door)) && !levels.has(other)) {
      levels.set(other, NEIGHBOUR_LEVEL);
    }
  }
  return levels;
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

// --- the beds' sounds ----------------------------------------------------------------------

/** The lasting sources of a layer; its hums fall in pitch as it dies. */
interface Layer {
  readonly sources: AudioScheduledSourceNode[];
  readonly hums: OscillatorNode[];
}

const NO_LAYER: Layer = { sources: [], hums: [] };

/** Sines at [Hz, level] through a lowpass at `cutoff` into `dest`, from `at`. */
function hum(
  ctx: BaseAudioContext,
  dest: AudioNode,
  at: number,
  voices: readonly (readonly [number, number])[],
  cutoff: number,
): Layer {
  const lowpass = biquad(ctx, 'lowpass', cutoff, 0);
  lowpass.connect(dest);
  const hums = voices.map(([frequency, level]) => {
    const osc = ctx.createOscillator();
    osc.frequency.value = frequency;
    chain(osc, gain(ctx, level), lowpass);
    osc.start(at);
    return osc;
  });
  return { sources: hums, hums };
}

/**
 * Air moving: looped noise through a band at `centre` Hz into `dest` at `level`; with a
 * `drift` ([Hz, depth in Hz]) its centre wanders like a fan's or a duct's.
 */
function air(
  ctx: BaseAudioContext,
  dest: AudioNode,
  at: number,
  [centre, q, level]: readonly [number, number, number],
  drift?: readonly [number, number],
): Layer {
  const band = biquad(ctx, 'bandpass', centre, q);
  const noise = noiseLoop(ctx, at);
  chain(noise, band, gain(ctx, level), dest);
  const sources: AudioScheduledSourceNode[] = [noise];
  if (drift !== undefined) {
    const wander = ctx.createOscillator();
    wander.frequency.value = drift[0];
    modulate(ctx, wander, drift[1], band.frequency);
    wander.start(at);
    sources.push(wander);
  }
  return { sources, hums: [] };
}

/** A low rumble: a sine at `hz` and noise under 90 Hz, felt more than heard. */
function rumble(
  ctx: BaseAudioContext,
  dest: AudioNode,
  at: number,
  [hz, level]: readonly [number, number],
): Layer {
  const out = outlet(ctx, dest, level);
  const low = hum(ctx, out, at, [[hz, 0.6]], 120);
  const floor = noiseLoop(ctx, at);
  chain(floor, biquad(ctx, 'lowpass', 90, 0), gain(ctx, 0.8), out);
  return { sources: [...low.sources, floor], hums: [] };
}

/** A layer of several. */
function both(...layers: Layer[]): Layer {
  return {
    sources: layers.flatMap((layer) => layer.sources),
    hums: layers.flatMap((layer) => layer.hums),
  };
}

type Build = (ctx: BaseAudioContext, dest: AudioNode, at: number) => Layer;

/** What each kind of room runs on the lab's power. */
const POWERED: Readonly<Record<BedKind, Build>> = {
  server: (ctx, dest, at) =>
    both(
      air(ctx, dest, at, [1100, 0.5, 0.5], [0.25, 150]),
      hum(ctx, dest, at, [[120, 0.35], [240, 0.08]], 600),
      hum(ctx, dest, at, [[8000, 0.012]], 12000),
    ),
  machine: () => NO_LAYER,
  archive: (ctx, dest, at) => air(ctx, dest, at, [500, 0.7, 0.18], [0.07, 120]),
  corridor: (ctx, dest, at) =>
    both(
      air(ctx, dest, at, [320, 0.9, 0.4], [0.05, 60]),
      hum(ctx, dest, at, [[100, 0.12], [200, 0.05]], 400),
    ),
  lab: (ctx, dest, at) => hum(ctx, dest, at, [[50, 0.3], [100, 0.22], [150, 0.08]], 400),
  reactor: (ctx, dest, at) => hum(ctx, dest, at, [[110, 0.12], [220, 0.06]], 500),
  control: (ctx, dest, at) =>
    both(
      hum(ctx, dest, at, [[60, 0.15], [180, 0.08]], 800),
      air(ctx, dest, at, [2400, 4, 0.03]),
    ),
  plain: (ctx, dest, at) =>
    both(
      air(ctx, dest, at, [600, 0.7, 0.4], [0.06, 200]),
      hum(ctx, dest, at, [[55, 0.5], [55.4, 0.3]], 120),
    ),
};

/** What each kind of room keeps without it. */
const IDLE: Readonly<Partial<Record<BedKind, Build>>> = {
  machine: (ctx, dest, at) => rumble(ctx, dest, at, [38, 0.5]),
  reactor: (ctx, dest, at) => rumble(ctx, dest, at, [30, 0.6]),
};

/** A sine from `at`, gliding from `from` to `to` Hz: struck — no hold, a sharp attack. */
function ping(
  ctx: BaseAudioContext,
  dest: AudioNode,
  at: number,
  [from, to, peak, decay]: readonly [number, number, number, number],
): OscillatorNode {
  const spec: ToneSpec = { type: 'sine', at, from, to, peak, attack: 0.003, hold: 0, decay };
  return tone(ctx, dest, spec);
}

/** A drop of water falling into a puddle: a quick falling blip and its plink. */
function drip(ctx: BaseAudioContext, dest: AudioNode, at: number): AudioScheduledSourceNode[] {
  const pitch = rand(0.85, 1.2);
  return [
    ping(ctx, dest, at, [1800 * pitch, 900 * pitch, 0.6, 0.06]),
    ping(ctx, dest, at + 0.012, [2600 * pitch, 2500 * pitch, 0.15, 0.12]),
  ];
}

/** Strained metal: a tone chopped into irregular stick-slip friction pulses. */
function creak(ctx: BaseAudioContext, dest: AudioNode, at: number): AudioScheduledSourceNode[] {
  const length = rand(0.8, 1.5);
  const end = at + length;
  const pitch = rand(380, 560);
  const voice = ctx.createOscillator();
  voice.type = 'triangle';
  voice.frequency.setValueAtTime(pitch, at);
  voice.frequency.linearRampToValueAtTime(pitch * 0.92, end);
  // Gain 0.5 - 0.5 * saw jumps to 1 and decays linearly each cycle: one pulse per 'slip'.
  const slip = ctx.createOscillator();
  slip.type = 'sawtooth';
  slip.frequency.setValueAtTime(rand(12, 20), at);
  slip.frequency.linearRampToValueAtTime(rand(24, 34), at + length * 0.4);
  slip.frequency.linearRampToValueAtTime(rand(9, 16), end);
  const chopper = gain(ctx, 0.5);
  modulate(ctx, slip, -0.5, chopper.gain);
  const swell = gain(ctx, 0);
  swell.gain.setValueAtTime(0, at);
  swell.gain.linearRampToValueAtTime(rand(0.2, 0.35), at + length * 0.3);
  swell.gain.linearRampToValueAtTime(0, end);
  chain(voice, chopper, swell, dest);
  for (const osc of [voice, slip]) {
    osc.start(at);
    osc.stop(end + 0.02);
  }
  return [voice, slip];
}

/** Struck metal far off, sometimes with a softer rebound. */
function clank(ctx: BaseAudioContext, dest: AudioNode, at: number): AudioScheduledSourceNode[] {
  const base = rand(170, 320);
  const level = rand(0.3, 0.5);
  strike(ctx, dest, at, base, level);
  if (Math.random() < 0.5) {
    strike(ctx, dest, at + rand(0.08, 0.2), base * rand(0.97, 1.03), level * 0.4);
  }
  return [];
}

/** Far off in a plain lab: mostly a clank, a creak about every third time. */
function distant(ctx: BaseAudioContext, dest: AudioNode, at: number): AudioScheduledSourceNode[] {
  return Math.random() < 0.35 ? creak(ctx, dest, at) : clank(ctx, dest, at);
}

/** A machine's slow stroke: a low thud with its mid layer, for a small speaker too. */
function thump(ctx: BaseAudioContext, dest: AudioNode, at: number): AudioScheduledSourceNode[] {
  return [ping(ctx, dest, at, [75, 42, 0.9, 0.32]), midKnock(ctx, dest, at, 0.12, 0.3)];
}

/** Steam escaping a valve: high noise swelling and dying away over ~1.4 s. */
function hiss(ctx: BaseAudioContext, dest: AudioNode, at: number): AudioScheduledSourceNode[] {
  const steam = noiseBurst(ctx, at, 1.4);
  const level = gain(ctx, 0);
  level.gain.setValueAtTime(0, at);
  level.gain.linearRampToValueAtTime(0.35, at + 0.15);
  level.gain.setValueAtTime(0.35, at + 0.75);
  level.gain.linearRampToValueAtTime(0, at + 1.4);
  chain(steam, biquad(ctx, 'highpass', 2500, 0.7), level, dest);
  return [steam];
}

/** A flask on its heater: a run of small rising blips. */
function bubbling(ctx: BaseAudioContext, dest: AudioNode, at: number): AudioScheduledSourceNode[] {
  const blips: AudioScheduledSourceNode[] = [];
  let t = at;
  for (let i = Math.floor(rand(5, 10)); i > 0; i--) {
    const from = rand(300, 520);
    blips.push(ping(ctx, dest, t, [from, from * 1.9, 0.25, 0.04]));
    t += rand(0.05, 0.14);
  }
  return blips;
}

/** A console's relay ticking over, softly. */
function softTick(ctx: BaseAudioContext, dest: AudioNode, at: number): AudioScheduledSourceNode[] {
  return [tick(ctx, dest, at, 3200, 0.25)];
}

/** The core swelling to the top of its beat: a low throb, its peak where the light's is. */
function coreThrob(ctx: BaseAudioContext, dest: AudioNode, at: number): AudioScheduledSourceNode[] {
  const swell = { attack: CORE_LEAD_S, hold: 0.1, decay: 0.9 } as const;
  return [
    tone(ctx, dest, { type: 'sine', at, from: 55, to: 52, peak: 0.6, ...swell }),
    tone(ctx, dest, { type: 'sine', at, from: 330, to: 320, peak: 0.08, ...swell }),
  ];
}

/**
 * The core's beat as its light pulses (sources.ts CORE_PULSE, gl/pack.ts `pulseAt`): a
 * period of 2.4 s on the simulation's clock, at the top of it 0.6 s in.
 */
export const CORE_PERIOD_S = 2.4;
const CORE_PEAK_S = 0.6;
/** The throb rises this long to its peak. */
const CORE_LEAD_S = 0.35;

/** The first top of the core's beat after the sim time `time`. */
export function nextCorePeak(time: number): number {
  return CORE_PEAK_S + CORE_PERIOD_S * Math.ceil((time - CORE_PEAK_S) / CORE_PERIOD_S + 1e-9);
}

type Sound = (ctx: BaseAudioContext, dest: AudioNode, at: number) => AudioScheduledSourceNode[];

/**
 * A sporadic sound of a bed: on its powered layer, its unpowered one or — far off — through
 * the corridors' echo; every [min, max] seconds, or on the core's beat.
 */
interface Occasion {
  readonly layer: 'power' | 'idle' | 'far';
  readonly every: readonly [number, number] | 'core';
  readonly sound: Sound;
}

const OCCASIONS: Readonly<Record<BedKind, readonly Occasion[]>> = {
  server: [{ layer: 'idle', every: [15, 35], sound: creak }],
  machine: [
    { layer: 'power', every: [1.6, 1.6], sound: thump },
    { layer: 'power', every: [8, 20], sound: hiss },
  ],
  archive: [{ layer: 'idle', every: [7, 12], sound: drip }],
  corridor: [{ layer: 'far', every: [20, 40], sound: clank }],
  lab: [
    { layer: 'power', every: [10, 25], sound: bubbling },
    { layer: 'idle', every: [20, 40], sound: creak },
  ],
  reactor: [{ layer: 'idle', every: 'core', sound: coreThrob }],
  control: [
    { layer: 'power', every: [1, 1], sound: softTick },
    { layer: 'idle', every: [20, 40], sound: creak },
  ],
  plain: [{ layer: 'far', every: [7, 15], sound: distant }],
};

// --- the runtime -------------------------------------------------------------------------

/** One room's bed, built while it is heard. */
interface Bed {
  readonly room: string;
  readonly kind: BedKind;
  /** the room's level, BED_LEVEL at full */
  readonly out: GainNode;
  /** the powered layer, 0 (dead) to 1 */
  readonly power: GainNode;
  readonly idle: GainNode;
  /** the input for sounds far off: muffled and echoed down the corridors */
  readonly far: GainNode;
  level: Fade;
  powerFade: Fade;
  alive: boolean;
  powered: Layer;
  readonly lasting: Layer;
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
  readonly timer: ReturnType<typeof setInterval>;
}

/** How often the sporadic sounds are looked ahead for, ms, and how far ahead, s. */
const TICK_MS = 250;
const AHEAD_S = 0.8;

let ambience: Ambience | null = null;

/** Idempotent. The beds' runtime for a world: silent until `hearRooms` says where you are. */
export function startAmbience(clock: () => number): void {
  try {
    if (ambience !== null) return;
    const engine = audioEngine();
    if (engine === null) return;
    const timer = setInterval(occasions, TICK_MS);
    const beds = new Map<string, Bed>();
    ambience = { engine, clock, beds, plans: new WeakMap(), room: null, heard: null, timer };
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
    clearInterval(amb.timer);
    const now = amb.engine.ctx.currentTime;
    for (const bed of amb.beds.values()) {
      bed.level = fadeTo(bed.out.gain, bed.level, now, [now, now + 0.5], 0);
      release(bed, now + 0.55);
    }
  } catch {
    // Deliberately silent: the beds' nodes are released with the context at the latest.
  }
}

/** Where the beds are heard from this frame. */
export interface RoomScene {
  /** the view's map: its doors, and a new object for every view */
  readonly map: { readonly doors: readonly (DoorSpot & { readonly open: boolean })[] };
  /** its dressing (dress.ts), which shares the floor out to the rooms */
  readonly dressing: Pick<Dressing, 'width' | 'rooms' | 'kinds'>;
  /** where the player stands, tiles; null for the audience */
  readonly at: { readonly x: number; readonly y: number } | null;
  readonly power: Power;
  /** the simulation's clock now, s */
  readonly time: number;
}

/**
 * The beds follow the player, the doors and the power: called every frame, it does nothing
 * unless the tile, the view, the rooms lit or the power changed since — then each bed heard
 * crossfades to its level, beds come and go, and powered layers die or warm up.
 */
export function hearRooms(scene: RoomScene): void {
  try {
    const amb = ambience;
    if (amb === null) return;
    const heard = heardOf(scene);
    if (amb.heard !== null && sameHeard(amb.heard, heard)) return;
    amb.heard = heard;
    const plan = planOf(amb, scene);
    const { at } = scene;
    const room = at === null ? null : roomAt(plan, Math.floor(at.x), Math.floor(at.y), amb.room);
    amb.room = room;
    const open = new Set(scene.map.doors.filter((door) => door.open).map((door) => door.id));
    const levels = bedLevels(plan, room, open);
    const now = amb.engine.ctx.currentTime;
    for (const [name, level] of levels) {
      const bed = amb.beds.get(name) ?? addBed(amb, name, plan.kinds.get(name) ?? 'plain', now);
      setLevel(bed, level, now);
    }
    for (const bed of amb.beds.values()) {
      if (!levels.has(bed.room)) setLevel(bed, 0, now);
      setPower(amb, bed, bedPower(bed.room, scene.power, scene.time), now);
    }
  } catch {
    // Deliberately silent: the room still looks like itself.
  }
}

function heardOf(scene: RoomScene): Heard {
  const tile = scene.at === null ? null : `${Math.floor(scene.at.x)},${Math.floor(scene.at.y)}`;
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

/** A new bed for `room`, silent, its unpowered layer running and its powered one not yet. */
function addBed(amb: Ambience, room: string, kind: BedKind, now: number): Bed {
  const { ctx, duck } = amb.engine;
  const out = outlet(ctx, duck, 0);
  const power = outlet(ctx, out, 0);
  const idle = outlet(ctx, out, 1);
  const far = farOff(ctx, idle);
  const lasting = IDLE[kind]?.(ctx, idle, now) ?? NO_LAYER;
  const next = OCCASIONS[kind].map((occasion) => firstAt(occasion, now));
  const bed: Bed = {
    room,
    kind,
    out,
    power,
    idle,
    far,
    level: still(0),
    powerFade: still(0),
    alive: false,
    powered: NO_LAYER,
    lasting,
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

/** Sounds far off lose their highs and pick up a dark, decaying echo from the corridors. */
function farOff(ctx: BaseAudioContext, dest: AudioNode): GainNode {
  const input = gain(ctx, 1);
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.23;
  const darken = biquad(ctx, 'lowpass', 1100, 0);
  chain(input, biquad(ctx, 'lowpass', 1800, 0), dest);
  chain(input, delay, darken, gain(ctx, 0.35), delay);
  chain(darken, gain(ctx, 0.4), dest);
  return input;
}

/** The bed crossfades to `level` (0, NEIGHBOUR_LEVEL, 1) over ROOM_FADE_S, unless headed there. */
function setLevel(bed: Bed, level: number, now: number): void {
  if (bed.level.to === level * BED_LEVEL) return;
  bed.level = fadeTo(bed.out.gain, bed.level, now, [now, now + ROOM_FADE_S], level * BED_LEVEL);
}

/** The bed's powered layer as `state` says: built and warmed up, or spun down from its moment. */
function setPower(amb: Ambience, bed: Bed, state: ReturnType<typeof bedPower>, now: number): void {
  if (state.alive && !bed.alive) {
    bed.alive = true;
    bed.powered = POWERED[bed.kind](amb.engine.ctx, bed.power, now);
    warmUpLayer(bed, state.warm, now);
  } else if (!state.alive && bed.alive) {
    bed.alive = false;
    const at = Math.max(now, now + (state.from - Date.now()) / 1000);
    dieDown(bed, at);
  }
}

/** Samples of the lights' warm-up (rooms.ts), for the powered layer to come up along. */
const WARM_STEPS = 26;

/** The powered layer comes up with the room's lights: along their warm-up, `warm` s into it. */
function warmUpLayer(bed: Bed, warm: number, now: number): void {
  const param = bed.power.gain;
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

/** The powered layer spins down from `at`: its level falls, its hums sag, its sources stop. */
function dieDown(bed: Bed, at: number): void {
  const end = at + POWER_DIE_S;
  bed.powerFade = fadeTo(bed.power.gain, bed.powerFade, at, [at, end], 0);
  for (const osc of bed.powered.hums) {
    const frequency = osc.frequency.value;
    osc.frequency.setValueAtTime(frequency, at);
    osc.frequency.exponentialRampToValueAtTime(frequency * HUM_FALL, end);
  }
  for (const source of bed.powered.sources) source.stop(end + 0.05);
  bed.powered = NO_LAYER;
}

/** Stops every source of the bed at `at` and lets its nodes go once they have. */
function release(bed: Bed, at: number): void {
  const sources = [...bed.powered.sources, ...bed.lasting.sources];
  for (const source of sources) source.stop(at);
  const done = (): void => bed.out.disconnect();
  if (sources.length === 0) done();
  else onAllEnded(sources, done);
}

/**
 * The timer's round: each bed heard schedules the sounds it has coming within AHEAD_S on the
 * audio clock, and a bed faded out for good is torn down.
 */
function occasions(): void {
  try {
    const amb = ambience;
    if (amb === null) return;
    const now = amb.engine.ctx.currentTime;
    for (const bed of [...amb.beds.values()]) {
      if (bed.level.to === 0 && now > bed.level.end + 0.1) {
        amb.beds.delete(bed.room);
        release(bed, now);
      } else if (amb.engine.ctx.state === 'running') {
        scheduleOccasions(amb, bed, now);
      }
    }
  } catch {
    // Deliberately silent: only this round's sounds are lost.
  }
}

/** The bed's sounds due before now + AHEAD_S, each on its own layer, while that layer is up. */
function scheduleOccasions(amb: Ambience, bed: Bed, now: number): void {
  OCCASIONS[bed.kind].forEach((occasion, i) => {
    if (occasion.every === 'core') {
      throbOnTheBeat(amb, bed, occasion.sound, now);
      return;
    }
    const due = bed.next[i] ?? now;
    if (due > now + AHEAD_S) return;
    const at = Math.max(due, now + LOOKAHEAD);
    if (occasion.layer !== 'power' || bed.alive) {
      occasion.sound(amb.engine.ctx, layerOf(bed, occasion.layer), at);
    }
    bed.next[i] = at + rand(occasion.every[0], occasion.every[1]);
  });
}

/** Where a sound of the bed goes in. */
function layerOf(bed: Bed, layer: Occasion['layer']): AudioNode {
  if (layer === 'power') return bed.power;
  return layer === 'far' ? bed.far : bed.idle;
}

/** The core's throb, once a beat, rising so that it peaks with the core's light. */
function throbOnTheBeat(amb: Ambience, bed: Bed, sound: Sound, now: number): void {
  const time = amb.clock();
  const peak = nextCorePeak(time);
  const at = now + (peak - time) - CORE_LEAD_S;
  if (peak <= bed.corePeak || at > now + AHEAD_S) return;
  bed.corePeak = peak;
  sound(amb.engine.ctx, bed.idle, Math.max(at, now + LOOKAHEAD));
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

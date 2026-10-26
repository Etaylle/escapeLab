import {
  audioEngine,
  biquad,
  capped,
  chain,
  claim,
  fadeTo,
  gain,
  levelAt,
  LOOKAHEAD,
  LOOP_S,
  loopOf,
  midKnock,
  modulate,
  noiseBuffer,
  noiseBurst,
  noiseLoop,
  outlet,
  playLoop,
  rand,
  release,
  still,
  strikeInto,
  tick,
  tone,
  type Cost,
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
 * power — fans, hums, whines — and what lives without it — the rumble of a machine room or a
 * reactor. Each layer is a loop rendered once for its kind (audio.ts `loopOf`) and played
 * round and round, so a bed costs the audio thread a source or two, not a stack of oscillators
 * and live filters. The room the player stands in plays both its layers at full and its
 * sporadic sounds — drips, creaks, strokes, a clank down the corridor, the core's beat, a
 * console's tick; the two nearest rooms behind an open door or an opening play their main
 * layer 12 dB under it; the rest nothing, stopped. A change crossfades over 1.2 s. While the
 * lab has its power every powered layer runs, under the power hum (audio.ts); when the lights
 * fail they spin down with it, slowing as they fade, and a room whose lights come back warms
 * its layer up as they do (rooms.ts `warmUp`). The audience, standing nowhere, hears no beds.
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
/** A bed at full, at the master gain: under the effects (audio.ts EFFECTS_LEVEL). */
export const BED_LEVEL = 0.02;
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

// --- the beds' layers, rendered once into loops -----------------------------------------

/** What a recipe builds into an offline context, from 0. */
type Build = (ctx: BaseAudioContext, dest: AudioNode) => void;

/** Sines at [Hz, level] through a lowpass at `cutoff` into `dest`. */
function hum(
  ctx: BaseAudioContext,
  dest: AudioNode,
  voices: readonly (readonly [number, number])[],
  cutoff: number,
): void {
  const lowpass = biquad(ctx, 'lowpass', cutoff, 0);
  lowpass.connect(dest);
  for (const [frequency, level] of voices) {
    const osc = ctx.createOscillator();
    osc.frequency.value = frequency;
    chain(osc, gain(ctx, level), lowpass);
    osc.start(0);
  }
}

/** One turn of the air's wander a loop: it repeats with it. */
const WANDER_HZ = 0.25;

/**
 * Air moving: the shared noise through a band at `centre` Hz into `dest` at `level`; with a
 * `wander` (depth in Hz) its centre drifts like a fan's or a duct's, once round a loop.
 */
function air(
  ctx: BaseAudioContext,
  dest: AudioNode,
  [centre, q, level]: readonly [number, number, number],
  wander = 0,
): void {
  const band = biquad(ctx, 'bandpass', centre, q);
  chain(noiseLoop(ctx, 0), band, gain(ctx, level), dest);
  if (wander > 0) {
    const drift = ctx.createOscillator();
    drift.frequency.value = WANDER_HZ;
    modulate(ctx, drift, wander, band.frequency);
    drift.start(0);
  }
}

/** A low rumble: a sine at `hz` and noise under 90 Hz, felt more than heard. */
function rumble(
  ctx: BaseAudioContext,
  dest: AudioNode,
  [hz, level]: readonly [number, number],
): void {
  const out = outlet(ctx, dest, level);
  hum(ctx, out, [[hz, 0.6]], 120);
  chain(noiseLoop(ctx, 0), biquad(ctx, 'lowpass', 90, 0), gain(ctx, 0.8), out);
}

/**
 * What each kind of room runs on the lab's power, as a loop: every tone a whole number of
 * cycles in LOOP_S (a plain room's slow beat 55 against 55.5 Hz), every wander once round.
 */
export const POWERED: Readonly<Partial<Record<BedKind, Build>>> = {
  server: (ctx, dest) => {
    air(ctx, dest, [1100, 0.5, 0.5], 150);
    hum(ctx, dest, [[120, 0.35], [240, 0.08]], 600);
    hum(ctx, dest, [[8000, 0.012]], 12000);
  },
  archive: (ctx, dest) => air(ctx, dest, [500, 0.7, 0.18], 120),
  corridor: (ctx, dest) => {
    air(ctx, dest, [320, 0.9, 0.4], 60);
    hum(ctx, dest, [[100, 0.12], [200, 0.05]], 400);
  },
  lab: (ctx, dest) => hum(ctx, dest, [[50, 0.3], [100, 0.22], [150, 0.08]], 400),
  reactor: (ctx, dest) => hum(ctx, dest, [[110, 0.12], [220, 0.06]], 500),
  control: (ctx, dest) => {
    hum(ctx, dest, [[60, 0.15], [180, 0.08]], 800);
    air(ctx, dest, [2400, 4, 0.03]);
  },
  plain: (ctx, dest) => {
    air(ctx, dest, [600, 0.7, 0.4], 200);
    hum(ctx, dest, [[55, 0.5], [55.5, 0.3]], 120);
  },
};

/** What each kind of room keeps without it, as a loop. */
export const IDLE: Readonly<Partial<Record<BedKind, Build>>> = {
  machine: (ctx, dest) => rumble(ctx, dest, [38, 0.5]),
  reactor: (ctx, dest) => rumble(ctx, dest, [30, 0.6]),
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

/**
 * Metal struck far down a corridor: its highs gone, and the echo coming back off the walls
 * twice, each time fainter and plainer.
 */
function farClank(ctx: BaseAudioContext, dest: AudioNode, at: number): AudioScheduledSourceNode[] {
  const base = rand(170, 320);
  const far = biquad(ctx, 'lowpass', 1800, 0);
  far.connect(dest);
  const echo = (level: number): GainNode => outlet(ctx, far, level);
  return [
    ...strikeInto(ctx, echo(rand(0.3, 0.5)), at, base, { partials: 2, impact: true }),
    ...strikeInto(ctx, echo(0.14), at + 0.23, base, { partials: 1, impact: false }),
    ...strikeInto(ctx, echo(0.05), at + 0.46, base, { partials: 1, impact: false }),
  ];
}

/** Far off in a plain lab: mostly a clank, a creak about every third time. */
function distant(ctx: BaseAudioContext, dest: AudioNode, at: number): AudioScheduledSourceNode[] {
  return Math.random() < 0.35 ? creak(ctx, dest, at) : farClank(ctx, dest, at);
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

/** How many blips a flask bubbles in a run. */
const BUBBLES = 4;

/** A flask on its heater: a run of small rising blips. */
function bubbling(ctx: BaseAudioContext, dest: AudioNode, at: number): AudioScheduledSourceNode[] {
  const blips: AudioScheduledSourceNode[] = [];
  let t = at;
  for (let i = 0; i < BUBBLES; i++) {
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
 * A sporadic sound of the own room's bed: on its powered layer or its unpowered one, every
 * [min, max] seconds or on the core's beat, and what it takes from the budget while it plays.
 */
interface Occasion {
  readonly layer: Layer;
  readonly every: readonly [number, number] | 'core';
  readonly sound: Sound;
  readonly cost: Cost;
}

const CREAK: Occasion = { layer: 'idle', every: [20, 40], sound: creak, cost: { voice: 2 } };

/** The sporadic sounds of each kind of room. */
export const OCCASIONS: Readonly<Record<BedKind, readonly Occasion[]>> = {
  server: [{ ...CREAK, every: [15, 35] }],
  machine: [
    { layer: 'power', every: [1.6, 1.6], sound: thump, cost: { voice: 1, noise: 1 } },
    { layer: 'power', every: [8, 20], sound: hiss, cost: { noise: 1 } },
  ],
  archive: [{ layer: 'idle', every: [7, 12], sound: drip, cost: { voice: 2 } }],
  corridor: [
    { layer: 'idle', every: [20, 40], sound: farClank, cost: { voice: 4, noise: 1 } },
  ],
  lab: [
    { layer: 'power', every: [10, 25], sound: bubbling, cost: { voice: BUBBLES } },
    CREAK,
  ],
  reactor: [{ layer: 'idle', every: 'core', sound: coreThrob, cost: { voice: 2 } }],
  control: [{ layer: 'power', every: [1, 1], sound: softTick, cost: { noise: 1 } }, CREAK],
  plain: [{ layer: 'idle', every: [7, 15], sound: distant, cost: { voice: 4, noise: 1 } }],
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
    // The shared noise at the live context's rate, before any loop is rendered from it.
    noiseBuffer(engine.ctx);
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

/** The plan of the scene's dressing, worked out once for it; its kinds' loops set rendering. */
function planOf(amb: Ambience, scene: RoomScene): RoomPlan {
  const known = amb.plans.get(scene.dressing);
  if (known !== undefined) return known;
  const plan = roomPlan(scene.dressing, scene.map.doors);
  amb.plans.set(scene.dressing, plan);
  for (const kind of new Set(plan.kinds.values())) {
    bedLoop(amb, kind, 'power');
    bedLoop(amb, kind, 'idle');
  }
  return plan;
}

/**
 * The loop of `kind`'s `layer`: rendered once, at half the live context's rate — enough for
 * what the beds hold — and kept; null while it renders, or where the kind has no such layer.
 */
function bedLoop(amb: Ambience, kind: BedKind, layer: Layer): AudioBuffer | null {
  const build = (layer === 'power' ? POWERED : IDLE)[kind];
  if (build === undefined) return null;
  return loopOf(`ambience/${kind}/${layer}`, build, LOOP_S, amb.engine.ctx.sampleRate / 2);
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
 * The bed's loops as `loopsOf` has them: one due starts once its loop is rendered and the
 * budget has a loop left — else it is tried again next round — and one no longer due stops.
 */
function syncLoops(amb: Ambience, bed: Bed, now: number): void {
  const due = loopsOf(bed.kind, bed.alive, bed.neighbour);
  for (const layer of ['power', 'idle'] as const) {
    const playing = bed.playing[layer];
    if (!due[layer] && playing !== null) {
      bed.playing[layer] = null;
      playing.stop(now + 0.05);
    } else if (due[layer] && playing === null) {
      const loop = bedLoop(amb, bed.kind, layer);
      if (loop !== null && claim({ loop: 1 })) {
        const source = playLoop(amb.engine.ctx, loop, bed.stages[layer], now + LOOKAHEAD);
        source.onended = () => release({ loop: 1 });
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
      const { ctx } = amb.engine;
      capped(ctx, bed.stages[occasion.layer], occasion.cost, (out) => occasion.sound(ctx, out, at));
    }
    bed.next[i] = at + rand(occasion.every[0], occasion.every[1]);
  });
}

/** The core's throb, once a beat, rising so that it peaks with the core's light. */
function throbOnTheBeat(amb: Ambience, bed: Bed, occasion: Occasion, now: number): void {
  const time = amb.clock();
  const peak = nextCorePeak(time);
  const at = now + (peak - time) - CORE_LEAD_S;
  if (peak <= bed.corePeak || at > now + AHEAD_S) return;
  bed.corePeak = peak;
  const { ctx } = amb.engine;
  const when = Math.max(at, now + LOOKAHEAD);
  capped(ctx, bed.stages[occasion.layer], occasion.cost, (out) => occasion.sound(ctx, out, when));
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


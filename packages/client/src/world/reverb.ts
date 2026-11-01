import { audioEngine, systemsOff, timed, type Engine } from './audio.js';
import { hold, letGo } from './audioMemory.js';
import type { FloorKind } from './surfaces.js';

/**
 * reverb.ts: the room answering what sounds in it. Each kind of room has an impulse response of
 * its own, made here rather than recorded: noise through a one-pole lowpass — the walls taking
 * the top off — decaying exponentially by 60 dB over the room's time, a steel room ringing in a
 * few modes over it, two channels from two seeds so that the tail is wide; the same seed, the
 * same room, run after run (`impulseResponse`, pure). A ConvolverNode plays it on the mix's
 * sends (mix.ts: the effects at −14 dB, the beds at −18 dB, the plant's loudspeakers at −6 dB;
 * the radio stays dry), its return into the master. As the player walks into a room of another
 * kind the new room's answer comes in over ROOM_SWITCH_S while the old one goes, and the old one
 * is let go once its tail has died — two convolvers at most, and only while they cross. The
 * room is the one the beds hear the player in (ambience.ts `hearRooms`); the audience, standing
 * nowhere, hears the lab dry. `?audio-off=reverb` leaves it out, to tell its cost apart.
 */

/** A room's answer: how long it rings, how bright it stays, how much like steel, how much. */
export interface IrSpec {
  /** its 60 dB decay, s */
  readonly seconds: number;
  /** above this its walls swallow the sound, Hz */
  readonly bright: number;
  /** how far it rings in the modes of a steel hall over the noise, 0 for none */
  readonly metal: number;
  /** how much of a sound it gives back: the response's RMS gain, a dead room least */
  readonly level: number;
  /** where its noise starts: the same seed, the same room */
  readonly seed: number;
}

/**
 * Each kind's answer: a long, bright corridor, a short dull server room in its racks' foam, a
 * reactor hall of steel ringing for 1.8 s, a dead archive among its books.
 */
export const ROOM_IRS: Readonly<Record<FloorKind, IrSpec>> = {
  corridor: { seconds: 1.2, bright: 9000, metal: 0, level: 0.9, seed: 11 },
  lab: { seconds: 0.6, bright: 6000, metal: 0, level: 0.7, seed: 12 },
  server: { seconds: 0.4, bright: 2500, metal: 0, level: 0.6, seed: 13 },
  reactor: { seconds: 1.8, bright: 7000, metal: 0.5, level: 1, seed: 14 },
  archive: { seconds: 0.5, bright: 3000, metal: 0, level: 0.35, seed: 15 },
  machine: { seconds: 1, bright: 5000, metal: 0.25, level: 0.85, seed: 16 },
  control: { seconds: 0.7, bright: 5500, metal: 0, level: 0.65, seed: 17 },
  plain: { seconds: 0.6, bright: 6000, metal: 0, level: 0.7, seed: 18 },
};

/** The modes a steel room rings in, Hz: inharmonic, as a plate's are. */
export const METAL_MODES = [420, 690, 1130, 1870, 2950] as const;
/** A room's answer crossfades to the next room's over this long, s. */
export const ROOM_SWITCH_S = 0.3;
/** −60 dB, as a factor of the decay's exponent. */
const SIXTY_DB = Math.log(1000);

/** A seeded generator of numbers from 0 to 1 (mulberry32): the same seed, the same numbers. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The modes of a steel room, one oscillator each, turned on by rotation rather than a sine a
 * sample: where each stands (c, s) and how far it turns a sample.
 */
interface Mode {
  c: number;
  s: number;
  readonly cos: number;
  readonly sin: number;
}

/** Each of METAL_MODES at `rate`, started at a phase out of `random`. */
function modesAt(rate: number, random: () => number): Mode[] {
  return METAL_MODES.map((hz) => {
    const phase = random() * 2 * Math.PI;
    const step = (2 * Math.PI * hz) / rate;
    return { c: Math.cos(phase), s: Math.sin(phase), cos: Math.cos(step), sin: Math.sin(step) };
  });
}

/** The modes' sum this sample, each turned on by one. */
function ringOf(modes: Mode[]): number {
  let sum = 0;
  for (const mode of modes) {
    sum += mode.s;
    const c = mode.c * mode.cos - mode.s * mode.sin;
    mode.s = mode.s * mode.cos + mode.c * mode.sin;
    mode.c = c;
  }
  return sum / modes.length;
}

/** One channel of `spec`'s response at `rate`, its noise from `seed`, before it is levelled. */
function channel(spec: IrSpec, rate: number, seed: number): Float32Array {
  const length = Math.ceil(spec.seconds * rate);
  const out = new Float32Array(length);
  const random = seeded(seed);
  const smooth = Math.exp((-2 * Math.PI * spec.bright) / rate);
  const fall = Math.exp(-SIXTY_DB / length);
  const modes = spec.metal > 0 ? modesAt(rate, random) : [];
  let low = 0;
  let envelope = 1;
  for (let i = 0; i < length; i++) {
    low = (1 - smooth) * (random() * 2 - 1) + smooth * low;
    const ring = modes.length > 0 ? spec.metal * ringOf(modes) : 0;
    out[i] = (low + ring) * envelope;
    envelope *= fall;
  }
  return out;
}

/** `data` scaled so that its RMS gain — the root of its sum of squares — is `level`. */
function levelled(data: Float32Array, level: number): Float32Array {
  let sum = 0;
  for (const x of data) sum += x * x;
  const scale = sum > 0 ? level / Math.sqrt(sum) : 0;
  for (let i = 0; i < data.length; i++) data[i] = (data[i] ?? 0) * scale;
  return data;
}

/**
 * The impulse response of a room as `spec` has it, at `rate`: two channels, each `spec.seconds`
 * long, of filtered noise from its own seed decaying by 60 dB, each at the RMS gain `level`.
 */
export function impulseResponse(spec: IrSpec, rate: number): [Float32Array, Float32Array] {
  return [
    levelled(channel(spec, rate, spec.seed * 2), spec.level),
    levelled(channel(spec, rate, spec.seed * 2 + 1), spec.level),
  ];
}

// --- the runtime -------------------------------------------------------------------------

/**
 * A room's answer playing: its kind, its convolver, the level its return comes in at, and the
 * key its response is counted under (audioMemory.ts).
 */
interface Slot {
  readonly kind: FloorKind;
  readonly convolver: ConvolverNode;
  readonly wet: GainNode;
  readonly key: string;
}

/** How many answers have been opened: each response is counted under a key of its own. */
let opened = 0;

interface Reverb {
  readonly engine: Engine;
  /** the room answering now, and one going, at most */
  current: Slot | null;
  going: Slot | null;
}

let reverb: Reverb | null = null;

/** The response of `kind` on the engine's context, as a buffer of two channels. */
function bufferOf(engine: Engine, kind: FloorKind): AudioBuffer {
  const { ctx } = engine;
  const [left, right] = impulseResponse(ROOM_IRS[kind], ctx.sampleRate);
  const buffer = ctx.createBuffer(2, left.length, ctx.sampleRate);
  buffer.getChannelData(0).set(left);
  buffer.getChannelData(1).set(right);
  return buffer;
}

/** `kind`'s answer on the sends, its return rising from silence into the master. */
function open(engine: Engine, kind: FloorKind): Slot {
  const { ctx } = engine;
  const convolver = ctx.createConvolver();
  convolver.normalize = false;
  const response = bufferOf(engine, kind);
  convolver.buffer = response;
  const wet = ctx.createGain();
  wet.gain.value = 0;
  engine.sends.connect(convolver);
  convolver.connect(wet);
  wet.connect(engine.master);
  opened += 1;
  const key = `reverb:${opened}`;
  hold(key, 'made', response);
  return { kind, convolver, wet, key };
}

/** How fast an answer still going is cut for a third, s. */
const CUT_S = 0.02;

/**
 * `slot`'s return fades out from `now` over `seconds`, and its nodes go once its tail has died.
 */
function close(engine: Engine, slot: Slot, now: number, seconds: number): void {
  slot.wet.gain.cancelScheduledValues(now);
  slot.wet.gain.setValueAtTime(slot.wet.gain.value, now);
  slot.wet.gain.linearRampToValueAtTime(0, now + seconds);
  const tail = seconds + ROOM_IRS[slot.kind].seconds;
  setTimeout(() => {
    letGo(slot.key);
    try {
      engine.sends.disconnect(slot.convolver);
      slot.convolver.disconnect();
      slot.wet.disconnect();
    } catch {
      // Deliberately silent: the nodes go with the context at the latest.
    }
  }, tail * 1000);
}

/**
 * The room the player stands in is of `kind` now (ambience.ts, ten times a second): where that
 * is another kind than before, its answer comes in over ROOM_SWITCH_S as the old one goes; null
 * — nobody's room — leaves the lab dry.
 */
export function hearRoom(kind: FloorKind | null): void {
  try {
    if ((reverb?.current?.kind ?? null) === kind) return;
    if (reverb === null) {
      const engine = audioEngine();
      const search = typeof location === 'undefined' ? '' : location.search;
      if (engine === null || systemsOff(search).has('reverb')) return;
      reverb = { engine, current: null, going: null };
    }
    const r = reverb;
    timed('reverb', () => switchTo(r, kind));
  } catch {
    // Deliberately silent: the room still looks like itself.
  }
}

/** The answer moves to `kind`'s: the old one goes, a third one cut at once. */
function switchTo(r: Reverb, kind: FloorKind | null): void {
  const now = r.engine.ctx.currentTime;
  if (r.going !== null) close(r.engine, r.going, now, CUT_S);
  r.going = r.current;
  if (r.going !== null) close(r.engine, r.going, now, ROOM_SWITCH_S);
  r.current = kind === null ? null : open(r.engine, kind);
  if (r.current !== null) {
    r.current.wet.gain.setValueAtTime(0, now);
    r.current.wet.gain.linearRampToValueAtTime(1, now + ROOM_SWITCH_S);
  }
}

/** The world is gone: the room's answer fades and goes. */
export function stopReverb(): void {
  try {
    const r = reverb;
    reverb = null;
    if (r === null) return;
    const now = r.engine.ctx.currentTime;
    for (const slot of [r.current, r.going]) {
      if (slot !== null) close(r.engine, slot, now, ROOM_SWITCH_S);
    }
  } catch {
    // Deliberately silent: the nodes go with the context at the latest.
  }
}

/** The room answering now, by kind; null where none does. */
export function reverbProbe(): { room: FloorKind | null; crossing: boolean } {
  return { room: reverb?.current?.kind ?? null, crossing: reverb?.going != null };
}

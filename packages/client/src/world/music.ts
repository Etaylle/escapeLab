import {
  audioEngine,
  biquad,
  chain,
  EFFECTS_LEVEL,
  fadeTo,
  gain,
  levelAt,
  LOOKAHEAD,
  midKnock,
  modulate,
  noiseBurst,
  onAllEnded,
  outlet,
  rand,
  still,
  tone,
  type Engine,
  type Fade,
} from './audio.js';

/**
 * Music that breathes: made at runtime, in three layers that one pressure value, 0 to 1,
 * brings in and takes out —
 *
 *   calm         a slow pad, two detuned sines through a lowpass sweeping over 20 s, and a
 *                swell of filtered noise about every 12 s;
 *   pressure     a muted bass pulse at 90 bpm and a sparse A-minor arpeggio over it;
 *   last minute  the arpeggio doubles, the pulse goes to 120 bpm and a heartbeat comes in, two
 *                thumps, rising from 70 to 120 bpm as the last 60 s run out.
 *
 * The pressure follows the clock (the tension curve the lab always had: nothing in the first
 * half, then rising to 1 as it runs out — and at least 0.8 in the last minute), every alarm
 * (+0.15 for 20 s) and the escape (at least 0.8). A layer comes in or goes on the beat, over
 * whole beats and at least 2 s. No music while the lab has its power: it starts under the
 * blackout 2 s after the click, 18 dB under the effects. The escape's siren takes the pad and
 * the arpeggio away and keeps the pulse and the heartbeat; a run won fades it out before its
 * chord, a run lost drains it with the power. `setTension` is its one input, once a frame; the
 * notes are scheduled ahead on the audio clock by a timer of its own. Pure up to `setTension`.
 */

/** The music at full: 18 dB under the effects (audio.ts EFFECTS_LEVEL). */
export const MUSIC_LEVEL = EFFECTS_LEVEL * 10 ** (-18 / 20);
/** The music starts this long after the click of the blackout, ms (coldOpen.ts REVEAL_MS). */
export const MUSIC_AFTER_CLICK_MS = 2000;
/** The pulse's tempo under pressure, and in the last minute. */
export const PULSE_BPM = 90;
export const LAST_BPM = 120;
/** The heartbeat's tempo as the last minute starts, and as it runs out. */
const HEART_FROM_BPM = 70;
const HEART_TO_BPM = 120;
/** The last minute, s. */
export const LAST_MINUTE_S = 60;
/** What an alarm adds to the pressure, and for how long, ms. */
export const ALARM_PUSH = 0.15;
export const ALARM_HOLD_MS = 20_000;
/** The pressure in the escape, at least; in the last minute, at least as much. */
export const ESCAPE_FLOOR = 0.8;
/** A crossfade lasts whole beats, at least this long, s. */
export const CROSSFADE_MIN_S = 2;
/** The pressure layer comes in at PRESSURE_ON and goes below PRESSURE_OFF; the last as well. */
const PRESSURE_ON = 0.35;
const PRESSURE_OFF = 0.3;
const LAST_ON = 0.8;
const LAST_OFF = 0.75;
/** The pad's sweep: one turn of its lowpass, s. */
const SWEEP_S = 20;
/** A swell of the pad's noise about this often, s. */
const SWELL_EVERY_S: readonly [number, number] = [10, 14];
/** A run's end: the music fades or drains over this long, s. */
const END_S = 1.5;
/** The drain's lowpass, open until a run is lost. */
const OPEN_HZ = 20000;
/** The arpeggio, A minor: A4 C5 E5 C5, one note every other beat; doubled an octave up between. */
const ARPEGGIO = [440, 523.25, 659.25, 523.25] as const;

/** Whether each layer is in: the calm pad, the pressure layer, the last minute's. */
export interface Layers {
  readonly calm: boolean;
  readonly pressure: boolean;
  readonly last: boolean;
}

/** The pulse's beat: where it started on the audio clock, and its tempo. */
export interface Grid {
  readonly origin: number;
  readonly bpm: number;
}

/**
 * The clock's tension, the lab's curve since its first ambience: 0 while half the time or more
 * is left, then rising to 1 as `left` (s) runs out of the mission's `budget` (s).
 */
export function clockTension(left: number, budget: number): number {
  return Math.min(1, Math.max(0, 1 - left / (Math.max(1, budget) * 0.5)));
}

/**
 * The pressure, 0 to 1: the clock's tension — at least ESCAPE_FLOOR and rising to 1 in the last
 * minute — at least ESCAPE_FLOOR in the escape, and ALARM_PUSH more for each of the `alarms`
 * that came in the last ALARM_HOLD_MS.
 */
export function pressureOf(input: {
  left: number;
  budget: number;
  alarms: number;
  escaping: boolean;
}): number {
  const { left, budget, alarms, escaping } = input;
  const run = 1 - Math.max(0, left) / LAST_MINUTE_S;
  const lastMinute = left < LAST_MINUTE_S ? ESCAPE_FLOOR + (1 - ESCAPE_FLOOR) * run : 0;
  const floor = Math.max(clockTension(left, budget), lastMinute, escaping ? ESCAPE_FLOOR : 0);
  return Math.min(1, floor + ALARM_PUSH * alarms);
}

/**
 * Which layers are in at `pressure`, from those that were (`was`): each comes in at its
 * threshold and only goes a little under it, so that the pressure wavering never flips it; the
 * siren (`siren`) takes the calm pad away.
 */
export function layersFor(pressure: number, siren: boolean, was: Layers): Layers {
  return {
    calm: !siren,
    pressure: pressure >= (was.pressure ? PRESSURE_OFF : PRESSURE_ON),
    last: pressure >= (was.last ? LAST_OFF : LAST_ON),
  };
}

/** The heartbeat's tempo with `left` s on the clock: 70 bpm from a minute on, 120 at 0. */
export function heartBpm(left: number): number {
  const run = 1 - Math.min(1, Math.max(0, left) / LAST_MINUTE_S);
  return HEART_FROM_BPM + (HEART_TO_BPM - HEART_FROM_BPM) * run;
}

/** The first beat of `grid` at or after the audio time `t`. */
export function nextBeat(t: number, grid: Grid): number {
  const beat = 60 / grid.bpm;
  return grid.origin + Math.max(0, Math.ceil((t - grid.origin) / beat - 1e-9)) * beat;
}

/** How many beats a crossfade at `bpm` lasts: as few as reach CROSSFADE_MIN_S. */
export function crossfadeBeats(bpm: number): number {
  return Math.ceil((CROSSFADE_MIN_S * bpm) / 60 - 1e-9);
}

/** The music's input, once a frame (GameWorld.tsx). */
export interface Tension {
  /** the run, by its start: a new run starts the music over */
  readonly run: number | null;
  /** from when the music may play, epoch ms: 2 s after the click; null while the power is on */
  readonly startAt: number | null;
  /** seconds left on the clock; Infinity without one */
  readonly left: number;
  /** the seconds the mission gives */
  readonly budget: number;
  /** the run's alarms so far */
  readonly alarms: number;
  /** the hatch stands open: the siren sounds */
  readonly escaping: boolean;
  /** how the run ended, once it has */
  readonly ending: 'won' | 'lost' | null;
}

// --- the runtime -------------------------------------------------------------------------

type Bus = 'calm' | 'pulse' | 'arp' | 'double' | 'heart';
const BUSES: readonly Bus[] = ['calm', 'pulse', 'arp', 'double', 'heart'];

/** How loud each bus plays with `layers` in: the siren keeps only the pulse and the heart. */
function busLevels(layers: Layers, siren: boolean): Record<Bus, number> {
  return {
    calm: layers.calm ? 1 : 0,
    pulse: layers.pressure ? 1 : 0,
    arp: layers.pressure && !siren ? 1 : 0,
    double: layers.last && !siren ? 1 : 0,
    heart: layers.last ? 1 : 0,
  };
}

interface Music {
  readonly run: number | null;
  readonly engine: Engine;
  /** the music's level, MUSIC_LEVEL, and how it ends */
  readonly out: GainNode;
  outFade: Fade;
  /** the drain's lowpass */
  readonly drain: BiquadFilterNode;
  readonly buses: Record<Bus, { readonly node: GainNode; fade: Fade }>;
  /** the pad's sines and the sweep of its filter: they run for good */
  readonly pad: OscillatorNode[];
  grid: Grid;
  layers: Layers;
  siren: boolean;
  pressure: number;
  left: number;
  /** the run's alarms counted so far, and when the recent ones came in, epoch ms */
  alarms: number;
  readonly alarmsAt: number[];
  /** the next unscheduled beat and its count, the next heartbeat and the next swell */
  next: { beat: number; count: number; heart: number; swell: number };
  readonly timer: ReturnType<typeof setInterval>;
  ended: boolean;
}

/** How often the notes are looked ahead for, ms, and how far ahead, s. */
const TICK_MS = 100;
const AHEAD_S = 0.3;
const NO_LAYERS: Layers = { calm: false, pressure: false, last: false };

let music: Music | null = null;

/**
 * The music follows the run: starts once `startAt` has come, moves its layers with the pressure,
 * ends with the run. Safe to call every frame; only a real change schedules anything.
 */
export function setTension(input: Tension): void {
  try {
    if (music !== null && music.run !== input.run) stopMusic();
    if (music === null) {
      if (input.startAt === null || input.ending !== null) return;
      music = startMusic(input, input.startAt);
      if (music === null) return;
    }
    if (music.ended) return;
    if (input.ending !== null) {
      endMusic(music, input.ending);
      return;
    }
    follow(music, input);
  } catch {
    // Deliberately silent: the music is flavour, never required.
  }
}

/**
 * The music for the input's run, starting at the epoch time `startAt` (or now, where that has
 * passed). The run's alarms so far came before it: they push nothing.
 */
function startMusic(input: Tension, startAt: number): Music | null {
  const engine = audioEngine();
  if (engine === null) return null;
  const { ctx } = engine;
  const at = ctx.currentTime + LOOKAHEAD + Math.max(0, (startAt - Date.now()) / 1000);
  const out = outlet(ctx, engine.duck, MUSIC_LEVEL);
  const drain = biquad(ctx, 'lowpass', OPEN_HZ, 0);
  drain.connect(out);
  const bus = (): { node: GainNode; fade: Fade } => ({
    node: outlet(ctx, drain, 0),
    fade: still(0),
  });
  const buses = { calm: bus(), pulse: bus(), arp: bus(), double: bus(), heart: bus() };
  const pad = startPad(ctx, buses.calm.node, at);
  const next = { beat: at, count: 0, heart: at, swell: at + rand(2, SWELL_EVERY_S[0]) };
  const made: Music = {
    run: input.run,
    engine,
    out,
    outFade: still(MUSIC_LEVEL),
    drain,
    buses,
    pad,
    grid: { origin: at, bpm: PULSE_BPM },
    layers: NO_LAYERS,
    siren: false,
    pressure: 0,
    left: Infinity,
    alarms: input.alarms,
    alarmsAt: [],
    next,
    timer: setInterval(() => scheduleNotes(made), TICK_MS),
    ended: false,
  };
  return made;
}

/** The pad: two sines a hair apart beating slowly, through a lowpass sweeping over SWEEP_S. */
function startPad(ctx: BaseAudioContext, dest: AudioNode, at: number): OscillatorNode[] {
  const lowpass = biquad(ctx, 'lowpass', 420, 6);
  lowpass.connect(dest);
  const sines = [220, 221].map((frequency) => {
    const osc = ctx.createOscillator();
    osc.frequency.value = frequency;
    chain(osc, gain(ctx, 0.45), lowpass);
    return osc;
  });
  const sweep = ctx.createOscillator();
  sweep.frequency.value = 1 / SWEEP_S;
  // The cutoff wanders from about 150 Hz up to about 690 Hz and back.
  modulate(ctx, sweep, 270, lowpass.frequency);
  const all = [...sines, sweep];
  for (const osc of all) osc.start(at);
  return all;
}

/** The music takes in this frame's input: the alarms, the clock, the escape — and its layers. */
function follow(m: Music, input: Tension): void {
  const now = Date.now();
  for (; m.alarms < input.alarms; m.alarms++) m.alarmsAt.push(now);
  while ((m.alarmsAt[0] ?? now) <= now - ALARM_HOLD_MS) m.alarmsAt.shift();
  m.left = input.left;
  m.pressure = pressureOf({ ...input, alarms: m.alarmsAt.length });
  const layers = layersFor(m.pressure, input.escaping, m.layers);
  const was = m.layers;
  const changed =
    layers.calm !== was.calm || layers.pressure !== was.pressure || layers.last !== was.last;
  if (changed || input.escaping !== m.siren) {
    retarget(m, layers, input.escaping);
  }
}

/**
 * The layers move to `layers` on the next beat, over whole beats and CROSSFADE_MIN_S at least;
 * where the last minute comes or goes, the beat changes its tempo there.
 */
function retarget(m: Music, layers: Layers, siren: boolean): void {
  const now = m.engine.ctx.currentTime;
  const start = nextBeat(now + LOOKAHEAD, m.grid);
  if (layers.last !== m.layers.last) {
    const bpm = layers.last ? LAST_BPM : PULSE_BPM;
    // The beat at `start` may be scheduled already; the new tempo then goes on after it.
    m.next.beat = m.next.beat > start + 1e-6 ? start + 60 / bpm : start;
    m.grid = { origin: start, bpm };
  }
  const beats = crossfadeBeats(m.grid.bpm);
  const end = start + (beats * 60) / m.grid.bpm;
  const levels = busLevels(layers, siren);
  for (const name of BUSES) {
    const bus = m.buses[name];
    if (bus.fade.to !== levels[name]) {
      bus.fade = fadeTo(bus.node.gain, bus.fade, now, [start, end], levels[name]);
    }
  }
  m.layers = layers;
  m.siren = siren;
}

/** Whether a bus is up or coming up at audio time `t`: only then are its notes made. */
function heard(m: Music, bus: Bus, t: number): boolean {
  const { fade } = m.buses[bus];
  return fade.to > 0 || levelAt(fade, t) > 0.001;
}

/**
 * The timer's round: the beats, the heartbeats and the swells due before now + AHEAD_S. One
 * that fell behind — the page in the background, its timer held back — passes unplayed, so
 * that nothing comes out in a burst.
 */
function scheduleNotes(m: Music): void {
  try {
    const { ctx } = m.engine;
    if (m.ended || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const until = now + AHEAD_S;
    for (; m.next.beat < until; m.next.count++) {
      if (m.next.beat >= now) onTheBeat(m, m.next.beat, m.next.count);
      m.next.beat += 60 / m.grid.bpm;
    }
    for (; m.next.heart < until; m.next.heart += 60 / heartBpm(m.left)) {
      if (m.next.heart >= now && heard(m, 'heart', m.next.heart)) {
        heartbeat(ctx, m.buses.heart.node, m.next.heart, m.left);
      }
    }
    for (; m.next.swell < until; m.next.swell += rand(...SWELL_EVERY_S)) {
      if (m.next.swell >= now && heard(m, 'calm', m.next.swell)) {
        swell(ctx, m.buses.calm.node, m.next.swell);
      }
    }
  } catch {
    // Deliberately silent: only this round's notes are lost.
  }
}

/** One beat: the pulse, and every other beat the arpeggio's note — doubled on those between. */
function onTheBeat(m: Music, at: number, count: number): void {
  const { ctx } = m.engine;
  if (heard(m, 'pulse', at)) bassNote(ctx, m.buses.pulse.node, at);
  const note = ARPEGGIO[Math.floor(count / 2) % ARPEGGIO.length] ?? ARPEGGIO[0];
  if (count % 2 === 0 && heard(m, 'arp', at)) pluck(ctx, m.buses.arp.node, at, note, 0.35);
  if (count % 2 === 1 && heard(m, 'double', at)) pluck(ctx, m.buses.double.node, at, note * 2, 0.2);
}

/**
 * The muted bass: A1 as a triangle with its octave, through a lowpass at 380 Hz — the octave
 * and the triangle's overtones carry it on a laptop's speaker.
 */
function bassNote(ctx: BaseAudioContext, dest: AudioNode, at: number): void {
  const muted = biquad(ctx, 'lowpass', 380, 0);
  muted.connect(dest);
  const envelope = { attack: 0.006, hold: 0.05, decay: 0.3 } as const;
  const notes = [
    tone(ctx, muted, { type: 'triangle', at, from: 55, to: 55, peak: 0.8, ...envelope }),
    tone(ctx, muted, { type: 'sine', at, from: 110, to: 110, peak: 0.4, ...envelope }),
  ];
  onAllEnded(notes, () => muted.disconnect());
}

/** A plucked note of the arpeggio: a triangle dying away over ~0.7 s. */
function pluck(ctx: BaseAudioContext, dest: AudioNode, at: number, hz: number, peak: number): void {
  const envelope = { attack: 0.01, hold: 0.05, decay: 0.7 } as const;
  tone(ctx, dest, { type: 'triangle', at, from: hz, to: hz, peak, ...envelope });
}

/**
 * The heartbeat: two thumps, the second softer, closer together as it quickens; each with its
 * mid layer, so that a phone's speaker has something of it too.
 */
function heartbeat(ctx: BaseAudioContext, dest: AudioNode, at: number, left: number): void {
  const gap = Math.min(0.28, (60 / heartBpm(left)) * 0.35);
  const envelope = { attack: 0.004, hold: 0.02, decay: 0.16 } as const;
  for (const [when, peak] of [
    [at, 1],
    [at + gap, 0.7],
  ] as const) {
    tone(ctx, dest, { type: 'sine', at: when, from: 62, to: 38, peak, ...envelope });
    midKnock(ctx, dest, when, 0.08, 0.35 * peak);
  }
}

/** The pad's breath: noise in a soft band swelling over ~3 s and fading over ~4 s. */
function swell(ctx: BaseAudioContext, dest: AudioNode, at: number): void {
  const length = 8;
  const air = noiseBurst(ctx, at, length);
  const level = gain(ctx, 0);
  level.gain.setValueAtTime(0, at);
  level.gain.linearRampToValueAtTime(0.25, at + 3);
  level.gain.setValueAtTime(0.25, at + 4);
  level.gain.linearRampToValueAtTime(0, at + length);
  chain(air, biquad(ctx, 'bandpass', 520, 1.2), level, dest);
}

/**
 * The run is over: won, the music fades out before the end screen's chord; lost, it drains —
 * its lowpass closing and the pad sagging — as the power does. Then it stops.
 */
function endMusic(m: Music, ending: 'won' | 'lost'): void {
  m.ended = true;
  clearInterval(m.timer);
  const now = m.engine.ctx.currentTime;
  const end = now + END_S;
  m.outFade = fadeTo(m.out.gain, m.outFade, now, [now, end], 0);
  if (ending === 'lost') {
    m.drain.frequency.setValueAtTime(OPEN_HZ, now);
    m.drain.frequency.exponentialRampToValueAtTime(120, end);
    for (const osc of m.pad.slice(0, 2)) {
      const frequency = osc.frequency.value;
      osc.frequency.setValueAtTime(frequency, now);
      osc.frequency.exponentialRampToValueAtTime(frequency * 0.5, end);
    }
  }
  for (const osc of m.pad) osc.stop(end + 0.05);
  onAllEnded(m.pad, () => m.out.disconnect());
}

/** Stops the music at once (a fade of 0.3 s): the world is gone, or another run begins. */
export function stopMusic(): void {
  try {
    const m = music;
    music = null;
    if (m === null) return;
    clearInterval(m.timer);
    m.ended = true;
    const now = m.engine.ctx.currentTime;
    m.outFade = fadeTo(m.out.gain, m.outFade, now, [now, now + 0.3], 0);
    for (const osc of m.pad) osc.stop(now + 0.35);
    onAllEnded(m.pad, () => m.out.disconnect());
  } catch {
    // Deliberately silent: the music's nodes are released with the context at the latest.
  }
}

/** The music now: each layer's level, 0 to 1 — pad, pulse, heartbeat — and the pressure. */
export interface MusicProbe {
  calm: number;
  pressure: number;
  last: number;
  /** the pressure value the layers follow */
  level: number;
}

export function musicProbe(): MusicProbe {
  const m = music;
  if (m === null) return { calm: 0, pressure: 0, last: 0, level: 0 };
  const now = m.engine.ctx.currentTime;
  const at = (bus: Bus): number => levelAt(m.buses[bus].fade, now);
  return { calm: at('calm'), pressure: at('pulse'), last: at('heart'), level: m.pressure };
}

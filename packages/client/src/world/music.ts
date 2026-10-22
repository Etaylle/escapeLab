import {
  audioEngine,
  biquad,
  chain,
  claim,
  EFFECTS_LEVEL,
  fadeTo,
  gain,
  levelAt,
  LOOKAHEAD,
  loopOf,
  midKnock,
  noiseBuffer,
  noiseLoop,
  outlet,
  playLoop,
  playSample,
  rand,
  release,
  sampleOf,
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
 * chord, a run lost drains it with the power. `setTension` is its one input, ten times a
 * second: each call schedules the notes ahead on the audio clock. The pad is a loop rendered
 * once, playing only while its layer is heard; every note is a sample rendered once and played
 * as a single source within the budget of audio.ts (`CAPS`), unwired as it ends. Pure up to
 * `setTension`.
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
/** The pad's sweep: one turn of its lowpass, s, moved on in steps this long. */
const SWEEP_S = 20;
const SWEEP_STEP_S = 0.25;
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

/** The music's input, ten times a second (GameWorld.tsx). */
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
  /** the pad's loop while the calm layer is heard — a loop of the budget — and its lowpass */
  pad: AudioBufferSourceNode | null;
  readonly padFilter: BiquadFilterNode;
  /** when the music started, audio time: the pad's sweep turns from there */
  readonly origin: number;
  /** the next unscheduled step of the pad's sweep, audio time */
  sweepAt: number;
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
  ended: boolean;
}

/** How far ahead the notes are scheduled, s: past the next call, a tenth of a second on. */
const AHEAD_S = 0.3;
const NO_LAYERS: Layers = { calm: false, pressure: false, last: false };

let music: Music | null = null;

/**
 * The music follows the run: starts once `startAt` has come, moves its layers with the pressure,
 * schedules what is due, ends with the run. Called ten times a second; only a real change
 * moves a layer.
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
    scheduleNotes(music);
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
  const padFilter = biquad(ctx, 'lowpass', sweepHz(0), 6);
  padFilter.connect(buses.calm.node);
  noiseBuffer(ctx); // the shared noise at the live rate, before a sample is rendered from it
  prepareSamples(engine);
  return {
    run: input.run,
    engine,
    out,
    outFade: still(MUSIC_LEVEL),
    drain,
    buses,
    pad: null,
    padFilter,
    origin: at,
    sweepAt: at,
    grid: { origin: at, bpm: PULSE_BPM },
    layers: NO_LAYERS,
    siren: false,
    pressure: 0,
    left: Infinity,
    alarms: input.alarms,
    alarmsAt: [],
    next: { beat: at, count: 0, heart: at, swell: at + rand(2, SWELL_EVERY_S[0]) },
    ended: false,
  };
}

/** The pad's lowpass `t` s into the music: from about 150 Hz up to about 690 Hz and back. */
export function sweepHz(t: number): number {
  return 420 + 270 * Math.sin((2 * Math.PI * t) / SWEEP_S);
}

/** The pad's two sines a hertz apart: they beat once in its loop of a second. */
function sines(ctx: BaseAudioContext, dest: AudioNode): void {
  for (const frequency of [220, 221]) {
    const osc = ctx.createOscillator();
    osc.frequency.value = frequency;
    chain(osc, gain(ctx, 0.45), dest);
    osc.start(0);
  }
}

/** The pad's loop, rendered once at half the live rate; null while it renders. */
function padLoopOf(engine: Engine): AudioBuffer | null {
  return loopOf('music/pad', sines, 1, engine.ctx.sampleRate / 2);
}

/** The music takes in this call's input: the alarms, the clock, the escape — and its layers. */
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
 * The pad plays while its layer is heard and stops once that has faded out — a stopped loop
 * costs the audio thread nothing — and its lowpass steps along its sweep.
 */
function tendPad(m: Music, now: number): void {
  const calm = m.buses.calm.fade;
  if (calm.to > 0 && m.pad === null) {
    const loop = padLoopOf(m.engine);
    if (loop !== null && claim({ loop: 1 })) {
      m.pad = playLoop(m.engine.ctx, loop, m.padFilter, Math.max(now + LOOKAHEAD, m.origin));
      m.pad.onended = () => release({ loop: 1 });
    }
  } else if (calm.to === 0 && now >= calm.end && m.pad !== null) {
    m.pad.stop(now + 0.05);
    m.pad = null;
  }
  for (; m.sweepAt < now + AHEAD_S; m.sweepAt += SWEEP_STEP_S) {
    m.padFilter.frequency.setValueAtTime(sweepHz(m.sweepAt - m.origin), m.sweepAt);
  }
}

/**
 * The beats, the heartbeats and the swells due before now + AHEAD_S, and the pad. One that fell
 * behind — the page in the background, its timer held back — passes unplayed, so that nothing
 * comes out in a burst.
 */
function scheduleNotes(m: Music): void {
  const { ctx } = m.engine;
  if (ctx.state !== 'running') return;
  const now = ctx.currentTime;
  const until = now + AHEAD_S;
  tendPad(m, now);
  for (; m.next.beat < until; m.next.count++) {
    if (m.next.beat >= now) onTheBeat(m, m.next.beat, m.next.count);
    m.next.beat += 60 / m.grid.bpm;
  }
  for (; m.next.heart < until; m.next.heart += 60 / heartBpm(m.left)) {
    if (m.next.heart >= now && heard(m, 'heart', m.next.heart)) heartbeat(m, m.next.heart);
  }
  for (; m.next.swell < until; m.next.swell += rand(...SWELL_EVERY_S)) {
    if (m.next.swell >= now && heard(m, 'calm', m.next.swell)) {
      // a little faster or slower each time, so that no two breaths sound alike
      playNote(m, 'swell', 'calm', m.next.swell, rand(0.95, 1.05));
    }
  }
}

/** One beat: the pulse, and every other beat the arpeggio's note — doubled on those between. */
function onTheBeat(m: Music, at: number, count: number): void {
  if (heard(m, 'pulse', at)) playNote(m, 'bass', 'pulse', at);
  const note = ARPEGGIO[Math.floor(count / 2) % ARPEGGIO.length] ?? ARPEGGIO[0];
  if (count % 2 === 0 && heard(m, 'arp', at)) playNote(m, `arp ${note}`, 'arp', at);
  if (count % 2 === 1 && heard(m, 'double', at)) playNote(m, `double ${note}`, 'double', at);
}

type SampleBuild = (ctx: BaseAudioContext, dest: AudioNode) => void;

/** A heartbeat's thump at `peak`: a low sine falling, and its mid layer. */
function thump(ctx: BaseAudioContext, dest: AudioNode, peak: number): void {
  const envelope = { at: 0, attack: 0.004, hold: 0.02, decay: 0.16 } as const;
  tone(ctx, dest, { type: 'sine', from: 62, to: 38, peak, ...envelope });
  midKnock(ctx, dest, 0, 0.08, 0.35 * peak);
}

/** A plucked note of the arpeggio at `hz`: a triangle dying away over ~0.7 s. */
function pluck(hz: number, peak: number): SampleBuild {
  const envelope = { at: 0, attack: 0.01, hold: 0.05, decay: 0.7 } as const;
  return (ctx, dest) => {
    tone(ctx, dest, { type: 'triangle', from: hz, to: hz, peak, ...envelope });
  };
}

/** The muted bass: A1 as a triangle with its octave, through a lowpass at 380 Hz. */
function bass(ctx: BaseAudioContext, dest: AudioNode): void {
  const muted = biquad(ctx, 'lowpass', 380, 0);
  muted.connect(dest);
  const envelope = { at: 0, attack: 0.006, hold: 0.05, decay: 0.3 } as const;
  tone(ctx, muted, { type: 'triangle', from: 55, to: 55, peak: 0.8, ...envelope });
  tone(ctx, muted, { type: 'sine', from: 110, to: 110, peak: 0.4, ...envelope });
}

/**
 * The pad's breath: noise in a soft band swelling over ~3 s and fading over ~4 s — the shared
 * noise looped, as its two seconds are shorter than the breath.
 */
function breath(ctx: BaseAudioContext, dest: AudioNode): void {
  const air = noiseLoop(ctx, 0);
  air.stop(8);
  const level = gain(ctx, 0);
  level.gain.setValueAtTime(0, 0);
  level.gain.linearRampToValueAtTime(0.25, 3);
  level.gain.setValueAtTime(0.25, 4);
  level.gain.linearRampToValueAtTime(0, 8);
  chain(air, biquad(ctx, 'bandpass', 520, 1.2), level, dest);
}

/**
 * The music's notes as samples, each rendered once (audio.ts `sampleOf`) at half the live rate
 * and played as one source a note: [seconds, how it is made] by name. The bass's octave and
 * overtones and the heartbeat's mid layer carry them on a laptop's or a phone's speaker.
 */
const SAMPLES: Readonly<Record<string, readonly [number, SampleBuild]>> = {
  bass: [0.4, bass],
  lub: [0.2, (ctx, dest) => thump(ctx, dest, 1)],
  dub: [0.2, (ctx, dest) => thump(ctx, dest, 0.7)],
  swell: [8, breath],
  ...Object.fromEntries(
    ARPEGGIO.flatMap((hz) => [
      [`arp ${hz}`, [0.8, pluck(hz, 0.35)]],
      [`double ${hz}`, [0.8, pluck(hz * 2, 0.2)]],
    ]),
  ),
};

/** The music's sample `name`; null while it renders. */
function sampleNamed(engine: Engine, name: string): AudioBuffer | null {
  const recipe = SAMPLES[name];
  if (recipe === undefined) return null;
  return sampleOf(`music/${name}`, recipe[1], recipe[0], engine.ctx.sampleRate / 2);
}

/** Sets every sample of the music rendering as it starts: they are ready by its first notes. */
function prepareSamples(engine: Engine): void {
  for (const name of Object.keys(SAMPLES)) sampleNamed(engine, name);
}

/** The music's sample `name` played once into `bus` from `at`, `speed` times as fast. */
function playNote(m: Music, name: string, bus: Bus, at: number, speed = 1): void {
  playSample(m.engine.ctx, sampleNamed(m.engine, name), m.buses[bus].node, at, speed);
}

/** The heartbeat: two thumps, the second softer, closer together as it quickens. */
function heartbeat(m: Music, at: number): void {
  const gap = Math.min(0.28, (60 / heartBpm(m.left)) * 0.35);
  playNote(m, 'lub', 'heart', at);
  playNote(m, 'dub', 'heart', at + gap);
}

/**
 * The run is over: won, the music fades out before the end screen's chord; lost, it drains —
 * its lowpass closing and the pad slowing — as the power does. Then it stops.
 */
function endMusic(m: Music, ending: 'won' | 'lost'): void {
  m.ended = true;
  const now = m.engine.ctx.currentTime;
  const end = now + END_S;
  m.outFade = fadeTo(m.out.gain, m.outFade, now, [now, end], 0);
  if (ending === 'lost') {
    m.drain.frequency.setValueAtTime(OPEN_HZ, now);
    m.drain.frequency.exponentialRampToValueAtTime(120, end);
    m.pad?.playbackRate.setValueAtTime(1, now);
    m.pad?.playbackRate.exponentialRampToValueAtTime(0.5, end);
  }
  letGo(m, end + 0.05);
}

/** Stops the pad at `at` and lets the music's nodes go then. */
function letGo(m: Music, at: number): void {
  const pad = m.pad;
  m.pad = null;
  pad?.stop(at);
  const wait = Math.max(0, (at - m.engine.ctx.currentTime) * 1000);
  setTimeout(() => m.out.disconnect(), wait);
}

/** Stops the music at once (a fade of 0.3 s): the world is gone, or another run begins. */
export function stopMusic(): void {
  try {
    const m = music;
    music = null;
    if (m === null) return;
    m.ended = true;
    const now = m.engine.ctx.currentTime;
    m.outFade = fadeTo(m.out.gain, m.outFade, now, [now, now + 0.3], 0);
    letGo(m, now + 0.35);
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

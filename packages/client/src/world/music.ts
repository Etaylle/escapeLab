import {
  audioEngine,
  biquad,
  claim,
  EFFECTS_LEVEL,
  fadeTo,
  levelAt,
  LOOKAHEAD,
  outlet,
  playingEngine,
  release,
  startSample,
  still,
  type Engine,
  type Fade,
} from './audio.js';
import { sample, type Sample } from './samples.js';

/**
 * Music that breathes: three recorded stems (samples.ts: Eleven Music composed them, all three
 * in A minor at 90 bpm, so that one blends into the next), between which one pressure value,
 * 0 to 1, crossfades —
 *
 *   calm      an uneasy pad over a low drone, sparse piano, no drums;
 *   tense     from 0.35: a bass pulse on every beat, a sparse arpeggio, low strings;
 *   critical  from 0.8: pounding drums, fast hats, a string ostinato in double time.
 *
 * The pressure follows the clock (the tension curve the lab always had: nothing in the first
 * half, then rising to 1 as it runs out — and at least 0.8 in the last minute), every alarm
 * (+0.15 for 20 s) and the escape (at least 0.8). A stem comes in or goes on the beat, over
 * whole beats and at least 2 s. No music while the lab has its power: it starts under the
 * blackout 2 s after the click. A stem plays round and round: each next pass comes in over the
 * last SEAM_S of the one before, equal in power, two sources taking turns on the audio clock;
 * while it is heard it takes one loop of the budget of audio.ts (`CAPS`), and it stops once it
 * has faded out. A run won fades the music out before the end card's sting (`playSting`); a run
 * lost drains it, its lowpass closing and the stem slowing, with the power. `setTension` is
 * its one input, ten times a second: each call schedules what is due ahead on the audio clock.
 * Pure up to `setTension`.
 */

/** A stem's loudness and a sting's, after the gain of each (scripts/sfx.ts), RMS. */
const STEM_RMS = 10 ** (-20 / 20);
const STING_RMS = 10 ** (-14 / 20);
/**
 * The music at full: a stem's RMS 26 dB under the effects' level (audio.ts EFFECTS_LEVEL) at
 * the master gain — about where the synthesised pad before it sat.
 */
export const MUSIC_LEVEL = (EFFECTS_LEVEL * 10 ** (-26 / 20)) / STEM_RMS;
/** The end card's sting: its RMS 8 dB under the effects' level, the music gone by then. */
export const STING_LEVEL = (EFFECTS_LEVEL * 10 ** (-8 / 20)) / STING_RMS;
/** The music starts this long after the click of the blackout, ms (coldOpen.ts REVEAL_MS). */
export const MUSIC_AFTER_CLICK_MS = 2000;
/** The stems' tempo, as their prompts name it: the beat a crossfade starts on. */
export const MUSIC_BPM = 90;
/** The last minute, s. */
export const LAST_MINUTE_S = 60;
/** What an alarm adds to the pressure, and for how long, ms. */
export const ALARM_PUSH = 0.15;
export const ALARM_HOLD_MS = 20_000;
/** The pressure in the escape, at least; in the last minute, at least as much. */
export const ESCAPE_FLOOR = 0.8;
/** A crossfade lasts whole beats, at least this long, s. */
export const CROSSFADE_MIN_S = 2;
/** The next pass of a stem comes in over this long at the end of the one before, s. */
export const SEAM_S = 3;
/** The tense stem comes in at PRESSURE_ON and goes below PRESSURE_OFF; the critical as well. */
const PRESSURE_ON = 0.35;
const PRESSURE_OFF = 0.3;
const LAST_ON = 0.8;
const LAST_OFF = 0.75;
/** A run's end: the music fades or drains over this long, s. */
const END_S = 1.5;
/** The drain's lowpass, open until a run is lost. */
const OPEN_HZ = 20000;

/** The three stems, quietest first. */
export const STEMS = ['calm', 'tense', 'critical'] as const;
export type Stem = (typeof STEMS)[number];

/** Whether each layer is in: the calm, the pressure, the last minute's. */
export interface Layers {
  readonly calm: boolean;
  readonly pressure: boolean;
  readonly last: boolean;
}

/** The beat: where it started on the audio clock, and its tempo. */
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
 * siren (`siren`) takes the calm away.
 */
export function layersFor(pressure: number, siren: boolean, was: Layers): Layers {
  return {
    calm: !siren,
    pressure: pressure >= (was.pressure ? PRESSURE_OFF : PRESSURE_ON),
    last: pressure >= (was.last ? LAST_OFF : LAST_ON),
  };
}

/** The stem that plays with `layers` in: the last minute's critical, the pressure's tense, calm. */
export function stemFor(layers: Layers): Stem {
  if (layers.last) return 'critical';
  return layers.pressure ? 'tense' : 'calm';
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

/** One pass of a stem: its source, the stage it fades in and out through, and when it starts. */
interface Pass {
  readonly source: AudioBufferSourceNode;
  readonly seam: GainNode;
  readonly start: number;
}

/**
 * A stem: its bus, how loud the pressure has it, its passes — the one playing and the one it
 * fades out under — and when the next pass starts; `next` is null while the stem is silent and
 * holds no loop of the budget.
 */
interface Track {
  readonly bus: GainNode;
  fade: Fade;
  passes: readonly Pass[];
  next: number | null;
}

interface Music {
  readonly run: number | null;
  readonly engine: Engine;
  /** the music's level, MUSIC_LEVEL, and how it ends */
  readonly out: GainNode;
  outFade: Fade;
  /** the drain's lowpass */
  readonly drain: BiquadFilterNode;
  readonly tracks: Record<Stem, Track>;
  readonly grid: Grid;
  layers: Layers;
  siren: boolean;
  pressure: number;
  /** the run's alarms counted so far, and when the recent ones came in, epoch ms */
  alarms: number;
  readonly alarmsAt: number[];
  ended: boolean;
}

/** How far ahead the passes are scheduled, s: past the next call, a tenth of a second on. */
const AHEAD_S = 0.3;
const NO_LAYERS: Layers = { calm: false, pressure: false, last: false };
/** The seam's curves: in, a quarter sine, and out, its mirror — equal in power throughout. */
const SEAM_POINTS = 32;
const SEAM_IN = Float32Array.from({ length: SEAM_POINTS }, (_, i) =>
  Math.sin((Math.PI / 2) * (i / (SEAM_POINTS - 1))),
);
const SEAM_OUT = Float32Array.from(SEAM_IN).reverse();

let music: Music | null = null;

/**
 * The music follows the run: starts once `startAt` has come, moves its stems with the pressure,
 * schedules what is due, ends with the run. Called ten times a second; only a real change
 * moves a stem.
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
    if (music.engine.ctx.state === 'running') {
      for (const stem of STEMS) tendTrack(music.engine, music.tracks[stem], stem);
    }
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
  const out = outlet(ctx, engine.music, MUSIC_LEVEL);
  const drain = biquad(ctx, 'lowpass', OPEN_HZ, 0);
  drain.connect(out);
  const track = (): Track => ({
    bus: outlet(ctx, drain, 0),
    fade: still(0),
    passes: [],
    next: null,
  });
  return {
    run: input.run,
    engine,
    out,
    outFade: still(MUSIC_LEVEL),
    drain,
    tracks: { calm: track(), tense: track(), critical: track() },
    grid: { origin: at, bpm: MUSIC_BPM },
    layers: NO_LAYERS,
    siren: false,
    pressure: 0,
    alarms: input.alarms,
    alarmsAt: [],
    ended: false,
  };
}

/** The music takes in this call's input: the alarms, the clock, the escape — and its layers. */
function follow(m: Music, input: Tension): void {
  const now = Date.now();
  for (; m.alarms < input.alarms; m.alarms++) m.alarmsAt.push(now);
  while ((m.alarmsAt[0] ?? now) <= now - ALARM_HOLD_MS) m.alarmsAt.shift();
  m.pressure = pressureOf({ ...input, alarms: m.alarmsAt.length });
  const layers = layersFor(m.pressure, input.escaping, m.layers);
  const was = m.layers;
  const changed =
    layers.calm !== was.calm || layers.pressure !== was.pressure || layers.last !== was.last;
  if (changed || input.escaping !== m.siren) {
    retarget(m, layers, input.escaping);
  }
}

/** The stems move to what `layers` plays: from the next beat, over whole beats, 2 s or more. */
function retarget(m: Music, layers: Layers, siren: boolean): void {
  const now = m.engine.ctx.currentTime;
  const start = nextBeat(now + LOOKAHEAD, m.grid);
  const end = start + (crossfadeBeats(m.grid.bpm) * 60) / m.grid.bpm;
  const playing = stemFor(layers);
  for (const stem of STEMS) {
    const track = m.tracks[stem];
    const to = stem === playing ? 1 : 0;
    if (track.fade.to !== to) {
      track.fade = fadeTo(track.bus.gain, track.fade, now, [start, end], to);
    }
  }
  m.layers = layers;
  m.siren = siren;
}

/** How long a stem's pass sounds, s: its recording from where its sound starts. */
function passLength(recording: Sample): number {
  return recording.buffer.duration - recording.start;
}

/**
 * A stem as its fade has it: while it is heard its passes go on — the first as its fade comes
 * in, once its recording is loaded and the budget has a loop for it, else tried again next
 * round — and once it has faded out it stops and gives its loop back.
 */
function tendTrack(engine: Engine, track: Track, stem: Stem): void {
  const now = engine.ctx.currentTime;
  const heard = track.fade.to > 0 || levelAt(track.fade, now) > 0.001;
  if (!heard) {
    silence(track, now + 0.05);
    return;
  }
  const recording = sample(stem);
  if (recording === null || passLength(recording) <= 2 * SEAM_S) return;
  if (track.next === null) {
    if (!claim({ loop: 1 })) return;
    track.next = Math.max(now + LOOKAHEAD, track.fade.start);
  }
  for (; track.next < now + AHEAD_S; track.next += passLength(recording) - SEAM_S) {
    startPass(engine.ctx, recording, track, track.next);
  }
}

/**
 * The stem's next pass from `at`: where one plays already, the new one comes in over SEAM_S
 * as the old one, at its end, goes out under it, equal in power.
 */
function startPass(ctx: BaseAudioContext, recording: Sample, track: Track, at: number): void {
  const previous = track.passes.at(-1);
  const seam = outlet(ctx, track.bus, previous === undefined ? 1 : 0);
  if (previous !== undefined) {
    seam.gain.setValueCurveAtTime(SEAM_IN, at, SEAM_S);
    previous.seam.gain.setValueCurveAtTime(SEAM_OUT, at, SEAM_S);
    previous.source.stop(at + SEAM_S + 0.05);
  }
  const source = startSample(ctx, recording, seam, at);
  source.onended = () => seam.disconnect();
  const pass = { source, seam, start: at };
  track.passes = previous === undefined ? [pass] : [previous, pass];
}

/** The stem stops at `at` and gives its loop back: faded out, or the music is over. */
function silence(track: Track, at: number): void {
  if (track.next === null) return;
  for (const pass of track.passes) pass.source.stop(at);
  track.passes = [];
  track.next = null;
  release({ loop: 1 });
}

/**
 * The run is over: won, the music fades out before the end card's sting; lost, it drains — its
 * lowpass closing and every pass slowing — as the power does. Then it stops.
 */
function endMusic(m: Music, ending: 'won' | 'lost'): void {
  m.ended = true;
  const now = m.engine.ctx.currentTime;
  const end = now + END_S;
  m.outFade = fadeTo(m.out.gain, m.outFade, now, [now, end], 0);
  if (ending === 'lost') {
    m.drain.frequency.setValueAtTime(OPEN_HZ, now);
    m.drain.frequency.exponentialRampToValueAtTime(120, end);
    for (const stem of STEMS) {
      for (const pass of m.tracks[stem].passes) {
        pass.source.playbackRate.setValueAtTime(1, now);
        pass.source.playbackRate.exponentialRampToValueAtTime(0.5, end);
      }
    }
  }
  letGo(m, end + 0.05);
}

/** Stops every stem at `at` and lets the music's nodes go then. */
function letGo(m: Music, at: number): void {
  for (const stem of STEMS) silence(m.tracks[stem], at);
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

/**
 * The end card's sting for a run won or lost, once, on the music's bus at STING_LEVEL. Nothing
 * while the context is held back, or where its recording is not loaded.
 */
export function playSting(ending: 'won' | 'lost'): void {
  try {
    const engine = playingEngine();
    const sting = sample(ending);
    if (engine === null || sting === null) return;
    const { ctx } = engine;
    const out = outlet(ctx, engine.music, STING_LEVEL);
    const source = startSample(ctx, sting, out, ctx.currentTime + LOOKAHEAD);
    source.onended = () => out.disconnect();
  } catch {
    // Deliberately silent: the card says it as well.
  }
}

/**
 * The music now, 0 to 1: the calm stem's level, the pressure stems' — the tense or the
 * critical — the critical's alone, and the pressure value the stems follow.
 */
export interface MusicProbe {
  calm: number;
  pressure: number;
  last: number;
  level: number;
}

export function musicProbe(): MusicProbe {
  const m = music;
  if (m === null) return { calm: 0, pressure: 0, last: 0, level: 0 };
  const now = m.engine.ctx.currentTime;
  const at = (stem: Stem): number => levelAt(m.tracks[stem].fade, now);
  return {
    calm: at('calm'),
    pressure: Math.min(1, at('tense') + at('critical')),
    last: at('critical'),
    level: m.pressure,
  };
}

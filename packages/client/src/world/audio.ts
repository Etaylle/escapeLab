/**
 * audio.ts: the lab's one audio path, and its sound effects.
 *
 * Everything is synthesised at runtime from oscillators, filters and one shared noise buffer;
 * the only recordings in the game are mission control's lines (radioVoice.ts). All levels are
 * deliberately quiet because this plays under the players' voice chat, and every sound passes
 * through a single master gain, so the whole lab can be muted or scaled in one place. The
 * rooms' beds (ambience.ts) and the music (music.ts) go in through the duck bus in front of
 * it, which mission control's voice pulls down while it speaks. The partners' steps and the
 * drones (spatial.ts) and the voice go straight into the master gain. This module also lends
 * those modules its small builders (gain stages, filters, envelopes, noise).
 *
 * Audio is decorative, so no public function ever throws: errors are swallowed on purpose.
 * The one shared AudioContext is created lazily on first use. While browser autoplay policy
 * keeps it suspended, one-shot effects are skipped (so they cannot queue up and all fire at
 * once later) and the next user gesture resumes it. Loops started while suspended — the
 * beds, the music, a drone's buzz — are built anyway and become audible once it resumes.
 */

import { censusOf, countGraph, type GraphCensus } from './audioCount.js';
import { traceRequested } from './frameTrace.js';

type AudioContextCtor = new () => AudioContext;

/** The shared context and the two gain stages every sound of the lab ends in. */
export interface Engine {
  readonly ctx: AudioContext;
  /** Every sound in the module passes through this gain: the single mute/volume point. */
  readonly master: GainNode;
  /** The beds and the music, in front of the master gain: ducked while mission control speaks. */
  readonly duck: GainNode;
}

/** Gain envelope: linear attack to `peak`, flat hold, then exponential decay to silence. */
export interface Envelope {
  readonly peak: number;
  readonly attack: number;
  readonly hold: number;
  readonly decay: number;
}

/** An enveloped oscillator whose pitch glides exponentially from `from` to `to`. */
export interface ToneSpec extends Envelope {
  readonly type: OscillatorType;
  readonly at: number;
  readonly from: number;
  readonly to: number;
}

/** The lab's sound systems a page's query can switch off: `?audio-off=beds,music,spatial`. */
export type SoundSystem = 'beds' | 'music' | 'spatial';
const SOUND_SYSTEMS: readonly SoundSystem[] = ['beds', 'music', 'spatial'];

/**
 * The sound systems the query string `search` switches off (`?audio-off=beds,music`): for
 * telling apart what the sound costs a slow machine, system by system. None by default.
 */
export function systemsOff(search: string): ReadonlySet<SoundSystem> {
  const named = (new URLSearchParams(search).get('audio-off') ?? '').split(',');
  return new Set(SOUND_SYSTEMS.filter((system) => named.includes(system)));
}

/** The main thread's time each sound system has taken so far, ms, on a page that counts it. */
const spent: Partial<Record<SoundSystem, number>> = {};

/**
 * Runs `work` for the sound system `system`, and on a page that counts it (`?trace=1`) adds
 * the time it took to the system's account: what the sound costs the main thread.
 */
export function timed<T>(system: SoundSystem, work: () => T): T {
  if (!counted) return work();
  const from = performance.now();
  try {
    return work();
  } finally {
    spent[system] = (spent[system] ?? 0) + performance.now() - from;
  }
}

/** The main thread's time each sound system has taken so far, ms (`timed`). */
export function timeSpent(): Partial<Record<SoundSystem, number>> {
  return { ...spent };
}

/** What the audio thread renders now (audioCount.ts): only on a page that counts it. */
export function graphCensus(): GraphCensus | null {
  return counted && engine !== null ? censusOf(engine.ctx.destination) : null;
}

const MASTER_LEVEL = 1;
const MUTE_STORAGE_KEY = 'escapelab-muted';
/** The own footstep's level; a partner's comes in at the same level, placed (spatial.ts). */
export const FOOTSTEP_LEVEL = 0.02;
const DOOR_LEVEL = 0.04;
const CHIRP_LEVEL = 0.03;
const FIND_LEVEL = 0.035;
const DRAIN_LEVEL = 0.05;
/**
 * Where the effects sit, as one level: the middle of their outlets (a door, a find, the
 * klaxon, the chord). The music is set against it (music.ts).
 */
export const EFFECTS_LEVEL = 0.04;

/** Exponential ramps cannot reach zero; this is -80 dB. */
export const SILENCE = 0.0001;
/** Scheduling headroom so main-thread jitter never clips the start of an envelope. */
export const LOOKAHEAD = 0.01;
const NOISE_SECONDS = 2;

const DOOR_SLIDE_SECONDS = 0.25;
const DRAIN_SECONDS = 0.8;

/** [frequency ratio, level, decay in s] of the partials of a struck free metal bar. */
const CLANK_PARTIALS = [
  [1, 0.4, 1.1],
  [2.76, 0.28, 0.7],
  [5.4, 0.18, 0.4],
  [8.93, 0.1, 0.22],
] as const;
const DRAIN_DETUNE = [1, 1.012] as const;
const UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'keydown', 'touchend'] as const;

/** The lab with its power on: the mains' 50 Hz and the transformers' 100 Hz with overtones. */
const POWER_VOICES = [
  [50, 0.35],
  [100, 0.5],
  [200, 0.22],
  [300, 0.1],
] as const;
const POWER_LEVEL = 0.03;
const POWER_FADE_IN = 0.8;
const POWER_FADE_OUT = 0.3;
/** How long the hum takes to die once the power goes, and how far its pitch falls meanwhile. */
const POWER_DIE_SECONDS = 1.4;
const POWER_FALL = 0.25;
/** How deep the hum sags in each drop of the flicker. */
const POWER_SAG = 0.3;
const ARC_LEVEL = 0.03;
const BANG_LEVEL = 0.07;
const CLICK_LEVEL = 0.04;
const LEVER_LEVEL = 0.06;

/** The alarm's horn: two detuned saws in a horn's band. */
const KLAXON_LEVEL = 0.045;
const KLAXON_PITCH = [392, 396] as const;
/** A short alarm: two blasts [s from now, strength, pitch factor]. */
const KLAXON_BLASTS = [
  [0, 1, 1],
  [0.22, 0.85, 0.94],
] as const;
/** A run lost to its alarms: blast after blast, each weaker and lower, ~1.5 s. */
const KLAXON_FADING = [
  [0, 1, 1],
  [0.3, 0.75, 0.95],
  [0.6, 0.5, 0.89],
  [0.9, 0.3, 0.83],
  [1.2, 0.16, 0.76],
] as const;
/** The escape's siren: quiet under everything, two tones taking turns. */
const SIREN_LEVEL = 0.08;
const SIREN_TONES = [440, 587] as const;
/** Each tone holds for half a period of this, Hz. */
const SIREN_RATE = 0.8;
const SIREN_FADE_IN = 0.4;
const SIREN_FADE_OUT = 0.3;
/** The hatch grinding open, s: as long as the picture takes (escape.ts). */
const GRIND_SECONDS = 2;
const GRIND_LEVEL = 0.05;
/** The end of a run won: a C major chord over a breath of wind. */
const CHORD_LEVEL = 0.045;
const CHORD_NOTES = [261.63, 329.63, 392, 523.25] as const;
const WIND_LEVEL = 0.03;
const WIND_SECONDS = 3.6;
/**
 * The mid band every heavy hit carries beside its thud, Hz and Q: noise centred at 520 Hz, about
 * 300 to 900 Hz wide — what a phone's or a laptop's small speaker still plays of a blow whose
 * body lies under 150 Hz.
 */
export const MID_BAND = 520;
const MID_Q = 0.9;
/**
 * The briefing's count (Game.tsx): a beep at each of its numbers, s into it, and the higher one
 * as it lifts — [s, Hz, how long].
 */
const BRIEFING_BEEPS = [
  [0, 440, 0.1],
  [1.2, 440, 0.1],
  [2.4, 440, 0.1],
  [3.6, 660, 0.4],
] as const;

/**
 * A sound that runs until it is stopped — the power hum, the siren: its
 * sources, the stage that fades it, and its outlet.
 */
interface Loop {
  readonly sources: OscillatorNode[];
  readonly level: GainNode;
  readonly out: GainNode;
}

/**
 * The moments of the lights failing, in seconds from when they are asked for:
 * the flicker's drops (from, to), the bang and the emergency relay's click.
 */
export interface BlackoutCue {
  readonly drops: readonly (readonly [number, number])[];
  readonly bang: number;
  readonly click: number;
}

let engine: Engine | null = null;
let engineUnavailable = false;
let noise: AudioBuffer | null = null;
let powerHum: Loop | null = null;
let siren: Loop | null = null;
let muted = readStoredMute();
/** Whether the engine's graph is counted for the walkthrough's probe (audioCount.ts). */
let counted = false;
let unlockArmed = false;

/**
 * The one shared AudioContext, for the crew's voice (voice/mesh.ts): made on
 * first use like every sound's, and nudged to resume — from a click that
 * wakes it. Voices go to its output past the master gain, so turning the
 * lab's sound off leaves the crew audible. Null where there is no Web Audio.
 */
export function sharedAudio(): AudioContext | null {
  return audioEngine()?.ctx ?? null;
}

/**
 * The engine for a sound that lasts — a bed, the music, a drone's buzz: made on first use and
 * nudged to resume, playing or not yet (it sounds once a gesture wakes the context). Null
 * where there is no Web Audio, or once the context is closed.
 */
export function audioEngine(): Engine | null {
  try {
    const audio = getEngine();
    if (audio === null || audio.ctx.state === 'closed') return null;
    unlock();
    return audio;
  } catch {
    // Deliberately silent: without Web Audio the lab is simply not heard.
    return null;
  }
}

/**
 * The engine for a sound that happens now — a step, a chirp, a line on the radio: only while
 * the context runs, so that nothing queues up behind the autoplay lock to burst out later.
 * Null otherwise, after nudging a resume.
 */
export function playingEngine(): Engine | null {
  try {
    return runningEngine();
  } catch {
    // Deliberately silent: a missed sound is harmless.
    return null;
  }
}

function readStoredMute(): boolean {
  try {
    return localStorage.getItem(MUTE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Whether sound is currently off, remembered across visits. */
export function isMuted(): boolean {
  return muted;
}

/**
 * Silences or restores everything at the single master gain the whole module
 * already routes through. Works before any sound has been created.
 */
export function setMuted(next: boolean): void {
  muted = next;
  try {
    localStorage.setItem(MUTE_STORAGE_KEY, next ? '1' : '0');
  } catch {
    // Storage blocked: the choice just does not survive a reload.
  }
  try {
    if (engine !== null) {
      engine.master.gain.setTargetAtTime(next ? 0 : MASTER_LEVEL, engine.ctx.currentTime, 0.05);
    }
  } catch {
    // Deliberately silent: muting must never break the game.
  }
}

/**
 * One tick of the final countdown. `secondsLeft` 1-10 rises in pitch as the
 * clock runs out; 0 is the dull thud of the power going.
 */
export function countdownBeep(secondsLeft: number): void {
  try {
    const audio = runningEngine();
    if (audio === null) return;
    const { ctx } = audio;
    const t = ctx.currentTime + LOOKAHEAD;
    const out = outlet(ctx, audio.master, CHIRP_LEVEL);
    const last = secondsLeft <= 0;
    const base = last ? 180 : 620 + (10 - Math.min(10, secondsLeft)) * 55;
    const beep = tone(ctx, out, {
      type: last ? 'sawtooth' : 'square',
      at: t,
      from: base,
      to: last ? 90 : base,
      peak: last ? 0.9 : 0.6,
      attack: 0.005,
      hold: last ? 0.25 : 0.05,
      decay: last ? 0.5 : 0.09,
    });
    onAllEnded([beep], () => out.disconnect());
  } catch {
    // Deliberately silent: the countdown is on screen as well.
  }
}

/**
 * The briefing's count, `elapsedMs` into it: a beep at each number it shows, the last higher as
 * it lifts — only those still ahead. A run that opens with the power on has no briefing, so
 * it never counts down to its surprise.
 */
export function briefingCountdown(elapsedMs = 0): void {
  try {
    const audio = runningEngine();
    if (audio === null) return;
    const { ctx } = audio;
    const t = ctx.currentTime + LOOKAHEAD - elapsedMs / 1000;
    const out = outlet(ctx, audio.master, CHIRP_LEVEL);
    const beeps = BRIEFING_BEEPS.filter(([at]) => t + at >= ctx.currentTime).map(
      ([at, frequency, length]) =>
        tone(ctx, out, {
          type: 'square',
          at: t + at,
          from: frequency,
          to: frequency,
          peak: 0.7,
          attack: 0.004,
          hold: length * 0.4,
          decay: length * 0.6,
        }),
    );
    if (beeps.length === 0) {
      out.disconnect();
      return;
    }
    onAllEnded(beeps, () => out.disconnect());
  } catch {
    // Deliberately silent: the briefing counts on screen as well.
  }
}

/** Soft ~60 ms footstep tap with ±10% pitch variation; cheap enough for ~3 calls per second. */
export function footstep(): void {
  try {
    const audio = runningEngine();
    if (audio === null) return;
    const { ctx } = audio;
    const out = outlet(ctx, audio.master, FOOTSTEP_LEVEL);
    onAllEnded(stepInto(ctx, out, ctx.currentTime + LOOKAHEAD), () => out.disconnect());
  } catch {
    // Deliberately silent: a missed footstep is harmless.
  }
}

/**
 * One footstep into `out` from `at`, at `pitch` (±10 % unless given): a sine falling an
 * octave — a soft heel thump rather than a pitched tone — and the scuff of a sole. Returns its
 * sources.
 */
export function stepInto(
  ctx: BaseAudioContext,
  out: AudioNode,
  at: number,
  pitch = rand(0.9, 1.1),
): AudioScheduledSourceNode[] {
  const thump = tone(ctx, out, {
    type: 'sine',
    at,
    from: 150 * pitch,
    to: 70 * pitch,
    peak: 0.7,
    attack: 0.004,
    hold: 0,
    decay: 0.075,
  });
  const scuff = noiseBurst(ctx, at, 0.025);
  const scuffLevel = gain(ctx, 0);
  applyEnvelope(scuffLevel.gain, at, { peak: 0.45, attack: 0.001, hold: 0, decay: 0.02 });
  chain(scuff, biquad(ctx, 'bandpass', 2500 * pitch, 0.9), scuffLevel, out);
  return [thump, scuff];
}

/** Pneumatic door slide: a ~0.25 s filtered-noise whoosh ending in a soft metallic click. */
export function doorSlide(): void {
  try {
    const audio = runningEngine();
    if (audio === null) return;
    const { ctx } = audio;
    const t = ctx.currentTime + LOOKAHEAD;
    const end = t + DOOR_SLIDE_SECONDS;
    const out = outlet(ctx, audio.master, DOOR_LEVEL);
    // The band sweeps down while the panel travels: a bright hiss settling into a whoosh.
    const hiss = noiseBurst(ctx, t, DOOR_SLIDE_SECONDS);
    const band = biquad(ctx, 'bandpass', 2400, 0.8);
    band.frequency.setValueAtTime(2400, t);
    band.frequency.exponentialRampToValueAtTime(600, end);
    const swell = gain(ctx, 0);
    swell.gain.setValueAtTime(0, t);
    swell.gain.linearRampToValueAtTime(0.8, t + 0.03);
    swell.gain.linearRampToValueAtTime(0.35, t + 0.18);
    swell.gain.linearRampToValueAtTime(0, end);
    chain(hiss, band, swell, out);
    const clickAt = end - 0.015;
    const click = tone(ctx, out, {
      type: 'triangle',
      at: clickAt,
      from: 1700,
      to: 1600,
      peak: 0.35,
      attack: 0.001,
      hold: 0,
      decay: 0.04,
    });
    const ping = tone(ctx, out, {
      type: 'sine',
      at: clickAt,
      from: 4300,
      to: 4300,
      peak: 0.12,
      attack: 0.001,
      hold: 0,
      decay: 0.02,
    });
    onAllEnded([hiss, click, ping], () => out.disconnect());
  } catch {
    // Deliberately silent: the door still opens without its sound.
  }
}

/** Rising two-tone 'station ready' chirp, ~0.3 s. */
export function stationChirp(): void {
  try {
    const audio = runningEngine();
    if (audio === null) return;
    const { ctx } = audio;
    const t = ctx.currentTime + LOOKAHEAD;
    const out = outlet(ctx, audio.master, CHIRP_LEVEL);
    const low = tone(ctx, out, {
      type: 'triangle',
      at: t,
      from: 680,
      to: 720,
      peak: 0.85,
      attack: 0.01,
      hold: 0.05,
      decay: 0.06,
    });
    const high = tone(ctx, out, {
      type: 'triangle',
      at: t + 0.13,
      from: 1020,
      to: 1090,
      peak: 0.85,
      attack: 0.01,
      hold: 0.07,
      decay: 0.09,
    });
    onAllEnded([low, high], () => out.disconnect());
  } catch {
    // Deliberately silent: the station state is shown visually as well.
  }
}

/**
 * Short bright blip marking a map ping, pitched above the station chirp so the two
 * never get confused.
 */
export function pingBlip(): void {
  try {
    const audio = runningEngine();
    if (audio === null) return;
    const { ctx } = audio;
    const t = ctx.currentTime + LOOKAHEAD;
    const out = outlet(ctx, audio.master, CHIRP_LEVEL);
    const blip = tone(ctx, out, {
      type: 'sine',
      at: t,
      from: 1560,
      to: 1960,
      peak: 0.8,
      attack: 0.005,
      hold: 0.03,
      decay: 0.12,
    });
    onAllEnded([blip], () => out.disconnect());
  } catch {
    // Deliberately silent: pings are shown on the map as well.
  }
}

/**
 * Soft rising two-note chime, ~0.45 s, for a source the crew has just come across: rounder
 * and lower than the ping, so a find never sounds like somebody calling.
 */
export function discoveryBlip(): void {
  try {
    const audio = runningEngine();
    if (audio === null) return;
    const { ctx } = audio;
    const t = ctx.currentTime + LOOKAHEAD;
    const out = outlet(ctx, audio.master, CHIRP_LEVEL);
    const low = tone(ctx, out, {
      type: 'sine',
      at: t,
      from: 784,
      to: 784,
      peak: 0.6,
      attack: 0.012,
      hold: 0.03,
      decay: 0.2,
    });
    const high = tone(ctx, out, {
      type: 'sine',
      at: t + 0.1,
      from: 1175,
      to: 1175,
      peak: 0.55,
      attack: 0.012,
      hold: 0.04,
      decay: 0.3,
    });
    onAllEnded([low, high], () => out.disconnect());
  } catch {
    // Deliberately silent: the caption shows the find as well.
  }
}

/** A locker door swung open, ~1 s: the latch, then the thin clang of its sheet metal. */
export function lockerOpen(): void {
  try {
    const audio = runningEngine();
    if (audio === null) return;
    const { ctx } = audio;
    const t = ctx.currentTime + LOOKAHEAD;
    const out = outlet(ctx, audio.master, FIND_LEVEL);
    const latch = tick(ctx, out, t, 2600, 0.8);
    onAllEnded([latch], () => out.disconnect());
    strike(ctx, audio.master, t + 0.06, 420, FIND_LEVEL * 0.8);
  } catch {
    // Deliberately silent: the locker opens on screen as well.
  }
}

/**
 * A padlock coming off, ~0.45 s: the key turning, the shackle springing with a bright tick,
 * then the drawer rolling out on its runners.
 */
export function cabinetUnlock(): void {
  try {
    const audio = runningEngine();
    if (audio === null) return;
    const { ctx } = audio;
    const t = ctx.currentTime + LOOKAHEAD;
    const out = outlet(ctx, audio.master, FIND_LEVEL);
    const turn = tick(ctx, out, t, 3400, 0.6);
    const spring = tick(ctx, out, t + 0.11, 5200, 0.9);
    const ring = tone(ctx, out, {
      type: 'sine',
      at: t + 0.11,
      from: 6100,
      to: 6000,
      peak: 0.12,
      attack: 0.001,
      hold: 0,
      decay: 0.05,
    });
    const runners = noiseBurst(ctx, t + 0.2, 0.22);
    const band = biquad(ctx, 'bandpass', 900, 1.2);
    band.frequency.setValueAtTime(900, t + 0.2);
    band.frequency.exponentialRampToValueAtTime(450, t + 0.42);
    const roll = gain(ctx, 0);
    applyEnvelope(roll.gain, t + 0.2, { peak: 0.5, attack: 0.03, hold: 0.1, decay: 0.09 });
    chain(runners, band, roll, out);
    onAllEnded([turn, spring, ring, runners], () => out.disconnect());
  } catch {
    // Deliberately silent: the cabinet opens on screen as well.
  }
}

/**
 * A sheet put down, ~0.25 s: the paper's swish as it slides off, then the soft clack of the
 * board or the stack meeting the table, with a mid layer a phone's small speaker still plays.
 */
export function sheetDown(): void {
  try {
    const audio = runningEngine();
    if (audio === null) return;
    const { ctx } = audio;
    const t = ctx.currentTime + LOOKAHEAD;
    const out = outlet(ctx, audio.master, FIND_LEVEL);
    const swish = noiseBurst(ctx, t, 0.16);
    const band = biquad(ctx, 'bandpass', 3200, 0.7);
    band.frequency.setValueAtTime(3200, t);
    band.frequency.exponentialRampToValueAtTime(1400, t + 0.16);
    const swishLevel = gain(ctx, 0);
    applyEnvelope(swishLevel.gain, t, { peak: 0.35, attack: 0.03, hold: 0.04, decay: 0.09 });
    chain(swish, band, swishLevel, out);
    const clack = tick(ctx, out, t + 0.16, 1300, 0.9);
    const body = midKnock(ctx, out, t + 0.16, 0.07, 0.6);
    onAllEnded([swish, clack, body], () => out.disconnect());
  } catch {
    // Deliberately silent: the sheet goes down on screen as well.
  }
}

/**
 * A book shut, ~0.3 s: the rush of air as the cover swings over the pages, then the dull clap
 * of cover on block — a low thump and its mid layer.
 */
export function coverShut(): void {
  try {
    const audio = runningEngine();
    if (audio === null) return;
    const { ctx } = audio;
    const t = ctx.currentTime + LOOKAHEAD;
    const out = outlet(ctx, audio.master, FIND_LEVEL);
    const rush = lowNoise(ctx, out, t, 0.18, 900);
    const clap = tone(ctx, out, {
      type: 'sine',
      at: t + 0.18,
      from: 150,
      to: 70,
      peak: 0.8,
      attack: 0.002,
      hold: 0,
      decay: 0.12,
    });
    const body = midKnock(ctx, out, t + 0.18, 0.08, 0.7);
    onAllEnded([rush, clap, body], () => out.disconnect());
  } catch {
    // Deliberately silent: the book shuts on screen as well.
  }
}

/** A pencil taking a block down, ~0.3 s: three quick strokes of graphite on paper. */
export function pencilScratch(): void {
  try {
    const audio = runningEngine();
    if (audio === null) return;
    const { ctx } = audio;
    const t = ctx.currentTime + LOOKAHEAD;
    const out = outlet(ctx, audio.master, CHIRP_LEVEL);
    const strokes = [0, 0.09, 0.19].map((after) => {
      const stroke = noiseBurst(ctx, t + after, 0.07);
      const level = gain(ctx, 0);
      applyEnvelope(level.gain, t + after, { peak: 0.5, attack: 0.008, hold: 0.03, decay: 0.03 });
      chain(stroke, biquad(ctx, 'bandpass', rand(3800, 5200), 2), level, out);
      return stroke;
    });
    onAllEnded(strokes, () => out.disconnect());
  } catch {
    // Deliberately silent: the notepad shows the lines as well.
  }
}

/**
 * Mission control keying the radio, ~0.2 s: a crackle of static, then the press-to-talk key's
 * click going down and up, squeezed into a handset's narrow band. No tone in it: a line that
 * follows a solve comes over the solve's chord, and nothing pitched may clash with that. Only
 * for a line no recording speaks — a custom mission's, a note of the last shift: a recorded line
 * keys its own squelch (radioVoice.ts).
 */
export function radioChirp(): void {
  try {
    const audio = runningEngine();
    if (audio === null) return;
    const { ctx } = audio;
    const t = ctx.currentTime + LOOKAHEAD;
    const out = outlet(ctx, audio.master, CHIRP_LEVEL);
    const handset = biquad(ctx, 'bandpass', 1500, 0.8);
    handset.connect(out);
    const crackle = noiseBurst(ctx, t, 0.06);
    const crackleLevel = gain(ctx, 0);
    applyEnvelope(crackleLevel.gain, t, { peak: 0.6, attack: 0.002, hold: 0.02, decay: 0.035 });
    chain(crackle, crackleLevel, handset);
    const down = tick(ctx, handset, t + 0.07, 2200, 0.9);
    const up = tick(ctx, handset, t + 0.14, 1700, 0.7);
    onAllEnded([crackle, down, up], () => out.disconnect());
  } catch {
    // Deliberately silent: the line is on screen as well.
  }
}

/**
 * Deep red-alert swell for penalties (~0.8 s): detuned saws sagging in pitch behind a closing
 * lowpass, so it reads as power draining away rather than as a klaxon. `delaySec` puts it later
 * on the audio clock, for the lights failing (`blackoutSounds`).
 */
export function powerDrain(delaySec = 0): void {
  try {
    const audio = runningEngine();
    if (audio === null) return;
    const { ctx } = audio;
    const t = ctx.currentTime + LOOKAHEAD + delaySec;
    const end = t + DRAIN_SECONDS;
    const out = outlet(ctx, audio.master, DRAIN_LEVEL);
    const lowpass = biquad(ctx, 'lowpass', 1400, 4);
    lowpass.frequency.setValueAtTime(1400, t);
    lowpass.frequency.exponentialRampToValueAtTime(150, end);
    const swell = gain(ctx, 0);
    swell.gain.setValueAtTime(0, t);
    swell.gain.linearRampToValueAtTime(0.4, t + 0.2);
    swell.gain.linearRampToValueAtTime(0.28, t + 0.5);
    swell.gain.linearRampToValueAtTime(0, end);
    chain(lowpass, swell, out);
    const saws = DRAIN_DETUNE.map((ratio) => {
      const saw = ctx.createOscillator();
      saw.type = 'sawtooth';
      saw.frequency.setValueAtTime(130 * ratio, t);
      saw.frequency.exponentialRampToValueAtTime(40 * ratio, end);
      saw.connect(lowpass);
      saw.start(t);
      saw.stop(end + 0.02);
      return saw;
    });
    onAllEnded(saws, () => out.disconnect());
  } catch {
    // Deliberately silent: the penalty is shown visually as well.
  }
}

/**
 * Idempotent. The lab with its power on (the cold open, coldOpen.ts): a low mains hum under
 * everything, fading in over ~0.8 s, until the lights fail or `stopPowerHum` ends it.
 */
export function startPowerHum(): void {
  try {
    if (powerHum !== null) return;
    const audio = getEngine();
    if (audio === null || audio.ctx.state === 'closed') return;
    unlock();
    powerHum = buildPowerHum(audio);
  } catch {
    // Deliberately silent: the lit lab still looks lit.
  }
}

/** Fades the power hum out in ~0.3 s and stops it. Safe when none plays. */
export function stopPowerHum(): void {
  try {
    const hum = powerHum;
    powerHum = null;
    if (hum !== null && engine !== null) {
      const now = engine.ctx.currentTime;
      const level = hum.level.gain.value;
      hum.level.gain.cancelScheduledValues(now);
      windDown(hum, now, POWER_FADE_OUT, 1, level);
    }
  } catch {
    // Deliberately silent: the hum's nodes are released with the context at the latest.
  }
}

/**
 * The lights failing, scheduled at once on the audio clock: contacts arcing in every drop of
 * the flicker while the power hum sags with it, then a bang, the hum dying with its pitch
 * falling and the power draining away, and the emergency relay's click.
 */
export function blackoutSounds(cue: BlackoutCue): void {
  try {
    const hum = powerHum;
    powerHum = null;
    const audio = runningEngine();
    if (audio === null) {
      if (hum !== null && engine !== null) windDown(hum, engine.ctx.currentTime, 0.05, 1);
      return;
    }
    const { ctx, master } = audio;
    const t = ctx.currentTime + LOOKAHEAD;
    if (hum !== null) {
      sag(hum.level.gain, t, cue.drops);
      windDown(hum, t + cue.bang, POWER_DIE_SECONDS, POWER_FALL);
    }
    arcing(ctx, master, t, cue.drops);
    bang(ctx, master, t + cue.bang);
    powerDrain(cue.bang);
    relayClick(ctx, master, t + cue.click);
  } catch {
    // Deliberately silent: the lights fail on screen as well.
  }
}

/**
 * A heavy main switch thrown home, ~0.4 s: the latch letting go ("ka"), then the lever
 * dropping into its stop with a thud and the ring of its steel ("chunk").
 */
export function leverChunk(): void {
  try {
    const audio = runningEngine();
    if (audio === null) return;
    const { ctx } = audio;
    const t = ctx.currentTime + LOOKAHEAD;
    const out = outlet(ctx, audio.master, LEVER_LEVEL);
    const latch = tick(ctx, out, t, 1900, 0.8);
    const thud = tone(ctx, out, {
      type: 'sine',
      at: t + 0.12,
      from: 120,
      to: 48,
      peak: 1,
      attack: 0.002,
      hold: 0.02,
      decay: 0.28,
    });
    const knock = lowNoise(ctx, out, t + 0.12, 0.09, 700);
    const body = midKnock(ctx, out, t + 0.12, 0.13, 0.75);
    onAllEnded([latch, thud, knock, body], () => out.disconnect());
    strike(ctx, audio.master, t + 0.12, 150, LEVER_LEVEL * 0.5);
  } catch {
    // Deliberately silent: the lever drops on screen as well.
  }
}

/** A short klaxon for an alarm, ~0.4 s: two harsh blasts of a horn, the second a little lower. */
export function klaxon(): void {
  try {
    const audio = runningEngine();
    if (audio === null) return;
    hornBlasts(audio, KLAXON_BLASTS);
  } catch {
    // Deliberately silent: the alarm strobes on screen as well.
  }
}

/**
 * The klaxon of a run lost to its alarms, ~1.5 s: blast after blast, each weaker and lower, as
 * the emergency supply gives out.
 */
export function klaxonFade(): void {
  try {
    const audio = runningEngine();
    if (audio === null) return;
    hornBlasts(audio, KLAXON_FADING);
  } catch {
    // Deliberately silent: the card says it as well.
  }
}

/** A room's lights coming on: the relay pulling in, then the faint tick of the tubes striking. */
export function lightsOnClick(): void {
  try {
    const audio = runningEngine();
    if (audio === null) return;
    const { ctx, master } = audio;
    const t = ctx.currentTime + LOOKAHEAD;
    relayClick(ctx, master, t);
    const out = outlet(ctx, master, CLICK_LEVEL * 0.6);
    const strikeUp = tone(ctx, out, {
      type: 'sine',
      at: t + 0.12,
      from: 5200,
      to: 4900,
      peak: 0.3,
      attack: 0.002,
      hold: 0,
      decay: 0.08,
    });
    onAllEnded([strikeUp], () => out.disconnect());
  } catch {
    // Deliberately silent: the room lights up on screen as well.
  }
}

/**
 * Idempotent. The escape's siren: two tones taking turns, high and low, looping quietly under
 * everything — fading in over ~0.4 s — until `stopSiren` ends it.
 */
export function startSiren(): void {
  try {
    if (siren !== null) return;
    const audio = getEngine();
    if (audio === null || audio.ctx.state === 'closed') return;
    unlock();
    siren = buildSiren(audio);
  } catch {
    // Deliberately silent: the hatch and the red light say it as well.
  }
}

/** Fades the siren out in ~0.3 s and stops it. Safe when none plays. */
export function stopSiren(): void {
  try {
    const current = siren;
    siren = null;
    if (current !== null && engine !== null) {
      const now = engine.ctx.currentTime;
      const level = current.level.gain.value;
      current.level.gain.cancelScheduledValues(now);
      windDown(current, now, SIREN_FADE_OUT, 1, level);
    }
  } catch {
    // Deliberately silent: the siren's nodes are released with the context at the latest.
  }
}

/**
 * The hatch grinding open, ~2 s: steel dragging on steel in jerks over a straining motor, then
 * the leaves striking home with a clunk.
 */
export function exitGrind(): void {
  try {
    const audio = runningEngine();
    if (audio === null) return;
    const { ctx } = audio;
    const t = ctx.currentTime + LOOKAHEAD;
    const out = outlet(ctx, audio.master, GRIND_LEVEL);
    const sources = [...scrape(ctx, out, t), motor(ctx, out, t)];
    const end = t + GRIND_SECONDS;
    sources.push(
      tone(ctx, out, {
        type: 'sine',
        at: end,
        from: 92,
        to: 38,
        peak: 1,
        attack: 0.003,
        hold: 0.03,
        decay: 0.45,
      }),
      midKnock(ctx, out, end, 0.16, 0.8),
    );
    onAllEnded(sources, () => out.disconnect());
    strike(ctx, audio.master, end, 110, GRIND_LEVEL * 0.6);
  } catch {
    // Deliberately silent: the hatch opens on screen as well.
  }
}

/** The end of a run won, ~3.6 s: a soft major chord swelling and dying away over a breath of wind. */
export function victoryChord(): void {
  try {
    const audio = runningEngine();
    if (audio === null) return;
    const t = audio.ctx.currentTime + LOOKAHEAD;
    chord(audio.ctx, audio.master, t);
    wind(audio.ctx, audio.master, t);
  } catch {
    // Deliberately silent: the card says it as well.
  }
}

/** Horn blasts from now, each [s from now, strength 0–1, pitch factor], through a horn's band. */
function hornBlasts(audio: Engine, shots: readonly (readonly [number, number, number])[]): void {
  const { ctx } = audio;
  const t = ctx.currentTime + LOOKAHEAD;
  const out = outlet(ctx, audio.master, KLAXON_LEVEL);
  const horn = biquad(ctx, 'bandpass', 900, 1.3);
  horn.connect(out);
  const sources = shots.flatMap(([delay, strength, pitch]) => {
    const level = gain(ctx, 0);
    applyEnvelope(level.gain, t + delay, { peak: strength, attack: 0.012, hold: 0.13, decay: 0.05 });
    level.connect(horn);
    return KLAXON_PITCH.map((frequency) => {
      const saw = ctx.createOscillator();
      saw.type = 'sawtooth';
      saw.frequency.setValueAtTime(frequency * pitch, t + delay);
      saw.connect(level);
      saw.start(t + delay);
      saw.stop(t + delay + 0.22);
      return saw;
    });
  });
  onAllEnded(sources, () => out.disconnect());
}

function buildSiren(audio: Engine): Loop {
  const { ctx } = audio;
  const t = ctx.currentTime;
  const out = outlet(ctx, audio.master, SIREN_LEVEL);
  const level = gain(ctx, 0);
  level.gain.setValueAtTime(0, t);
  level.gain.linearRampToValueAtTime(1, t + SIREN_FADE_IN);
  level.connect(out);
  const [low, high] = SIREN_TONES;
  const voice = ctx.createOscillator();
  voice.type = 'triangle';
  voice.frequency.value = (low + high) / 2;
  // A square wave swings the pitch from one tone to the other; smoothed, so each turn glides.
  const turns = ctx.createOscillator();
  turns.type = 'square';
  turns.frequency.value = SIREN_RATE;
  const glide = biquad(ctx, 'lowpass', 25, 0);
  const swing = gain(ctx, (high - low) / 2);
  chain(turns, glide, swing);
  swing.connect(voice.frequency);
  chain(voice, biquad(ctx, 'lowpass', 1800, 0), level);
  voice.start(t);
  turns.start(t);
  return { sources: [voice, turns], level, out };
}

/** Steel dragging on steel: noise in a low band, chopped into stick-slip jerks that speed up. */
function scrape(ctx: AudioContext, dest: AudioNode, at: number): AudioScheduledSourceNode[] {
  const end = at + GRIND_SECONDS;
  const drag = noiseBurst(ctx, at, GRIND_SECONDS);
  const chopper = gain(ctx, 0.5);
  const slip = ctx.createOscillator();
  slip.type = 'sawtooth';
  slip.frequency.setValueAtTime(9, at);
  slip.frequency.linearRampToValueAtTime(16, end);
  const depth = gain(ctx, 0.5);
  chain(slip, depth);
  depth.connect(chopper.gain);
  const swell = gain(ctx, 0);
  swell.gain.setValueAtTime(0, at);
  swell.gain.linearRampToValueAtTime(0.9, at + 0.15);
  swell.gain.setValueAtTime(0.9, end - 0.2);
  swell.gain.linearRampToValueAtTime(0, end);
  chain(drag, biquad(ctx, 'bandpass', 380, 2.5), chopper, swell, dest);
  slip.start(at);
  slip.stop(end);
  return [drag, slip];
}

/**
 * The motor straining under the hatch: a low saw climbing as the leaves give way, its
 * overtones up to the mid band left in, so that a small speaker hears it strain as well.
 */
function motor(ctx: AudioContext, dest: AudioNode, at: number): OscillatorNode {
  const end = at + GRIND_SECONDS;
  const saw = ctx.createOscillator();
  saw.type = 'sawtooth';
  saw.frequency.setValueAtTime(40, at);
  saw.frequency.linearRampToValueAtTime(58, end);
  const level = gain(ctx, 0);
  level.gain.setValueAtTime(0, at);
  level.gain.linearRampToValueAtTime(0.5, at + 0.3);
  level.gain.linearRampToValueAtTime(0, end);
  chain(saw, biquad(ctx, 'lowpass', 620, 0), level, dest);
  saw.start(at);
  saw.stop(end + 0.02);
  return saw;
}

/** C major, spread over two octaves: each note a sine with a triangle above, 50 ms apart. */
function chord(ctx: AudioContext, dest: AudioNode, at: number): void {
  const out = outlet(ctx, dest, CHORD_LEVEL);
  const warm = biquad(ctx, 'lowpass', 2400, 0);
  warm.connect(out);
  const voices = CHORD_NOTES.flatMap((frequency, i) => [
    tone(ctx, warm, {
      type: 'sine',
      at: at + i * 0.05,
      from: frequency,
      to: frequency,
      peak: 0.5,
      attack: 0.09,
      hold: 0.5,
      decay: 2.3,
    }),
    tone(ctx, warm, {
      type: 'triangle',
      at: at + i * 0.05,
      from: frequency * 2,
      to: frequency * 2,
      peak: 0.12,
      attack: 0.09,
      hold: 0.3,
      decay: 1.6,
    }),
  ]);
  onAllEnded(voices, () => out.disconnect());
}

/** Wind outside: noise in a band that drifts up and back while it swells and dies away. */
function wind(ctx: AudioContext, dest: AudioNode, at: number): void {
  const end = at + WIND_SECONDS;
  const out = outlet(ctx, dest, WIND_LEVEL);
  const air = ctx.createBufferSource();
  air.buffer = noiseBuffer(ctx);
  air.loop = true;
  const band = biquad(ctx, 'bandpass', 420, 0.8);
  band.frequency.setValueAtTime(420, at);
  band.frequency.linearRampToValueAtTime(900, at + 1.6);
  band.frequency.linearRampToValueAtTime(520, end);
  const swell = gain(ctx, 0);
  swell.gain.setValueAtTime(0, at);
  swell.gain.linearRampToValueAtTime(1, at + 1);
  swell.gain.linearRampToValueAtTime(0.6, at + 2.2);
  swell.gain.linearRampToValueAtTime(0, end);
  chain(air, band, swell, out);
  air.start(at);
  air.stop(end + 0.05);
  onAllEnded([air], () => out.disconnect());
}

function buildPowerHum(audio: Engine): Loop {
  const { ctx } = audio;
  const t = ctx.currentTime;
  const out = outlet(ctx, audio.master, POWER_LEVEL);
  const level = gain(ctx, 0);
  level.gain.setValueAtTime(0, t);
  level.gain.linearRampToValueAtTime(1, t + POWER_FADE_IN);
  const lowpass = biquad(ctx, 'lowpass', 700, 0);
  chain(lowpass, level, out);
  const sources = POWER_VOICES.map(([frequency, voiceLevel]) => {
    const osc = ctx.createOscillator();
    osc.frequency.value = frequency;
    chain(osc, gain(ctx, voiceLevel), lowpass);
    osc.start(t);
    return osc;
  });
  return { sources, level, out };
}

/** The hum sags in every drop of the flicker, `drops` in seconds from `at`. */
function sag(param: AudioParam, at: number, drops: BlackoutCue['drops']): void {
  for (const [from, to] of drops) {
    param.setValueAtTime(1, at + from);
    param.linearRampToValueAtTime(POWER_SAG, at + from + 0.02);
    param.setValueAtTime(POWER_SAG, at + to);
    param.linearRampToValueAtTime(1, at + to + 0.03);
  }
}

/**
 * The hum dies from `at` over `seconds`, from `level` down to silence, its pitch falling to
 * `fall` times, and stops.
 */
function windDown(hum: Loop, at: number, seconds: number, fall: number, level = 1): void {
  const end = at + seconds;
  hum.level.gain.setValueAtTime(Math.max(SILENCE, level), at);
  hum.level.gain.exponentialRampToValueAtTime(SILENCE, end);
  for (const osc of hum.sources) {
    const frequency = osc.frequency.value;
    osc.frequency.setValueAtTime(frequency, at);
    osc.frequency.exponentialRampToValueAtTime(frequency * fall, end);
    osc.stop(end + 0.02);
  }
  onAllEnded(hum.sources, () => hum.out.disconnect());
}

/** Contacts arcing: a rasping buzz and a crackle in every drop, `drops` in seconds from `at`. */
function arcing(ctx: AudioContext, dest: AudioNode, at: number, drops: BlackoutCue['drops']): void {
  const last = drops.at(-1);
  if (last === undefined) return;
  const out = outlet(ctx, dest, ARC_LEVEL);
  const rasp = ctx.createOscillator();
  rasp.type = 'sawtooth';
  rasp.frequency.value = 110;
  const level = gain(ctx, 0);
  chain(rasp, biquad(ctx, 'bandpass', 2400, 2), level, out);
  const crackles = drops.map(([from, to]) => {
    level.gain.setValueAtTime(0, at + from);
    level.gain.linearRampToValueAtTime(0.7, at + from + 0.005);
    level.gain.setValueAtTime(0.7, at + to);
    level.gain.linearRampToValueAtTime(0, at + to + 0.03);
    return tick(ctx, out, at + from, 3500, 0.9);
  });
  rasp.start(at);
  rasp.stop(at + last[1] + 0.05);
  onAllEnded([rasp, ...crackles], () => out.disconnect());
}

/** The breaker going: a low thump with a burst of muffled noise. */
function bang(ctx: AudioContext, dest: AudioNode, at: number): void {
  const out = outlet(ctx, dest, BANG_LEVEL);
  const thump = tone(ctx, out, {
    type: 'sine',
    at,
    from: 95,
    to: 32,
    peak: 1,
    attack: 0.003,
    hold: 0.04,
    decay: 0.6,
  });
  const burst = lowNoise(ctx, out, at, 0.18, 900);
  const body = midKnock(ctx, out, at, 0.22, 0.85);
  onAllEnded([thump, burst, body], () => out.disconnect());
}

/** The emergency relay pulling in: a dry click with a short knock under it. */
function relayClick(ctx: AudioContext, dest: AudioNode, at: number): void {
  const out = outlet(ctx, dest, CLICK_LEVEL);
  const click = tick(ctx, out, at, 2600, 0.9);
  const knock = tone(ctx, out, {
    type: 'sine',
    at,
    from: 160,
    to: 110,
    peak: 0.5,
    attack: 0.002,
    hold: 0,
    decay: 0.05,
  });
  onAllEnded([click, knock], () => out.disconnect());
}

/**
 * A heavy hit's mid layer: a burst of noise in the band MID_BAND/MID_Q spans, about 300 to
 * 900 Hz, `duration` long from `at`, falling from `peak`.
 */
export function midKnock(
  ctx: BaseAudioContext,
  dest: AudioNode,
  at: number,
  duration: number,
  peak: number,
): AudioBufferSourceNode {
  const burst = noiseBurst(ctx, at, duration);
  const level = gain(ctx, 0);
  applyEnvelope(level.gain, at, { peak, attack: 0.002, hold: 0, decay: duration - 0.002 });
  chain(burst, biquad(ctx, 'bandpass', MID_BAND, MID_Q), level, dest);
  return burst;
}

/** A burst of noise behind a lowpass at `cutoff`, `duration` long from `at`. */
function lowNoise(
  ctx: BaseAudioContext,
  dest: AudioNode,
  at: number,
  duration: number,
  cutoff: number,
): AudioBufferSourceNode {
  const burst = noiseBurst(ctx, at, duration);
  const level = gain(ctx, 0);
  applyEnvelope(level.gain, at, { peak: 0.9, attack: 0.002, hold: 0, decay: duration - 0.002 });
  chain(burst, biquad(ctx, 'lowpass', cutoff, 0), level, dest);
  return burst;
}

function getEngine(): Engine | null {
  if (engine === null && !engineUnavailable) {
    engine = createEngine();
    engineUnavailable = engine === null;
    syncUnlockListeners();
  }
  return engine;
}

function createEngine(): Engine | null {
  try {
    const scope: { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor } =
      globalThis;
    const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
    if (Ctor === undefined) return null;
    const ctx = new Ctor();
    ctx.onstatechange = syncUnlockListeners;
    counted = typeof location !== 'undefined' && traceRequested(location.search);
    if (counted) {
      countGraph(ctx);
    }
    const master = outlet(ctx, ctx.destination, muted ? 0 : MASTER_LEVEL);
    return { ctx, master, duck: outlet(ctx, master, 1) };
  } catch {
    return null;
  }
}

/** The engine when it can play right now; otherwise null, after nudging a resume. */
function runningEngine(): Engine | null {
  const audio = getEngine();
  if (audio === null) return null;
  if (audio.ctx.state === 'running') return audio;
  unlock();
  return null;
}

/** Asks a suspended context to resume; autoplay policy lets this succeed after a gesture. */
function unlock(): void {
  try {
    if (engine !== null && engine.ctx.state !== 'running') {
      engine.ctx.resume().catch(() => undefined);
    }
  } catch {
    // Deliberately silent: legacy contexts without resume() simply stay locked.
  }
}

/** Listens for user gestures only while the context is locked, to resume it from one. */
function syncUnlockListeners(): void {
  try {
    if (engine === null || typeof window === 'undefined') return;
    const { state } = engine.ctx;
    const locked = state !== 'running' && state !== 'closed';
    if (locked === unlockArmed) return;
    unlockArmed = locked;
    for (const type of UNLOCK_EVENTS) {
      if (locked) window.addEventListener(type, unlock, { capture: true, passive: true });
      else window.removeEventListener(type, unlock, { capture: true });
    }
  } catch {
    // Deliberately silent: sound calls still nudge a resume on their own.
  }
}

/** Struck metal: the partials of a free bar at `base` Hz with the knock of the blow, from `at`. */
export function strike(
  ctx: BaseAudioContext,
  dest: AudioNode,
  at: number,
  base: number,
  level: number,
): void {
  const out = outlet(ctx, dest, level);
  const sources = strikeInto(ctx, out, at, base, { partials: CLANK_PARTIALS.length, impact: true });
  onAllEnded(sources, () => out.disconnect());
}

/**
 * Struck metal into `dest`, from `at`: the strongest `partials` of a free bar at `base` Hz
 * and, with `impact`, the knock of the blow. Returns its sources; the caller lets it go.
 */
export function strikeInto(
  ctx: BaseAudioContext,
  dest: AudioNode,
  at: number,
  base: number,
  { partials, impact }: { partials: number; impact: boolean },
): AudioScheduledSourceNode[] {
  const sources: AudioScheduledSourceNode[] = CLANK_PARTIALS.slice(0, partials).map(
    ([ratio, peak, decay]) =>
      tone(ctx, dest, {
        type: 'sine',
        at,
        from: base * ratio,
        to: base * ratio,
        peak,
        attack: 0.002,
        hold: 0,
        decay,
      }),
  );
  if (impact) {
    const knock = noiseBurst(ctx, at, 0.04);
    const knockLevel = gain(ctx, 0);
    applyEnvelope(knockLevel.gain, at, { peak: 0.3, attack: 0.001, hold: 0, decay: 0.03 });
    chain(knock, biquad(ctx, 'bandpass', base * 6, 1.2), knockLevel, dest);
    sources.push(knock);
  }
  return sources;
}

/** A dry mechanical tick, ~30 ms: a sliver of noise through a narrow band. */
export function tick(
  ctx: BaseAudioContext,
  dest: AudioNode,
  at: number,
  frequency: number,
  peak: number,
): AudioBufferSourceNode {
  const burst = noiseBurst(ctx, at, 0.03);
  const level = gain(ctx, 0);
  applyEnvelope(level.gain, at, { peak, attack: 0.001, hold: 0, decay: 0.025 });
  chain(burst, biquad(ctx, 'bandpass', frequency, 3), level, dest);
  return burst;
}

/** A number from `min` to `max`, at random: what keeps repeats from sounding alike. */
export function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** A gain stage at `value`, wired to nothing yet. */
export function gain(ctx: BaseAudioContext, value: number): GainNode {
  const node = ctx.createGain();
  node.gain.value = value;
  return node;
}

/** A gain stage at `level` feeding `dest`; a sound's outlet level is its ceiling. */
export function outlet(ctx: BaseAudioContext, dest: AudioNode, level: number): GainNode {
  const node = gain(ctx, level);
  node.connect(dest);
  return node;
}

/** `q` is a linear Q for bandpass but a resonance in dB for lowpass (a Web Audio quirk). */
export function biquad(
  ctx: BaseAudioContext,
  type: BiquadFilterType,
  frequency: number,
  q: number,
): BiquadFilterNode {
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  return filter;
}

/** Wires the nodes one into the next, in order. */
export function chain(first: AudioNode, ...rest: AudioNode[]): void {
  let previous = first;
  for (const node of rest) {
    previous.connect(node);
    previous = node;
  }
}

/**
 * Moves `param` with `source` scaled by `depth` — a slow oscillator wandering a filter's
 * centre in Hz, a fast one fluttering a gain: modulation, not an audio level.
 */
export function modulate(
  ctx: BaseAudioContext,
  source: AudioNode,
  depth: number,
  param: AudioParam,
): void {
  const scale = gain(ctx, depth);
  source.connect(scale);
  scale.connect(param);
}

/** Schedules `env` on `param` starting at `at` and returns the time it reaches silence. */
export function applyEnvelope(param: AudioParam, at: number, env: Envelope): number {
  const peakAt = at + env.attack;
  const end = peakAt + env.hold + env.decay;
  param.setValueAtTime(0, at);
  param.linearRampToValueAtTime(env.peak, peakAt);
  param.setValueAtTime(env.peak, peakAt + env.hold);
  param.exponentialRampToValueAtTime(SILENCE, end);
  return end;
}

/** An enveloped oscillator into `dest` (ToneSpec), started and stopped on its own. */
export function tone(ctx: BaseAudioContext, dest: AudioNode, spec: ToneSpec): OscillatorNode {
  const osc = ctx.createOscillator();
  osc.type = spec.type;
  const level = gain(ctx, 0);
  const end = applyEnvelope(level.gain, spec.at, spec);
  osc.frequency.setValueAtTime(spec.from, spec.at);
  osc.frequency.exponentialRampToValueAtTime(spec.to, end);
  chain(osc, level, dest);
  osc.start(spec.at);
  osc.stop(end + 0.01);
  return osc;
}

/** Two seconds of white noise, made once and shared by every sound cut from it. */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  if (noise === null) {
    const length = Math.floor(ctx.sampleRate * NOISE_SECONDS);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noise = buffer;
  }
  return noise;
}

/** The shared noise looped, started at `at`: the stuff of air, fans and static. */
export function noiseLoop(ctx: BaseAudioContext, at: number): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx);
  source.loop = true;
  source.start(at);
  return source;
}

/** A one-shot slice of the shared noise; the random offset keeps repeats from sounding alike. */
export function noiseBurst(
  ctx: BaseAudioContext,
  at: number,
  duration: number,
): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  const buffer = noiseBuffer(ctx);
  source.buffer = buffer;
  source.start(at, Math.random() * Math.max(0, buffer.duration - duration), duration);
  return source;
}

/**
 * A level moving in a straight line from `from` at `start` to `to` at `end`, audio time: what
 * a bed's or a layer's gain was last told to do, so that it can be read back without asking
 * the audio thread.
 */
export interface Fade {
  readonly from: number;
  readonly to: number;
  readonly start: number;
  readonly end: number;
}

/** A level that stays at `level`. */
export function still(level: number): Fade {
  return { from: level, to: level, start: 0, end: 0 };
}

/** Where `fade` stands at audio time `t`: `from` before it starts, `to` once it is over. */
export function levelAt(fade: Fade, t: number): number {
  if (t <= fade.start) return fade.from;
  if (t >= fade.end) return fade.to;
  return fade.from + ((fade.to - fade.from) * (t - fade.start)) / (fade.end - fade.start);
}

/**
 * Moves `param`, which follows `fade`, on to `to` in a straight line from `start` to `end`;
 * until `start` it keeps to the way `fade` set it — whatever was scheduled after `now` goes.
 * Returns the new fade.
 */
export function fadeTo(
  param: AudioParam,
  fade: Fade,
  now: number,
  [start, end]: readonly [number, number],
  to: number,
): Fade {
  param.cancelScheduledValues(now);
  param.setValueAtTime(levelAt(fade, now), now);
  if (fade.end > now && fade.end < start) {
    param.linearRampToValueAtTime(fade.to, fade.end);
  }
  const from = levelAt(fade, start);
  if (start > now) {
    param.linearRampToValueAtTime(from, start);
  }
  param.linearRampToValueAtTime(to, Math.max(end, start + 0.001));
  return { from, to, start, end: Math.max(end, start + 0.001) };
}

// --- what the beds, the music and the placed sounds may keep alive -----------------------

/**
 * The most sources the beds, the music and the placed sounds (ambience.ts, music.ts,
 * spatial.ts) keep alive at once: voices — the sources of short sounds, live oscillators or
 * samples rendered once — live noise, the shared noise through live filters, and prerendered
 * loops. A sound with no room left is not played; a loop that was refused is tried again on
 * the next round. Mission control's voice and the effects are not counted: they were the
 * lab's before, and are short.
 */
export const CAPS = { voice: 12, noise: 4, loop: 6 } as const;

/** What a sound takes from the budget while it plays. */
export type Cost = Partial<Record<keyof typeof CAPS, number>>;

const used: Record<keyof typeof CAPS, number> = { voice: 0, noise: 0, loop: 0 };

/** Takes `cost` from the budget, or refuses (false) where it would go over a cap. */
export function claim(cost: Cost): boolean {
  const kinds = Object.keys(CAPS) as (keyof typeof CAPS)[];
  if (kinds.some((kind) => used[kind] + (cost[kind] ?? 0) > CAPS[kind])) {
    return false;
  }
  for (const kind of kinds) used[kind] += cost[kind] ?? 0;
  return true;
}

/** Gives `cost` back to the budget. */
export function release(cost: Cost): void {
  for (const kind of Object.keys(CAPS) as (keyof typeof CAPS)[]) {
    used[kind] = Math.max(0, used[kind] - (cost[kind] ?? 0));
  }
}

/** What the budget has given out now. */
export function inUse(): Record<keyof typeof CAPS, number> {
  return { ...used };
}

/**
 * A short sound within the budget: `build` makes it into an outlet of its own on `dest` and
 * returns its sources; once they have all ended the outlet is let go — nothing of the sound
 * stays wired — and `cost` goes back. False, and nothing made, where the budget has no room.
 */
export function capped(
  ctx: BaseAudioContext,
  dest: AudioNode,
  cost: Cost,
  build: (out: GainNode) => AudioScheduledSourceNode[],
): boolean {
  if (!claim(cost)) {
    return false;
  }
  const out = outlet(ctx, dest, 1);
  const done = (): void => {
    out.disconnect();
    release(cost);
  };
  try {
    const sources = build(out);
    if (sources.length === 0) done();
    else onAllEnded(sources, done);
    return true;
  } catch (error) {
    done();
    throw error;
  }
}

/** How long a prerendered loop runs before it repeats, s. */
export const LOOP_S = 4;

/**
 * Renders `build` once on an offline context into a loop `seconds` long at `rate`: two
 * periods are rendered and the second kept, so that the filters have settled. Everything a
 * loop is built from has to repeat within the period — whole cycles of every tone and of
 * every slow wander, and the shared noise's two seconds — and then the loop has no seam.
 */
export async function renderLoop(
  build: (ctx: BaseAudioContext, dest: AudioNode) => void,
  rate: number,
  seconds = LOOP_S,
): Promise<AudioBuffer> {
  const length = Math.round(rate * seconds);
  const ctx = new OfflineAudioContext(1, length * 2, rate);
  build(ctx, ctx.destination);
  const rendered = await ctx.startRendering();
  const loop = ctx.createBuffer(1, length, rate);
  loop.getChannelData(0).set(rendered.getChannelData(0).subarray(length, length * 2));
  return loop;
}

/** Renders `build` once on an offline context: a short sound, `seconds` long at `rate`. */
export async function renderOnce(
  build: (ctx: BaseAudioContext, dest: AudioNode) => void,
  rate: number,
  seconds: number,
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, Math.round(rate * seconds), rate);
  build(ctx, ctx.destination);
  return ctx.startRendering();
}

/** The sounds rendered so far, by name: null while one renders, or where it could not be. */
const rendered = new Map<string, AudioBuffer | null>();

/**
 * What `render` makes, rendered once and kept by `name` for the page's life; null while it
 * renders — it is asked for again next time — and for good where it could not be rendered, so
 * that a failing render is not tried ten times a second.
 */
function renderedOnce(name: string, render: () => Promise<AudioBuffer>): AudioBuffer | null {
  const known = rendered.get(name);
  if (known !== undefined) return known;
  rendered.set(name, null);
  render()
    .then((sound) => rendered.set(name, sound))
    .catch(() => undefined); // Deliberately silent: the sound is flavour, and stays unplayed.
  return null;
}

type Build = (ctx: BaseAudioContext, dest: AudioNode) => void;

/** The sample `name` that `build` makes, `seconds` long at `rate`; null while it renders. */
export function sampleOf(
  name: string,
  build: Build,
  seconds: number,
  rate: number,
): AudioBuffer | null {
  return renderedOnce(`sample ${name}`, () => renderOnce(build, rate, seconds));
}

/** The loop `name` that `build` makes, `seconds` long at `rate`; null while it renders. */
export function loopOf(name: string, build: Build, seconds: number, rate: number): AudioBuffer | null {
  return renderedOnce(`loop ${name}`, () => renderLoop(build, rate, seconds));
}

/**
 * Plays `sample` once into `dest` from `at`, `speed` times as fast, within the budget (a
 * voice): one source, unwired and given back as it ends. False where there is no room, or
 * no sample yet.
 */
export function playSample(
  ctx: BaseAudioContext,
  sample: AudioBuffer | null,
  dest: AudioNode,
  at: number,
  speed = 1,
): boolean {
  if (sample === null || !claim({ voice: 1 })) return false;
  const source = ctx.createBufferSource();
  source.buffer = sample;
  source.playbackRate.value = speed;
  source.connect(dest);
  source.onended = () => {
    source.disconnect();
    release({ voice: 1 });
  };
  source.start(at);
  return true;
}

/** A prerendered `loop` playing round and round into `dest` from `at`. */
export function playLoop(
  ctx: BaseAudioContext,
  loop: AudioBuffer,
  dest: AudioNode,
  at: number,
): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  source.buffer = loop;
  source.loop = true;
  source.connect(dest);
  source.start(at);
  return source;
}

/** Calls `done` once every one of `sources` has ended. */
export function onAllEnded(sources: readonly AudioScheduledSourceNode[], done: () => void): void {
  let pending = sources.length;
  for (const source of sources) {
    source.onended = () => {
      pending -= 1;
      if (pending === 0) done();
    };
  }
}

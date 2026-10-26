/**
 * audio.ts: the lab's one audio path, and its sound effects.
 *
 * The effects are recordings (samples.ts: ElevenLabs made them, scripts/sfx.ts), each played as
 * one buffer source into an outlet of its own; the radio's chain, its static and the two device
 * sounds whose pitch follows the game (puzzles/sounds.ts) are the only sounds still made here.
 * All levels are deliberately quiet because this plays under the players' voice chat, and every
 * sound passes through a single master gain, so the whole lab can be muted in one place. In
 * front of it sit the three volumes the settings set (settings.ts), each a bus: the effects —
 * this module's sounds, the partners' steps and the drones (spatial.ts) — and the radio —
 * mission control's voice (radioVoice.ts) and its key — straight into the master gain; the
 * rooms' beds (ambience.ts, at the effects' volume) and the music (music.ts) through the duck
 * bus, which mission control's voice pulls down while it speaks. This module also lends those
 * modules its small builders (gain stages, filters, a sample's source, the radio's noise).
 *
 * Audio is decorative, so no public function ever throws: errors are swallowed on purpose.
 * The one shared AudioContext is created lazily on first use. While browser autoplay policy
 * keeps it suspended, one-shot effects are skipped (so they cannot queue up and all fire at
 * once later) and the next user gesture resumes it. Loops started while suspended — the
 * beds, the music, a drone's buzz — are built anyway and become audible once it resumes. A
 * recording not loaded yet, or one that failed to load, is not played (samples.ts).
 */

import { censusOf, countGraph, type GraphCensus } from './audioCount.js';
import { traceRequested } from './frameTrace.js';
import { sample, sampleLoaded, type Sample, type SfxId } from './samples.js';

type AudioContextCtor = new () => AudioContext;

/** The shared context and the gain stages every sound of the lab ends in. */
export interface Engine {
  readonly ctx: AudioContext;
  /** Every sound in the module passes through this gain: the single mute point. */
  readonly master: GainNode;
  /** The beds and the music, in front of the master gain: ducked while mission control speaks. */
  readonly duck: GainNode;
  /** The effects at their volume, into the master gain: every sound but the radio and the music. */
  readonly effects: GainNode;
  /** The rooms' beds at the effects' volume, into the duck bus. */
  readonly beds: GainNode;
  /** The music at its volume, into the duck bus. */
  readonly music: GainNode;
  /** Mission control's voice and the radio's key at their volume, into the master gain. */
  readonly radio: GainNode;
}

/** The three volumes on the engine's buses, each a share of full (0 to 1). */
export interface BusVolumes {
  readonly radio: number;
  readonly effects: number;
  readonly music: number;
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
/** How quickly a bus follows its volume as a slider moves, s. */
const VOLUME_GLIDE = 0.05;
/** The own footstep's level; a partner's comes in at the same level, placed (spatial.ts). */
export const FOOTSTEP_LEVEL = 0.02;
/** How much louder a footstep lands at a sprint: about 2 dB. */
export const SPRINT_STEP_GAIN = 1.25;
/** A footstep's three takes, one at random each step, ±10 % in speed. */
export const STEP_TAKES: readonly [SfxId, ...SfxId[]] = ['step-1', 'step-2', 'step-3'];
const DOOR_LEVEL = 0.04;
const CHIRP_LEVEL = 0.03;
const FIND_LEVEL = 0.035;
const DRAIN_LEVEL = 0.05;
/**
 * Where the effects sit, as one level: the middle of their outlets (a door, a find, the
 * klaxon). A one-shot comes in with its peak at −3 dBFS (scripts/sfx.ts); the music is set
 * against this level (music.ts).
 */
export const EFFECTS_LEVEL = 0.04;

/** Exponential ramps cannot reach zero; this is -80 dB. */
export const SILENCE = 0.0001;
/** Scheduling headroom so main-thread jitter never clips the start of an envelope. */
export const LOOKAHEAD = 0.01;
const NOISE_SECONDS = 2;
const UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'keydown', 'touchend'] as const;

/**
 * The lab with its power on: the mains hum, a loop whose RMS stands at −20 dBFS (a bed's), at
 * a level that puts it about where the synthesised hum before it sat.
 */
const POWER_LEVEL = 0.1;
const POWER_FADE_IN = 0.8;
const POWER_FADE_OUT = 0.3;
/** How long the hum takes to die once the power goes, and how far it slows meanwhile. */
const POWER_DIE_SECONDS = 1.4;
const POWER_FALL = 0.25;
/** How deep the hum sags in each drop of the flicker. */
const POWER_SAG = 0.3;
const ARC_LEVEL = 0.03;
const BANG_LEVEL = 0.07;
const CLICK_LEVEL = 0.04;
/** The emergency lights' buzz after the relay's click, faint, and how long after it. */
const BUZZ_LEVEL = 0.02;
const BUZZ_AFTER = 0.08;
const LEVER_LEVEL = 0.06;
/** An arc in a drop of the flicker fades out this long after the drop, s. */
const ARC_TAIL = 0.03;

/** The alarm's klaxon. */
const KLAXON_LEVEL = 0.045;
/** A run lost to its alarms: the klaxon again and again, weaker and slower [s, strength, speed]. */
const KLAXON_FADING = [
  [0, 1, 1],
  [0.7, 0.55, 0.9],
  [1.4, 0.3, 0.8],
] as const;
/** The escape's siren: a loop at −20 dBFS RMS, under the effects' peaks. */
const SIREN_LEVEL = 0.3;
const SIREN_FADE_IN = 0.4;
const SIREN_FADE_OUT = 0.3;
const GRIND_LEVEL = 0.05;
/**
 * The briefing's count (Game.tsx): a beep at each of its numbers, s into it, and the higher one
 * as it lifts.
 */
const BRIEFING_BEEPS: readonly (readonly [number, SfxId])[] = [
  [0, 'countdown-beep'],
  [1.2, 'countdown-beep'],
  [2.4, 'countdown-beep'],
  [3.6, 'countdown-go'],
];

/** A loop that runs until it is stopped — the power hum, the siren: its source, fade and outlet. */
interface Loop {
  readonly source: AudioBufferSourceNode;
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
/** The power hum: playing, waiting for its recording (`pending`), or none. */
let powerHum: Loop | 'pending' | null = null;
let siren: Loop | null = null;
let muted = readStoredMute();
/** The buses' volumes: full until the settings set theirs (settings.ts, as the page starts). */
let volumes: BusVolumes = { radio: 1, effects: 1, music: 1 };
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
 * Sets the three volumes, each a share of full: on the engine's buses where it is made —
 * the effects' on its beds too — and for the engine still to come. Works before any sound has
 * been created; the mute switch stays above them all.
 */
export function setVolumes(next: BusVolumes): void {
  volumes = next;
  try {
    if (engine !== null) {
      const now = engine.ctx.currentTime;
      engine.effects.gain.setTargetAtTime(next.effects, now, VOLUME_GLIDE);
      engine.beds.gain.setTargetAtTime(next.effects, now, VOLUME_GLIDE);
      engine.music.gain.setTargetAtTime(next.music, now, VOLUME_GLIDE);
      engine.radio.gain.setTargetAtTime(next.radio, now, VOLUME_GLIDE);
    }
  } catch {
    // Deliberately silent: a volume must never break the game.
  }
}

/**
 * The effects' volume, a share of full: for the devices' sounds (puzzles/sounds.ts), which
 * play past the engine's buses.
 */
export function effectsVolume(): number {
  return volumes.effects;
}

/** How an effect plays: from when (audio time), how fast, and until when, if it is cut short. */
interface Play {
  readonly at?: number;
  readonly rate?: number;
  readonly until?: number;
}

/**
 * The recording `id` played once on the bus `bus` at `level`: one source into an outlet of its
 * own, which goes once the source has ended. Cut short with `until`, it fades out over
 * ARC_TAIL from there. Nothing while the context is held back, or where the recording is not
 * loaded; never throws.
 */
function effect(
  id: SfxId,
  bus: 'effects' | 'master' | 'radio',
  level: number,
  play: Play = {},
): void {
  try {
    const audio = runningEngine();
    const recording = sample(id);
    if (audio === null || recording === null) return;
    const { ctx } = audio;
    const out = outlet(ctx, audio[bus], level);
    const at = play.at ?? ctx.currentTime + LOOKAHEAD;
    const source = startSample(ctx, recording, out, at, play.rate);
    source.onended = () => out.disconnect();
    if (play.until !== undefined) {
      out.gain.setValueAtTime(level, play.until);
      out.gain.linearRampToValueAtTime(0, play.until + ARC_TAIL);
      source.stop(play.until + ARC_TAIL + 0.01);
    }
  } catch {
    // Deliberately silent: whatever the effect marks shows on screen as well.
  }
}

/** One of `items` at random. */
export function pick<T>(items: readonly [T, ...T[]]): T {
  return items[Math.floor(Math.random() * items.length)] ?? items[0];
}

/**
 * How fast the countdown's beep plays with `secondsLeft` 1–10 on the clock: as recorded at 10,
 * rising by 55 Hz in 620 — the pitch the synthesised beep had — with every second gone.
 */
export function beepRate(secondsLeft: number): number {
  return 1 + ((10 - Math.min(10, Math.max(1, secondsLeft))) * 55) / 620;
}

/**
 * One tick of the final countdown. `secondsLeft` 1-10 rises in pitch as the
 * clock runs out; 0 is the thunk of the breaker as the power goes.
 */
export function countdownBeep(secondsLeft: number): void {
  if (secondsLeft <= 0) {
    effect('breaker-thunk', 'effects', CHIRP_LEVEL);
    return;
  }
  effect('countdown-beep', 'effects', CHIRP_LEVEL, { rate: beepRate(secondsLeft) });
}

/**
 * The briefing's count, `elapsedMs` into it: a beep at each number it shows, the last higher as
 * it lifts — only those still ahead. A run that opens with the power on has no briefing, so
 * it never counts down to its surprise.
 */
export function briefingCountdown(elapsedMs = 0): void {
  const audio = playingEngine();
  if (audio === null) return;
  const t = audio.ctx.currentTime + LOOKAHEAD - elapsedMs / 1000;
  for (const [at, id] of BRIEFING_BEEPS) {
    if (t + at >= audio.ctx.currentTime) effect(id, 'effects', CHIRP_LEVEL, { at: t + at });
  }
}

/**
 * The own footstep: one of its three takes, ±10 % in speed, a little louder at a sprint, whose
 * steps also land faster (sim.ts); cheap enough for ~10 calls per second.
 */
export function footstep(sprinting = false): void {
  const level = FOOTSTEP_LEVEL * (sprinting ? SPRINT_STEP_GAIN : 1);
  effect(pick(STEP_TAKES), 'effects', level, { rate: rand(0.9, 1.1) });
}

/** A pneumatic door sliding open. */
export function doorSlide(): void {
  effect('door-slide', 'effects', DOOR_LEVEL);
}

/** A console's rising 'station ready' chirp. */
export function stationChirp(): void {
  effect('console-ready', 'effects', CHIRP_LEVEL);
}

/** A short bright blip marking a map ping, never to be taken for the station chirp. */
export function pingBlip(): void {
  effect('ping', 'effects', CHIRP_LEVEL);
}

/**
 * A soft rising two-note chime for a source the crew has just come across: rounder and lower
 * than the ping, so a find never sounds like somebody calling.
 */
export function discoveryBlip(): void {
  effect('discovery', 'effects', CHIRP_LEVEL);
}

/** A locker door swung open: the latch, then the thin clang of its sheet metal. */
export function lockerOpen(): void {
  effect('locker-open', 'effects', FIND_LEVEL);
}

/** A padlock coming off, then the drawer rolling out on its runners. */
export function cabinetUnlock(): void {
  effect('cabinet-unlock', 'effects', FIND_LEVEL);
}

/** A part delivered where it belongs — the fuse into its holder: a scrape and a snap. */
export function partSeated(): void {
  effect('part-seat', 'effects', FIND_LEVEL);
}

/** A sheet put down: the paper's swish, then the soft clack of the board meeting the desk. */
export function sheetDown(): void {
  effect('sheet-down', 'effects', FIND_LEVEL);
}

/** A book shut: the rush of air over the pages, then the dull clap of cover on block. */
export function coverShut(): void {
  effect('book-shut', 'effects', FIND_LEVEL);
}

/** A pencil taking a block down: three quick strokes of graphite on paper. */
export function pencilScratch(): void {
  effect('pencil', 'effects', CHIRP_LEVEL, { rate: rand(0.92, 1.08) });
}

/**
 * Mission control keying the radio: a crackle and the press-to-talk key's click. Only for a
 * line no recording speaks — a custom mission's, a note of the last shift: a recorded line
 * keys its own squelch (radioVoice.ts).
 */
export function radioChirp(): void {
  effect('radio-key', 'radio', CHIRP_LEVEL);
}

/**
 * The power draining away, for penalties and the lights failing: a whine sagging into the
 * dark. `delaySec` puts it later on the audio clock.
 */
export function powerDrain(delaySec = 0): void {
  const audio = playingEngine();
  if (audio === null) return;
  const at = audio.ctx.currentTime + LOOKAHEAD + delaySec;
  effect('power-down', 'effects', DRAIN_LEVEL, { at });
}

/**
 * Idempotent. The lab with its power on (the cold open, coldOpen.ts): the mains hum under
 * everything, fading in over ~0.8 s, until the lights fail or `stopPowerHum` ends it. Where its
 * recording is still loading, it starts once it has, if it is still wanted then.
 */
export function startPowerHum(): void {
  try {
    if (powerHum !== null) return;
    const audio = getEngine();
    if (audio === null || audio.ctx.state === 'closed') return;
    unlock();
    const now = buildLoop(audio, sample('mains-hum'), POWER_LEVEL, POWER_FADE_IN);
    if (now !== null) {
      powerHum = now;
      return;
    }
    powerHum = 'pending';
    void sampleLoaded('mains-hum').then((recording) => {
      if (powerHum === 'pending') {
        powerHum = buildLoop(audio, recording, POWER_LEVEL, POWER_FADE_IN);
      }
    });
  } catch {
    // Deliberately silent: the lit lab still looks lit.
  }
}

/** Fades the power hum out in ~0.3 s and stops it. Safe when none plays. */
export function stopPowerHum(): void {
  try {
    const hum = powerHum;
    powerHum = null;
    if (hum !== null && hum !== 'pending' && engine !== null) {
      fadeAway(hum, engine.ctx.currentTime, POWER_FADE_OUT);
    }
  } catch {
    // Deliberately silent: the hum's nodes are released with the context at the latest.
  }
}

/**
 * The lights failing, scheduled at once on the audio clock: contacts arcing in every drop of
 * the flicker while the power hum sags with it, then the breaker's thunk, the hum dying as it
 * slows and the power draining away, the emergency relay's click and the emergency lights'
 * buzz.
 */
export function blackoutSounds(cue: BlackoutCue): void {
  try {
    const hum = powerHum === 'pending' ? null : powerHum;
    powerHum = null;
    const audio = runningEngine();
    if (audio === null) {
      if (hum !== null && engine !== null) windDown(hum, engine.ctx.currentTime, 0.05, 1);
      return;
    }
    const t = audio.ctx.currentTime + LOOKAHEAD;
    if (hum !== null) {
      sag(hum.level.gain, t, cue.drops);
      windDown(hum, t + cue.bang, POWER_DIE_SECONDS, POWER_FALL);
    }
    for (const [from, to] of cue.drops) {
      effect('short-arc', 'master', ARC_LEVEL, { at: t + from, until: t + to });
    }
    effect('breaker-thunk', 'master', BANG_LEVEL, { at: t + cue.bang });
    effect('power-down', 'effects', DRAIN_LEVEL, { at: t + cue.bang });
    effect('relay-click', 'master', CLICK_LEVEL, { at: t + cue.click });
    effect('emergency-buzz', 'master', BUZZ_LEVEL, { at: t + cue.click + BUZZ_AFTER });
  } catch {
    // Deliberately silent: the lights fail on screen as well.
  }
}

/** A heavy main switch thrown home: the latch letting go, then the lever's chunk into its stop. */
export function leverChunk(): void {
  effect('lever-chunk', 'effects', LEVER_LEVEL);
}

/** A short klaxon for an alarm: two harsh blasts of a horn. */
export function klaxon(): void {
  effect('klaxon', 'effects', KLAXON_LEVEL);
}

/**
 * The klaxon of a run lost to its alarms: blasting again and again, each time weaker and
 * slower, as the emergency supply gives out.
 */
export function klaxonFade(): void {
  const audio = playingEngine();
  if (audio === null) return;
  const t = audio.ctx.currentTime + LOOKAHEAD;
  for (const [after, strength, rate] of KLAXON_FADING) {
    effect('klaxon', 'effects', KLAXON_LEVEL * strength, { at: t + after, rate });
  }
}

/** A room's lights coming on: the relay pulling in, then the tubes striking. */
export function lightsOnClick(): void {
  const audio = playingEngine();
  if (audio === null) return;
  const t = audio.ctx.currentTime + LOOKAHEAD;
  effect('relay-click', 'master', CLICK_LEVEL, { at: t });
  effect('tube-strike', 'master', CLICK_LEVEL * 0.6, { at: t + 0.12 });
}

/**
 * Idempotent. The escape's siren: two tones taking turns, looping quietly under everything —
 * fading in over ~0.4 s — until `stopSiren` ends it.
 */
export function startSiren(): void {
  try {
    if (siren !== null) return;
    const audio = getEngine();
    if (audio === null || audio.ctx.state === 'closed') return;
    unlock();
    siren = buildLoop(audio, sample('siren'), SIREN_LEVEL, SIREN_FADE_IN);
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
      fadeAway(current, engine.ctx.currentTime, SIREN_FADE_OUT);
    }
  } catch {
    // Deliberately silent: the siren's nodes are released with the context at the latest.
  }
}

/** The hatch grinding open: steel on steel over a straining motor, the leaves striking home. */
export function exitGrind(): void {
  effect('hatch-grind', 'effects', GRIND_LEVEL);
}

/** The recording `loop` playing round and round on the effects' bus at `level`, fading in. */
function buildLoop(audio: Engine, loop: Sample | null, level: number, fadeIn: number): Loop | null {
  if (loop === null) return null;
  const { ctx } = audio;
  const t = ctx.currentTime;
  const out = outlet(ctx, audio.effects, level);
  const fade = gain(ctx, 0);
  fade.gain.setValueAtTime(0, t);
  fade.gain.linearRampToValueAtTime(1, t + fadeIn);
  fade.connect(out);
  return { source: playLoop(ctx, loop.buffer, fade, t), level: fade, out };
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

/** A loop fades out from now over `seconds`, from where it stands, and stops. */
function fadeAway(loop: Loop, now: number, seconds: number): void {
  const level = loop.level.gain.value;
  loop.level.gain.cancelScheduledValues(now);
  windDown(loop, now, seconds, 1, level);
}

/**
 * The loop dies from `at` over `seconds`, from `level` down to silence, slowing to `fall` times
 * its speed — its hum falling in pitch — and stops.
 */
function windDown(loop: Loop, at: number, seconds: number, fall: number, level = 1): void {
  const end = at + seconds;
  loop.level.gain.setValueAtTime(Math.max(SILENCE, level), at);
  loop.level.gain.exponentialRampToValueAtTime(SILENCE, end);
  loop.source.playbackRate.setValueAtTime(1, at);
  loop.source.playbackRate.exponentialRampToValueAtTime(fall, end);
  loop.source.onended = () => loop.out.disconnect();
  loop.source.stop(end + 0.02);
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
    const duck = outlet(ctx, master, 1);
    return {
      ctx,
      master,
      duck,
      effects: outlet(ctx, master, volumes.effects),
      beds: outlet(ctx, duck, volumes.effects),
      music: outlet(ctx, duck, volumes.music),
      radio: outlet(ctx, master, volumes.radio),
    };
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

/** Two seconds of white noise, made once: the static under the radio's voice. */
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

/** The shared noise looped, started at `at`: the radio's static. */
export function noiseLoop(ctx: BaseAudioContext, at: number): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx);
  source.loop = true;
  source.start(at);
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
 * spatial.ts) keep alive at once: voices — the sources of short sounds, each a recording
 * played once — live noise, the shared noise through live filters, which none of them plays
 * any more, and loops — a bed's layer, the rotor, a stem of the music with its seam. A sound
 * with no room left is not played; a loop that was refused is tried again on the next round.
 * Mission control's voice and the effects are not counted: they were the lab's before, and
 * are short.
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
 * A short sound within the budget: `build` makes it into an outlet of its own on `dest`, at
 * `level`, and returns its sources; once they have all ended the outlet is let go — nothing of
 * the sound stays wired — and `cost` goes back. False, and nothing made, where the budget has
 * no room.
 */
export function capped(
  ctx: BaseAudioContext,
  dest: AudioNode,
  cost: Cost,
  build: (out: GainNode) => AudioScheduledSourceNode[],
  level = 1,
): boolean {
  if (!claim(cost)) {
    return false;
  }
  const out = outlet(ctx, dest, level);
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

/**
 * A source playing `recording` once into `dest` from `at`, `rate` times as fast, from where its
 * sound starts (its `start`, past the silence before it).
 */
export function startSample(
  ctx: BaseAudioContext,
  recording: Sample,
  dest: AudioNode,
  at: number,
  rate = 1,
): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  source.buffer = recording.buffer;
  source.playbackRate.value = rate;
  source.connect(dest);
  source.start(at, recording.start);
  return source;
}

/**
 * Plays `recording` once into `dest` from `at`, `speed` times as fast, within the budget (a
 * voice): one source, unwired and given back as it ends. False where there is no room, or
 * no recording loaded.
 */
export function playSample(
  ctx: BaseAudioContext,
  recording: Sample | null,
  dest: AudioNode,
  at: number,
  speed = 1,
): boolean {
  if (recording === null || !claim({ voice: 1 })) return false;
  const source = startSample(ctx, recording, dest, at, speed);
  source.onended = () => {
    source.disconnect();
    release({ voice: 1 });
  };
  return true;
}

/** A recorded `loop` playing round and round into `dest` from `at`: a seamless loop, all of it. */
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

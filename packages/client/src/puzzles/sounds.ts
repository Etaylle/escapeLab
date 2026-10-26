/**
 * sounds.ts: what the devices sound like — every press, snip, clack and alarm at a station,
 * recorded (world/samples.ts: ElevenLabs made them, scripts/sfx.ts) and played on the one
 * AudioContext the game shares (`sharedAudio`). Two sounds are still made here from
 * oscillators, because the game sets their pitch: the meter's hum, rising with the voltage it
 * reads, and the colour game's tones, one pitch a colour — they carry what the crew has to
 * hear. Quiet on purpose: it all plays under the crew's voices.
 *
 * Decorative, so nothing here throws, and nothing is made while the sound is off
 * (`isMuted`), without Web Audio, or while the browser still holds the context back: a sound
 * that cannot play now is dropped, never queued to burst out later; one whose recording is not
 * loaded is not played (samples.ts). Every sound plays at the effects' volume the settings set
 * (`effectsVolume`). The device hum is the one sound that lasts; it follows the sound switch
 * and that volume while it runs.
 */
import type { SimonColor } from '@escapelab/core';
import { effectsVolume, isMuted, sharedAudio } from '../world/audio.js';
import { sample, type Sample, type SfxId } from '../world/samples.js';

/** Exponential ramps cannot reach zero; this is -80 dB. */
const SILENCE = 0.0001;
/** Scheduling headroom, so that main-thread jitter never clips the start of an envelope. */
const LOOKAHEAD = 0.01;

/** Gain envelope: linear attack to `peak`, flat hold, then exponential decay to silence. */
interface Envelope {
  readonly peak: number;
  readonly attack: number;
  readonly hold: number;
  readonly decay: number;
}

/** An enveloped oscillator from `at`, its pitch gliding exponentially from `from` to `to`. */
interface Voice extends Envelope {
  readonly type: OscillatorType;
  readonly at: number;
  readonly from: number;
  readonly to: number;
}

/** What one made sound schedules into its outlet from `at`: the sources that make it. */
type Build = (ctx: AudioContext, out: AudioNode, at: number) => AudioScheduledSourceNode[];

/**
 * The audio clock time before which an alarm's klaxon waits: a reject's buzz or a short's
 * arc is heard first, the alarm after it.
 */
let alarmFrom = 0;

/** The context, where a sound can play right now: sound on, Web Audio there and running. */
function live(): AudioContext | null {
  if (isMuted()) {
    return null;
  }
  const ctx = sharedAudio();
  return ctx !== null && ctx.state === 'running' ? ctx : null;
}

/** An outlet at `level` times the effects' volume, into the context's output. */
function outletAt(ctx: AudioContext, level: number): GainNode {
  const out = gain(ctx, level * effectsVolume());
  out.connect(ctx.destination);
  return out;
}

/** When a recording plays: `delay` s from now, and never before the audio time `notBefore`. */
interface When {
  readonly delay?: number;
  readonly notBefore?: number;
}

/**
 * Plays the recording `id` once at `level`: one source into an outlet of its own, which goes as
 * the source ends. Returns when it starts, audio time; null where it cannot play now.
 */
function play(id: SfxId, level: number, when: When = {}): number | null {
  try {
    const ctx = live();
    const recording = sample(id);
    if (ctx === null || recording === null) {
      return null;
    }
    const out = outletAt(ctx, level);
    const at = Math.max(ctx.currentTime + LOOKAHEAD + (when.delay ?? 0), when.notBefore ?? 0);
    const source = ctx.createBufferSource();
    source.buffer = recording.buffer;
    source.connect(out);
    source.start(at, recording.start);
    source.onended = () => out.disconnect();
    return at;
  } catch {
    // Deliberately silent: whatever a device does, it shows as well.
    return null;
  }
}

/** Makes one sound at `level`: `build` schedules it, and its outlet goes once its sources end. */
function sound(level: number, build: Build): void {
  try {
    const ctx = live();
    if (ctx === null) {
      return;
    }
    const out = outletAt(ctx, level);
    const sources = build(ctx, out, ctx.currentTime + LOOKAHEAD);
    let playing = sources.length;
    for (const source of sources) {
      source.onended = () => {
        playing -= 1;
        if (playing === 0) {
          out.disconnect();
        }
      };
    }
  } catch {
    // Deliberately silent: whatever a device does, it shows as well.
  }
}

function gain(ctx: BaseAudioContext, value: number): GainNode {
  const node = ctx.createGain();
  node.gain.value = value;
  return node;
}

/** `q` is a linear Q for a band but a resonance in dB for a lowpass (a Web Audio quirk). */
function filter(
  ctx: BaseAudioContext,
  type: BiquadFilterType,
  frequency: number,
  q: number,
): BiquadFilterNode {
  const node = ctx.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.Q.value = q;
  return node;
}

/** Schedules `env` on `param` from `at`; returns the time it has fallen silent. */
function envelope(param: AudioParam, at: number, env: Envelope): number {
  const peakAt = at + env.attack;
  const end = peakAt + env.hold + env.decay;
  param.setValueAtTime(0, at);
  param.linearRampToValueAtTime(env.peak, peakAt);
  param.setValueAtTime(env.peak, peakAt + env.hold);
  param.exponentialRampToValueAtTime(SILENCE, end);
  return end;
}

function voice(ctx: BaseAudioContext, dest: AudioNode, spec: Voice): OscillatorNode {
  const osc = ctx.createOscillator();
  osc.type = spec.type;
  const level = gain(ctx, 0);
  const end = envelope(level.gain, spec.at, spec);
  osc.frequency.setValueAtTime(spec.from, spec.at);
  osc.frequency.exponentialRampToValueAtTime(spec.to, end);
  osc.connect(level).connect(dest);
  osc.start(spec.at);
  osc.stop(end + 0.01);
  return osc;
}

/** A plain tone at `frequency` from `at`: steady pitch, the envelope the rest. */
function steady(type: OscillatorType, at: number, frequency: number, env: Envelope): Voice {
  return { type, at, from: frequency, to: frequency, ...env };
}

// --- the kit: every device ------------------------------------------------------------------

/** A key going down: a dry tick with a bright edge. */
export function keyClick(): void {
  play('key-click', 0.05);
}

/** How long a refused press buzzes, s: an alarm after it waits until it is over. */
export const BUZZ_S = 0.16;

/** A refused input: a dull buzz. An alarm after it waits until it is over. */
export function rejectBuzz(): void {
  const at = play('reject-buzz', 0.05);
  if (at !== null) {
    alarmFrom = Math.max(alarmFrom, at + BUZZ_S);
  }
}

/** A penalty: the klaxon, after any buzz or arc before it. */
export function alarmKlaxon(): void {
  play('klaxon', 0.05, { notBefore: alarmFrom });
}

/** Solved: the heavy „ka-chunk" of a lock going home — the latch, then the bolt's thud and ring. */
export function solvedChunk(): void {
  play('solved-chunk', 0.075);
}

/** How long after the chunk its chord comes in, s. */
const CHORD_AFTER = 0.14;

/** A bright major chord strummed after the chunk: done. */
export function solvedChord(): void {
  play('solved-chord', 0.035, { delay: CHORD_AFTER });
}

/** A device switching on: its relay pulling in, a dry click with a knock under it. */
export function relayClick(): void {
  play('relay-click', 0.045);
}

/** A sound that lasts until it is stopped. */
export interface Hum {
  stop(): void;
}

const NO_HUM: Hum = { stop: () => undefined };
/** The device hum's level: the mains hum's loop, its RMS at −20 dBFS, soft under everything. */
export const HUM_LEVEL = 0.12;
const HUM_FADE = 0.15;
/** How often a running hum looks at the sound switch, in ms. */
const HUM_WATCH_MS = 250;

/**
 * An open device's hum — the mains hum's loop — fading in over 150 ms until `stop` fades it
 * out. Built even while the browser holds the context back — it sounds as soon as the context
 * runs — but not with the sound off or before its recording has loaded; while it runs it falls
 * silent and comes back with the sound switch.
 */
export function startHum(): Hum {
  try {
    const recording = sample('mains-hum');
    if (isMuted() || recording === null) {
      return NO_HUM;
    }
    const ctx = sharedAudio();
    return ctx === null || ctx.state === 'closed' ? NO_HUM : buildHum(ctx, recording);
  } catch {
    // Deliberately silent: a device without its hum still works.
    return NO_HUM;
  }
}

/** The hum's level now: none with the sound off, else at the effects' volume. */
const humLevel = (): number => (isMuted() ? 0 : HUM_LEVEL * effectsVolume());

function buildHum(ctx: AudioContext, recording: Sample): Hum {
  const t = ctx.currentTime;
  const out = gain(ctx, 0);
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(humLevel(), t + HUM_FADE);
  out.connect(ctx.destination);
  const loop = ctx.createBufferSource();
  loop.buffer = recording.buffer;
  loop.loop = true;
  loop.connect(out);
  loop.start(t);
  let level = humLevel();
  const watch = setInterval(() => {
    try {
      if (humLevel() !== level) {
        level = humLevel();
        out.gain.setTargetAtTime(level, ctx.currentTime, 0.05);
      }
    } catch {
      // Deliberately silent: the hum keeps the level it has.
    }
  }, HUM_WATCH_MS);
  let stopped = false;
  return {
    stop: () => {
      if (stopped) {
        return;
      }
      stopped = true;
      clearInterval(watch);
      fadeOut(ctx, out, loop);
    },
  };
}

/** Fades a hum's outlet out and stops its loop; the outlet goes once the loop has ended. */
function fadeOut(ctx: BaseAudioContext, out: GainNode, loop: AudioBufferSourceNode): void {
  try {
    const now = ctx.currentTime;
    out.gain.cancelScheduledValues(now);
    out.gain.setValueAtTime(out.gain.value, now);
    out.gain.linearRampToValueAtTime(0, now + HUM_FADE);
    loop.onended = () => out.disconnect();
    loop.stop(now + HUM_FADE + 0.02);
  } catch {
    // Deliberately silent: the hum's nodes go with the context at the latest.
  }
}

// --- the devices' own -----------------------------------------------------------------------

/** A toggle snapping over: the bat's tick and its knock in the panel. */
export function toggleClack(): void {
  play('toggle-clack', 0.065);
}

/** A big button going down: a low thump with a muffled knock. */
export function buttonThunk(): void {
  play('button-thunk', 0.075);
}

/** The mushroom button stamped down: a heavier, deeper thunk. */
export function mushroomStomp(): void {
  play('mushroom-stomp', 0.085);
}

/** The main switch's own lever pulled down into its catch: a ratchet's tick, then its clunk. */
export function leverPull(): void {
  play('lever-pull', 0.07);
}

/** The lever springing back up, its press run out: the catch's clack, the spring's twang. */
export function leverSpring(): void {
  play('lever-spring', 0.065);
}

/** Pliers through a cable: a crisp snip, the jaws meeting. */
export function pliersSnip(): void {
  play('wire-snip', 0.06);
}

/** Sparks off a cut: crackles dying down. */
export function sparkCrackle(): void {
  play('spark', 0.045);
}

/** How long a short arcs, s: the alarm after it waits until it is over. */
export const ARC_S = 0.28;

/** A short in the box: a rasping arc with crackles; the alarm waits for it. */
export function shortArc(): void {
  const at = play('short-arc', 0.06);
  if (at !== null) {
    alarmFrom = Math.max(alarmFrom, at + ARC_S);
  }
}

/** The probe's tip on a terminal: a crisp contact click. */
export function probeClick(): void {
  play('probe-click', 0.05);
}

/** The pitch a measured voltage hums at, in Hz: 60 Hz up to 435 Hz at 250 V; null for 0 V. */
export function voltagePitch(volts: number): number | null {
  return volts <= 0 ? null : 60 + Math.min(volts, 250) * 1.5;
}

/**
 * A measurement's hum, ~0.8 s, its pitch rising with the voltage as the needle swings up to
 * it; nothing for a dead wire. Made, not recorded: its pitch is the reading.
 */
export function voltageHum(volts: number): void {
  const pitch = voltagePitch(volts);
  if (pitch === null) {
    return;
  }
  sound(0.03, (ctx, out, at) => {
    const lowpass = filter(ctx, 'lowpass', pitch * 4, 1);
    lowpass.connect(out);
    // Each voice glides up the last 8 % to its pitch, as the needle settles on its reading.
    const rising = (type: OscillatorType, octave: number, peak: number): Voice => ({
      type,
      at,
      from: pitch * octave * 0.92,
      to: pitch * octave,
      peak,
      attack: 0.06,
      hold: 0.32,
      decay: 0.42,
    });
    return [
      voice(ctx, lowpass, rising('sawtooth', 1, 0.8)),
      voice(ctx, lowpass, rising('sine', 2, 0.3)),
    ];
  });
}

/** A stage done: a glassy two-note chime rising a fifth. */
export function stageChime(): void {
  play('stage-chime', 0.035);
}

/** A dial turning one step: its detent catching, a soft tick with a little body. */
export function dialDetent(): void {
  play('dial-detent', 0.045);
}

/** A marker's step on the grid: a small, bright tick. */
export function stepTick(): void {
  play('step-tick', 0.035);
}

/** The marker against a wall: a dull thud. */
export function wallThud(): void {
  play('wall-thud', 0.08);
}

/**
 * The four tones of the classic colour game, an A major chord over E: blue E4, red A4,
 * yellow C♯5, green E5.
 */
export const SIMON_TONES: Record<SimonColor, number> = {
  blau: 329.63,
  rot: 440,
  gelb: 554.37,
  gruen: 659.25,
};

/**
 * A colour's tone, `seconds` long: buzzy like the game's, rounded off by a lowpass. Made, not
 * recorded: its pitch is the colour, its length the game's.
 */
export function simonTone(colour: SimonColor, seconds: number): void {
  sound(0.04, (ctx, out, at) => {
    const lowpass = filter(ctx, 'lowpass', 2200, 0.5);
    lowpass.connect(out);
    const env = { peak: 0.7, attack: 0.008, hold: Math.max(0, seconds - 0.05), decay: 0.04 };
    return [voice(ctx, lowpass, steady('square', at, SIMON_TONES[colour], env))];
  });
}

/** A lamp coming on: a soft pop. */
export function lampPop(): void {
  play('lamp-pop', 0.04);
}

/** A display taking a character: a short beep. */
export function typeBlip(): void {
  play('type-blip', 0.03);
}

/** A terminal's line coming up OK: two soft, short beeps rising. */
export function okChime(): void {
  play('ok-beeps', 0.03);
}

/** A server in the rack spinning up: its drive's whine gliding up over its fans. */
export function spinUp(): void {
  play('server-spinup', 0.035);
}

/** A second held on the big button: a faint tick. */
export function holdTick(): void {
  play('hold-tick', 0.025);
}

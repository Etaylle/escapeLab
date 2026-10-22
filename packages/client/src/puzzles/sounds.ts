/**
 * sounds.ts: what the devices sound like — every press, snip, clack and alarm at a station,
 * made at runtime from oscillators, filters and noise like the lab's own (world/audio.ts),
 * on the one AudioContext the game shares (`sharedAudio`). No audio files. Quiet on purpose:
 * it all plays under the crew's voices.
 *
 * Decorative, so nothing here throws, and nothing is made while the sound is off
 * (`isMuted`), without Web Audio, or while the browser still holds the context back: a sound
 * that cannot play now is dropped, never queued to burst out later. The device hum is the
 * one sound that lasts; it follows the sound switch while it runs.
 */
import type { SimonColor } from '@escapelab/core';
import { isMuted, sharedAudio } from '../world/audio.js';

/** Exponential ramps cannot reach zero; this is -80 dB. */
const SILENCE = 0.0001;
/** Scheduling headroom, so that main-thread jitter never clips the start of an envelope. */
const LOOKAHEAD = 0.01;
/** How much noise the bursts are cut from, in seconds. */
const NOISE_SECONDS = 1;

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

/** A burst of noise from `at`, `duration` long, through a filter, falling away from `peak`. */
interface Hiss {
  readonly at: number;
  readonly duration: number;
  readonly filter: BiquadFilterType;
  readonly frequency: number;
  readonly q: number;
  readonly peak: number;
}

/** What one sound schedules into its outlet from `at`: the sources that make it. */
type Build = (ctx: AudioContext, out: AudioNode, at: number) => AudioScheduledSourceNode[];

/** [frequency ratio, level, decay in s] of the partials of a struck bit of steel. */
const RING = [
  [1, 1, 0.45],
  [2.76, 0.6, 0.28],
  [5.4, 0.35, 0.16],
] as const;

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

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

/** Makes one sound at `level`: `build` schedules it, and its outlet goes once its sources end. */
function sound(level: number, build: Build): void {
  try {
    const ctx = live();
    if (ctx === null) {
      return;
    }
    const out = gain(ctx, level);
    out.connect(ctx.destination);
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

/** One second of white noise per context, cut into every burst at a random offset. */
function noiseOf(ctx: BaseAudioContext): AudioBuffer {
  const made = noiseBuffers.get(ctx);
  if (made !== undefined) {
    return made;
  }
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * NOISE_SECONDS), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  noiseBuffers.set(ctx, buffer);
  return buffer;
}

function hiss(ctx: BaseAudioContext, dest: AudioNode, spec: Hiss): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  const buffer = noiseOf(ctx);
  source.buffer = buffer;
  const level = gain(ctx, 0);
  envelope(level.gain, spec.at, {
    peak: spec.peak,
    attack: 0.001,
    hold: 0,
    decay: spec.duration - 0.001,
  });
  source.connect(filter(ctx, spec.filter, spec.frequency, spec.q)).connect(level).connect(dest);
  // A random offset into the noise keeps repeats of a sound from sounding alike.
  const offset = Math.random() * Math.max(0, buffer.duration - spec.duration);
  source.start(spec.at, offset, spec.duration);
  return source;
}

/** A dry mechanical tick, ~25 ms: a sliver of noise through a narrow band. */
function tick(
  ctx: BaseAudioContext,
  dest: AudioNode,
  at: number,
  frequency: number,
  peak: number,
): AudioBufferSourceNode {
  return hiss(ctx, dest, { at, duration: 0.025, filter: 'bandpass', frequency, q: 3, peak });
}

/** A struck bit of steel ringing on: sine partials of `base`, each dying at its own pace. */
function ring(
  ctx: BaseAudioContext,
  dest: AudioNode,
  at: number,
  base: number,
  peak: number,
): OscillatorNode[] {
  return RING.map(([ratio, level, decay]) =>
    voice(ctx, dest, {
      type: 'sine',
      at,
      from: base * ratio,
      to: base * ratio,
      peak: peak * level,
      attack: 0.002,
      hold: 0,
      decay,
    }),
  );
}

/** A plain tone at `frequency` from `at`: steady pitch, the envelope the rest. */
function steady(type: OscillatorType, at: number, frequency: number, env: Envelope): Voice {
  return { type, at, from: frequency, to: frequency, ...env };
}

/** A knock of dark noise from `at`: a lowpassed burst `duration` long, falling from `peak`. */
function knock(at: number, duration: number, frequency: number, peak: number): Hiss {
  return { at, duration, filter: 'lowpass', frequency, q: 0, peak };
}

/** The middle of a heavy hit's mid band, Hz, and how wide: Q 0.9 spans about 300 to 900 Hz. */
export const MID_BAND = 520;
const MID_Q = 0.9;

/**
 * A heavy hit's mid layer from `at`: noise in the band from about 300 to 900 Hz, `duration`
 * long, falling from `peak` — what a phone's or a laptop's small speaker still plays of a
 * blow whose thud lies under 150 Hz.
 */
function body(at: number, duration: number, peak: number): Hiss {
  return { at, duration, filter: 'bandpass', frequency: MID_BAND, q: MID_Q, peak };
}

// --- the kit: every device ------------------------------------------------------------------

/** A key going down: a dry tick with a bright edge, ~25 ms. */
export function keyClick(): void {
  sound(0.05, (ctx, out, at) => [
    tick(ctx, out, at, 3600, 0.9),
    voice(ctx, out, { type: 'sine', at, from: 2100, to: 1700, ...short(0.25, 0.018) }),
  ]);
}

/** The buzzer's pitch, Hz: a square an octave over its old 92, that small speakers still play. */
export const BUZZ_HZ = 184;
/** What the buzzer's square is rounded off by, Hz: a lowpass that keeps its buzz in the mids. */
export const BUZZ_LOWPASS_HZ = 1200;

/** A refused input: a dull buzz, 160 ms. An alarm after it waits until it is over. */
export function rejectBuzz(): void {
  sound(0.05, (ctx, out, at) => {
    const lowpass = filter(ctx, 'lowpass', BUZZ_LOWPASS_HZ, 1);
    lowpass.connect(out);
    alarmFrom = Math.max(alarmFrom, at + 0.16);
    // The square sagging a little, a fifth over it for its rasp.
    const buzz = (pitch: number, peak: number): Voice => ({
      type: 'square',
      at,
      from: pitch,
      to: pitch * 0.96,
      peak,
      attack: 0.004,
      hold: 0.12,
      decay: 0.035,
    });
    return [
      voice(ctx, lowpass, buzz(BUZZ_HZ, 0.8)),
      voice(ctx, lowpass, buzz(BUZZ_HZ * 1.5, 0.25)),
    ];
  });
}

/** [delay in s, pitch in Hz] of the klaxon's two tones: G5 falling to D5. */
const KLAXON = [
  [0, 784],
  [0.17, 587],
] as const;

/** A penalty: a short klaxon of two falling tones, 350 ms, after any buzz or arc before it. */
export function alarmKlaxon(): void {
  sound(0.05, (ctx, out, at) => {
    const start = Math.max(at, alarmFrom);
    const lowpass = filter(ctx, 'lowpass', 2600, 0.7);
    lowpass.connect(out);
    const env = { attack: 0.006, hold: 0.13, decay: 0.03 };
    return KLAXON.flatMap(([delay, pitch]) => [
      voice(ctx, lowpass, steady('square', start + delay, pitch, { peak: 0.6, ...env })),
      voice(ctx, lowpass, steady('sawtooth', start + delay, pitch * 1.006, { peak: 0.35, ...env })),
    ]);
  });
}

/** Solved: the heavy „ka-chunk" of a lock going home — the latch, then the bolt's thud and ring. */
export function solvedChunk(): void {
  sound(0.075, (ctx, out, at) => {
    const home = at + 0.1;
    return [
      tick(ctx, out, at, 1900, 0.8),
      voice(ctx, out, { type: 'sine', at: home, from: 125, to: 46, ...long(1, 0.02, 0.3) }),
      hiss(ctx, out, knock(home, 0.09, 750, 0.8)),
      hiss(ctx, out, body(home, 0.13, 0.7)),
      ...ring(ctx, out, home, 170, 0.45),
    ];
  });
}

/** C major (C5 E5 G5 C6) strummed after the chunk, ~0.8 s: done. */
export function solvedChord(): void {
  sound(0.035, (ctx, out, at) =>
    [523.25, 659.26, 783.99, 1046.5].map((pitch, i) =>
      voice(
        ctx,
        out,
        steady('triangle', at + 0.14 + i * 0.03, pitch, {
          peak: 0.55,
          attack: 0.012,
          hold: 0.08,
          decay: 0.55,
        }),
      ),
    ),
  );
}

/** A device switching on: its relay pulling in, a dry click with a knock under it. */
export function relayClick(): void {
  sound(0.045, (ctx, out, at) => [
    tick(ctx, out, at, 2600, 0.9),
    voice(ctx, out, { type: 'sine', at, from: 160, to: 110, ...short(0.5, 0.05) }),
  ]);
}

/** A sound that lasts until it is stopped. */
export interface Hum {
  stop(): void;
}

const NO_HUM: Hum = { stop: () => undefined };
/** The device hum's level: soft, under everything. */
export const HUM_LEVEL = 0.05;
/** [frequency, level]: the mains under a transformer's 100 Hz and its overtones. */
const HUM_VOICES = [
  [50, 0.25],
  [100, 0.6],
  [200, 0.22],
  [300, 0.08],
] as const;
const HUM_FADE = 0.15;
/** How often a running hum looks at the sound switch, in ms. */
const HUM_WATCH_MS = 250;

/**
 * An open device's hum, fading in over 150 ms until `stop` fades it out. Built even while the
 * browser holds the context back — it sounds as soon as the context runs — but not with the
 * sound off; while it runs it falls silent and comes back with the sound switch.
 */
export function startHum(): Hum {
  try {
    if (isMuted()) {
      return NO_HUM;
    }
    const ctx = sharedAudio();
    return ctx === null || ctx.state === 'closed' ? NO_HUM : buildHum(ctx);
  } catch {
    // Deliberately silent: a device without its hum still works.
    return NO_HUM;
  }
}

function buildHum(ctx: AudioContext): Hum {
  const t = ctx.currentTime;
  const out = gain(ctx, 0);
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(HUM_LEVEL, t + HUM_FADE);
  const lowpass = filter(ctx, 'lowpass', 380, 0);
  lowpass.connect(out);
  out.connect(ctx.destination);
  const voices = HUM_VOICES.map(([frequency, level]) => {
    const osc = ctx.createOscillator();
    osc.frequency.value = frequency;
    osc.connect(gain(ctx, level)).connect(lowpass);
    osc.start(t);
    return osc;
  });
  let silenced = false;
  const watch = setInterval(() => {
    try {
      if (isMuted() !== silenced) {
        silenced = !silenced;
        out.gain.setTargetAtTime(silenced ? 0 : HUM_LEVEL, ctx.currentTime, 0.05);
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
      fadeOut(ctx, out, voices);
    },
  };
}

/** Fades a hum's outlet out and stops its voices; the outlet goes once they have ended. */
function fadeOut(ctx: BaseAudioContext, out: GainNode, voices: OscillatorNode[]): void {
  try {
    const now = ctx.currentTime;
    out.gain.cancelScheduledValues(now);
    out.gain.setValueAtTime(out.gain.value, now);
    out.gain.linearRampToValueAtTime(0, now + HUM_FADE);
    let ringing = voices.length;
    for (const osc of voices) {
      osc.onended = () => {
        ringing -= 1;
        if (ringing === 0) {
          out.disconnect();
        }
      };
      osc.stop(now + HUM_FADE + 0.02);
    }
  } catch {
    // Deliberately silent: the hum's nodes go with the context at the latest.
  }
}

// --- the devices' own -----------------------------------------------------------------------

/** A toggle snapping over: the bat's tick, its knock in the body and the seat's tick. */
export function toggleClack(): void {
  sound(0.065, (ctx, out, at) => [
    tick(ctx, out, at, 2400, 0.8),
    voice(ctx, out, { type: 'triangle', at, from: 210, to: 120, ...short(0.6, 0.05) }),
    tick(ctx, out, at + 0.022, 1500, 0.55),
  ]);
}

/** A big button going down: a low thump with a muffled knock, ~130 ms. */
export function buttonThunk(): void {
  sound(0.075, (ctx, out, at) => [
    voice(ctx, out, { type: 'sine', at, from: 160, to: 55, ...long(1, 0.01, 0.12) }),
    hiss(ctx, out, { at, duration: 0.06, filter: 'lowpass', frequency: 700, q: 0, peak: 0.5 }),
    hiss(ctx, out, body(at, 0.09, 0.6)),
    tick(ctx, out, at, 1300, 0.35),
  ]);
}

/** The mushroom button stamped down: a heavier, deeper thunk, ~230 ms. */
export function mushroomStomp(): void {
  sound(0.085, (ctx, out, at) => {
    const down = at + 0.012;
    return [
      tick(ctx, out, at, 1100, 0.6),
      voice(ctx, out, { type: 'sine', at: down, from: 120, to: 38, ...long(1, 0.03, 0.2) }),
      hiss(ctx, out, knock(down, 0.1, 900, 0.7)),
      hiss(ctx, out, body(down, 0.12, 0.7)),
    ];
  });
}

/** The main switch's own lever pulled down into its catch: a ratchet's tick, then its clunk. */
export function leverPull(): void {
  sound(0.07, (ctx, out, at) => {
    const caught = at + 0.05;
    return [
      tick(ctx, out, at, 1600, 0.7),
      voice(ctx, out, { type: 'sine', at: caught, from: 150, to: 70, ...long(0.9, 0.01, 0.14) }),
      hiss(ctx, out, body(caught, 0.1, 0.65)),
    ];
  });
}

/**
 * The lever springing back up, its press run out: the catch letting go with a bright clack,
 * the spring's twang ringing after it.
 */
export function leverSpring(): void {
  sound(0.065, (ctx, out, at) => [
    tick(ctx, out, at, 2600, 0.9),
    voice(ctx, out, { type: 'triangle', at, from: 320, to: 180, ...short(0.7, 0.06) }),
    voice(ctx, out, { type: 'sine', at: at + 0.02, from: 640, to: 560, ...bell(0.28, 0.2) }),
    hiss(ctx, out, body(at, 0.06, 0.5)),
  ]);
}

/** Pliers through a cable: a sharp hiss, the blades' ring and the jaws meeting, ~80 ms. */
export function pliersSnip(): void {
  sound(0.06, (ctx, out, at) => [
    hiss(ctx, out, { at, duration: 0.03, filter: 'bandpass', frequency: 5600, q: 1.8, peak: 1 }),
    voice(ctx, out, { type: 'sine', at, from: 3150, to: 3050, ...short(0.25, 0.07) }),
    voice(ctx, out, { type: 'sine', at, from: 4720, to: 4600, ...short(0.12, 0.045) }),
    tick(ctx, out, at + 0.012, 1800, 0.6),
  ]);
}

/** Sparks off a cut: seven crackles scattered over a quarter second, dying down. */
export function sparkCrackle(): void {
  sound(0.045, (ctx, out, at) =>
    Array.from({ length: 7 }, (_, i) => {
      const when = at + i * 0.032 + Math.random() * 0.02;
      return tick(ctx, out, when, 3500 + Math.random() * 3500, 0.9 - i * 0.1);
    }),
  );
}

/** A short in the box: a rasping, chopped arc with crackles, ~280 ms; the alarm waits for it. */
export function shortArc(): void {
  sound(0.06, (ctx, out, at) => {
    const end = at + 0.28;
    alarmFrom = Math.max(alarmFrom, end);
    const band = filter(ctx, 'bandpass', 1800, 1.2);
    // A square wave on the arc's gain chops it into the stutter of a bad contact.
    const chopped = gain(ctx, 0.5);
    const chop = ctx.createOscillator();
    chop.type = 'square';
    chop.frequency.value = 31;
    chop.connect(gain(ctx, 0.5)).connect(chopped.gain);
    band.connect(chopped).connect(out);
    chop.start(at);
    chop.stop(end);
    const rasp = voice(ctx, band, {
      type: 'sawtooth',
      at,
      from: 118,
      to: 96,
      ...long(1, 0.2, 0.07),
    });
    const crackles = [0, 0.05, 0.11, 0.17].map((delay) => tick(ctx, out, at + delay, 4200, 0.8));
    return [rasp, chop, ...crackles];
  });
}

/** The probe's tip on a terminal: a crisp contact click. */
export function probeClick(): void {
  sound(0.05, (ctx, out, at) => [
    tick(ctx, out, at, 2900, 0.9),
    voice(ctx, out, { type: 'sine', at, from: 950, to: 700, ...short(0.3, 0.02) }),
  ]);
}

/** The pitch a measured voltage hums at, in Hz: 60 Hz up to 435 Hz at 250 V; null for 0 V. */
export function voltagePitch(volts: number): number | null {
  return volts <= 0 ? null : 60 + Math.min(volts, 250) * 1.5;
}

/**
 * A measurement's hum, ~0.8 s, its pitch rising with the voltage as the needle swings up to
 * it; nothing for a dead wire.
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

/** [delay in s, pitch in Hz] of the chime's two notes: A5, then E6 a fifth above. */
const CHIME = [
  [0, 880],
  [0.09, 1318.5],
] as const;

/** A stage done: a glassy two-note chime rising a fifth, ~0.6 s. */
export function stageChime(): void {
  sound(0.035, (ctx, out, at) =>
    CHIME.flatMap(([delay, pitch]) => [
      voice(ctx, out, steady('sine', at + delay, pitch, bell(0.7, 0.5))),
      voice(ctx, out, steady('sine', at + delay, pitch * 2, bell(0.2, 0.25))),
    ]),
  );
}

/** A dial turning one step: its detent catching, a soft tick with a little body. */
export function dialDetent(): void {
  sound(0.045, (ctx, out, at) => [
    tick(ctx, out, at, 1700, 0.7),
    voice(ctx, out, { type: 'triangle', at, from: 520, to: 480, ...short(0.35, 0.02) }),
  ]);
}

/** A marker's step on the grid: a small, bright tick. */
export function stepTick(): void {
  sound(0.035, (ctx, out, at) => [
    tick(ctx, out, at, 2600, 0.6),
    voice(ctx, out, { type: 'sine', at, from: 1200, to: 1100, ...short(0.2, 0.012) }),
  ]);
}

/** The marker against a wall: a dull thud, ~200 ms. */
export function wallThud(): void {
  sound(0.08, (ctx, out, at) => [
    voice(ctx, out, { type: 'sine', at, from: 95, to: 42, ...long(1, 0.01, 0.17) }),
    hiss(ctx, out, { at, duration: 0.08, filter: 'lowpass', frequency: 320, q: 0, peak: 0.8 }),
    hiss(ctx, out, body(at, 0.1, 0.6)),
  ]);
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

/** A colour's tone, `seconds` long: buzzy like the game's, rounded off by a lowpass. */
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
  sound(0.04, (ctx, out, at) => [
    voice(ctx, out, { type: 'sine', at, from: 1100, to: 380, ...short(0.8, 0.05) }),
    tick(ctx, out, at, 3000, 0.3),
  ]);
}

/** A display taking a character: a short beep. */
export function typeBlip(): void {
  const beep = { peak: 0.8, attack: 0.002, hold: 0.03, decay: 0.02 };
  sound(0.03, (ctx, out, at) => [voice(ctx, out, steady('sine', at, 1760, beep))]);
}

/** [delay in s, pitch in Hz] of a terminal's OK: two short beeps a fourth apart, E6 then A6. */
const OK_BEEPS = [
  [0, 1318.5],
  [0.09, 1760],
] as const;

/** A terminal's line coming up OK: two soft, short beeps rising a fourth, ~0.25 s. */
export function okChime(): void {
  const beep = { peak: 0.7, attack: 0.003, hold: 0.045, decay: 0.06 };
  sound(0.03, (ctx, out, at) =>
    OK_BEEPS.map(([delay, pitch]) => voice(ctx, out, steady('sine', at + delay, pitch, beep))),
  );
}

/**
 * A server in the rack spinning up, ~0.7 s: its drive's whine gliding up an octave and more,
 * over a breath of its fans through a band that opens as they come up to speed.
 */
export function spinUp(): void {
  sound(0.035, (ctx, out, at) => {
    const fans = filter(ctx, 'bandpass', 500, 0.8);
    fans.frequency.setValueAtTime(500, at);
    fans.frequency.exponentialRampToValueAtTime(2400, at + 0.6);
    fans.connect(out);
    const fan: Hiss = { at, duration: 0.7, filter: 'highpass', frequency: 240, q: 0.5, peak: 0.6 };
    return [
      hiss(ctx, fans, fan),
      voice(ctx, out, { type: 'triangle', at, from: 160, to: 540, ...long(0.4, 0.25, 0.3) }),
    ];
  });
}

/** A second held on the big button: a faint tick. */
export function holdTick(): void {
  sound(0.025, (ctx, out, at) => [tick(ctx, out, at, 3200, 0.5)]);
}

/** A short envelope: at once to `peak`, falling silent over `decay`. */
function short(peak: number, decay: number): Envelope {
  return { peak, attack: 0.001, hold: 0, decay };
}

/** A fuller one: 2 ms up to `peak`, held for `hold`, falling silent over `decay`. */
function long(peak: number, hold: number, decay: number): Envelope {
  return { peak, attack: 0.002, hold, decay };
}

/** A struck one: 4 ms up to `peak`, then ringing out over `decay`. */
function bell(peak: number, decay: number): Envelope {
  return { peak, attack: 0.004, hold: 0, decay };
}

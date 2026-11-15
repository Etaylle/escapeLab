/**
 * morseKey.ts: the Funkfeuer's word, seen and heard. One schedule — the signals, the gaps and
 * the cue before each repeat, in Morse units (`morseLoop`, pure) — laid on one clock drives the
 * lamp and its tone alike: where the page's sound runs, the audio clock, its tones started and
 * stopped on it ahead of time and the lamp switched as the tone reaches the speaker; where it
 * does not, the page's clock and the lamp alone. Every edge is reckoned from the loop's origin,
 * never from the edge before it, so neither drifts from the other over many loops.
 *
 * The tone is a clean sine at a radio operator's pitch, keyed with short ramps so that it never
 * clicks, into the effects' bus like every device's sound: the Effekte volume and the sound
 * switch reach it there. Before each repeat of the word a short hiss of the carrier — no Morse
 * — marks its start. Decorative like every sound: the lamp carries the word without it, and a
 * page whose sound is off lays no tone at all.
 */
import {
  biquad,
  chain,
  gain,
  isMuted,
  noiseBuffer,
  playingEngine,
  SILENCE,
  type Engine,
} from '../world/audio.js';

/** One Morse unit, s: a short signal lasts one, a long one three. */
export const UNIT_S = 0.25;
/** Dark units between the signals of a letter. */
export const SIGNAL_GAP = 1;
/**
 * Dark units between letters: five, not the standard three. At a quarter second a unit the gap
 * inside a letter is long enough to be heard as a pause of its own, and three of it read as
 * just a longer one; five keep the letters apart without slowing the signals.
 */
export const LETTER_GAP = 5;
/** Dark units from the word's last signal to its repeat's first. */
export const WORD_GAP = 10;
/** Units before the word's first signal the carrier's hiss sets in. */
export const CUE_LEAD = 4;
/** Units from the key's start to the first signal: dark a moment, the hiss, then the word. */
const OPENING = CUE_LEAD + 2;

/** A signal: `at` units after the loop's first signal begins, `units` long. */
export interface Mark {
  readonly at: number;
  readonly units: number;
}

/** The word's loop: its signals, how many units it takes, and where in it the cue comes. */
export interface MorseLoop {
  readonly marks: readonly Mark[];
  readonly period: number;
  /** units into the loop the cue sets in, `CUE_LEAD` before the next loop's first signal */
  readonly cue: number;
}

/**
 * The loop of a pattern like "-.. .-": short 1 unit, long 3, dark 1 between the signals of a
 * letter, 5 between letters and 10 before the repeat, the hiss 4 units before it.
 */
export function morseLoop(pattern: string): MorseLoop {
  const marks: Mark[] = [];
  let at = 0;
  pattern.split(' ').forEach((letter, i) => {
    if (i > 0) {
      at += LETTER_GAP - SIGNAL_GAP;
    }
    for (const signal of letter) {
      const units = signal === '-' ? 3 : 1;
      marks.push({ at, units });
      at += units + SIGNAL_GAP;
    }
  });
  const period = at - SIGNAL_GAP + WORD_GAP;
  return { marks, period, cue: period - CUE_LEAD };
}

/** The lamp `units` into the loop's run: whether it is lit, and how many units until it turns. */
export function lampAt(loop: MorseLoop, units: number): { lit: boolean; next: number } {
  if (units < 0) {
    return { lit: false, next: -units };
  }
  const phase = units % loop.period;
  for (const mark of loop.marks) {
    if (phase < mark.at) {
      return { lit: false, next: mark.at - phase };
    }
    if (phase < mark.at + mark.units) {
      return { lit: true, next: mark.at + mark.units - phase };
    }
  }
  return { lit: false, next: loop.period - phase };
}

/** Something the key sounds: a signal's tone or the cue, `at` units into the run. */
export interface KeyEvent {
  readonly kind: 'tone' | 'cue';
  readonly at: number;
  readonly units: number;
}

/**
 * What the key sounds from `from` to `to` units into the run, in order of their start. The run
 * begins `OPENING` units before its first signal, its first cue `CUE_LEAD` before it: no window
 * reaches back further than that.
 */
export function eventsIn(loop: MorseLoop, from: number, to: number): KeyEvent[] {
  const events: KeyEvent[] = [];
  const within = (at: number): boolean => at >= from && at < to;
  for (let k = Math.floor(from / loop.period) - 1; k * loop.period < to; k++) {
    const cue = k * loop.period + loop.cue;
    if (within(cue)) {
      events.push({ kind: 'cue', at: cue, units: 0 });
    }
    for (const mark of loop.marks) {
      const at = k * loop.period + mark.at;
      if (within(at)) {
        events.push({ kind: 'tone', at, units: mark.units });
      }
    }
  }
  return events.sort((a, b) => a.at - b.at);
}

// --- the sound ------------------------------------------------------------------------------

/** The tone's pitch, Hz: where a radio operator's sidetone sits. */
export const TONE_HZ = 650;
/** How long the tone takes to come up and to fall away, s: no click, a crisp edge. */
export const RAMP_S = 0.005;
/** The key's outlet into the effects' bus: the sine's peak there, about 6 dB under an effect's. */
export const KEY_LEVEL = 0.025;
/** The hiss: a band of noise round the carrier's 2.5 kHz, quiet, about 0.2 s. */
const CUE_HZ = 2500;
const CUE_Q = 0.8;
const CUE_PEAK = 1.2;
const CUE_ATTACK = 0.015;
const CUE_HOLD = 0.06;
const CUE_DECAY = 0.12;
/** How far ahead the key lays its sound on the audio clock, s, and how often it looks again. */
const AHEAD_S = 0.4;
const TICK_S = 0.1;

/** A signal's tone from `at` for `seconds`, audio time, ramped at both ends inside its length. */
function keyTone(ctx: AudioContext, out: AudioNode, at: number, seconds: number) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = TONE_HZ;
  const env = gain(ctx, 0);
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(1, at + RAMP_S);
  env.gain.setValueAtTime(1, at + seconds - RAMP_S);
  env.gain.linearRampToValueAtTime(0, at + seconds);
  chain(osc, env, out);
  osc.start(at);
  osc.stop(at + seconds);
  return { source: osc, stage: env };
}

/** The carrier's hiss from `at`, audio time: a band of the shared noise, swelling and dying. */
function keyCue(ctx: AudioContext, out: AudioNode, at: number) {
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx);
  const band = biquad(ctx, 'bandpass', CUE_HZ, CUE_Q);
  const env = gain(ctx, 0);
  const end = at + CUE_ATTACK + CUE_HOLD + CUE_DECAY;
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(CUE_PEAK, at + CUE_ATTACK);
  env.gain.setValueAtTime(CUE_PEAK, at + CUE_ATTACK + CUE_HOLD);
  env.gain.exponentialRampToValueAtTime(SILENCE, end);
  chain(noise, band, env, out);
  noise.start(at);
  noise.stop(end + 0.01);
  return { source: noise, stage: env };
}

/** The key's line into the mix: one outlet, the sounds laid on it, and what closes it. */
interface KeyLine {
  lay(event: KeyEvent, at: number): void;
  close(): void;
}

/** A line into `audio`'s effects' bus, made as its first sound is laid. */
function keyLine(audio: Engine): KeyLine {
  const { ctx } = audio;
  const out = gain(ctx, KEY_LEVEL);
  out.connect(audio.sfx);
  const sources = new Set<AudioScheduledSourceNode>();
  let closed = false;
  const ended = (source: AudioScheduledSourceNode, stage: AudioNode): void => {
    stage.disconnect();
    sources.delete(source);
    if (closed && sources.size === 0) {
      out.disconnect();
    }
  };
  return {
    lay(event, at) {
      const seconds = event.units * UNIT_S;
      const { source, stage } =
        event.kind === 'tone' ? keyTone(ctx, out, at, seconds) : keyCue(ctx, out, at);
      sources.add(source);
      source.onended = () => ended(source, stage);
    },
    close() {
      closed = true;
      try {
        const now = ctx.currentTime;
        out.gain.cancelScheduledValues(now);
        out.gain.setValueAtTime(KEY_LEVEL, now);
        out.gain.linearRampToValueAtTime(0, now + RAMP_S);
        for (const source of sources) {
          source.stop(now + RAMP_S);
        }
      } catch {
        // Deliberately silent: the line goes with the context at the latest.
      }
      if (sources.size === 0) {
        out.disconnect();
      }
    },
  };
}

/** The clock the key runs on: seconds as heard, and the engine whose clock it is, if any. */
interface KeyClock {
  readonly audio: Engine | null;
  now(): number;
}

const PAGE_CLOCK: KeyClock = { audio: null, now: () => performance.now() / 1000 };

/**
 * The audio clock as heard: the audio time of the sample at the speaker now (the context's
 * output timestamp), else its current time less its output latency, where the browser tells
 * neither.
 */
function audioClock(audio: Engine): KeyClock {
  const { ctx } = audio;
  const now = (): number => {
    const stamp = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : {};
    if (stamp.contextTime !== undefined && (stamp.performanceTime ?? 0) > 0) {
      return stamp.contextTime + (performance.now() - (stamp.performanceTime ?? 0)) / 1000;
    }
    return ctx.currentTime - (ctx.outputLatency || 0);
  };
  return { audio, now };
}

/** A Morse key at work: `hush` silences it for good, `stop` ends lamp and tone at once. */
export interface Keying {
  hush(): void;
  stop(): void;
}

/** The key's clock: the audio clock where the page's sound runs, else the page's. */
function keyClock(): KeyClock {
  const audio = isMuted() ? null : playingEngine();
  return audio === null ? PAGE_CLOCK : audioClock(audio);
}

/**
 * Keys `pattern` on a loop from now: `onLamp` is told each time the lamp turns, and where the
 * page's sound runs each signal sounds as long as it is lit, the hiss before every repeat. The
 * tone is laid on the audio clock `AHEAD_S` ahead; while the sound switch mutes, none is laid,
 * and should the context stop running the lamp goes on by the page's clock, unheard.
 */
export function startKeying(pattern: string, onLamp: (lit: boolean) => void): Keying {
  const loop = morseLoop(pattern);
  let clock = keyClock();
  let origin = clock.now() + OPENING * UNIT_S;
  let laid = -OPENING;
  let line: KeyLine | null = null;
  let hushed = false;
  let lit = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hush = (): void => {
    hushed = true;
    line?.close();
    line = null;
  };
  const layAhead = (audio: Engine): void => {
    const until = (audio.ctx.currentTime + AHEAD_S - origin) / UNIT_S;
    const heard = !hushed && !isMuted();
    try {
      for (const event of heard ? eventsIn(loop, laid, until) : []) {
        const at = origin + event.at * UNIT_S;
        // A sound already due is dropped, never crammed in late.
        if (at >= audio.ctx.currentTime) {
          line ??= keyLine(audio);
          line.lay(event, at);
        }
      }
    } catch {
      // Deliberately silent: the tone is decorative, and the lamp goes on without it.
      hush();
    }
    laid = Math.max(laid, until);
  };
  const tick = (): void => {
    if (clock.audio !== null && clock.audio.ctx.state !== 'running') {
      const phase = clock.now() - origin;
      hush();
      clock = PAGE_CLOCK;
      origin = clock.now() - phase;
    }
    const lamp = lampAt(loop, (clock.now() - origin) / UNIT_S);
    if (lamp.lit !== lit) {
      lit = lamp.lit;
      onLamp(lit);
    }
    if (clock.audio !== null) {
      layAhead(clock.audio);
    }
    // A millisecond past the edge, so that a timer firing early still finds the lamp turned.
    timer = setTimeout(tick, Math.min(lamp.next * UNIT_S, TICK_S) * 1000 + 1);
  };
  tick();
  return {
    hush,
    stop: () => {
      clearTimeout(timer);
      hush();
    },
  };
}

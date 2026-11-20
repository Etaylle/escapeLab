/**
 * Ferret Flush's sound (the reference's src/audio.js): every sound made with Web Audio, no sound
 * files. On the machine it has no context of its own: the outlet (../sound.ts) gives it the lab's
 * context and the node it plays into, and everything leaves through one gain that follows the
 * lab's ducks (`follow`), so that the run's radio and alarms stand over it. The effects and the
 * tune of the modern rules (music.ts) have a volume each. Where the reference suspends its own
 * context for a pause, the machine holds its sound at zero instead: the context is the lab's.
 */
import type { Outlet } from '../sound.js';
import { createMusic, type FlushMusic, type MusicMood } from './music.js';
import type { FlushEvent, Mood } from './rules.js';

const VOLUME = 0.6;
const NOTE = {
  A3: 220, C4: 261.63, D4: 293.66, E4: 329.63, G4: 392,
  C5: 523.25, E5: 659.25, G5: 783.99, C6: 1046.5, E6: 1318.51, G6: 1567.98,
} as const;
/** The pitch of a mallard, a pintail, a ruddy duck and a golden bird. */
const QUACK: readonly number[] = [330, 392, 470, 560];

interface Graph {
  context: AudioContext;
  duck: GainNode;
  unfollow: () => void;
  master: GainNode;
  effects: GainNode;
  musicBus: GainNode;
  grain: AudioBuffer;
  echo: GainNode;
  wind: AudioBufferSourceNode;
  music: FlushMusic;
}

/** A gunshot rolls back from the far shore: a delay line that feeds itself. */
function buildEcho(context: AudioContext, effects: AudioNode): GainNode {
  const input = context.createGain();
  const delay = context.createDelay(1);
  const damp = context.createBiquadFilter();
  const again = context.createGain();
  input.gain.value = 0.3;
  delay.delayTime.value = 0.21;
  damp.type = 'lowpass';
  damp.frequency.value = 1500;
  again.gain.value = 0.32;
  input.connect(delay).connect(damp).connect(effects);
  damp.connect(again).connect(delay);
  return input;
}

function startWind(context: AudioContext, grain: AudioBuffer, effects: AudioNode): AudioBufferSourceNode {
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = grain;
  source.loop = true;
  filter.type = 'lowpass';
  filter.frequency.value = 420;
  gain.gain.value = 0.035;
  source.connect(filter).connect(gain).connect(effects);
  source.start();
  return source;
}

function gainInto(context: AudioContext, out: AudioNode, value: number): GainNode {
  const gain = context.createGain();
  gain.gain.value = value;
  gain.connect(out);
  return gain;
}

function noise(context: AudioContext): AudioBuffer {
  const grain = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const data = grain.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return grain;
}

/** The voices every sound is made of, on one graph. */
class Synth {
  constructor(private readonly g: Graph) {}

  /** One note: a wave that slides from one pitch to another and fades out. */
  tone(type: OscillatorType, from: number, to: number, seconds: number, volume: number, at = 0): void {
    const { context } = this.g;
    const start = context.currentTime + at;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + seconds);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
    oscillator.connect(gain).connect(this.g.effects);
    oscillator.start(start);
    oscillator.stop(start + seconds + 0.02);
  }

  /** A burst of noise through a filter that sweeps: shots, reeds, wings. */
  hiss(kind: BiquadFilterType, from: number, to: number, seconds: number, volume: number, at = 0, echo = false): void {
    const { context } = this.g;
    const start = context.currentTime + at;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = this.g.grain;
    filter.type = kind;
    filter.frequency.setValueAtTime(from, start);
    filter.frequency.exponentialRampToValueAtTime(to, start + seconds);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
    source.connect(filter).connect(gain).connect(echo ? this.g.echo : this.g.effects);
    source.start(start, Math.random() * 1.4);
    source.stop(start + seconds + 0.02);
  }

  /** A quack: a buzzing wave that drops in pitch, heard through the nose. */
  quack(kind: number, at = 0, volume = 0.2, raise = 1): void {
    const { context } = this.g;
    const pitch = (QUACK[kind] ?? 330) * raise;
    const start = context.currentTime + at;
    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(pitch * 1.3, start);
    oscillator.frequency.exponentialRampToValueAtTime(pitch, start + 0.1);
    filter.type = 'bandpass';
    filter.frequency.value = pitch * 3.4;
    filter.Q.value = 2.5;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
    oscillator.connect(filter).connect(gain).connect(this.g.effects);
    oscillator.start(start);
    oscillator.stop(start + 0.16);
  }

  notes(type: OscillatorType, pitches: readonly number[], step: number, volume: number, at = 0): void {
    pitches.forEach((pitch, i) => {
      const last = i === pitches.length - 1;
      this.tone(type, pitch, pitch, last ? step * 4 : step * 1.5, volume, at + i * step);
    });
  }

  reeds(volume: number, at = 0): void {
    this.hiss('bandpass', 3000, 1500, 0.28, volume, at);
  }

  /** The happy chuckle of a ferret. */
  dook(times: number, pitch: number, at = 0): void {
    for (let i = 0; i < times; i++) {
      this.tone('triangle', pitch * (1 + i * 0.04), pitch * 1.35, 0.065, 0.2, at + i * 0.115);
    }
  }

  /** A hollow knock of wood: the decoys of the bonus stage. */
  knock(at = 0, pitch = 1): void {
    this.tone('sine', 820 * pitch, 380 * pitch, 0.09, 0.3, at);
    this.hiss('bandpass', 1800 * pitch, 900 * pitch, 0.06, 0.25, at);
  }
}

type Sound = (s: Synth, event: FlushEvent) => void;

const MOODS: Readonly<Partial<Record<Mood, (s: Synth) => void>>> = {
  proud(s) {
    s.reeds(0.18);
    s.dook(3, 520, 0.25);
  },
  double(s) {
    s.reeds(0.18);
    s.dook(6, 600, 0.25);
    s.notes('triangle', [NOTE.C5, NOTE.E5, NOTE.G5], 0.09, 0.12, 1);
  },
  flop(s) {
    s.reeds(0.18);
    s.tone('sine', 520, 300, 0.5, 0.1, 0.95);
    s.tone('sine', 110, 50, 0.14, 0.45, 1.85);
    s.reeds(0.22, 1.85);
  },
  cheer: (s) => s.dook(4, 640),
  nod: (s) => s.dook(2, 560),
  shrug: (s) => s.tone('sine', 480, 300, 0.4, 0.08),
};

/** Sounds of the modern rules only: the classic game never makes these events. */
const MODERN_SOUNDS: Readonly<Record<string, Sound>> = {
  wind(s) {
    s.hiss('bandpass', 300, 900, 1.2, 0.12);
    s.hiss('bandpass', 900, 350, 1.4, 0.08, 0.6);
  },
  streak(s, event) {
    const top = [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6].slice(0, (event.factor ?? 1) + 1);
    s.notes('triangle', top, 0.06, 0.13);
  },
  'streak-lost': (s) => s.tone('sine', 600, 380, 0.25, 0.06),
  golden(s) {
    s.notes('sine', [NOTE.G5, NOTE.C6, NOTE.E6, NOTE.G6, NOTE.E6, NOTE.G6], 0.055, 0.09, 0.08);
    s.hiss('highpass', 7000, 7000, 0.5, 0.05, 0.08);
  },
  'sure-shot': (s) => s.notes('triangle', [NOTE.G5, NOTE.G5, NOTE.C6], 0.11, 0.15, 0.5),
  bonus(s) {
    [0, 0.12, 0.24].forEach((at, i) => s.knock(at, 1 + i * 0.12));
    s.notes('triangle', [NOTE.C5, NOTE.G5, NOTE.E5, NOTE.C6], 0.1, 0.13, 0.4);
  },
  'bonus-shot'(s) {
    s.hiss('lowpass', 3800, 300, 0.18, 0.6);
    s.tone('sine', 240, 70, 0.1, 0.5);
  },
  decoy(s) {
    s.knock();
    s.tone('triangle', NOTE.E6, NOTE.E6, 0.08, 0.06, 0.05);
  },
  'bonus-end'(s, event) {
    const all = [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.E6];
    s.notes('triangle', event.bonus ? all : [NOTE.G4, NOTE.C5], 0.09, 0.16);
  },
};

function launch(s: Synth, event: FlushEvent): void {
  if (event.target === 'duck') {
    s.reeds(0.18);
    s.quack(event.kind ?? 0);
    s.quack(event.kind ?? 0, 0.16);
  } else {
    s.tone('sine', 300, 1300, 0.1, 0.22);
    s.hiss('bandpass', 1500, 1500, 0.08, 0.15);
  }
}

function hit(s: Synth, event: FlushEvent): void {
  if (event.target === 'clay') {
    s.hiss('highpass', 2500, 2500, 0.14, 0.45);
    [2100, 3150, 4200].forEach((pitch, i) => s.tone('sine', pitch, pitch, 0.09, 0.09, i * 0.012));
    return;
  }
  s.tone('sine', 220, 70, 0.12, 0.5);
  s.quack(event.kind ?? 0, 0, 0.26, 1.7);
  s.hiss('highpass', 2000, 2000, 0.12, 0.18);
  s.tone('sine', 1250, 420, 0.7, 0.07, 0.26);
}

const SOUNDS: Readonly<Record<string, Sound>> = {
  start: (s) => s.tone('sine', 880, 1320, 0.09, 0.2),
  hover: (s) => s.tone('sine', 700, 700, 0.03, 0.05),
  round: (s) => s.notes('triangle', [NOTE.G4, NOTE.C5, NOTE.E5], 0.09, 0.16),
  sniff(s) {
    for (const at of [0, 0.13, 0.4, 0.53, 0.8, 0.93]) s.hiss('highpass', 3200, 3200, 0.05, 0.07, at);
  },
  alert(s) {
    s.tone('triangle', 880, 880, 0.07, 0.18);
    s.tone('triangle', 1320, 1320, 0.12, 0.18, 0.08);
  },
  pounce(s) {
    s.hiss('bandpass', 500, 2400, 0.3, 0.22);
    s.tone('sine', 300, 700, 0.25, 0.1);
  },
  flush(s) {
    s.reeds(0.32);
    s.tone('sine', 120, 55, 0.14, 0.4);
  },
  scurry(s) {
    for (let i = 0; i < 6; i++) s.hiss('bandpass', 3400, 2600, 0.05, 0.1, i * 0.1);
  },
  pull: (s) => s.tone('square', 660, 660, 0.05, 0.06),
  launch,
  shot(s) {
    s.hiss('lowpass', 5200, 260, 0.32, 0.9);
    s.hiss('lowpass', 5200, 260, 0.32, 0.9, 0, true);
    s.hiss('highpass', 4000, 4000, 0.04, 0.4);
    s.tone('sine', 170, 45, 0.18, 0.9);
  },
  dry(s) {
    s.tone('square', 1400, 900, 0.035, 0.12);
    s.hiss('highpass', 5000, 5000, 0.02, 0.15);
  },
  hit,
  landed(s) {
    s.tone('sine', 110, 50, 0.14, 0.5);
    s.reeds(0.22);
  },
  lost: (s) => s.tone('sine', 300, 180, 0.12, 0.06),
  away(s) {
    s.tone('triangle', 660, 520, 0.12, 0.14);
    s.tone('triangle', 520, 390, 0.22, 0.14, 0.13);
  },
  popup: (s, event) => {
    if (event.mood) MOODS[event.mood]?.(s);
  },
  tick(s, event) {
    const pitch = 520 * 2 ** ((event.hits ?? 0) / 12);
    if (event.hit) s.tone('triangle', pitch, pitch, 0.07, 0.16);
    else s.tone('sine', 200, 200, 0.04, 0.08);
  },
  cleared(s, event) {
    s.notes('triangle', [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6], 0.1, 0.2);
    if (event.perfect) s.notes('sine', [NOTE.E6, NOTE.G6, NOTE.E6, NOTE.G6], 0.08, 0.1, 0.45);
  },
  failed: (s) => s.notes('triangle', [NOTE.E4, NOTE.D4, NOTE.C4, NOTE.A3], 0.22, 0.18),
  ...MODERN_SOUNDS,
};

/** The sound of Ferret Flush on the machine. */
export interface FlushAudio {
  /** Builds the sound on the first gesture, once the lab's context is there. */
  unlock(): void;
  /** The sound of one event of the rules. */
  play(event: FlushEvent): void;
  quack(kind: number): void;
  flap(): void;
  /** Birdsong by day and crickets after dark, now and then. `night` runs from 0 to 1. */
  ambient(dt: number, night: number): void;
  /** The tune: playing or fading, by day, after dark or on the decoy line. */
  music(on: boolean, mood: MusicMood): void;
  /** Volumes of the tune and of the effects, each from 0 to 1. */
  setVolumes(next: Partial<{ music: number; effects: number }>): void;
  /** Holds every sound while the game is paused. */
  hush(on: boolean): void;
  setMuted(value: boolean): void;
  readonly muted: boolean;
  /** Stops everything and lets the graph go: out of the lab's mix. */
  close(): void;
}

/** The graph on the lab's context, through the one gain that follows the lab's ducks. */
function build(outlet: Outlet, volumes: { music: number; effects: number }, level: number): Graph | null {
  const out = outlet();
  if (out === null) return null;
  const context = out.ctx;
  const duck = gainInto(context, out.destination, 1);
  const master = gainInto(context, duck, level);
  const effects = gainInto(context, master, volumes.effects);
  const musicBus = gainInto(context, master, volumes.music);
  const grain = noise(context);
  return {
    context,
    duck,
    unfollow: out.follow(duck.gain),
    master,
    effects,
    musicBus,
    grain,
    echo: buildEcho(context, effects),
    wind: startWind(context, grain, effects),
    music: createMusic(context, musicBus, grain),
  };
}

export function createFlushAudio(outlet: Outlet): FlushAudio {
  let graph: Graph | null = null;
  let muted = false;
  let held = false;
  let chirpIn = 3;
  const volumes = { music: 0.5, effects: 0.8 };
  const level = (): number => (muted || held ? 0 : VOLUME);
  const synth = (): Synth | null => (graph === null || muted || held ? null : new Synth(graph));
  return {
    unlock() {
      graph ??= build(outlet, volumes, level());
      if (graph?.context.state === 'suspended' && !held) void graph.context.resume();
    },
    play(event) {
      const s = synth();
      if (s !== null && Object.hasOwn(SOUNDS, event.type)) SOUNDS[event.type]?.(s, event);
    },
    quack(kind) {
      synth()?.quack(kind, 0, 0.12);
    },
    flap() {
      synth()?.hiss('bandpass', 420, 420, 0.05, 0.03);
    },
    ambient(dt, night) {
      chirpIn -= dt;
      const s = synth();
      if (chirpIn > 0 || s === null) return;
      chirpIn = 1.5 + Math.random() * 3.5;
      ambientCall(s, night);
    },
    music(on, mood) {
      if (graph && !held) graph.music.play(on && !muted, mood);
    },
    setVolumes(next) {
      Object.assign(volumes, next);
      if (!graph) return;
      graph.effects.gain.value = volumes.effects;
      graph.musicBus.gain.value = volumes.music;
    },
    hush(on) {
      held = on;
      if (graph) graph.master.gain.value = level();
    },
    setMuted(value) {
      muted = value;
      if (graph) graph.master.gain.value = level();
    },
    get muted() {
      return muted;
    },
    close() {
      if (!graph) return;
      graph.wind.stop();
      graph.unfollow();
      graph.duck.disconnect();
      graph = null;
    },
  };
}

/** A bird by day, a cricket after dark. */
function ambientCall(s: Synth, night: number): void {
  if (night > 0.4) {
    for (let i = 0; i < 3; i++) s.tone('sine', 4300, 4300, 0.035, 0.025, i * 0.07);
    return;
  }
  const pitch = 2200 + Math.random() * 1400;
  s.tone('sine', pitch, pitch * 1.3, 0.07, 0.03);
  s.tone('sine', pitch * 1.2, pitch * 1.5, 0.06, 0.03, 0.11);
}

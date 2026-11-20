/**
 * The machine's sound (the reference's src/audio.js): its synthesised cues and its tune, each
 * through a gain of the machine's own (its Info's „Musik" and „Effekte"), behind its own switch,
 * and out through one outlet into the lab's mix — the effects' bus (world/mix.ts), so that the
 * lab's „Effekte" volume, its „Gesamt" and its sound switch reach the machine too. Without
 * `rich` every cue is exactly the original; the modern rules add a layer to each and cues of
 * their own.
 */
import { Music, type MusicOut } from './music.js';

/**
 * Where the machine's sound goes: the lab's context, the node it plays into, and the way its
 * gain follows the run's sounds — pulled down under the radio and the alarms (mix.ts
 * `followDucks`); or none without sound.
 */
export type Outlet = () => {
  ctx: AudioContext;
  destination: AudioNode;
  follow: (param: AudioParam) => () => void;
} | null;

interface Graph {
  ctx: AudioContext;
  master: GainNode;
  /** under the run's radio and alarms: the machine goes down, never they */
  duck: GainNode;
  unfollow: () => void;
  effects: GainNode;
  music: GainNode;
}

type Play = (a: ArcadeAudio) => void;
const chord = (a: ArcadeAudio, notes: readonly number[], step: number, type: OscillatorType = 'square', volume = 0.035, delay = 0): void =>
  notes.forEach((f, i) => a.tone(f, 0.12, f, delay + i * step, type, volume));
const fanfare: Play = (a) => [440, 554, 660, 880].forEach((f, i) => a.tone(f, 0.14, f, i * 0.12));
/** The original's cues. */
const CUES: Readonly<Record<string, Play>> = {
  shoot: (a) => a.tone(950, 0.11, 140),
  impact: (a) => a.tone(150, 0.06, 40),
  explosion: (a) => a.tone(220, 0.18, 25, 0, 'sawtooth'),
  march: (a) => {
    a.tone([130, 116, 103, 87][a.beat++ % 4] ?? 130, 0.08, 65);
    a.tone(410, 0.06, 250, 0.03, 'sawtooth', 0.018);
  },
  saucer: (a) => {
    for (let i = 0; i < 8; i++) a.tone(i % 2 ? 620 : 430, 0.12, 480, i * 0.12, 'sine', 0.025);
  },
  death: (a) => a.tone(420, 0.8, 25, 0, 'sawtooth'),
  extra: fanfare,
  clear: fanfare,
  bonus: fanfare,
};
/** The modern layers, and the cues only the modern rules raise. */
const LAYERS: Readonly<Record<string, Play>> = {
  shoot: (a) => a.noise(0.05, 5000, 1500, 0.018, 0, 'highpass'),
  impact: (a) => a.noise(0.07, 1200, 200, 0.03),
  explosion: (a) => {
    a.noise(0.22, 2400, 120, 0.05);
    a.quack(0.9 + Math.random() * 0.25, 0.02);
  },
  death: (a) => a.noise(0.9, 900, 60, 0.07),
  clang: (a) => chord(a, [1320, 1980, 2640], 0.01, 'triangle', 0.02),
  dive: (a) => a.tone(1500, 0.6, 420, 0, 'sine', 0.02),
  'boss-hit': (a) => a.noise(0.1, 700, 120, 0.05),
  'boss-fire': (a) => a.quack(0.6),
  'boss-down': (a) => {
    a.noise(1.2, 1600, 50, 0.08);
    chord(a, [523, 659, 784, 1047], 0.1, 'square', 0.04, 0.2);
  },
  'pickup-drop': (a) => a.tone(300, 0.25, 900, 0, 'triangle', 0.03),
  pickup: (a) => chord(a, [660, 880, 1320], 0.06),
  'shield-break': (a) => {
    a.noise(0.3, 6000, 900, 0.05, 0, 'highpass');
    a.tone(1800, 0.3, 600, 0, 'triangle', 0.03);
  },
  combo: (a) => a.tone(880, 0.08, 1760, 0, 'square', 0.03),
  'wave-start': (a) => chord(a, [392, 523, 659, 784], 0.09, 'triangle', 0.04),
};

export class ArcadeAudio {
  muted = false;
  rich = false;
  beat = 0;
  volumes = { effects: 0.8, music: 0.5 };
  readonly nodes = new Set<AudioScheduledSourceNode>();
  readonly music: Music;
  private graph: Graph | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private readonly musicNodes = new Set<AudioScheduledSourceNode>();

  constructor(private readonly outlet: Outlet) {
    this.music = new Music(() => this.musicOut());
  }

  /** The machine's gains on the lab's context, made on first use; null without sound. */
  private live(): Graph | null {
    if (this.graph !== null) return this.graph;
    const out = this.outlet();
    if (out === null) return null;
    const { ctx, destination } = out;
    const duck = ctx.createGain();
    duck.connect(destination);
    const master = ctx.createGain();
    master.connect(duck);
    const gain = (value: number): GainNode => {
      const node = ctx.createGain();
      node.gain.value = value;
      node.connect(master);
      return node;
    };
    this.graph = {
      ctx,
      master,
      duck,
      unfollow: out.follow(duck.gain),
      effects: gain(this.volumes.effects),
      music: gain(this.volumes.music),
    };
    return this.graph;
  }

  setVolume(name: 'effects' | 'music', value: number): void {
    this.volumes[name] = Math.max(0, Math.min(1, value));
    if (this.graph) this.graph[name].gain.value = this.volumes[name];
  }

  /** Stops every effect still sounding. */
  stop(): void {
    stopAll(this.nodes);
  }

  /** Stops the tune, the notes it laid ahead too. */
  stopMusic(): void {
    this.music.stop();
    stopAll(this.musicNodes);
  }

  /** Takes the machine's sound out of the lab's mix: every node stopped and let go. */
  close(): void {
    this.stop();
    this.stopMusic();
    this.graph?.unfollow();
    this.graph?.duck.disconnect();
    this.graph = null;
  }

  private track(source: AudioScheduledSourceNode, gain: GainNode, nodes: Set<AudioScheduledSourceNode>): void {
    nodes.add(source);
    source.onended = () => {
      nodes.delete(source);
      source.disconnect();
      gain.disconnect();
    };
  }

  /** The graph to play an effect into now; none while muted. */
  private effectsOut(): Graph | null {
    return this.muted ? null : this.live();
  }

  tone(frequency: number, duration = 0.12, end = frequency, delay = 0, type: OscillatorType = 'square', volume = 0.045): void {
    const g = this.effectsOut();
    if (g === null) return;
    const o = g.ctx.createOscillator();
    const v = g.ctx.createGain();
    const t = g.ctx.currentTime + delay;
    o.type = type;
    o.frequency.setValueAtTime(frequency, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, end), t + duration);
    v.gain.setValueAtTime(volume, t);
    v.gain.exponentialRampToValueAtTime(0.001, t + duration);
    o.connect(v);
    v.connect(g.effects);
    o.start(t);
    o.stop(t + duration);
    this.track(o, v, this.nodes);
  }

  private noiseOf(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer === null) {
      this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return this.noiseBuffer;
  }

  /** A filtered burst of white noise: puffs, crunches and feathery whooshes. */
  noise(duration: number, from: number, to: number, volume = 0.05, delay = 0, filter: BiquadFilterType = 'lowpass'): void {
    const g = this.effectsOut();
    if (g === null) return;
    const t = g.ctx.currentTime + delay;
    const source = g.ctx.createBufferSource();
    const shape = g.ctx.createBiquadFilter();
    const v = g.ctx.createGain();
    source.buffer = this.noiseOf(g.ctx);
    shape.type = filter;
    shape.frequency.setValueAtTime(from, t);
    shape.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + duration);
    v.gain.setValueAtTime(volume, t);
    v.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(shape);
    shape.connect(v);
    v.connect(g.effects);
    source.start(t);
    source.stop(t + duration);
    this.track(source, v, this.nodes);
  }

  /** A short nasal quack: two detuned voices gliding down with a bandpassed puff. */
  quack(pitch = 1, delay = 0): void {
    this.tone(720 * pitch, 0.09, 380 * pitch, delay, 'square', 0.022);
    this.tone(735 * pitch, 0.09, 360 * pitch, delay + 0.01, 'sawtooth', 0.012);
    this.noise(0.08, 1800 * pitch, 700, 0.025, delay, 'bandpass');
  }

  play(type: string): void {
    CUES[type]?.(this);
    if (this.rich) LAYERS[type]?.(this);
  }

  /** The tune's way out: its notes into the music gain, tracked apart from the effects. */
  private musicOut(): MusicOut | null {
    const g = this.muted ? null : this.live();
    if (g === null) return null;
    return {
      ctx: g.ctx,
      note: (frequency, at, length, type, volume) => {
        const o = g.ctx.createOscillator();
        const v = g.ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(frequency, at);
        v.gain.setValueAtTime(volume, at);
        v.gain.exponentialRampToValueAtTime(0.001, at + length);
        o.connect(v);
        v.connect(g.music);
        o.start(at);
        o.stop(at + length);
        this.track(o, v, this.musicNodes);
      },
      stopNotes: () => stopAll(this.musicNodes),
    };
  }
}

function stopAll(nodes: Set<AudioScheduledSourceNode>): void {
  for (const node of nodes) {
    try {
      node.stop();
    } catch {
      // Already finished.
    }
  }
  nodes.clear();
}

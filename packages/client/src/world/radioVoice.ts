import {
  applyEnvelope,
  audioEngine,
  biquad,
  chain,
  fadeTo,
  gain,
  LOOKAHEAD,
  noiseBurst,
  noiseLoop,
  onAllEnded,
  outlet,
  playingEngine,
  still,
  tick,
  type Engine,
  type Fade,
} from './audio.js';

/**
 * A voice on the radio: mission control's lines, recorded once on a Mac (scripts/voice.ts,
 * public/voice/) and played as a handset hears them — band-limited to 300 Hz–3.4 kHz, gently
 * saturated, over a faint bed of static, keyed with a squelch at either end — while the beds
 * and the music duck 6 dB under it (audio.ts, the duck bus). The banner shows the line as it
 * always did; a line without a recording, as a custom mission's, still only chirps (audio.ts
 * `radioChirp`). At a run's start the mission's lines are fetched and decoded, so that a line
 * plays the moment it is shown; a line that comes over the air is fetched then too, where it
 * was not yet. Nothing here throws, and nothing plays while the context is held back.
 */

/** Where the recordings lie, and their list: { [id]: { text, ms, missions } }. */
export const VOICE_BASE = '/voice/';
export const MANIFEST_URL = `${VOICE_BASE}manifest.json`;

/** One recorded line: what it says, how long it speaks, ms, and the missions that say it. */
export interface VoiceEntry {
  readonly text: string;
  readonly ms: number;
  readonly missions: readonly string[];
}

export type VoiceManifest = Readonly<Record<string, VoiceEntry>>;

/** The radio's band, Hz: each edge a fourth-order Butterworth, two biquads. */
export const BAND_LOW = 300;
export const BAND_HIGH = 3400;
/** The two stages' Q of a fourth-order Butterworth, linear. */
const BUTTERWORTH = [0.5412, 1.3066] as const;
/** How hard the shaper bends: tanh(k·x)/tanh(k) — rounded peaks, no hard clip. */
export const SHAPER_DRIVE = 2.2;
/** A line's peak going into the chain. */
const SPEECH_PEAK = 0.9;
/** The static under the speech, against the speech's peak: −30 dB. */
export const NOISE_BED = 10 ** (-30 / 20);
/** The voice at the master gain: over the beds and the music, under the crew's own voices. */
const VOICE_LEVEL = 0.12;
/** The beds and the music while it speaks: −6 dB. */
export const DUCK_LEVEL = 10 ** (-6 / 20);
/** The squelch before the speech, s; the tail after it. */
const KEY_S = 0.07;
const TAIL_S = 0.16;

/** The radio's chain: in at `input`, out of `out` at its level. */
export interface RadioChain {
  readonly input: GainNode;
  readonly filters: readonly BiquadFilterNode[];
  readonly shaper: WaveShaperNode;
  readonly out: GainNode;
}

/** The shaper's curve: tanh(SHAPER_DRIVE·x)/tanh(SHAPER_DRIVE) over −1 … 1, `points` long. */
export function shaperCurve(points = 1024): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points);
  const norm = Math.tanh(SHAPER_DRIVE);
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1;
    curve[i] = Math.tanh(SHAPER_DRIVE * x) / norm;
  }
  return curve;
}

/**
 * A handset's sound into `dest` at `level`: high-pass at 300 Hz, low-pass at 3.4 kHz — each
 * fourth order, as two biquads (Web Audio gives a high- or low-pass's Q in dB) — then a gentle
 * waveshaper. On any context: the live one, or an offline one to measure it.
 */
export function radioChain(ctx: BaseAudioContext, dest: AudioNode, level: number): RadioChain {
  const input = gain(ctx, 1);
  const stage = (type: BiquadFilterType, hz: number) => (q: number) =>
    biquad(ctx, type, hz, 20 * Math.log10(q));
  const filters = [
    ...BUTTERWORTH.map(stage('highpass', BAND_LOW)),
    ...BUTTERWORTH.map(stage('lowpass', BAND_HIGH)),
  ];
  const shaper = ctx.createWaveShaper();
  shaper.curve = shaperCurve();
  shaper.oversample = '2x';
  const out = outlet(ctx, dest, level);
  chain(input, ...filters, shaper, out);
  return { input, filters, shaper, out };
}

/** The manifest as lines to ids: a line on the air is found by what it says. */
export function idsOf(manifest: VoiceManifest): Map<string, string> {
  return new Map(Object.entries(manifest).map(([id, entry]) => [entry.text, id]));
}

/** A decoded recording, and its peak, which the chain is fed at SPEECH_PEAK. */
interface Clip {
  readonly buffer: AudioBuffer;
  readonly peak: number;
}

/** The line on the air: from when to when it speaks, audio time, and how to cut it short. */
interface Speaking {
  readonly id: string;
  readonly start: number;
  readonly end: number;
  readonly cut: (at: number) => void;
}

/** What the voice has loaded: the manifest by line, the recordings by id. */
const store: {
  manifest: Promise<VoiceManifest | null> | null;
  ids: Map<string, string>;
  loading: Map<string, Promise<void>>;
  clips: Map<string, Clip>;
} = { manifest: null, ids: new Map(), loading: new Map(), clips: new Map() };

let speaking: Speaking | null = null;
let lastId: string | null = null;
let duck: Fade = still(1);

/** The manifest, fetched once; null where there is none to be had (it is tried again later). */
function manifest(): Promise<VoiceManifest | null> {
  store.manifest ??= fetch(MANIFEST_URL)
    .then((res) => (res.ok ? (res.json() as Promise<VoiceManifest>) : null))
    .then((loaded) => {
      if (loaded === null) store.manifest = null;
      else store.ids = idsOf(loaded);
      return loaded;
    })
    .catch(() => {
      store.manifest = null;
      return null;
    });
  return store.manifest;
}

/** Fetches and decodes the recording `id`, once; a failure lets a later call try again. */
function load(id: string): Promise<void> {
  const known = store.loading.get(id);
  if (known !== undefined) return known;
  const engine = audioEngine();
  if (engine === null) return Promise.resolve();
  const loading = fetch(`${VOICE_BASE}${id}.m4a`)
    .then((res) => {
      if (!res.ok) throw new Error(`voice ${id}: ${res.status}`);
      return res.arrayBuffer();
    })
    .then((bytes) => engine.ctx.decodeAudioData(bytes))
    .then((buffer) => {
      store.clips.set(id, { buffer, peak: peakOf(buffer) });
    })
    .catch(() => {
      store.loading.delete(id);
    });
  store.loading.set(id, loading);
  return loading;
}

/** The loudest sample of a recording's first channel; 1 for a silent one. */
function peakOf(buffer: AudioBuffer): number {
  const data = buffer.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] ?? 0));
  return peak > 0 ? peak : 1;
}

/** At a run's start: every line of the mission `missionId` is fetched and decoded. */
export function preloadVoice(missionId: string): void {
  manifest()
    .then((loaded) => {
      for (const [id, entry] of Object.entries(loaded ?? {})) {
        if (entry.missions.includes(missionId)) void load(id);
      }
    })
    .catch(() => undefined);
}

/** Lines that just came over the air: any with a recording not loaded yet is fetched now. */
export function preloadLines(texts: readonly string[]): void {
  if (texts.length === 0) return;
  manifest()
    .then(() => {
      for (const text of texts) {
        const id = store.ids.get(text);
        if (id !== undefined) void load(id);
      }
    })
    .catch(() => undefined);
}

/**
 * Speaks the line `text` over the radio, now, cutting short one still on the air. True where
 * it does; false where it has no recording ready or nothing can play — the caller chirps then.
 */
export function sayLine(text: string): boolean {
  try {
    const id = store.ids.get(text);
    const clip = id === undefined ? undefined : store.clips.get(id);
    const engine = playingEngine();
    if (id === undefined || clip === undefined || engine === null) return false;
    const now = engine.ctx.currentTime;
    speaking?.cut(now);
    speaking = speak(engine, id, clip, now + LOOKAHEAD);
    lastId = id;
    return true;
  } catch {
    // Deliberately silent: the banner shows the line as well.
    return false;
  }
}

/** The line `id` keyed at `at`: squelch, speech over its static, the tail; the lab ducks. */
function speak(engine: Engine, id: string, clip: Clip, at: number): Speaking {
  const { ctx } = engine;
  const radio = radioChain(ctx, engine.master, VOICE_LEVEL);
  const start = at + KEY_S;
  const end = start + clip.buffer.duration;
  const speech = ctx.createBufferSource();
  speech.buffer = clip.buffer;
  chain(speech, gain(ctx, SPEECH_PEAK / clip.peak), radio.input);
  speech.start(start);
  const bed = noiseLoop(ctx, start);
  chain(bed, gain(ctx, NOISE_BED), radio.input);
  bed.stop(end);
  const sources = [speech, bed, ...squelch(ctx, radio.input, at, end)];
  onAllEnded(sources, () => radio.out.disconnect());
  duckUnder(engine, start, end);
  const cut = (when: number): void => {
    radio.out.gain.setTargetAtTime(0, when, 0.02);
    for (const source of sources) source.stop(when + 0.1);
    unduck(engine, when);
  };
  return { id, start, end, cut };
}

/** The press-to-talk key: static and a click as it goes down, a longer tail as it comes up. */
function squelch(
  ctx: BaseAudioContext,
  dest: AudioNode,
  at: number,
  end: number,
): AudioScheduledSourceNode[] {
  const burst = (from: number, seconds: number, peak: number): AudioBufferSourceNode => {
    const noise = noiseBurst(ctx, from, seconds);
    const level = gain(ctx, 0);
    const envelope = { peak, attack: 0.002, hold: seconds * 0.3, decay: seconds * 0.7 };
    applyEnvelope(level.gain, from, envelope);
    chain(noise, level, dest);
    return noise;
  };
  return [
    burst(at, KEY_S * 0.6, 0.5),
    tick(ctx, dest, at + KEY_S * 0.5, 2000, 0.8),
    burst(end + 0.02, TAIL_S, 0.45),
    tick(ctx, dest, end + 0.02 + TAIL_S, 1600, 0.6),
  ];
}

/** The beds and the music go down 6 dB for the speech from `start` and come back after `end`. */
function duckUnder(engine: Engine, start: number, end: number): void {
  const param = engine.duck.gain;
  const now = engine.ctx.currentTime;
  fadeTo(param, duck, now, [now, Math.max(now + 0.08, start)], DUCK_LEVEL);
  param.setValueAtTime(DUCK_LEVEL, end);
  param.linearRampToValueAtTime(1, end + 0.4);
  duck = { from: DUCK_LEVEL, to: 1, start: end, end: end + 0.4 };
}

/** The beds and the music come back from `at`: the line was cut short. */
function unduck(engine: Engine, at: number): void {
  duck = fadeTo(engine.duck.gain, duck, engine.ctx.currentTime, [at, at + 0.3], 1);
}

/** Cuts a line still on the air: the game screen is gone. */
export function stopVoice(): void {
  try {
    const engine = playingEngine();
    if (engine !== null) speaking?.cut(engine.ctx.currentTime);
  } catch {
    // Deliberately silent: the line ends on its own.
  }
  speaking = null;
}

/** Whether a line speaks now, and the recording that spoke last, by id; null before any. */
export interface VoiceProbe {
  playing: boolean;
  lastId: string | null;
}

export function voiceProbe(): VoiceProbe {
  const now = audioEngine()?.ctx.currentTime ?? 0;
  const playing = speaking !== null && now >= speaking.start && now < speaking.end;
  return { playing, lastId };
}

/** The radio chain measured: white noise in, and what came out, at `rate`. */
export interface RadioRender {
  rate: number;
  input: number[];
  output: number[];
}

/** Renders the radio chain once on an OfflineAudioContext, white noise in: for the harness. */
export async function renderRadio(): Promise<RadioRender> {
  const rate = 44100;
  const length = 32768;
  const ctx = new OfflineAudioContext(1, length, rate);
  const noise = ctx.createBuffer(1, length, rate);
  const input = noise.getChannelData(0);
  for (let i = 0; i < length; i++) input[i] = Math.random() - 0.5;
  const source = ctx.createBufferSource();
  source.buffer = noise;
  source.connect(radioChain(ctx, ctx.destination, 1).input);
  source.start(0);
  const rendered = await ctx.startRendering();
  return { rate, input: Array.from(input), output: Array.from(rendered.getChannelData(0)) };
}

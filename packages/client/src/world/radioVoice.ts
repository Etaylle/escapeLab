import {
  audioEngine,
  biquad,
  chain,
  fadeTo,
  gain,
  LOOKAHEAD,
  noiseLoop,
  onAllEnded,
  outlet,
  playingEngine,
  startSample,
  still,
  type Engine,
  type Fade,
} from './audio.js';
import { sample, type SfxId } from './samples.js';

/**
 * A voice on the radio: mission control's lines, recorded once on a Mac with a neural voice
 * (scripts/voice.ts, public/voice/) and played as a handset hears them — band-limited to
 * 300 Hz–3.4 kHz, lightly saturated, over a faint bed of static, keyed with a squelch at either
 * end, the run's first line opened with the Leitstelle's own squelch, the squelches recordings
 * of their own (samples.ts) — while the beds and the music duck 6 dB under it (audio.ts, the
 * duck bus). The banner shows the line while it speaks;
 * a line without a recording, as a custom mission's, still only chirps (audio.ts
 * `radioChirp`). At a run's start the mission's lines are fetched and decoded, so that a line
 * plays the moment it is shown; a line that comes over the air is fetched then too, where it
 * was not yet. Nothing that plays throws — only the harness's offline render may reject — and
 * nothing plays while the context is held back.
 */

/** Where the recordings lie, and their list: { [id]: { text, ms, missions, opens?, file } }. */
export const VOICE_BASE = '/voice/';
export const MANIFEST_URL = `${VOICE_BASE}manifest.json`;

/** Who made a recording a person's: spoken on the /record page, or a file put there. */
export type PersonSource = 'human' | 'upload';

/**
 * One recorded line: what it says, how long it speaks, ms, the missions that say it, whether
 * it opens a run (a mission's `radio.start`), who made it — a person (`source`), or a synthetic
 * voice's render (`render`) — and its file under VOICE_BASE, an .m4a or an .mp3. The radio plays
 * whatever the entry names, alike.
 */
export interface VoiceEntry {
  readonly text: string;
  readonly ms: number;
  readonly missions: readonly string[];
  readonly opens?: true;
  readonly source?: PersonSource;
  readonly render?: string;
  readonly file: string;
}

export type VoiceManifest = Readonly<Record<string, VoiceEntry>>;

/** The radio's band, Hz: each edge a fourth-order Butterworth, two biquads. */
export const BAND_LOW = 300;
export const BAND_HIGH = 3400;
/** The two stages' Q of a fourth-order Butterworth, linear. */
const BUTTERWORTH = [0.5412, 1.3066] as const;
/**
 * How hard the shaper bends: tanh(k·x)/tanh(k) — rounded peaks, no hard clip. Light, so that
 * the consonants stay clear: a 1 kHz tone at the speech's peak comes out with 8 % distortion
 * (it was 17 % at 2.2), and the quiet parts are lifted 3 dB against the peaks (it was 7).
 */
export const SHAPER_DRIVE = 1.2;
/** A line's peak going into the chain. */
export const SPEECH_PEAK = 0.9;
/** The static under the speech, against the speech's peak: −33 dB. */
export const NOISE_BED = 10 ** (-33 / 20);
/** The voice at the master gain: over the beds and the music, under the crew's own voices. */
const VOICE_LEVEL = 0.12;
/** The beds and the music while it speaks: −6 dB. */
export const DUCK_LEVEL = 10 ** (-6 / 20);
/** The squelch before the speech, s; the tail after it. */
export const KEY_S = 0.07;
export const TAIL_S = 0.16;
/**
 * The Leitstelle opening the channel before a run's first line, s: static swelling up and
 * snapping shut, then the key's squelch as before every line.
 */
export const OPEN_S = 0.4;
/**
 * The squelches' recordings going into the chain: their peak (−3 dBFS) lands about 6 dB under
 * the speech's (SPEECH_PEAK).
 */
export const KEY_LEVEL = 0.65;

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

/** The recordings that open a run, by id: the radio keys them with the Leitstelle's opening. */
export function openersOf(manifest: VoiceManifest): Set<string> {
  return new Set(Object.keys(manifest).filter((id) => manifest[id]?.opens === true));
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

/**
 * What the voice has loaded: the manifest by line, the recordings' files by id, the openers,
 * the recordings by id.
 */
const store: {
  manifest: Promise<VoiceManifest | null> | null;
  ids: Map<string, string>;
  files: Map<string, string>;
  openers: Set<string>;
  loading: Map<string, Promise<void>>;
  clips: Map<string, Clip>;
} = {
  manifest: null,
  ids: new Map(),
  files: new Map(),
  openers: new Set(),
  loading: new Map(),
  clips: new Map(),
};

let speaking: Speaking | null = null;
let lastId: string | null = null;
let lastOpened = false;
let duck: Fade = still(1);

/** The manifest, fetched once; null where there is none to be had (it is tried again later). */
function manifest(): Promise<VoiceManifest | null> {
  store.manifest ??= fetch(MANIFEST_URL)
    .then((res) => (res.ok ? (res.json() as Promise<VoiceManifest>) : null))
    .then((loaded) => {
      if (loaded === null) {
        store.manifest = null;
      } else {
        store.ids = idsOf(loaded);
        store.files = new Map(Object.entries(loaded).map(([id, entry]) => [id, entry.file]));
        store.openers = openersOf(loaded);
      }
      return loaded;
    })
    .catch(() => {
      store.manifest = null;
      return null;
    });
  return store.manifest;
}

/**
 * Fetches and decodes the recording `id` from the file its entry names, once; a failure lets a
 * later call try again.
 */
function load(id: string): Promise<void> {
  const known = store.loading.get(id);
  if (known !== undefined) return known;
  const engine = audioEngine();
  const file = store.files.get(id);
  if (engine === null || file === undefined) return Promise.resolve();
  const loading = fetch(`${VOICE_BASE}${file}`)
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
 * Speaks the line `text` over the radio, now, cutting short one still on the air: a line that
 * opens a run after the Leitstelle's opening squelch. True where it does; false where it has
 * no recording ready or nothing can play — the caller chirps then.
 */
export function sayLine(text: string): boolean {
  try {
    const id = store.ids.get(text);
    const clip = id === undefined ? undefined : store.clips.get(id);
    const engine = playingEngine();
    if (id === undefined || clip === undefined || engine === null) return false;
    const now = engine.ctx.currentTime;
    const opens = store.openers.has(id);
    speaking?.cut(now);
    speaking = speak(engine, id, clip, now + LOOKAHEAD, opens);
    lastId = id;
    lastOpened = opens;
    return true;
  } catch {
    // Deliberately silent: the banner shows the line as well.
    return false;
  }
}

/**
 * How long the line `text` keeps the air when it is spoken, ms: the Leitstelle's opening where
 * it opens a run, the key, its recording, the tail. Null where it has no recording ready.
 */
export function airtimeMs(text: string): number | null {
  const id = store.ids.get(text);
  const clip = id === undefined ? undefined : store.clips.get(id);
  if (id === undefined || clip === undefined) return null;
  const lead = (store.openers.has(id) ? OPEN_S : 0) + KEY_S;
  return Math.round((lead + clip.buffer.duration + TAIL_S) * 1000);
}

/**
 * The line `id` keyed at `at`: the opening where it `opens` a run, the squelch, speech over its
 * static, the tail; the lab ducks.
 */
function speak(engine: Engine, id: string, clip: Clip, at: number, opens: boolean): Speaking {
  const { ctx } = engine;
  const radio = radioChain(ctx, engine.radio, VOICE_LEVEL);
  const keyed = opens ? at + OPEN_S : at;
  const start = keyed + KEY_S;
  const end = start + clip.buffer.duration;
  const speech = ctx.createBufferSource();
  speech.buffer = clip.buffer;
  chain(speech, gain(ctx, SPEECH_PEAK / clip.peak), radio.input);
  speech.start(start);
  const bed = noiseLoop(ctx, start);
  chain(bed, gain(ctx, NOISE_BED), radio.input);
  bed.stop(end);
  const keys = outlet(ctx, radio.input, KEY_LEVEL);
  const opening = opens ? openChannel(ctx, keys, at) : [];
  const sources = [speech, bed, ...opening, ...squelch(ctx, keys, keyed, end)];
  onAllEnded(sources, () => radio.out.disconnect());
  duckUnder(engine, opens ? at : start, end);
  const cut = (when: number): void => {
    radio.out.gain.setTargetAtTime(0, when, 0.02);
    for (const source of sources) source.stop(when + 0.1);
    unduck(engine, when);
  };
  return { id, start, end, cut };
}

/** The recording `id` once into `dest` from `at`: none where it is not loaded. */
function keySound(
  ctx: BaseAudioContext,
  id: SfxId,
  dest: AudioNode,
  at: number,
): AudioScheduledSourceNode[] {
  const recording = sample(id);
  return recording === null ? [] : [startSample(ctx, recording, dest, at)];
}

/**
 * The press-to-talk key: its click and a crackle as it goes down at `at`, its squelch tail as
 * it comes up after the speech ends at `end`.
 */
function squelch(
  ctx: BaseAudioContext,
  dest: AudioNode,
  at: number,
  end: number,
): AudioScheduledSourceNode[] {
  const down = keySound(ctx, 'radio-key', dest, at);
  return [...down, ...keySound(ctx, 'radio-tail', dest, end + 0.02)];
}

/**
 * The Leitstelle opening the channel at `at`, before a run's first line: static swells up for a
 * third of a second and snaps shut on the squelch gate's click, a beat before the key.
 */
function openChannel(
  ctx: BaseAudioContext,
  dest: AudioNode,
  at: number,
): AudioScheduledSourceNode[] {
  return keySound(ctx, 'radio-open', dest, at);
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

/**
 * Whether a line speaks now, the recording that spoke last, by id (null before any), and
 * whether that one came with the Leitstelle's opening squelch.
 */
export interface VoiceProbe {
  playing: boolean;
  lastId: string | null;
  opened: boolean;
}

export function voiceProbe(): VoiceProbe {
  const now = audioEngine()?.ctx.currentTime ?? 0;
  const playing = speaking !== null && now >= speaking.start && now < speaking.end;
  return { playing, lastId, opened: lastOpened };
}

/** The radio chain measured: what went in — white noise, or a line — and what came out. */
export interface RadioRender {
  rate: number;
  input: number[];
  output: number[];
}

/** The rate the harness's renders run at, Hz. */
const RENDER_RATE = 44100;

/**
 * Renders the radio chain once on an OfflineAudioContext, for the harness: white noise in, or
 * the recording `id` at the speech's peak, as a line goes in. Rejects where that recording
 * cannot be fetched or decoded.
 */
export async function renderRadio(id?: string): Promise<RadioRender> {
  const input = id === undefined ? whiteNoise(32768) : await lineAt(id, RENDER_RATE);
  const ctx = new OfflineAudioContext(1, input.length, RENDER_RATE);
  const buffer = ctx.createBuffer(1, input.length, RENDER_RATE);
  buffer.getChannelData(0).set(input);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(radioChain(ctx, ctx.destination, 1).input);
  source.start(0);
  const rendered = await ctx.startRendering();
  const output = Array.from(rendered.getChannelData(0));
  return { rate: RENDER_RATE, input: Array.from(input), output };
}

/** `length` samples of white noise from −0.5 to 0.5. */
function whiteNoise(length: number): Float32Array {
  const noise = new Float32Array(length);
  for (let i = 0; i < length; i++) noise[i] = Math.random() - 0.5;
  return noise;
}

/**
 * The recording `id`, from the file its entry names, decoded at `rate`, its peak at SPEECH_PEAK
 * as `speak` feeds it in.
 */
async function lineAt(id: string, rate: number): Promise<Float32Array> {
  const file = (await manifest())?.[id]?.file;
  if (file === undefined) {
    throw new Error(`voice ${id}: not in the manifest`);
  }
  const res = await fetch(`${VOICE_BASE}${file}`);
  if (!res.ok) {
    throw new Error(`voice ${id}: ${res.status}`);
  }
  const bytes = await res.arrayBuffer();
  const decoded = await new OfflineAudioContext(1, 1, rate).decodeAudioData(bytes);
  const scale = SPEECH_PEAK / peakOf(decoded);
  return Float32Array.from(decoded.getChannelData(0), (sample) => sample * scale);
}

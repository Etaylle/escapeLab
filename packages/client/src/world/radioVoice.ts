import {
  audioEngine,
  biquad,
  chain,
  gain,
  LOOKAHEAD,
  noiseLoop,
  onAllEnded,
  outlet,
  playingEngine,
  startSample,
  type Engine,
} from './audio.js';
import type { Mood, Speaker } from '@escapelab/core';
import { hold, letGo } from './audioMemory.js';
import { duck, unduck } from './mix.js';
import { sample, type SfxId } from './samples.js';

/**
 * A voice on the radio: mission control's lines, recorded once on a Mac with a neural voice
 * (scripts/voice.ts, public/voice/) and played as a handset hears them — band-limited to
 * 300 Hz–3.4 kHz, lightly saturated, over a faint bed of static, keyed with a squelch at either
 * end, the run's first line opened with the Leitstelle's own squelch, the squelches recordings
 * of their own (samples.ts) — while the music goes 8 dB and the beds 4 dB down under it (mix.ts
 * `duck`). The banner goes up as the line starts and stays while it speaks (onAir.ts); a line
 * without a recording, as a custom mission's, still only chirps (audio.ts `radioChirp`). At a
 * run's start a page fetches the recordings' list alone (`voiceForRun`), never a recording: a
 * line's own file comes as the line is queued (`preloadLines`) — the take the run picked, which
 * its event names — and is decoded then, at 22.05 kHz in one channel, a few tens of milliseconds,
 * and let go once it has been spoken, so that a page keeps a line or two decoded, never a
 * mission's (audioMemory.ts), and the files of the last FILES_KEPT lines as they came, those of a
 * run before none. Nothing that plays throws — only the harness's offline render may reject — and
 * nothing plays while the context is held back.
 */

/**
 * Where the recordings lie, and their list: the voices that speak them (`voices`, the script's)
 * and every recorded line by its id (`lines`: { [id]: { text, ms, missions, speaker, mood?,
 * opens?, file } }).
 */
export const VOICE_BASE = '/voice/';
export const MANIFEST_URL = `${VOICE_BASE}manifest.json`;

/** Who made a recording a person's: spoken on the /record page, or a file put there. */
export type PersonSource = 'human' | 'upload';

/**
 * One recorded line: what it says, how long it speaks, ms, the missions that say it, who says
 * it — the plant's loudspeakers or the operator (core radio.ts `Speaker`) — the mood it was
 * asked for in (core radio.ts `MOODS`), whether it opens a run (a mission's `radio.start`),
 * who made it — a person (`source`), or a synthetic voice's render (`render`) — and its file
 * under VOICE_BASE, an .m4a or an .mp3. The game plays whatever the entry names, alike.
 */
export interface VoiceEntry {
  readonly text: string;
  readonly ms: number;
  readonly missions: readonly string[];
  readonly speaker: Speaker;
  readonly mood?: Mood;
  readonly opens?: true;
  readonly source?: PersonSource;
  readonly render?: string;
  readonly file: string;
}

/** The recordings' list as the game reads it: every recorded line, by its id. */
export interface VoiceManifest {
  readonly lines: Readonly<Record<string, VoiceEntry>>;
}

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
  return new Map(Object.entries(manifest.lines).map(([id, entry]) => [entry.text, id]));
}

/** The recordings that open a run, by id: the radio keys them with the Leitstelle's opening. */
export function openersOf(manifest: VoiceManifest): Set<string> {
  const { lines } = manifest;
  return new Set(Object.keys(lines).filter((id) => lines[id]?.opens === true));
}

/** A decoded recording, and its peak, which the chain is fed at SPEECH_PEAK. */
export interface Clip {
  readonly buffer: AudioBuffer;
  readonly peak: number;
}

/**
 * The rate a line is decoded at, Hz: its one channel kept to what the radio's band (3.4 kHz) and
 * the loudspeakers' (5 kHz) let through, with room to spare — a quarter of the memory of 44.1 kHz
 * in two channels.
 */
export const VOICE_RATE = 22050;

/**
 * How many lines' files a page keeps as they came, the newest: those queued or said lately, so
 * that a line said again within a run is not fetched again. A run's start lets them all go.
 */
export const FILES_KEPT = 4;

/** The line on the air: from when to when it speaks, audio time, and how to cut it short. */
interface Speaking {
  readonly id: string;
  readonly start: number;
  readonly end: number;
  readonly cut: (at: number) => void;
}

/**
 * What the voice has loaded: the manifest by line, the recordings' files and lengths by id, the
 * openers, the files fetched lately as they came — compressed, a few kB a second, the newest last
 * (FILES_KEPT) — and the lines decoded now.
 */
const store: {
  manifest: Promise<VoiceManifest | null> | null;
  ids: Map<string, string>;
  files: Map<string, string>;
  ms: Map<string, number>;
  openers: Set<string>;
  bytes: Map<string, Promise<ArrayBuffer | null>>;
  decoding: Map<string, Promise<Clip | null>>;
  clips: Map<string, Clip>;
} = {
  manifest: null,
  ids: new Map(),
  files: new Map(),
  ms: new Map(),
  openers: new Set(),
  bytes: new Map(),
  decoding: new Map(),
  clips: new Map(),
};

/** A line asked for (`sayLine`), as it was asked: a newer ask, or the voice stopping, moots it. */
interface Ask {
  readonly id: string;
}

let speaking: Speaking | null = null;
let lastId: string | null = null;
let lastOpened = false;
/** The line asked for last, whose decoding a newer ask makes moot. */
let asked: Ask | null = null;

/** The manifest, fetched once; null where there is none to be had (it is tried again later). */
function manifest(): Promise<VoiceManifest | null> {
  store.manifest ??= fetch(MANIFEST_URL)
    .then((res) => (res.ok ? (res.json() as Promise<VoiceManifest>) : null))
    .then((loaded) => {
      if (loaded === null) {
        store.manifest = null;
      } else {
        const lines = Object.entries(loaded.lines);
        store.ids = idsOf(loaded);
        store.files = new Map(lines.map(([id, entry]) => [id, entry.file]));
        store.ms = new Map(lines.map(([id, entry]) => [id, entry.ms]));
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
 * The file of the recording `id`, fetched where it is not kept and kept as it came, the newest of
 * FILES_KEPT; null where it failed.
 */
function bytesOf(id: string): Promise<ArrayBuffer | null> {
  const fetching = store.bytes.get(id) ?? fetchFile(id);
  // The newest last: asked again, it is kept longest.
  store.bytes.delete(id);
  store.bytes.set(id, fetching);
  for (const old of store.bytes.keys()) {
    if (store.bytes.size <= FILES_KEPT) break;
    store.bytes.delete(old);
  }
  return fetching;
}

/** The file of the recording `id` from the server; null where it has none or the fetch failed. */
function fetchFile(id: string): Promise<ArrayBuffer | null> {
  const file = store.files.get(id);
  if (file === undefined) return Promise.resolve(null);
  return fetch(`${VOICE_BASE}${file}`)
    .then((res) => {
      if (!res.ok) throw new Error(`voice ${id}: ${res.status}`);
      return res.arrayBuffer();
    })
    .catch(() => {
      store.bytes.delete(id);
      return null;
    });
}

/**
 * The recording `id` decoded at VOICE_RATE in one channel, once — from its file as fetched,
 * which decoding leaves whole — and counted (audioMemory.ts) until it is let go (`dropLine`).
 */
function decodeLine(id: string): Promise<Clip | null> {
  const known = store.decoding.get(id);
  if (known !== undefined) return known;
  const decoding = bytesOf(id)
    .then((bytes) => {
      if (bytes === null) return null;
      return new OfflineAudioContext(1, 1, VOICE_RATE).decodeAudioData(bytes.slice(0));
    })
    .then((buffer) => {
      if (buffer === null || store.decoding.get(id) !== decoding) return null;
      const clip = { buffer, peak: peakOf(buffer) };
      store.clips.set(id, clip);
      hold(`voice:${id}`, 'voice', buffer);
      return clip;
    })
    .catch(() => null)
    .then((clip) => {
      if (clip === null && store.decoding.get(id) === decoding) store.decoding.delete(id);
      return clip;
    });
  store.decoding.set(id, decoding);
  return decoding;
}

/** The decoded recording `id` let go: what it held is free; its file stays a while (FILES_KEPT). */
function dropLine(id: string): void {
  store.decoding.delete(id);
  store.clips.delete(id);
  letGo(`voice:${id}`);
}

/** The loudest sample of a recording's first channel; 1 for a silent one. */
function peakOf(buffer: AudioBuffer): number {
  const data = buffer.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] ?? 0));
  return peak > 0 ? peak : 1;
}

/**
 * A run starts: the recordings' list is fetched where it is not here yet — a few kB, so that each
 * line's length is known before it airs — and the files kept from the runs before are let go. No
 * recording comes now: each line's own file comes as the line is queued (`preloadLines`), the
 * take the run picked, which its event names (core radio.ts `pickLine` picks it by the seed).
 */
export function voiceForRun(): void {
  store.bytes.clear();
  void manifest();
}

/**
 * The manifest, once it is here: what the plant's loudspeakers (pa.ts) wait for before they lay
 * their lines out by their lengths. Resolves either way, empty-handed where there is none.
 */
export function voiceReady(): Promise<void> {
  return manifest().then(() => undefined);
}

/** The decoded recording of the line `text`, where it is decoded; null otherwise. */
export function clipOf(text: string): Clip | null {
  const id = store.ids.get(text);
  return id === undefined ? null : (store.clips.get(id) ?? null);
}

/**
 * The recording of the line `text`, decoded now where it is not yet (once, however often
 * asked) and counted until it is let go (`releaseLine`); null where it has none, or it failed.
 */
export function lineClip(text: string): Promise<Clip | null> {
  const id = store.ids.get(text);
  return id === undefined ? Promise.resolve(null) : decodeLine(id);
}

/** How long the line `text` speaks by the manifest, ms; null before it, or without a recording. */
export function recordedMs(text: string): number | null {
  const id = store.ids.get(text);
  return id === undefined ? null : (store.ms.get(id) ?? null);
}

/**
 * Lines about to be heard — just come over the air, or the loudspeakers' — each decoded now
 * where it is not yet: its file is here already, or fetched first.
 */
export function preloadLines(texts: readonly string[]): void {
  if (texts.length === 0) return;
  manifest()
    .then(() => {
      for (const text of texts) {
        const id = store.ids.get(text);
        if (id !== undefined) void decodeLine(id);
      }
    })
    .catch(() => undefined);
}

/** The line `text` heard and done with (the loudspeakers', pa.ts): what it held let go. */
export function releaseLine(text: string): void {
  const id = store.ids.get(text);
  if (id !== undefined && speaking?.id !== id) dropLine(id);
}

/**
 * Speaks the line `text` over the radio — now where it is decoded, else as soon as it is —
 * cutting short one still on the air: a line that opens a run after the Leitstelle's opening
 * squelch; once spoken, it is let go. Into the radio's bus, or `into` where given: a level of the
 * caller's on the way there (the lobby's Funkprobe, radioCheck.ts). Resolves as it goes on the
 * air, with how long it keeps it, ms, by its recording as decoded (`airtimeMs`); with null where
 * it never does — it has no recording, nothing can play, its recording failed, or a line asked
 * for after it or the voice stopping (`stopVoice`) made it moot: the caller chirps then.
 */
export function sayLine(text: string, into?: AudioNode): Promise<number | null> {
  try {
    const id = store.ids.get(text);
    const engine = playingEngine();
    if (id === undefined || engine === null || !store.files.has(id)) return Promise.resolve(null);
    const ask: Ask = { id };
    asked = ask;
    const clip = store.clips.get(id);
    if (clip !== undefined) return Promise.resolve(airAsked(engine, ask, clip, into));
    return decodeLine(id)
      .then((decoded) => (decoded === null ? null : airAsked(engine, ask, decoded, into)))
      .catch(() => null);
  } catch {
    // Deliberately silent: the banner shows the line as well.
    return Promise.resolve(null);
  }
}

/**
 * The line asked for as `ask` on the air with its decoded `clip`, where nothing made it moot
 * since: how long it keeps the air, ms; null where it is moot.
 */
function airAsked(engine: Engine, ask: Ask, clip: Clip, into?: AudioNode): number | null {
  if (asked !== ask) return null;
  onAir(engine, ask.id, clip, into);
  return airtimeOf(ask.id, clip.buffer.duration);
}

/**
 * The line `id` on the air from now into `into`, cutting short one still on it; let go once it
 * ends.
 */
function onAir(engine: Engine, id: string, clip: Clip, into: AudioNode = engine.voice): void {
  const now = engine.ctx.currentTime;
  const opens = store.openers.has(id);
  speaking?.cut(now);
  const line = speak(engine, id, clip, now + LOOKAHEAD, opens, into);
  speaking = line;
  lastId = id;
  lastOpened = opens;
  setTimeout(() => {
    if (speaking !== line) dropLine(id);
    else if (engine.ctx.currentTime >= line.end) dropLine(id);
  }, (line.end - now + TAIL_S + 0.2) * 1000);
}

/**
 * How long the line `text` keeps the air when it is spoken, ms: the Leitstelle's opening where
 * it opens a run, the key, its recording — as decoded, or by the manifest — the tail. Null where
 * it has no recording.
 */
export function airtimeMs(text: string): number | null {
  const id = store.ids.get(text);
  if (id === undefined) return null;
  const clip = store.clips.get(id);
  const seconds = clip?.buffer.duration ?? (store.ms.get(id) ?? NaN) / 1000;
  return Number.isFinite(seconds) ? airtimeOf(id, seconds) : null;
}

/**
 * How long the recording `id`, `seconds` long, keeps the air when it is spoken, ms: the
 * Leitstelle's opening where it opens a run, the key, the speech, the tail.
 */
function airtimeOf(id: string, seconds: number): number {
  const lead = (store.openers.has(id) ? OPEN_S : 0) + KEY_S;
  return Math.round((lead + seconds + TAIL_S) * 1000);
}

/**
 * The line `id` keyed at `at` into `into`: the opening where it `opens` a run, the squelch,
 * speech over its static, the tail; the lab ducks.
 */
function speak(
  engine: Engine,
  id: string,
  clip: Clip,
  at: number,
  opens: boolean,
  into: AudioNode,
): Speaking {
  const { ctx } = engine;
  const radio = radioChain(ctx, into, VOICE_LEVEL);
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
  duck(engine, 'voice', opens ? at : start, end, ctx.currentTime);
  const cut = (when: number): void => {
    radio.out.gain.setTargetAtTime(0, when, 0.02);
    for (const source of sources) source.stop(when + 0.1);
    unduck(engine, 'voice', when, ctx.currentTime);
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

/** Cuts a line still on the air, and one asked for and still decoding: the screen is gone. */
export function stopVoice(): void {
  asked = null;
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
  const file = (await manifest())?.lines[id]?.file;
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

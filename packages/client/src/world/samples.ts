/**
 * samples.ts: the lab's recorded sounds — its effects, its rooms' beds, its music — as the game
 * plays them. ElevenLabs made them (scripts/sfx.ts, audio/catalog.json): public/sfx/ and
 * public/music/, each folder listed in its manifest.json. Every recording is fetched and decoded
 * once, cached by its address, and brought to its loudness as it is decoded: its samples times
 * the manifest's `gain`, while the file stays as it was made. The lobby loads them all
 * (`preloadSamples`), so that a sound plays on time the first time; a world loads them too, for a
 * page that comes in during a run. What is not loaded is not played — a recording that fails to
 * load is said once on the console and stays silent; nothing synthetic stands in for it. Decoded
 * on an OfflineAudioContext at the files' own 44.1 kHz, so that no live context has to exist
 * before a gesture lets it run.
 */

/** Every effect the game plays: its id in public/sfx/manifest.json (and audio/catalog.json). */
export const SFX_IDS = [
  'lever-chunk',
  'lever-pull',
  'lever-spring',
  'relay-click',
  'breaker-thunk',
  'short-arc',
  'spark',
  'wire-snip',
  'power-down',
  'emergency-buzz',
  'tube-strike',
  'hatch-grind',
  'door-slide',
  'step-1',
  'step-2',
  'step-3',
  'radio-key',
  'radio-tail',
  'radio-open',
  'sheet-down',
  'book-shut',
  'pencil',
  'klaxon',
  'console-ready',
  'ping',
  'discovery',
  'locker-open',
  'cabinet-unlock',
  'countdown-beep',
  'countdown-go',
  'part-seat',
  'drone-alert',
  'key-click',
  'reject-buzz',
  'solved-chunk',
  'solved-chord',
  'toggle-clack',
  'button-thunk',
  'mushroom-stomp',
  'probe-click',
  'stage-chime',
  'dial-detent',
  'step-tick',
  'wall-thud',
  'lamp-pop',
  'type-blip',
  'ok-beeps',
  'server-spinup',
  'hold-tick',
  'creak',
  'drip',
  'far-clank',
  'machine-stroke',
  'steam-hiss',
  'bubbling',
  'console-tick',
  'core-throb',
  'mains-hum',
  'siren',
  'drone-rotor',
  'bed-server',
  'bed-archive',
  'bed-corridor',
  'bed-lab',
  'bed-reactor',
  'bed-control',
  'bed-plain',
  'bed-machine-idle',
  'bed-reactor-idle',
] as const;

/** Every piece of music: the three stems and the two stings, in public/music/manifest.json. */
export const MUSIC_IDS = ['calm', 'tense', 'critical', 'won', 'lost'] as const;

export type SfxId = (typeof SFX_IDS)[number];
export type MusicId = (typeof MUSIC_IDS)[number];
export type SampleId = SfxId | MusicId;

/** Where each group's recordings and their manifest lie. */
export const SFX_BASE = '/sfx/';
export const MUSIC_BASE = '/music/';

/**
 * One recording as its manifest lists it (scripts/sfx.ts): its file, how long it lasts, ms, the
 * gain that brings it to its loudness, where its sound starts, ms, its noise floor and its RMS
 * before the gain, whether it plays round and round, the hash of what made it, and who made it.
 */
export interface SampleEntry {
  readonly file: string;
  readonly ms: number;
  readonly gain: number;
  readonly startMs: number;
  /** the RMS of its quietest 100 ms, before the gain */
  readonly floor: number;
  /** its RMS from where its sound starts, before the gain */
  readonly rms: number;
  readonly loop: boolean;
  readonly hash: string;
  readonly source: 'elevenlabs';
}

/** A recording ready to play: its buffer at its loudness, and where its sound starts, s. */
export interface Sample {
  readonly buffer: AudioBuffer;
  readonly start: number;
}

/** The rate recordings are decoded at: the files' own. */
const DECODE_RATE = 44100;

/** The loads by address: each fetched and decoded once; one that failed is let go. */
const loads = new Map<string, Promise<Sample | null>>();
/** The recordings decoded, by id. */
const ready = new Map<string, Sample>();
/** The addresses whose failure has been said: each once. */
const said = new Set<string>();
/** Both manifests and every recording they name, loading or loaded; null before the first ask. */
let everything: Promise<void> | null = null;

/** Says once on the console that `url` could not be loaded, and why. */
function sayOnce(url: string, error: unknown): void {
  if (said.has(url)) return;
  said.add(url);
  const why = error instanceof Error ? error.message : String(error);
  console.warn(`sound: ${url} could not be loaded (${why}); it stays silent`);
}

/** `buffer` at the loudness `gain` brings it to: every sample of every channel times `gain`. */
function atLoudness(buffer: AudioBuffer, gain: number): AudioBuffer {
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) data[i] = (data[i] ?? 0) * gain;
  }
  return buffer;
}

/**
 * The recording `id` at `url`, as `entry` lists it: fetched and decoded once — a second ask for
 * the same address shares the first — brought to its loudness, and kept. Null where it could
 * not be loaded: that is said once, and a later ask tries again.
 */
export function loadSample(id: string, url: string, entry: SampleEntry): Promise<Sample | null> {
  const known = loads.get(url);
  if (known !== undefined) return known;
  const load = fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.arrayBuffer();
    })
    .then((bytes) => new OfflineAudioContext(1, 1, DECODE_RATE).decodeAudioData(bytes))
    .then((buffer) => {
      const loaded: Sample = {
        buffer: atLoudness(buffer, entry.gain),
        start: entry.startMs / 1000,
      };
      ready.set(id, loaded);
      return loaded;
    })
    .catch((error: unknown) => {
      loads.delete(url);
      sayOnce(url, error);
      return null;
    });
  loads.set(url, load);
  return load;
}

/** The manifest under `base` and every recording it names, each loaded once. */
function loadGroup(base: string): Promise<void> {
  const url = `${base}manifest.json`;
  return fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<Record<string, SampleEntry>>;
    })
    .then((list) =>
      Promise.all(
        Object.entries(list).map(([id, entry]) => loadSample(id, `${base}${entry.file}`, entry)),
      ),
    )
    .then(() => undefined);
}

/**
 * Idempotent. Loads both manifests and every recording they name. A manifest that cannot be
 * had is said once, and the next call tries again.
 */
export function preloadSamples(): Promise<void> {
  everything ??= Promise.all(
    [SFX_BASE, MUSIC_BASE].map((base) =>
      loadGroup(base).catch((error: unknown) => {
        everything = null;
        sayOnce(`${base}manifest.json`, error);
      }),
    ),
  ).then(() => undefined);
  return everything;
}

/** The recording `id`, decoded and at its loudness; null while it loads, or where it failed. */
export function sample(id: SampleId): Sample | null {
  return ready.get(id) ?? null;
}

/** The recording `id` once the loading started by `preloadSamples` has settled; null without it. */
export async function sampleLoaded(id: SampleId): Promise<Sample | null> {
  await preloadSamples();
  return sample(id);
}

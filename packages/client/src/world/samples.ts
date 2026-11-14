/**
 * samples.ts: the lab's recorded sounds — its effects, its rooms' beds, its music — as the game
 * plays them. ElevenLabs made them (scripts/sfx.ts, audio/catalog.json): public/sfx/ and
 * public/music/, each folder listed in its manifest.json. An effect or a loop is fetched and
 * decoded when it is first wanted, brought to its loudness as it is decoded — its samples times
 * the manifest's `gain`, while the file stays as it was made — and kept: a one-shot or a loop
 * folded to one channel once decoded, at the files' own 44.1 kHz, for it is placed or sounds
 * everywhere alike; a room's bed with its two channels at 32 kHz — the top of a room tone heard at
 * a bed's level lies below 16 kHz — and let go again once nobody stands near its room
 * (ambience.ts). What a run needs in its first minute loads first, in the lobby
 * (`preloadSamples`): the lever, the steps, the blackout, the radio's keys, the doors; the rest
 * of the effects follow two at a time once the lights have failed, or as soon as one of them is
 * asked for (`loadTheRest`). The music is never decoded: it streams from its files
 * (audioStream.ts), which the music's manifest names. What is not loaded is not played — a
 * recording that fails to load is said once on the console and stays silent; nothing synthetic
 * stands in for it. Every buffer kept is counted (audioMemory.ts). Decoded on an
 * OfflineAudioContext, so that no live context has to exist before a gesture lets it run.
 */

import { hold, letGo } from './audioMemory.js';

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
  'hatch-open-done',
  'door-slide',
  'door-close-1',
  'door-close-2',
  'step-concrete-1',
  'step-concrete-2',
  'step-concrete-3',
  'step-lino-1',
  'step-lino-2',
  'step-lino-3',
  'step-steel-1',
  'step-steel-2',
  'step-steel-3',
  'radio-key',
  'radio-tail',
  'radio-open',
  'sheet-down',
  'book-shut',
  'pencil',
  'klaxon',
  'alarm-sting',
  'console-ready',
  'ping',
  'danger-tick',
  'discovery',
  'locker-open',
  'cabinet-unlock',
  'countdown-beep',
  'countdown-go',
  'part-seat',
  'drone-alert',
  'drone-pass',
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
  'ui-tick',
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
  'bed-facility',
] as const;

/**
 * Every piece of music, in public/music/manifest.json: the score's eight — the run's three stems,
 * the menu's theme, the lobby's, the opening's title and the end cards' two themes, cut from one
 * suite (audio/catalog.json `score`) — and the end cards' two stings.
 */
export const MUSIC_IDS = [
  'calm',
  'tense',
  'critical',
  'won',
  'lost',
  'menu-theme',
  'end-won',
  'end-lost',
  'lobby',
  'title',
] as const;

export type SfxId = (typeof SFX_IDS)[number];
export type MusicId = (typeof MUSIC_IDS)[number];
export type SampleId = SfxId | MusicId;

/** Where each group's recordings and their manifest lie. */
export const SFX_BASE = '/sfx/';
export const MUSIC_BASE = '/music/';

/**
 * One recording as its manifest lists it (scripts/sfx.ts): its file, how long it lasts, ms, the
 * gain that brings it to its loudness, where its sound starts, ms, its noise floor and its RMS
 * before the gain, whether it plays round and round, the hash of what made it, a stem's tempo, a
 * piece of the score's loudness, the bars its loop goes round and the suite it was cut from, the
 * recording it borrows until its own is made, and who made it.
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
  /** a stem's tempo, beats a minute (audio/catalog.json) */
  readonly bpm?: number;
  /** a piece of the score's loudness before the gain, LUFS (scripts/pcm.ts `lufsOf`) */
  readonly loudness?: number;
  /** a looped piece of the score: the bars that go round, which the game loops on */
  readonly bars?: number;
  /** a piece of the score: the suite it was cut from, by its id */
  readonly suite?: string;
  /** the entry whose recording it plays until its own is rendered */
  readonly standIn?: string;
  readonly source: 'elevenlabs';
}

/** A group's manifest: its recordings by id. */
export type Manifest = Readonly<Record<string, SampleEntry>>;

/** A recording ready to play: its buffer at its loudness, and where its sound starts, s. */
export interface Sample {
  readonly buffer: AudioBuffer;
  readonly start: number;
}

/** The rate a one-shot or a loop is decoded at: the files' own. */
export const DECODE_RATE = 44100;
/** The rate a room's bed is decoded at, both its channels kept. */
export const BED_RATE = 32000;

/** Whether `id` is a room's bed: the only recording kept in two channels. */
export function isBed(id: string): boolean {
  return id.startsWith('bed-');
}

/**
 * The most a room's bed may be brought up to its loudness, as a gain: +12 dB. A bed that needs
 * more came back near silent — and its noise, a click and all, would come up with it — so it is
 * not played at all, as the sound script keeps no such take (scripts/sfx.ts MAX_BED_GAIN_DB).
 */
export const BED_GAIN_MAX = 10 ** (12 / 20);

/** Whether `id`, listed as `entry`, is a bed that would be brought up more than it may be. */
function overBrought(id: string, entry: SampleEntry): boolean {
  return isBed(id) && entry.gain > BED_GAIN_MAX;
}

/**
 * What a run needs in its first minute, loaded first: the cold open's power hum and its bang,
 * arcs, drain, click and buzz, the steps on every floor, the doors, the first finds, the radio's
 * keys for the Leitstelle's first line, the briefing's count, and the first station, a lever.
 */
export const FIRST_MINUTE: readonly SfxId[] = [
  'mains-hum',
  'breaker-thunk',
  'short-arc',
  'power-down',
  'relay-click',
  'emergency-buzz',
  'tube-strike',
  'step-concrete-1',
  'step-concrete-2',
  'step-concrete-3',
  'step-lino-1',
  'step-lino-2',
  'step-lino-3',
  'step-steel-1',
  'step-steel-2',
  'step-steel-3',
  'door-slide',
  'door-close-1',
  'door-close-2',
  'discovery',
  'radio-key',
  'radio-tail',
  'radio-open',
  'countdown-beep',
  'countdown-go',
  'lever-chunk',
  'lever-pull',
  'lever-spring',
];

/** The first minute's recordings, to look up. */
const firstMinute = new Set<string>(FIRST_MINUTE);

/** How many recordings are fetched and decoded at once. */
const AT_ONCE = 2;
/** A recording that failed to load is asked for again no sooner than this, ms. */
export const RETRY_MS = 5000;

/** The manifests as fetched, each kept once it came; null for one not had yet. */
const lists: { sfx: Manifest | null; music: Manifest | null } = { sfx: null, music: null };
/** The fetches of the manifests in flight. */
const listing = new Map<'sfx' | 'music', Promise<Manifest | null>>();
/** The loads by address and channels: each fetched and decoded once; one that failed is let go. */
const loads = new Map<string, Promise<Sample | null>>();
/** The recordings ready, by id, and the load each came from. */
const ready = new Map<string, Sample>();
const loadOf = new Map<string, string>();
/** The addresses whose failure has been said: each once. */
const said = new Set<string>();
/** When each load last failed, epoch ms: not tried again before RETRY_MS has passed. */
const failedAt = new Map<string, number>();
/** Whether the rest of the effects have been asked for. */
let restAsked = false;

/** Says once on the console that `url` could not be loaded, and why. */
function sayOnce(url: string, error: unknown): void {
  if (said.has(url)) return;
  said.add(url);
  const why = error instanceof Error ? error.message : String(error);
  console.warn(`sound: ${url} could not be loaded (${why}); it stays silent`);
}

/**
 * The manifest of `group`, fetched once; null where it cannot be had — asked again RETRY_MS on.
 */
function manifestOf(group: 'sfx' | 'music'): Promise<Manifest | null> {
  const kept = lists[group];
  if (kept !== null) return Promise.resolve(kept);
  const known = listing.get(group);
  if (known !== undefined) return known;
  const url = `${group === 'sfx' ? SFX_BASE : MUSIC_BASE}manifest.json`;
  if (Date.now() - (failedAt.get(url) ?? -Infinity) < RETRY_MS) return Promise.resolve(null);
  const asked = fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<Manifest>;
    })
    .then((list) => {
      lists[group] = list;
      return list;
    })
    .catch((error: unknown) => {
      failedAt.set(url, Date.now());
      sayOnce(url, error);
      return null;
    })
    .finally(() => listing.delete(group));
  listing.set(group, asked);
  return asked;
}

/** The music's entry `id`, once its manifest is here: where it streams from, at what gain. */
export function musicEntry(id: MusicId): SampleEntry | null {
  return lists.music?.[id] ?? null;
}

/** The music's manifest, fetched once it is asked for. */
export function musicListed(): Promise<void> {
  return manifestOf('music').then(() => undefined);
}

// --- decoding, two at a time ---------------------------------------------------------------

/** The loads waiting their turn: those asked for now first, the rest's after. */
const waiting: { now: (() => void)[]; later: (() => void)[] } = { now: [], later: [] };
let running = 0;

/** Runs `job` once fewer than AT_ONCE run; one wanted `now` before any of the rest's. */
function inTurn<T>(job: () => Promise<T>, now: boolean): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = (): void => {
      running += 1;
      job()
        .then(resolve, reject)
        .finally(() => {
          running -= 1;
          next();
        });
    };
    (now ? waiting.now : waiting.later).push(run);
    next();
  });
}

function next(): void {
  while (running < AT_ONCE) {
    const run = waiting.now.shift() ?? waiting.later.shift();
    if (run === undefined) return;
    run();
  }
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
 * `decoded` folded to one channel — the mean of its channels — at the loudness `gain` brings it
 * to; one already of one channel is brought there as it is.
 */
export function monoAt(ctx: BaseAudioContext, decoded: AudioBuffer, gain: number): AudioBuffer {
  if (decoded.numberOfChannels === 1) return atLoudness(decoded, gain);
  const mono = ctx.createBuffer(1, decoded.length, decoded.sampleRate);
  const out = mono.getChannelData(0);
  const share = gain / decoded.numberOfChannels;
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    const data = decoded.getChannelData(channel);
    for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) + (data[i] ?? 0) * share;
  }
  return mono;
}

/** The recording at `url`, as `entry` lists it, decoded: a bed in two channels, else in one. */
async function decode(url: string, entry: SampleEntry, bed: boolean): Promise<Sample> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ctx = new OfflineAudioContext(1, 1, bed ? BED_RATE : DECODE_RATE);
  const decoded = await ctx.decodeAudioData(await res.arrayBuffer());
  const buffer = bed ? atLoudness(decoded, entry.gain) : monoAt(ctx, decoded, entry.gain);
  return { buffer, start: entry.startMs / 1000 };
}

/**
 * The recording `id` loaded and kept: fetched and decoded once — an entry that borrows another's
 * recording shares that one's load — in its turn, `now` before the rest. Null where it is not in
 * the manifest (it awaits its render), is a bed brought up more than BED_GAIN_MAX — said once,
 * never fetched — or could not be loaded: that is said once, and an ask RETRY_MS later tries
 * again.
 */
export function loadSample(id: SfxId, now = true): Promise<Sample | null> {
  const kept = ready.get(id);
  if (kept !== undefined) return Promise.resolve(kept);
  return manifestOf('sfx').then((list) => {
    const entry = list?.[id];
    if (entry === undefined) return null;
    if (overBrought(id, entry)) {
      const db = (20 * Math.log10(entry.gain)).toFixed(1);
      sayOnce(`${SFX_BASE}${entry.file}`, new Error(`a bed brought up +${db} dB, over +12`));
      return null;
    }
    return loadFrom(id, entry, now);
  });
}

/** `id`'s recording from the file `entry` names, sharing a load of the same file. */
function loadFrom(id: SfxId, entry: SampleEntry, now: boolean): Promise<Sample | null> {
  const url = `${SFX_BASE}${entry.file}`;
  const bed = isBed(id);
  const key = `${url} ${bed ? 2 : 1}`;
  let load = loads.get(key);
  if (load === undefined) {
    if (Date.now() - (failedAt.get(key) ?? -Infinity) < RETRY_MS) return Promise.resolve(null);
    const decoding = inTurn(() => decode(url, entry, bed), now).catch((error: unknown) => {
      loads.delete(key);
      failedAt.set(key, Date.now());
      sayOnce(url, error);
      return null;
    });
    loads.set(key, decoding);
    load = decoding;
  }
  const mine = load;
  return mine.then((loaded) => {
    if (loaded === null || loads.get(key) !== mine) return loaded;
    ready.set(id, loaded);
    loadOf.set(id, key);
    hold(`sample:${id}`, bed ? 'beds' : 'effects', loaded.buffer);
    return loaded;
  });
}

/** The recording `id` dropped — once no other entry plays it, its load forgotten too. */
export function releaseSample(id: SfxId): void {
  const key = loadOf.get(id);
  ready.delete(id);
  loadOf.delete(id);
  letGo(`sample:${id}`);
  if (key !== undefined && ![...loadOf.values()].includes(key)) loads.delete(key);
}

/** Loads what a run needs in its first minute (FIRST_MINUTE), each once however often asked. */
export function preloadSamples(): Promise<void> {
  return Promise.all(FIRST_MINUTE.map((id) => loadSample(id))).then(() => undefined);
}

/**
 * Idempotent. The rest of the effects and loops — every one but the beds and the first minute's
 * — loaded in the background, after whatever is wanted now.
 */
export function loadTheRest(): void {
  if (restAsked) return;
  restAsked = true;
  for (const id of SFX_IDS) {
    if (!isBed(id) && !FIRST_MINUTE.includes(id)) void loadSample(id, false);
  }
}

/**
 * The recording `id`, decoded and at its loudness; null while it loads, or where it failed. An
 * effect asked for before the rest was asked for brings the rest in.
 */
export function sample(id: SfxId): Sample | null {
  const kept = ready.get(id) ?? null;
  if (kept === null && !isBed(id) && !firstMinute.has(id)) loadTheRest();
  return kept;
}

/** The recording `id` once its load has settled; null where it could not be had. */
export function sampleLoaded(id: SfxId): Promise<Sample | null> {
  return loadSample(id);
}

/** The effects kept now, by id: for the walkthrough's count. */
export function samplesKept(): SfxId[] {
  return [...ready.keys()] as SfxId[];
}

/**
 * The lab's sound effects and music as recordings, made by ElevenLabs (docs/sound.md):
 *
 *   pnpm --filter client sfx                    every effect and piece of music not made yet
 *   pnpm --filter client sfx -- sfx             the effects alone; `music`, the music alone
 *   pnpm --filter client sfx -- --dry-run       the plan and what it would cost; nothing is asked
 *   pnpm --filter client sfx -- --only a,b,c    those entries, made anew
 *   pnpm --filter client sfx -- --candidates 3  each effect made three times, the best one kept
 *
 * audio/catalog.json lists every sound the game plays: its id, its kind — a one-shot, a bed that
 * loops seamlessly, a stem of the music or a sting — what ElevenLabs is asked for (an English
 * prompt and a length), whether it loops, the loudness it is brought to and where the game plays
 * it. An effect comes from text-to-sound-effects (`eleven_text_to_sound_v2`, a bed as a seamless
 * loop) as MP3 at 44.1 kHz and 128 kbit/s, a piece of music from Eleven Music, instrumental, at
 * 192 kbit/s; each into public/sfx/<id>.mp3 or public/music/<id>.mp3. public/sfx/manifest.json
 * and public/music/manifest.json list each as { file, ms, gain, startMs, loop, hash, influence,
 * source }: `hash` names the request that made it — `influence` how closely an effect followed
 * its prompt — so an entry whose request is unchanged and whose file is there is not made again,
 * and a run cut short goes on where it stopped.
 *
 * With `--candidates N` every effect the run makes is made N times, its prompt followed more or
 * less closely each time (INFLUENCE_SPAN); each candidate goes into a folder of its own in the
 * system's temp, never into the project, and is measured, and the one `pickTake` picks — by its
 * level, where its sound starts, its silence and its length (PICK) — is the one kept. Music is
 * made once a piece.
 *
 * The files stay as ElevenLabs made them. afconvert decodes each into a temporary folder, its
 * peak and RMS are measured there, and `gain` is what brings it to its target — a one-shot's peak
 * to −3 dBFS, a bed's or a stem's RMS to −20 dBFS, a sting's to −14 dBFS — for the game to apply;
 * more than 30 ms of silence at the start becomes `startMs`, except in a bed, whose loop keeps its
 * start. A take that would need more gain than MAX_GAIN came back quiet: the run names it and
 * fails, nothing capped, so that its prompt is made louder and only it is made anew. A run that
 * makes nothing measures every file anew, so a target changed costs nothing.
 *
 * The key is ELEVENLABS_API_KEY in the environment — the package's `sfx` script hands node the
 * repo's .env.local (`--env-file`); this script opens no file for it. Before it asks for anything
 * it reads the account's credits and stops where fewer than MIN_CREDITS are left or the plan
 * would cost a group more than its cap; after a group's first entry it says what that cost and
 * prices the rest at that rate, stopping there if it would go over. Requests go one after the
 * other, ELEVEN_GAP_MS apart, a 429 waited out (elevenlabs.ts). A file no entry names is reported,
 * never deleted.
 *
 * Runs on Node's own TypeScript, as the voice script does: it imports nothing of the app.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ElevenLabs } from '@elevenlabs/elevenlabs-js';
import {
  ELEVEN_GAP_MS,
  elevenAudio,
  elevenClient,
  oneByOne,
  type SoundClient,
} from './elevenlabs.ts';

/** What a sound is: a one-shot, a bed that loops seamlessly, a stem of the music, a sting. */
export type Kind = 'oneshot' | 'bed' | 'stem' | 'sting';
/** Where a sound is made and kept: the effects (public/sfx/) or the music (public/music/). */
export type Group = 'sfx' | 'music';
export const GROUPS: readonly Group[] = ['sfx', 'music'];

/** The loudness a recording is brought to: its peak or its RMS, in dBFS. */
export interface Target {
  readonly measure: 'peak' | 'rms';
  readonly dbfs: number;
}

/** One sound of the catalog. */
export interface CatalogEntry {
  readonly id: string;
  readonly kind: Kind;
  readonly prompt: string;
  readonly durationSeconds: number;
  readonly loop: boolean;
  readonly target: Target;
  /** where the game plays it: "src/<file>#<symbol>" */
  readonly usedBy: readonly string[];
}

/**
 * One recording as the game finds it: its file, how long it lasts, ms, the gain that brings it
 * to its target, the silence its sound starts after, ms, whether it plays round and round, the
 * hash of the request that made it, how closely an effect followed its prompt, and who made it.
 */
export interface ManifestEntry {
  readonly file: string;
  readonly ms: number;
  readonly gain: number;
  readonly startMs: number;
  readonly loop: boolean;
  readonly hash: string;
  /** an effect's prompt influence; PROMPT_INFLUENCE where it is not given */
  readonly influence?: number;
  readonly source: 'elevenlabs';
}

export type Manifest = Record<string, ManifestEntry>;

const HERE = dirname(fileURLToPath(import.meta.url));
export const CATALOG_FILE = resolve(HERE, '../audio/catalog.json');
/** Where each group's recordings and their manifest go. */
export const DIRS: Readonly<Record<Group, string>> = {
  sfx: resolve(HERE, '../public/sfx'),
  music: resolve(HERE, '../public/music'),
};
export const MANIFEST = 'manifest.json';

/** An effect as MP3 at 44.1 kHz and 128 kbit/s: 16 kB a second. */
export const SFX_FORMAT = 'mp3_44100_128';
/** Music as MP3 at 44.1 kHz and 192 kbit/s, as the Creator plan gives it: 24 kB a second. */
export const MUSIC_FORMAT = 'mp3_44100_192';
/** The effects' model, the one that makes a seamless loop. */
export const SFX_MODEL = 'eleven_text_to_sound_v2';
/** The music's model: Eleven Music's newest. */
export const MUSIC_MODEL = 'music_v2_5';
/** How closely an effect made once follows its prompt, 0 to 1: closer than ElevenLabs' 0.3. */
export const PROMPT_INFLUENCE = 0.5;
/** How loosely, and how closely, the candidates of an effect follow their prompt. */
export const INFLUENCE_SPAN: readonly [number, number] = [0.3, 0.9];
/** The most candidates a run makes of an effect. */
export const MAX_CANDIDATES = 5;
/**
 * What a second costs, credits, as the first full render measured it (2026-10-26: 542 credits
 * for 154 s of effects, 4,136 for 236 s of music), rounded up. The first entry of every run
 * measures the rate anew.
 */
export const CREDITS_PER_SECOND: Readonly<Record<Group, number>> = { sfx: 4, music: 18 };
/** The most a run may spend on each group, credits. */
export const CAPS: Readonly<Record<Group, number>> = { sfx: 12_000, music: 18_000 };
/** With fewer credits left than this, nothing is asked. */
export const MIN_CREDITS = 40_000;
/** The most each group's folder may hold, bytes. */
export const FOLDER_CAPS: Readonly<Record<Group, number>> = {
  sfx: 3 * 1024 * 1024,
  music: 8 * 1024 * 1024,
};
/** Silence at a recording's start longer than this is skipped, ms. */
export const LEAD_MS = 30;
/** A sample, or a 10 ms frame, quieter than this counts as silence: −60 dBFS. */
export const SILENCE = 10 ** (-60 / 20);

/**
 * The most gain a recording may take: more, and what it brings up is the noise floor of a take
 * that came back quiet — to be made again with a louder prompt. A one-shot's peak may lie
 * 15.6 dB under its target, a loop's, a stem's or a sting's RMS 12 dB.
 */
export const MAX_GAIN: Readonly<Record<Kind, number>> = { oneshot: 6, bed: 4, stem: 4, sting: 4 };

/**
 * The rules a candidate is picked by: it needs at most 3 dB of gain — a one-shot's peak stands at
 * −6 dBFS or more before it, an RMS-measured kind's RMS within 3 dB of its target — its sound
 * starts within 50 ms, at most a tenth of it is silence, and it runs within a fifth of the length
 * asked for.
 */
export const PICK = { gain: 10 ** (3 / 20), leadMs: 50, silence: 0.1, length: 0.2 } as const;

/** The loudness each kind is brought to. */
export const TARGETS: Readonly<Record<Kind, Target>> = {
  oneshot: { measure: 'peak', dbfs: -3 },
  bed: { measure: 'rms', dbfs: -20 },
  stem: { measure: 'rms', dbfs: -20 },
  sting: { measure: 'rms', dbfs: -14 },
};
/** How long each kind may last, s: ElevenLabs' bounds for an effect; the music's own. */
export const LENGTHS: Readonly<Record<Kind, readonly [number, number]>> = {
  oneshot: [0.5, 30],
  bed: [0.5, 30],
  stem: [60, 90],
  sting: [8, 12],
};

// --- the catalog ----------------------------------------------------------------------------

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const USED_BY = /^src\/[\w/.-]+\.tsx?#\w+$/;
const kindOf = (entry: CatalogEntry): Kind | undefined =>
  Object.keys(TARGETS).find((kind): kind is Kind => kind === entry.kind);

/** Each rule a catalog entry keeps, and what is said where it does not. */
type Rule = readonly [(entry: CatalogEntry) => boolean, (entry: CatalogEntry) => string];

const RULES: readonly Rule[] = [
  [(e) => ID.test(e.id), () => 'its id is not lower-case words joined by dashes'],
  [(e) => kindOf(e) !== undefined, (e) => `its kind "${e.kind}" is not ${Object.keys(TARGETS)}`],
  [(e) => /^[\x20-\x7e]{40,}$/.test(e.prompt), () => 'its prompt is not 40 chars of English'],
  [
    (e) => {
      const [min, max] = LENGTHS[e.kind] ?? [NaN, NaN];
      return e.durationSeconds >= min && e.durationSeconds <= max;
    },
    (e) => `it lasts ${e.durationSeconds} s, outside ${LENGTHS[e.kind]?.join('–') ?? '?'} s`,
  ],
  [
    (e) => e.loop === (e.kind === 'bed' || e.kind === 'stem'),
    () => 'loop has to be true for a bed or a stem, and false for the rest',
  ],
  [
    (e) =>
      e.target?.measure === TARGETS[e.kind]?.measure && e.target.dbfs === TARGETS[e.kind]?.dbfs,
    (e) => `its target has to be ${JSON.stringify(TARGETS[e.kind])}`,
  ],
  [
    (e) =>
      Array.isArray(e.usedBy) && e.usedBy.length > 0 && e.usedBy.every((u) => USED_BY.test(u)),
    () => 'usedBy has to name where it plays, as "src/<file>#<symbol>"',
  ],
];

/** What is wrong with `entry`, a sentence each; none for an entry that keeps every rule. */
export function flawsOf(entry: CatalogEntry): string[] {
  return RULES.filter(([keeps]) => !keeps(entry)).map(([, said]) => said(entry));
}

/** The catalog, as it stands in `file`. */
export function readCatalog(file = CATALOG_FILE): CatalogEntry[] {
  return JSON.parse(readFileSync(file, 'utf8')) as CatalogEntry[];
}

/** Returns `catalog` where every entry keeps the rules and no id comes twice; fails naming each. */
export function checkCatalog(catalog: readonly CatalogEntry[]): readonly CatalogEntry[] {
  const seen = new Set<string>();
  const flaws = catalog.flatMap((entry) => {
    const twice = seen.has(entry.id) ? ['its id comes twice'] : [];
    seen.add(entry.id);
    return [...flawsOf(entry), ...twice].map((flaw) => `${entry.id}: ${flaw}`);
  });
  if (flaws.length > 0) {
    throw new Error(`sfx: audio/catalog.json —\n  ${flaws.join('\n  ')}`);
  }
  return catalog;
}

/** Where an entry is made and kept: a stem or a sting with the music, the rest with the effects. */
export function groupOf(entry: Pick<CatalogEntry, 'kind'>): Group {
  return entry.kind === 'stem' || entry.kind === 'sting' ? 'music' : 'sfx';
}

/** The file an entry is kept in, in its group's folder. */
export function fileOf(id: string): string {
  return `${id}.mp3`;
}

// --- the requests ---------------------------------------------------------------------------

/** What text-to-sound-effects is asked for an effect, its prompt followed as `influence` says. */
export function effectRequest(
  entry: CatalogEntry,
  influence = PROMPT_INFLUENCE,
): ElevenLabs.CreateSoundEffectRequest {
  return {
    text: entry.prompt,
    durationSeconds: entry.durationSeconds,
    loop: entry.loop,
    promptInfluence: influence,
    modelId: SFX_MODEL,
    outputFormat: SFX_FORMAT,
  };
}

/** What Eleven Music is asked for a piece: instrumental, as long as the catalog says. */
export function musicRequest(entry: CatalogEntry): ElevenLabs.BodyComposeMusicV1MusicPost {
  return {
    prompt: entry.prompt,
    musicLengthMs: Math.round(entry.durationSeconds * 1000),
    forceInstrumental: true,
    modelId: MUSIC_MODEL,
    outputFormat: MUSIC_FORMAT,
  };
}

/**
 * The hash of what makes an entry — its whole request, an effect's at `influence`: the first 12
 * hex digits of its SHA-1.
 */
export function hashOf(entry: CatalogEntry, influence = PROMPT_INFLUENCE): string {
  const music = groupOf(entry) === 'music';
  const request = music ? musicRequest(entry) : effectRequest(entry, influence);
  return createHash('sha1').update(JSON.stringify(request), 'utf8').digest('hex').slice(0, 12);
}

/** Whether `kept` was made from `entry`'s request as it stands, at the influence it names. */
export function upToDate(entry: CatalogEntry, kept: ManifestEntry): boolean {
  return kept.hash === hashOf(entry, kept.influence ?? PROMPT_INFLUENCE);
}

/** The influences of an effect's `count` candidates: PROMPT_INFLUENCE alone, or spread out. */
export function influencesFor(count: number): number[] {
  if (count <= 1) return [PROMPT_INFLUENCE];
  const [low, high] = INFLUENCE_SPAN;
  return Array.from({ length: count }, (_, i) =>
    Number((low + ((high - low) * i) / (count - 1)).toFixed(2)),
  );
}

/** What making an entry costs, credits: an effect `candidates` times over, music once. */
export function costOf(entry: CatalogEntry, candidates = 1): number {
  const group = groupOf(entry);
  const takes = group === 'sfx' ? candidates : 1;
  return Math.ceil(entry.durationSeconds * CREDITS_PER_SECOND[group] * takes);
}

/**
 * Asks ElevenLabs for the recording of `entry` — an effect, its prompt followed as `influence`
 * says, or a piece of music — as MP3.
 */
export function make(
  client: SoundClient,
  entry: CatalogEntry,
  how: { readonly influence?: number; readonly wait?: (ms: number) => Promise<void> } = {},
): Promise<Buffer> {
  const asking = { tag: 'sfx', what: `make ${entry.id}` };
  const request =
    groupOf(entry) === 'music'
      ? () => client.music.compose(musicRequest(entry))
      : () => client.textToSoundEffects.convert(effectRequest(entry, how.influence));
  return elevenAudio(request, asking, how.wait);
}

/** The account's credits left: its limit this cycle less what it has used. */
export async function creditsLeft(client: SoundClient): Promise<number> {
  const { characterCount, characterLimit } = await client.user.subscription.get();
  return characterLimit - characterCount;
}

/** Fails where `left` credits are fewer than MIN_CREDITS: then nothing is asked. */
export function refuseBelow(left: number): void {
  if (left < MIN_CREDITS) {
    throw new Error(
      `sfx: ${left} credits left, fewer than the ${MIN_CREDITS} a run needs — nothing asked`,
    );
  }
}

/**
 * What a group comes to at the rate its first entry cost: `spent` credits on `seconds` of
 * requests, the same a second for the `rest` seconds. Over the group's cap, `over` names it.
 */
export function priced(
  spent: number,
  seconds: number,
  rest: number,
  group: Group,
): { perSecond: number; total: number; over: boolean } {
  const perSecond = spent / seconds;
  const total = Math.round(spent + rest * perSecond);
  return { perSecond, total, over: total > CAPS[group] };
}

// --- what a run makes -------------------------------------------------------------------------

/** What the command line asks for: the groups, a plan alone, a list of entries, candidates. */
export interface Options {
  readonly groups: readonly Group[];
  readonly dryRun: boolean;
  readonly only: readonly string[] | null;
  readonly candidates: number;
}

/** The value given after the flag at `i` of `args`; fails saying what the flag takes. */
function valueAfter(args: readonly string[], i: number, takes: string): string {
  const value = args[i + 1];
  if (value === undefined || value.startsWith('-')) {
    throw new Error(`sfx: ${args[i]} — it takes ${takes}`);
  }
  return value;
}

/** The candidates `value` asks for: a whole number from 1 to MAX_CANDIDATES. */
function candidatesOf(value: string): number {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > MAX_CANDIDATES) {
    throw new Error(`sfx: --candidates ${value} — it takes a number from 1 to ${MAX_CANDIDATES}`);
  }
  return count;
}

/**
 * Reads `sfx`, `music`, `--dry-run`, `--only a,b,c` and `--candidates N`: both groups where
 * neither is named, one candidate where none is asked for.
 */
export function optionsOf(args: readonly string[]): Options {
  const groups: Group[] = [];
  const options = { dryRun: false, only: null as string[] | null, candidates: 1 };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg === 'sfx' || arg === 'music') {
      groups.push(arg);
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--only') {
      const list = valueAfter(args, i, 'a list of ids: --only a,b,c');
      options.only = list.split(',').map((id) => id.trim()).filter((id) => id !== '');
      i += 1;
    } else if (arg === '--candidates') {
      options.candidates = candidatesOf(valueAfter(args, i, 'a number: --candidates 3'));
      i += 1;
    } else if (arg !== '--') {
      throw new Error(
        `sfx: ${arg} — it takes sfx, music, --dry-run, --only a,b,c and --candidates N`,
      );
    }
  }
  return { groups: groups.length > 0 ? groups : GROUPS, ...options };
}

/** An entry as a run sees it: its group, and whether it has to be made. */
export interface Job {
  readonly entry: CatalogEntry;
  readonly group: Group;
  /** new, changed, its file gone, or asked for by --only */
  readonly make: boolean;
}

/**
 * The entries a run takes — those of the groups asked for, or those --only names — each with
 * what its group's manifest kept and whether its file is there (`filed`).
 */
export function planOf(
  catalog: readonly CatalogEntry[],
  manifests: Readonly<Record<Group, Manifest>>,
  filed: (group: Group, file: string) => boolean,
  options: Options,
): Job[] {
  const { only } = options;
  const unknown = (only ?? []).filter((id) => !catalog.some((entry) => entry.id === id));
  if (unknown.length > 0) {
    throw new Error(`sfx: --only ${unknown.join(',')} — audio/catalog.json has no such entry`);
  }
  const chosen =
    only === null
      ? catalog.filter((entry) => options.groups.includes(groupOf(entry)))
      : catalog.filter((entry) => only.includes(entry.id));
  return chosen.map((entry) => {
    const group = groupOf(entry);
    const kept = manifests[group][entry.id];
    const fresh = kept !== undefined && upToDate(entry, kept) && filed(group, kept.file);
    return { entry, group, make: only !== null || !fresh };
  });
}

// --- loudness ---------------------------------------------------------------------------------

/** Decoded audio: its rate and each channel's samples, −1 to 1. */
export interface Pcm {
  readonly rate: number;
  readonly channels: readonly Float32Array[];
}

interface WavFormat {
  readonly code: number;
  readonly channels: number;
  readonly rate: number;
  readonly bits: number;
}

/** The samples of a WAV's data chunk, `size` bytes from `from`: 16-bit or 32-bit float. */
function samplesOf(view: DataView, from: number, size: number, format: WavFormat): Pcm {
  const step = format.bits / 8;
  const frames = Math.floor(size / (step * format.channels));
  const float = format.code === 3 && format.bits === 32;
  if (!float && !(format.code === 1 && format.bits === 16)) {
    throw new Error(`sfx: a WAV of format ${format.code} at ${format.bits} bits, not 16-bit PCM`);
  }
  const read = (at: number): number =>
    float ? view.getFloat32(at, true) : view.getInt16(at, true) / 32768;
  const channels = Array.from({ length: format.channels }, (_, c) => {
    const data = new Float32Array(frames);
    for (let i = 0; i < frames; i++) data[i] = read(from + (i * format.channels + c) * step);
    return data;
  });
  return { rate: format.rate, channels };
}

/** The PCM of a WAV file, as afconvert writes it; its chunks before the data skipped. */
export function parseWav(bytes: Uint8Array): Pcm {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number): string => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') {
    throw new Error('sfx: not a WAV file');
  }
  let format: WavFormat | null = null;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (tag(at) === 'fmt ') {
      const code = view.getUint16(body, true);
      format = {
        // WAVE_FORMAT_EXTENSIBLE names its own in the first two bytes of its subformat
        code: code === 0xfffe ? view.getUint16(body + 24, true) : code,
        channels: view.getUint16(body + 2, true),
        rate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (tag(at) === 'data' && format !== null) {
      return samplesOf(view, body, Math.min(size, bytes.length - body), format);
    }
    at = body + size + (size % 2);
  }
  throw new Error('sfx: a WAV file without its format or its data');
}

/** How a recording measures: how long (ms), its peak and RMS, the silence before its sound (ms). */
export interface Loudness {
  readonly ms: number;
  readonly peak: number;
  readonly rms: number;
  readonly leadMs: number;
}

/** Measures `pcm`: its peak and its RMS over every channel, from where its sound starts. */
export function loudnessOf(pcm: Pcm): Loudness {
  const frames = pcm.channels[0]?.length ?? 0;
  const lead = Math.min(
    frames,
    ...pcm.channels.map((data) => {
      const first = data.findIndex((x) => Math.abs(x) > SILENCE);
      return first < 0 ? frames : first;
    }),
  );
  let peak = 0;
  let sum = 0;
  for (const data of pcm.channels) {
    for (let i = lead; i < frames; i++) {
      const x = data[i] ?? 0;
      peak = Math.max(peak, Math.abs(x));
      sum += x * x;
    }
  }
  const count = (frames - lead) * pcm.channels.length;
  return {
    ms: Math.round((frames / pcm.rate) * 1000),
    peak,
    rms: count > 0 ? Math.sqrt(sum / count) : 0,
    leadMs: (lead / pcm.rate) * 1000,
  };
}

/** The share of `pcm`'s 10 ms frames whose RMS, over every channel, lies under SILENCE. */
export function silenceOf(pcm: Pcm): number {
  const samples = pcm.channels[0]?.length ?? 0;
  const frame = Math.max(1, Math.round(pcm.rate / 100));
  let frames = 0;
  let silent = 0;
  for (let from = 0; from < samples; from += frame) {
    const to = Math.min(samples, from + frame);
    let sum = 0;
    for (const data of pcm.channels) {
      for (let i = from; i < to; i++) sum += (data[i] ?? 0) ** 2;
    }
    frames += 1;
    if (Math.sqrt(sum / ((to - from) * pcm.channels.length)) < SILENCE) silent += 1;
  }
  return frames > 0 ? silent / frames : 1;
}

/** The linear gain that brings a recording measured as `loudness` to `target`; fails on silence. */
export function gainOf(target: Target, loudness: Loudness, id: string): number {
  const level = target.measure === 'peak' ? loudness.peak : loudness.rms;
  if (!(level > 0)) {
    throw new Error(`sfx: ${id} came back silent — make it again: --only ${id}`);
  }
  return Number((10 ** (target.dbfs / 20) / level).toFixed(4));
}

/** A recording that came back too quiet for its kind: its id, its gain, the most it may take. */
export interface Quiet {
  readonly id: string;
  readonly gain: number;
  readonly max: number;
}

/** The recordings of `catalog` whose gain in `manifests` is over MAX_GAIN for their kind. */
export function tooQuiet(
  catalog: readonly CatalogEntry[],
  manifests: Readonly<Record<Group, Manifest>>,
): Quiet[] {
  return catalog.flatMap((entry) => {
    const kept = manifests[groupOf(entry)][entry.id];
    const max = MAX_GAIN[entry.kind];
    return kept !== undefined && kept.gain > max ? [{ id: entry.id, gain: kept.gain, max }] : [];
  });
}

/** Where a recording's sound starts, ms: past more than LEAD_MS of silence; a bed's at 0. */
export function startMsOf(kind: Kind, loudness: Loudness): number {
  return kind !== 'bed' && loudness.leadMs > LEAD_MS ? Math.floor(loudness.leadMs) : 0;
}

// --- picking a take ---------------------------------------------------------------------------

/**
 * A take of an entry as it measures: where it lies, how closely it followed its prompt, its
 * loudness, the share of it that is silence, its gain, and how far its length is off, a share.
 */
export interface Take {
  readonly path: string;
  readonly influence: number;
  readonly loudness: Loudness;
  readonly silence: number;
  readonly gain: number;
  readonly lengthOff: number;
}

/** The rules of PICK `take` misses: its level, where its sound starts, its silence, its length. */
export function missesOf(take: Take): string[] {
  const misses = [
    take.gain > PICK.gain && 'level',
    take.loudness.leadMs > PICK.leadMs && 'start',
    take.silence > PICK.silence && 'silence',
    take.lengthOff > PICK.length && 'length',
  ];
  return misses.filter((miss): miss is string => typeof miss === 'string');
}

/**
 * The take to keep of `takes`: the one that misses the fewest rules, then the one that needs
 * the least gain, then the one with the least silence. A short click misses the silence rule
 * whatever it does — its tail falls silent long before half a second is over — so for it the
 * level decides.
 */
export function pickTake(takes: readonly Take[]): Take {
  const ranked = [...takes].sort(
    (a, b) =>
      missesOf(a).length - missesOf(b).length || a.gain - b.gain || a.silence - b.silence,
  );
  const best = ranked[0];
  if (best === undefined) {
    throw new Error('sfx: no take to pick from');
  }
  return best;
}

/** The recording at `path`, decoded by afconvert into `scratch` and read back as PCM. */
function decode(path: string, scratch: string): Pcm {
  const wav = join(scratch, 'decoded.wav');
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16', path, wav]);
  try {
    return parseWav(readFileSync(wav));
  } finally {
    rmSync(wav, { force: true });
  }
}

/** The take of `entry` at `path`, made at `influence`, measured. */
function takeAt(entry: CatalogEntry, path: string, influence: number, scratch: string): Take {
  const pcm = decode(path, scratch);
  const loudness = loudnessOf(pcm);
  const asked = entry.durationSeconds * 1000;
  return {
    path,
    influence,
    loudness,
    silence: silenceOf(pcm),
    gain: gainOf(entry.target, loudness, entry.id),
    lengthOff: Math.abs(loudness.ms - asked) / asked,
  };
}

/** The manifest's entry for `entry` as `take` measured it. */
function entryOf(entry: CatalogEntry, take: Take): ManifestEntry {
  return {
    file: fileOf(entry.id),
    ms: take.loudness.ms,
    gain: take.gain,
    startMs: startMsOf(entry.kind, take.loudness),
    loop: entry.loop,
    hash: hashOf(entry, take.influence),
    ...(groupOf(entry) === 'sfx' ? { influence: take.influence } : {}),
    source: 'elevenlabs',
  };
}

/** Says how each candidate of `entry` measured, and which one is kept. */
function sayTakes(entry: CatalogEntry, takes: readonly Take[], kept: Take): void {
  for (const take of takes) {
    const peak = (20 * Math.log10(take.loudness.peak)).toFixed(1);
    const misses = missesOf(take);
    console.log(
      `  ${entry.id} @${take.influence}: peak ${peak} dBFS, gain ${take.gain}, starts ` +
        `${take.loudness.leadMs.toFixed(0)} ms, silence ${(take.silence * 100).toFixed(0)} %, ` +
        `${take.loudness.ms} ms${misses.length > 0 ? ` — misses ${misses.join(', ')}` : ''}` +
        `${take === kept ? '  ← kept' : ''}`,
    );
  }
}

// --- the run ----------------------------------------------------------------------------------

function readManifest(group: Group): Manifest {
  const file = join(DIRS[group], MANIFEST);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Manifest) : {};
}

/** Writes a group's manifest, its entries in the order of their ids. */
function writeManifest(group: Group, manifest: Manifest): void {
  mkdirSync(DIRS[group], { recursive: true });
  const sorted = Object.entries(manifest).sort(([a], [b]) => (a < b ? -1 : 1));
  const text = `${JSON.stringify(Object.fromEntries(sorted), null, 2)}\n`;
  writeFileSync(join(DIRS[group], MANIFEST), text);
}

const filedIn = (group: Group, file: string): boolean => existsSync(join(DIRS[group], file));

/** Says what the run will make, group by group, and what that costs at the rates measured. */
function printPlan(jobs: readonly Job[], candidates: number): void {
  for (const group of GROUPS) {
    const mine = jobs.filter((job) => job.group === group);
    const todo = mine.filter((job) => job.make).map((job) => job.entry);
    if (mine.length === 0) continue;
    const seconds = todo.reduce((sum, entry) => sum + entry.durationSeconds, 0);
    const credits = todo.reduce((sum, entry) => sum + costOf(entry, candidates), 0);
    const takes = group === 'sfx' && candidates > 1 ? `, ${candidates} candidates each` : '';
    console.log(
      `sfx: ${group} — ${todo.length} of ${mine.length} to make${takes}, ` +
        `${seconds.toFixed(1)} s, about ${credits} credits (cap ${CAPS[group]})`,
    );
    for (const entry of todo) {
      console.log(`  ${entry.id}  ${entry.durationSeconds} s  ${entry.kind}`);
    }
  }
}

/** Fails, saying how to run it, where the environment holds no key. The script reads no file. */
function requireKey(): void {
  if (!process.env['ELEVENLABS_API_KEY']?.trim()) {
    throw new Error(
      'sfx: no ElevenLabs key — run it as `pnpm --filter client sfx`, which hands node the ' +
        "repo's .env.local, or with ELEVENLABS_API_KEY set in the environment",
    );
  }
}

function requireTools(): void {
  try {
    execFileSync('/usr/bin/which', ['afconvert'], { stdio: 'ignore' });
  } catch {
    throw new Error('sfx: afconvert is missing — it comes with macOS; measure the files on a Mac');
  }
}

/** Where a run works: the folder it decodes in, and the one its candidates go to. */
interface Folders {
  readonly scratch: string;
  readonly candidates: string;
}

/**
 * Makes `job`: an effect as `count` candidates, each at its influence, into the candidates'
 * folder — measured, the one `pickTake` picks copied into the project — or once, as music always
 * is. Returns the manifest's entry for what it kept.
 */
async function renderJob(
  client: SoundClient,
  job: Job,
  count: number,
  folders: Folders,
): Promise<ManifestEntry> {
  const { entry, group } = job;
  const target = join(DIRS[group], fileOf(entry.id));
  const influences = group === 'music' ? [PROMPT_INFLUENCE] : influencesFor(count);
  const [only] = influences;
  if (influences.length === 1 && only !== undefined) {
    writeFileSync(target, await make(client, entry, { influence: only }));
    return entryOf(entry, takeAt(entry, target, only, folders.scratch));
  }
  const makeTake = (influence: number) => async (): Promise<Take> => {
    const path = join(folders.candidates, `${entry.id}@${influence}.mp3`);
    writeFileSync(path, await make(client, entry, { influence }));
    return takeAt(entry, path, influence, folders.scratch);
  };
  const takes = await oneByOne(influences.map(makeTake), ELEVEN_GAP_MS);
  const kept = pickTake(takes);
  sayTakes(entry, takes, kept);
  copyFileSync(kept.path, target);
  return entryOf(entry, { ...kept, path: target });
}

/**
 * Makes a group's `jobs` one after the other, each written with its entry as it comes; after
 * the first, its cost is read off the account and the rest priced at that rate — over the
 * group's cap, the run stops there. Returns what the group spent.
 */
async function renderGroup(
  client: SoundClient,
  jobs: readonly Job[],
  manifest: Manifest,
  how: { readonly count: number; readonly folders: Folders },
): Promise<number> {
  const before = await creditsLeft(client);
  const secondsOf = (job: Job): number =>
    job.entry.durationSeconds * (job.group === 'sfx' ? how.count : 1);
  const tasks = jobs.map((job, i) => async () => {
    mkdirSync(DIRS[job.group], { recursive: true });
    const entry = await renderJob(client, job, how.count, how.folders);
    manifest[job.entry.id] = entry;
    writeManifest(job.group, manifest);
    console.log(`sfx: ${job.entry.id} ${(entry.ms / 1000).toFixed(1)} s, gain ${entry.gain}`);
    if (i === 0) {
      const spent = before - (await creditsLeft(client));
      const rest = jobs.slice(1).reduce((sum, other) => sum + secondsOf(other), 0);
      const price = priced(spent, secondsOf(job), rest, job.group);
      const expected = costOf(job.entry, how.count);
      console.log(
        `sfx: ${job.entry.id} cost ${spent} credits (${price.perSecond.toFixed(1)} a second, ` +
          `${expected} expected); the ${job.group} come to about ${price.total}`,
      );
      if (price.over) {
        throw new Error(`sfx: that is over the ${CAPS[job.group]} the ${job.group} may spend`);
      }
    }
  });
  await oneByOne(tasks, ELEVEN_GAP_MS);
  return before - (await creditsLeft(client));
}

/** Makes every job of `todo`, group by group, within the credits and the caps. */
async function renderAll(
  todo: readonly Job[],
  manifests: Record<Group, Manifest>,
  how: { readonly count: number; readonly folders: Folders },
): Promise<void> {
  requireKey();
  const client = await elevenClient();
  const left = await creditsLeft(client);
  console.log(`sfx: ${left} credits left`);
  refuseBelow(left);
  for (const group of GROUPS) {
    const jobs = todo.filter((job) => job.group === group);
    const cost = jobs.reduce((sum, job) => sum + costOf(job.entry, how.count), 0);
    if (cost > CAPS[group]) {
      throw new Error(`sfx: the ${group} would cost about ${cost} credits, over ${CAPS[group]}`);
    }
  }
  for (const group of GROUPS) {
    const jobs = todo.filter((job) => job.group === group);
    if (jobs.length === 0) continue;
    const spent = await renderGroup(client, jobs, manifests[group], how);
    console.log(`sfx: the ${group} spent ${spent} credits`);
  }
  console.log(`sfx: ${await creditsLeft(client)} credits left`);
}

/**
 * Says which recordings came back too quiet (`tooQuiet`), each with its gain, and what to do;
 * any such fails the run. Nothing is capped or hidden.
 */
function warnQuiet(
  catalog: readonly CatalogEntry[],
  manifests: Readonly<Record<Group, Manifest>>,
): void {
  const quiet = tooQuiet(catalog, manifests);
  if (quiet.length === 0) return;
  const said = `${quiet.length} recordings came back quiet — their gain plays their noise floor`;
  console.error(`sfx: ${said}:`);
  for (const { id, gain, max } of quiet) console.error(`  ${id}  gain ${gain}, over ${max}`);
  console.error(
    'sfx: sharpen their prompts — close, loud, dry, full level — and make them again: ' +
      '--candidates 3 --only a,b,c',
  );
  process.exitCode = 1;
}

/** Says what each folder holds against its cap, and any file no entry names; over a cap fails. */
function report(manifests: Readonly<Record<Group, Manifest>>): void {
  for (const group of GROUPS) {
    if (!existsSync(DIRS[group])) continue;
    const named = new Set(Object.values(manifests[group]).map((entry) => entry.file));
    const files = readdirSync(DIRS[group]).filter((name) => name.endsWith('.mp3'));
    const bytes = files.reduce((sum, name) => sum + statSync(join(DIRS[group], name)).size, 0);
    const kb = (bytes / 1024).toFixed(0);
    console.log(`sfx: public/${group} holds ${files.length} files, ${kb} kB`);
    for (const name of files.filter((file) => !named.has(file))) {
      console.error(`sfx: public/${group}/${name} is named by no entry — delete it by hand`);
    }
    if (bytes > FOLDER_CAPS[group]) {
      console.error(`sfx: public/${group} is over its ${FOLDER_CAPS[group]} bytes`);
      process.exitCode = 1;
    }
  }
}

/** Measures every file the run took anew, its entry kept at the influence it was made at. */
function remeasure(
  jobs: readonly Job[],
  manifests: Record<Group, Manifest>,
  scratch: string,
): void {
  for (const job of jobs.filter((each) => filedIn(each.group, fileOf(each.entry.id)))) {
    const kept = manifests[job.group][job.entry.id];
    const influence = kept?.influence ?? PROMPT_INFLUENCE;
    const path = join(DIRS[job.group], fileOf(job.entry.id));
    const take = takeAt(job.entry, path, influence, scratch);
    manifests[job.group][job.entry.id] = entryOf(job.entry, take);
  }
  for (const group of GROUPS) {
    if (jobs.some((job) => job.group === group)) writeManifest(group, manifests[group]);
  }
}

async function main(options: Options): Promise<void> {
  const catalog = checkCatalog(readCatalog());
  const manifests = { sfx: readManifest('sfx'), music: readManifest('music') };
  const jobs = planOf(catalog, manifests, filedIn, options);
  printPlan(jobs, options.candidates);
  if (options.dryRun) {
    warnQuiet(catalog, manifests);
    return;
  }
  requireTools();
  const scratch = mkdtempSync(join(tmpdir(), 'escapelab-sfx-'));
  const todo = jobs.filter((job) => job.make);
  const many = options.candidates > 1 && todo.some((job) => job.group === 'sfx');
  const candidates = many ? mkdtempSync(join(tmpdir(), 'escapelab-sfx-candidates-')) : scratch;
  try {
    if (todo.length > 0) {
      const folders = { scratch, candidates };
      await renderAll(todo, manifests, { count: options.candidates, folders });
    }
    remeasure(jobs, manifests, scratch);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (many) console.log(`sfx: every candidate lies in ${candidates}`);
  report(manifests);
  warnQuiet(catalog, manifests);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve()
    .then(() => main(optionsOf(process.argv.slice(2))))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}

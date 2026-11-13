/**
 * The lab's sound effects and music as recordings, made by ElevenLabs (docs/sound.md):
 *
 *   pnpm --filter client sfx                    every effect and piece of music not made yet
 *   pnpm --filter client sfx -- sfx             the effects alone; `music`, the music alone
 *   pnpm --filter client sfx -- --dry-run       the plan and what it would cost; nothing is asked
 *   pnpm --filter client sfx -- --only a,b,c    those entries, made anew
 *   pnpm --filter client sfx -- --candidates 3  each made three times: an effect's best take
 *                                               kept, a piece of music's takes left to the ear
 *   pnpm --filter client sfx -- --keep calm=2   take 2 of the music's calm stem kept, the rest
 *                                               of its takes deleted
 *
 * audio/catalog.json lists every sound the game plays: its id, its kind — a one-shot, a bed that
 * loops seamlessly, a stem of the music, a sting or a theme played once — what ElevenLabs is
 * asked for (an English prompt and a length), whether it loops, the loudness it is brought to and
 * where the game plays it. An effect comes from text-to-sound-effects (`eleven_text_to_sound_v2`,
 * a bed as a seamless loop) as MP3 at 44.1 kHz and 128 kbit/s, a piece of music from Eleven
 * Music, instrumental, at 192 kbit/s — a theme at 128, for the music's folder to hold it; each
 * into public/sfx/<id>.mp3 or public/music/<id>.mp3. public/sfx/manifest.json
 * and public/music/manifest.json list each as { file, ms, gain, startMs, floor, rms, loop, hash,
 * influence, bpm, source }: `hash` names the request that made it — `influence` how closely an
 * effect followed its prompt, `bpm` a stem's tempo as its prompt states it — so an entry whose
 * request is unchanged and whose file is there is not made again, and a run cut short goes on
 * where it stopped. An entry not made yet may play another's recording meanwhile (`standIn`): it
 * counts as made from another request, and the next run makes it.
 *
 * With `--candidates N` every entry the run makes is made N times. An effect follows its prompt
 * more or less closely each time (INFLUENCE_SPAN), each take into a folder of its own in the
 * system's temp, never into the project, and measured, each take's measurements said; the one
 * `pickTake` picks — by its peak, where its sound starts, its silence, its length and its floor
 * (PICK), then its RMS — is the one kept. A piece of music is made by the same request again,
 * MAX_MUSIC_TAKES times at most, its cost running by the second, and no rule picks among its
 * takes: no measurement says whether a piece sounds right. Every take goes into
 * takes/<id>/<n>.mp3, which git ignores, numbered on from the takes already there and listed in
 * takes/<id>/index.json with the request it was made from, when, and how it measures
 * (`TakesList`); nothing of it goes into public/music, and the run says where the takes lie.
 * `--keep <id>=<n>` keeps take n — measured as a run measures what it makes, moved into
 * public/music as the entry's file, its manifest entry written — and deletes the entry's other
 * takes; it asks ElevenLabs for nothing and needs no key.
 *
 * The files stay as ElevenLabs made them. afconvert decodes each into a temporary folder, its
 * peak and RMS are measured there, and `gain` is what brings it to its target — a one-shot's peak
 * to −3 dBFS, a bed's, a stem's or a theme's RMS to −20 dBFS, a sting's to −14 dBFS — for the game
 * to apply;
 * more than 30 ms of silence at the start becomes `startMs`, except in a bed, whose loop keeps its
 * start. `floor` is the RMS of its quietest 100 ms: where that is a gap in the sound and comes out
 * louder than −50 dBFS once the gain is applied, the take plays its noise floor where it is heard
 * (`floorHeard`) — the run names it with its gain and fails, nothing capped, so that it is made
 * anew. A run that makes nothing measures every file anew, so a rule changed costs nothing.
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
  renameSync,
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

/**
 * What a sound is: a one-shot, a bed that loops seamlessly, a stem of the music, a sting, or a
 * theme — a piece of music played once through, as an end card's.
 */
export type Kind = 'oneshot' | 'bed' | 'stem' | 'sting' | 'theme';
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
  /** a stem's tempo, beats a minute: the one its prompt states (`tempoOf`); no other kind's */
  readonly bpm?: number;
  readonly target: Target;
  /** where the game plays it: "src/<file>#<symbol>" */
  readonly usedBy: readonly string[];
}

/**
 * One recording as the game finds it: its file, how long it lasts, ms, the gain that brings it
 * to its target, the silence its sound starts after, ms, its noise floor and its RMS before the
 * gain, whether it plays round and round, the hash of the request that made it, how closely an
 * effect followed its prompt, and who made it.
 */
export interface ManifestEntry {
  readonly file: string;
  readonly ms: number;
  readonly gain: number;
  readonly startMs: number;
  /** the RMS of its quietest FLOOR_WINDOW_MS, over every channel, before the gain */
  readonly floor: number;
  /** its RMS from where its sound starts, over every channel, before the gain */
  readonly rms: number;
  readonly loop: boolean;
  readonly hash: string;
  /** an effect's prompt influence; PROMPT_INFLUENCE where it is not given */
  readonly influence?: number;
  /** a stem's tempo, as the catalog has it: the music's bars are counted by it */
  readonly bpm?: number;
  /**
   * an entry not rendered yet that plays another's recording meanwhile, by that one's id: its
   * `file` and its measurements are that recording's, its hash that request's — so it counts as
   * made from another request, and the next run makes it
   */
  readonly standIn?: string;
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
/**
 * A theme played once, at the effects' 128 kbit/s, 16 kB a second: the music's folder holds
 * 8 MB (FOLDER_CAPS), which the looped stems at 192 take the most of.
 */
export const THEME_FORMAT = 'mp3_44100_128';
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
/** The most takes a run makes of a piece of music: it costs by the second, 18 credits each. */
export const MAX_MUSIC_TAKES = 3;
/**
 * Where the music's takes wait for the ear: takes/<id>/<n>.mp3 and their list, TAKES_LIST. Git
 * ignores the folder; nothing of it ships.
 */
export const TAKES_DIR = resolve(HERE, '../takes');
/** An entry's list of its takes, in its folder under TAKES_DIR. */
export const TAKES_LIST = 'index.json';

/** Where a run reads and writes: each group's folder, and the folder the takes wait in. */
export interface Places {
  readonly dirs: Readonly<Record<Group, string>>;
  readonly takes: string;
}
export const PLACES: Places = { dirs: DIRS, takes: TAKES_DIR };
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

/** A recording's noise floor is the RMS of its quietest stretch this long, ms. */
export const FLOOR_WINDOW_MS = 100;
/** A floor that comes out louder than this once the gain is applied is heard, dBFS. */
export const AUDIBLE_FLOOR_DBFS = -50;
/**
 * A floor less than this far under the recording's RMS, dB, is the sound itself — a bed, a stem,
 * a hiss or a ringing tone that fills its file — and the sound masks whatever noise lies under it.
 */
export const MASKED_WITHIN_DB = 20;

/**
 * The rules a take is picked by: its peak stands at −6 dBFS or more before its gain, its sound
 * starts within 50 ms, at most a tenth of it is silence, it runs within a fifth of the length
 * asked for, and its floor is not heard (`floorHeard`).
 */
export const PICK = { peakDbfs: -6, leadMs: 50, silence: 0.1, length: 0.2 } as const;

/** The loudness each kind is brought to. */
export const TARGETS: Readonly<Record<Kind, Target>> = {
  oneshot: { measure: 'peak', dbfs: -3 },
  bed: { measure: 'rms', dbfs: -20 },
  stem: { measure: 'rms', dbfs: -20 },
  sting: { measure: 'rms', dbfs: -14 },
  theme: { measure: 'rms', dbfs: -20 },
};
/** How long each kind may last, s: ElevenLabs' bounds for an effect; the music's own. */
export const LENGTHS: Readonly<Record<Kind, readonly [number, number]>> = {
  oneshot: [0.5, 30],
  bed: [0.5, 30],
  stem: [60, 90],
  sting: [8, 12],
  theme: [30, 40],
};

// --- the catalog ----------------------------------------------------------------------------

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const USED_BY = /^src\/[\w/.-]+\.tsx?#\w+$/;
const TEMPO = /\b(\d+(?:\.\d+)?)\s*BPM\b/i;
const kindOf = (entry: CatalogEntry): Kind | undefined =>
  Object.keys(TARGETS).find((kind): kind is Kind => kind === entry.kind);

/** The tempo a prompt states, beats a minute („A minor, 90 BPM"); null where it states none. */
export function tempoOf(prompt: string): number | null {
  const stated = TEMPO.exec(prompt)?.[1];
  return stated === undefined ? null : Number(stated);
}

/** Whether `entry` keeps the tempo rule: a stem names its prompt's tempo, the rest none. */
function tempoKept(entry: CatalogEntry): boolean {
  if (entry.kind !== 'stem') return entry.bpm === undefined;
  return entry.bpm !== undefined && entry.bpm === tempoOf(entry.prompt);
}

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
  [
    tempoKept,
    (e) =>
      e.kind === 'stem'
        ? `its bpm has to be the tempo its prompt states (${tempoOf(e.prompt) ?? 'none'})`
        : 'only a stem has a bpm',
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

/**
 * Returns `catalog` where every entry keeps the rules, no id comes twice and the stems share one
 * tempo — the music crosses from one to the next on their common bar; fails naming each flaw.
 */
export function checkCatalog(catalog: readonly CatalogEntry[]): readonly CatalogEntry[] {
  const seen = new Set<string>();
  const flaws = catalog.flatMap((entry) => {
    const twice = seen.has(entry.id) ? ['its id comes twice'] : [];
    seen.add(entry.id);
    return [...flawsOf(entry), ...twice].map((flaw) => `${entry.id}: ${flaw}`);
  });
  const tempos = new Set(catalog.filter((e) => e.kind === 'stem').map((e) => e.bpm));
  if (tempos.size > 1) {
    flaws.push(`the stems have to share one tempo, not ${[...tempos].join(', ')} bpm`);
  }
  if (flaws.length > 0) {
    throw new Error(`sfx: audio/catalog.json —\n  ${flaws.join('\n  ')}`);
  }
  return catalog;
}

/** Where an entry is made and kept: a stem, a sting or a theme with the music, the rest apart. */
export function groupOf(entry: Pick<CatalogEntry, 'kind'>): Group {
  const music: readonly Kind[] = ['stem', 'sting', 'theme'];
  return music.includes(entry.kind) ? 'music' : 'sfx';
}

/** The format a piece of music is made in: the music's, or a theme's (THEME_FORMAT). */
export function musicFormatOf(
  entry: Pick<CatalogEntry, 'kind'>,
): typeof MUSIC_FORMAT | typeof THEME_FORMAT {
  return entry.kind === 'theme' ? THEME_FORMAT : MUSIC_FORMAT;
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

/** What Eleven Music is asked for a piece beside its prompt: its length, instrumental, a model. */
export interface MusicSettings {
  readonly musicLengthMs: number;
  readonly forceInstrumental: true;
  readonly modelId: typeof MUSIC_MODEL;
  readonly outputFormat: typeof MUSIC_FORMAT | typeof THEME_FORMAT;
}

/** The settings a piece of music is asked for with: as long as the catalog says, instrumental. */
export function settingsOf(entry: CatalogEntry): MusicSettings {
  return {
    musicLengthMs: Math.round(entry.durationSeconds * 1000),
    forceInstrumental: true,
    modelId: MUSIC_MODEL,
    outputFormat: musicFormatOf(entry),
  };
}

/** What Eleven Music is asked for a piece: its prompt, with its settings (`settingsOf`). */
export function musicRequest(entry: CatalogEntry): ElevenLabs.BodyComposeMusicV1MusicPost {
  // In this order: the request's JSON is what its hash is taken of.
  const { musicLengthMs, forceInstrumental, modelId, outputFormat } = settingsOf(entry);
  return { prompt: entry.prompt, musicLengthMs, forceInstrumental, modelId, outputFormat };
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

/** What making an entry costs, credits: `candidates` takes of it. */
export function costOf(entry: CatalogEntry, candidates = 1): number {
  return Math.ceil(entry.durationSeconds * CREDITS_PER_SECOND[groupOf(entry)] * candidates);
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

/** A take to keep, as `--keep <id>=<n>` names it: its entry's id and its number. */
export interface Keep {
  readonly id: string;
  readonly n: number;
}

/**
 * What the command line asks for: the groups, a plan alone, a list of entries, candidates — or a
 * take to keep, which a run keeps and makes nothing besides.
 */
export interface Options {
  readonly groups: readonly Group[];
  readonly dryRun: boolean;
  readonly only: readonly string[] | null;
  readonly candidates: number;
  readonly keep: Keep | null;
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

/** The take `value` names: an entry's id, `=`, the take's number, a whole one from 1. */
function keepOf(value: string): Keep {
  const [, id, n] = /^([a-z0-9]+(?:-[a-z0-9]+)*)=([1-9]\d*)$/.exec(value) ?? [];
  if (id === undefined || n === undefined) {
    throw new Error(
      `sfx: --keep ${value} — it takes an entry's id and a take's number: --keep menu-theme=2`,
    );
  }
  return { id, n: Number(n) };
}

/** What the command line has said so far: `null` for a flag it has not given. */
interface Said {
  readonly groups: Group[];
  dryRun: boolean;
  only: string[] | null;
  candidates: number | null;
  keep: Keep | null;
}

/** The flags that take a value: what each takes, as a refusal says it, and what it sets. */
const VALUED = new Map<string, readonly [string, (said: Said, value: string) => void]>([
  [
    '--only',
    [
      'a list of ids: --only a,b,c',
      (said, list) => {
        said.only = list.split(',').map((id) => id.trim()).filter((id) => id !== '');
      },
    ],
  ],
  [
    '--candidates',
    ['a number: --candidates 3', (said, value) => (said.candidates = candidatesOf(value))],
  ],
  [
    '--keep',
    [
      "an entry's id and a take's number: --keep menu-theme=2",
      (said, value) => {
        if (said.keep !== null) throw new Error('sfx: --keep twice — a run keeps one take');
        said.keep = keepOf(value);
      },
    ],
  ],
]);

/** Whether `said` asks for anything but a take to keep. */
const asksMore = (said: Said): boolean =>
  said.groups.length > 0 || said.dryRun || said.only !== null || said.candidates !== null;

/**
 * The options `said` comes to: both groups where neither is named, one candidate where none is
 * asked for. Fails where `--keep` comes with anything else.
 */
function settled(said: Said): Options {
  if (said.keep !== null && asksMore(said)) {
    throw new Error('sfx: --keep keeps a take and makes nothing: it comes alone');
  }
  const { groups, dryRun, only, candidates, keep } = said;
  const asked = groups.length > 0 ? groups : GROUPS;
  return { groups: asked, dryRun, only, candidates: candidates ?? 1, keep };
}

/** Reads `sfx`, `music`, `--dry-run`, `--only a,b,c`, `--candidates N` and `--keep <id>=<n>`. */
export function optionsOf(args: readonly string[]): Options {
  const said: Said = { groups: [], dryRun: false, only: null, candidates: null, keep: null };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    const valued = VALUED.get(arg);
    if (arg === 'sfx' || arg === 'music') {
      said.groups.push(arg);
    } else if (arg === '--dry-run') {
      said.dryRun = true;
    } else if (valued !== undefined) {
      valued[1](said, valueAfter(args, i, valued[0]));
      i += 1;
    } else if (arg !== '--') {
      const flags = 'sfx, music, --dry-run, --only a,b,c, --candidates N and --keep <id>=<n>';
      throw new Error(`sfx: ${arg} — it takes ${flags}`);
    }
  }
  return settled(said);
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
 * what its group's manifest kept and whether its file is there (`filed`). Fails where it would
 * make a piece of music in more than MAX_MUSIC_TAKES takes.
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
  const jobs = chosen.map((entry) => {
    const group = groupOf(entry);
    const kept = manifests[group][entry.id];
    const fresh = kept !== undefined && upToDate(entry, kept) && filed(group, kept.file);
    return { entry, group, make: only !== null || !fresh };
  });
  const music = jobs.filter((job) => job.make && job.group === 'music').map((job) => job.entry.id);
  if (options.candidates > MAX_MUSIC_TAKES && music.length > 0) {
    const fewer = `--candidates ${MAX_MUSIC_TAKES} --only ${music.join(',')}`;
    throw new Error(
      `sfx: --candidates ${options.candidates} — music is made in ${MAX_MUSIC_TAKES} takes at ` +
        `most, its cost runs by the second: ${fewer}`,
    );
  }
  return jobs;
}

/** Whether a run makes `job` in takes for the ear: a piece of music, made more than once. */
export function asTakes(job: Pick<Job, 'group'>, count: number): boolean {
  return job.group === 'music' && count > 1;
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

/** Each full 10 ms frame's sum of squares, over every channel, and the frame's length. */
function frameSums(pcm: Pcm): { sums: number[]; frame: number } {
  const samples = pcm.channels[0]?.length ?? 0;
  const frame = Math.max(1, Math.round(pcm.rate / 100));
  const sums: number[] = [];
  for (let from = 0; from + frame <= samples; from += frame) {
    let sum = 0;
    for (const data of pcm.channels) {
      for (let i = from; i < from + frame; i++) sum += (data[i] ?? 0) ** 2;
    }
    sums.push(sum);
  }
  return { sums, frame };
}

/**
 * `pcm`'s noise floor: the RMS, over every channel, of its quietest FLOOR_WINDOW_MS, stepped
 * 10 ms at a time; of all of it where it is shorter.
 */
export function floorOf(pcm: Pcm): number {
  const { sums, frame } = frameSums(pcm);
  const span = Math.round(FLOOR_WINDOW_MS / 10);
  const width = pcm.channels.length * frame;
  if (sums.length < span) {
    const total = sums.reduce((sum, each) => sum + each, 0);
    return sums.length > 0 ? Math.sqrt(total / (sums.length * width)) : 0;
  }
  let least = Infinity;
  for (let k = 0; k + span <= sums.length; k++) {
    let window = 0;
    for (let j = k; j < k + span; j++) window += sums[j] ?? 0;
    least = Math.min(least, window);
  }
  return Math.sqrt(least / (span * width));
}

/** The linear gain that brings a recording measured as `loudness` to `target`; fails on silence. */
export function gainOf(target: Target, loudness: Loudness, id: string): number {
  const level = target.measure === 'peak' ? loudness.peak : loudness.rms;
  if (!(level > 0)) {
    throw new Error(`sfx: ${id} came back silent — make it again: --only ${id}`);
  }
  return Number((10 ** (target.dbfs / 20) / level).toFixed(4));
}

/** A level as dBFS; −Infinity for silence. */
const dbfs = (level: number): number => 20 * Math.log10(level);

/** What decides whether a recording's floor is heard: the floor, its RMS, both before its gain. */
export interface Floor {
  readonly floor: number;
  readonly rms: number;
  readonly gain: number;
}

/** The floor a recording plays once its gain is applied, dBFS; −Infinity for digital silence. */
export function heardDbfs(measured: Floor): number {
  return dbfs(measured.floor * measured.gain);
}

/** Whether a recording's floor lies less than MASKED_WITHIN_DB under its RMS: the sound itself. */
function floorMasked(measured: Floor): boolean {
  return dbfs(measured.rms) - dbfs(measured.floor) < MASKED_WITHIN_DB;
}

/**
 * Whether a recording plays its noise floor where it is heard: a floor MASKED_WITHIN_DB or more
 * under its RMS — a gap in the sound, not the sound itself — that comes out louder than
 * AUDIBLE_FLOOR_DBFS once the gain is applied.
 */
export function floorHeard(measured: Floor): boolean {
  return !floorMasked(measured) && heardDbfs(measured) > AUDIBLE_FLOOR_DBFS;
}

/** A recording whose floor is heard: its id, its gain, and its floor once that is applied, dBFS. */
export interface Noisy {
  readonly id: string;
  readonly gain: number;
  readonly heardDbfs: number;
}

/** How far a recording `ms` long lies from the length `entry` asks for: a share of it. */
export function lengthOff(entry: CatalogEntry, ms: number): number {
  const asked = entry.durationSeconds * 1000;
  return Math.abs(ms - asked) / asked;
}

/** A recording that runs off the length asked for: its id, how long it is and was asked, ms. */
export interface OffLength {
  readonly id: string;
  readonly ms: number;
  readonly asked: number;
}

/** The recordings of `catalog` that run more than PICK.length off the length they asked for. */
export function offLength(
  catalog: readonly CatalogEntry[],
  manifests: Readonly<Record<Group, Manifest>>,
): OffLength[] {
  return catalog.flatMap((entry) => {
    const kept = manifests[groupOf(entry)][entry.id];
    if (kept === undefined || lengthOff(entry, kept.ms) <= PICK.length) return [];
    return [{ id: entry.id, ms: kept.ms, asked: entry.durationSeconds * 1000 }];
  });
}

/** The recordings of `catalog` that, as `manifests` measured them, play a floor that is heard. */
export function noisyTakes(
  catalog: readonly CatalogEntry[],
  manifests: Readonly<Record<Group, Manifest>>,
): Noisy[] {
  return catalog.flatMap((entry) => {
    const kept = manifests[groupOf(entry)][entry.id];
    if (kept === undefined || !floorHeard(kept)) return [];
    return [{ id: entry.id, gain: kept.gain, heardDbfs: Number(heardDbfs(kept).toFixed(1)) }];
  });
}

/** Where a recording's sound starts, ms: past more than LEAD_MS of silence; a bed's at 0. */
export function startMsOf(kind: Kind, loudness: Loudness): number {
  return kind !== 'bed' && loudness.leadMs > LEAD_MS ? Math.floor(loudness.leadMs) : 0;
}

// --- picking a take ---------------------------------------------------------------------------

/**
 * A take of an entry as it measures: where it lies, how closely it followed its prompt, its
 * loudness, the share of it that is silence, its noise floor, its gain, and how far its length
 * is off, a share.
 */
export interface Take {
  readonly path: string;
  readonly influence: number;
  readonly loudness: Loudness;
  readonly silence: number;
  readonly floor: number;
  readonly gain: number;
  readonly lengthOff: number;
}

/** What decides whether `take`'s floor is heard. */
const floorAt = (take: Take): Floor => ({
  floor: take.floor,
  rms: take.loudness.rms,
  gain: take.gain,
});

/**
 * The rules of PICK `take` misses: its peak, where its sound starts, its silence, its length,
 * its floor.
 */
export function missesOf(take: Take): string[] {
  const misses = [
    dbfs(take.loudness.peak) < PICK.peakDbfs && 'peak',
    take.loudness.leadMs > PICK.leadMs && 'start',
    take.silence > PICK.silence && 'silence',
    take.lengthOff > PICK.length && 'length',
    floorHeard(floorAt(take)) && 'floor',
  ];
  return misses.filter((miss): miss is string => typeof miss === 'string');
}

/**
 * The take to keep of `takes`: of those that miss the fewest rules — none, where any keeps them
 * all — the one with the loudest RMS. A short click misses the silence rule whatever it does,
 * its tail silent long before half a second is over, so for it the RMS decides.
 */
export function pickTake(takes: readonly Take[]): Take {
  const ranked = [...takes].sort(
    (a, b) => missesOf(a).length - missesOf(b).length || b.loudness.rms - a.loudness.rms,
  );
  const best = ranked[0];
  if (best === undefined) {
    throw new Error('sfx: no take to pick from');
  }
  return best;
}

/** Decodes the recording at a path into PCM. */
export type Decode = (path: string) => Pcm;

/** Decodes a recording with afconvert into `scratch` and reads it back as PCM. */
function afconvertIn(scratch: string): Decode {
  return (path) => {
    const wav = join(scratch, 'decoded.wav');
    execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16', path, wav]);
    try {
      return parseWav(readFileSync(wav));
    } finally {
      rmSync(wav, { force: true });
    }
  };
}

/** The take of `entry` at `path`, made at `influence`, measured. */
function takeAt(entry: CatalogEntry, path: string, influence: number, decode: Decode): Take {
  const pcm = decode(path);
  const loudness = loudnessOf(pcm);
  return {
    path,
    influence,
    loudness,
    silence: silenceOf(pcm),
    floor: floorOf(pcm),
    gain: gainOf(entry.target, loudness, entry.id),
    lengthOff: lengthOff(entry, loudness.ms),
  };
}

/** The manifest's entry for `entry` as `take` measured it. */
function entryOf(entry: CatalogEntry, take: Take): ManifestEntry {
  return {
    file: fileOf(entry.id),
    ms: take.loudness.ms,
    gain: take.gain,
    startMs: startMsOf(entry.kind, take.loudness),
    floor: Number(take.floor.toPrecision(3)),
    rms: Number(take.loudness.rms.toPrecision(3)),
    loop: entry.loop,
    hash: hashOf(entry, take.influence),
    ...(groupOf(entry) === 'sfx' ? { influence: take.influence } : {}),
    ...(entry.bpm === undefined ? {} : { bpm: entry.bpm }),
    source: 'elevenlabs',
  };
}

/** How take `n` of `entry` measured, in a line — an effect's with its influence. */
function takeLine(entry: CatalogEntry, take: Take, n: number): string {
  const how = groupOf(entry) === 'sfx' ? ` (influence ${take.influence})` : '';
  const { peak, rms, leadMs, ms } = take.loudness;
  const misses = missesOf(take);
  const measured = floorAt(take);
  const masked = floorMasked(measured) ? ' (masked)' : '';
  const floor = `${heardDbfs(measured).toFixed(1)} dBFS${masked}`;
  return (
    `  ${entry.id} take ${n}${how}: peak ${dbfs(peak).toFixed(1)} dBFS, RMS ` +
    `${dbfs(rms).toFixed(1)} dBFS, starts ${leadMs.toFixed(0)} ms, silence ` +
    `${(take.silence * 100).toFixed(0)} %, ${ms} ms, gain ${take.gain}, floor ${floor}` +
    `${misses.length > 0 ? ` — misses ${misses.join(', ')}` : ''}`
  );
}

/** Says how each take of `entry` measured — an effect's with its influence — and which is kept. */
function sayTakes(entry: CatalogEntry, takes: readonly Take[], kept: Take): void {
  takes.forEach((take, i) => {
    console.log(`${takeLine(entry, take, i + 1)}${take === kept ? '  ← kept' : ''}`);
  });
}

// --- the music's takes ------------------------------------------------------------------------

/**
 * One take of a piece of music, as its list keeps it until the ear has chosen: its number and
 * file, the hash of the request it was made from (its prompt and its settings), the settings,
 * when it was made, and how it measures — its length, the gain that brings it to its target, the
 * silence its sound starts after, its peak, RMS and floor before the gain, its share of silence
 * — and the rules of PICK it misses, said and never used to pick.
 */
export interface TakeRecord {
  readonly n: number;
  readonly file: string;
  readonly hash: string;
  readonly settings: MusicSettings;
  /** ISO 8601 */
  readonly madeAt: string;
  readonly ms: number;
  readonly gain: number;
  readonly startMs: number;
  readonly peak: number;
  readonly rms: number;
  readonly floor: number;
  readonly silence: number;
  readonly misses: readonly string[];
}

/** An entry's takes, as takes/<id>/index.json lists them, in the order they were made. */
export interface TakesList {
  readonly id: string;
  readonly takes: readonly TakeRecord[];
}

/** The file of take `n` in its entry's folder of takes. */
export function takeFile(n: number): string {
  return `${n}.mp3`;
}

/** The list of `id`'s takes in `dir`, the folder the takes wait in; null where it has none. */
export function readTakes(dir: string, id: string): TakesList | null {
  const file = join(dir, id, TAKES_LIST);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as TakesList) : null;
}

function writeTakes(dir: string, list: TakesList): void {
  writeFileSync(join(dir, list.id, TAKES_LIST), `${JSON.stringify(list, null, 2)}\n`);
}

/** Take `n` of `entry`, made at `madeAt`, as its list keeps it: `take` measured it. */
function recordOf(entry: CatalogEntry, n: number, take: Take, madeAt: Date): TakeRecord {
  return {
    n,
    file: takeFile(n),
    hash: hashOf(entry),
    settings: settingsOf(entry),
    madeAt: madeAt.toISOString(),
    ms: take.loudness.ms,
    gain: take.gain,
    startMs: startMsOf(entry.kind, take.loudness),
    peak: Number(take.loudness.peak.toPrecision(3)),
    rms: Number(take.loudness.rms.toPrecision(3)),
    floor: Number(take.floor.toPrecision(3)),
    silence: Number(take.silence.toFixed(3)),
    misses: missesOf(take),
  };
}

// --- the run ----------------------------------------------------------------------------------

/** A group's manifest in `places`; empty where there is none. */
export function readManifest(places: Places, group: Group): Manifest {
  const file = join(places.dirs[group], MANIFEST);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Manifest) : {};
}

/** Writes a group's manifest, its entries in the order of their ids. */
function writeManifest(places: Places, group: Group, manifest: Manifest): void {
  mkdirSync(places.dirs[group], { recursive: true });
  const sorted = Object.entries(manifest).sort(([a], [b]) => (a < b ? -1 : 1));
  const text = `${JSON.stringify(Object.fromEntries(sorted), null, 2)}\n`;
  writeFileSync(join(places.dirs[group], MANIFEST), text);
}

/** Whether a group's folder in `places` holds a file. */
const filedIn =
  (places: Places) =>
  (group: Group, file: string): boolean =>
    existsSync(join(places.dirs[group], file));

/** How a plan says the takes it makes of each entry of `group`, and what becomes of them. */
function takesSaid(group: Group, candidates: number): string {
  if (candidates <= 1) return '';
  const kept = asTakes({ group }, candidates) ? 'into takes/ for the ear' : 'the best one kept';
  return `, ${candidates} takes each, ${kept}`;
}

/**
 * What the run will make, group by group, and what that costs at the rates measured, every take
 * counted: a line for each group and one for each entry it makes.
 */
export function planLines(jobs: readonly Job[], candidates: number): string[] {
  return GROUPS.flatMap((group) => {
    const mine = jobs.filter((job) => job.group === group);
    const todo = mine.filter((job) => job.make).map((job) => job.entry);
    if (mine.length === 0) return [];
    const seconds = todo.reduce((sum, entry) => sum + entry.durationSeconds, 0);
    const credits = todo.reduce((sum, entry) => sum + costOf(entry, candidates), 0);
    const each = candidates > 1 ? ' a take' : '';
    return [
      `sfx: ${group} — ${todo.length} of ${mine.length} to make${takesSaid(group, candidates)}, ` +
        `${seconds.toFixed(1)} s${each}, about ${credits} credits (cap ${CAPS[group]})`,
      ...todo.map((entry) => `  ${entry.id}  ${entry.durationSeconds} s  ${entry.kind}`),
    ];
  });
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

/** How a run makes what it makes: how many takes of each, and where an effect's candidates go. */
export interface Making {
  readonly count: number;
  /** a folder in the system's temp: an effect's candidates, each a file in it */
  readonly candidates: string;
}

/**
 * What a run works with: the account's client, the folders it reads and writes, how it decodes
 * a recording to measure it, the clock its takes are dated by, and how it waits between
 * requests.
 */
export interface Bench {
  readonly client: SoundClient;
  readonly places: Places;
  readonly decode: Decode;
  readonly now: () => Date;
  readonly wait: (ms: number) => Promise<void>;
}

const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/**
 * Makes `job` into the project: once, or as `count` takes into the candidates' folder, an
 * effect's each at its influence, each measured and said, the one `pickTake` picks copied into
 * the project. Returns the manifest's entry for what it kept.
 */
async function renderJob(job: Job, making: Making, bench: Bench): Promise<ManifestEntry> {
  const { entry, group } = job;
  const target = join(bench.places.dirs[group], fileOf(entry.id));
  const influences = influencesFor(group === 'music' ? 1 : making.count);
  const [only] = influences;
  if (influences.length === 1 && only !== undefined) {
    writeFileSync(target, await make(bench.client, entry, { influence: only, wait: bench.wait }));
    return entryOf(entry, takeAt(entry, target, only, bench.decode));
  }
  const makeTake = (influence: number, i: number) => async (): Promise<Take> => {
    const path = join(making.candidates, `${entry.id}-${i + 1}.mp3`);
    writeFileSync(path, await make(bench.client, entry, { influence, wait: bench.wait }));
    return takeAt(entry, path, influence, bench.decode);
  };
  const takes = await oneByOne(influences.map(makeTake), ELEVEN_GAP_MS, bench.wait);
  const kept = pickTake(takes);
  sayTakes(entry, takes, kept);
  copyFileSync(kept.path, target);
  return entryOf(entry, { ...kept, path: target });
}

/**
 * Makes `count` takes of the piece of music `entry` into its folder under the takes' — each by
 * the same request, numbered on from those already there, measured, said and listed as it comes,
 * so that a run cut short keeps every take it paid for — and keeps none of them in the project:
 * the ear chooses. Returns its list, the takes made before included.
 */
export async function makeTakes(
  entry: CatalogEntry,
  count: number,
  bench: Bench,
): Promise<TakesList> {
  const dir = join(bench.places.takes, entry.id);
  mkdirSync(dir, { recursive: true });
  let list: TakesList = readTakes(bench.places.takes, entry.id) ?? { id: entry.id, takes: [] };
  const first = Math.max(0, ...list.takes.map((take) => take.n)) + 1;
  const makeOne = (n: number) => async (): Promise<void> => {
    const path = join(dir, takeFile(n));
    writeFileSync(path, await make(bench.client, entry, { wait: bench.wait }));
    const take = takeAt(entry, path, PROMPT_INFLUENCE, bench.decode);
    console.log(takeLine(entry, take, n));
    list = { id: entry.id, takes: [...list.takes, recordOf(entry, n, take, bench.now())] };
    writeTakes(bench.places.takes, list);
  };
  const numbers = Array.from({ length: count }, (_, i) => first + i);
  await oneByOne(numbers.map(makeOne), ELEVEN_GAP_MS, bench.wait);
  return list;
}

/**
 * Makes `job`: a piece of music in takes for the ear where the run makes more than one
 * (`asTakes`); anything else into the project, its entry written into its group's manifest as it
 * comes.
 */
async function makeJob(job: Job, manifest: Manifest, making: Making, bench: Bench): Promise<void> {
  if (asTakes(job, making.count)) {
    await makeTakes(job.entry, making.count, bench);
    return;
  }
  mkdirSync(bench.places.dirs[job.group], { recursive: true });
  const entry = await renderJob(job, making, bench);
  manifest[job.entry.id] = entry;
  writeManifest(bench.places, job.group, manifest);
  console.log(`sfx: ${job.entry.id} ${(entry.ms / 1000).toFixed(1)} s, gain ${entry.gain}`);
}

/**
 * Reads what a group's first job cost off the account, `before` it the credits left, and prices
 * the `rest` at that rate; over the group's cap, the run stops there.
 */
async function priceTheRest(
  first: Job,
  rest: readonly Job[],
  before: number,
  making: Making,
  client: SoundClient,
): Promise<void> {
  const spent = before - (await creditsLeft(client));
  const secondsOf = (job: Job): number => job.entry.durationSeconds * making.count;
  const later = rest.reduce((sum, job) => sum + secondsOf(job), 0);
  const price = priced(spent, secondsOf(first), later, first.group);
  const expected = costOf(first.entry, making.count);
  console.log(
    `sfx: ${first.entry.id} cost ${spent} credits (${price.perSecond.toFixed(1)} a second, ` +
      `${expected} expected); the ${first.group} come to about ${price.total}`,
  );
  if (price.over) {
    throw new Error(`sfx: that is over the ${CAPS[first.group]} the ${first.group} may spend`);
  }
}

/**
 * Makes a group's `jobs` one after the other; after the first, its cost is read off the account
 * and the rest priced at that rate (`priceTheRest`). Returns what the group spent.
 */
async function renderGroup(
  jobs: readonly Job[],
  manifest: Manifest,
  making: Making,
  bench: Bench,
): Promise<number> {
  const before = await creditsLeft(bench.client);
  const tasks = jobs.map((job, i) => async () => {
    await makeJob(job, manifest, making, bench);
    if (i === 0) await priceTheRest(job, jobs.slice(1), before, making, bench.client);
  });
  await oneByOne(tasks, ELEVEN_GAP_MS, bench.wait);
  return before - (await creditsLeft(bench.client));
}

/**
 * Makes every job of `todo` through `bench`, group by group, within the credits and the caps:
 * an effect, or a piece of music made once, into the project; a piece of music made in takes into
 * the takes' folder.
 */
export async function renderWith(
  todo: readonly Job[],
  manifests: Record<Group, Manifest>,
  making: Making,
  bench: Bench,
): Promise<void> {
  const left = await creditsLeft(bench.client);
  console.log(`sfx: ${left} credits left`);
  refuseBelow(left);
  for (const group of GROUPS) {
    const jobs = todo.filter((job) => job.group === group);
    const cost = jobs.reduce((sum, job) => sum + costOf(job.entry, making.count), 0);
    if (cost > CAPS[group]) {
      throw new Error(`sfx: the ${group} would cost about ${cost} credits, over ${CAPS[group]}`);
    }
  }
  for (const group of GROUPS) {
    const jobs = todo.filter((job) => job.group === group);
    if (jobs.length === 0) continue;
    const spent = await renderGroup(jobs, manifests[group], making, bench);
    console.log(`sfx: the ${group} spent ${spent} credits`);
  }
  console.log(`sfx: ${await creditsLeft(bench.client)} credits left`);
}

/** Makes every job of `todo` with the account the environment's key opens. */
async function renderAll(
  todo: readonly Job[],
  manifests: Record<Group, Manifest>,
  making: Making,
  decode: Decode,
): Promise<void> {
  requireKey();
  const client = await elevenClient();
  const bench = { client, places: PLACES, decode, now: () => new Date(), wait: pause };
  await renderWith(todo, manifests, making, bench);
}

// --- keeping a take ---------------------------------------------------------------------------

/** Why `entry` has no takes to keep, and what makes some. */
function noTakes(entry: CatalogEntry): string {
  return groupOf(entry) === 'music'
    ? `${entry.id} has no takes; make some: ${remakeArgs('music', [entry.id])}`
    : `${entry.id} is an effect, whose best take a run keeps itself: none waits for the ear`;
}

/** The entry and the take `keep` names, its file in `takes`; fails, in one line, for none. */
function takeToKeep(
  keep: Keep,
  catalog: readonly CatalogEntry[],
  takes: string,
): { entry: CatalogEntry; record: TakeRecord } {
  const asked = `sfx: --keep ${keep.id}=${keep.n}`;
  const entry = catalog.find((each) => each.id === keep.id);
  if (entry === undefined) throw new Error(`${asked} — audio/catalog.json has no such entry`);
  const made = readTakes(takes, keep.id)?.takes ?? [];
  if (made.length === 0) throw new Error(`${asked} — ${noTakes(entry)}`);
  const record = made.find((take) => take.n === keep.n);
  if (record === undefined) {
    const numbers = made.map((take) => take.n).join(', ');
    throw new Error(`${asked} — ${keep.id} has takes ${numbers}, and no take ${keep.n}`);
  }
  if (record.hash !== hashOf(entry)) {
    const again = remakeArgs(groupOf(entry), [entry.id]);
    throw new Error(`${asked} — it was made from another request than the catalog's: ${again}`);
  }
  if (!existsSync(join(takes, keep.id, record.file))) {
    throw new Error(`${asked} — its file ${keep.id}/${record.file} is gone from ${takes}`);
  }
  return { entry, record };
}

/**
 * Keeps take `keep.n` of `keep.id`, as `--keep <id>=<n>` asks: measures it as a run measures
 * what it makes, puts it into its group's folder as the entry's file, writes the entry into the
 * group's manifest and deletes the entry's folder of takes, the other takes and their list with
 * it. Fails in one line, before anything moves, where the catalog has no such entry, it has no
 * takes or no take of that number, or the take was made from a request other than the catalog's.
 * Returns the group and the manifest's entry it wrote.
 */
export function keepTake(
  keep: Keep,
  catalog: readonly CatalogEntry[],
  places: Places,
  decode: Decode,
): { group: Group; kept: ManifestEntry } {
  const { entry, record } = takeToKeep(keep, catalog, places.takes);
  const from = join(places.takes, entry.id, record.file);
  const take = takeAt(entry, from, PROMPT_INFLUENCE, decode);
  const group = groupOf(entry);
  const target = join(places.dirs[group], fileOf(entry.id));
  mkdirSync(places.dirs[group], { recursive: true });
  copyFileSync(from, `${target}.part`);
  renameSync(`${target}.part`, target);
  const manifest = readManifest(places, group);
  const kept = entryOf(entry, { ...take, path: target });
  manifest[entry.id] = kept;
  writeManifest(places, group, manifest);
  rmSync(join(places.takes, entry.id), { recursive: true, force: true });
  return { group, kept };
}

/** Keeps the take `keep` names, measured with afconvert, and says what the folders hold now. */
function keepRun(keep: Keep, catalog: readonly CatalogEntry[]): void {
  requireTools();
  const scratch = mkdtempSync(join(tmpdir(), 'escapelab-sfx-'));
  try {
    const { group, kept } = keepTake(keep, catalog, PLACES, afconvertIn(scratch));
    console.log(
      `sfx: take ${keep.n} of ${keep.id} is public/${group}/${kept.file} now, ` +
        `${(kept.ms / 1000).toFixed(1)} s, gain ${kept.gain}; its other takes are deleted`,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const manifests = { sfx: readManifest(PLACES, 'sfx'), music: readManifest(PLACES, 'music') };
  report(manifests, PLACES);
  warnTakes(catalog, manifests);
}

/**
 * Says which recordings play a floor that is heard (`noisyTakes`), each with its gain and its
 * floor, and which run off their length (`offLength`), and the command that makes them again;
 * any such fails the run. Nothing is capped or hidden.
 */
function warnTakes(
  catalog: readonly CatalogEntry[],
  manifests: Readonly<Record<Group, Manifest>>,
): void {
  const noisy = noisyTakes(catalog, manifests);
  const off = offLength(catalog, manifests);
  if (noisy.length > 0) {
    console.error(
      `sfx: ${noisy.length} recordings play their noise floor over ${AUDIBLE_FLOOR_DBFS} dBFS ` +
        `once their gain is applied:`,
    );
    for (const { id, gain, heardDbfs: heard } of noisy) {
      console.error(`  ${id}  gain ${gain}, floor ${heard} dBFS`);
    }
  }
  if (off.length > 0) {
    console.error(`sfx: ${off.length} recordings run more than a fifth off their length:`);
    for (const { id, ms, asked } of off) console.error(`  ${id}  ${ms} ms, asked for ${asked}`);
  }
  const ids = new Set([...noisy, ...off].map(({ id }) => id));
  if (ids.size === 0) return;
  sayRemedy(catalog, ids);
  process.exitCode = 1;
}

/** Says, group by group, what makes the recordings `ids` again. */
function sayRemedy(catalog: readonly CatalogEntry[], ids: ReadonlySet<string>): void {
  for (const group of GROUPS) {
    const mine = catalog.filter((e) => ids.has(e.id) && groupOf(e) === group).map((e) => e.id);
    if (mine.length === 0) continue;
    const what =
      group === 'sfx' ? 'the best take kept' : 'their takes left to the ear, one kept by --keep';
    console.error(`sfx: make them again, ${what}: ${remakeArgs(group, mine)}`);
  }
}

/**
 * What the script is told to make `ids` of `group` again: an effect in MAX_CANDIDATES candidates,
 * the best kept; a piece of music in MAX_MUSIC_TAKES takes, which wait for the ear.
 */
export function remakeArgs(group: Group, ids: readonly string[]): string {
  const takes = group === 'sfx' ? MAX_CANDIDATES : MAX_MUSIC_TAKES;
  return `--candidates ${takes} --only ${ids.join(',')}`;
}

/** Says what each folder holds against its cap, and any file no entry names; over a cap fails. */
function report(manifests: Readonly<Record<Group, Manifest>>, places: Places): void {
  for (const group of GROUPS) {
    const dir = places.dirs[group];
    if (!existsSync(dir)) continue;
    const named = new Set(Object.values(manifests[group]).map((entry) => entry.file));
    const files = readdirSync(dir).filter((name) => name.endsWith('.mp3'));
    const bytes = files.reduce((sum, name) => sum + statSync(join(dir, name)).size, 0);
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

/**
 * The jobs whose files a run measures anew: every one it took, but a piece of music it made in
 * takes, whose file in the project — and its manifest's entry with it — stays as it was.
 */
export function measuredAnew(jobs: readonly Job[], count: number): Job[] {
  return jobs.filter((job) => !(job.make && asTakes(job, count)));
}

/** Measures every file the run took anew, its entry kept at the influence it was made at. */
function remeasure(
  jobs: readonly Job[],
  manifests: Record<Group, Manifest>,
  places: Places,
  decode: Decode,
): void {
  const filed = filedIn(places);
  for (const job of jobs.filter((each) => filed(each.group, fileOf(each.entry.id)))) {
    const kept = manifests[job.group][job.entry.id];
    const influence = kept?.influence ?? PROMPT_INFLUENCE;
    const path = join(places.dirs[job.group], fileOf(job.entry.id));
    const take = takeAt(job.entry, path, influence, decode);
    manifests[job.group][job.entry.id] = entryOf(job.entry, take);
  }
  for (const group of GROUPS) {
    if (jobs.some((job) => job.group === group)) writeManifest(places, group, manifests[group]);
  }
}

/**
 * Where the takes of `ids` lie in `places`, the music a run made in takes, that none of it is
 * kept, and how one is: a line for the folder, one for each entry with its takes, and the command
 * that keeps a take of each.
 */
export function takesLines(ids: readonly string[], places: Places): string[] {
  if (ids.length === 0) return [];
  return [
    `sfx: none of this music is kept yet; its takes wait in ${places.takes}:`,
    ...ids.map((id) => {
      const files = (readTakes(places.takes, id)?.takes ?? []).map((take) => take.file);
      return `  ${id}/  ${files.join(', ')}, listed in ${id}/${TAKES_LIST}`;
    }),
    'sfx: the ear chooses: with pnpm dev, http://localhost:5173/sounds plays each take under ' +
      'its piece; in packages/client, this keeps take <n> and deletes the others:',
    ...ids.map((id) => `  node scripts/sfx.ts --keep ${id}=<n>`),
  ];
}

/**
 * Makes what `jobs` ask for, `count` takes of each, measures what the run took anew
 * (`measuredAnew`) and says where the takes lie.
 */
async function renderRun(
  jobs: readonly Job[],
  manifests: Record<Group, Manifest>,
  count: number,
): Promise<void> {
  requireTools();
  const scratch = mkdtempSync(join(tmpdir(), 'escapelab-sfx-'));
  const todo = jobs.filter((job) => job.make);
  const inTakes = todo.filter((job) => asTakes(job, count));
  const many = count > 1 && todo.length > inTakes.length;
  const candidates = many ? mkdtempSync(join(tmpdir(), 'escapelab-sfx-candidates-')) : scratch;
  const decode = afconvertIn(scratch);
  try {
    if (todo.length > 0) await renderAll(todo, manifests, { count, candidates }, decode);
    remeasure(measuredAnew(jobs, count), manifests, PLACES, decode);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (many) console.log(`sfx: every candidate lies in ${candidates}`);
  for (const line of takesLines(inTakes.map((job) => job.entry.id), PLACES)) console.log(line);
}

async function main(options: Options): Promise<void> {
  const catalog = checkCatalog(readCatalog());
  if (options.keep !== null) {
    keepRun(options.keep, catalog);
    return;
  }
  const manifests = { sfx: readManifest(PLACES, 'sfx'), music: readManifest(PLACES, 'music') };
  const jobs = planOf(catalog, manifests, filedIn(PLACES), options);
  for (const line of planLines(jobs, options.candidates)) console.log(line);
  if (options.dryRun) {
    warnTakes(catalog, manifests);
    return;
  }
  await renderRun(jobs, manifests, options.candidates);
  report(manifests, PLACES);
  warnTakes(catalog, manifests);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve()
    .then(() => main(optionsOf(process.argv.slice(2))))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}

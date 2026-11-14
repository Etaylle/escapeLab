/**
 * The lab's sound effects and music as recordings, made by ElevenLabs (docs/sound.md):
 *
 *   pnpm --filter client sfx                    every effect and piece of music not made yet
 *   pnpm --filter client sfx -- sfx             the effects alone; `music`, the music alone
 *   pnpm --filter client sfx -- --dry-run       the plan and what it would cost; nothing is asked
 *   pnpm --filter client sfx -- --only a,b,c    those entries, made anew
 *   pnpm --filter client sfx -- --candidates 3  each made three times: an effect's best take
 *                                               kept, a piece of music's takes left to the ear
 *   pnpm --filter client sfx -- --keep won=2    take 2 of the won sting kept, the rest of its
 *                                               takes deleted
 *   pnpm --filter client sfx -- --keep score=2  take 2 of a suite kept whole, cut into its pieces
 *
 * audio/catalog.json lists every sound the game plays: its id, its kind — a one-shot, a bed that
 * loops seamlessly or a sting; the music's stems and themes are sections of a suite (below) — what
 * ElevenLabs is asked for (an English prompt and a length), whether it loops, the loudness it is
 * brought to and where the game plays it. An effect comes from text-to-sound-effects
 * (`eleven_text_to_sound_v2`, a bed as a seamless loop) as MP3 at 44.1 kHz and 128 kbit/s, a
 * sting from Eleven Music, instrumental, at 192 kbit/s; each into public/sfx/<id>.mp3 or
 * public/music/<id>.mp3. public/sfx/manifest.json and public/music/manifest.json list each as
 * { file, ms, gain, startMs, floor, rms, loop, hash, influence, source }: `hash` names the request
 * that made it — `influence` how closely an effect followed its prompt — so an entry whose
 * request is unchanged and whose file is there is not made again, and a run cut short goes on
 * where it stopped. An entry not made yet may play another's recording meanwhile (`standIn`): it
 * counts as made from another request, and the next run makes it.
 *
 * The catalog may hold a suite as well (suite.ts): music written as one generation of Eleven Music,
 * a composition plan of named sections that share a key, a tempo and a motif, each section a piece
 * the game plays. A suite is made only where --only names it, and always in takes for the ear — one
 * a run where no more are asked for, MAX_MUSIC_TAKES at most — each take measured piece by piece
 * where the plan cuts it; `--keep <suite>=<n>` keeps a take whole: cut at the plan's boundaries,
 * each piece's edges faded over EDGE_MS, encoded by afconvert as AAC at PIECE_BITRATE into
 * public/music/<id>.m4a, measured as a render — its loudness as BS.1770 has it (pcm.ts `lufsOf`),
 * brought to the suite's target — and listed with the suite's hash and name and a loop's bars; the
 * file each piece played before is deleted with the suite's other takes.
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
 * The files stay as ElevenLabs made them. afconvert decodes each into a temporary folder, its peak
 * and RMS are measured there, and `gain` is what brings it to its target — a one-shot's peak to −3
 * dBFS, a bed's RMS to −20 dBFS, a sting's to −14 dBFS, a piece of a suite's loudness to its
 * suite's — for the game to apply; more than 30 ms of silence at the start becomes `startMs`,
 * except in a bed, whose loop keeps its start. `floor` is the RMS of its quietest 100 ms: where
 * that is a gap in the sound and comes out louder than −50 dBFS once the gain is applied, the take
 * plays its noise floor where it is heard (`floorHeard`) — the run names it with its gain and
 * fails, nothing capped, so that it is made anew. A run that makes nothing measures every file
 * anew, so a rule changed costs nothing.
 *
 * The key is ELEVENLABS_API_KEY in the environment — the package's `sfx` script hands node the
 * repo's .env.local (`--env-file`); this script opens no file for it. Before it asks for anything
 * it reads the account's credits and stops where fewer than MIN_CREDITS are left or the plan would
 * cost a group more than its cap — a dry run stops there too; after a group's first take it says
 * what that cost and prices the rest at that rate, stopping there if it would go over. Requests go
 * one after the other, ELEVEN_GAP_MS apart, a 429 waited out (elevenlabs.ts). A file no entry names
 * is reported, never deleted.
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
import {
  floorOf,
  loudnessOf,
  lufsOf,
  parseWav,
  silenceOf,
  sliceOf,
  wavBytes,
  type Loudness,
  type Pcm,
} from './pcm.ts';
import {
  barMs,
  chunksOf,
  MOTIF_PARTS,
  piecesOf,
  PLAN_LIMITS,
  STYLE_CHARS,
  suiteMs,
  type Piece,
  type PieceOf,
  type SuiteEntry,
  type SuiteSection,
} from './suite.ts';

/**
 * What a sound is: a one-shot, a bed that loops seamlessly, a stem of the music, a sting, or a
 * theme — a piece of music played once through, as an end card's.
 */
export type Kind = 'oneshot' | 'bed' | 'stem' | 'sting' | 'theme';
/**
 * What a sound made on its own is: a one-shot, a bed or a sting. A stem and a theme are sections
 * of a suite, made with it (suite.ts `piecesOf`).
 */
export type SoundKind = 'oneshot' | 'bed' | 'sting';
/** Where a sound is made and kept: the effects (public/sfx/) or the music (public/music/). */
export type Group = 'sfx' | 'music';
export const GROUPS: readonly Group[] = ['sfx', 'music'];

/**
 * The loudness a recording is brought to: its peak or its RMS, in dBFS, or its loudness as
 * BS.1770 measures it (pcm.ts `lufsOf`), in LUFS — a suite's pieces'.
 */
export interface Target {
  readonly measure: 'peak' | 'rms' | 'loudness';
  readonly dbfs: number;
}

/** One sound of the catalog — or a piece of a suite, as the manifests list it. */
export interface CatalogEntry {
  readonly id: string;
  readonly kind: Kind;
  readonly prompt: string;
  readonly durationSeconds: number;
  readonly loop: boolean;
  /** a looped piece of a suite: its suite's tempo, beats a minute; a sound of its own has none */
  readonly bpm?: number;
  readonly target: Target;
  /** where the game plays it: "src/<file>#<symbol>" */
  readonly usedBy: readonly string[];
  /** a piece cut from a suite: the suite, made by its request (suite.ts `piecesOf`) */
  readonly of?: PieceOf;
}

/** What the catalog holds: sounds, each made on its own, and suites, each made as one. */
export type CatalogItem = CatalogEntry | SuiteEntry;

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
  /** a piece of a suite's loudness before the gain, LUFS (pcm.ts `lufsOf`) */
  readonly loudness?: number;
  readonly loop: boolean;
  readonly hash: string;
  /** an effect's prompt influence; PROMPT_INFLUENCE where it is not given */
  readonly influence?: number;
  /** a looped piece of a suite: its suite's tempo, which the music's bars are counted by */
  readonly bpm?: number;
  /** a looped piece of a suite: the bars that go round, which the game loops on */
  readonly bars?: number;
  /** a piece of a suite: the suite it was cut from, by its id */
  readonly suite?: string;
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
 * A piece cut from a suite as afconvert encodes it, bit/s: AAC in an .m4a, about 20 kB a second —
 * as clear as the suite's MP3 at 192 it is cut from, a second encoding that keeps its margin.
 */
export const PIECE_BITRATE = 160_000;
/** How long a piece's edges fade in and out where it is cut from its suite, ms: no cut clicks. */
export const EDGE_MS = 10;
/** How far a take of a suite may run off its plan's length, ms: its sections still as planned. */
export const SUITE_SLACK_MS = 1000;
/**
 * How long a suite's request may take, s: a plan of some 8 minutes takes the service two to four
 * to compose, and the SDK's own 240 s would give up on one it is still composing — and may bill.
 */
export const SUITE_TIMEOUT_S = 900;
/**
 * The loudness a suite's pieces are brought to, every one alike, LUFS: so that no piece jumps
 * against another where the game changes from one to the next — and where the stems and the
 * menu's theme brought to −20 dBFS RMS play today, measured by `lufsOf`: −19.7 to −17.8 LUFS.
 */
export const SUITE_TARGET: Target = { measure: 'loudness', dbfs: -19 };
/** The effects' model, the one that makes a seamless loop. */
export const SFX_MODEL = 'eleven_text_to_sound_v2';
/** The music's model: Eleven Music's newest, the one a composition plan of chunks asks for. */
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
/**
 * The most each group's folder may hold, bytes. The music's: the score's pieces, 491 s of AAC at
 * PIECE_BITRATE — some 10.0 MB as afconvert writes it — and the two stings, 0.5 MB.
 */
export const FOLDER_CAPS: Readonly<Record<Group, number>> = {
  sfx: 3 * 1024 * 1024,
  music: 11 * 1024 * 1024,
};
/** Silence at a recording's start longer than this is skipped, ms. */
export const LEAD_MS = 30;
/**
 * The most a bed may be brought up to its loudness, dB. A take that needs more came back near
 * silent — the facility's hum of 2026-11-13 needed +31 dB, and its one click came up with it as a
 * crack — so it is refused and lands nowhere; the game plays no such bed (samples.ts BED_GAIN_MAX).
 */
export const MAX_BED_GAIN_DB = 12;
const MAX_BED_GAIN = 10 ** (MAX_BED_GAIN_DB / 20);

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

/** The loudness each kind of sound made on its own is brought to. */
export const TARGETS: Readonly<Record<SoundKind, Target>> = {
  oneshot: { measure: 'peak', dbfs: -3 },
  bed: { measure: 'rms', dbfs: -20 },
  sting: { measure: 'rms', dbfs: -14 },
};
/** How long each kind may last, s: ElevenLabs' bounds for an effect; a sting's own. */
export const LENGTHS: Readonly<Record<SoundKind, readonly [number, number]>> = {
  oneshot: [0.5, 30],
  bed: [0.5, 30],
  sting: [8, 12],
};
/** The target and the lengths of a kind, where a sound may be made on its own as it. */
const targetOf = (kind: Kind): Target | undefined =>
  (TARGETS as Partial<Record<Kind, Target>>)[kind];
const lengthsOf = (kind: Kind): readonly [number, number] | undefined =>
  (LENGTHS as Partial<Record<Kind, readonly [number, number]>>)[kind];

// --- the catalog ----------------------------------------------------------------------------

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const USED_BY = /^src\/[\w/.-]+\.tsx?#\w+$/;

/** Each rule an item of the catalog keeps, and what is said where it does not. */
type Rule<T> = readonly [(item: T) => boolean, (item: T) => string];

/** What `item` breaks of `rules`, a sentence each. */
const broken = <T>(rules: readonly Rule<T>[], item: T): string[] =>
  rules.filter(([keeps]) => !keeps(item)).map(([, said]) => said(item));

const usedByKept = (usedBy: unknown): boolean =>
  Array.isArray(usedBy) && usedBy.length > 0 && usedBy.every((u) => USED_BY.test(String(u)));

/** The rules every sound of its own keeps, whatever its kind. */
const RULES: readonly Rule<CatalogEntry>[] = [
  [(e) => ID.test(e.id), () => 'its id is not lower-case words joined by dashes'],
  [
    (e) => targetOf(e.kind) !== undefined,
    (e) =>
      `its kind "${e.kind}" is not ${Object.keys(TARGETS).join(', ')}: a stem or a theme is a ` +
      'section of a suite',
  ],
  [(e) => /^[\x20-\x7e]{40,}$/.test(e.prompt), () => 'its prompt is not 40 chars of English'],
  [
    (e) => usedByKept(e.usedBy),
    () => 'usedBy has to name where it plays, as "src/<file>#<symbol>"',
  ],
  [(e) => e.bpm === undefined, () => "a sound of its own has no bpm: a tempo is its suite's"],
];

/** The rules a sound of its own keeps by its kind, `target` and `lengths` its kind's. */
const kindRules = (
  target: Target,
  [least, most]: readonly [number, number],
): readonly Rule<CatalogEntry>[] => [
  [
    (e) => e.durationSeconds >= least && e.durationSeconds <= most,
    (e) => `it lasts ${e.durationSeconds} s, outside ${least}–${most} s`,
  ],
  [(e) => e.loop === (e.kind === 'bed'), () => 'loop has to be true for a bed, false for the rest'],
  [
    (e) => e.target?.measure === target.measure && e.target.dbfs === target.dbfs,
    () => `its target has to be ${JSON.stringify(target)}`,
  ],
];

/**
 * What is wrong with `entry`, a sentence each; none for an entry that keeps every rule — those of
 * its kind only where its kind is one a sound may be made on its own as.
 */
export function flawsOf(entry: CatalogEntry): string[] {
  const target = targetOf(entry.kind);
  const lengths = lengthsOf(entry.kind);
  const own = target === undefined || lengths === undefined ? [] : kindRules(target, lengths);
  return [...broken(RULES, entry), ...broken(own, entry)];
}

/** Whether `item` is a suite: music made as one, its sections the pieces. */
export const isSuite = (item: Pick<CatalogItem, 'kind'>): item is SuiteEntry =>
  item.kind === 'suite';

/** Whether `text` is a short phrase in English: printable ASCII, 1 to `most` characters. */
function phrase(text: unknown, most: number): boolean {
  if (typeof text !== 'string') return false;
  return text.length > 0 && text.length <= most && /^[\x20-\x7e]+$/.test(text);
}

/** Whether `list` is a list of styles: phrases of STYLE_CHARS at most. */
const styles = (list: unknown): boolean =>
  Array.isArray(list) && list.every((style) => phrase(style, STYLE_CHARS));

/** Whether `motif` is a motif: its cell, fall and answer, each a phrase of STYLE_CHARS at most. */
const motifKept = (motif: unknown): boolean =>
  typeof motif === 'object' &&
  motif !== null &&
  ['cell', 'fall', 'answer'].every((part) => phrase(Reflect.get(motif, part), STYLE_CHARS));

/**
 * A line of a section: a direction in braces („{solo cello answers}"), or a wordless voice's
 * sounds in parentheses („(aah)") — never a lyric.
 */
const LINE = /^(?:\{[^{}]+\}|\([a-z ,-]+\))$/;
const lineKept = (line: unknown): boolean =>
  phrase(line, PLAN_LIMITS.lineChars) && LINE.test(String(line));
const within = (value: number, [least, most]: readonly [number, number]): boolean =>
  value >= least && value <= most;

/** Each rule a suite keeps as a whole. */
const SUITE_RULES: readonly Rule<SuiteEntry>[] = [
  [(s) => ID.test(s.id), () => 'its id is not lower-case words joined by dashes'],
  [(s) => phrase(s.key, 40), () => 'its key is not a short phrase, as "A minor"'],
  [(s) => within(s.bpm, [40, 200]), (s) => `its tempo, ${s.bpm} bpm, lies outside 40–200`],
  [
    (s) => motifKept(s.motif),
    () => `its motif is no cell, fall and answer, each a phrase of ${STYLE_CHARS} chars at most`,
  ],
  [
    (s) => [s.styles, s.avoid].every(styles),
    () => `its styles and avoid are not lists of phrases of ${STYLE_CHARS} chars at most`,
  ],
  [
    (s) => s.target?.measure === SUITE_TARGET.measure && s.target.dbfs === SUITE_TARGET.dbfs,
    () => `its target has to be ${JSON.stringify(SUITE_TARGET)}`,
  ],
  [
    (s) => Array.isArray(s.sections) && within(s.sections.length, [1, PLAN_LIMITS.chunks]),
    () => `it has to have 1 to ${PLAN_LIMITS.chunks} sections`,
  ],
];

/** Each rule a section of a suite keeps. */
const SECTION_RULES: readonly Rule<SuiteSection>[] = [
  [(c) => ID.test(c.id), (c) => `${c.id}: its id is not lower-case words joined by dashes`],
  [
    (c) => phrase(c.name, PLAN_LIMITS.nameChars) && !/[[\]]/.test(c.name),
    (c) => `${c.id}: its name is no phrase of ${PLAN_LIMITS.nameChars} chars without brackets`,
  ],
  [(c) => Number.isInteger(c.bars) && c.bars > 0, (c) => `${c.id}: its bars are no whole number`],
  [(c) => typeof c.loop === 'boolean', (c) => `${c.id}: loop has to be true or false`],
  [(c) => c.key === undefined || phrase(c.key, 40), (c) => `${c.id}: its key is no short phrase`],
  [
    (c) => MOTIF_PARTS.includes(c.motif),
    (c) => `${c.id}: its motif has to be ${MOTIF_PARTS.join(', ')}: how much of it it plays`,
  ],
  [
    (c) => Array.isArray(c.lines) && c.lines.length < PLAN_LIMITS.lines && c.lines.every(lineKept),
    (c) =>
      `${c.id}: a line is neither a direction in braces nor a wordless voice's sounds in ` +
      `parentheses, or there are ${PLAN_LIMITS.lines} lines with its name`,
  ],
  [
    (c) => styles(c.styles) && styles(c.avoid),
    (c) => `${c.id}: its styles and avoid are not lists of phrases of ${STYLE_CHARS} chars at most`,
  ],
  [(c) => usedByKept(c.usedBy), (c) => `${c.id}: usedBy has to name where it plays`],
];

/** Each rule a chunk of the plan keeps, as Eleven Music takes it. */
const CHUNK_RULES: readonly Rule<ElevenLabs.GenerationChunkInput>[] = [
  [
    (c) => within(c.durationMs, PLAN_LIMITS.chunkMs),
    (c) => `${c.text.split('\n')[0] ?? ''} lasts ${c.durationMs} ms, outside 3000–120000`,
  ],
  [
    (c) => c.positiveStyles.length <= PLAN_LIMITS.styles,
    (c) => `${c.text.split('\n')[0] ?? ''} has more than ${PLAN_LIMITS.styles} styles`,
  ],
  [
    (c) => (c.negativeStyles ?? []).length <= PLAN_LIMITS.styles,
    (c) => `${c.text.split('\n')[0] ?? ''} avoids more than ${PLAN_LIMITS.styles} styles`,
  ],
];

/**
 * What is wrong with `suite`, a sentence each: as a whole, then section by section, then its plan
 * chunk by chunk and its length — each only where the one before found nothing.
 */
export function suiteFlawsOf(suite: SuiteEntry): string[] {
  const whole = broken(SUITE_RULES, suite);
  if (whole.length > 0) return whole;
  const sections = suite.sections.flatMap((section) => broken(SECTION_RULES, section));
  if (sections.length > 0) return sections;
  const chunks = chunksOf(suite).flatMap((chunk) => broken(CHUNK_RULES, chunk));
  const ms = suiteMs(suite);
  const lasts = `it lasts ${ms / 1000} s, outside 3–600 s`;
  return within(ms, PLAN_LIMITS.totalMs) ? chunks : [...chunks, lasts];
}

/** The catalog, as it stands in `file`. */
export function readCatalog(file = CATALOG_FILE): CatalogItem[] {
  return JSON.parse(readFileSync(file, 'utf8')) as CatalogItem[];
}

/** Every id an item names: a sound's own, a suite's and each of its sections'. */
const idsOf = (item: CatalogItem): string[] =>
  isSuite(item) && Array.isArray(item.sections)
    ? [item.id, ...item.sections.map((section) => section.id)]
    : [item.id];

/**
 * Returns `catalog` where every item keeps its rules and no id comes twice — a section's among
 * them; fails naming each flaw.
 */
export function checkCatalog(catalog: readonly CatalogItem[]): readonly CatalogItem[] {
  const seen = new Set<string>();
  const twice = (id: string): string[] => {
    const again = seen.has(id);
    seen.add(id);
    return again ? [`${id}: its id comes twice`] : [];
  };
  const flaws = catalog.flatMap((item) => {
    const own = isSuite(item) ? suiteFlawsOf(item) : flawsOf(item);
    return [...own.map((flaw) => `${item.id}: ${flaw}`), ...idsOf(item).flatMap(twice)];
  });
  if (flaws.length > 0) {
    throw new Error(`sfx: audio/catalog.json —\n  ${flaws.join('\n  ')}`);
  }
  return catalog;
}

/** Every recording the catalog names: each sound, and each section of a suite as its piece. */
export function recordingsOf(catalog: readonly CatalogItem[]): CatalogEntry[] {
  return catalog.flatMap((item): CatalogEntry[] => (isSuite(item) ? piecesOf(item) : [item]));
}

/** Where an item is made and kept: a sting, a suite and a suite's pieces with the music. */
export function groupOf(item: Pick<CatalogItem, 'kind'>): Group {
  const music: readonly CatalogItem['kind'][] = ['stem', 'sting', 'theme', 'suite'];
  return music.includes(item.kind) ? 'music' : 'sfx';
}

/** The file an entry is kept in, in its group's folder. */
export function fileOf(id: string): string {
  return `${id}.mp3`;
}

/** The file a piece cut from a suite is kept in, in the music's folder. */
export function pieceFileOf(id: string): string {
  return `${id}.m4a`;
}

/** How long making `item` asks for, s: a sound's length, or a suite's whole plan. */
export function secondsOf(item: CatalogItem): number {
  return isSuite(item) ? suiteMs(item) / 1000 : item.durationSeconds;
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
  readonly outputFormat: typeof MUSIC_FORMAT;
}

/** What Eleven Music is asked for a suite beside its plan: the model, the format, its length. */
export interface SuiteSettings {
  readonly modelId: typeof MUSIC_MODEL;
  readonly outputFormat: typeof MUSIC_FORMAT;
  /** the plan's length, ms: its chunks' */
  readonly planMs: number;
}

/** The settings a piece of music is asked for with: as long as the catalog says, instrumental. */
export function settingsOf(entry: CatalogEntry): MusicSettings {
  return {
    musicLengthMs: Math.round(entry.durationSeconds * 1000),
    forceInstrumental: true,
    modelId: MUSIC_MODEL,
    outputFormat: MUSIC_FORMAT,
  };
}

/** What Eleven Music is asked for a piece: its prompt, with its settings (`settingsOf`). */
export function musicRequest(entry: CatalogEntry): ElevenLabs.BodyComposeMusicV1MusicPost {
  // In this order: the request's JSON is what its hash is taken of.
  const { musicLengthMs, forceInstrumental, modelId, outputFormat } = settingsOf(entry);
  return { prompt: entry.prompt, musicLengthMs, forceInstrumental, modelId, outputFormat };
}

/**
 * What Eleven Music is asked for a suite: its plan, chunk by chunk (suite.ts `chunksOf`), at the
 * music's model and format. No length beside it — the chunks are the length — and no switch for
 * the instrumental, which a plan does not take: its lines hold no lyric (the catalog's rules).
 */
export function suiteRequest(suite: SuiteEntry): ElevenLabs.BodyComposeMusicV1MusicPost {
  // In this order: the request's JSON is what its hash is taken of.
  return {
    compositionPlan: { chunks: chunksOf(suite) },
    modelId: MUSIC_MODEL,
    outputFormat: MUSIC_FORMAT,
  };
}

/** The request that makes `item`: a suite's, a piece's its suite's, an effect's at `influence`. */
function requestOf(item: CatalogItem, influence: number): object {
  if (isSuite(item)) return suiteRequest(item);
  if (item.of !== undefined) return suiteRequest(item.of.suite);
  return groupOf(item) === 'music' ? musicRequest(item) : effectRequest(item, influence);
}

/**
 * The hash of what makes an item — its whole request, an effect's at `influence`, a piece's its
 * suite's: the first 12 hex digits of its SHA-1.
 */
export function hashOf(item: CatalogItem, influence = PROMPT_INFLUENCE): string {
  const request = JSON.stringify(requestOf(item, influence));
  return createHash('sha1').update(request, 'utf8').digest('hex').slice(0, 12);
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

/** What making an item costs, credits: `candidates` takes of it. */
export function costOf(item: CatalogItem, candidates = 1): number {
  return Math.ceil(secondsOf(item) * CREDITS_PER_SECOND[groupOf(item)] * candidates);
}

/** How a request for `item` is sent: a suite's or a piece of music's, or an effect's. */
function sending(
  client: SoundClient,
  item: CatalogItem,
  influence: number | undefined,
): () => PromiseLike<ReadableStream<Uint8Array>> {
  if (isSuite(item)) {
    const options = { timeoutInSeconds: SUITE_TIMEOUT_S };
    return () => client.music.compose(suiteRequest(item), options);
  }
  return groupOf(item) === 'music'
    ? () => client.music.compose(musicRequest(item))
    : () => client.textToSoundEffects.convert(effectRequest(item, influence));
}

/**
 * Asks ElevenLabs for the recording of `item` — an effect, its prompt followed as `influence`
 * says, a piece of music, or a suite — as MP3.
 */
export function make(
  client: SoundClient,
  item: CatalogItem,
  how: { readonly influence?: number; readonly wait?: (ms: number) => Promise<void> } = {},
): Promise<Buffer> {
  const asking = { tag: 'sfx', what: `make ${item.id}` };
  return elevenAudio(sending(client, item, how.influence), asking, how.wait);
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

/** How many takes of `suite` a run makes within the music's cap: one at the least. */
export function takesPerRun(suite: SuiteEntry): number {
  const fit = Math.floor(CAPS.music / costOf(suite));
  return Math.max(1, Math.min(MAX_MUSIC_TAKES, fit));
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

/** An item as a run sees it: its group, whether it has to be made, and why it is left. */
export interface Job {
  readonly entry: CatalogItem;
  readonly group: Group;
  /** new, changed, its file gone, or asked for by --only — and not left */
  readonly make: boolean;
  /**
   * why a run leaves an item that is due as it is: `takes` — a piece of music the run would make
   * once, straight into the project, or a suite --only does not name, while takes of it wait for
   * the ear (for --keep or new takes); `unnamed` — a suite --only does not name, which a run of
   * everything never makes: it costs thousands of credits a take; null where nothing is left
   */
  readonly left: 'takes' | 'unnamed' | null;
}

/** Whether a group's folder holds a file, and whether takes of an entry wait for the ear. */
type Filed = (group: Group, file: string) => boolean;
type Waits = (id: string) => boolean;

/**
 * Why a run leaves `item` of `group`, due to be made, as it is (`Job['left']`): a suite --only
 * does not name, its takes waiting or not; a piece of music the run would make once while takes
 * of it wait (`waits`).
 */
function leftOf(item: CatalogItem, group: Group, options: Options, waits: Waits): Job['left'] {
  if (isSuite(item)) {
    if (options.only !== null) return null;
    return waits(item.id) ? 'takes' : 'unnamed';
  }
  const once = group === 'music' && !asTakes({ entry: item, group }, options.candidates);
  return once && waits(item.id) ? 'takes' : null;
}

/**
 * The job of `item`: made where it is new, changed, gone or named by --only — every piece of a
 * suite made from its request and filed, or it is made — but left as it is where `leftOf` says.
 */
function jobOf(
  item: CatalogItem,
  manifests: Readonly<Record<Group, Manifest>>,
  options: Options,
  disk: { readonly filed: Filed; readonly waits: Waits },
): Job {
  const group = groupOf(item);
  const fresh = recordingsOf([item]).every((entry) => {
    const kept = manifests[group][entry.id];
    return kept !== undefined && upToDate(entry, kept) && disk.filed(group, kept.file);
  });
  const due = options.only !== null || !fresh;
  const left = due ? leftOf(item, group, options, disk.waits) : null;
  return { entry: item, group, make: due && left === null, left };
}

/**
 * Fails where --only names an id the catalog has not — or a section of a suite, which is made
 * with the whole of it.
 */
function refuseUnknown(catalog: readonly CatalogItem[], only: readonly string[]): void {
  const owners = new Map(
    catalog
      .filter(isSuite)
      .flatMap((suite) => suite.sections.map((c): [string, string] => [c.id, suite.id])),
  );
  const sections = only.filter((id) => owners.has(id));
  if (sections.length > 0) {
    const suites = [...new Set(sections.map((id) => owners.get(id)))].join(',');
    throw new Error(
      `sfx: --only ${sections.join(',')} — a section of a suite is made with the whole of it: ` +
        `--only ${suites}`,
    );
  }
  const unknown = only.filter((id) => !catalog.some((item) => item.id === id));
  if (unknown.length > 0) {
    throw new Error(`sfx: --only ${unknown.join(',')} — audio/catalog.json has no such entry`);
  }
}

/**
 * The items a run takes — those of the groups asked for, or those --only names — each with
 * what its group's manifest kept, whether its file is there (`filed`) and whether takes of it
 * wait (`waits`; none, unless told). Fails where it would make a piece of music in more than
 * MAX_MUSIC_TAKES takes.
 */
export function planOf(
  catalog: readonly CatalogItem[],
  manifests: Readonly<Record<Group, Manifest>>,
  filed: Filed,
  options: Options,
  waits: Waits = () => false,
): Job[] {
  const { only } = options;
  refuseUnknown(catalog, only ?? []);
  const chosen =
    only === null
      ? catalog.filter((item) => options.groups.includes(groupOf(item)))
      : catalog.filter((item) => only.includes(item.id));
  const jobs = chosen.map((item) => jobOf(item, manifests, options, { filed, waits }));
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

/**
 * Whether a run makes `job` in takes for the ear: a suite always, a piece of music made more than
 * once.
 */
export function asTakes(job: Pick<Job, 'entry' | 'group'>, count: number): boolean {
  return isSuite(job.entry) || (job.group === 'music' && count > 1);
}

// --- loudness ---------------------------------------------------------------------------------

/** How a recording measures for its gain: its peak, its RMS, and its loudness where taken, LUFS. */
export type Measured = Pick<Loudness, 'peak' | 'rms'> & { readonly lufs?: number };

/** The level of `measured` that `target` brings to its value: its peak, its RMS, its loudness. */
function levelOf(target: Target, measured: Measured): number {
  if (target.measure === 'loudness') return 10 ** ((measured.lufs ?? -Infinity) / 20);
  return target.measure === 'peak' ? measured.peak : measured.rms;
}

/** The linear gain that brings `level` to `target`; null for silence. */
function gainTo(target: Target, level: number): number | null {
  return level > 0 ? Number((10 ** (target.dbfs / 20) / level).toFixed(4)) : null;
}

/** The linear gain that brings a recording measured as `measured` to `target`; fails on silence. */
export function gainOf(target: Target, measured: Measured, id: string): number {
  const gain = gainTo(target, levelOf(target, measured));
  if (gain === null) {
    throw new Error(`sfx: ${id} came back silent — make it again: --only ${id}`);
  }
  return gain;
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

/**
 * Each recording of `catalog` with what `manifests` kept of it — made from its request as it
 * stands: one made from another is to be made anew, and is not held to this request's length or
 * loudness.
 */
function madeNow(
  catalog: readonly CatalogItem[],
  manifests: Readonly<Record<Group, Manifest>>,
): { entry: CatalogEntry; kept: ManifestEntry }[] {
  return recordingsOf(catalog).flatMap((entry) => {
    const kept = manifests[groupOf(entry)][entry.id];
    return kept !== undefined && upToDate(entry, kept) ? [{ entry, kept }] : [];
  });
}

/** The recordings of `catalog` that run more than PICK.length off the length they asked for. */
export function offLength(
  catalog: readonly CatalogItem[],
  manifests: Readonly<Record<Group, Manifest>>,
): OffLength[] {
  return madeNow(catalog, manifests).flatMap(({ entry, kept }) =>
    lengthOff(entry, kept.ms) > PICK.length
      ? [{ id: entry.id, ms: kept.ms, asked: entry.durationSeconds * 1000 }]
      : [],
  );
}

/** The recordings of `catalog` that, as `manifests` measured them, play a floor that is heard. */
export function noisyTakes(
  catalog: readonly CatalogItem[],
  manifests: Readonly<Record<Group, Manifest>>,
): Noisy[] {
  return madeNow(catalog, manifests).flatMap(({ entry, kept }) =>
    floorHeard(kept)
      ? [{ id: entry.id, gain: kept.gain, heardDbfs: Number(heardDbfs(kept).toFixed(1)) }]
      : [],
  );
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
/** Encodes `pcm` into the file at `path`: a piece of a suite, as AAC in an .m4a. */
export type Encode = (pcm: Pcm, path: string) => void;

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

/**
 * Encodes with afconvert, the piece written as a WAV into `scratch` first: AAC in an .m4a at
 * PIECE_BITRATE, at the encoder's best quality.
 */
function afconvertOut(scratch: string): Encode {
  return (pcm, path) => {
    const wav = join(scratch, 'piece.wav');
    writeFileSync(wav, wavBytes(pcm));
    try {
      const aac = ['-f', 'm4af', '-d', 'aac', '-b', String(PIECE_BITRATE), '-q', '127'];
      execFileSync('afconvert', [...aac, wav, path]);
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
function sayTakes(entry: CatalogEntry, takes: readonly Take[], kept: Take | null): void {
  takes.forEach((take, i) => {
    console.log(`${takeLine(entry, take, i + 1)}${take === kept ? '  ← kept' : ''}`);
  });
}

// --- the pieces of a suite --------------------------------------------------------------------

/**
 * A piece cut from its suite as it measures: its loudness — peak, RMS, length and lead, and as
 * BS.1770 has it — its silence, its floor, the gain that brings it to its suite's loudness (null
 * where it came back silent), and where its sound starts: a loop's at its start, its bars kept.
 */
interface PieceMeasure {
  readonly loudness: Loudness;
  readonly lufs: number;
  readonly silence: number;
  readonly floor: number;
  readonly gain: number | null;
  readonly startMs: number;
}

/** Measures `pcm`, the piece `piece` as it was cut or encoded. */
function measurePiece(piece: Piece, pcm: Pcm): PieceMeasure {
  const loudness = loudnessOf(pcm);
  const lufs = lufsOf(pcm);
  return {
    loudness,
    lufs,
    silence: silenceOf(pcm),
    floor: floorOf(pcm),
    gain: gainTo(piece.target, levelOf(piece.target, { ...loudness, lufs })),
    startMs: piece.loop ? 0 : startMsOf(piece.kind, loudness),
  };
}

/**
 * The rules a piece misses: cut short of its span (`length`), more than a tenth of it silent
 * (`silence`), its floor heard once its gain is applied (`floor`).
 */
function pieceMisses(piece: Piece, measure: PieceMeasure): string[] {
  const { gain, floor, loudness } = measure;
  const misses = [
    loudness.ms < piece.durationSeconds * 1000 - SUITE_SLACK_MS && 'length',
    measure.silence > PICK.silence && 'silence',
    gain !== null && floorHeard({ floor, rms: loudness.rms, gain }) && 'floor',
  ];
  return misses.filter((miss): miss is string => typeof miss === 'string');
}

/** A piece of a suite's take as the take's list keeps it: where it lies and how it measures. */
export interface PieceRecord {
  readonly id: string;
  /** where it starts in the take, ms */
  readonly fromMs: number;
  readonly ms: number;
  readonly loop: boolean;
  /** the gain that brings it to its suite's loudness: 1 where it came back silent */
  readonly gain: number;
  readonly startMs: number;
  /** its loudness before the gain, LUFS; null for silence */
  readonly loudness: number | null;
  readonly peak: number;
  readonly rms: number;
  readonly floor: number;
  readonly silence: number;
  readonly misses: readonly string[];
}

/** `piece` of a take as its list keeps it, as `measure` measured it. */
function pieceRecordOf(piece: Piece, measure: PieceMeasure): PieceRecord {
  return {
    id: piece.id,
    fromMs: piece.of.fromMs,
    ms: measure.loudness.ms,
    loop: piece.loop,
    gain: measure.gain ?? 1,
    startMs: measure.startMs,
    loudness: Number.isFinite(measure.lufs) ? Number(measure.lufs.toFixed(2)) : null,
    peak: Number(measure.loudness.peak.toPrecision(3)),
    rms: Number(measure.loudness.rms.toPrecision(3)),
    floor: Number(measure.floor.toPrecision(3)),
    silence: Number(measure.silence.toFixed(3)),
    misses: pieceMisses(piece, measure),
  };
}

/** The manifest's entry for `piece` as `measure` measured it, encoded into its file. */
function pieceEntryOf(piece: Piece, measure: PieceMeasure): ManifestEntry {
  return {
    file: pieceFileOf(piece.id),
    ms: measure.loudness.ms,
    gain: measure.gain ?? 1,
    startMs: measure.startMs,
    floor: Number(measure.floor.toPrecision(3)),
    rms: Number(measure.loudness.rms.toPrecision(3)),
    loudness: Number(measure.lufs.toFixed(2)),
    loop: piece.loop,
    hash: hashOf(piece),
    ...(piece.bpm === undefined ? {} : { bpm: piece.bpm, bars: piece.of.bars }),
    suite: piece.of.suite.id,
    source: 'elevenlabs',
  };
}

/** `piece` cut out of `pcm`, its whole suite's take, where the plan puts it, its edges faded. */
const cutOf = (piece: Piece, pcm: Pcm): Pcm =>
  sliceOf(pcm, piece.of.fromMs, piece.of.fromMs + piece.durationSeconds * 1000, EDGE_MS);

/** A loudness as a line says it: LUFS, or silent. */
const lufsSaid = (lufs: number | null): string =>
  lufs === null ? 'silent' : `${lufs.toFixed(1)} LUFS`;

/** How take `record` of `suite` measured: a line for the whole, one for each of its pieces. */
function suiteTakeLines(suite: SuiteEntry, record: TakeRecord): string[] {
  const planned = (suiteMs(suite) / 1000).toFixed(1);
  const off = record.misses.includes('length') ? ` — misses length: the plan's ${planned} s` : '';
  return [
    `  ${suite.id} take ${record.n}: ${(record.ms / 1000).toFixed(1)} s${off}`,
    ...(record.pieces ?? []).map((piece) => {
      const misses = piece.misses.length > 0 ? ` — misses ${piece.misses.join(', ')}` : '';
      const floor = heardDbfs(piece).toFixed(1);
      return (
        `    ${piece.id}  ${(piece.ms / 1000).toFixed(1)} s, ${lufsSaid(piece.loudness)}, ` +
        `gain ${piece.gain}, floor ${floor} dBFS${misses}`
      );
    }),
  ];
}

// --- the music's takes ------------------------------------------------------------------------

/**
 * One take of a piece of music, as its list keeps it until the ear has chosen: its number and
 * file, the hash of the request it was made from (its prompt and its settings), the settings,
 * when it was made, and how it measures — its length, the gain that brings it to its target, the
 * silence its sound starts after, its peak, RMS and floor before the gain, its share of silence
 * — and the rules of PICK it misses, said and never used to pick. A suite's take measures as a
 * whole and piece by piece, as the plan cuts it; as a whole it misses `length` alone, where it
 * runs more than SUITE_SLACK_MS off its plan.
 */
export interface TakeRecord {
  readonly n: number;
  readonly file: string;
  readonly hash: string;
  readonly settings: MusicSettings | SuiteSettings;
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
  /** a suite's take: each of its pieces, in the plan's order */
  readonly pieces?: readonly PieceRecord[];
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

/**
 * The list of `id`'s takes in `dir`, the folder the takes wait in; null where it has none. A list
 * that does not read as JSON fails, naming its file.
 */
export function readTakes(dir: string, id: string): TakesList | null {
  const file = join(dir, id, TAKES_LIST);
  if (!existsSync(file)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as TakesList;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`sfx: ${file} does not read as a list of takes: ${reason}`);
  }
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

/**
 * Take `n` of `suite`, made at `madeAt` and decoded as `pcm`, as its list keeps it: the whole —
 * its gain to the suite's loudness, `length` missed where it runs off its plan — and each piece
 * cut where the plan puts it, measured as a render would measure it.
 */
function suiteRecordOf(suite: SuiteEntry, n: number, pcm: Pcm, madeAt: Date): TakeRecord {
  const whole = loudnessOf(pcm);
  const lufs = lufsOf(pcm);
  const planMs = suiteMs(suite);
  return {
    n,
    file: takeFile(n),
    hash: hashOf(suite),
    settings: { modelId: MUSIC_MODEL, outputFormat: MUSIC_FORMAT, planMs },
    madeAt: madeAt.toISOString(),
    ms: whole.ms,
    gain: gainTo(suite.target, levelOf(suite.target, { ...whole, lufs })) ?? 1,
    startMs: 0,
    peak: Number(whole.peak.toPrecision(3)),
    rms: Number(whole.rms.toPrecision(3)),
    floor: Number(floorOf(pcm).toPrecision(3)),
    silence: Number(silenceOf(pcm).toFixed(3)),
    misses: Math.abs(whole.ms - planMs) > SUITE_SLACK_MS ? ['length'] : [],
    pieces: piecesOf(suite).map((piece) =>
      pieceRecordOf(piece, measurePiece(piece, cutOf(piece, pcm))),
    ),
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

/**
 * How a plan says the takes it makes of each item of `group`, and what becomes of them: a suite's
 * go into takes/ however many are asked for.
 */
function takesSaid(todo: readonly CatalogItem[], group: Group, candidates: number): string {
  if (candidates <= 1) {
    return todo.some(isSuite) ? ', 1 take each, into takes/ for the ear' : '';
  }
  const kept = group === 'music' ? 'into takes/ for the ear' : 'the best one kept';
  return `, ${candidates} takes each, ${kept}`;
}

/** The script's arguments that make new takes of `item`: a suite's as many as a run may make. */
function remakeArgsOf(item: CatalogItem): string {
  if (!isSuite(item)) return remakeArgs(groupOf(item), [item.id]);
  return `--candidates ${takesPerRun(item)} --only ${item.id}`;
}

/**
 * What a plan says of an item it leaves as it is: while its takes wait, the two ways on; a suite
 * not named, the command that makes its takes.
 */
function leftLine(job: Job): string {
  const { id } = job.entry;
  if (job.left === 'unnamed') {
    return (
      `sfx: ${id} is made only where --only names it, never by a run of everything: ` +
      `${remakeArgsOf(job.entry)} makes its takes`
    );
  }
  return (
    `sfx: ${id} is left as it is, its takes waiting: --keep ${id}=<n> keeps one, ` +
    `${remakeArgsOf(job.entry)} makes new ones`
  );
}

/** What a plan says of `item` it makes: a line, and a suite's a line for each of its pieces. */
function itemLines(item: CatalogItem): string[] {
  if (!isSuite(item)) return [`  ${item.id}  ${item.durationSeconds} s  ${item.kind}`];
  const whole = `${(suiteMs(item) / 1000).toFixed(1)} s`;
  const bar = barMs(item.bpm);
  return [
    `  ${item.id}  ${whole}  suite, ${item.key}, ${item.bpm} bpm, ${item.sections.length} pieces`,
    ...piecesOf(item).map((piece) => {
      const bars = Math.round((piece.durationSeconds * 1000) / bar);
      const round = piece.loop ? `, ${piece.of.bars} of them round and round` : ', once';
      return `    ${piece.id}  ${piece.durationSeconds.toFixed(1)} s  ${bars} bars${round}`;
    }),
  ];
}

/**
 * What the run will make, group by group, and what that costs at the rates measured, every take
 * counted: a line for each group, one for each item it makes — a suite's pieces besides — and one
 * for each it leaves for its takes.
 */
export function planLines(jobs: readonly Job[], candidates: number): string[] {
  return GROUPS.flatMap((group) => {
    const mine = jobs.filter((job) => job.group === group);
    const todo = mine.filter((job) => job.make).map((job) => job.entry);
    if (mine.length === 0) return [];
    const seconds = todo.reduce((sum, item) => sum + secondsOf(item), 0);
    const credits = todo.reduce((sum, item) => sum + costOf(item, candidates), 0);
    const each = candidates > 1 ? ' a take' : '';
    return [
      `sfx: ${group} — ${todo.length} of ${mine.length} to make` +
        `${takesSaid(todo, group, candidates)}, ` +
        `${seconds.toFixed(1)} s${each}, about ${credits} credits (cap ${CAPS[group]})`,
      ...todo.flatMap(itemLines),
      ...mine.filter((job) => job.left !== null).map(leftLine),
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
  /**
   * told each time a take has landed — in takes/, or a job's in the project — with the seconds of
   * music or effect it asked for: the first prices the rest of its group (`renderGroup`)
   */
  readonly took?: (seconds: number) => Promise<void>;
}

/**
 * What a run works with: the account's client, the folders it reads and writes, how it decodes
 * a recording to measure it and encodes a piece of a suite, the clock its takes are dated by,
 * and how it waits between requests.
 */
export interface Bench {
  readonly client: SoundClient;
  readonly places: Places;
  readonly decode: Decode;
  readonly encode: Encode;
  readonly now: () => Date;
  readonly wait: (ms: number) => Promise<void>;
}

const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Whether `take` of `entry` may be kept: a bed's only where it needs no more than +12 dB. */
const keepable = (entry: CatalogEntry, take: Take): boolean =>
  entry.kind !== 'bed' || take.gain <= MAX_BED_GAIN;

/**
 * Says, in one line, that every take of the bed `entry` came back too quiet to be brought up to
 * its level within MAX_BED_GAIN_DB, that none is kept, and what makes it again; the run fails.
 */
function refuseQuiet(entry: CatalogEntry, takes: readonly Take[]): void {
  const least = (20 * Math.log10(Math.min(...takes.map((take) => take.gain)))).toFixed(1);
  console.error(
    `sfx: ${entry.id} — a bed may be brought up ${MAX_BED_GAIN_DB} dB and every take needs ` +
      `more (the least +${least} dB): it came back near silent, none kept; make it again: ` +
      remakeArgs('sfx', [entry.id]),
  );
  process.exitCode = 1;
}

/**
 * Makes `entry` of `group` into the project: once, into a part beside its file, or as `count`
 * takes into the candidates' folder, an effect's each at its influence; each measured, the
 * candidates said, and of those that may be kept (`keepable`) the one `pickTake` picks put into
 * the project. Returns the manifest's entry for what it kept — null, said in a line, where every
 * take of a bed came back too quiet (`refuseQuiet`): then nothing of it lands in the project.
 */
async function renderJob(
  entry: CatalogEntry,
  group: Group,
  making: Making,
  bench: Bench,
): Promise<ManifestEntry | null> {
  const target = join(bench.places.dirs[group], fileOf(entry.id));
  const influences = influencesFor(group === 'music' ? 1 : making.count);
  const single = influences.length === 1;
  const makeTake = (influence: number, i: number) => async (): Promise<Take> => {
    const path = single ? `${target}.part` : join(making.candidates, `${entry.id}-${i + 1}.mp3`);
    writeFileSync(path, await make(bench.client, entry, { influence, wait: bench.wait }));
    return takeAt(entry, path, influence, bench.decode);
  };
  try {
    const takes = await oneByOne(influences.map(makeTake), ELEVEN_GAP_MS, bench.wait);
    const fit = takes.filter((take) => keepable(entry, take));
    const kept = fit.length > 0 ? pickTake(fit) : null;
    if (!single) sayTakes(entry, takes, kept);
    if (kept === null) {
      refuseQuiet(entry, takes);
      return null;
    }
    copyFileSync(kept.path, target);
    return entryOf(entry, { ...kept, path: target });
  } finally {
    rmSync(`${target}.part`, { force: true });
  }
}

/** Take `n` of `item` at `path`, measured and said, as its list keeps it. */
function recordAt(item: CatalogItem, n: number, path: string, bench: Bench): TakeRecord {
  if (isSuite(item)) {
    const record = suiteRecordOf(item, n, bench.decode(path), bench.now());
    for (const line of suiteTakeLines(item, record)) console.log(line);
    return record;
  }
  const take = takeAt(item, path, PROMPT_INFLUENCE, bench.decode);
  console.log(takeLine(item, take, n));
  return recordOf(item, n, take, bench.now());
}

/**
 * Makes `count` takes of the piece of music or the suite `item` into its folder under the takes'
 * — each by the same request, numbered on from those already there, measured, said and listed
 * as it comes, so that a run cut short keeps every take it paid for, and `took` told of it — and
 * keeps none of them in the project: the ear chooses. Returns its list, the takes made before
 * included.
 */
export async function makeTakes(
  item: CatalogItem,
  count: number,
  bench: Bench,
  took?: Making['took'],
): Promise<TakesList> {
  const dir = join(bench.places.takes, item.id);
  mkdirSync(dir, { recursive: true });
  let list: TakesList = readTakes(bench.places.takes, item.id) ?? { id: item.id, takes: [] };
  const first = Math.max(0, ...list.takes.map((take) => take.n)) + 1;
  const makeOne = (n: number) => async (): Promise<void> => {
    const path = join(dir, takeFile(n));
    writeFileSync(path, await make(bench.client, item, { wait: bench.wait }));
    list = { id: item.id, takes: [...list.takes, recordAt(item, n, path, bench)] };
    writeTakes(bench.places.takes, list);
    await took?.(secondsOf(item));
  };
  const numbers = Array.from({ length: count }, (_, i) => first + i);
  await oneByOne(numbers.map(makeOne), ELEVEN_GAP_MS, bench.wait);
  return list;
}

/**
 * Makes `job`: a suite, or a piece of music made more than once, in takes for the ear
 * (`asTakes`); anything else into the project, its entry written into its group's manifest as
 * it comes — and tells `making.took` of every take as it lands.
 */
async function makeJob(job: Job, manifest: Manifest, making: Making, bench: Bench): Promise<void> {
  const { entry, group } = job;
  if (isSuite(entry) || asTakes(job, making.count)) {
    await makeTakes(entry, making.count, bench, making.took);
    return;
  }
  mkdirSync(bench.places.dirs[group], { recursive: true });
  const kept = await renderJob(entry, group, making, bench);
  if (kept !== null) {
    manifest[entry.id] = kept;
    writeManifest(bench.places, group, manifest);
    console.log(`sfx: ${entry.id} ${(kept.ms / 1000).toFixed(1)} s, gain ${kept.gain}`);
  }
  const takes = group === 'music' ? 1 : making.count;
  await making.took?.(secondsOf(entry) * takes);
}

/**
 * Reads what a group's first take cost off the account — `before` it the credits left, `seconds`
 * of music or effect asked for — and prices what the group's `jobs` ask for besides at that rate;
 * over the group's cap, the run stops there, the take it paid for kept.
 */
async function priceTheRest(
  jobs: readonly Job[],
  seconds: number,
  before: number,
  making: Making,
  client: SoundClient,
): Promise<void> {
  const [first] = jobs;
  if (first === undefined) return;
  const { group } = first;
  const spent = before - (await creditsLeft(client));
  const all = jobs.reduce((sum, job) => sum + secondsOf(job.entry) * making.count, 0);
  const price = priced(spent, seconds, all - seconds, group);
  const expected = Math.ceil(seconds * CREDITS_PER_SECOND[group]);
  console.log(
    `sfx: the first take of ${first.entry.id} cost ${spent} credits ` +
      `(${price.perSecond.toFixed(1)} a second, ${expected} expected); the ${group} come to ` +
      `about ${price.total}`,
  );
  if (price.over) {
    throw new Error(`sfx: that is over the ${CAPS[group]} the ${group} may spend`);
  }
}

/**
 * Makes a group's `jobs` one after the other; once its first take has landed — the first of a
 * suite's takes, before the next is asked for — its cost is read off the account and the rest
 * priced at that rate (`priceTheRest`). Returns what the group spent.
 */
async function renderGroup(
  jobs: readonly Job[],
  manifest: Manifest,
  making: Making,
  bench: Bench,
): Promise<number> {
  const before = await creditsLeft(bench.client);
  let metered = false;
  const took = async (seconds: number): Promise<void> => {
    if (metered) return;
    metered = true;
    await priceTheRest(jobs, seconds, before, making, bench.client);
  };
  const tasks = jobs.map((job) => () => makeJob(job, manifest, { ...making, took }, bench));
  await oneByOne(tasks, ELEVEN_GAP_MS, bench.wait);
  return before - (await creditsLeft(bench.client));
}

/**
 * Fails where `jobs` would cost `group` more than its cap: a suite's takes said in runs within
 * it, as many as a run may make, the next run's numbered on.
 */
function refuseOverCap(jobs: readonly Job[], group: Group, count: number): void {
  const cost = jobs.reduce((sum, job) => sum + costOf(job.entry, count), 0);
  if (cost <= CAPS[group]) return;
  const runs = jobs
    .map((job) => job.entry)
    .filter(isSuite)
    .map((suite) => `${remakeArgsOf(suite)}, and again for more, numbered on`);
  const advice = runs.length > 0 ? ` — make a suite's takes in runs within it: ${runs}` : '';
  const over = `the ${group} would cost about ${cost} credits, over ${CAPS[group]}`;
  throw new Error(`sfx: ${over}${advice}`);
}

/** Fails where `jobs`, `count` takes of each, would cost any group more than its cap. */
function refuseOverCaps(jobs: readonly Job[], count: number): void {
  for (const group of GROUPS) {
    refuseOverCap(
      jobs.filter((job) => job.group === group),
      group,
      count,
    );
  }
}

/**
 * Makes every job of `todo` through `bench`, group by group, within the credits and the caps:
 * an effect, or a piece of music made once, into the project; a suite, or a piece of music made
 * in takes, into the takes' folder.
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
  refuseOverCaps(todo, making.count);
  for (const group of GROUPS) {
    const jobs = todo.filter((job) => job.group === group);
    if (jobs.length === 0) continue;
    const spent = await renderGroup(jobs, manifests[group], making, bench);
    console.log(`sfx: the ${group} spent ${spent} credits`);
  }
  console.log(`sfx: ${await creditsLeft(bench.client)} credits left`);
}

/** The account the environment's key opens; fails, saying how to run the script, without one. */
async function openAccount(): Promise<SoundClient> {
  requireKey();
  return elevenClient();
}

// --- keeping a take ---------------------------------------------------------------------------

/** Whether every recording `item` makes is kept in `places`, made from its request as it stands. */
function keptIn(item: CatalogItem, places: Places): boolean {
  const group = groupOf(item);
  const manifest = readManifest(places, group);
  return recordingsOf([item]).every((entry) => {
    const kept = manifest[entry.id];
    return kept !== undefined && upToDate(entry, kept) && filedIn(places)(group, kept.file);
  });
}

/**
 * Why `item` has no takes to keep in `places`: what it makes is kept already — the request as
 * it stands made it, a keep or a render — it is an effect, or none was made; and what makes some.
 */
function noTakes(item: CatalogItem, places: Places): string {
  const group = groupOf(item);
  if (keptIn(item, places)) {
    const kept = readManifest(places, group)[item.id]?.file;
    const where =
      kept === undefined ? `its pieces in public/${group}` : `as public/${group}/${kept}`;
    return `${item.id} is kept already, ${where}, and no takes of it wait`;
  }
  return group === 'music'
    ? `${item.id} has no takes; make some: ${remakeArgsOf(item)}`
    : `${item.id} is an effect, whose best take a run keeps itself: none waits for the ear`;
}

/** Fails, saying it as `asked`, where `keep` names a piece of a suite: a suite is kept whole. */
function refusePiece(keep: Keep, catalog: readonly CatalogItem[], asked: string): void {
  const owner = catalog
    .filter(isSuite)
    .find((suite) => suite.sections.some((section) => section.id === keep.id));
  if (owner !== undefined) {
    const whole = `--keep ${owner.id}=<n>`;
    throw new Error(`${asked} — ${keep.id} is a piece of ${owner.id}, kept whole: ${whole}`);
  }
}

/** The item and the take `keep` names in `places`; fails, in one line, where there is none. */
function takeToKeep(
  keep: Keep,
  catalog: readonly CatalogItem[],
  places: Places,
): { entry: CatalogItem; record: TakeRecord } {
  const { takes } = places;
  const asked = `sfx: --keep ${keep.id}=${keep.n}`;
  refusePiece(keep, catalog, asked);
  const entry = catalog.find((each) => each.id === keep.id);
  if (entry === undefined) throw new Error(`${asked} — audio/catalog.json has no such entry`);
  const made = readTakes(takes, keep.id)?.takes ?? [];
  if (made.length === 0) throw new Error(`${asked} — ${noTakes(entry, places)}`);
  const record = made.find((take) => take.n === keep.n);
  if (record === undefined) {
    const numbers = made.map((take) => take.n).join(', ');
    throw new Error(`${asked} — ${keep.id} has takes ${numbers}, and no take ${keep.n}`);
  }
  if (record.hash !== hashOf(entry)) {
    const again = remakeArgsOf(entry);
    throw new Error(`${asked} — it was made from another request than the catalog's: ${again}`);
  }
  if (!existsSync(join(takes, keep.id, record.file))) {
    throw new Error(`${asked} — its file ${keep.id}/${record.file} is gone from ${takes}`);
  }
  return { entry, record };
}

/** What a keep works with: the folders, and how it decodes a recording and encodes a piece. */
export type Keeping = Pick<Bench, 'places' | 'decode' | 'encode'>;

/**
 * Keeps take `record` of the piece `entry`: measures it as a run measures what it makes, puts it
 * into its group's folder as the entry's file and writes its entry into the group's manifest.
 */
function keepOne(entry: CatalogEntry, record: TakeRecord, bench: Keeping): Manifest {
  const { places } = bench;
  const from = join(places.takes, entry.id, record.file);
  const take = takeAt(entry, from, PROMPT_INFLUENCE, bench.decode);
  const group = groupOf(entry);
  const target = join(places.dirs[group], fileOf(entry.id));
  mkdirSync(places.dirs[group], { recursive: true });
  copyFileSync(from, `${target}.part`);
  renameSync(`${target}.part`, target);
  const kept = entryOf(entry, { ...take, path: target });
  writeManifest(places, group, { ...readManifest(places, group), [entry.id]: kept });
  return { [entry.id]: kept };
}

/** A piece cut and encoded into the music's folder as a part, and how it measures as encoded. */
interface Cut {
  readonly piece: Piece;
  readonly part: string;
  readonly measure: PieceMeasure;
}

/**
 * The pieces of the suite's take at `path`, cut where the plan puts them, faded at their edges,
 * encoded into the music's folder each as a part of its own, and measured as encoded; a failure
 * takes every part back before it goes on.
 */
function cutPieces(suite: SuiteEntry, path: string, bench: Keeping): Cut[] {
  const pcm = bench.decode(path);
  const dir = bench.places.dirs.music;
  mkdirSync(dir, { recursive: true });
  const parts: string[] = [];
  try {
    return piecesOf(suite).map((piece) => {
      const part = join(dir, `${piece.id}.part.m4a`);
      parts.push(part);
      bench.encode(cutOf(piece, pcm), part);
      return { piece, part, measure: measurePiece(piece, bench.decode(part)) };
    });
  } catch (error) {
    for (const part of parts) rmSync(part, { force: true });
    throw error;
  }
}

/**
 * The files `kept` replaces in the music's folder: those `before` named for the same pieces,
 * where they are other files and no other entry names them.
 */
function replacedBy(kept: Manifest, before: Manifest): string[] {
  const others = Object.entries(before).filter(([id]) => kept[id] === undefined);
  const named = new Set(others.map(([, entry]) => entry.file));
  return Object.entries(kept).flatMap(([id, entry]) => {
    const old = before[id]?.file;
    return old === undefined || old === entry.file || named.has(old) ? [] : [old];
  });
}

/**
 * Keeps take `record` of `suite` whole: refused, before anything moves, where it runs off its
 * plan or a piece of it came back silent; else every piece cut where the plan puts it, encoded
 * into the music's folder, measured as a render and listed in the manifest — and only then the
 * files the pieces played before deleted, so that the manifest never names a file gone.
 */
function keepSuite(suite: SuiteEntry, record: TakeRecord, bench: Keeping): Manifest {
  const asked = `sfx: --keep ${suite.id}=${record.n}`;
  if (record.misses.includes('length')) {
    const plan = (suiteMs(suite) / 1000).toFixed(1);
    const lasts = `it lasts ${(record.ms / 1000).toFixed(1)} s, not the plan's ${plan} s`;
    throw new Error(`${asked} — ${lasts}: its pieces would not lie where the plan puts them`);
  }
  const cut = cutPieces(suite, join(bench.places.takes, suite.id, record.file), bench);
  const silent = cut.filter(({ measure }) => measure.gain === null).map(({ piece }) => piece.id);
  if (silent.length > 0) {
    for (const { part } of cut) rmSync(part, { force: true });
    throw new Error(`${asked} — ${silent.join(', ')} came back silent: keep another take`);
  }
  const dir = bench.places.dirs.music;
  const kept: Manifest = {};
  for (const { piece, part, measure } of cut) {
    renameSync(part, join(dir, pieceFileOf(piece.id)));
    kept[piece.id] = pieceEntryOf(piece, measure);
  }
  const before = readManifest(bench.places, 'music');
  const replaced = replacedBy(kept, before);
  writeManifest(bench.places, 'music', { ...before, ...kept });
  for (const file of replaced) rmSync(join(dir, file), { force: true });
  return kept;
}

/**
 * Keeps take `keep.n` of `keep.id`, as `--keep <id>=<n>` asks: a piece of music's into its
 * group's folder as the entry's file (`keepOne`), a suite's whole, cut into its pieces
 * (`keepSuite`), each measured as a run measures what it makes and written into the manifest —
 * and deletes the item's folder of takes, the other takes and their list with it. Fails in one
 * line, before anything moves, where the catalog has no such item or names a piece of a suite,
 * it has no takes or no take of that number, or the take was made from a request other than the
 * catalog's. Returns the group and the manifest's entries it wrote.
 */
export function keepTake(
  keep: Keep,
  catalog: readonly CatalogItem[],
  bench: Keeping,
): { group: Group; kept: Manifest } {
  const { entry, record } = takeToKeep(keep, catalog, bench.places);
  const kept = isSuite(entry) ? keepSuite(entry, record, bench) : keepOne(entry, record, bench);
  rmSync(join(bench.places.takes, entry.id), { recursive: true, force: true });
  return { group: groupOf(entry), kept };
}

/** What a run says of the take `keep` it kept, as `keepTake` put it into the project. */
function keptLine(keep: Keep, { group, kept }: { group: Group; kept: Manifest }): string {
  const entries = Object.values(kept);
  const [one] = entries;
  const what =
    entries.length === 1 && one !== undefined
      ? `public/${group}/${one.file} now, ${(one.ms / 1000).toFixed(1)} s, gain ${one.gain}`
      : `cut into ${entries.map((entry) => entry.file).join(', ')} in public/${group} now`;
  return (
    `sfx: take ${keep.n} of ${keep.id} is ${what}; its other takes are deleted — ` +
    'reload /sounds to hear it as the game plays it'
  );
}

/**
 * Says which recordings play a floor that is heard (`noisyTakes`), each with its gain and its
 * floor, and which run off their length (`offLength`), and the command that makes them again;
 * any such fails the run. Nothing is capped or hidden.
 */
function warnTakes(
  catalog: readonly CatalogItem[],
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
  const ids = [...new Set([...noisy, ...off].map(({ id }) => id))];
  if (ids.length === 0) return;
  sayRemedy(catalog, ids);
  process.exitCode = 1;
}

/** Says, group by group, what makes the recordings `ids` again. */
function sayRemedy(catalog: readonly CatalogItem[], ids: readonly string[]): void {
  for (const group of GROUPS) {
    const args = remakesIn(catalog, ids, group);
    if (args.length === 0) continue;
    const what =
      group === 'sfx' ? 'the best take kept' : 'their takes left to the ear, one kept by --keep';
    console.error(`sfx: make them again, ${what}: ${args.join('; ')}`);
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

/**
 * The script's arguments that make the recordings `ids` of `group` again, in the catalog's order:
 * its sounds' in one (`remakeArgs`), and those of each suite a piece of which they name — as many
 * takes as a run of it may make.
 */
function remakesIn(
  catalog: readonly CatalogItem[],
  ids: readonly string[],
  group: Group,
): string[] {
  const named = (item: CatalogItem): boolean => idsOf(item).some((id) => ids.includes(id));
  const mine = catalog.filter((item) => named(item) && groupOf(item) === group);
  const sounds = mine.filter((item) => !isSuite(item)).map((item) => item.id);
  return [
    ...(sounds.length === 0 ? [] : [remakeArgs(group, sounds)]),
    ...mine.filter(isSuite).map(remakeArgsOf),
  ];
}

/**
 * The commands that make the recordings `ids` of `catalog` again, one for each group's sounds
 * they fall in and one for each suite whose pieces they name: the script told `remakesIn`.
 */
export function remakeCommands(catalog: readonly CatalogItem[], ids: readonly string[]): string[] {
  return GROUPS.flatMap((group) =>
    remakesIn(catalog, ids, group).map((args) => `pnpm --filter client sfx -- ${args}`),
  );
}

/** Says what each folder holds against its cap, and any file no entry names; over a cap fails. */
function report(manifests: Readonly<Record<Group, Manifest>>, places: Places): void {
  for (const group of GROUPS) {
    const dir = places.dirs[group];
    if (!existsSync(dir)) continue;
    const named = new Set(Object.values(manifests[group]).map((entry) => entry.file));
    const files = readdirSync(dir).filter((name) => /\.(?:mp3|m4a)$/.test(name));
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
 * The jobs whose files a run measures anew: every one it took, but a piece of music or a suite
 * it made in takes or left as it is (`Job['left']`), whose files in the project — and their
 * manifest's entries with them, made perhaps from an older request — stay as they were.
 */
export function measuredAnew(jobs: readonly Job[], count: number): Job[] {
  return jobs.filter((job) => job.left === null && !(job.make && asTakes(job, count)));
}

/** What `job` measures anew in `places`: each file of its own it finds, by its entry's id. */
function remeasured(
  job: Job,
  manifests: Record<Group, Manifest>,
  places: Places,
  decode: Decode,
): [string, ManifestEntry][] {
  const dir = places.dirs[job.group];
  const { entry } = job;
  if (isSuite(entry)) {
    return piecesOf(entry).flatMap((piece): [string, ManifestEntry][] => {
      const file = manifests.music[piece.id]?.file;
      if (file === undefined || !existsSync(join(dir, file))) return [];
      return [[piece.id, pieceEntryOf(piece, measurePiece(piece, decode(join(dir, file))))]];
    });
  }
  const path = join(dir, fileOf(entry.id));
  if (!existsSync(path)) return [];
  const influence = manifests[job.group][entry.id]?.influence ?? PROMPT_INFLUENCE;
  return [[entry.id, entryOf(entry, takeAt(entry, path, influence, decode))]];
}

/** Measures every file the run took anew, an effect's kept at the influence it was made at. */
function remeasure(
  jobs: readonly Job[],
  manifests: Record<Group, Manifest>,
  places: Places,
  decode: Decode,
): void {
  for (const job of jobs) {
    for (const [id, entry] of remeasured(job, manifests, places, decode)) {
      manifests[job.group][id] = entry;
    }
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
 * What a run works in and with besides the account's client: the folders, how it decodes a
 * recording and encodes a piece, the clock and the pause between requests (as a `Bench`), a
 * folder for an effect's candidates, made as it is wanted, and the account — opened only once the
 * run has something to make, so that a plan, a keep or a run that makes nothing needs no key.
 */
export interface Studio extends Omit<Bench, 'client'> {
  readonly candidates: () => string;
  readonly account: () => Promise<SoundClient>;
}

/** Both manifests in `places`, as they stand. */
const manifestsIn = (places: Places): Record<Group, Manifest> => ({
  sfx: readManifest(places, 'sfx'),
  music: readManifest(places, 'music'),
});

/** Whether takes of the entry `id` wait in `places` for the ear. */
const takesWaitIn =
  (places: Places) =>
  (id: string): boolean =>
    (readTakes(places.takes, id)?.takes.length ?? 0) > 0;

/**
 * Makes what `jobs` ask for, `count` takes of each — the account opened only where there is
 * something to make — measures anew what the run took (`measuredAnew`) and says where an effect's
 * candidates and the music's takes lie.
 */
async function makePlan(
  jobs: readonly Job[],
  manifests: Record<Group, Manifest>,
  count: number,
  studio: Studio,
): Promise<void> {
  const { places, decode, encode, now, wait } = studio;
  const todo = jobs.filter((job) => job.make);
  const inTakes = todo.filter((job) => asTakes(job, count));
  const many = count > 1 && todo.length > inTakes.length;
  if (todo.length > 0) {
    const candidates = many ? studio.candidates() : '';
    const bench = { client: await studio.account(), places, decode, encode, now, wait };
    await renderWith(todo, manifests, { count, candidates }, bench);
    if (many) console.log(`sfx: every candidate lies in ${candidates}`);
  }
  remeasure(measuredAnew(jobs, count), manifests, places, decode);
  for (const line of takesLines(inTakes.map((job) => job.entry.id), places)) console.log(line);
}

/**
 * Runs the script as `options` ask, in and with `studio`: keeps the take `--keep` names, or plans
 * what to make — a piece of music whose takes wait left as it is — says the plan and makes it
 * (`makePlan`), where a dry run only refuses what passes a cap, as a run would; then says what the
 * folders hold and names every recording that would fail the game's.
 */
export async function runWith(
  options: Options,
  catalog: readonly CatalogItem[],
  studio: Studio,
): Promise<void> {
  const { places } = studio;
  if (options.keep === null) {
    const manifests = manifestsIn(places);
    const jobs = planOf(catalog, manifests, filedIn(places), options, takesWaitIn(places));
    for (const line of planLines(jobs, options.candidates)) console.log(line);
    if (options.dryRun) refuseOverCaps(jobs.filter((job) => job.make), options.candidates);
    else await makePlan(jobs, manifests, options.candidates, studio);
  } else {
    console.log(keptLine(options.keep, keepTake(options.keep, catalog, studio)));
  }
  const manifests = manifestsIn(places);
  if (!options.dryRun) report(manifests, places);
  warnTakes(catalog, manifests);
}

async function main(options: Options): Promise<void> {
  const catalog = checkCatalog(readCatalog());
  if (!options.dryRun) requireTools();
  const scratch = mkdtempSync(join(tmpdir(), 'escapelab-sfx-'));
  try {
    await runWith(options, catalog, {
      places: PLACES,
      decode: afconvertIn(scratch),
      encode: afconvertOut(scratch),
      now: () => new Date(),
      wait: pause,
      candidates: () => mkdtempSync(join(tmpdir(), 'escapelab-sfx-candidates-')),
      account: openAccount,
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve()
    .then(() => main(optionsOf(process.argv.slice(2))))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}

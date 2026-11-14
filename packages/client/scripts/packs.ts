/**
 * The music packs the player picks in the settings (docs/sound.md „Musikpakete"), built from
 * found music under Creative Commons:
 *
 *   pnpm --filter @escapelab/client packs                    every pack of the plan
 *   pnpm --filter @escapelab/client packs -- --dry-run        what it would fetch, and from where
 *   pnpm --filter @escapelab/client packs -- --only macleod   that pack alone (a list: a,b)
 *
 * audio/packs.plan.json names each pack — its id, its name in the world's voice, its composers —
 * and for each of the music's eight places (src/world/packFile.ts SLOTS) one piece: where its file
 * lies — a URL on one of the hosts the plan may name (HOSTS), or a file the owner downloads by hand
 * into takes/packs/<pack>/ where a host serves none without a browser — the page its licence was
 * read on, its title, its author, the licence as that page states it and the page's notice, the
 * span of the file the game plays, how a looped piece goes round and notes on its gain. The script
 * fetches every file once into takes/packs/ (git ignores it), with Node's fetch and no credentials,
 * a redirect to the host's own store followed; decodes it with afconvert; cuts the span out, its
 * edges faded over EDGE_MS; finds a loop's seam where its two sides sound most alike, within the
 * plan's reach (seam.ts); encodes the piece as AAC at PACK_BITRATE into
 * public/music/packs/<pack>/<slot>.m4a and measures it as encoded — its length, where its sound
 * starts, its loudness as BS.1770 has it (pcm.ts `lufsOf`) and the gain that brings it to the
 * score's −19 LUFS (sfx.ts SUITE_TARGET); and writes audio/packs/<pack>/pack.json, the attribution
 * each licence wants with every piece, and prints the attribution block. A pack is built whole or
 * not at all: its pieces are encoded as parts, then moved in together; a pack that misses a piece —
 * a fetch that failed, a manual file not there yet, a rule the plan breaks — or passes PACK_CAP is
 * said with what to do, and the run goes on with the next and fails at its end. Nothing is ever
 * skipped in silence, and nothing here asks a paid service for anything.
 *
 * The game's own score is the pack `nachtschicht`, which the sound script keeps (sfx.ts
 * `--keep score=<n>`); its pack.json names the music's manifest and is not built here.
 *
 * Runs on Node's own TypeScript, as the sound script does: it imports nothing of the app but the
 * pack format (src/world/packFile.ts), which imports nothing.
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  crossfadeFlaws,
  crossfadePeriod,
  EDITED,
  LICENCE_DEEDS,
  LICENCES,
  LOOP_SECONDS,
  ONCE_SECONDS,
  playedOnce,
  SLOTS,
  type Crossfade,
  type FoundPiece,
  type Licence,
  type Loop,
  type PackFile,
  type Slot,
} from '../src/world/packFile.ts';
import {
  afconvertIn,
  afconvertOut,
  requireAfconvert,
  type Decode,
  type Encode,
} from './afconvert.ts';
import { loudnessOf, lufsOf, sliceOf, type Pcm } from './pcm.ts';
import { bestSeam, featuresOf } from './seam.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The hosts a plan may fetch from: the sources the scouts checked, none behind a login. */
export const HOSTS = [
  'opengameart.org',
  'files.freemusicarchive.org',
  'freemusicarchive.org',
  'incompetech.com',
  'huggingface.co',
  'clement-panchout.itch.io',
] as const;

/** A piece as afconvert encodes it, bit/s: AAC at 16 kB a second. */
export const PACK_BITRATE = 128_000;
/** How long a cut's edges fade in and out, ms: no cut clicks (sfx.ts EDGE_MS). */
export const EDGE_MS = 10;
/** The loudness every piece is brought to, LUFS: the score's (sfx.ts SUITE_TARGET). */
export const TARGET_LUFS = -19;
/** Silence at a piece's start longer than this is skipped where it plays once, ms (sfx.ts). */
export const LEAD_MS = 30;
/** What a looped piece keeps past its loop's end, ms: its last pass fades out within it. */
export const TAIL_MS = 500;
/** The most a pack's eight files may take together, bytes: some 9 MB. */
export const PACK_CAP = 9 * 1024 * 1024;

/** Where a piece's file comes from: a URL on one of HOSTS, or a file downloaded by hand. */
export type Source =
  | { readonly url: string }
  | {
      /** where the owner puts it, under takes/packs/ */
      readonly manual: string;
      /** where the owner downloads it */
      readonly from: string;
    };

/** How a planned piece loops, ms of its file: a crossfade, its end sought within `seekMs`; bars. */
export type PlanLoop =
  | {
      readonly crossfade: readonly [startMs: number, endMs: number, fadeMs: number];
      readonly seekMs?: number;
    }
  | { readonly bars: { readonly bpm: number; readonly count: number } };

/** A piece as the plan names it: times in ms of its file. */
export interface PlanPiece {
  readonly source: Source;
  /** the page its licence was read on, the attribution's source */
  readonly page: string;
  readonly title: string;
  readonly author: string;
  readonly licence: Licence;
  /** the attribution the page asks for, word for word */
  readonly notice?: string;
  /** the span of its file the game plays */
  readonly trim: readonly [fromMs: number, toMs: number];
  readonly loop?: PlanLoop;
  /** how its gain comes about, and anything else worth knowing of it */
  readonly notes?: string;
}

/** A pack as the plan names it. */
export interface PlanPack {
  readonly id: string;
  readonly title: string;
  readonly composers: readonly string[];
  readonly pieces: Readonly<Record<Slot, PlanPiece>>;
}

export interface Plan {
  readonly packs: readonly PlanPack[];
}

/** Where the script reads and writes. */
export interface Places {
  /** audio/packs.plan.json */
  readonly plan: string;
  /** audio/packs/: each pack's pack.json in a folder of its own */
  readonly packs: string;
  /** public/music/packs/: each pack's files in a folder of its own */
  readonly music: string;
  /** takes/packs/: the fetched files, and each pack's downloads by hand in a folder of its own */
  readonly takes: string;
}

export const PLACES: Places = {
  plan: resolve(HERE, '../audio/packs.plan.json'),
  packs: resolve(HERE, '../audio/packs'),
  music: resolve(HERE, '../public/music/packs'),
  takes: resolve(HERE, '../takes/packs'),
};

/** What a run works with: its folders, how it fetches, decodes and encodes. */
export interface Bench {
  readonly places: Places;
  readonly get: (url: string) => Promise<Response>;
  readonly decode: Decode;
  readonly encode: Encode;
}

export interface Options {
  readonly dryRun: boolean;
  /** the packs to build; every one of the plan where empty */
  readonly only: readonly string[];
}

/** The options `args` give: --dry-run, --only a,b. */
export function optionsOf(args: readonly string[]): Options {
  const only: string[] = [];
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--only') only.push(...(args[++i] ?? '').split(',').filter(Boolean));
    else throw new Error(`packs: no such option ${arg ?? ''} — --dry-run, --only <pack,…>`);
  }
  return { dryRun, only };
}

// --- the plan -------------------------------------------------------------------------------

/** The plan at `file`; fails, naming it, where it does not read as JSON. */
export function readPlan(file: string): Plan {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Plan;
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    throw new Error(`packs: ${file} does not read as a plan: ${why}`);
  }
}

/** Whether `url` is an https address on one of HOSTS. */
export function allowedUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && (HOSTS as readonly string[]).includes(hostname);
  } catch {
    return false;
  }
}

/** Whether `ms` (a span's length) lies within `[least, most]` seconds. */
const within = (ms: number, [least, most]: readonly [number, number]): boolean =>
  ms >= least * 1000 && ms <= most * 1000;

/** A loop the plan gives as a crossfade. */
type PlanCrossfade = Extract<PlanLoop, { crossfade: unknown }>;

/** A planned crossfade in the piece's own time: its file's span starts at `fromMs`. */
function pieceCrossfade(loop: PlanCrossfade, fromMs: number): Crossfade {
  const [startMs, endMs, fadeMs] = loop.crossfade;
  return { startMs: startMs - fromMs, endMs: endMs - fromMs, fadeMs };
}

/** What breaks a piece played once: a length off 30–45 s, or a loop. */
function onceFlaws(piece: PlanPiece): string[] {
  const length = piece.trim[1] - piece.trim[0];
  const flaws = within(length, ONCE_SECONDS) ? [] : [`it lasts ${length} ms, not 30–45 s`];
  return piece.loop === undefined ? flaws : [...flaws, 'it loops, and it plays once'];
}

/** What breaks a loop on bars: a round off 60–120 s. */
function barsFlaws({ bpm, count }: { bpm: number; count: number }): string[] {
  const period = count * (60 / bpm) * 4 * 1000;
  return within(period, LOOP_SECONDS) ? [] : [`its bars go round in ${period} ms, not 60–120 s`];
}

/**
 * What breaks a crossfade planned in the span `trim`: a round off 60–120 s anywhere within its
 * reach, and what breaks the crossfade itself (packFile.ts `crossfadeFlaws`).
 */
function crossfadeLoopFlaws(loop: PlanCrossfade, trim: PlanPiece['trim']): string[] {
  const fade = pieceCrossfade(loop, trim[0]);
  const reach = loop.seekMs ?? 0;
  const period = crossfadePeriod(fade) * 1000;
  const round = within(period - reach, LOOP_SECONDS) && within(period + reach, LOOP_SECONDS);
  const flaws = round ? [] : [`it goes round in ${period} ± ${reach} ms, not 60–120 s`];
  return [...flaws, ...crossfadeFlaws(fade, trim[1] - trim[0])];
}

/** What breaks `piece`'s loop, planned for `slot`: none on a piece played once, one on the rest. */
function loopFlaws(slot: Slot, piece: PlanPiece): string[] {
  if (playedOnce(slot)) return onceFlaws(piece);
  const { loop } = piece;
  if (loop === undefined) return ['it has no loop'];
  return 'bars' in loop ? barsFlaws(loop.bars) : crossfadeLoopFlaws(loop, piece.trim);
}

/** One rule a planned piece keeps: whether it does, and what is said where it does not. */
type Rule = readonly [keeps: (piece: PlanPiece) => boolean, said: (piece: PlanPiece) => string];

/** The address a piece is fetched from, or where it is downloaded by hand. */
const whereFrom = (piece: PlanPiece): string =>
  'url' in piece.source ? piece.source.url : piece.source.manual;

/** The rules of a piece's source, page, licence and span. */
const SOURCE_RULES: readonly Rule[] = [
  [
    (piece) => LICENCES.includes(piece.licence),
    (piece) => `its licence ${piece.licence} is none of ${LICENCES.join(', ')}`,
  ],
  [(piece) => piece.page.startsWith('https://'), () => 'its page is no https address'],
  [
    (piece) => !('url' in piece.source) || allowedUrl(piece.source.url),
    (piece) => `${whereFrom(piece)} is on none of ${HOSTS.join(', ')}`,
  ],
  [
    (piece) => 'url' in piece.source || !piece.source.manual.includes('..'),
    (piece) => `${whereFrom(piece)} lies outside takes/packs/`,
  ],
  [(piece) => piece.title.trim() !== '', () => 'it has no title'],
  [(piece) => piece.author.trim() !== '', () => 'it has no author'],
  [(piece) => piece.trim[0] >= 0 && piece.trim[1] > piece.trim[0], () => 'its span is empty'],
];

/** What `piece`, planned for `slot`, breaks of the rules, a sentence each. */
export function pieceFlaws(slot: Slot, piece: PlanPiece): string[] {
  const broken = SOURCE_RULES.filter(([keeps]) => !keeps(piece)).map(([, said]) => said(piece));
  return [...broken, ...loopFlaws(slot, piece)];
}

/** Every rule `pack` breaks, a line each, naming the place. */
export function packFlaws(pack: PlanPack): string[] {
  const named = /^[a-z][a-z0-9-]*$/.test(pack.id) ? [] : [`${pack.id}: its id is no plain word`];
  const titled = pack.title.trim() === '' ? [`${pack.id}: it has no title`] : [];
  const pieces = SLOTS.flatMap((slot) => {
    const piece = pack.pieces[slot] as PlanPiece | undefined;
    if (piece === undefined) return [`${pack.id}/${slot}: no piece`];
    return pieceFlaws(slot, piece).map((flaw) => `${pack.id}/${slot}: ${flaw}`);
  });
  return [...named, ...titled, ...pieces];
}

/** The packs of `plan` that `only` names — every one where it names none; fails on a stranger. */
export function packsAsked(plan: Plan, only: readonly string[]): PlanPack[] {
  const unknown = only.filter((id) => !plan.packs.some((pack) => pack.id === id));
  if (unknown.length > 0) {
    const known = plan.packs.map((pack) => pack.id).join(', ');
    throw new Error(`packs: the plan has no pack ${unknown.join(', ')} — it has ${known}`);
  }
  return plan.packs.filter((pack) => only.length === 0 || only.includes(pack.id));
}

// --- the attribution ------------------------------------------------------------------------

/**
 * The attribution `piece` carries, as its licence wants it: its title and author with the page's
 * notice, the page it came from, the licence's name and deed, and that the game edited it.
 */
export function attributionOf(piece: PlanPiece): string {
  const deed = LICENCE_DEEDS[piece.licence];
  const notice = piece.notice === undefined ? '' : ` (${piece.notice})`;
  return [
    `„${piece.title}“ – ${piece.author}${notice}`,
    piece.page,
    `${deed.name}: ${deed.url}`,
    EDITED,
  ].join(' · ');
}

/** The attribution block of `pack` as the script prints it and docs/sound.md keeps it. */
export function attributionBlock(pack: PackFile): string[] {
  return [
    `${pack.title} (${pack.id}) — ${pack.composers.join(', ')}`,
    ...SLOTS.map((slot) => `- ${slot}: ${pack.pieces[slot].attribution}`),
  ];
}

// --- fetching -------------------------------------------------------------------------------

/** The file a URL's download is kept as: the start of its hash, and its own name made plain. */
export function sourceFile(url: string): string {
  const name = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? 'file');
  const plain = name.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '');
  return `${createHash('sha1').update(url).digest('hex').slice(0, 10)}-${plain}`;
}

/** Where `source` lies once it is had, under `takes`. */
export function sourcePath(source: Source, takes: string): string {
  return 'url' in source ? join(takes, sourceFile(source.url)) : join(takes, source.manual);
}

/** What a piece's source came to: its path, or why there is none. */
type Had = { readonly path: string; readonly fetched: boolean } | { readonly missing: string };

/**
 * `source` once, under `takes`: a file fetched before is not fetched again; a fetch that fails
 * says why; a file downloaded by hand is looked for where the plan puts it.
 */
export async function haveSource(source: Source, takes: string, get: Bench['get']): Promise<Had> {
  const path = sourcePath(source, takes);
  if (existsSync(path)) return { path, fetched: false };
  if ('manual' in source) {
    const folder = dirname(source.manual);
    return { missing: `manual: download ${source.from} by hand into takes/packs/${folder}/` };
  }
  const response = await get(source.url).catch((error: unknown) => error);
  if (!(response instanceof Response) || !response.ok) {
    const why = response instanceof Response ? `HTTP ${response.status}` : String(response);
    return { missing: `${source.url} could not be fetched (${why})` };
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.part`, new Uint8Array(await response.arrayBuffer()));
  renameSync(`${path}.part`, path);
  return { path, fetched: true };
}

// --- building a piece -----------------------------------------------------------------------

/** How a piece measured once encoded, and how it loops. */
export interface Built {
  readonly piece: FoundPiece;
  /** where its part lies until the pack moves in */
  readonly part: string;
  /** how alike a crossfade's two sides sound, as seam.ts scores it; null without one */
  readonly seam: number | null;
}

/** `piece`'s loop in its own time: a crossfade with its seam found, or bars; null played once. */
function loopOf(piece: PlanPiece, cut: Pcm): { loop: Loop | null; seam: number | null } {
  const { loop } = piece;
  if (loop === undefined) return { loop: null, seam: null };
  if ('bars' in loop) return { loop: { bars: loop.bars }, seam: null };
  const planned = pieceCrossfade(loop, piece.trim[0]);
  const found = bestSeam(featuresOf(cut), planned, loop.seekMs ?? 0);
  if (!Number.isFinite(found.score)) {
    throw new Error(`its seam at ${planned.endMs} ms finds no music past it to compare`);
  }
  const { startMs, endMs, fadeMs } = found;
  return { loop: { crossfade: { startMs, endMs, fadeMs } }, seam: found.score };
}

/** How long the encoded piece keeps of `cut`: a crossfade's file ends TAIL_MS past its loop. */
function keptMs(loop: Loop | null, cutMs: number): number {
  return loop !== null && 'crossfade' in loop
    ? Math.min(cutMs, loop.crossfade.endMs + TAIL_MS)
    : cutMs;
}

/** The gain that brings a loudness of `lufs` to TARGET_LUFS; fails on silence. */
export function gainTo(lufs: number): number {
  if (!Number.isFinite(lufs)) throw new Error('it came back silent');
  return Number((10 ** ((TARGET_LUFS - lufs) / 20)).toFixed(4));
}

/**
 * `plan`'s piece for `slot` from its decoded file `pcm`: its span cut out, its seam found, encoded
 * into `part` and measured as encoded.
 */
export function buildPiece(
  slot: Slot,
  plan: PlanPiece,
  pcm: Pcm,
  part: string,
  bench: Bench,
): Built {
  const cut = sliceOf(pcm, plan.trim[0], plan.trim[1], EDGE_MS);
  const { loop, seam } = loopOf(plan, cut);
  bench.encode(sliceOf(cut, 0, keptMs(loop, loudnessOf(cut).ms), EDGE_MS), part);
  const encoded = bench.decode(part);
  const measured = loudnessOf(encoded);
  const loudness = lufsOf(encoded);
  const startMs = loop === null && measured.leadMs > LEAD_MS ? Math.floor(measured.leadMs) : 0;
  const piece: FoundPiece = {
    title: plan.title,
    author: plan.author,
    source: plan.page,
    licence: plan.licence,
    attribution: attributionOf(plan),
    file: `${slot}.m4a`,
    ms: measured.ms,
    startMs,
    loudness: Number(loudness.toFixed(2)),
    gain: gainTo(loudness),
    loop,
  };
  return { piece, part, seam };
}

// --- building a pack ------------------------------------------------------------------------

/** A pack built: its pack.json, the bytes its files take, and how alike each seam sounds. */
export interface Made {
  readonly id: string;
  readonly built: PackFile;
  readonly bytes: number;
  readonly seams: Readonly<Partial<Record<Slot, number>>>;
}

/** A pack as a run left it: built, or refused with why, a line each. */
export type Outcome = Made | { readonly id: string; readonly refused: readonly string[] };

/** Each piece's source of `pack`, had once, by its place; and a line for each one missing. */
async function sourcesOf(
  pack: PlanPack,
  bench: Bench,
): Promise<{ paths: Map<Slot, string>; missing: string[] }> {
  const paths = new Map<Slot, string>();
  const missing: string[] = [];
  for (const slot of SLOTS) {
    const had = await haveSource(pack.pieces[slot].source, bench.places.takes, bench.get);
    if ('missing' in had) missing.push(`${pack.id}/${slot}: ${had.missing}`);
    else paths.set(slot, had.path);
  }
  return { paths, missing };
}

/** `pack`'s piece for `slot` decoded from `path` and built into a part in `dir`, or why not. */
function partOf(pack: PlanPack, slot: Slot, path: string, dir: string, bench: Bench): Built {
  const part = join(dir, `${slot}.part.m4a`);
  try {
    return buildPiece(slot, pack.pieces[slot], bench.decode(path), part, bench);
  } catch (error) {
    rmSync(part, { force: true });
    const why = error instanceof Error ? error.message : String(error);
    throw new Error(`${pack.id}/${slot}: ${why}`);
  }
}

/** Every piece of `pack` built as a part into `dir`; a failure takes every part back. */
function partsOf(
  pack: PlanPack,
  paths: ReadonlyMap<Slot, string>,
  dir: string,
  bench: Bench,
): Built[] {
  const built: Built[] = [];
  try {
    for (const slot of SLOTS) built.push(partOf(pack, slot, paths.get(slot) ?? '', dir, bench));
    return built;
  } catch (error) {
    for (const { part } of built) rmSync(part, { force: true });
    throw error;
  }
}

/** The pack.json of `pack` with its pieces as `built` measured them. */
function packFileOf(pack: PlanPack, built: readonly Built[]): PackFile {
  const pieces = Object.fromEntries(
    SLOTS.map((slot, i) => [slot, (built[i] as Built).piece]),
  ) as Record<Slot, FoundPiece>;
  return { id: pack.id, title: pack.title, composers: pack.composers, pieces };
}

/** The bytes the files at `paths` take. */
const bytesOf = (paths: readonly string[]): number =>
  paths.reduce((sum, path) => sum + statSync(path).size, 0);

/**
 * `pack` built whole: every source had once, every piece cut, encoded and measured as a part,
 * then — within PACK_CAP — moved in together and its pack.json written; else refused, the parts
 * taken back and nothing of the pack changed.
 */
export async function buildPack(pack: PlanPack, bench: Bench): Promise<Outcome> {
  const flaws = packFlaws(pack);
  if (flaws.length > 0) return { id: pack.id, refused: flaws };
  const { paths, missing } = await sourcesOf(pack, bench);
  if (missing.length > 0) return { id: pack.id, refused: missing };
  const dir = join(bench.places.music, pack.id);
  mkdirSync(dir, { recursive: true });
  let built: Built[];
  try {
    built = partsOf(pack, paths, dir, bench);
  } catch (error) {
    return { id: pack.id, refused: [error instanceof Error ? error.message : String(error)] };
  }
  const bytes = bytesOf(built.map(({ part }) => part));
  if (bytes > PACK_CAP) {
    for (const { part } of built) rmSync(part, { force: true });
    const mb = (bytes / 1024 / 1024).toFixed(1);
    return { id: pack.id, refused: [`${pack.id}: ${mb} MB, over its 9 MB — shorten its loops`] };
  }
  for (const { part, piece } of built) renameSync(part, join(dir, piece.file));
  const file = packFileOf(pack, built);
  const home = join(bench.places.packs, pack.id);
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'pack.json'), `${JSON.stringify(file, null, 2)}\n`);
  const seams = Object.fromEntries(
    built.flatMap(({ seam }, i) => (seam === null ? [] : [[SLOTS[i], seam]])),
  );
  return { id: pack.id, built: file, bytes, seams };
}

// --- what a run says ------------------------------------------------------------------------

/** A gain as dB, to a tenth, signed. */
const db = (gain: number): string => {
  const level = 20 * Math.log10(gain);
  return `${level >= 0 ? '+' : ''}${level.toFixed(1)} dB`;
};

/** A time as seconds, to a hundredth. */
const seconds = (ms: number): string => (ms / 1000).toFixed(2);

/** How a found loop goes round, in a few words: once, its bars, or its crossfade and seam. */
function loopSaid(loop: Loop | null, seam: number | undefined): string {
  if (loop === null) return 'once';
  if ('bars' in loop) return `${loop.bars.count} bars at ${loop.bars.bpm} bpm`;
  const { startMs, endMs, fadeMs } = loop.crossfade;
  const scored = seam === undefined ? '' : `, seam ${seam}`;
  return `round ${seconds(startMs)}–${seconds(endMs)} s over ${fadeMs} ms${scored}`;
}

/** What a run says of a piece it built for `slot`: its credit, length, level and loop. */
function pieceLine(slot: Slot, piece: FoundPiece, seam: number | undefined): string {
  const credit = `„${piece.title}“ ${piece.author} (${piece.licence})`;
  const level = `${piece.loudness.toFixed(1)} LUFS, gain ${db(piece.gain)}`;
  return `  ${slot}  ${credit}: ${seconds(piece.ms)} s, ${level}, ${loopSaid(piece.loop, seam)}`;
}

/** What a run says of a pack it built: a line each piece, and its size. */
export function builtLines({ built, bytes, seams }: Made): string[] {
  const kb = (bytes / 1024).toFixed(0);
  return [
    `packs: ${built.id} built, ${kb} kB in public/music/packs/${built.id}/`,
    ...SLOTS.map((slot) => pieceLine(slot, built.pieces[slot] as FoundPiece, seams[slot])),
  ];
}

/** What a dry run says of `pack`: each piece's source, its host, and whether it is had already. */
export function dryLines(pack: PlanPack, takes: string): string[] {
  return [
    `packs: ${pack.id} — ${pack.title}`,
    ...SLOTS.map((slot) => {
      const { source } = pack.pieces[slot];
      const had = existsSync(sourcePath(source, takes));
      if ('manual' in source) {
        const state = had ? 'there' : 'missing';
        return `  ${slot}  manual (${state}): takes/packs/${source.manual} from ${source.from}`;
      }
      const host = new URL(source.url).hostname;
      return `  ${slot}  ${had ? 'fetched before' : 'to fetch'} from ${host}: ${source.url}`;
    }),
  ];
}

/**
 * Runs the script as `options` ask with `bench`: a dry run says each asked pack's sources and the
 * rules it breaks; a run builds each asked pack (`buildPack`), says what each came to and its
 * attribution block, and fails at its end where any was refused.
 */
export async function runWith(options: Options, plan: Plan, bench: Bench): Promise<Outcome[]> {
  const asked = packsAsked(plan, options.only);
  if (options.dryRun) {
    for (const pack of asked) {
      const lines = [...dryLines(pack, bench.places.takes), ...packFlaws(pack)];
      for (const line of lines) console.log(line);
    }
    if (asked.some((pack) => packFlaws(pack).length > 0)) process.exitCode = 1;
    return [];
  }
  const outcomes: Outcome[] = [];
  for (const pack of asked) {
    const outcome = await buildPack(pack, bench);
    outcomes.push(outcome);
    sayOutcome(outcome);
  }
  return outcomes;
}

/** Says what became of a pack: built, with its pieces and its attribution block; or refused. */
function sayOutcome(outcome: Outcome): void {
  if ('built' in outcome) {
    for (const line of [...builtLines(outcome), ...attributionBlock(outcome.built)]) {
      console.log(line);
    }
    return;
  }
  console.error(`packs: ${outcome.id} not built:`);
  for (const line of outcome.refused) console.error(`  ${line}`);
  process.exitCode = 1;
}

async function main(options: Options): Promise<void> {
  const plan = readPlan(PLACES.plan);
  if (!options.dryRun) requireAfconvert('packs');
  const scratch = mkdtempSync(join(tmpdir(), 'escapelab-packs-'));
  try {
    await runWith(options, plan, {
      places: PLACES,
      get: (url) => fetch(url, { credentials: 'omit', redirect: 'follow' }),
      decode: afconvertIn(scratch),
      encode: afconvertOut(scratch, PACK_BITRATE),
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

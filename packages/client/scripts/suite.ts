/**
 * A suite: one generation of Eleven Music in named sections — a composition plan whose sections
 * share a key, a tempo and a motif by construction — cut into the pieces the game plays
 * (docs/sound.md „Score"). The catalog writes a suite once (audio/catalog.json, kind `suite`):
 * its key, its tempo, the motif in a composer's words, the styles every section shares and those
 * none may have, and its sections, each with its bars, whether it loops, its lines and its own
 * styles. This module reads that shape: where each section lies in the generation (`spansOf`),
 * the chunks of the plan Eleven Music is asked for (`chunksOf`), and each section as the piece it
 * makes, an entry of its own as the manifests list it (`piecesOf`). Its rules are the catalog's,
 * in sfx.ts. Pure.
 *
 * A loop's section is planned with a tail past the bars that go round (`tailBars`): the bar the
 * game catches a next pass up in, the bars its seam crosses in, and a spare second (music.ts
 * SEAM_LEAD_BARS and SEAM_S, as LEAD_BARS and SEAM_S here) — so that a pass always crosses from
 * sound of its own section, never from the next one's. The slice keeps the tail; the manifest
 * names the loop's bars, which the game loops on.
 *
 * Runs on Node's own TypeScript, as the sound script does: it imports nothing of the app.
 */
import type { ElevenLabs } from '@elevenlabs/elevenlabs-js';
import type { CatalogEntry, Target } from './sfx.ts';

/** One section of a suite: a piece the game plays, as the catalog writes it. */
export interface SuiteSection {
  /** the piece's id, as the game plays it (samples.ts MUSIC_IDS) */
  readonly id: string;
  /** its name in the plan, in square brackets before its lines */
  readonly name: string;
  /** how many bars it lasts; a loop's: the bars that go round, its tail besides */
  readonly bars: number;
  readonly loop: boolean;
  /** a key of its own, where it leaves the suite's */
  readonly key?: string;
  /** its lines: directions in braces, a wordless voice's sounds in parentheses; no lyrics */
  readonly lines: readonly string[];
  readonly styles: readonly string[];
  readonly avoid: readonly string[];
  /** where the game plays it: "src/<file>#<symbol>" */
  readonly usedBy: readonly string[];
}

/** A suite: one generation of Eleven Music, its sections the pieces the game plays. */
export interface SuiteEntry {
  readonly id: string;
  readonly kind: 'suite';
  readonly key: string;
  /** its tempo, beats a minute, in bars of BEATS_PER_BAR */
  readonly bpm: number;
  /** the motif in a composer's words, given to every section */
  readonly motif: readonly string[];
  /** what every section shares: the genre, the instruments, the mood */
  readonly styles: readonly string[];
  /** what no section may have */
  readonly avoid: readonly string[];
  /** the loudness every piece is brought to */
  readonly target: Target;
  readonly sections: readonly SuiteSection[];
}

/** What makes a piece a section of its suite: the suite, its loop's bars, where it starts. */
export interface PieceOf {
  readonly suite: SuiteEntry;
  /** the bars that go round, for a loop; its whole length's, for a piece played once */
  readonly bars: number;
  /** where it starts in the generation, ms */
  readonly fromMs: number;
}

/** A section of a suite as the piece it makes: an entry of its own, made with its suite. */
export type Piece = CatalogEntry & { readonly of: PieceOf };

/** What Eleven Music takes of a plan (docs: composition plans for music_v2 and music_v2_5). */
export const PLAN_LIMITS = {
  /** chunks in a plan */
  chunks: 30,
  /** a chunk's length, ms */
  chunkMs: [3_000, 120_000],
  /** the whole generation's, ms */
  totalMs: [3_000, 600_000],
  /** styles to have, and to avoid, in a chunk */
  styles: 50,
  /** lines of a chunk's text, its section's name among them */
  lines: 30,
  /** characters in a line; in a section's name */
  lineChars: 200,
  nameChars: 100,
} as const;

/** A style kept short, as Eleven Music's own plans write them: our rule, not the API's. */
export const STYLE_CHARS = 120;

/** A bar of the music, beats (music.ts BEATS_PER_BAR). */
export const BEATS_PER_BAR = 4;
/** The game's seam between two passes of a loop, s, and the bars a pass leads it by (music.ts). */
export const SEAM_S = 3;
export const LEAD_BARS = 1;
/** What a loop's tail holds past its lead bar and its seam, at the least, s. */
export const SPARE_S = 1;

/** A bar at `bpm`, ms. */
export function barMs(bpm: number): number {
  return (60_000 / bpm) * BEATS_PER_BAR;
}

/**
 * The bars a loop's section runs past those that go round: the bar a next pass is caught up in,
 * and as many as its seam and a spare second take — three at 90 bpm.
 */
export function tailBars(bpm: number): number {
  return LEAD_BARS + Math.ceil(((SEAM_S + SPARE_S) * 1000) / barMs(bpm));
}

/** The bars `section` is planned with: a loop's with its tail. */
export function plannedBars(section: SuiteSection, bpm: number): number {
  return section.bars + (section.loop ? tailBars(bpm) : 0);
}

/** Where a section lies in its suite's generation: from and to, ms, on bar lines. */
export interface Span {
  readonly section: SuiteSection;
  readonly fromMs: number;
  readonly toMs: number;
}

/**
 * Each section of `suite` where it lies in the generation, one after the other: every one starts
 * on a bar line of the suite's tempo — whole bars from the first — rounded to the millisecond as
 * the plan asks in milliseconds, so that no rounding adds up.
 */
export function spansOf(suite: SuiteEntry): Span[] {
  const bar = barMs(suite.bpm);
  let bars = 0;
  return suite.sections.map((section) => {
    const fromMs = Math.round(bars * bar);
    bars += plannedBars(section, suite.bpm);
    return { section, fromMs, toMs: Math.round(bars * bar) };
  });
}

/** How long the whole generation of `suite` lasts, ms. */
export function suiteMs(suite: SuiteEntry): number {
  return spansOf(suite).at(-1)?.toMs ?? 0;
}

/**
 * What every section of `suite` is given besides its own styles: its key — a section's own where
 * it has one — the tempo and the bar, the motif, and the suite's styles.
 */
function sharedStyles(suite: SuiteEntry, section: SuiteSection): string[] {
  const tempo = [`${suite.bpm} BPM`, `${BEATS_PER_BAR}/4 time`];
  return [section.key ?? suite.key, ...tempo, ...suite.motif, ...suite.styles];
}

/**
 * The plan's chunks for `suite`, one a section, in its order: the section's name in brackets and
 * its lines as its text, its length as `spansOf` lays it, its own styles first — what it is — and
 * then those the suite gives every section (`sharedStyles`), what it avoids after the suite's.
 */
export function chunksOf(suite: SuiteEntry): ElevenLabs.GenerationChunkInput[] {
  return spansOf(suite).map(({ section, fromMs, toMs }) => ({
    text: [`[${section.name}]`, ...section.lines].join('\n'),
    durationMs: toMs - fromMs,
    positiveStyles: [...section.styles, ...sharedStyles(suite, section)],
    negativeStyles: [...suite.avoid, ...section.avoid],
  }));
}

/**
 * Each section of `suite` as the piece it makes, an entry as the manifests list it: a loop's a
 * stem of the music at the suite's tempo, a piece played once a theme; as long as its span, its
 * prompt its name and its styles, its loudness the suite's, played where its section says; made
 * with its suite, by its request (`of`).
 */
export function piecesOf(suite: SuiteEntry): Piece[] {
  return spansOf(suite).map(({ section, fromMs, toMs }) => ({
    id: section.id,
    kind: section.loop ? 'stem' : 'theme',
    prompt: `${section.name}: ${section.styles.join(', ')}`,
    durationSeconds: (toMs - fromMs) / 1000,
    loop: section.loop,
    ...(section.loop ? { bpm: suite.bpm } : {}),
    target: suite.target,
    usedBy: section.usedBy,
    of: { suite, bars: section.bars, fromMs },
  }));
}

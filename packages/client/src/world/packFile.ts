/**
 * packFile.ts: a music pack as audio/packs/<id>/pack.json holds it (docs/sound.md „Musikpakete") —
 * the format the pack script writes (scripts/packs.ts) and the game reads (musicPacks.ts). A pack
 * names itself in the world's voice, its composers, and one piece for each of the music's eight
 * places: a piece found and built by the script — its file in public/music/packs/<id>/, how long it
 * lasts, the gain that brings it to the score's loudness, where its sound starts and how it loops —
 * or a piece of the game's own score, played as the music's manifest lists it (scripts/sfx.ts).
 * Every piece carries its credit: its title, its author, the page it came from, its licence and the
 * attribution as that licence wants it. Pure data and its rules: nothing here is imported, so that
 * the script, which runs on Node's own TypeScript, loads it as it is.
 */

/** The places a pack fills, by the music's ids for them (samples.ts MUSIC_IDS, the score's). */
export const SLOTS = [
  'menu-theme',
  'lobby',
  'title',
  'calm',
  'tense',
  'critical',
  'end-won',
  'end-lost',
] as const;
export type Slot = (typeof SLOTS)[number];

/** The places a piece plays once through and never round: the opening's title and the endings. */
export const ONCE: readonly Slot[] = ['title', 'end-won', 'end-lost'];

/** Whether the piece of `slot` plays once and never loops. */
export const playedOnce = (slot: Slot): boolean => ONCE.includes(slot);

/** The licences a found piece may carry in the repository: none forbids passing its file on. */
export const LICENCES = ['CC0', 'CC BY 3.0', 'CC BY 4.0'] as const;
export type Licence = (typeof LICENCES)[number];

/** Each licence's name and the deed every attribution links. */
export const LICENCE_DEEDS: Readonly<Record<Licence, { name: string; url: string }>> = {
  CC0: {
    name: 'CC0 1.0 Universal',
    url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  },
  'CC BY 3.0': {
    name: 'Creative Commons Attribution 3.0',
    url: 'https://creativecommons.org/licenses/by/3.0/',
  },
  'CC BY 4.0': {
    name: 'Creative Commons Attribution 4.0 International',
    url: 'https://creativecommons.org/licenses/by/4.0/',
  },
};

/** What every attribution says the game did to a piece, as CC BY asks a change to be marked. */
export const EDITED = 'bearbeitet: Schnitt, Schleife, Pegel';

/**
 * A loop by crossfade, for found music whose bars nobody knows, ms in the piece: a pass plays on
 * from the piece's start, and from `endMs − fadeMs` to `endMs` it goes out on an equal-power curve
 * while the next pass, started silent from the piece's start, comes in from `startMs` over the same
 * `fadeMs` — the music under the seam lies `endMs − fadeMs − startMs` apart in the two passes.
 */
export interface Crossfade {
  readonly startMs: number;
  readonly endMs: number;
  readonly fadeMs: number;
}

/** A loop on bars, as the score's pieces loop: `count` bars at `bpm` go round (music.ts). */
export interface Bars {
  readonly bpm: number;
  readonly count: number;
}

/** How a found piece loops: by crossfade, or on bars. */
export type Loop = { readonly crossfade: Crossfade } | { readonly bars: Bars };

/** The shortest crossfade a loop may have, ms: a seam heard as a breath, not a cut. */
export const MIN_FADE_MS = 1500;
/**
 * The least a crossfade's `startMs` may lie into the piece, ms: the next pass starts silent from
 * the piece's start and is caught up meanwhile (audioStream.ts `steer`) before it is heard.
 */
export const MIN_LEAD_MS = 1000;
/** How long a looped piece goes round, s, and how long a piece played once lasts. */
export const LOOP_SECONDS: readonly [number, number] = [60, 120];
export const ONCE_SECONDS: readonly [number, number] = [30, 45];

/**
 * Who made a piece and on what terms: its title, its author, the page it came from, its licence —
 * `own` for the game's own score — and the attribution as that licence wants it, ready to show.
 */
export interface Credit {
  readonly title: string;
  readonly author: string;
  readonly source: string;
  readonly licence: Licence | 'own';
  readonly attribution: string;
}

/**
 * A piece found and built by the pack script: its file in the pack's folder, how long it lasts and
 * where its sound starts, ms, its loudness before the gain, LUFS, the gain that brings it to the
 * score's, and how it loops — null for a piece played once.
 */
export interface FoundPiece extends Credit {
  readonly file: string;
  readonly ms: number;
  readonly startMs: number;
  readonly loudness: number;
  readonly gain: number;
  readonly loop: Loop | null;
}

/** A piece of the game's own score, played as the music's manifest lists it under `score`. */
export interface ScorePiece extends Credit {
  readonly score: string;
}

export type PackPiece = FoundPiece | ScorePiece;

/** Whether `piece` is one of the score's, which the music's manifest lists. */
export const isScore = (piece: PackPiece): piece is ScorePiece => 'score' in piece;

/** A music pack: its id, its name in the world's voice, its composers, a piece for every place. */
export interface PackFile {
  readonly id: string;
  readonly title: string;
  readonly composers: readonly string[];
  readonly pieces: Readonly<Record<Slot, PackPiece>>;
}

/** The pack the game plays until the player picks another: the game's own score. */
export const DEFAULT_PACK = 'nachtschicht';

/** A crossfade's period, s: how far apart a pass and the next start. */
export const crossfadePeriod = ({ startMs, endMs, fadeMs }: Crossfade): number =>
  (endMs - fadeMs - startMs) / 1000;

/**
 * What breaks the crossfade `fade` in a piece `ms` long, a sentence each: a fade under
 * MIN_FADE_MS, a start under MIN_LEAD_MS, an end past the piece, a fade longer than the loop.
 */
export function crossfadeFlaws(fade: Crossfade, ms: number): string[] {
  const { startMs, endMs, fadeMs } = fade;
  return [
    fadeMs < MIN_FADE_MS && `its crossfade of ${fadeMs} ms is under ${MIN_FADE_MS}`,
    startMs < MIN_LEAD_MS && `it loops from ${startMs} ms, under the ${MIN_LEAD_MS} a pass leads`,
    endMs > ms && `its loop ends at ${endMs} ms, past its ${ms} ms`,
    endMs - fadeMs <= startMs && 'its crossfade is as long as its loop',
  ].filter((flaw): flaw is string => typeof flaw === 'string');
}

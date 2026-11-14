import {
  DEFAULT_PACK,
  isScore,
  packFileOf,
  SLOTS,
  type Crossfade,
  type FoundPiece,
  type PackFile,
  type PackPiece,
  type Slot,
} from './packFile.js';
import { PACK_FILES } from './packList.js';
import { musicEntry, type MusicId, type SampleEntry } from './samples.js';

/**
 * musicPacks.ts: the music the player picks in the settings (screens/Settings.tsx „Musik",
 * docs/sound.md „Musikpakete") — every pack the game ships (packList.ts), and which piece plays in
 * each of the music's eight places: the chosen pack's, or the one the „Feinwahl" names for that
 * place. A piece of the game's own score plays as the music's manifest lists it (samples.ts), a
 * found piece as its pack.json does, from public/music/packs/<pack>/. The choice comes from the
 * settings (settings.ts `music`, kept on this device) and is told to whoever listens; the run's
 * music, the menu's sound, the opening and the end card ask here what plays.
 */

/** What the player chose: a pack, and for some places a piece of another pack, by its pack. */
export interface MusicChoice {
  readonly pack: string;
  readonly pieces: Readonly<Partial<Record<Slot, string>>>;
}

/** The game's own score, nothing picked besides. */
export const DEFAULT_CHOICE: MusicChoice = { pack: DEFAULT_PACK, pieces: {} };

/**
 * A piece as the music plays it: its file under public/music/, how long it lasts and where its
 * sound starts, ms, the gain that brings it to the score's loudness, whether it goes round — on
 * bars (`bpm`, `bars`) or by a crossfade — as the music's manifest lists a recording.
 */
export type MusicPiece = Pick<SampleEntry, 'file' | 'ms' | 'gain' | 'startMs' | 'loop'> & {
  readonly bpm?: number;
  readonly bars?: number;
  readonly crossfade?: Crossfade;
};

/**
 * The piece in play for a place: its pack, its key — pack and place, the same key the same
 * piece — its credit, and how it plays; `entry` is null while the music's manifest is not here,
 * or where a piece of the score awaits its render.
 */
export interface Chosen {
  readonly key: string;
  readonly pack: string;
  readonly piece: PackPiece;
  readonly entry: MusicPiece | null;
}

/** The packs shipped by their ids: the default first, then by title. */
const PACKS: readonly PackFile[] = [...PACK_FILES].sort(
  (a, b) =>
    Number(b.id === DEFAULT_PACK) - Number(a.id === DEFAULT_PACK) ||
    a.title.localeCompare(b.title, 'de'),
);

/** Every pack shipped: the game's own score first, then by title. */
export function installedPacks(): readonly PackFile[] {
  return PACKS;
}

/** The pack shipped as `id`; null for none. */
export function packById(id: string): PackFile | null {
  return PACKS.find((pack) => pack.id === id) ?? null;
}

let choice: MusicChoice = DEFAULT_CHOICE;
const listeners = new Set<() => void>();

/** What the player chose, as the settings last told it. */
export function musicChoice(): MusicChoice {
  return choice;
}

/** The settings tell the choice (settings.ts `apply`); whoever listens hears of a change. */
export function setMusicChoice(next: MusicChoice): void {
  const same =
    next.pack === choice.pack && SLOTS.every((slot) => next.pieces[slot] === choice.pieces[slot]);
  choice = next;
  if (same) return;
  for (const listener of [...listeners]) listener();
}

/** Calls `listener` at every change of the choice; returns what stops it. */
export function subscribeMusicChoice(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The pack whose piece plays in `slot` under `chosen`: the Feinwahl's, else the pack chosen. */
export function packFor(slot: Slot, chosen: MusicChoice = choice): string {
  const picked = chosen.pieces[slot];
  return picked !== undefined && packById(picked) !== null ? picked : chosen.pack;
}

/** How a found piece of the pack `pack` plays: its file in the pack's folder, its loop's kind. */
function foundEntry(pack: string, piece: FoundPiece): MusicPiece {
  const { loop } = piece;
  const base = {
    file: packFileOf(pack, piece.file),
    ms: piece.ms,
    gain: piece.gain,
    startMs: piece.startMs,
    loop: loop !== null,
  };
  if (loop === null) return base;
  return 'bars' in loop
    ? { ...base, bpm: loop.bars.bpm, bars: loop.bars.count }
    : { ...base, crossfade: loop.crossfade };
}

/**
 * How `piece` of the pack `pack` plays: a found piece as its pack.json has it, a piece of the
 * score as the music's manifest lists it — null while that is not here, or the piece awaits its
 * render.
 */
export function entryOf(pack: string, piece: PackPiece): MusicPiece | null {
  return isScore(piece) ? musicEntry(piece.score as MusicId) : foundEntry(pack, piece);
}

/** The piece of `slot` in the pack `pack`; the default pack's where that has none. */
function pieceIn(pack: string, slot: Slot): { pack: string; piece: PackPiece } {
  const own = packById(pack)?.pieces[slot];
  if (own !== undefined) return { pack, piece: own };
  const fallback = packById(DEFAULT_PACK)?.pieces[slot];
  if (fallback === undefined) throw new Error(`music: no pack has a piece for ${slot}`);
  return { pack: DEFAULT_PACK, piece: fallback };
}

/** The piece in play for `slot` under `chosen` — now, by default. */
export function chosenFor(slot: Slot, chosen: MusicChoice = choice): Chosen {
  const { pack, piece } = pieceIn(packFor(slot, chosen), slot);
  return { key: `${pack}/${slot}`, pack, piece, entry: entryOf(pack, piece) };
}

/** How the piece in play for `slot` plays now; null where it cannot yet (`Chosen.entry`). */
export function slotEntry(slot: Slot): MusicPiece | null {
  return chosenFor(slot).entry;
}

import { vi } from 'vitest';
import {
  SLOTS,
  type Crossfade,
  type FoundPiece,
  type PackFile,
  type ScorePiece,
  type Slot,
} from '../src/world/packFile.js';

/**
 * Music packs as a test ships them in place of the game's (src/world/packList.ts): the game's own
 * score, its places naming the music's manifest, and found packs of the test's own, their files
 * under public/music/packs/<id>/ as fakeSamples.ts serves them.
 */

/** A credit as a test's piece carries it. */
const credit = (title: string) => ({
  title,
  author: 'Ada Example',
  source: 'https://opengameart.org/content/probe',
  licence: 'CC BY 4.0' as const,
  attribution: `„${title}“ – Ada Example · https://opengameart.org/content/probe`,
});

/** The game's own score: every place a piece of the music's manifest. */
export const SCORE_PACK: PackFile = {
  id: 'nachtschicht',
  title: 'Schicht A · Hauspartitur',
  composers: ['EscapeLab mit Eleven Music'],
  pieces: Object.fromEntries(
    SLOTS.map((slot): [Slot, ScorePiece] => [
      slot,
      { ...credit(slot), licence: 'own', score: slot },
    ]),
  ) as Record<Slot, ScorePiece>,
};

/** A loop of a found piece: 70 s long, round by a crossfade from 3 s to 66 s over 3 s. */
export const ROUND: Crossfade = { startMs: 3000, endMs: 66_000, fadeMs: 3000 };

/**
 * A found pack `id`, every looped place 70 s round by ROUND at a gain of 0.5, every place played
 * once 35 s at 0.8 — changed where `pieces` says.
 */
export function foundPack(
  id: string,
  pieces: Partial<Record<Slot, Partial<FoundPiece>>> = {},
): PackFile {
  const once = new Set<Slot>(['title', 'end-won', 'end-lost']);
  const piece = (slot: Slot): FoundPiece => ({
    ...credit(`${id} ${slot}`),
    file: `${slot}.m4a`,
    ms: once.has(slot) ? 35_000 : 70_000,
    startMs: 0,
    loudness: -20,
    gain: once.has(slot) ? 0.8 : 0.5,
    loop: once.has(slot) ? null : { crossfade: ROUND },
    ...pieces[slot],
  });
  return {
    id,
    title: `Schicht X · ${id}`,
    composers: ['Ada Example'],
    pieces: Object.fromEntries(SLOTS.map((slot) => [slot, piece(slot)])) as Record<
      Slot,
      FoundPiece
    >,
  };
}

/**
 * Ships `packs` in place of the game's to the modules imported after it (vi.resetModules first):
 * the score's own pack, and those of the test.
 */
export function shipPacks(...packs: PackFile[]): void {
  vi.doMock('../src/world/packList.js', () => ({ PACK_FILES: [SCORE_PACK, ...packs] }));
}

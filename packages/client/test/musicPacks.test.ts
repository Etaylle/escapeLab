import { existsSync, readdirSync, statSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { offVoice, WORLD } from '../../core/test/voice.js';
import { PACK_CAP } from '../scripts/packs.js';
import {
  chosenFor,
  DEFAULT_CHOICE,
  entryOf,
  installedPacks,
  packById,
  packFor,
  setMusicChoice,
  subscribeMusicChoice,
} from '../src/world/musicPacks.js';
import {
  crossfadeFlaws,
  crossfadePeriod,
  DEFAULT_PACK,
  EDITED,
  isScore,
  LICENCE_DEEDS,
  LICENCES,
  LOOP_SECONDS,
  ONCE_SECONDS,
  playedOnce,
  SLOTS,
  type FoundPiece,
  type PackFile,
  type Slot,
} from '../src/world/packFile.js';
import { MUSIC_IDS } from '../src/world/samples.js';

/**
 * The music packs the game ships (audio/packs/<id>/pack.json, public/music/packs/<id>/): each
 * fills every place of the music, credits every piece as its licence wants it, names itself in
 * the world's voice, keeps its files within its cap, loops by the rules, meets the score's
 * loudness; and the choice of them as the game resolves it (world/musicPacks.ts).
 */

const PACKS_DIR = new URL('../public/music/packs/', import.meta.url).pathname;
/** What the encoder may add to a piece's length, ms: the plan's spans are whole. */
const ENCODED_MS = 50;

/** Every pack shipped, the game's own first. */
const packs = installedPacks();
const found = packs.filter((pack) => pack.id !== DEFAULT_PACK);

/** Every found piece of `pack`, with its place. */
const piecesOf = (pack: PackFile): [Slot, FoundPiece][] =>
  SLOTS.flatMap((slot) => {
    const piece = pack.pieces[slot];
    return isScore(piece) ? [] : [[slot, piece]];
  });

describe('the packs shipped', () => {
  it('are the game’s own score first, and the packs the owner chose from', () => {
    expect(packs[0]?.id).toBe(DEFAULT_PACK);
    expect(packs.map((pack) => pack.id).sort()).toEqual(
      ['cheremisinov', 'macleod', 'nachtschicht', 'yalciner', 'zhelanov'].sort(),
    );
  });

  it('fill every place of the music, each piece of its author with a page', () => {
    for (const pack of packs) {
      expect(Object.keys(pack.pieces).sort(), pack.id).toEqual([...SLOTS].sort());
      for (const slot of SLOTS) {
        const piece = pack.pieces[slot];
        expect(piece.title.trim(), `${pack.id}/${slot}`).not.toBe('');
        expect(piece.author.trim(), `${pack.id}/${slot}`).not.toBe('');
        expect(piece.source, `${pack.id}/${slot}`).toMatch(/^https:\/\//);
      }
    }
  });

  it('credit every found piece as its licence wants: title, author, page, deed, the edit', () => {
    for (const pack of found) {
      for (const [slot, piece] of piecesOf(pack)) {
        const where = `${pack.id}/${slot}`;
        expect(LICENCES, where).toContain(piece.licence);
        const deed = LICENCE_DEEDS[piece.licence as (typeof LICENCES)[number]];
        for (const part of [`„${piece.title}“`, piece.author, piece.source, deed.url, EDITED]) {
          expect(piece.attribution, where).toContain(part);
        }
      }
    }
  });

  it('play the game’s own score in its own pack, as the music’s manifest lists it', () => {
    const own = packById(DEFAULT_PACK) as PackFile;
    for (const slot of SLOTS) {
      const piece = own.pieces[slot];
      expect(isScore(piece) && piece.score === slot, slot).toBe(true);
      expect(MUSIC_IDS, slot).toContain(slot);
      expect(piece.licence, slot).toBe('own');
    }
  });

  it('name themselves and their pieces in the world’s voice', () => {
    for (const pack of packs) {
      const said = [pack.title, ...SLOTS.map((slot) => pack.pieces[slot].attribution)];
      expect(offVoice(said, WORLD), pack.id).toEqual([]);
      expect(pack.title, pack.id).toMatch(/^Schicht [A-Z] · \S/);
    }
  });

  it('keep their files where pack.json names them, no other, within the cap of a pack', () => {
    for (const pack of found) {
      const dir = `${PACKS_DIR}${pack.id}/`;
      const named = piecesOf(pack).map(([, piece]) => piece.file);
      // Each piece says what its file was made from: the script makes no file anew for nothing.
      expect(piecesOf(pack).map(([, piece]) => piece.build), pack.id).toEqual(
        new Array(8).fill(expect.stringMatching(/^[0-9a-f]{16}$/)),
      );
      expect(readdirSync(dir).sort(), pack.id).toEqual([...named].sort());
      const bytes = named.reduce((sum, file) => sum + statSync(`${dir}${file}`).size, 0);
      expect(bytes, pack.id).toBeLessThanOrEqual(PACK_CAP);
    }
    expect(existsSync(`${PACKS_DIR}${DEFAULT_PACK}/`)).toBe(true);
  });

  it('loop by a crossfade of 1.5 s and more, 60–120 s round; play the rest once', () => {
    for (const pack of found) {
      for (const [slot, piece] of piecesOf(pack)) {
        const where = `${pack.id}/${slot}`;
        if (playedOnce(slot)) {
          expect(piece.loop, where).toBeNull();
          expect(piece.ms, where).toBeGreaterThanOrEqual(ONCE_SECONDS[0] * 1000);
          expect(piece.ms, where).toBeLessThanOrEqual(ONCE_SECONDS[1] * 1000 + ENCODED_MS);
          continue;
        }
        const loop = piece.loop;
        expect(loop !== null && 'crossfade' in loop, where).toBe(true);
        if (loop === null || !('crossfade' in loop)) continue;
        expect(crossfadeFlaws(loop.crossfade, piece.ms), where).toEqual([]);
        const round = crossfadePeriod(loop.crossfade);
        expect(round, where).toBeGreaterThanOrEqual(LOOP_SECONDS[0]);
        expect(round, where).toBeLessThanOrEqual(LOOP_SECONDS[1]);
        expect(piece.startMs, where).toBe(0);
      }
    }
  });

  it('meet the score’s −19 LUFS by their gain, none brought up past +20 dB', () => {
    for (const pack of found) {
      for (const [slot, piece] of piecesOf(pack)) {
        const played = piece.loudness + 20 * Math.log10(piece.gain);
        expect(played, `${pack.id}/${slot}`).toBeCloseTo(-19, 1);
        expect(20 * Math.log10(piece.gain), `${pack.id}/${slot}`).toBeLessThanOrEqual(20);
      }
    }
  });
});

describe('the music chosen', () => {
  it('plays the pack chosen in every place, and the Feinwahl’s piece where it names one', () => {
    const choice = { pack: 'yalciner', pieces: { lobby: 'cheremisinov' } } as const;
    expect(packFor('calm', choice)).toBe('yalciner');
    expect(packFor('lobby', choice)).toBe('cheremisinov');
    expect(chosenFor('lobby', choice)).toMatchObject({ key: 'cheremisinov/lobby' });
    // A pack no longer shipped is passed over for the one chosen.
    expect(packFor('calm', { pack: 'yalciner', pieces: { calm: 'pixabay' } })).toBe('yalciner');
    expect(chosenFor('calm', DEFAULT_CHOICE).key).toBe('nachtschicht/calm');
  });

  it('plays a found piece from its pack’s folder, a loop by its crossfade, an ending once', () => {
    const yalciner = packById('yalciner') as PackFile;
    const calm = entryOf('yalciner', yalciner.pieces.calm);
    expect(calm).toMatchObject({ file: 'packs/yalciner/calm.m4a', loop: true, startMs: 0 });
    const loop = (yalciner.pieces.calm as FoundPiece).loop;
    expect(calm?.crossfade).toEqual(loop !== null && 'crossfade' in loop ? loop.crossfade : 'none');
    const ending = entryOf('yalciner', yalciner.pieces['end-won']);
    expect(ending).toMatchObject({ file: 'packs/yalciner/end-won.m4a', loop: false });
    expect(ending?.crossfade).toBeUndefined();
  });

  it('tells whoever listens of a change, and of nothing else', () => {
    const heard = vi.fn();
    const stop = subscribeMusicChoice(heard);
    setMusicChoice({ pack: 'yalciner', pieces: {} });
    setMusicChoice({ pack: 'yalciner', pieces: {} });
    setMusicChoice({ pack: 'yalciner', pieces: { calm: 'cheremisinov' } });
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    setMusicChoice(DEFAULT_CHOICE);
    expect(heard).toHaveBeenCalledTimes(2);
  });
});

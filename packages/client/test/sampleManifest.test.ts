import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AUDIBLE_FLOOR_DBFS,
  CATALOG_FILE,
  DIRS,
  FOLDER_CAPS,
  groupOf,
  MANIFEST,
  MAX_BED_GAIN_DB,
  musicFormatOf,
  noisyTakes,
  offLength,
  PIECE_BITRATE,
  readCatalog,
  recordingsOf,
  remakeCommands,
  SFX_FORMAT,
  upToDate,
  type CatalogEntry,
  type Group,
  type Manifest,
} from '../scripts/sfx.js';
import { BED_GAIN_MAX, MUSIC_IDS, SFX_IDS } from '../src/world/samples.js';

/**
 * The lab's recordings against what the game plays: the ids the code may name (samples.ts)
 * are the catalog's — a suite's pieces among them — the catalog says truly where each plays,
 * and every one has its file, measured, in the manifest the game loads.
 */

/**
 * What makes the recordings `ids` again on a Mac, as the sound script says it: a command for
 * each group — five candidates of an effect, three takes of a piece of music for the ear, a
 * suite's takes as many as a run of it may make.
 */
const remedyFor = (ids: readonly string[]): string =>
  `render them on a Mac: ${remakeCommands(items, ids).join('; ')} (docs/sound.md)`;

/**
 * The entries whose recordings the user still has to render (they cost credits, which no agent
 * may spend): until then each plays another's recording (`standIn`), an older one of its own, or
 * none. An entry added without its recording goes here with the render command in docs/sound.md,
 * and leaves once the user has made it.
 */
const AWAITING_RENDER: readonly string[] = [
  // The hum's three takes of 2026-11-13 came out near silent (−50 dBFS with one click); the gain
  // of +31 dB turned the click into a crack in the menu, so the take was dropped until a render
  // at full level exists (docs/sound.md, „The menu").
  'bed-facility',
  // The score's eight pieces, written as one suite on 2026-11-14 (docs/sound.md „Score"): until a
  // take of it is kept, the menu, the run and the end cards play the recordings of the pieces
  // before it, the lobby the menu's theme at its weight, the opening its older cue.
  'menu-theme',
  'lobby',
  'title',
  'calm',
  'tense',
  'critical',
  'end-lost',
  'end-won',
];
const awaiting = new Set(AWAITING_RENDER);

const items = readCatalog();
/** Every recording the catalog names: each sound, and each piece of a suite. */
const catalog = recordingsOf(items);
const CLIENT = join(CATALOG_FILE, '../..');
const idsOf = (group: Group): string[] =>
  catalog.filter((entry) => groupOf(entry) === group).map((entry) => entry.id);

describe('the ids the game plays', () => {
  it('are the catalog’s, group by group, and no others', () => {
    expect([...SFX_IDS].sort()).toEqual(idsOf('sfx').sort());
    expect([...MUSIC_IDS].sort()).toEqual(idsOf('music').sort());
  });

  it('each play where the catalog says, its id written there', () => {
    for (const entry of catalog) {
      const places = entry.usedBy.map((use) => {
        const [file = '', symbol = ''] = use.split('#');
        const path = join(CLIENT, file);
        expect(existsSync(path), `${entry.id}: ${file} does not exist`).toBe(true);
        const source = readFileSync(path, 'utf8');
        const has = new RegExp(`\\b${symbol}\\b`);
        expect(source, `${entry.id}: ${file} has no ${symbol}`).toMatch(has);
        return source;
      });
      const named = places.some((source) => source.includes(`'${entry.id}'`));
      expect(named, `${entry.id} is named in none of ${entry.usedBy.join(', ')}`).toBe(true);
    }
  });
});

/** A group's manifest as the game loads it; empty where there is none. */
function manifestOf(group: Group): Manifest {
  const file = join(DIRS[group], MANIFEST);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Manifest) : {};
}

describe('the entries awaiting the user’s render', () => {
  const sfx = manifestOf('sfx');
  const pending = catalog.filter((entry) => {
    const kept = manifestOf(groupOf(entry))[entry.id];
    return kept === undefined || !upToDate(entry, kept);
  });

  it(`are ${pending.map((entry) => entry.id).join(', ') || 'none'}`, () => {
    const unexpected = pending.filter((entry) => !awaiting.has(entry.id)).map((e) => e.id);
    expect(unexpected, `no recording, or a stale one — ${remedyFor(unexpected)}`).toEqual([]);
  });

  it('play a recording of the catalog meanwhile where they name one, none of their own', () => {
    for (const id of AWAITING_RENDER) {
      const entry = catalog.find((each) => each.id === id);
      expect(entry, `${id} is in the catalog`).toBeDefined();
      const kept = sfx[id];
      if (entry === undefined || kept === undefined || upToDate(entry, kept)) continue;
      const borrowed = kept.standIn ?? '';
      expect(sfx[borrowed]?.file, `${id} names the recording it borrows`).toBe(kept.file);
      const own = existsSync(join(DIRS.sfx, `${id}.mp3`));
      expect(own, `${id} has no file of its own yet`).toBe(false);
    }
  });
});

/**
 * How many bytes a second a recording made of `entry` takes: an MP3 at a constant rate, a
 * format's kbit/s 125 bytes each — or a suite's piece as AAC at PIECE_BITRATE, its .m4a some 2 %
 * over that rate (afconvert, 72 s: 162.6 kbit/s).
 */
function rateOf(entry: CatalogEntry): number {
  if (entry.of !== undefined) return (PIECE_BITRATE / 8) * 1.05;
  const format = groupOf(entry) === 'sfx' ? SFX_FORMAT : musicFormatOf(entry);
  return Number(format.split('_')[2]) * 125;
}

/**
 * The files `waiting` let go of in `manifest` once they are made: those they play now that are
 * their own, which no entry made already plays.
 */
function replacedFiles(manifest: Manifest, waiting: readonly CatalogEntry[]): string[] {
  const others = new Set(
    Object.entries(manifest)
      .filter(([id]) => !awaiting.has(id))
      .map(([, kept]) => kept.file),
  );
  const own = waiting.map((entry) => manifest[entry.id]?.file);
  const mine = own.filter((file): file is string => file !== undefined && !others.has(file));
  return [...new Set(mine)];
}

describe.each(['sfx', 'music'] as const)('the recordings in public/%s', (group) => {
  const manifest = manifestOf(group);
  const entries = catalog.filter((entry) => groupOf(entry) === group);
  const rendered = entries.filter((entry) => !awaiting.has(entry.id));

  it('have one each, made by ElevenLabs from the catalog’s request as it stands', () => {
    const filed = (id: string): boolean =>
      existsSync(join(DIRS[group], manifest[id]?.file ?? `${id}.missing`));
    const missing = rendered.filter((entry) => !filed(entry.id)).map((entry) => entry.id);
    expect(missing, `no recording — ${remedyFor(missing)}`).toEqual([]);
    const stale = rendered
      .filter((entry) => {
        const kept = manifest[entry.id];
        return kept === undefined || !upToDate(entry, kept);
      })
      .map((entry) => entry.id);
    expect(stale, `made from another request — ${remedyFor(stale)}`).toEqual([]);
    for (const entry of rendered) {
      expect([manifest[entry.id]?.source, manifest[entry.id]?.loop]).toEqual([
        'elevenlabs',
        entry.loop,
      ]);
    }
    const listed = Object.keys(manifest).filter((id) => !awaiting.has(id));
    expect(listed.sort()).toEqual(rendered.map((entry) => entry.id).sort());
  });

  it('name each stem’s tempo as the catalog has it, the bars the music is counted in', () => {
    for (const entry of rendered) {
      expect(manifest[entry.id]?.bpm, entry.id).toBe(entry.bpm);
    }
  });

  it('last as long as asked for, start within themselves, and came back unclipped', () => {
    const off = offLength(entries, { sfx: {}, music: {}, [group]: manifest });
    const said = off.map(({ id, ms, asked }) => `${id} ${ms} ms, asked for ${asked}`);
    const remedy = remedyFor(off.map(({ id }) => id));
    expect(said, `more than a fifth off their length — ${remedy}`).toEqual([]);
    for (const entry of rendered) {
      const kept = manifest[entry.id];
      expect(kept?.startMs ?? NaN).toBeGreaterThanOrEqual(0);
      expect(kept?.startMs ?? NaN, entry.id).toBeLessThan((kept?.ms ?? 0) / 4);
      if (entry.kind === 'bed') expect(kept?.startMs).toBe(0);
      // Under −20 dB: a take that came back clipped.
      expect(kept?.gain ?? NaN, `${entry.id}: gain ${kept?.gain}`).toBeGreaterThan(0.1);
    }
  });

  it('play no noise floor that is heard once their gain is applied', () => {
    for (const entry of rendered) {
      const { floor, rms } = manifest[entry.id] ?? {};
      expect([typeof floor, typeof rms], `${entry.id}: floor and RMS measured`).toEqual([
        'number',
        'number',
      ]);
    }
    const takes = noisyTakes(entries, { sfx: {}, music: {}, [group]: manifest });
    const heard = takes.map(({ id, gain, heardDbfs }) => `${id} gain ${gain}, ${heardDbfs} dBFS`);
    const remedy = remedyFor(takes.map(({ id }) => id));
    expect(heard, `floors over ${AUDIBLE_FLOOR_DBFS} dBFS — ${remedy}`).toEqual([]);
  });

  /** The recordings in the folder now: an MP3 as ElevenLabs made it, a suite's piece as AAC. */
  const filed = (): string[] =>
    existsSync(DIRS[group])
      ? readdirSync(DIRS[group]).filter((name) => /\.(?:mp3|m4a)$/.test(name))
      : [];
  /** The bytes `files` of the folder take. */
  const bytesOf = (files: readonly string[]): number =>
    files.reduce((sum, file) => sum + statSync(join(DIRS[group], file)).size, 0);

  it('keep within the folder’s cap, and no file the manifest does not name', () => {
    const named = new Set(Object.values(manifest).map((entry) => entry.file));
    expect(filed().filter((file) => !named.has(file))).toEqual([]);
    expect(bytesOf(filed())).toBeLessThanOrEqual(FOLDER_CAPS[group]);
    expect(FOLDER_CAPS).toEqual({ sfx: 3 * 1024 * 1024, music: 11 * 1024 * 1024 });
  });

  it('keep within it once the entries awaiting their render are made, each at its rate', () => {
    const waiting = entries.filter((entry) => awaiting.has(entry.id));
    const planned = waiting.reduce((sum, entry) => sum + entry.durationSeconds * rateOf(entry), 0);
    const replaced = replacedFiles(manifest, waiting).filter((file) =>
      existsSync(join(DIRS[group], file)),
    );
    const after = bytesOf(filed()) - bytesOf(replaced) + planned;
    expect(after).toBeLessThanOrEqual(FOLDER_CAPS[group]);
  });
});

describe('the levels the game plays its recordings at', () => {
  it('bring no bed up more than +12 dB: the script keeps none such, the loader plays none', () => {
    expect(BED_GAIN_MAX).toBeCloseTo(10 ** (MAX_BED_GAIN_DB / 20), 12);
    const sfx = manifestOf('sfx');
    const beds = catalog.filter((entry) => entry.kind === 'bed' && sfx[entry.id] !== undefined);
    const over = beds.filter((entry) => (sfx[entry.id]?.gain ?? 0) > BED_GAIN_MAX);
    const said = over.map((entry) => `${entry.id} gain ${sfx[entry.id]?.gain}`);
    expect(said, `brought up past +12 dB — ${remedyFor(over.map((entry) => entry.id))}`).toEqual(
      [],
    );
  });

  it('play a suite’s pieces within 2 dB of each other, each at its loudness by its gain', () => {
    const music = manifestOf('music');
    const played = Object.entries(music)
      .filter(([, kept]) => kept.suite !== undefined && kept.loudness !== undefined)
      .map(([id, kept]) => [id, (kept.loudness ?? NaN) + 20 * Math.log10(kept.gain)] as const);
    const levels = played.map(([, lufs]) => lufs);
    const spread = levels.length === 0 ? 0 : Math.max(...levels) - Math.min(...levels);
    const said = played.map(([id, lufs]) => `${id} ${lufs.toFixed(1)} LUFS`).join(', ');
    expect(spread, said).toBeLessThanOrEqual(2);
  });
});

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CATALOG_FILE,
  DIRS,
  FOLDER_CAPS,
  groupOf,
  hashOf,
  MANIFEST,
  readCatalog,
  type CatalogEntry,
  type Group,
  type Manifest,
} from '../scripts/sfx.js';
import { MUSIC_IDS, SFX_IDS } from '../src/world/samples.js';

/**
 * The lab's recordings against what the game plays: the ids the code may name (samples.ts)
 * are the catalog's, the catalog says truly where each plays, and every one has its file,
 * measured, in the manifest the game loads.
 */

/** What to do when a recording is missing or stale. */
const REMEDY = 'render it on a Mac: pnpm --filter client sfx (docs/sound.md)';

const catalog = readCatalog();
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

/** How far a recording may run from the length asked for: effects to the frame, music looser. */
function lengthsOf(entry: CatalogEntry): [number, number] {
  const asked = entry.durationSeconds * 1000;
  return groupOf(entry) === 'music' ? [asked * 0.9, asked * 1.1] : [asked - 60, asked + 150];
}

describe.each(['sfx', 'music'] as const)('the recordings in public/%s', (group) => {
  const manifest = manifestOf(group);
  const entries = catalog.filter((entry) => groupOf(entry) === group);

  it('have one each, made by ElevenLabs from the catalog’s request as it stands', () => {
    for (const entry of entries) {
      const kept = manifest[entry.id];
      expect(kept, `${entry.id} has no recording — ${REMEDY}`).toBeDefined();
      expect(existsSync(join(DIRS[group], kept?.file ?? '?')), `${kept?.file} — ${REMEDY}`).toBe(
        true,
      );
      expect(kept?.hash, `${entry.id} was made from another request — ${REMEDY}`).toBe(
        hashOf(entry),
      );
      expect([kept?.source, kept?.loop]).toEqual(['elevenlabs', entry.loop]);
    }
    expect(Object.keys(manifest).sort()).toEqual(entries.map((entry) => entry.id).sort());
  });

  it('last as long as asked for, start within themselves, and take a sane gain', () => {
    for (const entry of entries) {
      const kept = manifest[entry.id];
      const [min, max] = lengthsOf(entry);
      expect(kept?.ms, `${entry.id}: ${kept?.ms} ms`).toBeGreaterThanOrEqual(min);
      expect(kept?.ms, `${entry.id}: ${kept?.ms} ms`).toBeLessThanOrEqual(max);
      expect(kept?.startMs ?? NaN).toBeGreaterThanOrEqual(0);
      expect(kept?.startMs ?? NaN, entry.id).toBeLessThan((kept?.ms ?? 0) / 4);
      if (entry.kind === 'bed') expect(kept?.startMs).toBe(0);
      // Under +26 dB: what an almost silent take would need; over −20 dB: a clipped one.
      expect(kept?.gain ?? NaN, `${entry.id}: gain ${kept?.gain}`).toBeGreaterThan(0.1);
      expect(kept?.gain ?? NaN, `${entry.id}: gain ${kept?.gain}`).toBeLessThan(20);
    }
  });

  it('keep within the folder’s cap, and no file the manifest does not name', () => {
    const files = existsSync(DIRS[group])
      ? readdirSync(DIRS[group]).filter((name) => name.endsWith('.mp3'))
      : [];
    const named = new Set(Object.values(manifest).map((entry) => entry.file));
    expect(files.filter((file) => !named.has(file))).toEqual([]);
    const bytes = files.reduce((sum, file) => sum + statSync(join(DIRS[group], file)).size, 0);
    expect(bytes).toBeLessThanOrEqual(FOLDER_CAPS[group]);
    expect(FOLDER_CAPS).toEqual({ sfx: 3 * 1024 * 1024, music: 6 * 1024 * 1024 });
  });
});

import type { PackFile } from './packFile.js';

/**
 * packList.ts: every music pack the game ships, as the build reads them from
 * audio/packs/<id>/pack.json (packFile.ts the format, scripts/packs.ts their maker) — bundled
 * with the game, a few kB each, so that the settings list them without asking the server. A
 * module of its own, so that a test may ship packs of its own in their place.
 */
const found = import.meta.glob<PackFile>('../../audio/packs/*/pack.json', {
  eager: true,
  import: 'default',
});

/** Every pack shipped, in no order of their own. */
export const PACK_FILES: readonly PackFile[] = Object.values(found);

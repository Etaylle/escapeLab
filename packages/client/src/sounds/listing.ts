import type { SampleEntry } from '../world/samples.js';

/**
 * What the audition page (/sounds) lists, and the command it puts together: every sound of the
 * catalog (audio/catalog.json) by its kind, each with its recording as the manifests name it,
 * and the sound script's command that makes the sounds ticked anew (scripts/sfx.ts). Pure.
 */

/** What a sound is, as the catalog has it. */
export type SoundKind = 'oneshot' | 'bed' | 'stem' | 'sting';

/** One sound of the catalog, as the page reads it. */
export interface CatalogSound {
  readonly id: string;
  readonly kind: SoundKind;
  readonly prompt: string;
  readonly durationSeconds: number;
  readonly loop: boolean;
}

/** The page's sections, in order, each a kind with its title. */
export const SECTIONS: readonly { readonly kind: SoundKind; readonly title: string }[] = [
  { kind: 'oneshot', title: 'Effekte' },
  { kind: 'bed', title: 'Räume und Schleifen' },
  { kind: 'stem', title: 'Musik' },
  { kind: 'sting', title: 'Endkarte' },
];

/** A floor that comes out louder than this once the gain is applied is heard: as scripts/sfx.ts. */
export const AUDIBLE_FLOOR_DBFS = -50;
/** A floor less than this far under the RMS, dB, is the sound itself, which masks it: as sfx.ts. */
export const MASKED_WITHIN_DB = 20;

/**
 * A sound as the page lists it: its catalog entry, its recording, its floor once the gain is
 * applied — null where its sound masks it, −Infinity where it falls to digital silence — and
 * whether that floor is heard.
 */
export interface SoundRow {
  readonly sound: CatalogSound;
  readonly recording: SampleEntry | null;
  readonly floorDbfs: number | null;
  readonly noisy: boolean;
}

/** A section of the page: its kind, its title and its sounds in the catalog's order. */
export interface Section {
  readonly kind: SoundKind;
  readonly title: string;
  readonly rows: readonly SoundRow[];
}

const KINDS = new Set<string>(SECTIONS.map(({ kind }) => kind));

const dbfs = (level: number): number => 20 * Math.log10(level);

/**
 * `recording`'s floor once its gain is applied, dBFS: null where it lies less than
 * MASKED_WITHIN_DB under the recording's RMS — the sound itself — as scripts/sfx.ts `floorHeard`.
 */
export function floorDbfsOf(recording: SampleEntry): number | null {
  if (dbfs(recording.rms) - dbfs(recording.floor) < MASKED_WITHIN_DB) return null;
  return dbfs(recording.floor * recording.gain);
}

/** The row of `sound`, with its recording where there is one. */
function rowOf(sound: CatalogSound, recording: SampleEntry | null): SoundRow {
  const floorDbfs = recording === null ? null : floorDbfsOf(recording);
  const noisy = floorDbfs !== null && floorDbfs > AUDIBLE_FLOOR_DBFS;
  return { sound, recording, floorDbfs, noisy };
}

/** The catalog's entries as the page reads them; one of a kind it does not know is left out. */
export function soundsOf(
  entries: readonly (Omit<CatalogSound, 'kind'> & { readonly kind: string })[],
): CatalogSound[] {
  return entries.filter((entry): entry is CatalogSound => KINDS.has(entry.kind));
}

/** The catalog by section, each sound with its recording out of `recordings`, by id. */
export function listingOf(
  catalog: readonly CatalogSound[],
  recordings: Readonly<Record<string, SampleEntry>>,
): Section[] {
  return SECTIONS.map(({ kind, title }) => ({
    kind,
    title,
    rows: catalog
      .filter((sound) => sound.kind === kind)
      .map((sound) => rowOf(sound, recordings[sound.id] ?? null)),
  }));
}

/** The key file the command names unless told another: the main checkout's, by its full path. */
export const ENV_FILE = '/Users/uros/Documents/Req.Eng./escapelab/.env.local';
/** How many takes the command asks of each sound: the script keeps the best. */
export const CANDIDATES = 3;

/** `word` as a shell takes it: as it is where it is plain, else in single quotes. */
export function shellWord(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}

/**
 * The command that makes the sounds `ids` anew, to be run in packages/client: node with the key
 * file, the sound script, `candidates` of each sound; null where nothing is chosen.
 */
export function commandFor(
  ids: readonly string[],
  envFile = ENV_FILE,
  candidates = CANDIDATES,
): string | null {
  if (ids.length === 0) {
    return null;
  }
  const only = `--only ${ids.join(',')}`;
  return `node --env-file=${shellWord(envFile)} scripts/sfx.ts --candidates ${candidates} ${only}`;
}

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

/** The gain over which a take came back too quiet, by kind: as scripts/sfx.ts MAX_GAIN. */
export const QUIET_GAIN: Readonly<Record<SoundKind, number>> = {
  oneshot: 6,
  bed: 4,
  stem: 4,
  sting: 4,
};

/** A sound as the page lists it: its catalog entry, its recording, and whether it is too quiet. */
export interface SoundRow {
  readonly sound: CatalogSound;
  readonly recording: SampleEntry | null;
  readonly quiet: boolean;
}

/** A section of the page: its kind, its title and its sounds in the catalog's order. */
export interface Section {
  readonly kind: SoundKind;
  readonly title: string;
  readonly rows: readonly SoundRow[];
}

const KINDS = new Set<string>(SECTIONS.map(({ kind }) => kind));

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
      .map((sound) => {
        const recording = recordings[sound.id] ?? null;
        const quiet = recording !== null && recording.gain > QUIET_GAIN[sound.kind];
        return { sound, recording, quiet };
      }),
  }));
}

/** The key file the command names unless told another: the repo's, seen from packages/client. */
export const ENV_FILE = '../../.env.local';
/** How many candidates the command asks of each effect: the script keeps the best. */
export const CANDIDATES = 3;

/** `word` as a shell takes it: as it is where it is plain, else in single quotes. */
export function shellWord(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}

/**
 * The command that makes the sounds `ids` anew, to be run in packages/client: node with the key
 * file, the sound script, `candidates` of each effect; null where nothing is chosen.
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

import {
  RADIO_MOMENTS,
  ROLES,
  type Person,
  type RadioMoment,
  type Role,
  type Roster,
} from '@escapelab/core';
import { shellWord } from '../sounds/listing.js';
import type { VoiceEntry, VoiceManifest } from '../world/radioVoice.js';

/**
 * The radio's voices on their audition page (/voices): who of the cast each role has, the
 * samples of a person's voice the dev server lists (GET /takes/voices/, the server's takes.ts) as
 * the voice script wrote them (scripts/cast.ts `Samples`), the commands that design and keep one
 * — which the page shows and never runs — and every rendered line by its moment. Pure, but for
 * `loadSamples`, which asks the dev server for the lists and nothing else.
 */

/** Where the dev server serves the voices' samples: their lists, and each under its folder. */
export const SAMPLES_BASE = '/takes/voices/';

/**
 * A person of the cast as the voice script's command line names them (scripts/cast.ts
 * `slotsOf`): by their role where it has them alone, else by role and id; and the folder their
 * samples lie in, named alike.
 */
export interface Slot {
  readonly role: Role;
  readonly person: Person;
  readonly name: string;
  readonly dir: string;
}

/** Every person of `roster` as the command line names them, the roles in order. */
export function slotsOf(roster: Roster): Slot[] {
  return ROLES.flatMap((role) =>
    roster[role].map((person) => {
      const alone = roster[role].length === 1;
      const name = alone ? role : `${role}:${person.id}`;
      return { role, person, name, dir: alone ? role : `${role}-${person.id}` };
    }),
  );
}

/** A sample as its list names it and the page reads it: its number, its file, its length, s. */
export interface SampleInfo {
  readonly n: number;
  readonly file: string;
  readonly seconds: number;
}

/** A person's samples, the oldest first, and the one kept as their voice, where one is. */
export interface PersonSamples {
  readonly samples: readonly SampleInfo[];
  readonly kept: number | null;
}

/** Every person's samples, by the folder they lie in. */
export type SamplesByDir = Readonly<Record<string, PersonSamples>>;

/** What the page has of the samples: those the dev server lists, or why there are none to hear. */
export type SamplesState =
  | { readonly kind: 'served'; readonly samples: SamplesByDir }
  | { readonly kind: 'unserved'; readonly why: string };

/** Whether `value` reads as a sample: its number, its file as `<n>.mp3`, its length. */
function isSample(value: unknown): value is SampleInfo {
  if (typeof value !== 'object' || value === null) return false;
  const sample = value as Record<string, unknown>;
  return (
    typeof sample['n'] === 'number' &&
    sample['file'] === `${String(sample['n'])}.mp3` &&
    typeof sample['seconds'] === 'number'
  );
}

/** The samples of one person's list, and the one kept; none where it reads as no list. */
function personSamples(list: unknown): PersonSamples {
  const read = (list ?? {}) as { samples?: unknown; kept?: { n?: unknown } };
  const listed: unknown[] = Array.isArray(read.samples) ? read.samples : [];
  const samples = listed.filter(isSample).map(({ n, file, seconds }) => ({ n, file, seconds }));
  return { samples, kept: typeof read.kept?.n === 'number' ? read.kept.n : null };
}

/** The samples of `lists`, the dev server's answer: each person's that read as samples. */
export function samplesOf(lists: unknown): SamplesByDir {
  if (typeof lists !== 'object' || lists === null) return {};
  return Object.fromEntries(
    Object.entries(lists).flatMap(([dir, list]) => {
      const read = personSamples(list);
      return read.samples.length > 0 ? [[dir, read]] : [];
    }),
  );
}

/** Why the page has no samples where the server serves none: a production server's 404. */
export const UNSERVED = 'Stimmproben liefert nur der Entwicklungsserver (pnpm dev).';

/**
 * The samples as the dev server lists them; where it serves none (404, as a production server
 * answers) or the lists cannot be had, why. Asks for the lists alone, with a plain GET.
 */
export async function loadSamples(): Promise<SamplesState> {
  try {
    const res = await fetch(SAMPLES_BASE);
    if (res.status === 404) {
      return { kind: 'unserved', why: UNSERVED };
    }
    if (!res.ok) {
      const why = `Die Stimmproben ließen sich nicht laden: HTTP ${res.status}`;
      return { kind: 'unserved', why };
    }
    return { kind: 'served', samples: samplesOf(await res.json()) };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { kind: 'unserved', why: `Die Stimmproben ließen sich nicht laden: ${reason}` };
  }
}

/** Where sample `sample` of the person whose folder is `dir` plays from. */
export function sampleUrl(dir: string, sample: Pick<SampleInfo, 'file'>): string {
  return `${SAMPLES_BASE}${dir}/${sample.file}`;
}

/** What the page calls sample `n` of the person in `dir` by while it plays. */
export function sampleKey(dir: string, n: number): string {
  return `${dir}#${n}`;
}

/** The command, to be run in packages/client with the key file, that runs the voice script. */
const scriptWith = (envFile: string): string =>
  `node --env-file=${shellWord(envFile)} scripts/voice.ts`;

/** The command that makes three samples of the person `slot` names (--design). */
export function designCommandFor(slot: string, envFile: string): string {
  return `${scriptWith(envFile)} --design ${slot}`;
}

/** The command that keeps sample `n` of the person `slot` names as their voice (--keep). */
export function keepCommandFor(slot: string, n: number, envFile: string): string {
  return `${scriptWith(envFile)} --keep ${slot}=${n}`;
}

/** The command that makes the lines of the cast whose voices are kept, by ElevenLabs. */
export function renderCommandFor(envFile: string): string {
  return `VOICE_ENGINE=elevenlabs ${scriptWith(envFile)} --fresh`;
}

/** A rendered line, by its recording's id. */
export interface Rendered {
  readonly id: string;
  readonly entry: VoiceEntry;
}

/**
 * Every rendered line of `manifest` by the moment it comes at, in the order a run hears them —
 * the moments without a line left out — each moment's by its words, then by who says them, so
 * that the cast's takes of one line stand together.
 */
export function linesByMoment(
  manifest: VoiceManifest,
): { readonly moment: RadioMoment; readonly lines: readonly Rendered[] }[] {
  const all = Object.entries(manifest.lines).map(([id, entry]) => ({ id, entry }));
  const order = (a: Rendered, b: Rendered): number =>
    a.entry.text.localeCompare(b.entry.text, 'de') || a.entry.person.localeCompare(b.entry.person);
  return RADIO_MOMENTS.flatMap((moment) => {
    const lines = all.filter(({ entry }) => entry.moment === moment).sort(order);
    return lines.length > 0 ? [{ moment, lines }] : [];
  });
}

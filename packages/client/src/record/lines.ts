import { radioLines, type Mission, type MissionInfo, type RadioMoment } from '@escapelab/core';
import {
  MANIFEST_URL,
  VOICE_BASE,
  type PersonSource,
  type VoiceManifest,
} from '../world/radioVoice.js';

/**
 * The radio lines the /record page offers a person to speak or to replace with a file: every
 * line a shipped mission can put on the air (core's `radioLines`, from the missions the server
 * hands out — not the ones made in the editor), each with what the manifest says of its
 * recording.
 */

/** Who made a recording: a synthetic voice, a person at the page's microphone, or a file. */
export type Source = 'synthetic' | PersonSource;

/** A line's recording: how long it speaks, ms, who made it, its file under VOICE_BASE. */
export interface Recording {
  readonly ms: number;
  readonly source: Source;
  readonly file: string;
}

/** One line to speak, and the recording it has. */
export interface RecordLine {
  /** its recording's id: the first 12 hex digits of the SHA-1 of what it says */
  readonly id: string;
  readonly text: string;
  /** the titles of the missions that say it */
  readonly missions: readonly string[];
  readonly when: RadioMoment;
  /** the title of the station a nudge or a solve's line belongs to; null otherwise */
  readonly station: string | null;
  /** its recording; null where it has none */
  readonly recording: Recording | null;
}

/**
 * Every line `missions` can put on the air, in their order and each mission's in the order a
 * run hears them — a line two missions say listed once, under both — with its recording as
 * `manifest` has it; `ids` names each line's recording.
 */
export function recordLines(
  missions: readonly Mission[],
  manifest: VoiceManifest,
  ids: ReadonlyMap<string, string>,
): RecordLine[] {
  const lines = new Map<string, RecordLine>();
  for (const mission of missions) {
    for (const said of radioLines(mission)) {
      const id = ids.get(said.text);
      if (id === undefined) {
        throw new Error(`recordLines: no id for the line "${said.text}"`);
      }
      const known = lines.get(id);
      if (known !== undefined) {
        const missions = [...new Set([...known.missions, mission.title])];
        lines.set(id, { ...known, missions });
        continue;
      }
      const puzzle = mission.puzzles.find((p) => p.id === said.puzzleId);
      const entry = manifest[id];
      const recording: Recording | null =
        entry === undefined
          ? null
          : { ms: entry.ms, source: entry.source ?? 'synthetic', file: entry.file };
      lines.set(id, {
        id,
        text: said.text,
        missions: [mission.title],
        when: said.when,
        station: puzzle?.title ?? null,
        recording,
      });
    }
  }
  return [...lines.values()];
}

/** The ids of the recordings of `texts`, as the voice script names them. */
export async function voiceIds(texts: readonly string[]): Promise<Map<string, string>> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new Error('Prüfsummen rechnet der Browser nur über localhost oder https.');
  }
  const ids = new Map<string, string>();
  for (const text of new Set(texts)) {
    const digest = new Uint8Array(await subtle.digest('SHA-1', new TextEncoder().encode(text)));
    const hex = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    ids.set(text, hex.slice(0, 12));
  }
  return ids;
}

/** `url` as JSON, never from a cache; fails with the address and the status. */
async function json<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`${url}: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/** Every line of every shipped mission, from the server's missions and the manifest. */
export async function loadLines(): Promise<RecordLine[]> {
  const [manifest, infos] = await Promise.all([
    json<VoiceManifest>(MANIFEST_URL),
    json<MissionInfo[]>('/missions'),
  ]);
  const shipped = infos.filter((info) => info.custom !== true);
  const missions = await Promise.all(
    shipped.map((info) => json<Mission>(`/missions/${encodeURIComponent(info.id)}`)),
  );
  const ids = await voiceIds(missions.flatMap((mission) => radioLines(mission)).map((l) => l.text));
  return recordLines(missions, manifest, ids);
}

/** Where a recording plays from, past any copy the browser kept. */
export function recordingUrl(recording: Recording, at: number): string {
  return `${VOICE_BASE}${recording.file}?t=${at}`;
}

/** The most a file put on the page may weigh, bytes: what the server takes. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** The kinds of file the page takes, by ending, with the type they are sent as. */
export const UPLOAD_TYPES: Readonly<Record<string, string>> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
};

/** What the file picker offers: the endings and types the page takes. */
export const UPLOAD_ACCEPT = [
  ...Object.keys(UPLOAD_TYPES).map((ending) => `.${ending}`),
  ...Object.values(UPLOAD_TYPES),
].join(',');

/** A file as the page sees one dropped on it. */
export interface Dropped {
  readonly name: string;
  readonly type: string;
  readonly size: number;
}

/** The ending of a file's name, in small letters; '' for none. */
const endingOf = (name: string): string => /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';

/**
 * Why the page does not send `file` on, as a sentence — a WebM (afconvert cannot read it),
 * another kind, too much — or null where it does.
 */
export function uploadProblem(file: Dropped): string | null {
  const ending = endingOf(file.name);
  if (ending === 'webm' || file.type.startsWith('audio/webm')) {
    return 'WebM kann afconvert nicht lesen: Angenommen werden mp3, m4a oder wav.';
  }
  if (UPLOAD_TYPES[ending] === undefined) {
    return `„${file.name}“ ist keine mp3-, m4a- oder wav-Datei.`;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `„${file.name}“ ist größer als ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`;
  }
  return file.size === 0 ? `„${file.name}“ ist leer.` : null;
}

/** The type a file goes to the server as: by its ending, which the page checked. */
export function uploadType(file: Dropped): string {
  return UPLOAD_TYPES[endingOf(file.name)] ?? 'application/octet-stream';
}

/**
 * Sends a recording of the line `id` to the server (POST /voice/:id, ALLOW_RECORD=1) — a take
 * from the page's microphone, or a file put there (`upload`) — and returns the recording as
 * the server keeps it; fails with the server's own words.
 */
export async function sendRecording(
  id: string,
  body: Blob,
  type: string,
  source: 'human' | 'upload',
): Promise<Recording> {
  const address = `${VOICE_BASE}${id}${source === 'upload' ? '?source=upload' : ''}`;
  const res = await fetch(address, { method: 'POST', headers: { 'content-type': type }, body });
  const kept = (await res.json().catch(() => ({}))) as Partial<Recording> & { error?: string };
  if (!res.ok || typeof kept.ms !== 'number' || typeof kept.file !== 'string') {
    throw new Error(kept.error ?? `Speichern ging nicht (HTTP ${res.status}).`);
  }
  return { ms: kept.ms, source, file: kept.file };
}

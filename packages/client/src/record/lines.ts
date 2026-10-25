import { radioLines, type Mission, type MissionInfo, type RadioMoment } from '@escapelab/core';
import { MANIFEST_URL, VOICE_BASE, type VoiceManifest } from '../world/radioVoice.js';

/**
 * The radio lines the /record page offers a person to speak: every line a shipped mission can
 * put on the air (core's `radioLines`, from the missions the server hands out — not the ones
 * made in the editor), each with what the manifest says of its recording.
 */

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
  /** how long its recording speaks, ms; null where it has none */
  readonly ms: number | null;
  /** whether a person speaks its recording, rather than the synthetic voice */
  readonly human: boolean;
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
      lines.set(id, {
        id,
        text: said.text,
        missions: [mission.title],
        when: said.when,
        station: puzzle?.title ?? null,
        ms: entry?.ms ?? null,
        human: entry?.source === 'human',
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

/** Where the recording of `line` plays from, past any copy the browser kept. */
export function recordingUrl(line: RecordLine, at: number): string {
  return `${VOICE_BASE}${line.id}.m4a?t=${at}`;
}

/**
 * Sends a person's take of the line `id` to the server (POST /voice/:id, ALLOW_RECORD=1) and
 * returns how long the saved recording speaks, ms; fails with the server's own words.
 */
export async function saveTake(id: string, wav: Blob): Promise<number> {
  const res = await fetch(`${VOICE_BASE}${id}`, {
    method: 'POST',
    headers: { 'content-type': 'audio/wav' },
    body: wav,
  });
  const body = (await res.json().catch(() => ({}))) as { ms?: number; error?: string };
  if (!res.ok || typeof body.ms !== 'number') {
    throw new Error(body.error ?? `Speichern ging nicht (HTTP ${res.status}).`);
  }
  return body.ms;
}

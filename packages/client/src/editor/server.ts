import { draftFromJson, type Loaded } from './draft.js';

/**
 * The editor's calls to the server: a mission whole, to start from; saving
 * one as a custom mission; deleting one again. Failures come back as German
 * words for the status line, never as a thrown error.
 */

/** How large a mission may be for the server to take it, in bytes. */
export const MAX_MISSION_BYTES = 256 * 1024;

export type Saved = { ok: true; id: string } | { ok: false; error: string; issues: string[] };

/** What a failed request said, or what went wrong on the way. */
async function failure(res: Response): Promise<{ error: string; issues: string[] }> {
  try {
    const body = (await res.json()) as { error?: unknown; issues?: unknown };
    return {
      error: typeof body.error === 'string' ? body.error : `HTTP ${res.status}`,
      issues: Array.isArray(body.issues) ? body.issues.map(String) : [],
    };
  } catch {
    return { error: `HTTP ${res.status}`, issues: [] };
  }
}

const unreachable = (err: unknown): string =>
  `Server nicht erreichbar (${err instanceof Error ? err.message : String(err)}).`;

/** A catalog mission as a draft. */
export async function fetchMission(id: string): Promise<Loaded> {
  try {
    const res = await fetch(`/missions/${encodeURIComponent(id)}`);
    if (!res.ok) {
      return { ok: false, problems: [(await failure(res)).error] };
    }
    return draftFromJson(await res.json());
  } catch (err) {
    return { ok: false, problems: [unreachable(err)] };
  }
}

/** Saves a mission file as a custom mission; the server checks it again before it writes. */
export async function saveMission(json: Record<string, unknown>): Promise<Saved> {
  const body = JSON.stringify(json);
  if (new Blob([body]).size > MAX_MISSION_BYTES) {
    return { ok: false, error: 'Die Mission ist größer als 256 kB.', issues: [] };
  }
  try {
    const res = await fetch('/missions/custom', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    if (!res.ok) {
      return { ok: false, ...(await failure(res)) };
    }
    const saved = (await res.json()) as { id: string };
    return { ok: true, id: saved.id };
  } catch (err) {
    return { ok: false, error: unreachable(err), issues: [] };
  }
}

/** Deletes a custom mission; null when it worked, else what went wrong. */
export async function deleteMission(id: string): Promise<string | null> {
  try {
    const res = await fetch(`/missions/custom/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return res.ok ? null : (await failure(res)).error;
  } catch (err) {
    return unreachable(err);
  }
}

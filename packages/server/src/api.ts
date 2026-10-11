import type { MissionCatalog } from './missions.js';

/** A JSON answer: the status code and the body to serialise. */
export interface ApiResponse {
  status: number;
  body: unknown;
}

const MANUAL_PATH = /^\/missions\/([^/]+)\/manual$/;

/**
 * The JSON routes: health, the mission list for the picker and one mission's
 * printed manual. Null for any other path, which is the static site's.
 */
export function apiResponse(catalog: MissionCatalog, url: string): ApiResponse | null {
  const path = url.split('?')[0] ?? url;
  if (path === '/health') {
    return { status: 200, body: { ok: true, missions: catalog.all.map((m) => m.id) } };
  }
  if (path === '/missions') {
    return { status: 200, body: catalog.infos() };
  }
  const segment = MANUAL_PATH.exec(path)?.[1];
  if (segment === undefined) {
    return null;
  }
  const id = decodeSegment(segment);
  const manual = id === null ? null : catalog.manual(id);
  if (manual === null) {
    return { status: 404, body: { error: `Mission "${id ?? segment}" gibt es nicht.` } };
  }
  return { status: 200, body: manual };
}

/** A URL path segment as text; null when its percent-encoding is broken. */
function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

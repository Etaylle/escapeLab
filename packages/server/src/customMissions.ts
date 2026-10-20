import type { IncomingMessage, ServerResponse } from 'node:http';
import { checkMission, isCustomMissionId } from '@escapelab/core';
import type { ApiResponse } from './api.js';
import type { MissionCatalog } from './missions.js';

/**
 * The editor's write routes: POST /missions/custom saves a mission made in
 * the editor (a JSON body of 256 kB at most, checked as `parseMission`
 * checks it, its id starting with „custom-"), DELETE /missions/custom/:id
 * removes one again. Either refreshes the catalog, so the next room can
 * pick the mission at once. There is no login — the game runs on a LAN —
 * but each address gets only so many writes a minute.
 */

/** How large a mission body may be, in bytes. */
export const MAX_MISSION_BYTES = 256 * 1024;

/**
 * Counts writes per address in a sliding window: `take` says whether one
 * more is allowed now, and counts it if so.
 */
export class RateLimiter {
  private readonly seen = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(key: string): boolean {
    const now = this.now();
    const recent = (this.seen.get(key) ?? []).filter((at) => now - at < this.windowMs);
    const allowed = recent.length < this.limit;
    if (allowed) {
      recent.push(now);
    }
    if (recent.length === 0) {
      this.seen.delete(key);
    } else {
      this.seen.set(key, recent);
    }
    return allowed;
  }
}

/** What the routes work on: the catalog they write to, and the limit on writes. */
export interface CustomMissions {
  catalog: MissionCatalog;
  limiter: RateLimiter;
}

/** Writes a minute an address gets: enough to save while editing, not to fill a disk. */
export const WRITES_PER_MINUTE = 30;

export function customMissions(catalog: MissionCatalog): CustomMissions {
  return { catalog, limiter: new RateLimiter(WRITES_PER_MINUTE, 60_000) };
}

type Route = { kind: 'save' } | { kind: 'delete'; segment: string };

const DELETE_PATH = /^\/missions\/custom\/([^/]+)$/;

function routeOf(req: IncomingMessage): Route | null {
  const path = (req.url ?? '/').split('?')[0] ?? '/';
  if (req.method === 'POST' && path === '/missions/custom') {
    return { kind: 'save' };
  }
  const segment = DELETE_PATH.exec(path)?.[1];
  return req.method === 'DELETE' && segment !== undefined ? { kind: 'delete', segment } : null;
}

/**
 * Answers POST /missions/custom and DELETE /missions/custom/:id; true when
 * the request was one of them (the answer may follow once its body is in).
 */
export function serveCustomMissions(
  editing: CustomMissions,
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const route = routeOf(req);
  if (route === null) {
    return false;
  }
  answer(editing, route, req).then(
    (reply) => send(res, reply),
    (err: unknown) => {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[escapelab] ${req.method} ${req.url} failed: ${reason}`);
      send(res, { status: 500, body: { error: `Speichern fehlgeschlagen: ${reason}` } });
    },
  );
  return true;
}

function send(res: ServerResponse, reply: ApiResponse): void {
  res.writeHead(reply.status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(reply.body));
}

async function answer(
  editing: CustomMissions,
  route: Route,
  req: IncomingMessage,
): Promise<ApiResponse> {
  if (!editing.limiter.take(req.socket.remoteAddress ?? 'unknown')) {
    return { status: 429, body: { error: 'Zu viele Änderungen auf einmal — gleich noch einmal.' } };
  }
  if (route.kind === 'delete') {
    return remove(editing.catalog, route.segment);
  }
  const body = await readBody(req, MAX_MISSION_BYTES);
  if (body === null) {
    return {
      status: 413,
      body: { error: `Die Mission ist größer als ${MAX_MISSION_BYTES / 1024} kB.` },
    };
  }
  return save(editing.catalog, body);
}

/** Validates and writes one mission sent as JSON text. */
function save(catalog: MissionCatalog, text: string): ApiResponse {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { status: 400, body: { error: `Kein gültiges JSON: ${reason}`, issues: [] } };
  }
  const id = typeof data === 'object' && data !== null ? (data as { id?: unknown }).id : undefined;
  if (typeof id !== 'string' || !isCustomMissionId(id)) {
    return {
      status: 400,
      body: {
        error: 'Die Kennung einer eigenen Mission beginnt mit „custom-", dann Kleinbuchstaben, ' +
          'Ziffern und Bindestriche.',
        issues: [],
      },
    };
  }
  const checked = checkMission(data);
  if (!checked.ok) {
    const error = 'Die Mission hält der Prüfung nicht stand.';
    return { status: 400, body: { error, issues: checked.issues } };
  }
  catalog.saveCustom(checked.mission);
  return { status: 201, body: { id, info: catalog.infos().find((info) => info.id === id) } };
}

function remove(catalog: MissionCatalog, segment: string): ApiResponse {
  const id = decodeSegment(segment);
  if (id === null || !isCustomMissionId(id)) {
    return { status: 400, body: { error: 'Nur eigene Missionen (custom-…) lassen sich löschen.' } };
  }
  if (!catalog.deleteCustom(id)) {
    return { status: 404, body: { error: `Mission "${id}" gibt es nicht.` } };
  }
  return { status: 200, body: { id } };
}

/** A URL path segment as text; null when its percent-encoding is broken. */
function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * The request's body as text, or null once it runs past `limit` bytes — by
 * its declared length already, or while it streams in; the rest is not read.
 */
function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length'] ?? 0) > limit) {
      resolve(null);
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        chunks.length = 0;
        req.removeAllListeners('data');
        req.pause();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

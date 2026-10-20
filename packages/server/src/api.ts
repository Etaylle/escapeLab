import { createHash, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
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

/** The run log and the token its download takes. */
export interface RunsExport {
  /** where the server appends a line per finished run: RUNS_LOG */
  file: string;
  /** RUNS_TOKEN; unset or empty, there is no download at all */
  token: string | undefined;
}

/**
 * GET /runs.jsonl: the run log, for a request that carries `Authorization:
 * Bearer <RUNS_TOKEN>`. Without a token configured the route answers 404,
 * so a server set up without one gives nothing away; before the first run
 * has finished the log is empty. Returns true when the request was answered.
 */
export function serveRuns(runs: RunsExport, req: IncomingMessage, res: ServerResponse): boolean {
  if (!asksForRuns(req)) {
    return false;
  }
  const status = runsStatus(runs, req.headers.authorization);
  if (status !== 200) {
    res.writeHead(status, status === 401 ? { 'www-authenticate': 'Bearer' } : {});
    res.end();
    return true;
  }
  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store',
  });
  if (req.method === 'HEAD' || !existsSync(runs.file)) {
    res.end();
    return true;
  }
  createReadStream(runs.file)
    .on('error', (err) => {
      console.error(`[escapelab] run log ${runs.file} could not be sent: ${err.message}`);
      res.destroy(err);
    })
    .pipe(res);
  return true;
}

/** GET or HEAD on /runs.jsonl, whatever the query. */
function asksForRuns(req: IncomingMessage): boolean {
  const path = (req.url ?? '/').split('?')[0];
  return path === '/runs.jsonl' && (req.method === 'GET' || req.method === 'HEAD');
}

/** 404 while no token is configured, 401 unless the request carries it, else 200. */
function runsStatus(runs: RunsExport, authorization: string | undefined): 200 | 401 | 404 {
  if (runs.token === undefined || runs.token === '') {
    return 404;
  }
  const given = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? '')?.[1];
  return given !== undefined && sameSecret(given, runs.token) ? 200 : 401;
}

/** Compared in constant time, so the answer's timing tells nothing about the token. */
function sameSecret(a: string, b: string): boolean {
  const digest = (text: string): Buffer => createHash('sha256').update(text).digest();
  return timingSafeEqual(digest(a), digest(b));
}

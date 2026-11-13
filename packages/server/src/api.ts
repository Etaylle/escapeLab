import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isDailyDay, type MissionStanding, type MissionStats } from '@escapelab/core';
import type { MissionCatalog } from './missions.js';
import type { RoomCounts } from './roomManager.js';
import type { RunStats } from './runStats.js';
import type { Store } from './store/store.js';

/** A JSON answer: the status code and the body to serialise. */
export interface ApiResponse {
  status: number;
  body: unknown;
}

const MANUAL_PATH = /^\/missions\/([^/]+)\/manual$/;
const MISSION_PATH = /^\/missions\/([^/]+)$/;

/** What /health says of the server beside its missions. */
export interface Health {
  /** its rooms by count, naming nobody */
  rooms: () => RoomCounts;
  /** whole seconds since it started */
  uptimeSec: () => number;
  /** the build it runs (`versionOf`) */
  version: string;
}

/** The build a server runs: the commit Render deployed (RENDER_GIT_COMMIT), else 'dev'. */
export function versionOf(env: NodeJS.ProcessEnv): string {
  // An empty RENDER_GIT_COMMIT counts as unset, like an empty RUNS_LOG.
  return env['RENDER_GIT_COMMIT'] || 'dev';
}

/**
 * GET /health: the server is up, its missions by id, its rooms by count — the runs on, those
 * paused, the players and the audience on the line — how long it has run and the build it
 * runs. It names nobody. Null for any other path.
 */
export function healthResponse(
  catalog: MissionCatalog,
  health: Health,
  url: string,
): ApiResponse | null {
  if ((url.split('?')[0] ?? url) !== '/health') {
    return null;
  }
  return {
    status: 200,
    body: {
      ok: true,
      missions: catalog.all.map((m) => m.id),
      rooms: health.rooms(),
      uptimeSec: health.uptimeSec(),
      version: health.version,
    },
  };
}

/**
 * The JSON routes of the missions: the list for the picker, one mission
 * whole (for the editor to start from) and one mission's printed manual.
 * Null for any other path: /health's, the Bestenliste's or the static site's.
 */
export function apiResponse(catalog: MissionCatalog, url: string): ApiResponse | null {
  const path = url.split('?')[0] ?? url;
  if (path === '/missions') {
    return { status: 200, body: catalog.infos() };
  }
  const whole = MISSION_PATH.exec(path)?.[1];
  if (whole !== undefined) {
    const id = decodeSegment(whole);
    const mission = id === null ? undefined : catalog.find(id);
    return mission === undefined
      ? { status: 404, body: { error: `Mission "${id ?? whole}" gibt es nicht.` } }
      : { status: 200, body: mission };
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

const MISSION_STATS_PATH = /^\/stats\/([^/]+)$/;

/**
 * The Bestenliste, public and naming nobody but by the names they played
 * under: GET /stats, every mission with runs off the Tagesschicht; GET
 * /stats/daily, the Tagesschicht's last days, each ranked apart; GET
 * /stats/:mission, one — asked with ?run=<finishedAt>, with the place of the
 * won run that finished then, and with &daily=<day> among the runs of that
 * day's Tagesschicht. 404 for a mission neither the catalog nor the log
 * knows. Null for any other path.
 */
export function statsResponse(
  stats: RunStats,
  catalog: MissionCatalog,
  url: string,
): ApiResponse | null {
  const cut = url.indexOf('?');
  const path = cut < 0 ? url : url.slice(0, cut);
  if (path === '/stats') {
    return { status: 200, body: stats.all() };
  }
  if (path === '/stats/daily') {
    return { status: 200, body: stats.daily() };
  }
  const segment = MISSION_STATS_PATH.exec(path)?.[1];
  if (segment === undefined) {
    return null;
  }
  const query = new URLSearchParams(cut < 0 ? '' : url.slice(cut + 1));
  const asked = standingAsked(query);
  if ('error' in asked) {
    return { status: 400, body: { error: asked.error } };
  }
  const id = decodeSegment(segment);
  const mission = id === null ? null : missionStats(stats, catalog, id, asked.day);
  if (id === null || mission === null) {
    return { status: 404, body: { error: `Mission "${id ?? segment}" gibt es nicht.` } };
  }
  const body: MissionStanding = { ...mission, place: placeAsked(stats, id, asked) };
  return { status: 200, body };
}

/** The place of the won run that finished at `run` — among its day's where it played one. */
function placeAsked(
  stats: RunStats,
  id: string,
  { run, day }: { run: number | null; day: string | null },
): MissionStanding['place'] {
  if (run === null) {
    return null;
  }
  return day === null ? stats.placeOf(id, run) : stats.dailyPlaceOf(day, id, run);
}

/**
 * What a standing asks after: the end of a run in ms (`?run=`), and the day of the
 * Tagesschicht it played (`&daily=`); an error to answer for either written wrong.
 */
function standingAsked(
  query: URLSearchParams,
): { run: number | null; day: string | null } | { error: string } {
  const run = query.get('run');
  if (run !== null && !/^\d+$/.test(run)) {
    return { error: `?run= nennt das Ende eines Laufs in Millisekunden, nicht "${run}".` };
  }
  const day = query.get('daily');
  if (day !== null && !isDailyDay(day)) {
    return { error: `&daily= nennt den Tag einer Tagesschicht, JJJJ-MM-TT, nicht "${day}".` };
  }
  return { run: run === null ? null : Number(run), day };
}

/**
 * A mission's stats — of the Tagesschicht of `day` where one is named — none yet for one the
 * catalog has, null for one nobody knows.
 */
function missionStats(
  stats: RunStats,
  catalog: MissionCatalog,
  id: string,
  day: string | null,
): MissionStats | null {
  const known = catalog.all.some((mission) => mission.id === id);
  const counted = day === null ? stats.mission(id) : stats.dailyMission(day, id);
  return counted ?? (known ? { missionId: id, difficulties: [] } : null);
}

/** A URL path segment as text; null when its percent-encoding is broken. */
function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** The runs the server kept and the token their download takes. */
export interface RunsExport {
  /** the store the runs are kept in (store/store.ts) */
  store: Pick<Store, 'runs'>;
  /** RUNS_TOKEN; unset or empty, there is no download at all */
  token: string | undefined;
}

/**
 * GET /runs.jsonl: every run the store keeps, the oldest first, one report of JSON a line — of
 * one mission with `?mission=<id>` — for a request that carries `Authorization: Bearer
 * <RUNS_TOKEN>`. Without a token configured the route answers 404, so a server set up without
 * one gives nothing away; before the first run has finished the answer is empty. Returns true
 * when the request was answered.
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
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  const mission = new URLSearchParams((req.url ?? '').split('?')[1] ?? '').get('mission');
  runs.store.runs(mission ?? undefined).then(
    (kept) => res.end(kept.map((run) => `${JSON.stringify(run)}\n`).join('')),
    (err: unknown) => {
      const why = err instanceof Error ? err.message : String(err);
      console.error(`[escapelab] the runs could not be sent: ${why}`);
      res.destroy(err instanceof Error ? err : new Error(why));
    },
  );
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

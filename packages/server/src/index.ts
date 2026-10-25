import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { apiResponse, serveRuns, statsResponse, type RunsExport } from './api.js';
import { customMissions, serveCustomMissions } from './customMissions.js';
import { startHeartbeat } from './heartbeat.js';
import { MissionCatalog } from './missions.js';
import { RoomManager, seedsAllowed } from './roomManager.js';
import { DEFAULT_RUNS_LOG } from './runLog.js';
import { loadRunStats, logRun } from './runStats.js';
import { serveSockets } from './sockets.js';
import { StaticSite } from './static.js';
import { createWebServer, lanUrls, tlsLogLine, tlsSetup } from './tls.js';

const PORT = Number(process.env['PORT'] ?? 3001);
const MISSIONS_DIR =
  process.env['MISSIONS_DIR'] ?? fileURLToPath(new URL('../../../missions', import.meta.url));
// An empty RUNS_LOG counts as unset, like an empty RUNS_TOKEN.
const RUNS_LOG = process.env['RUNS_LOG'] || DEFAULT_RUNS_LOG;
const runs: RunsExport = { file: RUNS_LOG, token: process.env['RUNS_TOKEN'] };
// https where packages/server/cert/ (or TLS_CERT and TLS_KEY) holds a pair, else http.
const tls = tlsSetup(process.env);

// Missions made in the editor: missions/custom/ beside the shipped ones (not in the repo).
const CUSTOM_MISSIONS_DIR = process.env['CUSTOM_MISSIONS_DIR'] || join(MISSIONS_DIR, 'custom');
const catalog = new MissionCatalog(MISSIONS_DIR, CUSTOM_MISSIONS_DIR);
const editing = customMissions(catalog);
const site = new StaticSite(fileURLToPath(new URL('../../client/dist', import.meta.url)));
// The Bestenliste: read from the log once, then counted run by run as they are logged.
const stats = loadRunStats(RUNS_LOG);
// A room pinned to a seed repeats its runs: for the walkthrough and bug reports, not for play.
const manager = new RoomManager(logRun(RUNS_LOG, stats), seedsAllowed(process.env));
setInterval(() => manager.sweep(), 60_000).unref();

const httpServer = createWebServer(tls, (req, res) => {
  if (serveRuns(runs, req, res)) {
    return;
  }
  if (serveCustomMissions(editing, req, res)) {
    return;
  }
  const url = req.url ?? '/';
  const api = apiResponse(catalog, url) ?? statsResponse(stats, catalog, url);
  if (api !== null) {
    res.writeHead(api.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(api.body));
    return;
  }
  if (site.serve(req, res)) {
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
serveSockets(wss, { catalog, manager });
// A socket gone silent is found out and closed, so that the room pauses for its player.
startHeartbeat(wss);

httpServer.listen(PORT, () => {
  const ids = catalog.all.map((m) => m.id).join(', ');
  const scheme = tls.on ? 'https' : 'http';
  console.log(`[escapelab] server on ${scheme}://localhost:${PORT} (ws: /ws, missions: ${ids})`);
  console.log(`[escapelab] ${tlsLogLine(tls)}`);
  const download = runs.token
    ? 'GET /runs.jsonl takes RUNS_TOKEN'
    : 'RUNS_TOKEN unset: no download';
  console.log(`[escapelab] finished runs go to ${RUNS_LOG} (${download})`);
  console.log(`[escapelab] GET /stats ranks the ${stats.runs} runs logged so far`);
  if (site.available) {
    for (const url of lanUrls(PORT, tls.on)) {
      console.log(`[escapelab] im Netzwerk erreichbar: ${url}`);
    }
  } else {
    console.log('[escapelab] kein Client-Build gefunden — im Dev-Modus läuft Vite auf 5173');
  }
});

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  apiResponse,
  healthResponse,
  serveRuns,
  statsResponse,
  versionOf,
  type ApiResponse,
  type Health,
  type RunsExport,
} from './api.js';
import { AccountDesk } from './accounts.js';
import { customMissions, serveCustomMissions } from './customMissions.js';
import { dailySalt } from './dailySalt.js';
import { HEARTBEAT_MS, startHeartbeat } from './heartbeat.js';
import { MissionCatalog } from './missions.js';
import { RoomManager, seedsAllowed } from './roomManager.js';
import { roomKey, roomKeyLogLine } from './seal.js';
import { frontOf, RateLimiter } from './rateLimiter.js';
import { onSignal } from './shutdown.js';
import { ACCOUNT_WRITES_PER_SOCKET, ACCOUNTS_MADE_PER_MINUTE, serveSockets } from './sockets.js';
import { StaticSite } from './static.js';
import { DEFAULT_RUNS_LOG } from './store/jsonl.js';
import { openStore, recordRuns, type Store } from './store/store.js';
import { serveTakes, takesAllowed, TakesShelf } from './takes.js';
import { createWebServer, lanUrls, tlsLogLine, tlsSetup } from './tls.js';
import { recordingAllowed, serveVoiceRecording, VoiceDesk } from './voiceRecording.js';

const PORT = Number(process.env['PORT'] ?? 3001);
/** Where the Tagesschicht's salt came from, as the start-up log says it. */
const DAILY_SALT_FROM = {
  env: 'salt from DAILY_SALT',
  file: 'salt kept in packages/server/data/daily-salt',
  made: 'salt made anew in packages/server/data/daily-salt',
} as const;
const MISSIONS_DIR =
  process.env['MISSIONS_DIR'] ?? fileURLToPath(new URL('../../../missions', import.meta.url));
// An empty RUNS_LOG counts as unset, like an empty RUNS_TOKEN.
const RUNS_LOG = process.env['RUNS_LOG'] || DEFAULT_RUNS_LOG;
/** How long the server waits for the runs still being kept before it exits all the same, ms. */
const KEEPING_MS = 5000;
// https where packages/server/cert/ (or TLS_CERT and TLS_KEY) holds a pair, else http.
const tls = tlsSetup(process.env);

// Missions made in the editor: missions/custom/ beside the shipped ones (not in the repo).
const CUSTOM_MISSIONS_DIR = process.env['CUSTOM_MISSIONS_DIR'] || join(MISSIONS_DIR, 'custom');
const catalog = new MissionCatalog(MISSIONS_DIR, CUSTOM_MISSIONS_DIR);
const editing = customMissions(catalog);
// Every limiter lets go of the addresses its window has passed, written to or not since.
editing.limiter.sweepEveryWindow();
const site = new StaticSite(fileURLToPath(new URL('../../client/dist', import.meta.url)));
// A person's recordings of the radio lines (the client's /record page): with ALLOW_RECORD=1 only.
const VOICE_DIR = fileURLToPath(new URL('../../client/public/voice', import.meta.url));
const voiceDesk = recordingAllowed(process.env)
  ? new VoiceDesk(VOICE_DIR, () => catalog.all.filter((m) => !catalog.isCustom(m.id)))
  : null;
// The music's takes, for the client's /sounds page to play before one is kept: ALLOW_TAKES=1 only.
const TAKES_DIR = fileURLToPath(new URL('../../client/takes', import.meta.url));
const takes = takesAllowed(process.env) ? new TakesShelf(TAKES_DIR) : null;
// Where finished runs and the accounts are kept: Postgres at DATABASE_URL, else the run log
// file and the accounts in memory. The Bestenliste is counted from it once, then run by run.
const store = await storeOrExit();
const recorder = recordRuns(store);
const runs: RunsExport = { store, token: process.env['RUNS_TOKEN'] };
// The Tagesschicht's salt: DAILY_SALT, else packages/server/data/daily-salt, made once and kept.
const daily = dailySalt(process.env);
// The key the rooms' snapshots are sealed with: ROOM_SECRET's, else one of this boot alone.
const sealing = roomKey(process.env);
// This boot of the server, an instance of its own: every snapshot it seals names it, so that a
// new instance tells a snapshot of the one before it from its own.
const instanceId = randomUUID();
// A room pinned to a seed repeats its runs: for the walkthrough and bug reports, not for play.
const manager = new RoomManager(
  recorder.record,
  seedsAllowed(process.env),
  daily.salt,
  sealing.key,
  instanceId,
);
setInterval(() => manager.sweep(), 60_000).unref();
// What /health says beside the missions: no code, no name.
const health: Health = {
  rooms: () => manager.counts(),
  uptimeSec: () => Math.floor(process.uptime()),
  version: versionOf(process.env),
};
/** The JSON routes: /health, the missions' and the Bestenliste's; null for any other path. */
const jsonFor = (url: string): ApiResponse | null =>
  healthResponse(catalog, health, url) ??
  apiResponse(catalog, url) ??
  statsResponse(store.stats(), catalog, url);

const httpServer = createWebServer(tls, (req, res) => {
  if (serveRuns(runs, req, res)) {
    return;
  }
  if (serveCustomMissions(editing, req, res)) {
    return;
  }
  if (serveVoiceRecording(voiceDesk, req, res)) {
    return;
  }
  // Before the static site, whose fallback would answer a take's address with the page.
  if (serveTakes(takes, req, res)) {
    return;
  }
  const url = req.url ?? '/';
  const api = jsonFor(url);
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
// Every pass has its account in the store, found or made as it comes to the door: one pass a
// socket, so many new accounts a minute from an address, so many writes a minute on a socket.
const accountsMade = new RateLimiter(ACCOUNTS_MADE_PER_MINUTE, 60_000);
accountsMade.sweepEveryWindow();
const served = serveSockets(wss, {
  catalog,
  manager,
  accounts: new AccountDesk(store),
  accountsMade,
  writesPerSocket: ACCOUNT_WRITES_PER_SOCKET,
  front: frontOf(process.env),
});
// A socket gone silent is found out and closed, so that the room pauses for its player; the
// log names the room and the seat of each socket it cuts.
startHeartbeat(wss, HEARTBEAT_MS, served.cut);

// Render's SIGTERM before it replaces the instance, or a Ctrl-C: the server goes down for a
// restart (shutdown.ts), every run standing still and every seat handed its room's snapshot.
const goDown = onSignal({
  stopTaking: () => {
    wss.close();
    httpServer.close();
    httpServer.closeIdleConnections();
  },
  sockets: () => wss.clients,
  manager,
  exit: (code) => void keepThenExit(code),
});
process.on('SIGTERM', goDown);
process.on('SIGINT', goDown);

httpServer.listen(PORT, () => {
  const ids = catalog.all.map((m) => m.id).join(', ');
  const scheme = tls.on ? 'https' : 'http';
  console.log(`[escapelab] server on ${scheme}://localhost:${PORT} (ws: /ws, missions: ${ids})`);
  console.log(`[escapelab] ${tlsLogLine(tls)}`);
  const download = runs.token
    ? 'GET /runs.jsonl takes RUNS_TOKEN'
    : 'RUNS_TOKEN unset: no download';
  console.log(`[escapelab] store: ${store.description}`);
  const kept = store.stats().runs;
  console.log(`[escapelab] GET /stats ranks the ${kept} runs kept so far (${download})`);
  console.log(`[escapelab] Tagesschicht: ${DAILY_SALT_FROM[daily.from]}`);
  console.log(`[escapelab] ${roomKeyLogLine(sealing)}`);
  console.log(`[escapelab] this boot is instance ${instanceId}: its snapshots name it`);
  if (voiceDesk !== null) {
    console.log(`[escapelab] ALLOW_RECORD=1: POST /voice/:id saves recordings to ${VOICE_DIR}`);
  }
  if (takes !== null) {
    console.log(`[escapelab] ALLOW_TAKES=1: GET /takes/ serves the music's takes in ${TAKES_DIR}`);
  }
  if (site.available) {
    for (const url of lanUrls(PORT, tls.on)) {
      console.log(`[escapelab] im Netzwerk erreichbar: ${url}`);
    }
  } else {
    console.log('[escapelab] kein Client-Build gefunden — im Dev-Modus läuft Vite auf 5173');
  }
});

/**
 * The store the environment names (store/store.ts `openStore`); the process exits 1, saying why,
 * where it cannot be opened.
 */
async function storeOrExit(): Promise<Store> {
  try {
    return await openStore(process.env, RUNS_LOG);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    console.error(`[escapelab] not started: ${why}`);
    process.exit(1);
  }
}

/**
 * The process exits with `code` once the runs still being kept are, and the store has let go —
 * KEEPING_MS at the latest: a database that does not answer keeps no deploy waiting.
 */
async function keepThenExit(code: number): Promise<void> {
  const late = new Promise<void>((resolve) => setTimeout(resolve, KEEPING_MS).unref());
  try {
    await Promise.race([recorder.settled().then(() => store.close()), late]);
  } catch (err) {
    console.error(`[escapelab] the store did not close cleanly: ${String(err)}`);
  }
  process.exit(code);
}

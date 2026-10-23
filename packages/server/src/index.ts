import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  GameError,
  parseClientMessage,
  scaleMission,
  type ClientMessage,
  type Mission,
  type ServerMessage,
} from '@escapelab/core';
import { apiResponse, serveRuns, statsResponse, type RunsExport } from './api.js';
import { customMissions, serveCustomMissions } from './customMissions.js';
import { MissionCatalog } from './missions.js';
import { RoomManager, seedsAllowed } from './roomManager.js';
import { DEFAULT_RUNS_LOG } from './runLog.js';
import { loadRunStats, logRun } from './runStats.js';
import { StaticSite } from './static.js';
import { createWebServer, lanUrls, tlsLogLine, tlsSetup } from './tls.js';
import type { Room } from './room.js';

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

/** Per-connection session, set once the socket joins or resumes into a room. */
interface Session {
  room: Room;
  /** the player's id; for an audience connection, its spectator id */
  playerId: string;
  /** set for audience connections, which detach instead of leaving the game */
  detachSpectator?: () => void;
}

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

function send(socket: WebSocket, msg: ServerMessage): void {
  socket.send(JSON.stringify(msg));
}

function handleMessage(socket: WebSocket, session: Session | null, msg: ClientMessage): Session | null {
  switch (msg.kind) {
    case 'create-room':
    case 'join-room': {
      // A new room plays on the difficulty its host's device asked for — normal unless that
      // device has won no run yet — with its alarm limit: scaled from the start.
      const room = msg.kind === 'create-room' ? createRoom(msg) : manager.get(msg.code);
      const { playerId, token } = room.join(msg.name);
      send(socket, { kind: 'joined', code: room.code, playerId, token });
      room.attach(playerId, (m) => send(socket, m));
      return { room, playerId };
    }
    case 'list-rooms':
      send(socket, { kind: 'rooms', rooms: manager.list() });
      return session;
    case 'spectate': {
      const room = manager.get(msg.code);
      // An audience connection goes by its spectator id: voice signals reach it by that.
      const { spectatorId, detach } = room.attachSpectator((m) => send(socket, m));
      return { room, playerId: spectatorId, detachSpectator: detach };
    }
    case 'resume': {
      const room = manager.get(msg.code);
      room.resume(msg.playerId, msg.token);
      send(socket, { kind: 'joined', code: room.code, playerId: msg.playerId, token: msg.token });
      room.attach(msg.playerId, (m) => send(socket, m));
      return { room, playerId: msg.playerId };
    }
    case 'switch-mission': {
      const s = requireSession(session);
      const difficulty = s.room.difficulty;
      s.room.switchMission(
        s.playerId,
        scaleMission(catalog.get(msg.missionId), difficulty),
        difficulty,
      );
      return s;
    }
    case 'select-difficulty': {
      const s = requireSession(session);
      // Rescale from the pristine mission, never from an already scaled one.
      s.room.switchMission(
        s.playerId,
        scaleMission(catalog.get(s.room.missionId), msg.difficulty),
        msg.difficulty,
      );
      return s;
    }
    case 'ping': {
      const s = requireSession(session);
      s.room.ping(s.playerId, msg.x, msg.y);
      return s;
    }
    case 'chat': {
      const s = requireSession(session);
      s.room.chat(s.playerId, msg.phrase);
      return s;
    }
    case 'rtc': {
      const s = requireSession(session);
      s.room.relaySignal(s.playerId, msg.to, msg.signal);
      return s;
    }
    case 'pos': {
      const s = requireSession(session);
      s.room.updatePosition(s.playerId, msg.run, {
        x: msg.x,
        y: msg.y,
        facing: msg.facing,
        moving: msg.moving,
      });
      return s;
    }
    case 'set-ready': {
      const s = requireSession(session);
      s.room.setReady(s.playerId, msg.ready, nextMission(s.room, msg.missionId));
      return s;
    }
    case 'select-color':
    case 'start-mission':
    case 'puzzle-input':
    case 'request-hint':
    case 'open-source':
    case 'read-note':
    case 'interact':
    case 'drop-item':
    case 'rematch':
    case 'back-to-lobby': {
      const s = requireSession(session);
      s.room.act(s.playerId, msg);
      return s;
    }
  }
}

/**
 * The mission the host's yes to the next run names: from the catalog, at the room's
 * difficulty; null where it names none. A name the catalog does not know is refused here.
 */
function nextMission(room: Room, missionId: string | undefined): Mission | null {
  return missionId === undefined ? null : scaleMission(catalog.get(missionId), room.difficulty);
}

/** The room a create-room message opens: its mission from the catalog, at its difficulty. */
function createRoom(msg: Extract<ClientMessage, { kind: 'create-room' }>): Room {
  const difficulty = msg.difficulty ?? 'normal';
  const mission = msg.missionId !== undefined ? catalog.get(msg.missionId) : catalog.default;
  return manager.create(scaleMission(mission, difficulty), msg.seed ?? null, difficulty);
}

function requireSession(session: Session | null): Session {
  if (session === null) {
    throw new GameError('Du bist noch in keinem Raum.');
  }
  return session;
}

wss.on('connection', (socket) => {
  let session: Session | null = null;

  socket.on('message', (raw) => {
    try {
      const msg = parseClientMessage(String(raw));
      session = handleMessage(socket, session, msg);
    } catch (err) {
      const message =
        err instanceof GameError || err instanceof Error ? err.message : 'Unbekannter Fehler.';
      send(socket, { kind: 'error', message });
    }
  });

  socket.on('close', () => {
    if (session === null) {
      return;
    }
    if (session.detachSpectator !== undefined) {
      session.detachSpectator();
    } else {
      session.room.detach(session.playerId);
    }
  });
});

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

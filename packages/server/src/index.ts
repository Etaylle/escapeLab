import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  GameError,
  parseClientMessage,
  scaleMission,
  type ClientMessage,
  type ServerMessage,
} from '@escapelab/core';
import { apiResponse, serveRuns, type RunsExport } from './api.js';
import { MissionCatalog } from './missions.js';
import { RoomManager } from './roomManager.js';
import { appendRun, DEFAULT_RUNS_LOG } from './runLog.js';
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

const catalog = new MissionCatalog(MISSIONS_DIR);
const site = new StaticSite(fileURLToPath(new URL('../../client/dist', import.meta.url)));
const manager = new RoomManager((report) => appendRun(RUNS_LOG, report));
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
  const api = apiResponse(catalog, req.url ?? '/');
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
      // A new room plays on normal, which has its own alarm limit: scaled from the start.
      const room =
        msg.kind === 'create-room'
          ? manager.create(
              scaleMission(
                msg.missionId !== undefined ? catalog.get(msg.missionId) : catalog.default,
                'normal',
              ),
            )
          : manager.get(msg.code);
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
    case 'select-color':
    case 'set-ready':
    case 'start-mission':
    case 'puzzle-input':
    case 'request-hint':
    case 'open-source':
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
  if (site.available) {
    for (const url of lanUrls(PORT, tls.on)) {
      console.log(`[escapelab] im Netzwerk erreichbar: ${url}`);
    }
  } else {
    console.log('[escapelab] kein Client-Build gefunden — im Dev-Modus läuft Vite auf 5173');
  }
});

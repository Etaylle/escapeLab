import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  GameError,
  parseClientMessage,
  scaleMission,
  type ClientMessage,
  type ServerMessage,
} from '@escapelab/core';
import { MissionCatalog } from './missions.js';
import { RoomManager } from './roomManager.js';
import { StaticSite } from './static.js';
import type { Room } from './room.js';

const PORT = Number(process.env['PORT'] ?? 3001);
const MISSIONS_DIR =
  process.env['MISSIONS_DIR'] ?? fileURLToPath(new URL('../../../missions', import.meta.url));

const catalog = new MissionCatalog(MISSIONS_DIR);
const site = new StaticSite(fileURLToPath(new URL('../../client/dist', import.meta.url)));
const manager = new RoomManager();
setInterval(() => manager.sweep(), 60_000).unref();

/** Per-connection session, set once the socket joins or resumes into a room. */
interface Session {
  room: Room;
  playerId: string;
  /** set for audience connections, which detach instead of leaving the game */
  detachSpectator?: () => void;
}

const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, missions: catalog.all.map((m) => m.id) }));
    return;
  }
  if (req.url === '/missions') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(catalog.infos()));
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
      const room =
        msg.kind === 'create-room'
          ? manager.create(msg.missionId !== undefined ? catalog.get(msg.missionId) : catalog.default)
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
      const detachSpectator = room.attachSpectator((m) => send(socket, m));
      return { room, playerId: '', detachSpectator };
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
    case 'pos': {
      const s = requireSession(session);
      s.room.updatePosition(s.playerId, {
        x: msg.x,
        y: msg.y,
        facing: msg.facing,
        moving: msg.moving,
      });
      return s;
    }
    case 'select-role':
    case 'select-color':
    case 'start-mission':
    case 'press-button':
    case 'cut-wire':
    case 'press-key':
    case 'toggle-switch':
    case 'commit-switches':
    case 'press-simon':
    case 'move-maze':
    case 'interact':
    case 'drop-item':
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

/** Every LAN address the game is reachable on — handy when people join on their phones. */
function lanUrls(port: number): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((net) => net !== undefined && net.family === 'IPv4' && !net.internal)
    .map((net) => `http://${net?.address ?? ''}:${port}`);
}

httpServer.listen(PORT, () => {
  const ids = catalog.all.map((m) => m.id).join(', ');
  console.log(`[escapelab] server on http://localhost:${PORT} (ws: /ws, missions: ${ids})`);
  if (site.available) {
    for (const url of lanUrls(PORT)) {
      console.log(`[escapelab] im Netzwerk erreichbar: ${url}`);
    }
  } else {
    console.log('[escapelab] kein Client-Build gefunden — im Dev-Modus läuft Vite auf 5173');
  }
});

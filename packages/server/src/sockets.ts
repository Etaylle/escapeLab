import {
  GameError,
  parseClientMessage,
  scaleMission,
  type ClientMessage,
  type Mission,
  type ServerMessage,
} from '@escapelab/core';
import type { MissionCatalog } from './missions.js';
import type { Room } from './room.js';
import type { RoomManager } from './roomManager.js';

/** What a connection needs of its socket: `ws`'s WebSocket has it. */
export interface PlayerSocket {
  send(data: string): void;
  on(event: 'message', listener: (data: unknown) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
}

/** What the connections need of the WebSocket server: `ws`'s WebSocketServer has it. */
export interface SocketServer {
  on(event: 'connection', listener: (socket: PlayerSocket) => void): unknown;
}

/** What a connection's messages reach: the missions rooms open with, and the rooms. */
export interface Lab {
  catalog: Pick<MissionCatalog, 'get' | 'default'>;
  manager: RoomManager;
}

/** Per-connection session, set once the socket joins, resumes or watches a room. */
interface Session {
  room: Room;
  /** the player's id; for an audience connection, its spectator id */
  playerId: string;
  /**
   * lets go of the room once the socket is gone: a player stays in the game and may resume,
   * the room pausing while they are away; an audience connection simply leaves
   */
  detach: () => void;
}

/**
 * Serves every connection of `server`: each message the socket sends is carried out in the
 * room it joined, resumed or watches, a refusal answered with an `error` — and once the
 * socket closes, for whatever reason, the room lets go of it.
 */
export function serveSockets(server: SocketServer, lab: Lab): void {
  server.on('connection', (socket) => {
    let session: Session | null = null;

    socket.on('message', (raw) => {
      try {
        const msg = parseClientMessage(String(raw));
        session = handleMessage(lab, socket, session, msg);
      } catch (err) {
        const message =
          err instanceof GameError || err instanceof Error ? err.message : 'Unbekannter Fehler.';
        send(socket, { kind: 'error', message });
      }
    });

    socket.on('close', () => {
      session?.detach();
    });
  });
}

function send(socket: PlayerSocket, msg: ServerMessage): void {
  socket.send(JSON.stringify(msg));
}

function handleMessage(
  lab: Lab,
  socket: PlayerSocket,
  session: Session | null,
  msg: ClientMessage,
): Session | null {
  switch (msg.kind) {
    case 'create-room':
    case 'join-room': {
      // A new room plays on the difficulty its host's device asked for — normal unless that
      // device has won no run yet — with its alarm limit: scaled from the start.
      const room = msg.kind === 'create-room' ? createRoom(lab, msg) : lab.manager.get(msg.code);
      const { playerId, token } = room.join(msg.name);
      send(socket, { kind: 'joined', code: room.code, playerId, token });
      const detach = room.attach(playerId, (m) => send(socket, m));
      return { room, playerId, detach };
    }
    case 'list-rooms':
      send(socket, { kind: 'rooms', rooms: lab.manager.list() });
      return session;
    case 'spectate': {
      const room = lab.manager.get(msg.code);
      // An audience connection goes by its spectator id: voice signals reach it by that.
      const { spectatorId, detach } = room.attachSpectator((m) => send(socket, m));
      return { room, playerId: spectatorId, detach };
    }
    case 'resume': {
      const room = lab.manager.get(msg.code);
      room.resume(msg.playerId, msg.token);
      send(socket, { kind: 'joined', code: room.code, playerId: msg.playerId, token: msg.token });
      const detach = room.attach(msg.playerId, (m) => send(socket, m));
      return { room, playerId: msg.playerId, detach };
    }
    case 'switch-mission': {
      const s = requireSession(session);
      const difficulty = s.room.difficulty;
      s.room.switchMission(
        s.playerId,
        scaleMission(lab.catalog.get(msg.missionId), difficulty),
        difficulty,
      );
      return s;
    }
    case 'select-difficulty': {
      const s = requireSession(session);
      // Rescale from the pristine mission, never from an already scaled one.
      s.room.switchMission(
        s.playerId,
        scaleMission(lab.catalog.get(s.room.missionId), msg.difficulty),
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
      s.room.setReady(s.playerId, msg.ready, nextMission(lab, s.room, msg.missionId));
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
function nextMission(lab: Lab, room: Room, missionId: string | undefined): Mission | null {
  return missionId === undefined
    ? null
    : scaleMission(lab.catalog.get(missionId), room.difficulty);
}

/** The room a create-room message opens: its mission from the catalog, at its difficulty. */
function createRoom(lab: Lab, msg: Extract<ClientMessage, { kind: 'create-room' }>): Room {
  const difficulty = msg.difficulty ?? 'normal';
  const mission =
    msg.missionId !== undefined ? lab.catalog.get(msg.missionId) : lab.catalog.default;
  return lab.manager.create(scaleMission(mission, difficulty), msg.seed ?? null, difficulty);
}

function requireSession(session: Session | null): Session {
  if (session === null) {
    throw new GameError('Noch in keinem Raum.');
  }
  return session;
}

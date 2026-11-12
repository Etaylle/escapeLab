import {
  GameError,
  parseClientMessage,
  scaleMission,
  type ClientMessage,
  type Mission,
  type ServerMessage,
} from '@escapelab/core';
import { MISSED_PINGS, SILENT_MS, type CutReason } from './heartbeat.js';
import type { MissionCatalog } from './missions.js';
import { GAME_KINDS, type GameMessage, type Room } from './room.js';
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
  /** who plays on it, as the log names them: the player's name, or the audience */
  who: () => string;
  /**
   * whether the session still holds: a player's seat may have gone to another socket that
   * showed its pass since; an audience connection holds as long as it is open
   */
  holds: () => boolean;
  /**
   * lets go of the room once the socket is gone: a player stays in the game and may resume,
   * the room pausing while they are away; an audience connection simply leaves
   */
  detach: () => void;
}

/** What serving the sockets hands back: the log's line for a socket the heartbeat cuts. */
export interface Served {
  /** Logs that the heartbeat cut `socket`, and why, naming its room and seat: none in no room. */
  cut: (socket: object, why: CutReason) => void;
}

/** Why the heartbeat cut a socket, as the log says it. */
const CUT_WHY: Record<CutReason, string> = {
  pongs: `${MISSED_PINGS} pings unanswered`,
  silent: `nothing heard for ${SILENT_MS / 1000} s`,
};

/**
 * Serves every connection of `server`: each message the socket sends is carried out in the
 * room it joined, resumed or watches, a refusal answered with an `error` naming the kind of
 * message it refuses — and once the socket closes, for whatever reason, the room lets go of it.
 */
export function serveSockets(server: SocketServer, lab: Lab): Served {
  const sessions = new WeakMap<object, () => Session | null>();
  server.on('connection', (socket) => {
    let session: Session | null = null;
    sessions.set(socket, () => session);

    socket.on('message', (raw) => {
      let msg: ClientMessage | null = null;
      try {
        msg = parseClientMessage(String(raw));
        session = handleMessage(lab, socket, session, msg);
      } catch (err) {
        const message =
          err instanceof GameError || err instanceof Error ? err.message : 'Unbekannter Fehler.';
        logRefusal(session, msg, message);
        const of = msg?.kind;
        send(socket, of === undefined ? { kind: 'error', message } : { kind: 'error', message, of });
      }
    });

    socket.on('close', () => {
      session?.detach();
    });
  });
  return {
    cut: (socket, why) => {
      const session = sessions.get(socket)?.() ?? null;
      if (session !== null) {
        const where = `room ${session.room.code}: ${session.who()}`;
        console.log(`[escapelab] ${where} cut by the heartbeat, ${CUT_WHY[why]}`);
      }
    },
  };
}

/**
 * The refusals the log names: a door that stayed shut, a seat not given up, the way on or the
 * call-off refused. The game's own refusals — a wrong input, a step too far — it leaves out.
 */
const LOGGED_REFUSALS: ReadonlySet<ClientMessage['kind']> = new Set([
  'create-room',
  'join-room',
  'resume',
  'spectate',
  'abandon',
  'continue-without',
  'call-off',
]);

/** Logs the refusal of `msg` with its `reason`, where the log names it (`LOGGED_REFUSALS`). */
function logRefusal(session: Session | null, msg: ClientMessage | null, reason: string): void {
  if (msg === null || !LOGGED_REFUSALS.has(msg.kind)) {
    return;
  }
  const code = 'code' in msg ? msg.code.toUpperCase() : session?.room.code;
  const where = code === undefined ? 'no room' : `room ${code}`;
  const by = 'name' in msg ? ` as ${msg.name}` : session === null ? '' : ` by ${session.who()}`;
  console.log(`[escapelab] ${where}: ${msg.kind}${by} refused, ${reason}`);
}

function send(socket: PlayerSocket, msg: ServerMessage): void {
  socket.send(JSON.stringify(msg));
}

/** Each socket's one way to hear its room: the same for every seat it sits down on. */
const listeners = new WeakMap<PlayerSocket, (msg: ServerMessage) => void>();

function listenerOf(socket: PlayerSocket): (msg: ServerMessage) => void {
  const known = listeners.get(socket);
  if (known !== undefined) {
    return known;
  }
  const listener = (msg: ServerMessage): void => send(socket, msg);
  listeners.set(socket, listener);
  return listener;
}

/**
 * What a socket may send whether or not it is in a room: to open, join, watch, resume or give
 * up a seat, or to ask where its pass sits, which rooms there are, what time it is.
 */
const DOOR_KINDS = [
  'create-room',
  'join-room',
  'list-rooms',
  'clock',
  'spectate',
  'resume',
  'whereami',
  'abandon',
  'tock',
] as const satisfies readonly ClientMessage['kind'][];

type AtTheDoor = Extract<ClientMessage, { kind: (typeof DOOR_KINDS)[number] }>;

const AT_THE_DOOR: ReadonlySet<ClientMessage['kind']> = new Set(DOOR_KINDS);

/** Whether `msg` is one a socket may send in no room (`AtTheDoor`). */
const fromTheDoor = (msg: ClientMessage): msg is AtTheDoor => AT_THE_DOOR.has(msg.kind);

function handleMessage(
  lab: Lab,
  socket: PlayerSocket,
  session: Session | null,
  msg: ClientMessage,
): Session | null {
  if (fromTheDoor(msg)) {
    return atTheDoor(lab, socket, session, msg);
  }
  // A seat that went to another socket takes nothing from this one any more.
  const held = session !== null && session.holds() ? session : null;
  // What the page streams supersedes itself: from no seat it goes nowhere, unanswered.
  return held === null && msg.kind === 'pos'
    ? null
    : inRoom(lab, socket, requireSession(held), msg);
}

/** A message a socket may send in no room: the session it opens, or the one it had. */
function atTheDoor(
  lab: Lab,
  socket: PlayerSocket,
  session: Session | null,
  msg: AtTheDoor,
): Session | null {
  switch (msg.kind) {
    case 'create-room':
    case 'join-room':
      return sitDown(lab, socket, session, msg);
    case 'abandon':
      return giveUp(lab, socket, session, msg);
    case 'spectate':
      return watch(lab, socket, session, msg.code);
    case 'resume': {
      const room = lab.manager.get(msg.code);
      return seated(socket, session, room, room.resume(msg.pass));
    }
    default:
      answer(lab, socket, msg);
      return session;
  }
}

/**
 * Answers what a socket asks at the door: where its pass sits, which rooms there are, the
 * time. Its `tock` needs no answer: the heartbeat heard it (heartbeat.ts).
 */
function answer(
  lab: Lab,
  socket: PlayerSocket,
  msg: Extract<AtTheDoor, { kind: 'whereami' | 'list-rooms' | 'clock' | 'tock' }>,
): void {
  switch (msg.kind) {
    case 'whereami':
      send(socket, { kind: 'seated', seat: lab.manager.whereIs(msg.pass) });
      break;
    case 'list-rooms':
      send(socket, { kind: 'rooms', rooms: lab.manager.list() });
      break;
    case 'clock':
      // The page's own time comes back as it was sent: only the round trip is the page's.
      send(socket, { kind: 'clock', sent: msg.sent, at: Date.now() });
      break;
    case 'tock':
      break;
  }
}

/** The audience connection a socket opens on the room `code`: the session it had let go of. */
function watch(lab: Lab, socket: PlayerSocket, session: Session | null, code: string): Session {
  const room = lab.manager.get(code);
  session?.detach();
  // An audience connection goes by its spectator id: voice signals reach it by that.
  const { spectatorId, detach } = room.attachSpectator((m) => send(socket, m));
  return { room, playerId: spectatorId, who: () => 'a spectator', holds: () => true, detach };
}

/**
 * A pass sits down in a room it opens or joins: on a seat of its own, or — where it holds one
 * there already, a second tab say — on that one again. A run on elsewhere binds it, which
 * refuses it, and a seat it holds in another lobby or after a run there it gives up.
 */
function sitDown(
  lab: Lab,
  socket: PlayerSocket,
  session: Session | null,
  msg: Extract<ClientMessage, { kind: 'create-room' | 'join-room' }>,
): Session {
  if (msg.kind === 'join-room') {
    const room = lab.manager.get(msg.code);
    lab.manager.makeWay(msg.pass, room);
    return seated(socket, session, room, seatFor(room, msg));
  }
  lab.manager.makeWay(msg.pass, null);
  // A new room plays on the difficulty its host's device asked for — normal unless that
  // device has won no run yet — with its alarm limit: scaled from the start.
  const room = createRoom(lab, msg);
  return seated(socket, session, room, room.join(msg.name, msg.pass).playerId);
}

/**
 * The seat a join sits down on, by player id: the one its pass holds already, a seat its name
 * takes over in a run on (`Room.takeOver`), else a new one — which the reducer refuses in a run.
 */
function seatFor(room: Room, msg: Extract<ClientMessage, { kind: 'join-room' }>): string {
  if (room.seatOf(msg.pass) !== null) {
    return room.resume(msg.pass);
  }
  if (room.phase === 'playing') {
    return room.takeOver(msg.name, msg.pass);
  }
  return room.join(msg.name, msg.pass).playerId;
}

/**
 * The seat a pass holds in a room is given up, asked for from whatever socket: the connection
 * the seat played on hears that it left — this one, or another, which this one is told as well.
 */
function giveUp(
  lab: Lab,
  socket: PlayerSocket,
  session: Session | null,
  msg: Extract<ClientMessage, { kind: 'abandon' }>,
): Session | null {
  const room = lab.manager.get(msg.code);
  const playerId = room.abandon(msg.pass);
  const own = session !== null && session.room === room && session.playerId === playerId;
  if (!own) {
    send(socket, { kind: 'left', code: room.code, message: null });
  }
  return own ? null : session;
}

/**
 * The session of a socket that sat down on the seat of `playerId` in `room`: it is told so, and
 * takes the room's views from now on. Whatever room it sat in before lets go of it first.
 */
function seated(
  socket: PlayerSocket,
  before: Session | null,
  room: Room,
  playerId: string,
): Session {
  if (before !== null && (before.room !== room || before.playerId !== playerId)) {
    before.detach();
  }
  send(socket, { kind: 'joined', code: room.code });
  const listener = listenerOf(socket);
  const detach = room.attach(playerId, listener);
  const who = (): string => room.nameOf(playerId);
  return { room, playerId, who, holds: () => room.plays(playerId, listener), detach };
}

const FOR_THE_GAME: ReadonlySet<ClientMessage['kind']> = new Set(GAME_KINDS);

/** Whether `msg` maps 1:1 onto a game action, which the room acts on (`Room.act`). */
const forTheGame = (msg: ClientMessage): msg is GameMessage => FOR_THE_GAME.has(msg.kind);

/** A message of a player in the room of session `s`, carried out there. */
function inRoom(
  lab: Lab,
  socket: PlayerSocket,
  s: Session,
  msg: Exclude<ClientMessage, AtTheDoor>,
): Session {
  if (forTheGame(msg)) {
    s.room.act(s.playerId, msg);
    return s;
  }
  switch (msg.kind) {
    case 'switch-mission': {
      const difficulty = s.room.difficulty;
      s.room.switchMission(
        s.playerId,
        scaleMission(lab.catalog.get(msg.missionId), difficulty),
        difficulty,
      );
      return s;
    }
    case 'select-difficulty':
      // Rescale from the pristine mission, never from an already scaled one.
      s.room.switchMission(
        s.playerId,
        scaleMission(lab.catalog.get(s.room.missionId), msg.difficulty),
        msg.difficulty,
      );
      return s;
    case 'ping':
      s.room.ping(s.playerId, msg.x, msg.y);
      return s;
    case 'chat':
      s.room.chat(s.playerId, msg.phrase, msg.value);
      return s;
    case 'rtc':
      s.room.relaySignal(s.playerId, msg.to, msg.signal);
      return s;
    case 'interact':
      // The press is taken where the player stood as they pressed; the views it changed go
      // out first, then the word that E was taken.
      s.room.interact(s.playerId, { x: msg.x, y: msg.y }, msg.t);
      send(socket, { kind: 'interacted' });
      return s;
    case 'pos': {
      const { x, y, facing, moving } = msg;
      s.room.updatePosition(s.playerId, msg.run, { x, y, facing, moving }, msg.t);
      return s;
    }
    case 'set-ready':
      s.room.setReady(s.playerId, msg.ready, nextMission(lab, s.room, msg.missionId));
      return s;
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

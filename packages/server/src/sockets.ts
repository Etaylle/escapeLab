import {
  GameError,
  parseClientMessage,
  scaleMission,
  type AccountView,
  type ClientMessage,
  type CrewPass,
  type Mission,
  type ServerMessage,
} from '@escapelab/core';
import type { AccountDesk, Gate } from './accounts.js';
import { MISSED_PINGS, SILENT_MS, type CutReason } from './heartbeat.js';
import type { MissionCatalog } from './missions.js';
import { readAddress, type Front, type Sender } from './rateLimiter.js';
import { GAME_KINDS, type GameMessage, type Room } from './room.js';
import type { RoomManager } from './roomManager.js';

/** What a connection needs of its socket: `ws`'s WebSocket has it. */
export interface PlayerSocket {
  send(data: string): void;
  on(event: 'message', listener: (data: unknown) => void): unknown;
  on(event: 'close', listener: (code?: number) => void): unknown;
}

/**
 * What the connections need of the WebSocket server: `ws`'s WebSocketServer has it, handing each
 * socket over with the request that opened it.
 */
export interface SocketServer {
  on(event: 'connection', listener: (socket: PlayerSocket, request?: Sender) => void): unknown;
}

/** What a connection's messages reach: the missions rooms open with, the rooms, the accounts. */
export interface Lab {
  catalog: Pick<MissionCatalog, 'get' | 'default'>;
  manager: RoomManager;
  /** the accounts of the passes (accounts.ts); without, no pass hears of an account */
  accounts?: AccountDesk;
  /**
   * how many new accounts each address may make (rateLimiter.ts, by `clientAddress`):
   * `ACCOUNTS_MADE_PER_MINUTE` in the server; none counted where unset
   */
  accountsMade?: { take: (address: string) => boolean };
  /**
   * how many changes to the accounts each socket may make a minute — a new name, another colour,
   * a deletion; an arrival changes nothing: `ACCOUNT_CHANGES_PER_SOCKET` in the server; none
   * counted where unset
   */
  changesPerSocket?: number;
  /** who stands in front of the server, which says where a socket's address is read; none unset */
  front?: Front;
}

/**
 * New accounts a minute an address may make (`Lab.accountsMade`): a lecture behind one address,
 * every student new, stays under it; a script making accounts gets one a second.
 */
export const ACCOUNTS_MADE_PER_MINUTE = 60;

/**
 * Changes to the accounts a minute a socket may make (`Lab.changesPerSocket`): a player's first
 * minute — a name typed in two goes, a few colours tried — makes a handful.
 */
export const ACCOUNT_CHANGES_PER_SOCKET = 30;

/** How long a socket's changes to the accounts count against it, ms. */
const CHANGES_WINDOW_MS = 60_000;

/**
 * How long a socket's colour clicks settle before the last of them is kept with its account, ms:
 * clicking through the colours makes one change, not one each.
 */
export const COLOUR_SETTLE_MS = 1000;

/** What a socket is told that shows a second pass: one socket speaks for one pass. */
export const ONE_PASS = 'Diese Verbindung gehört schon einem anderen Dienstausweis.';

/**
 * What a socket came in as: the address its new accounts count against, the pass it showed
 * first, and when it changed the accounts in the last minute.
 */
interface Door {
  address: string;
  pass: string | null;
  changes: number[];
}

/** Each socket's door (`Door`), from the request that opened it. */
const doors = new WeakMap<PlayerSocket, Door>();

/**
 * The colour a socket clicked last, while it settles (`COLOUR_SETTLE_MS`): the timer that keeps
 * it then, and how to keep it at once.
 */
interface Settling {
  timer: ReturnType<typeof setTimeout>;
  keep: () => void;
}

/** Each server's colours still settling, by socket: a server is known by the lab it serves. */
const settling = new WeakMap<Lab, Map<PlayerSocket, Settling>>();

/** The colours settling on the server of `lab`, by socket. */
function settlingOn(lab: Lab): Map<PlayerSocket, Settling> {
  const known = settling.get(lab);
  if (known !== undefined) {
    return known;
  }
  const colours = new Map<PlayerSocket, Settling>();
  settling.set(lab, colours);
  return colours;
}

/**
 * What the log says the first time a socket's address is read off the last X-Forwarded-For behind
 * Render: Cloudflare named none, so its own headers are not there, or not as expected.
 */
export const FORWARDED_NOTE =
  '[escapelab] behind Render a socket came without cf-connecting-ip or true-client-ip: ' +
  'its address read off the last X-Forwarded-For';

/**
 * The address `request` comes from (rateLimiter.ts `readAddress`), `unknown` for none; `noted` is
 * told where it was read off the last X-Forwarded-For.
 */
function addressOf(lab: Lab, request: Sender | undefined, noted: () => void): string {
  if (request === undefined) {
    return 'unknown';
  }
  const { address, from } = readAddress(request, lab.front ?? 'none');
  if (from === 'forwarded') {
    noted();
  }
  return address;
}

/**
 * Throws GameError(ONE_PASS) where `msg` shows a pass other than the first its socket showed: a
 * socket that may speak for any pass could make an account per message.
 */
function checkPass(socket: PlayerSocket, msg: ClientMessage): void {
  const door = doors.get(socket);
  if (door === undefined || !('pass' in msg)) {
    return;
  }
  door.pass ??= msg.pass.id;
  if (door.pass !== msg.pass.id) {
    throw new GameError(ONE_PASS);
  }
}

/** Whether `door` may change the accounts once more now (`Lab.changesPerSocket`), counted. */
function mayChange(lab: Lab, door: Door | undefined): boolean {
  const limit = lab.changesPerSocket;
  if (door === undefined || limit === undefined) {
    return true;
  }
  const now = Date.now();
  door.changes = door.changes.filter((at) => now - at < CHANGES_WINDOW_MS);
  if (door.changes.length >= limit) {
    return false;
  }
  door.changes.push(now);
  return true;
}

/**
 * What `socket` may write to the accounts (accounts.ts `Gate`): a new account counted by its
 * address (`Lab.accountsMade`), a change counted by the socket (`Lab.changesPerSocket`).
 */
function gateOf(lab: Lab, socket: PlayerSocket): Gate {
  const door = doors.get(socket);
  return {
    mayMake: () => lab.accountsMade?.take(door?.address ?? 'unknown') ?? true,
    mayChange: () => mayChange(lab, door),
  };
}

/**
 * A colour `socket` clicked for the account of `pass`: kept once the clicks have settled
 * (`COLOUR_SETTLE_MS`), the last of them — or at once where the server goes down before
 * (`Served.keepColours`) — and its socket told the account then.
 */
function keepColour(lab: Lab, socket: PlayerSocket, pass: CrewPass, color: string): void {
  const desk = lab.accounts;
  if (desk === undefined) {
    return;
  }
  const colours = settlingOn(lab);
  const before = colours.get(socket);
  if (before !== undefined) {
    clearTimeout(before.timer);
  }
  const keep = (): void => {
    colours.delete(socket);
    tellAccount(socket, desk.recolour(pass, color, gateOf(lab, socket)));
  };
  const timer = setTimeout(keep, COLOUR_SETTLE_MS);
  timer.unref();
  colours.set(socket, { timer, keep });
}

/** Per-connection session, set once the socket joins, resumes or watches a room. */
interface Session {
  room: Room;
  /** the player's id; for an audience connection, its spectator id */
  playerId: string;
  /** the pass the seat is bound to; null for an audience connection */
  pass: CrewPass | null;
  /** who plays on it, as the log names them: the player's name, or the audience */
  who: () => string;
  /**
   * whether the session still holds: a player's seat may have gone to another socket that
   * showed its pass since; an audience connection holds as long as it is open
   */
  holds: () => boolean;
  /**
   * lets go of the room once the socket is gone — `clean`ly, a tab closed or reloaded, or not:
   * a player stays in the game and may resume, the room pausing while they are away; an
   * audience connection simply leaves
   */
  detach: (clean?: boolean) => void;
}

/**
 * What serving the sockets hands back: the log's line for a socket the heartbeat cuts, and the
 * colours still settling, kept as the server goes down.
 */
export interface Served {
  /** Logs that the heartbeat cut `socket`, and why, naming its room and seat: none in no room. */
  cut: (socket: object, why: CutReason) => void;
  /**
   * Keeps at once every colour still settling (`COLOUR_SETTLE_MS`): one clicked in the last
   * second before the server goes down goes to the account all the same (AccountDesk `settled`).
   */
  keepColours: () => void;
}

/**
 * The close codes of a socket the page let go of: closed by the page itself (1000), or its tab
 * going away (1001) — closed or reloaded. A line that dropped or was cut ends without one.
 */
const CLEAN_CLOSE: ReadonlySet<number> = new Set([1000, 1001]);

/** Why the heartbeat cut a socket, as the log says it. */
const CUT_WHY: Record<CutReason, string> = {
  pongs: `${MISSED_PINGS} pings unanswered`,
  silent: `nothing heard for ${SILENT_MS / 1000} s`,
};

/**
 * Serves every connection of `server`: each message the socket sends is carried out in the
 * room it joined, resumed or watches — once more where it had to wait for the room (`hold`) — a
 * refusal answered with an `error` naming the kind of message it refuses; and once the socket
 * closes, for whatever reason, the room lets go of it.
 */
export function serveSockets(server: SocketServer, lab: Lab): Served {
  const sessions = new WeakMap<object, () => Session | null>();
  let forwardedNoted = false;
  const noteForwarded = (): void => {
    if (!forwardedNoted) {
      forwardedNoted = true;
      console.log(FORWARDED_NOTE);
    }
  };
  server.on('connection', (socket, request) => {
    let session: Session | null = null;
    sessions.set(socket, () => session);
    const address = addressOf(lab, request, noteForwarded);
    doors.set(socket, { address, pass: null, changes: [] });
    const take = (msg: ClientMessage): void => {
      try {
        checkPass(socket, msg);
        session = handleMessage(lab, socket, session, msg, () => take(msg));
      } catch (err) {
        refuse(socket, session, msg, err);
      }
    };

    socket.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = parseClientMessage(String(raw));
      } catch (err) {
        refuse(socket, session, null, err);
        return;
      }
      take(msg);
    });

    socket.on('close', (code) => {
      asks.get(socket)?.();
      holds.get(socket)?.();
      session?.detach(code !== undefined && CLEAN_CLOSE.has(code));
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
    keepColours: () => {
      for (const { timer, keep } of [...settlingOn(lab).values()]) {
        clearTimeout(timer);
        keep();
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
  'delete-account',
  'continue-without',
  'call-off',
  'takeover-answer',
]);

/** `msg` refused on `socket` for `err`, null for one that could not be read: told, and logged. */
function refuse(
  socket: PlayerSocket,
  session: Session | null,
  msg: ClientMessage | null,
  err: unknown,
): void {
  const message =
    err instanceof GameError || err instanceof Error ? err.message : 'Unbekannter Fehler.';
  logRefusal(session, msg, message);
  const refusal: Extract<ServerMessage, { kind: 'error' }> = { kind: 'error', message };
  send(socket, msg === null ? refusal : { ...refusal, of: msg.kind });
}

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

/** The ask for a seat each socket waits on (`Room.claim`), by how to withdraw it. */
const asks = new WeakMap<PlayerSocket, () => void>();

/** The room each socket waits for, the server about to take it up again (`hold`): how to stop. */
const holds = new WeakMap<PlayerSocket, () => void>();

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
 * up a seat, to ask where its pass sits, which rooms there are, what time it is, or to change or
 * delete the pass's account.
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
  'profile',
  'delete-account',
  'my-runs',
  'tock',
] as const satisfies readonly ClientMessage['kind'][];

type AtTheDoor = Extract<ClientMessage, { kind: (typeof DOOR_KINDS)[number] }>;

const AT_THE_DOOR: ReadonlySet<ClientMessage['kind']> = new Set(DOOR_KINDS);

/** Whether `msg` is one a socket may send in no room (`AtTheDoor`). */
const fromTheDoor = (msg: ClientMessage): msg is AtTheDoor => AT_THE_DOOR.has(msg.kind);

/**
 * `msg` carried out on `socket`: the session it leaves the socket with. `again` carries it out
 * once more, for a socket that waits for its room (`hold`).
 */
function handleMessage(
  lab: Lab,
  socket: PlayerSocket,
  session: Session | null,
  msg: ClientMessage,
  again: () => void,
): Session | null {
  if (fromTheDoor(msg)) {
    return atTheDoor(lab, socket, session, msg, again);
  }
  // A seat that went to another socket takes nothing from this one any more.
  const held = session !== null && session.holds() ? session : null;
  // What the page streams supersedes itself: from no seat it goes nowhere, unanswered.
  return held === null && msg.kind === 'pos'
    ? null
    : inRoom(lab, socket, requireSession(held), msg);
}

/**
 * A message a socket may send in no room: the session it opens, or the one it had. A seat given
 * up, or the audience asked for, in a room the server is about to take up again waits for the
 * room (`hold`).
 */
function atTheDoor(
  lab: Lab,
  socket: PlayerSocket,
  session: Session | null,
  msg: AtTheDoor,
  again: () => void,
): Session | null {
  if (askOfAccount(msg)) {
    answerAccount(lab, socket, msg);
    return session;
  }
  switch (msg.kind) {
    case 'create-room':
    case 'join-room':
      return sitDown(lab, socket, session, msg);
    case 'abandon':
    case 'spectate':
      return lab.manager.waitsFor(msg.code)
        ? hold(lab, socket, session, msg.code, again)
        : leaveOrWatch(lab, socket, session, msg);
    case 'resume':
      return comeBack(lab, socket, session, msg, again);
    default:
      answer(lab, socket, msg);
      return session;
  }
}

/** A seat given up (`giveUp`), or the audience joined (`watch`), in a room that is there. */
function leaveOrWatch(
  lab: Lab,
  socket: PlayerSocket,
  session: Session | null,
  msg: Extract<ClientMessage, { kind: 'abandon' | 'spectate' }>,
): Session | null {
  return msg.kind === 'abandon'
    ? giveUp(lab, socket, session, msg)
    : watch(lab, socket, session, msg.code);
}

/** What a socket is told of an account that is gone, or that a store could not reach. */
const ACCOUNT_AWAY = 'Das Konto ist gerade nicht erreichbar.';

/** What a socket is told that asks after an account where the server keeps none. */
const NO_ACCOUNTS = 'Konten führt dieser Server nicht.';

/** Why `err` came, on one line, for the log. */
const whyOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * The account of the pass `job` came to, told its socket once it is there (`account`): the
 * account a seat taken, a seat come back to, a question where the pass sits or a colour chosen
 * brings with it. A failure the log says, and the socket hears nothing — what it came with
 * stands all the same.
 */
function tellAccount(socket: PlayerSocket, job: Promise<AccountView | null> | undefined): void {
  job?.then(
    (account) => {
      if (account !== null) {
        send(socket, { kind: 'account', account });
      }
    },
    (err: unknown) => console.error(`[escapelab] an account not told its pass: ${whyOf(err)}`),
  );
}

/** What a pass asks of its account: its name, that it go, the runs it played. */
type AccountAsk = Extract<ClientMessage, { kind: 'profile' | 'delete-account' | 'my-runs' }>;

const ACCOUNT_ASKS: ReadonlySet<ClientMessage['kind']> = new Set([
  'profile',
  'delete-account',
  'my-runs',
] satisfies AccountAsk['kind'][]);

/** Whether `msg` asks something of its pass's account (`AccountAsk`). */
const askOfAccount = (msg: ClientMessage): msg is AccountAsk => ACCOUNT_ASKS.has(msg.kind);

/**
 * What a pass asked of its account — its name (`profile`), that it go (`delete-account`), the
 * runs it played (`my-runs`) — done, and answered once it is: the account as it stands, none
 * once deleted, the runs; refused where it cannot be done, saying why: a store out of reach in
 * the lab's words, the log saying more.
 */
function answerAccount(lab: Lab, socket: PlayerSocket, msg: AccountAsk): void {
  if (lab.accounts === undefined) {
    refuse(socket, null, msg, new GameError(NO_ACCOUNTS));
    return;
  }
  // Reading the runs changes nothing; a new name or a deletion counts against the socket.
  answerOf(lab.accounts, msg, gateOf(lab, socket)).then(
    (answer) => send(socket, answer),
    (err: unknown) => {
      if (!(err instanceof GameError)) {
        console.error(`[escapelab] ${msg.kind} not done: ${whyOf(err)}`);
      }
      refuse(socket, null, msg, err instanceof GameError ? err : new GameError(ACCOUNT_AWAY));
    },
  );
}

/** What `desk` answers `msg` with, once it has done it (`answerAccount`). */
function answerOf(desk: AccountDesk, msg: AccountAsk, gate: Gate): Promise<ServerMessage> {
  switch (msg.kind) {
    case 'profile':
      return desk
        .rename(msg.pass, msg.name.trim(), gate)
        .then((account) => ({ kind: 'account', account }));
    case 'delete-account':
      return desk.delete(msg.pass, gate).then(() => {
        console.log('[escapelab] an account was deleted, as its pass asked');
        return { kind: 'account', account: null };
      });
    case 'my-runs':
      return desk.runsOf(msg.pass).then(({ runs, total }) => ({ kind: 'my-runs', runs, total }));
  }
}

/**
 * A pass back on its seat in room `msg.code`, with the snapshot its page keeps, which a server
 * that knows the room no more takes it up again from (`RoomManager.roomFor`): at once, or once
 * the newest snapshot of the crew's is in (`hold`).
 */
function comeBack(
  lab: Lab,
  socket: PlayerSocket,
  session: Session | null,
  msg: Extract<ClientMessage, { kind: 'resume' }>,
  again: () => void,
): Session | null {
  const room = lab.manager.roomFor(msg.code, msg.pass, msg.blob);
  if (room === null) {
    return hold(lab, socket, session, msg.code, again);
  }
  const back = seated(socket, session, room, room.resume(msg.pass), msg.pass);
  // A pass that comes back to a seat before it has an account starts one with the seat's name.
  const seat = room.playerOf(back.playerId);
  const profile = { displayName: seat?.name ?? '', colour: seat?.color ?? null };
  tellAccount(socket, lab.accounts?.arrive(msg.pass, profile, null, gateOf(lab, socket)));
  return back;
}

/**
 * `socket` waits for the room `code`, which the server takes up again once the newest snapshot
 * of it is in (`RoomManager.awaitRoom`): it is told so (`restoring`), and what it asked for goes
 * again (`again`) once the room is back — unless it closed, or waits for a room anew, first. Its
 * session stays as it was meanwhile.
 */
function hold(
  lab: Lab,
  socket: PlayerSocket,
  session: Session | null,
  code: string,
  again: () => void,
): Session | null {
  holds.get(socket)?.();
  holds.set(socket, lab.manager.awaitRoom(code, again));
  send(socket, { kind: 'restoring', code: code.toUpperCase() });
  return session;
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
      whereAmI(lab, socket, msg);
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

/**
 * Where the pass of `msg` sits, answered at once, and its account told once it is there: found,
 * or made with the name and the colour the device kept.
 */
function whereAmI(
  lab: Lab,
  socket: PlayerSocket,
  msg: Extract<ClientMessage, { kind: 'whereami' }>,
): void {
  send(socket, { kind: 'seated', seat: lab.manager.whereIs(msg.pass) });
  const kept = { displayName: msg.name?.trim() ?? '', colour: msg.color ?? null };
  tellAccount(socket, lab.accounts?.arrive(msg.pass, kept, null, gateOf(lab, socket)));
}

/** The audience connection a socket opens on the room `code`: the session it had let go of. */
function watch(lab: Lab, socket: PlayerSocket, session: Session | null, code: string): Session {
  const room = lab.manager.get(code);
  session?.detach();
  // An audience connection goes by its spectator id: voice signals reach it by that.
  const { spectatorId, detach } = room.attachSpectator((m) => send(socket, m));
  const who = (): string => 'a spectator';
  return { room, playerId: spectatorId, pass: null, who, holds: () => true, detach };
}

/**
 * A pass sits down in a room it opens or joins: on a seat of its own — in its account's colour
 * where nobody wears it yet — or, where it holds one there already, a second tab say, on that
 * one again. A run on elsewhere binds it, which refuses it, and a seat it holds in another lobby
 * or after a run there it gives up. A join by the name of a seat in the run on asks the crew to
 * let this device in (`Room.claim`): the socket waits, its session as it was. Its account goes
 * by the name it sat down under from now on.
 */
function sitDown(
  lab: Lab,
  socket: PlayerSocket,
  session: Session | null,
  msg: Extract<ClientMessage, { kind: 'create-room' | 'join-room' }>,
): Session | null {
  const next = takeSeat(lab, socket, session, msg);
  const profile = { displayName: msg.name.trim(), colour: msg.color ?? null };
  const gate = gateOf(lab, socket);
  tellAccount(socket, lab.accounts?.arrive(msg.pass, profile, profile.displayName, gate));
  return next;
}

/** The seat a create or a join sits down on (`sitDown`): the session it leaves the socket with. */
function takeSeat(
  lab: Lab,
  socket: PlayerSocket,
  session: Session | null,
  msg: Extract<ClientMessage, { kind: 'create-room' | 'join-room' }>,
): Session | null {
  if (msg.kind === 'join-room') {
    const room = lab.manager.get(msg.code);
    lab.manager.checkWay(msg.pass, room);
    if (room.seatOf(msg.pass) === null && room.phase === 'playing' && room.hasSeat(msg.name)) {
      asks.get(socket)?.();
      asks.set(socket, room.claim(msg.name, msg.pass, listenerOf(socket)));
      return session;
    }
    const playerId = seatFor(room, msg);
    lab.manager.leaveOthers(msg.pass, room);
    return seated(socket, session, room, playerId, msg.pass);
  }
  lab.manager.checkWay(msg.pass, null);
  // A new room plays on the difficulty its host's device asked for — normal unless that
  // device has won no run yet — with its alarm limit: scaled from the start.
  const room = createRoom(lab, msg);
  const { playerId } = room.join(msg.name, msg.pass, msg.color);
  lab.manager.leaveOthers(msg.pass, room);
  return seated(socket, session, room, playerId, msg.pass);
}

/**
 * The seat a join sits down on, by player id: the one its pass holds already, else a new one —
 * which the reducer refuses in a run.
 */
function seatFor(room: Room, msg: Extract<ClientMessage, { kind: 'join-room' }>): string {
  return room.seatOf(msg.pass) !== null
    ? room.resume(msg.pass)
    : room.join(msg.name, msg.pass, msg.color).playerId;
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
  // The socket the seat plays on, asked before the seat is gone: one it went from is not.
  const own =
    session !== null &&
    session.room === room &&
    session.holds() &&
    room.seatOf(msg.pass) === session.playerId;
  room.abandon(msg.pass);
  if (!own) {
    send(socket, { kind: 'left', code: room.code, message: null });
  }
  return own ? null : session;
}

/**
 * The session of a socket that sat down on the seat of `playerId` in `room`, bound to `pass`: it
 * is told so, and takes the room's views from now on. Whatever room it sat in before lets go of
 * it first.
 */
function seated(
  socket: PlayerSocket,
  before: Session | null,
  room: Room,
  playerId: string,
  pass: CrewPass,
): Session {
  if (before !== null && (before.room !== room || before.playerId !== playerId)) {
    before.detach();
  }
  send(socket, { kind: 'joined', code: room.code });
  const listener = listenerOf(socket);
  const detach = room.attach(playerId, listener);
  const who = (): string => room.nameOf(playerId);
  return { room, playerId, pass, who, holds: () => room.plays(playerId, listener), detach };
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
    act(lab, socket, s, msg);
    return s;
  }
  switch (msg.kind) {
    case 'switch-mission':
    case 'select-difficulty':
    case 'set-ready':
      chooseMission(lab, s, msg);
      return s;
    case 'interact':
    case 'pos':
      step(socket, s, msg);
      return s;
    default:
      toTheOthers(s, msg);
      return s;
  }
}

/**
 * A game action of the player of `s`, which the room acts on. A colour chosen in a lobby is the
 * account's from now on: the next lobby starts in it.
 */
function act(lab: Lab, socket: PlayerSocket, s: Session, msg: GameMessage): void {
  s.room.act(s.playerId, msg);
  if (msg.kind === 'select-color' && s.pass !== null) {
    keepColour(lab, socket, s.pass, msg.color);
  }
}

/** The mission the room plays, picked in the lobby — or the next run's, the host's yes to it. */
function chooseMission(
  lab: Lab,
  s: Session,
  msg: Extract<ClientMessage, { kind: 'switch-mission' | 'select-difficulty' | 'set-ready' }>,
): void {
  switch (msg.kind) {
    case 'switch-mission': {
      const difficulty = s.room.difficulty;
      s.room.switchMission(
        s.playerId,
        scaleMission(lab.catalog.get(msg.missionId), difficulty),
        difficulty,
      );
      return;
    }
    case 'select-difficulty':
      // Rescale from the pristine mission, never from an already scaled one.
      s.room.switchMission(
        s.playerId,
        scaleMission(lab.catalog.get(s.room.missionId), msg.difficulty),
        msg.difficulty,
      );
      return;
    case 'set-ready':
      s.room.setReady(s.playerId, msg.ready, nextMission(lab, s.room, msg.missionId));
      return;
  }
}

/** Where the player of `s` stands, as the page streams it, or what they pressed E on there. */
function step(
  socket: PlayerSocket,
  s: Session,
  msg: Extract<ClientMessage, { kind: 'interact' | 'pos' }>,
): void {
  if (msg.kind === 'interact') {
    // The press is taken where the player stood as they pressed; the views it changed go out
    // first, then the word that E was taken.
    s.room.interact(s.playerId, { x: msg.x, y: msg.y }, msg.t);
    send(socket, { kind: 'interacted' });
    return;
  }
  const { x, y, facing, moving } = msg;
  s.room.updatePosition(s.playerId, msg.run, { x, y, facing, moving }, msg.t);
}

/** What the player of `s` says to the rest of the room: a ping, a chat, a voice signal, a yes. */
function toTheOthers(
  s: Session,
  msg: Extract<ClientMessage, { kind: 'ping' | 'chat' | 'rtc' | 'takeover-answer' }>,
): void {
  switch (msg.kind) {
    case 'ping':
      s.room.ping(s.playerId, msg.x, msg.y);
      return;
    case 'chat':
      s.room.chat(s.playerId, msg.phrase, msg.value);
      return;
    case 'rtc':
      s.room.relaySignal(s.playerId, msg.to, msg.signal);
      return;
    case 'takeover-answer':
      s.room.answerTakeover(s.playerId, msg.seat, msg.allow);
      return;
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

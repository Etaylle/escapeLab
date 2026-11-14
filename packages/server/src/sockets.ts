import { randomBytes } from 'node:crypto';
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
import { UNLIMITED, type AccountDesk, type Arrival, type Gate, type Tries } from './accounts.js';
import { MISSED_PINGS, SILENT_MS, type CutReason } from './heartbeat.js';
import type { SignInGuard } from './login.js';
import type { MissionCatalog } from './missions.js';
import { readAddress, type Front, type Sender } from './rateLimiter.js';
import { GAME_KINDS, type GameMessage, type LineEnd, type Room } from './room.js';
import type { RoomManager } from './roomManager.js';
import { secretHashOf } from './store/store.js';

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
  /**
   * the limits on trying a Kennwort, by address and by Ausweisnummer (login.ts `SignInGuard`):
   * one for the server; none counted where unset
   */
  signIns?: Pick<SignInGuard, 'refusal' | 'wrong' | 'right'>;
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

/** What `socket`'s tries at a Kennwort may still do (accounts.ts `Tries`): by its address. */
function triesOf(lab: Lab, socket: PlayerSocket): Tries {
  const guard = lab.signIns;
  if (guard === undefined) {
    return UNLIMITED;
  }
  const address = doors.get(socket)?.address ?? 'unknown';
  return {
    refusal: (number) => guard.refusal(address, number),
    wrong: (number) => guard.wrong(address, number),
    right: (number) => guard.right(number),
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
   * lets go of the room once the socket is gone, or the player went to the main menu, as `end`
   * says (`LineEnd`; a drop where it says nothing): a player stays in the game and may resume,
   * the room pausing while they are away; an audience connection simply leaves
   */
  detach: (end?: LineEnd) => void;
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
      session?.detach(code !== undefined && CLEAN_CLOSE.has(code) ? 'closed' : 'dropped');
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
  'set-password',
  'change-password',
  'sign-in',
  'sign-out',
  'switch-account',
  'tock',
] as const satisfies readonly ClientMessage['kind'][];

type AtTheDoor = Extract<ClientMessage, { kind: (typeof DOOR_KINDS)[number] }>;

const AT_THE_DOOR: ReadonlySet<ClientMessage['kind']> = new Set(DOOR_KINDS);

/** Whether `msg` is one a socket may send in no room (`AtTheDoor`). */
const fromTheDoor = (msg: ClientMessage): msg is AtTheDoor => AT_THE_DOOR.has(msg.kind);

/**
 * What a player's own menu says of their seat: the pause menu opened or closed over the run, or
 * the player off to the main menu, the seat kept.
 */
const MENU_KINDS = ['pause-menu', 'to-menu'] as const satisfies readonly ClientMessage['kind'][];

type FromTheMenu = Extract<ClientMessage, { kind: (typeof MENU_KINDS)[number] }>;

const FROM_THE_MENU: ReadonlySet<ClientMessage['kind']> = new Set(MENU_KINDS);

/** Whether `msg` comes from the player's own menu (`FromTheMenu`). */
const fromTheMenu = (msg: ClientMessage): msg is FromTheMenu => FROM_THE_MENU.has(msg.kind);

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
  if (fromTheMenu(msg)) {
    return atTheMenu(socket, requireSession(held), msg);
  }
  // What the page streams supersedes itself: from no seat it goes nowhere, unanswered.
  return held === null && msg.kind === 'pos'
    ? null
    : inRoom(lab, socket, requireSession(held), msg);
}

/**
 * What the player's own menu says of the seat of session `s` (`FromTheMenu`): the pause menu
 * opened or closed over the run, which the crew sees; or the player off to the main menu — the
 * seat's line closes on purpose, the seat kept (`LineEnd` menu), and the socket, told so
 * (`at-menu`), stays at the door. The session it leaves the socket with.
 */
function atTheMenu(socket: PlayerSocket, s: Session, msg: FromTheMenu): Session | null {
  if (msg.kind === 'pause-menu') {
    s.room.setMenu(s.playerId, msg.open);
    return s;
  }
  s.detach('menu');
  send(socket, { kind: 'at-menu', code: s.room.code });
  return null;
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

/** Why `err` came, on one line, for the log: a Kennwort's hash in it never shows. */
const whyOf = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).replace(/scrypt\$\S+/g, 'scrypt$…');

/** What a sign-in is told while a run on binds its pass. */
export const BOUND_SIGN_IN =
  'Ein laufender Einsatz bindet diesen Dienstausweis: Anmelden erst danach.';

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

/**
 * The account `pass` came to (accounts.ts `Arrival`), told its socket as `tellAccount` does — and
 * every seat the pass holds bound to it (`RoomManager.bindAccount`), which any other device of the
 * account takes back from then on; `then` hears of the account after.
 */
function tellArrival(
  lab: Lab,
  socket: PlayerSocket,
  pass: CrewPass,
  job: Promise<Arrival | null> | undefined,
  then: (arrival: Arrival) => void = () => undefined,
): void {
  const told = job?.then((arrival) => {
    if (arrival !== null) {
      lab.manager.bindAccount(pass, arrival.id);
      then(arrival);
    }
    return arrival?.view ?? null;
  });
  tellAccount(socket, told);
}

/**
 * What a pass asks of its account: its name, that it go, the runs it played — and its Kennwort
 * set or changed, or to sign into an account (`LoginAsk`).
 */
type AccountAsk = Extract<
  ClientMessage,
  { kind: 'profile' | 'delete-account' | 'my-runs' | LoginAsk['kind'] }
>;

/**
 * What a pass asks of a login: its Kennwort set or changed, to sign into an account or out of
 * its own, or the device to switch accounts.
 */
type LoginAsk = Extract<
  ClientMessage,
  { kind: 'set-password' | 'change-password' | 'sign-in' | 'sign-out' | 'switch-account' }
>;

const LOGIN_KINDS = [
  'set-password',
  'change-password',
  'sign-in',
  'sign-out',
  'switch-account',
] as const satisfies readonly LoginAsk['kind'][];

const ACCOUNT_ASKS: ReadonlySet<ClientMessage['kind']> = new Set([
  'profile',
  'delete-account',
  'my-runs',
  ...LOGIN_KINDS,
] satisfies AccountAsk['kind'][]);

const LOGIN_ASKS: ReadonlySet<ClientMessage['kind']> = new Set(LOGIN_KINDS);

/** Whether `msg` asks something of a login (`LoginAsk`). */
const askOfLogin = (msg: AccountAsk): msg is LoginAsk => LOGIN_ASKS.has(msg.kind);

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
  // Reading the runs changes nothing; a new name, a deletion or a try at a Kennwort counts
  // against the socket.
  const gate = gateOf(lab, socket);
  const answer = askOfLogin(msg)
    ? answerLogin(lab, lab.accounts, msg, { gate, tries: triesOf(lab, socket) })
    : answerOf(lab.accounts, msg, gate);
  answer.then(
    (answer) => send(socket, answer),
    (err: unknown) => {
      if (!(err instanceof GameError)) {
        console.error(`[escapelab] ${msg.kind} not done: ${whyOf(err)}`);
      }
      refuse(socket, null, msg, err instanceof GameError ? err : new GameError(ACCOUNT_AWAY));
    },
  );
}

/** What a socket's asks of a login are held to: its gate, and its tries at a Kennwort. */
interface Limits {
  gate: Gate;
  tries: Tries;
}

/** The answer that says `done` was done, the account of the pass now `account`. */
const told =
  (done: 'set' | 'changed' | 'signed-in' | 'switched') =>
  (account: AccountView): ServerMessage => ({ kind: 'login', done, account });

/** What `desk` answers `msg`, an ask of a login, with once it has done it (`answerAccount`). */
function answerLogin(
  lab: Lab,
  desk: AccountDesk,
  msg: LoginAsk,
  limits: Limits,
): Promise<ServerMessage> {
  const { gate, tries } = limits;
  switch (msg.kind) {
    case 'set-password':
      return desk.setPassword(msg.pass, msg.password, gate).then(told('set'));
    case 'change-password':
      return desk
        .changePassword(msg.pass, msg.old, msg.password, gate, tries)
        .then(told('changed'));
    case 'sign-in':
      return signIn(lab, desk, msg, limits);
    case 'sign-out':
      return signOut(lab, desk, msg.pass, gate);
    case 'switch-account':
      return switchAccount(lab, desk, msg, limits);
  }
}

/**
 * The pass of `msg` signed into an account (`AccountDesk.signIn`): refused while a run on binds
 * it, before any Kennwort is tried; the seats it holds — a lobby's — are the account's then.
 */
async function signIn(
  lab: Lab,
  desk: AccountDesk,
  msg: Extract<ClientMessage, { kind: 'sign-in' }>,
  { gate, tries }: Limits,
): Promise<ServerMessage> {
  if (lab.manager.whereIs(msg.pass)?.phase === 'playing') {
    throw new GameError(BOUND_SIGN_IN);
  }
  const arrival = await desk.signIn(msg.pass, msg.login, msg.password, gate, tries);
  lab.manager.bindAccount(msg.pass, arrival.id);
  return told('signed-in')(arrival.view);
}

/** The hash of a secret nobody holds: made up here, and forgotten at once (store `Leaving`). */
const nobodysHash = (): string => secretHashOf(randomBytes(32).toString('hex'));

/**
 * `pass` signed out of its account (`AccountDesk.signOut`, rule 4): a seat it holds stays the
 * account's, its line dropped (`RoomManager.parkSeats`), under the hash of a secret nobody holds.
 */
async function signOut(
  lab: Lab,
  desk: AccountDesk,
  pass: CrewPass,
  gate: Gate,
): Promise<ServerMessage> {
  const parked = lab.manager.holdsSeat(pass) ? nobodysHash() : null;
  const accountId = await desk.signOut(pass, parked, gate);
  if (parked !== null && accountId !== null) {
    lab.manager.parkSeats(pass, parked, accountId);
  }
  return { kind: 'login', done: 'signed-out', account: null };
}

/**
 * The device of `msg` switched accounts on its new pass (`AccountDesk.switchAccount`): a seat the
 * old pass holds stays the old account's, as at a sign-out.
 */
async function switchAccount(
  lab: Lab,
  desk: AccountDesk,
  msg: Extract<ClientMessage, { kind: 'switch-account' }>,
  { gate, tries }: Limits,
): Promise<ServerMessage> {
  const parked = lab.manager.holdsSeat(msg.pass) ? nobodysHash() : null;
  const login = { typed: msg.login, password: msg.password, parked };
  const { arrival, left } = await desk.switchAccount(msg.pass, msg.next, login, gate, tries);
  if (parked !== null && left !== null) {
    lab.manager.parkSeats(msg.pass, parked, left);
  }
  return told('switched')(arrival.view);
}

/** What `desk` answers `msg` with, once it has done it (`answerAccount`). */
function answerOf(
  desk: AccountDesk,
  msg: Exclude<AccountAsk, LoginAsk>,
  gate: Gate,
): Promise<ServerMessage> {
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
  const known = lookedUp(socket, msg);
  const room = known?.room ?? lab.manager.roomFor(msg.code, msg.pass, msg.blob);
  if (room === null) {
    return hold(lab, socket, session, msg.code, again);
  }
  const playerId = seatBack(lab, socket, room, msg, { known, again });
  if (playerId === null) {
    return session;
  }
  const back = seated(socket, session, room, playerId, msg.pass);
  // A pass that comes back to a seat before it has an account starts one with the seat's name.
  const seat = room.playerOf(back.playerId);
  const profile = { displayName: seat?.name ?? '', colour: seat?.color ?? null };
  const arrival = lab.accounts?.arrive(msg.pass, profile, null, gateOf(lab, socket));
  tellArrival(lab, socket, msg.pass, arrival);
  return back;
}

/**
 * The account of a resume's pass as the store said it, for that resume to go on with (`seatBack`):
 * the room it comes back to, and the account — null for none, or for none to be had.
 */
interface LookedUp {
  code: string;
  passId: string;
  room: Room;
  accountId: string | null;
}

/** Each socket's resume that waits for the store to say the account of its pass (`LookedUp`). */
const lookups = new WeakMap<PlayerSocket, LookedUp>();

/** The lookup `socket` waited for with `msg` (`LookedUp`), taken once; undefined for none. */
function lookedUp(
  socket: PlayerSocket,
  msg: Extract<ClientMessage, { kind: 'resume' }>,
): LookedUp | undefined {
  const known = lookups.get(socket);
  lookups.delete(socket);
  const same = known?.passId === msg.pass.id && known.code === msg.code.toUpperCase();
  return same ? known : undefined;
}

/**
 * The seat `msg.pass` comes back to in `room`, by player id: its own — else, where seats here are
 * bound to accounts, the seat of the pass's account, without the crew's yes (`Room.takeBack`).
 * The account is asked of the store first (`known`), and the resume goes `again` once it said:
 * null meanwhile. Throws as `Room.resume` does where the pass comes back to neither.
 */
function seatBack(
  lab: Lab,
  socket: PlayerSocket,
  room: Room,
  msg: Extract<ClientMessage, { kind: 'resume' }>,
  waiting: { known: LookedUp | undefined; again: () => void },
): string | null {
  const desk = lab.accounts;
  if (room.seatOf(msg.pass) !== null || desk === undefined || !room.holdsAccounts) {
    return room.resume(msg.pass);
  }
  const { known, again } = waiting;
  if (known === undefined) {
    const looked = (accountId: string | null): void => {
      lookups.set(socket, { code: room.code, passId: msg.pass.id, room, accountId });
      again();
    };
    desk.accountIdOf(msg.pass).then(looked, () => looked(null));
    return null;
  }
  const taken = known.accountId === null ? null : room.takeBack(msg.pass, known.accountId);
  return taken ?? room.resume(msg.pass);
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
  const seat = lab.manager.whereIs(msg.pass);
  send(socket, { kind: 'seated', seat });
  const kept = { displayName: msg.name?.trim() ?? '', colour: msg.color ?? null };
  const arrival = lab.accounts?.arrive(msg.pass, kept, null, gateOf(lab, socket));
  tellArrival(lab, socket, msg.pass, arrival, ({ id }) => {
    // A run on with a seat of the account's — another of its devices sat down on it — is this
    // pass's too: its card says so, as the account comes.
    const ours = lab.manager.whereIs(msg.pass, id);
    if (ours !== null && ours.code !== seat?.code) {
      send(socket, { kind: 'seated', seat: ours });
    }
  });
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
  const arrival = lab.accounts?.arrive(msg.pass, profile, profile.displayName, gate);
  tellArrival(lab, socket, msg.pass, arrival);
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
  msg: Exclude<ClientMessage, AtTheDoor | FromTheMenu>,
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

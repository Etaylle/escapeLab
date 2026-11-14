import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type {
  AccountView,
  ClientMessage,
  CrewPass,
  DronePosition,
  LoginDone,
  PlayerView,
  RoomSummary,
  RtcSignal,
  Seat,
  ServerMessage,
  SpectatorView,
} from '@escapelab/core';
import { fillEarned, forgetEarned } from './achievements.js';
import { askForTime, clock, localNow } from './clock.js';
import { keepConnected, wipesBanner, type Line, type LineStatus, type Retry } from './line.js';
import { forgetNotes, localStore } from './notes.js';
import type { Loaded } from './runStats.js';
import { adoptPass, crewPass, followPass, forgetProfile, keepProfile, mintPass } from './pass.js';
import {
  dropSnapshot,
  dropSnapshots,
  keepSnapshot,
  keptSeat,
  keptSnapshot,
  resumeOf,
  seatShown,
} from './snapshots.js';
import { comebackOfTab, keepTab, leaveTab, roomOfTab, spendInvite, tabRoom } from './tab.js';
import type { KnownPositions } from './world/movement.js';

/** A refusal of the server's: how many it has made so far, its words, what it refused. */
export interface Refusal {
  seq: number;
  message: string;
  /** the kind of message refused; null where the server could not read it */
  of: ClientMessage['kind'] | null;
}

/**
 * What is refused where the player looks — at the device they work (its head), at the prompt
 * they pressed E on (the pill), on „Meine Einsätze" asked for its runs, in the settings asked to
 * delete the account or to do something of its login — and not in the banner over the screen,
 * which lies under a device and away from the prompt, and would say it twice.
 */
const ANSWERED_IN_PLACE: ReadonlySet<ClientMessage['kind']> = new Set([
  'puzzle-input',
  'interact',
  'open-source',
  'my-runs',
  'delete-account',
  'set-password',
  'change-password',
  'sign-in',
  'sign-out',
  'switch-account',
]);

/** Whether a refusal of a message of kind `of` goes to the banner: none answered in place. */
export function inBanner(of: ClientMessage['kind'] | undefined): boolean {
  return of === undefined || !ANSWERED_IN_PLACE.has(of);
}

/** The runs of the pass's account as the server sent them (`my-runs`): the newest, the count. */
export type MyRuns = Omit<Extract<ServerMessage, { kind: 'my-runs' }>, 'kind'>;

/** The server's latest answer to an ask of a login (`login`), counted up: what was done. */
export interface LoginNews {
  seq: number;
  done: LoginDone;
}

/**
 * What the page asks of a login for the browser's pass (`Connection.askLogin`): a Kennwort set or
 * changed, a sign-in, a sign-out, or a switch of accounts — which mints the device's next pass.
 */
export type LoginAsk =
  | { kind: 'set-password'; password: string }
  | { kind: 'change-password'; old: string; password: string }
  | { kind: 'sign-in'; login: string; password: string }
  | { kind: 'sign-out' }
  | { kind: 'switch-account'; login: string; password: string };

/** This device's ask for a seat by its name, waiting for the crew to let it in. */
export interface Takeover {
  code: string;
  name: string;
  /** epoch ms, by the server's clock, until which the ask waits */
  until: number;
}

/**
 * The way back of the join screen's card, waiting for its room: a new server instance takes the
 * room up again once the newest snapshot of it is in (`restoring`), and seats the page then.
 */
export interface Restoring {
  code: string;
  /** epoch ms, by this device's clock, the server said the room is on its way back */
  since: number;
  /**
   * it is the tab's own comeback that waits, on a page loaded anew (`comebackWaits`): its line is
   * not ready, so the seat is given up on a socket of its own (`Connection.giveUp`)
   */
  comeback?: true;
}

export interface Connection {
  /** socket status; the game itself lives in `view` */
  status: LineStatus;
  /** the next try while the line is down (line.ts `Retry`); null while it is up */
  retry: Retry | null;
  view: PlayerView | null;
  /** set instead of `view` when this connection is watching, not playing */
  spectatorView: SpectatorView | null;
  /** this device's ask for a seat by its name while the crew has not answered it; null for none */
  takeover: Takeover | null;
  /** the room the join screen's card went back to, while the server waits to take it up again */
  restoring: Restoring | null;
  /** open and running rooms, refreshed while sitting on the join screen */
  rooms: RoomSummary[];
  /**
   * where the browser's pass sits, as the server last answered the join screen's `whereami`:
   * a run on binds it, a lobby holds it; null for neither, and before the first answer
   */
  seat: Seat | null;
  /** the pass's account as the server last told it; null before it did, and once deleted */
  account: AccountView | null;
  /** the runs of the pass's account, as the server last answered `askMyRuns`, or why it did not */
  myRuns: Loaded<MyRuns>;
  /** asks the server for the runs of the pass's account (`my-runs`); stable for the page's life */
  askMyRuns: () => void;
  /** the server's latest answer to an ask of a login (`askLogin`); null before the first */
  login: LoginNews | null;
  /** asks something of a login on the browser's pass (`LoginAsk`); stable for the page's life */
  askLogin: (ask: LoginAsk) => void;
  roomCode: string | null;
  /** how many audience connections watch the tab's room, as the server last said (`audience`) */
  watching: number;
  /**
   * the banner's words: a refusal of what is answered nowhere else (`ANSWERED_IN_PLACE`), there
   * until the player does the next thing — what the page streams by itself (`pos`, `clock`)
   * wipes nothing — or dismisses it
   */
  error: string | null;
  /**
   * The server's latest refusal of this connection's messages, counted up (an `error` each):
   * an open device shakes the press it refused and says it in its head, the prompt pill says
   * one of E's (world/press.ts); null before the first.
   */
  refusal: Refusal | null;
  /**
   * Live avatar positions with the run they belong to, written on every
   * positions broadcast WITHOUT a React re-render — the canvas render loop
   * reads this ref directly.
   */
  positions: MutableRefObject<KnownPositions>;
  /** Live drone patrols, same no-re-render contract as `positions`. */
  drones: MutableRefObject<Record<string, DronePosition>>;
  /** Map pings, newest last; the render loop drains expired ones itself. */
  pings: MutableRefObject<{ playerId: string; x: number; y: number; at: number }[]>;
  /** Quick-chat lines as said, slots filled in; newest last, drained by the render loop. */
  chats: MutableRefObject<{ playerId: string; text: string; at: number }[]>;
  send: (msg: ClientMessage) => void;
  /**
   * Hears every server message in the order it came, as it comes — before
   * React renders any of it — and the socket dropping. The voice keeps its
   * links by this: a signal must never overtake the view sent before it.
   * Returns how to stop listening. Stable for the connection's life.
   */
  listen: (listener: ServerListener) => () => void;
  /** Sends a voice signal to one member of the room; unlike `send`, it leaves a shown error be. */
  signal: (to: string, signal: RtcSignal) => void;
  dismissError: () => void;
  /** Tries the line again now (line.ts `Line.wake`): „Jetzt versuchen". */
  wake: () => void;
  /**
   * The seat given up while the line is down, „Einsatz aufgeben" on the card of a line lost —
   * sent once the line is back — or while the tab's own comeback waits for its room, on the join
   * screen's card (`Restoring.comeback`) — sent at once; the tab in no room from now.
   */
  giveUp: () => void;
  /**
   * Out of the room: a player's seat given up — once the server has freed it, or after
   * LEAVE_WAIT_MS without a word — the audience simply goes; the page loads anew.
   */
  leaveRoom: () => void;
  /**
   * Off to the main menu, the seat kept (`to-menu`, as Dota 2 disconnects): once the server has
   * the seat off its line, or after LEAVE_WAIT_MS without a word, the page loads anew on the
   * main menu, whose card of the room leads back (`goToMenu`).
   */
  toMenu: () => void;
}

/** How long leaving waits for the server to free the seat before the page loads anew, ms. */
export const LEAVE_WAIT_MS = 2000;

/** Hears the server: each message as it comes in, and the socket dropping. */
export interface ServerListener {
  message: (msg: ServerMessage) => void;
  closed: () => void;
}

/**
 * Out of room `code` for good: the tab plays in it no more, and what `playerId` noted there
 * goes with it (where it is known), as does the snapshot kept of the room.
 */
function forgetRoom(code: string | null, playerId: string | null): void {
  const store = localStore();
  if (code !== null && playerId !== null && store !== null) {
    forgetNotes(store, code, playerId);
  }
  if (code !== null) {
    dropSnapshot(code, store);
  }
  leaveTab();
}

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

/** What the page keeps of what the server says: its state's setters, and the refs read live. */
export interface Page {
  setRoomCode: (code: string | null) => void;
  setView: (view: PlayerView | null) => void;
  setSpectatorView: (view: SpectatorView | null) => void;
  setRooms: (rooms: RoomSummary[]) => void;
  setSeat: (seat: Seat | null) => void;
  setAccount: (account: AccountView | null) => void;
  setMyRuns: (runs: Loaded<MyRuns>) => void;
  setTakeover: (takeover: Takeover | null) => void;
  setRestoring: (restoring: Restoring | null) => void;
  setWatching: (count: number) => void;
  setError: (message: string) => void;
  refuse: (message: string, of: ClientMessage['kind'] | null) => void;
  /** an answer to an ask of a login came (`LoginNews`) */
  noteLogin: (done: LoginDone) => void;
  /** the pass a switch of accounts sent as the device's next (`askLogin`); null for none */
  nextPass: MutableRefObject<CrewPass | null>;
  /** the page loads anew: on a new pass, the device signed out or switched accounts */
  startOver: () => void;
  /** a comeback is out (tab.ts): an error now means the room or seat the tab kept is gone */
  resuming: MutableRefObject<boolean>;
  /**
   * the room the page last asked back into with a resume of its own — the join screen's card's
   * way back — by its code; null once the seat is back
   */
  resumed: MutableRefObject<string | null>;
  /**
   * the latest view of the seat the tab plays: its player's notes go with the room, and a
   * snapshot of the room is kept with the card it shows (snapshots.ts)
   */
  seen: MutableRefObject<PlayerView | null>;
  positions: Connection['positions'];
  drones: Connection['drones'];
  pings: Connection['pings'];
  chats: Connection['chats'];
}

/** Takes a server message in: the page's state, the room the tab keeps, the live refs. */
export function takeIn(msg: ServerMessage, page: Page): void {
  if (!seatNews(msg, page) && !accountNewsOf(msg, page)) {
    lineNews(msg, page);
  }
}

/**
 * Takes in what the server says of the pass's account — the account (`accountNews`), its runs —
 * and says whether `msg` was such news.
 */
function accountNewsOf(msg: ServerMessage, page: Page): boolean {
  switch (msg.kind) {
    case 'account':
      accountNews(msg.account, page);
      return true;
    case 'login':
      loginNews(msg, page);
      return true;
    case 'my-runs':
      page.setMyRuns({ status: 'ready', value: { runs: msg.runs, total: msg.total } });
      return true;
    default:
      return false;
  }
}

/**
 * Takes in what the server says of where this tab sits — its seat, its room's views, the
 * audience's, an ask for a seat by its name — and says whether `msg` was such news.
 */
function seatNews(msg: ServerMessage, page: Page): boolean {
  switch (msg.kind) {
    case 'joined':
      page.resuming.current = false;
      page.resumed.current = null;
      keepTab({ code: msg.code, watching: false });
      spendInvite();
      page.setTakeover(null);
      page.setRestoring(null);
      page.setRoomCode(msg.code);
      return true;
    case 'takeover-pending':
      page.setTakeover({ code: msg.code, name: msg.name, until: msg.until });
      return true;
    case 'takeover-allowed':
      page.setTakeover(null);
      return true;
    case 'left':
      leftRoom(msg, page);
      return true;
    case 'seated':
      // Where the server has no room for the pass, it may be one a restart took down: its card
      // from the snapshot the browser keeps, whose way back takes the room up again.
      page.setSeat(seatShown(msg.seat));
      return true;
    case 'view':
      clock.stamped(msg.at);
      page.seen.current = msg.view;
      runOver(msg.view);
      page.setView(msg.view);
      return true;
    case 'spectator-view':
      clock.stamped(msg.at);
      watching(msg.code, page);
      page.setSpectatorView(msg.view);
      return true;
    default:
      return false;
  }
}

/**
 * Takes in what the line carries besides: the time, the rooms, how many watch the room, the
 * room's snapshots, a room on its way back, refusals, and the live streams (`streamNews`).
 */
function lineNews(msg: ServerMessage, page: Page): void {
  switch (msg.kind) {
    case 'clock':
      clock.heard(msg.sent, msg.at);
      break;
    case 'rooms':
      page.setRooms(msg.rooms);
      break;
    case 'audience':
      page.setWatching(msg.count);
      break;
    case 'snapshot':
    case 'restart':
      kept(msg, page);
      break;
    case 'restoring':
      onItsWay(msg.code, page);
      break;
    case 'error':
      refused(msg, page);
      break;
    default:
      streamNews(msg, page);
  }
}

/**
 * What the server says of the pass's account: its name, its colour and its Erfolge kept with the
 * pass for the next page (pass.ts, achievements.ts) — every one of them forgotten once the
 * account is deleted.
 */
function accountNews(account: AccountView | null, page: Page): void {
  const store = localStore();
  if (account === null) {
    forgetProfile(store);
    forgetEarned(store);
  } else {
    keepProfile(account, store);
    fillEarned(store, account.achievements);
  }
  page.setAccount(account);
}

/**
 * What the server answers an ask of a login: the account as it stands now — signed into another,
 * the Erfolge the device keeps are that account's — or, where the device signed out or switched
 * accounts, the page anew on its next pass (`startOver`).
 */
function loginNews(msg: Extract<ServerMessage, { kind: 'login' }>, page: Page): void {
  page.noteLogin(msg.done);
  if (msg.done === 'signed-out') {
    startOver(mintPass(), null, page);
  } else if (msg.done === 'switched') {
    startOver(page.nextPass.current ?? mintPass(), msg.account, page);
  } else {
    if (msg.done === 'signed-in') {
      forgetEarned(localStore());
    }
    accountNews(msg.account, page);
  }
}

/**
 * The device on `next`, its pass from now on — with the name and the colour of `account`, its
 * account, none for a guest: the Erfolge, the rooms' snapshots and the tab's room of the pass it
 * had go, as their seats wait for that one's account, and the page loads anew.
 */
function startOver(next: CrewPass, account: AccountView | null, page: Page): void {
  const store = localStore();
  adoptPass(next, account, store);
  forgetEarned(store);
  dropSnapshots(store);
  leaveTab();
  page.startOver();
}

/** Takes in what the world streams past React: where everybody stands, the pings, the chat. */
function streamNews(msg: ServerMessage, page: Page): void {
  switch (msg.kind) {
    case 'positions':
      page.positions.current = { run: msg.run, players: msg.players };
      page.drones.current = msg.drones;
      break;
    case 'ping': {
      const { playerId, x, y } = msg;
      page.pings.current.push({ playerId, x, y, at: performance.now() });
      break;
    }
    case 'chat': {
      const { playerId, text } = msg;
      page.chats.current.push({ playerId, text, at: performance.now() });
      break;
    }
  }
}

/**
 * The snapshot of the tab's room, kept with the room's card as the latest view shows it: the
 * newest, for a server that knows the room no more to take it up again from.
 */
function kept(msg: Extract<ServerMessage, { kind: 'snapshot' | 'restart' }>, page: Page): void {
  const code = roomOfTab();
  const view = page.seen.current;
  if (code !== null && view !== null) {
    keepSnapshot(code, msg, view);
  }
}

/**
 * The server waits for the newest snapshot of the room `code` before it takes it up again: where
 * the join screen's card went back to that room, the card says so till the seat is back. A tab's
 * own comeback waits on a line not ready yet, which tells of it as its retry (line.ts
 * `Retry.restoring`).
 */
function onItsWay(code: string, page: Page): void {
  if (page.resumed.current?.toUpperCase() === code) {
    page.setRestoring({ code, since: Date.now() });
  }
}

/**
 * The line's next try (`retry`): where the tab's own comeback waits for its room (line.ts
 * `Retry.restoring`) — a page loaded anew while the server is about to take the room up again
 * — the join screen shows the card the browser keeps of the room, waiting as for the card's own
 * way back (`onItsWay`), never the plain form. The game opens once the seat is back.
 */
export function comebackWaits(
  retry: Retry | null,
  page: Pick<Page, 'setSeat' | 'setRestoring'>,
): void {
  const room = tabRoom();
  const kept = room === null || room.watching ? null : keptSnapshot(room.code);
  if (retry?.restoring === true && kept !== null) {
    page.setSeat(kept.seat);
    page.setRestoring({ code: kept.seat.code, since: Date.now(), comeback: true });
  }
}

/**
 * The line dropped: the server's wait for the card's room ended with the socket it held, and the
 * card's way back is open again (`Restoring`).
 */
export function lineDropped(page: Pick<Page, 'setRestoring'>): void {
  page.setRestoring(null);
}

/** A run over, won or lost, is not taken up again: the snapshot kept of its room goes. */
function runOver(view: PlayerView): void {
  const code = roomOfTab();
  if (code !== null && (view.phase === 'won' || view.phase === 'lost')) {
    dropSnapshot(code);
  }
}

/**
 * The seat was given up — its snapshot goes with it — or plays on in another tab (`message`
 * says so): this one plays in no room now and keeps no comeback, so that two tabs never take the
 * seat from each other.
 */
function leftRoom({ code, message }: Extract<ServerMessage, { kind: 'left' }>, page: Page): void {
  if (message === null) {
    dropSnapshot(code);
  }
  leaveTab();
  page.setRoomCode(null);
  page.setView(null);
  page.setSeat(null);
  if (message !== null) {
    page.setError(message);
  }
}

/**
 * A refusal: a comeback refused means the tab's room is gone, or its pass holds no seat there
 * any more — back to the join screen; a join refused ends the ask for a seat it made.
 */
function refused(msg: Extract<ServerMessage, { kind: 'error' }>, page: Page): void {
  if (page.resuming.current) {
    comebackRefused(page);
  }
  if (msg.of === 'join-room') {
    page.setTakeover(null);
  }
  if (msg.of === 'resume') {
    resumeRefused(page);
  }
  if (msg.of === 'my-runs') {
    page.setMyRuns({ status: 'failed', reason: msg.message });
  }
  if (inBanner(msg.of)) {
    page.setError(msg.message);
  }
  page.refuse(msg.message, msg.of ?? null);
}

/**
 * The tab's own comeback refused: its room is gone, or its pass holds no seat there any more. The
 * tab plays in no room from now, what it noted there gone, and the join screen comes up.
 */
function comebackRefused(page: Page): void {
  page.resuming.current = false;
  forgetRoom(roomOfTab(), page.seen.current?.you.id ?? null);
  page.setRoomCode(null);
  page.setView(null);
  page.setSpectatorView(null);
  page.setRestoring(null);
}

/**
 * What the page notes of `msg` as it goes out: a resume of its own — the join screen's card's way
 * back — names the room whose snapshot goes once the server refuses it (`resumeRefused`), and
 * that the card waits for while the server takes it up again (`onItsWay`); the seat given up
 * there, the card waits no more.
 */
export function noteOutgoing(
  msg: ClientMessage,
  page: Pick<Page, 'resumed' | 'setRestoring'>,
): void {
  if (msg.kind === 'resume') {
    page.resumed.current = msg.code;
  } else if (msg.kind === 'abandon' && page.resumed.current === msg.code) {
    page.resumed.current = null;
    page.setRestoring(null);
  }
}

/**
 * The server will not have the seat of the join screen's card back — the room gone for good, its
 * snapshot refused: the snapshot kept of the room goes, and the card with it.
 */
function resumeRefused(page: Page): void {
  const code = page.resumed.current;
  if (code !== null) {
    page.resumed.current = null;
    dropSnapshot(code);
    page.setRestoring(null);
    page.setSeat(keptSeat());
  }
}

/**
 * The tab watches room `code`: a socket of it comes back to the room's audience (tab.ts),
 * and the comeback it sent is answered.
 */
function watching(code: string, page: Page): void {
  page.resuming.current = false;
  const kept = tabRoom();
  if (kept?.code !== code || !kept.watching) {
    keepTab({ code, watching: true });
  }
  page.setRoomCode(code);
}

/**
 * What the page says back at once to `msg`, if anything: let in by the crew on a seat by its
 * name, this device's pass holds the seat now, and it resumes it; signed into an account, it
 * asks where it sits anew — a run on of the account's binds it now.
 */
export function replyTo(msg: ServerMessage): ClientMessage | null {
  if (msg.kind === 'login' && msg.done === 'signed-in') {
    return { kind: 'whereami', pass: crewPass() };
  }
  return msg.kind === 'takeover-allowed' ? resumeOf(msg.code) : null;
}

/** What `openLine` wires the page's line to: the page, its status, socket and listeners. */
interface Wiring {
  page: Page;
  setStatus: (status: Connection['status']) => void;
  setRetry: (retry: Retry | null) => void;
  /** the socket made last: a voice signal goes on it, past the line */
  socket: MutableRefObject<WebSocket | null>;
  listeners: MutableRefObject<Set<ServerListener>>;
}

/**
 * Opens the page's line to the server (`keepConnected`), asking for the server's time on it
 * while it is ready (clock.ts): every clock follows it. What the server says goes into the
 * page (`takeIn`) and on to every listener, in order. Returns the line, and how to close it.
 */
function openLine(wiring: Wiring): { line: Line; close: () => void } {
  const { page, listeners } = wiring;
  let line: Line | null = null;
  const ask = (): void => line?.send({ kind: 'clock', sent: localNow() });
  const asking = askForTime(ask);
  const opened = keepConnected(() => new WebSocket(wsUrl()), {
    made: (socket) => {
      wiring.socket.current = socket;
    },
    status: (next) => {
      wiring.setStatus(next);
      if (next !== 'open') {
        asking.close();
      }
    },
    session: comebackOfTab,
    resuming: () => {
      page.resuming.current = true;
    },
    ready: () => asking.open(),
    message: (msg) => {
      const reply = replyTo(msg);
      if (reply !== null) {
        line?.send(reply);
      }
      takeIn(msg, page);
      for (const listener of listeners.current) {
        listener.message(msg);
      }
    },
    closed: () => {
      lineDropped(page);
      for (const listener of listeners.current) {
        listener.closed();
      }
    },
    retry: (next) => {
      wiring.setRetry(next);
      comebackWaits(next, page);
    },
    probe: ask,
  });
  line = opened;
  return {
    line: opened,
    close: () => {
      asking.close();
      opened.stop();
    },
  };
}

/**
 * Gives the seat in room `code` up (`abandon`): once the server says it left — or after
 * LEAVE_WAIT_MS without a word, the seat kept for the join screen to offer again — the page
 * loads anew, the tab in no room; what `playerId` noted there goes once the seat is gone.
 */
export function leaveSeat(
  code: string,
  playerId: string | null,
  listen: Connection['listen'],
  send: (msg: ClientMessage) => void,
): void {
  const reload = (): void => location.reload();
  const timer = setTimeout(() => {
    leaveTab();
    reload();
  }, LEAVE_WAIT_MS);
  listen({
    message: (msg) => {
      if (msg.kind === 'left' && msg.code === code) {
        clearTimeout(timer);
        forgetRoom(code, playerId);
        reload();
      }
    },
    closed: () => undefined,
  });
  send({ kind: 'abandon', code, pass: crewPass() });
}

/**
 * Off to the main menu from room `code`, the seat kept (`to-menu`): once the server says the seat
 * is off its line (`at-menu`) — or after LEAVE_WAIT_MS without a word, a line down meanwhile
 * holding it as a drop — the tab is in no room and the page loads anew on the main menu. What
 * was noted there and the room's snapshot stay: the seat is the pass's still, and the menu's card
 * of the room (`whereami`) leads back to it.
 */
export function goToMenu(
  code: string,
  listen: Connection['listen'],
  send: (msg: ClientMessage) => void,
  reload: () => void = () => location.reload(),
): void {
  // Either way out lets go of the other: the word and the wait, once.
  const off = (): void => {
    clearTimeout(timer);
    stop();
    leaveTab();
    reload();
  };
  const timer = setTimeout(off, LEAVE_WAIT_MS);
  const stop = listen({
    message: (msg) => {
      if (msg.kind === 'at-menu' && msg.code === code) {
        off();
      }
    },
    closed: () => undefined,
  });
  send({ kind: 'to-menu' });
}

/**
 * Wakes the line (`Line.wake`) on every way the page comes back: the network back (`online`),
 * the page shown again from the cache or on its tab (`pageshow`, `visibilitychange` to
 * visible), the window in focus. Returns how to stop.
 */
export function wakeOnReturn(
  win: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>,
  wake: () => void,
): () => void {
  const shown = (): void => {
    if (doc.visibilityState === 'visible') {
      wake();
    }
  };
  for (const event of ['online', 'pageshow', 'focus'] as const) {
    win.addEventListener(event, wake);
  }
  doc.addEventListener('visibilitychange', shown);
  return () => {
    for (const event of ['online', 'pageshow', 'focus'] as const) {
      win.removeEventListener(event, wake);
    }
    doc.removeEventListener('visibilitychange', shown);
  };
}

/**
 * The seat given up while the line is down (the card of a line lost), or while the tab's own
 * comeback waits for its room: it goes first on the next socket that opens — at once where the
 * comeback waits (line.ts `Line.sendFirst`); from now the tab plays in no room, what `playerId`
 * noted there gone.
 */
function giveUpOffLine(line: Line | null, playerId: string | null): void {
  const code = roomOfTab();
  if (code === null || line === null) {
    return;
  }
  forgetRoom(code, playerId);
  line.sendFirst({ kind: 'abandon', code, pass: crewPass() });
}

/** The refs the world reads frame by frame, past React: positions, drones, pings, chats. */
function useLiveRefs(): Pick<Connection, 'positions' | 'drones' | 'pings' | 'chats'> {
  return {
    positions: useRef<KnownPositions>({ run: null, players: {} }),
    drones: useRef<Record<string, DronePosition>>({}),
    pings: useRef<{ playerId: string; x: number; y: number; at: number }[]>([]),
    chats: useRef<{ playerId: string; text: string; at: number }[]>([]),
  };
}

/**
 * The page's line, opened once (`openLine`) on the wiring the page comes up with — its refs and
 * state setters, the same for the page's life — and woken as the page comes back.
 */
function useLine(wiring: Wiring): MutableRefObject<Line | null> {
  const lineRef = useRef<Line | null>(null);
  useEffect(() => {
    const { line, close } = openLine(wiring);
    lineRef.current = line;
    const stopWaking = wakeOnReturn(window, document, () => line.wake());
    return () => {
      stopWaking();
      close();
    };
    // The wiring is refs and setters, stable for the page's life: opened once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return lineRef;
}

/** What the page shows of what the server said: the connection's state, as it hands it out. */
type Shown = Pick<
  Connection,
  | 'view'
  | 'spectatorView'
  | 'takeover'
  | 'restoring'
  | 'rooms'
  | 'seat'
  | 'account'
  | 'myRuns'
  | 'login'
  | 'roomCode'
  | 'watching'
  | 'error'
  | 'refusal'
>;

/**
 * The page's state, as the server's messages set it (`Shown`), and the page they are taken in by
 * (`Page`): its setters and the refs read live, the same for the page's life — and how to clear
 * the banner's words.
 */
function usePage(): { shown: Shown; page: Page; clearError: () => void } {
  const [view, setView] = useState<PlayerView | null>(null);
  const [spectatorView, setSpectatorView] = useState<SpectatorView | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  // The card of the newest snapshot kept stands from the start, till the server says otherwise.
  const [seat, setSeat] = useState<Seat | null>(keptSeat);
  const [account, setAccount] = useState<AccountView | null>(null);
  const [myRuns, setMyRuns] = useState<Loaded<MyRuns>>({ status: 'loading' });
  const [takeover, setTakeover] = useState<Takeover | null>(null);
  const [restoring, setRestoring] = useState<Restoring | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(roomOfTab);
  const [watching, setWatching] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [login, setLogin] = useState<LoginNews | null>(null);
  const resuming = useRef(false);
  const resumed = useRef<string | null>(null);
  const seen = useRef<PlayerView | null>(null);
  const nextPass = useRef<CrewPass | null>(null);
  const live = useLiveRefs();
  const page: Page = {
    setRoomCode,
    setView,
    setSpectatorView,
    setRooms,
    setSeat,
    setAccount,
    setMyRuns,
    setTakeover,
    setRestoring,
    setWatching,
    setError,
    refuse: (message, of) => setRefusal((last) => ({ seq: (last?.seq ?? 0) + 1, message, of })),
    noteLogin: (done) => setLogin((last) => ({ seq: (last?.seq ?? 0) + 1, done })),
    nextPass,
    startOver: () => location.reload(),
    resuming,
    resumed,
    seen,
    ...live,
  };
  const shown = { view, spectatorView, takeover, restoring, rooms, seat, account, myRuns, login };
  return {
    shown: { ...shown, roomCode, watching, error, refusal },
    page,
    clearError: () => setError(null),
  };
}

/**
 * The asks of a login on `line`, for the browser's pass (`LoginAsk`) — a switch of accounts with
 * the pass it mints for the device, kept in `nextPass` till the server answers. Another tab's
 * switch or sign-out puts another pass in this browser: the page loads anew on it (`followPass`).
 */
function useAskLogin(
  line: MutableRefObject<Line | null>,
  nextPass: MutableRefObject<CrewPass | null>,
): (ask: LoginAsk) => void {
  useEffect(() => followPass(window, () => location.reload()), []);
  return useCallback(
    (ask: LoginAsk) => {
      const pass = crewPass();
      if (ask.kind === 'switch-account') {
        const next = mintPass();
        nextPass.current = next;
        line.current?.send({ ...ask, pass, next });
        return;
      }
      line.current?.send({ ...ask, pass });
    },
    [line, nextPass],
  );
}

/**
 * Owns the WebSocket for the whole app: connects, resumes the tab's room on the browser's pass
 * after a reload or a lost connection, and reconnects with backoff (`keepConnected`) — at once
 * where the page comes back (`wakeOnReturn`).
 */
export function useGameConnection(): Connection {
  const [status, setStatus] = useState<Connection['status']>('connecting');
  const [retry, setRetry] = useState<Retry | null>(null);
  const { shown, page, clearError } = usePage();
  const socketRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef(new Set<ServerListener>());

  const listen = useCallback((listener: ServerListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const signal = useCallback((to: string, rtc: RtcSignal) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'rtc', to, signal: rtc } satisfies ClientMessage));
    }
  }, []);

  const lineRef = useLine({
    page,
    setStatus,
    setRetry,
    socket: socketRef,
    listeners: listenersRef,
  });

  const { setMyRuns } = page;
  const askMyRuns = useCallback(() => {
    setMyRuns({ status: 'loading' });
    lineRef.current?.send({ kind: 'my-runs', pass: crewPass() });
  }, [lineRef, setMyRuns]);
  const askLogin = useAskLogin(lineRef, page.nextPass);

  const { positions, drones, pings, chats } = page;
  return {
    status,
    retry,
    ...shown,
    askMyRuns,
    askLogin,
    positions,
    drones,
    pings,
    chats,
    send: (msg) => {
      if (wipesBanner(msg.kind)) {
        clearError();
      }
      noteOutgoing(msg, page);
      lineRef.current?.send(msg);
    },
    listen,
    signal,
    dismissError: clearError,
    wake: () => lineRef.current?.wake(),
    giveUp: () => {
      giveUpOffLine(lineRef.current, page.seen.current?.you.id ?? null);
      page.setRoomCode(null);
      page.setView(null);
      page.setSeat(keptSeat());
    },
    leaveRoom: () => {
      const code = roomOfTab();
      if (code === null || shown.spectatorView !== null) {
        leaveTab();
        location.reload();
        return;
      }
      const playerId = page.seen.current?.you.id ?? null;
      leaveSeat(code, playerId, listen, (msg) => lineRef.current?.send(msg));
    },
    toMenu: () => {
      const code = roomOfTab();
      if (code === null) {
        location.reload();
        return;
      }
      goToMenu(code, listen, (msg) => lineRef.current?.send(msg));
    },
  };
}

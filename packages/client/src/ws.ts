import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type {
  ClientMessage,
  CrewPass,
  DronePosition,
  PlayerView,
  RoomSummary,
  RtcSignal,
  Seat,
  ServerMessage,
  SpectatorView,
} from '@escapelab/core';
import { askForTime, clock, localNow } from './clock.js';
import { forgetNotes, localStore } from './notes.js';
import { crewPass } from './pass.js';
import type { KnownPositions } from './world/movement.js';

/** What a socket resumes as it opens: the room this tab plays in, on the browser's pass. */
export interface Resume {
  code: string;
  pass: CrewPass;
}

/** A refusal of the server's: how many it has made so far, its words, what it refused. */
export interface Refusal {
  seq: number;
  message: string;
  /** the kind of message refused; null where the server could not read it */
  of: ClientMessage['kind'] | null;
}

/**
 * What is refused where the player looks — at the device they work (its head), at the prompt
 * they pressed E on (the pill) — and not in the banner over the screen, which lies under a
 * device and away from the prompt.
 */
const ANSWERED_IN_PLACE: ReadonlySet<ClientMessage['kind']> = new Set([
  'puzzle-input',
  'interact',
  'open-source',
]);

/** Whether a refusal of a message of kind `of` goes to the banner: none answered in place. */
export function inBanner(of: ClientMessage['kind'] | undefined): boolean {
  return of === undefined || !ANSWERED_IN_PLACE.has(of);
}

/** Whether sending a message of `kind` takes the banner down: the player's next deed, no stream. */
export function wipesBanner(kind: ClientMessage['kind']): boolean {
  return !STREAMED.has(kind);
}

export interface Connection {
  /** socket status; the game itself lives in `view` */
  status: 'connecting' | 'open' | 'closed';
  view: PlayerView | null;
  /** set instead of `view` when this connection is watching, not playing */
  spectatorView: SpectatorView | null;
  /** open and running rooms, refreshed while sitting on the join screen */
  rooms: RoomSummary[];
  /**
   * where the browser's pass sits, as the server last answered the join screen's `whereami`:
   * a run on binds it, a lobby holds it; null for neither, and before the first answer
   */
  seat: Seat | null;
  roomCode: string | null;
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
  /**
   * Out of the room: a player's seat given up — once the server has freed it, or after
   * LEAVE_WAIT_MS without a word — the audience simply goes; the page loads anew.
   */
  leaveRoom: () => void;
}

/** How long leaving waits for the server to free the seat before the page loads anew, ms. */
export const LEAVE_WAIT_MS = 2000;

/** Hears the server: each message as it comes in, and the socket dropping. */
export interface ServerListener {
  message: (msg: ServerMessage) => void;
  closed: () => void;
}

/**
 * Where the tab keeps the code of the room it plays in: a reload comes back to it on the
 * browser's pass (pass.ts). The seat itself is the pass's, which every tab shares.
 */
const STORAGE_KEY = 'escapelab-session';

/** The code of the room this tab plays in; null for none. */
function roomOfTab(): string | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const code: unknown = raw === null ? null : (JSON.parse(raw) as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  } catch {
    return null;
  }
}

/** What a socket of this tab resumes as it opens; null where the tab plays in no room. */
function resumeOfTab(): Resume | null {
  const code = roomOfTab();
  return code === null ? null : { code, pass: crewPass() };
}

/** The tab plays in no room any more: no socket of it resumes one. */
function leaveTab(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

/**
 * Out of room `code` for good: the tab plays in it no more, and what `playerId` noted there
 * goes with it (where it is known).
 */
function forgetRoom(code: string | null, playerId: string | null): void {
  const store = localStore();
  if (code !== null && playerId !== null && store !== null) {
    forgetNotes(store, code, playerId);
  }
  leaveTab();
}

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

/** The pause before the first try to connect again, ms; it doubles with every try that fails. */
const RETRY_FIRST_MS = 1000;
/** The longest pause between two tries, ms. */
const RETRY_MAX_MS = 10_000;
/** How many messages wait for a socket to open; any more are dropped. */
export const OUTBOX_MAX = 32;
/**
 * What the page streams — positions, asks for the server's time — the next one supersedes it,
 * so none waits for a socket to open.
 */
const STREAMED: ReadonlySet<ClientMessage['kind']> = new Set(['pos', 'clock']);

/** What the socket `keepConnected` keeps open tells the app, and asks of it. */
export interface SocketEvents {
  /** a new socket was made: the one to send on from now */
  made: (socket: WebSocket) => void;
  status: (status: Connection['status']) => void;
  /** the seat a socket resumes as it opens; null where the tab plays in no room */
  session: () => Resume | null;
  /** a resume went out: an error now means the stored session is dead */
  resuming: () => void;
  /** the line is ready: its socket open with the session back, or needing none (`Line.send`) */
  ready: () => void;
  message: (msg: ServerMessage) => void;
  closed: () => void;
}

/** The line `keepConnected` keeps: what goes out on it, and how to stop it for good. */
export interface Line {
  /**
   * Sends `msg` on the socket that is open and ready. While a socket is on its way — still
   * connecting, or waiting for the server to take its session back — a message waits for it,
   * up to OUTBOX_MAX, and goes out in order once it is ready; if it never is (it closed, or
   * the server refused the session) what waited is dropped. While none is on its way — the
   * line dropped, the next try not made yet — nothing waits: a deed done blind must not land
   * once the run goes on. Nor does what the page streams (`pos`, `clock`) or anything over
   * the limit. Whatever is dropped is said once a time the line is down.
   */
  send: (msg: ClientMessage) => void;
  stop: () => void;
}

/** What waits for a socket on its way (`Line.send`), and the one warning a time it is down. */
interface Outbox {
  /** keeps `msg` for the socket on its way; false where it may not wait: streamed, or full */
  keep: (msg: ClientMessage) => boolean;
  /** says once a time the line is down that `what` was dropped */
  drop: (what: string) => void;
  /** what waited, in order, taken out: the line is ready, and back */
  release: () => string[];
  /** what waited dropped: its socket will never be ready */
  forget: () => void;
}

function outbox(): Outbox {
  let waiting: string[] = [];
  let warned = false;
  const drop = (what: string): void => {
    if (!warned) {
      warned = true;
      console.warn(
        `escapelab: no line to the server — ${what} dropped, as is what the page streams or ` +
          'does while no socket is on its way, until the line is back',
      );
    }
  };
  return {
    keep: (msg) => {
      if (STREAMED.has(msg.kind) || waiting.length >= OUTBOX_MAX) {
        return false;
      }
      waiting.push(JSON.stringify(msg));
      return true;
    },
    drop,
    release: () => {
      const out = waiting;
      waiting = [];
      warned = false;
      return out;
    },
    forget: () => {
      if (waiting.length > 0) {
        drop(`what waited (${waiting.length})`);
      }
      waiting = [];
    },
  };
}

/**
 * Keeps a socket to the server open, each made by `open`: every socket that opens resumes
 * the session the page keeps, and after every close — the server restarted, the line
 * dropped, the server's heartbeat terminating a socket it heard nothing from — a new one is
 * made after a pause that doubles from 1 s up to 10 s, and is back at 1 s once a socket
 * opens. A message sent meanwhile never throws (`Line.send`).
 */
export function keepConnected(open: () => WebSocket, on: SocketEvents): Line {
  let stopped = false;
  let retryDelay = RETRY_FIRST_MS;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let current: WebSocket | null = null;
  /** `current` is open with its session back, or needs none: what is sent goes straight out */
  let ready = false;
  const waiting = outbox();

  function send(msg: ClientMessage): void {
    if (ready && current?.readyState === WebSocket.OPEN) {
      current.send(JSON.stringify(msg));
      return;
    }
    // Not ready, yet connecting or open: on its way.
    const onItsWay =
      current?.readyState === WebSocket.CONNECTING || current?.readyState === WebSocket.OPEN;
    if (!onItsWay || !waiting.keep(msg)) {
      waiting.drop(`"${msg.kind}"`);
    }
  }

  /** The line is ready on `socket`: what waited goes out on it, in order. */
  function flush(socket: WebSocket): void {
    ready = true;
    for (const data of waiting.release()) {
      socket.send(data);
    }
    on.ready();
  }

  function connect(): void {
    const socket = open();
    current = socket;
    ready = false;
    on.made(socket);
    on.status('connecting');

    socket.onopen = () => {
      on.status('open');
      retryDelay = RETRY_FIRST_MS;
      const creds = on.session();
      if (creds === null) {
        flush(socket);
        return;
      }
      on.resuming();
      socket.send(JSON.stringify({ kind: 'resume', ...creds } satisfies ClientMessage));
    };

    socket.onmessage = (event) => {
      const msg = JSON.parse(String(event.data)) as ServerMessage;
      on.message(msg);
      // The server's answer to the resume: the session back, or refused.
      if (!ready && (msg.kind === 'joined' || msg.kind === 'error')) {
        if (msg.kind === 'error') {
          waiting.forget();
        }
        flush(socket);
      }
    };

    socket.onclose = () => {
      if (stopped) {
        return;
      }
      ready = false;
      waiting.forget();
      on.closed();
      on.status('closed');
      retryTimer = setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
    };
  }

  connect();
  return {
    send,
    stop: () => {
      stopped = true;
      clearTimeout(retryTimer);
      waiting.release();
      current?.close();
    },
  };
}

/** What the page keeps of what the server says: its state's setters, and the refs read live. */
interface Page {
  setRoomCode: (code: string | null) => void;
  setView: (view: PlayerView | null) => void;
  setSpectatorView: (view: SpectatorView) => void;
  setRooms: (rooms: RoomSummary[]) => void;
  setSeat: (seat: Seat | null) => void;
  setError: (message: string) => void;
  refuse: (message: string, of: ClientMessage['kind'] | null) => void;
  /** a resume is out: an error now means the stored session is dead */
  resuming: MutableRefObject<boolean>;
  /** whose seat the latest view was, by player id: their notes go with the room */
  you: MutableRefObject<string | null>;
  positions: Connection['positions'];
  drones: Connection['drones'];
  pings: Connection['pings'];
  chats: Connection['chats'];
}

/** Takes a server message in: the page's state, the session it stores, the live refs. */
function takeIn(msg: ServerMessage, page: Page): void {
  switch (msg.kind) {
    case 'joined':
      page.resuming.current = false;
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ code: msg.code }));
      page.setRoomCode(msg.code);
      break;
    case 'left':
      // The seat was given up, or plays on in another tab: this one plays in no room now and
      // keeps no resume, so that two tabs never take the seat from each other on their own.
      leaveTab();
      page.setRoomCode(null);
      page.setView(null);
      page.setSeat(null);
      if (msg.message !== null) {
        page.setError(msg.message);
      }
      break;
    case 'seated':
      page.setSeat(msg.seat);
      break;
    case 'view':
      clock.stamped(msg.at);
      page.you.current = msg.view.you.id;
      page.setView(msg.view);
      break;
    case 'spectator-view':
      clock.stamped(msg.at);
      page.setSpectatorView(msg.view);
      page.setRoomCode(msg.code);
      break;
    case 'clock':
      clock.heard(msg.sent, msg.at);
      break;
    case 'rooms':
      page.setRooms(msg.rooms);
      break;
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
    case 'error':
      if (page.resuming.current) {
        // The tab's room is gone, or its pass holds no seat there any more: back to join.
        page.resuming.current = false;
        forgetRoom(roomOfTab(), page.you.current);
        page.setRoomCode(null);
        page.setView(null);
      }
      if (inBanner(msg.of)) {
        page.setError(msg.message);
      }
      page.refuse(msg.message, msg.of ?? null);
      break;
  }
}

/** What `openLine` wires the page's line to: the page, its status, socket and listeners. */
interface Wiring {
  page: Page;
  setStatus: (status: Connection['status']) => void;
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
  const asking = askForTime(() => line?.send({ kind: 'clock', sent: localNow() }));
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
    session: resumeOfTab,
    resuming: () => {
      page.resuming.current = true;
    },
    ready: () => asking.open(),
    message: (msg) => {
      takeIn(msg, page);
      for (const listener of listeners.current) {
        listener.message(msg);
      }
    },
    closed: () => {
      for (const listener of listeners.current) {
        listener.closed();
      }
    },
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
 * Owns the WebSocket for the whole app: connects, resumes the tab's room on the browser's pass
 * after a reload or a lost connection, and reconnects with backoff (`keepConnected`).
 */
export function useGameConnection(): Connection {
  const [status, setStatus] = useState<Connection['status']>('connecting');
  const [view, setView] = useState<PlayerView | null>(null);
  const [spectatorView, setSpectatorView] = useState<SpectatorView | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [seat, setSeat] = useState<Seat | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(roomOfTab);
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const lineRef = useRef<Line | null>(null);
  const resumingRef = useRef(false);
  const youRef = useRef<string | null>(null);
  const positionsRef = useRef<KnownPositions>({ run: null, players: {} });
  const dronesRef = useRef<Record<string, DronePosition>>({});
  const pingsRef = useRef<{ playerId: string; x: number; y: number; at: number }[]>([]);
  const chatsRef = useRef<{ playerId: string; text: string; at: number }[]>([]);
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

  useEffect(() => {
    const { line, close } = openLine({
      page: {
        setRoomCode,
        setView,
        setSpectatorView,
        setRooms,
        setSeat,
        setError,
        refuse: (message, of) =>
          setRefusal((last) => ({ seq: (last?.seq ?? 0) + 1, message, of })),
        resuming: resumingRef,
        you: youRef,
        positions: positionsRef,
        drones: dronesRef,
        pings: pingsRef,
        chats: chatsRef,
      },
      setStatus,
      socket: socketRef,
      listeners: listenersRef,
    });
    lineRef.current = line;
    return close;
  }, []);

  return {
    status,
    view,
    spectatorView,
    rooms,
    seat,
    roomCode,
    error,
    refusal,
    positions: positionsRef,
    drones: dronesRef,
    pings: pingsRef,
    chats: chatsRef,
    send: (msg) => {
      if (wipesBanner(msg.kind)) {
        setError(null);
      }
      lineRef.current?.send(msg);
    },
    listen,
    signal,
    dismissError: () => setError(null),
    leaveRoom: () => {
      const code = roomOfTab();
      if (code === null || spectatorView !== null) {
        leaveTab();
        location.reload();
        return;
      }
      leaveSeat(code, youRef.current, listen, (msg) => lineRef.current?.send(msg));
    },
  };
}

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type {
  ChatPhrase,
  ClientMessage,
  DronePosition,
  PlayerView,
  RoomSummary,
  RtcSignal,
  ServerMessage,
  SpectatorView,
} from '@escapelab/core';
import { forgetNotes, localStore } from './notes.js';
import type { KnownPositions } from './world/movement.js';

interface Credentials {
  code: string;
  playerId: string;
  token: string;
}

export interface Connection {
  /** socket status; the game itself lives in `view` */
  status: 'connecting' | 'open' | 'closed';
  view: PlayerView | null;
  /** set instead of `view` when this connection is watching, not playing */
  spectatorView: SpectatorView | null;
  /** open and running rooms, refreshed while sitting on the join screen */
  rooms: RoomSummary[];
  roomCode: string | null;
  error: string | null;
  /**
   * How many of this connection's messages the server has refused so far
   * (an `error` each), counted up: an open device shakes the press that a
   * new one refused, while the banner shows `error`.
   */
  refusals: number;
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
  /** Quick-chat lines, newest last; drained by the render loop like pings. */
  chats: MutableRefObject<{ playerId: string; phrase: ChatPhrase; at: number }[]>;
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
  leaveRoom: () => void;
}

/** Hears the server: each message as it comes in, and the socket dropping. */
export interface ServerListener {
  message: (msg: ServerMessage) => void;
  closed: () => void;
}

const STORAGE_KEY = 'escapelab-session';

function loadCredentials(): Credentials | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw === null ? null : (JSON.parse(raw) as Credentials);
  } catch {
    return null;
  }
}

/** Out of the room for good: what this player noted there goes with it. */
function forgetRoom(): void {
  const creds = loadCredentials();
  const store = localStore();
  if (creds !== null && store !== null) {
    forgetNotes(store, creds.code, creds.playerId);
  }
  sessionStorage.removeItem(STORAGE_KEY);
}

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

/** The pause before the first try to connect again, ms; it doubles with every try that fails. */
const RETRY_FIRST_MS = 1000;
/** The longest pause between two tries, ms. */
const RETRY_MAX_MS = 10_000;

/** What the socket `keepConnected` keeps open tells the app, and asks of it. */
export interface SocketEvents {
  /** a new socket was made: the one to send on from now */
  made: (socket: WebSocket) => void;
  status: (status: Connection['status']) => void;
  /** the session a socket resumes as it opens; null where the page keeps none */
  session: () => Credentials | null;
  /** a resume went out: an error now means the stored session is dead */
  resuming: () => void;
  message: (msg: ServerMessage) => void;
  closed: () => void;
}

/**
 * Keeps a socket to the server open, each made by `open`: every socket that opens resumes
 * the session the page keeps, and after every close — the server restarted, the line
 * dropped, the server's heartbeat terminating a socket it heard nothing from — a new one is
 * made after a pause that doubles from 1 s up to 10 s, and is back at 1 s once a socket
 * opens. Returns how to stop for good.
 */
export function keepConnected(open: () => WebSocket, on: SocketEvents): () => void {
  let stopped = false;
  let retryDelay = RETRY_FIRST_MS;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let current: WebSocket | null = null;

  function connect(): void {
    const socket = open();
    current = socket;
    on.made(socket);
    on.status('connecting');

    socket.onopen = () => {
      on.status('open');
      retryDelay = RETRY_FIRST_MS;
      const creds = on.session();
      if (creds !== null) {
        on.resuming();
        socket.send(JSON.stringify({ kind: 'resume', ...creds } satisfies ClientMessage));
      }
    };

    socket.onmessage = (event) => {
      on.message(JSON.parse(String(event.data)) as ServerMessage);
    };

    socket.onclose = () => {
      if (stopped) {
        return;
      }
      on.closed();
      on.status('closed');
      retryTimer = setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
    };
  }

  connect();
  return () => {
    stopped = true;
    clearTimeout(retryTimer);
    current?.close();
  };
}

/** What the page keeps of what the server says: its state's setters, and the refs read live. */
interface Page {
  setRoomCode: (code: string | null) => void;
  setView: (view: PlayerView | null) => void;
  setSpectatorView: (view: SpectatorView) => void;
  setRooms: (rooms: RoomSummary[]) => void;
  setError: (message: string) => void;
  countRefusal: () => void;
  /** a resume is out: an error now means the stored session is dead */
  resuming: MutableRefObject<boolean>;
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
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ code: msg.code, playerId: msg.playerId, token: msg.token }),
      );
      page.setRoomCode(msg.code);
      break;
    case 'view':
      page.setView(msg.view);
      break;
    case 'spectator-view':
      page.setSpectatorView(msg.view);
      page.setRoomCode(msg.code);
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
      const { playerId, phrase } = msg;
      page.chats.current.push({ playerId, phrase, at: performance.now() });
      break;
    }
    case 'error':
      if (page.resuming.current) {
        // Stored session is dead (room swept / token invalid): back to join.
        page.resuming.current = false;
        forgetRoom();
        page.setRoomCode(null);
        page.setView(null);
      }
      page.setError(msg.message);
      page.countRefusal();
      break;
  }
}

/**
 * Owns the WebSocket for the whole app: connects, resumes a stored session
 * after reload or connection loss, and reconnects with backoff (`keepConnected`).
 */
export function useGameConnection(): Connection {
  const [status, setStatus] = useState<Connection['status']>('connecting');
  const [view, setView] = useState<PlayerView | null>(null);
  const [spectatorView, setSpectatorView] = useState<SpectatorView | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [roomCode, setRoomCode] = useState<string | null>(loadCredentials()?.code ?? null);
  const [error, setError] = useState<string | null>(null);
  const [refusals, setRefusals] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const resumingRef = useRef(false);
  const positionsRef = useRef<KnownPositions>({ run: null, players: {} });
  const dronesRef = useRef<Record<string, DronePosition>>({});
  const pingsRef = useRef<{ playerId: string; x: number; y: number; at: number }[]>([]);
  const chatsRef = useRef<{ playerId: string; phrase: ChatPhrase; at: number }[]>([]);
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
    const page: Page = {
      setRoomCode,
      setView,
      setSpectatorView,
      setRooms,
      setError,
      countRefusal: () => setRefusals((count) => count + 1),
      resuming: resumingRef,
      positions: positionsRef,
      drones: dronesRef,
      pings: pingsRef,
      chats: chatsRef,
    };
    return keepConnected(() => new WebSocket(wsUrl()), {
      made: (socket) => {
        socketRef.current = socket;
      },
      status: setStatus,
      session: loadCredentials,
      resuming: () => {
        resumingRef.current = true;
      },
      message: (msg) => {
        takeIn(msg, page);
        for (const listener of listenersRef.current) {
          listener.message(msg);
        }
      },
      closed: () => {
        for (const listener of listenersRef.current) {
          listener.closed();
        }
      },
    });
  }, []);

  return {
    status,
    view,
    spectatorView,
    rooms,
    roomCode,
    error,
    refusals,
    positions: positionsRef,
    drones: dronesRef,
    pings: pingsRef,
    chats: chatsRef,
    send: (msg) => {
      setError(null);
      socketRef.current?.send(JSON.stringify(msg));
    },
    listen,
    signal,
    dismissError: () => setError(null),
    leaveRoom: () => {
      forgetRoom();
      location.reload();
    },
  };
}

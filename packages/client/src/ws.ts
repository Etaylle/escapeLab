import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { ClientMessage, PlayerPosition, PlayerView, ServerMessage } from '@escapelab/core';

interface Credentials {
  code: string;
  playerId: string;
  token: string;
}

export interface Connection {
  /** socket status; the game itself lives in `view` */
  status: 'connecting' | 'open' | 'closed';
  view: PlayerView | null;
  roomCode: string | null;
  error: string | null;
  /**
   * Live avatar positions, written on every positions broadcast WITHOUT a
   * React re-render — the canvas render loop reads this ref directly.
   */
  positions: MutableRefObject<Record<string, PlayerPosition>>;
  /** Map pings, newest last; the render loop drains expired ones itself. */
  pings: MutableRefObject<{ playerId: string; x: number; y: number; at: number }[]>;
  send: (msg: ClientMessage) => void;
  dismissError: () => void;
  leaveRoom: () => void;
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

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

/**
 * Owns the WebSocket for the whole app: connects, resumes a stored session
 * after reload or connection loss, and reconnects with backoff.
 */
export function useGameConnection(): Connection {
  const [status, setStatus] = useState<Connection['status']>('connecting');
  const [view, setView] = useState<PlayerView | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(loadCredentials()?.code ?? null);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const resumingRef = useRef(false);
  const positionsRef = useRef<Record<string, PlayerPosition>>({});
  const pingsRef = useRef<{ playerId: string; x: number; y: number; at: number }[]>([]);

  useEffect(() => {
    let disposed = false;
    let retryDelay = 1000;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    function connect(): void {
      const socket = new WebSocket(wsUrl());
      socketRef.current = socket;
      setStatus('connecting');

      socket.onopen = () => {
        setStatus('open');
        retryDelay = 1000;
        const creds = loadCredentials();
        if (creds !== null) {
          resumingRef.current = true;
          socket.send(JSON.stringify({ kind: 'resume', ...creds } satisfies ClientMessage));
        }
      };

      socket.onmessage = (event) => {
        const msg = JSON.parse(String(event.data)) as ServerMessage;
        handleServerMessage(msg);
      };

      socket.onclose = () => {
        if (disposed) {
          return;
        }
        setStatus('closed');
        retryTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 10_000);
      };
    }

    function handleServerMessage(msg: ServerMessage): void {
      switch (msg.kind) {
        case 'joined':
          resumingRef.current = false;
          sessionStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ code: msg.code, playerId: msg.playerId, token: msg.token }),
          );
          setRoomCode(msg.code);
          break;
        case 'view':
          setView(msg.view);
          break;
        case 'positions':
          positionsRef.current = msg.players;
          break;
        case 'ping':
          pingsRef.current.push({
            playerId: msg.playerId,
            x: msg.x,
            y: msg.y,
            at: performance.now(),
          });
          break;
        case 'error':
          if (resumingRef.current) {
            // Stored session is dead (room swept / token invalid): back to join.
            resumingRef.current = false;
            sessionStorage.removeItem(STORAGE_KEY);
            setRoomCode(null);
            setView(null);
          }
          setError(msg.message);
          break;
      }
    }

    connect();
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      socketRef.current?.close();
    };
  }, []);

  return {
    status,
    view,
    roomCode,
    error,
    positions: positionsRef,
    pings: pingsRef,
    send: (msg) => {
      setError(null);
      socketRef.current?.send(JSON.stringify(msg));
    },
    dismissError: () => setError(null),
    leaveRoom: () => {
      sessionStorage.removeItem(STORAGE_KEY);
      location.reload();
    },
  };
}

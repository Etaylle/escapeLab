import { EventEmitter } from 'node:events';
import type { ClientMessage, PlayerView, ServerMessage } from '@escapelab/core';

/** How long a pong takes to come back, ms: the line's round trip. */
export const ROUND_TRIP_MS = 40;

/**
 * A client's socket as the server sees it: it says what the client sends, answers a ping a
 * round trip later while `answering` — as a browser does on its own — and on `terminate`
 * leaves the server's clients and closes, as `ws` closes a socket it destroys; `close` is the
 * page closing it.
 */
export class FakeSocket extends EventEmitter {
  readonly heard: ServerMessage[] = [];
  answering = true;
  pings = 0;
  terminated = false;

  constructor(private readonly server: FakeServer) {
    super();
  }

  send(data: string): void {
    this.heard.push(JSON.parse(data) as ServerMessage);
  }

  ping(): void {
    this.pings += 1;
    setTimeout(() => {
      if (this.answering) {
        this.emit('pong');
      }
    }, ROUND_TRIP_MS);
  }

  terminate(): void {
    this.terminated = true;
    this.close();
  }

  /** The socket ends: it leaves the server's clients and closes. */
  close(): void {
    this.server.clients.delete(this);
    this.emit('close');
  }

  /** The client sends `msg`. */
  say(msg: ClientMessage): void {
    this.emit('message', Buffer.from(JSON.stringify(msg)));
  }

  /** The latest view this socket was sent. */
  get view(): PlayerView {
    const last = this.heard.filter((m) => m.kind === 'view').at(-1);
    if (last?.kind !== 'view') {
      throw new Error('this socket was sent no view');
    }
    return last.view;
  }
}

/** The WebSocket server and its open sockets, as `ws` keeps them. */
export class FakeServer extends EventEmitter {
  readonly clients = new Set<FakeSocket>();

  /** A client connects. */
  connect(): FakeSocket {
    const socket = new FakeSocket(this);
    this.clients.add(socket);
    this.emit('connection', socket);
    return socket;
  }
}

/** What the server says a socket that sat down: the room it sits in. */
export type Joined = Extract<ServerMessage, { kind: 'joined' }>;

/** The first `joined` the socket was sent; throws for a socket that never sat down. */
export function joinedOf(socket: FakeSocket): Joined {
  const joined = socket.heard.find((m): m is Joined => m.kind === 'joined');
  if (joined === undefined) {
    throw new Error('this socket never joined a room');
  }
  return joined;
}

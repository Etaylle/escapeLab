import { EventEmitter } from 'node:events';
import type { ClientMessage, PlayerView, ServerMessage } from '@escapelab/core';
import type { Sender } from '../src/rateLimiter.js';

/** How long a pong takes to come back, ms: the line's round trip. */
export const ROUND_TRIP_MS = 40;

/**
 * A client's socket as the server sees it: it says what the client sends, answers a ping a
 * round trip later while `answering` — as a browser does on its own — and on `terminate`
 * leaves the server's clients and closes, as `ws` closes a socket it destroys; `close` is the
 * page closing it. While `asking` its page's timers run: it asks the server's time as each
 * ping comes, as a page asks every 10 s (client clock.ts). While `listening` its page's
 * message handler runs: it answers each `tick` at once with a `tock`, as client line.ts does —
 * a tab long hidden still listens, its timers held back. A page held offline while its browser
 * answers the pings does neither.
 */
export class FakeSocket extends EventEmitter {
  readonly heard: ServerMessage[] = [];
  answering = true;
  asking = true;
  listening = true;
  pings = 0;
  terminated = false;

  constructor(private readonly server: FakeServer) {
    super();
  }

  send(data: string): void {
    const msg = JSON.parse(data) as ServerMessage;
    this.heard.push(msg);
    if (msg.kind === 'tick' && this.listening) {
      this.say({ kind: 'tock' });
    }
  }

  ping(): void {
    this.pings += 1;
    setTimeout(() => {
      if (this.answering) {
        this.emit('pong');
      }
    }, ROUND_TRIP_MS);
    if (this.asking) {
      this.say({ kind: 'clock', sent: Date.now() });
    }
  }

  terminate(): void {
    this.terminated = true;
    this.close(1006);
  }

  /**
   * The socket ends with close `code`: it leaves the server's clients and closes. A page that
   * closes its socket, or its tab, sends 1000 or 1001; a line that drops, or one cut, ends with
   * no close frame, 1006 or none.
   */
  close(code?: number): void {
    this.server.clients.delete(this);
    this.emit('close', code);
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

/** The request a client opens its socket with, from this machine unless a test says otherwise. */
export const FROM_HERE: Sender = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };

/** The WebSocket server and its open sockets, as `ws` keeps them. */
export class FakeServer extends EventEmitter {
  readonly clients = new Set<FakeSocket>();

  /** A client connects, with the request `sender` opened its socket with. */
  connect(sender: Sender = FROM_HERE): FakeSocket {
    const socket = new FakeSocket(this);
    this.clients.add(socket);
    this.emit('connection', socket, sender);
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage, ServerMessage } from '@escapelab/core';
import { keepConnected, type SocketEvents } from '../src/ws.js';

/**
 * A browser socket as `keepConnected` drives it: the test opens it, has the server say
 * something, or ends it — the server's heartbeat terminating it looks the same to a page as
 * any other end: the socket closes.
 */
class FakeSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  readonly sent: ClientMessage[] = [];
  closedByPage = false;

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ClientMessage);
  }

  close(): void {
    this.closedByPage = true;
  }

  /** The server takes the socket. */
  open(): void {
    this.onopen?.();
  }

  /** The server says `msg`. */
  say(msg: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  /** The socket ends: the server terminated it, or it never got through. */
  end(): void {
    this.onclose?.();
  }
}

const SESSION = { code: 'ABCD', playerId: 'p-ben', token: 't-ben' };

/** `keepConnected` over fake sockets, with what it told the page. */
function connection(session: typeof SESSION | null = SESSION) {
  const sockets: FakeSocket[] = [];
  const told = { statuses: [] as string[], heard: [] as ServerMessage[], closed: 0, resumes: 0 };
  const events: SocketEvents = {
    made: () => undefined,
    status: (status) => told.statuses.push(status),
    session: () => session,
    resuming: () => {
      told.resumes += 1;
    },
    message: (msg) => told.heard.push(msg),
    closed: () => {
      told.closed += 1;
    },
  };
  const stop = keepConnected(() => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket as unknown as WebSocket;
  }, events);
  const last = (): FakeSocket => {
    const socket = sockets.at(-1);
    if (socket === undefined) {
      throw new Error('no socket made');
    }
    return socket;
  };
  return { sockets, told, stop, last };
}

describe('keepConnected — the page’s line to the server', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resumes the session the page keeps on the socket it opens, and passes on what comes', () => {
    const { told, last } = connection();
    expect(told.statuses).toEqual(['connecting']);
    last().open();
    expect(told.statuses).toEqual(['connecting', 'open']);
    expect(last().sent).toEqual([{ kind: 'resume', ...SESSION }]);
    expect(told.resumes).toBe(1);
    last().say({ kind: 'rooms', rooms: [] });
    expect(told.heard).toEqual([{ kind: 'rooms', rooms: [] }]);
  });

  it('opens without resuming where the page keeps no session', () => {
    const { told, last } = connection(null);
    last().open();
    expect(last().sent).toEqual([]);
    expect(told.resumes).toBe(0);
  });

  it('after the server terminates the socket, connects again a second later and resumes', () => {
    const { sockets, told, last } = connection();
    last().open();
    last().end();
    expect(told.closed).toBe(1);
    expect(told.statuses.at(-1)).toBe('closed');
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    last().open();
    expect(last().sent).toEqual([{ kind: 'resume', ...SESSION }]);
    expect(told.statuses.slice(-3)).toEqual(['closed', 'connecting', 'open']);
  });

  it('backs off while the server stays away, 1 s doubling to 10 s, and starts over once in', () => {
    const { sockets, last } = connection();
    const waits: number[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      const made = sockets.length;
      last().end();
      let waited = 0;
      while (sockets.length === made) {
        vi.advanceTimersByTime(100);
        waited += 100;
      }
      waits.push(waited);
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000, 10_000, 10_000]);
    last().open();
    last().end();
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(8);
  });

  it('stops for good: the socket closed, no new one made', () => {
    const { sockets, told, stop, last } = connection();
    last().open();
    stop();
    expect(last().closedByPage).toBe(true);
    last().end();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(told.closed).toBe(0);
  });
});

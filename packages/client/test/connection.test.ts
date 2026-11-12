import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RESTART_CLOSE,
  type ClientMessage,
  type ServerMessage,
  type SpectatorView,
} from '@escapelab/core';
import {
  ANSWER_MS,
  keepConnected,
  OPENING_MS,
  OUTBOX_MAX,
  REWATCH_EVERY_MS,
  REWATCH_MS,
  SILENCE_MS,
  wipesBanner,
  type Comeback,
  type Retry,
  type SocketEvents,
} from '../src/line.js';
import { inBanner } from '../src/ws.js';

/**
 * A browser socket as `keepConnected` drives it: the test opens it, has the server say
 * something, or ends it — the server's heartbeat terminating it looks the same to a page as
 * any other end: the socket closes. Like a browser's, it throws when sent to while it is
 * still connecting, and lets go of what is sent to it once closed.
 */
class FakeSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event?: { code: number }) => void) | null = null;
  readyState: number = WebSocket.CONNECTING;
  readonly sent: ClientMessage[] = [];
  closedByPage = false;

  send(data: string): void {
    if (this.readyState === WebSocket.CONNECTING) {
      throw new DOMException("Failed to execute 'send': Still in CONNECTING state.");
    }
    if (this.readyState === WebSocket.OPEN) {
      this.sent.push(JSON.parse(data) as ClientMessage);
    }
  }

  close(): void {
    this.closedByPage = true;
  }

  /** The server takes the socket. */
  open(): void {
    this.readyState = WebSocket.OPEN;
    this.onopen?.();
  }

  /** The server says `msg`. */
  say(msg: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  /**
   * The socket ends: the server terminated it, or it never got through — with close `code`
   * where the server closed it with one.
   */
  end(code?: number): void {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.(code === undefined ? undefined : { code });
  }
}

/** Ben's tab plays in room ABCD, on his browser's pass: its sockets come back there. */
const SESSION: Extract<Comeback, { kind: 'resume' }> = {
  kind: 'resume',
  code: 'ABCD',
  pass: { id: 'b3'.repeat(16), secret: '7e'.repeat(32) },
};
/** The server has the seat back. */
const JOINED: ServerMessage = { kind: 'joined', code: SESSION.code, instanceId: 'boot-1' };

/** `keepConnected` over fake sockets, with what it told the page. */
function connection(session: Comeback | null = SESSION) {
  const sockets: FakeSocket[] = [];
  const told = {
    statuses: [] as string[],
    heard: [] as ServerMessage[],
    closed: 0,
    resumes: 0,
    ready: 0,
    retries: [] as (Retry | null)[],
    probes: 0,
  };
  const events: SocketEvents = {
    made: () => undefined,
    status: (status) => told.statuses.push(status),
    session: () => session,
    resuming: () => {
      told.resumes += 1;
    },
    ready: () => {
      told.ready += 1;
    },
    message: (msg) => told.heard.push(msg),
    closed: () => {
      told.closed += 1;
    },
    retry: (next) => told.retries.push(next),
    probe: () => {
      told.probes += 1;
    },
  };
  const line = keepConnected(() => {
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
  return { sockets, told, line, stop: line.stop, send: line.send, last };
}

const E: ClientMessage = { kind: 'request-hint' };
const POS: ClientMessage = {
  kind: 'pos',
  run: 1,
  x: 2.5,
  y: 3.5,
  facing: 0,
  moving: true,
  t: 1_700_000_000_000,
};

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
    expect(last().sent).toEqual([SESSION]);
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

  it('is ready once the server has the session back, or as it opens where none is kept', () => {
    const { told, last } = connection();
    last().open();
    expect(told.ready).toBe(0);
    last().say(JOINED);
    expect(told.ready).toBe(1);
    const fresh = connection(null);
    fresh.last().open();
    expect(fresh.told.ready).toBe(1);
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
    expect(last().sent).toEqual([SESSION]);
    expect(told.statuses.slice(-3)).toEqual(['closed', 'connecting', 'open']);
  });

  it('brings a watching tab back to the audience on every socket, ready once it sees again', () => {
    const WATCH: Comeback = { kind: 'spectate', code: 'ABCD' };
    const AUDIENCE = { kind: 'spectator-view', code: 'ABCD', at: 1 } as const;
    const seen = { ...AUDIENCE, view: {} as SpectatorView };
    const { sockets, told, send, last } = connection(WATCH);
    last().open();
    send({ kind: 'list-rooms' });
    expect(last().sent).toEqual([WATCH]);
    expect(told.resumes).toBe(1);
    last().say(seen);
    expect(told.ready).toBe(1);
    expect(last().sent).toEqual([WATCH, { kind: 'list-rooms' }]);
    last().end();
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);
    last().open();
    expect(last().sent).toEqual([WATCH]);
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

describe('keepConnected — the server going down for a restart', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lets the socket go as the server goes down for a restart, a new one made at once', () => {
    const { sockets, told, last } = connection();
    last().open();
    last().say(JOINED);
    const restart: ServerMessage = { kind: 'restart', blob: 'v1.a.b', seq: 9, at: 1 };
    last().say(restart);
    expect(told.heard.at(-1)).toEqual(restart);
    expect(sockets[0]?.closedByPage).toBe(true);
    expect(told.statuses.slice(-2)).toEqual(['closed', 'connecting']);
    expect(sockets).toHaveLength(2);
    expect(told.retries.at(-1)).toEqual({ attempt: 1, at: null, restart: true });
    // The server still down: the next try waits as ever, and is still the restart's.
    last().end();
    expect(told.retries.at(-1)).toEqual({ attempt: 2, at: Date.now() + 1000, restart: true });
    vi.advanceTimersByTime(1000);
    last().open();
    last().say(JOINED);
    expect(told.retries.at(-1)).toBeNull();
    // A drop after that is a drop again.
    last().end();
    expect(told.retries.at(-1)).toEqual({ attempt: 1, at: Date.now() + 1000 });
  });

  it('takes a socket the server closed with 1012 for its restart, told so or not', () => {
    const { told, last } = connection();
    last().open();
    last().say(JOINED);
    last().end(RESTART_CLOSE);
    expect(told.retries.at(-1)).toMatchObject({ attempt: 1, restart: true });
    vi.advanceTimersByTime(1000);
    last().end(1006);
    expect(told.retries.at(-1)).toMatchObject({ attempt: 2, restart: true });
  });

  it('asks again for the audience of a room a restart took down, the refusal kept back', () => {
    const WATCH: Comeback = { kind: 'spectate', code: 'ABCD' };
    const seen: ServerMessage = { kind: 'spectator-view', code: 'ABCD', at: 1, view: {} as never };
    const gone: ServerMessage = {
      kind: 'error',
      message: 'Raum "ABCD" existiert nicht (mehr).',
      of: 'spectate',
    };
    const { told, last } = connection(WATCH);
    last().open();
    last().say(seen);
    last().end(RESTART_CLOSE);
    vi.advanceTimersByTime(1000);
    last().open();
    last().say(gone);
    expect(told.heard).not.toContainEqual(gone);
    expect(told.ready).toBe(1);
    vi.advanceTimersByTime(REWATCH_EVERY_MS);
    expect(last().sent).toEqual([WATCH, WATCH]);
    // The crew is back, and the room with it: the audience sees again.
    last().say(seen);
    expect(told.ready).toBe(2);
  });

  it('lets the page hear the refusal once REWATCH_MS are over, and a seat’s at once', () => {
    const WATCH: Comeback = { kind: 'spectate', code: 'ABCD' };
    const gone: ServerMessage = { kind: 'error', message: 'weg', of: 'spectate' };
    const audience = connection(WATCH);
    audience.last().open();
    audience.last().say({ kind: 'spectator-view', code: 'ABCD', at: 1, view: {} as never });
    audience.last().end(RESTART_CLOSE);
    vi.advanceTimersByTime(REWATCH_MS);
    audience.last().open();
    audience.last().say(gone);
    expect(audience.told.heard).toContainEqual(gone);
    // A seat's resume refused after a restart is the page's to hear, as ever.
    const seat = connection();
    seat.last().open();
    seat.last().say(JOINED);
    seat.last().end(RESTART_CLOSE);
    vi.advanceTimersByTime(1000);
    seat.last().open();
    const refused: ServerMessage = { kind: 'error', message: 'nein', of: 'resume' };
    seat.last().say(refused);
    expect(seat.told.heard).toContainEqual(refused);
  });
});

describe('keepConnected — a comeback the new server keeps waiting for its room', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits on a comeback the new server answers with restoring, till the seat is back', () => {
    const waits: ServerMessage = { kind: 'restoring', code: SESSION.code };
    const { told, last } = connection();
    last().open();
    last().say(JOINED);
    last().end(RESTART_CLOSE);
    vi.advanceTimersByTime(1000);
    last().open();
    last().say(waits);
    // The line is up, the seat not yet: the card says the room is on its way, the line unready.
    expect(told.retries.at(-1)).toEqual({ attempt: 1, at: null, restoring: true, restart: true });
    expect(told.ready).toBe(1);
    expect(told.heard).not.toContainEqual(waits);
    // Its socket drops meanwhile: a try again, and the next comeback waits anew.
    last().end();
    expect(told.retries.at(-1)).toEqual({ attempt: 2, at: Date.now() + 1000, restart: true });
    vi.advanceTimersByTime(1000);
    last().open();
    last().say(waits);
    expect(told.retries.at(-1)).toMatchObject({ attempt: 2, restoring: true });
    // The room is back, the seat with it: the line ready.
    last().say(JOINED);
    expect(told.ready).toBe(2);
    expect(told.retries.at(-1)).toBeNull();
  });

  it('leaves a line that is up be when a resume the page sent waits for its room', () => {
    // The join screen's card asks back into the room on a line up with no session to resume.
    const { told, last, send } = connection(null);
    last().open();
    send(SESSION);
    const waits: ServerMessage = { kind: 'restoring', code: SESSION.code };
    last().say(waits);
    expect(told.retries.at(-1)).toBeNull();
    expect(told.heard).toContainEqual(waits);
  });
});

describe('keepConnected — sending while the line is down never throws', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sends at once on a socket that is open with its session back, or needing none', () => {
    const { send, last } = connection();
    last().open();
    last().say(JOINED);
    send(E);
    expect(last().sent).toEqual([SESSION, E]);
    const fresh = connection(null);
    fresh.last().open();
    fresh.send(E);
    expect(fresh.last().sent).toEqual([E]);
  });

  it('keeps an action sent while the socket connects until the server has the session back', () => {
    const { send, last } = connection();
    expect(() => send(E)).not.toThrow();
    expect(last().sent).toEqual([]);
    last().open();
    send({ kind: 'drop-item' });
    expect(last().sent).toEqual([SESSION]);
    last().say(JOINED);
    expect(last().sent).toEqual([SESSION, E, { kind: 'drop-item' }]);
  });

  it('drops what waited where the server refuses the session: none of it draws a refusal', () => {
    const { send, last } = connection();
    send(E);
    last().open();
    last().say({ kind: 'error', message: 'Wiederverbinden fehlgeschlagen.', of: 'resume' });
    expect(last().sent).toEqual([SESSION]);
    expect(console.warn).toHaveBeenCalledTimes(1);
    // the line is the page's again, for joining anew
    send({ kind: 'list-rooms' });
    expect(last().sent.at(-1)).toEqual({ kind: 'list-rooms' });
  });

  it('drops what waited for a socket that closed before it was ready', () => {
    const { send, last } = connection();
    send(E);
    last().end();
    vi.advanceTimersByTime(1000);
    last().open();
    last().say(JOINED);
    expect(last().sent).toEqual([SESSION]);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('keeps nothing done while no socket is on its way: no blind deed lands once back', () => {
    const { send, last } = connection();
    last().open();
    last().say(JOINED);
    last().end();
    send(E);
    send({ kind: 'puzzle-input', input: { action: 'press', value: 3 } });
    expect(console.warn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    last().open();
    last().say(JOINED);
    expect(last().sent).toEqual([SESSION]);
  });

  it('drops a position sent while the socket connects: the next one goes out anyway', () => {
    const { send, last } = connection();
    send(POS);
    last().open();
    last().say(JOINED);
    expect(last().sent).toEqual([SESSION]);
    send(POS);
    expect(last().sent.at(-1)).toEqual(POS);
  });

  it('drops what comes past the queue, said once on the console a time the line is down', () => {
    const { send, last } = connection();
    for (let i = 0; i < OUTBOX_MAX + 5; i++) {
      send(E);
    }
    send(POS);
    expect(console.warn).toHaveBeenCalledTimes(1);
    last().open();
    last().say(JOINED);
    expect(last().sent).toHaveLength(1 + OUTBOX_MAX);
    last().end();
    vi.advanceTimersByTime(1000);
    send(POS);
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it('forgets what waits once stopped', () => {
    const { send, stop, last } = connection();
    send(E);
    stop();
    last().open();
    expect(last().sent).toEqual([SESSION]);
  });
});

describe('the banner and the refusals said in place', () => {
  it('leaves to the device and the prompt pill what they answer, the rest to the banner', () => {
    for (const kind of ['puzzle-input', 'interact', 'open-source'] as const) {
      expect(inBanner(kind), kind).toBe(false);
    }
    for (const kind of ['resume', 'join-room', 'request-hint', 'read-note', undefined] as const) {
      expect(inBanner(kind), String(kind)).toBe(true);
    }
  });

  it('is taken down by the player’s next deed, never by what the page sends on its own', () => {
    for (const kind of ['pos', 'clock', 'list-rooms', 'whereami'] as const) {
      expect(wipesBanner(kind), kind).toBe(false);
    }
    for (const kind of ['interact', 'puzzle-input', 'join-room', 'create-room'] as const) {
      expect(wipesBanner(kind), kind).toBe(true);
    }
  });
});

/** An ask for the server's time, as clock.ts sends one. */
const ASK: ClientMessage = { kind: 'clock', sent: 1 };
/** The server's answer to it. */
const ANSWER: ServerMessage = { kind: 'clock', sent: 1, at: 2 };

describe('keepConnected — a line that shows itself dead', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A line up: its socket open, the seat back. */
  function up() {
    const line = connection();
    line.last().open();
    line.last().say(JOINED);
    return line;
  }

  it('is dead once an ask for the time goes unanswered 5 s: closed, and another made at once', () => {
    const { sockets, told, send, last } = up();
    send(ASK);
    vi.advanceTimersByTime(ANSWER_MS - 1);
    last().say(ANSWER);
    send(ASK);
    vi.advanceTimersByTime(ANSWER_MS - 1);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets[0]?.closedByPage).toBe(true);
    expect(sockets).toHaveLength(2);
    expect(told.closed).toBe(1);
    expect(told.statuses.slice(-2)).toEqual(['closed', 'connecting']);
  });

  it('answers every tick at once, and lives on ticks alone while the page’s timers stall', () => {
    const { sockets, told, last } = up();
    // The tab is long hidden: the page asks nothing, its timers held back; the server beats.
    for (let beat = 0; beat < 30; beat++) {
      vi.advanceTimersByTime(10_000);
      const before = last().sent.length;
      last().say({ kind: 'tick', instanceId: 'boot-1' });
      // Answered inside the message handler: no timer of the page's ran in between.
      expect(last().sent.slice(before)).toEqual([{ kind: 'tock' }]);
    }
    expect(sockets).toHaveLength(1);
    expect(told.heard.some((msg) => msg.kind === 'tick')).toBe(false);
  });

  it('is dead after 20 s without a word from the server', () => {
    const { sockets, last } = up();
    vi.advanceTimersByTime(SILENCE_MS - 1000);
    last().say({ kind: 'rooms', rooms: [] });
    vi.advanceTimersByTime(SILENCE_MS - 1);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
  });

  it('is dead 20 s after it opened where the server never said a word', () => {
    const { sockets, last } = connection(null);
    last().open();
    vi.advanceTimersByTime(SILENCE_MS - 1);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
  });

  it('is dead when its socket is not open 8 s after it was made', () => {
    const { sockets } = connection();
    vi.advanceTimersByTime(OPENING_MS - 1);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets[0]?.closedByPage).toBe(true);
    expect(sockets).toHaveLength(2);
  });

  it('backs off from 1 s again after a dead socket, and lets nothing of it reach the page', () => {
    const { sockets, told, last } = connection();
    last().end();
    vi.advanceTimersByTime(1000);
    last().end();
    // The third socket never opens: found dead, a fourth is made at once.
    vi.advanceTimersByTime(2000);
    vi.advanceTimersByTime(OPENING_MS);
    expect(sockets).toHaveLength(4);
    const heard = told.heard.length;
    const closed = told.closed;
    sockets[2]?.say({ kind: 'rooms', rooms: [] });
    sockets[2]?.end();
    expect(told.heard).toHaveLength(heard);
    expect(told.closed).toBe(closed);
    // The pause between tries starts at 1 s again, not at the 4 s the closes had come to.
    last().end();
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(4);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(5);
  });

  it('tells the page each next try, its number and when, and none once the line is up', () => {
    const { told, last } = up();
    expect(told.retries).toEqual([{ attempt: 1, at: null }, null]);
    last().end();
    expect(told.retries.at(-1)).toEqual({ attempt: 1, at: Date.now() + 1000 });
    vi.advanceTimersByTime(1000);
    expect(told.retries.at(-1)).toEqual({ attempt: 1, at: null });
    last().end();
    expect(told.retries.at(-1)).toEqual({ attempt: 2, at: Date.now() + 2000 });
    vi.advanceTimersByTime(2000);
    last().open();
    last().say(JOINED);
    expect(told.retries.at(-1)).toBeNull();
  });

  it('drops what is done while it is down, and throws nothing', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { send, last } = up();
    send(ASK);
    vi.advanceTimersByTime(ANSWER_MS);
    last().end();
    expect(() => send(E)).not.toThrow();
    expect(() => send(POS)).not.toThrow();
    vi.advanceTimersByTime(1000);
    last().open();
    last().say(JOINED);
    expect(last().sent).toEqual([SESSION]);
    vi.restoreAllMocks();
  });
});

describe('keepConnected — woken as the page comes back', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('tries at once where the line waits for its next try, the pause back at 1 s', () => {
    const { sockets, line, last } = connection();
    last().open();
    last().say(JOINED);
    last().end();
    vi.advanceTimersByTime(1000);
    last().end();
    line.wake();
    expect(sockets).toHaveLength(3);
    last().end();
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(4);
  });

  it('asks the time on a line that seems up, and leaves one on its way be', () => {
    const { sockets, told, line, last } = connection();
    line.wake();
    expect(sockets).toHaveLength(1);
    expect(told.probes).toBe(0);
    last().open();
    last().say(JOINED);
    line.wake();
    expect(told.probes).toBe(1);
    expect(sockets).toHaveLength(1);
  });
});

describe('keepConnected — a deed that has to reach the server once the line is back', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const GIVE_UP: ClientMessage = { kind: 'abandon', code: 'ABCD', pass: SESSION.pass };

  it('goes first on the next socket that opens, before anything else', () => {
    const { line, last } = connection(null);
    last().end();
    line.sendFirst(GIVE_UP);
    vi.advanceTimersByTime(1000);
    last().open();
    expect(last().sent).toEqual([GIVE_UP]);
    vi.advanceTimersByTime(1000);
    expect(last().sent).toEqual([GIVE_UP]);
  });

  it('goes at once on a line that is up', () => {
    const { line, last } = connection(null);
    last().open();
    line.sendFirst(GIVE_UP);
    expect(last().sent).toEqual([GIVE_UP]);
  });
});

import type { ClientMessage, ServerMessage } from '@escapelab/core';

/**
 * The page's line to the server: one socket at a time, kept open (`keepConnected`). A line
 * counts as dead the moment it shows it: an ask for the server's time unanswered ANSWER_MS
 * after it went out, SILENCE_MS without a word from the server — which beats every 10 s on
 * every socket (`tick`), and while a run is on sends where everybody stands every second — or
 * a socket not open OPENING_MS after it was made. A dead socket is closed, and a new one made
 * at once. After a close the next try waits, 1 s doubling to 10 s; the page coming back — the
 * network back, the page shown again or in focus (`Line.wake`) — tries at once, and a line
 * that seems up is asked the time to see whether it lives. Each `tick` is answered at once
 * with a `tock`, from the socket's message handler: that runs where the browser holds the
 * page's timers back, in a tab long hidden, so the server hears a page that lives.
 */

/** A socket's state, as the top bar's dot shows it. */
export type LineStatus = 'connecting' | 'open' | 'closed';

/** An ask for the server's time unanswered this long means the line is dead, ms. */
export const ANSWER_MS = 5000;
/** This long without a word from the server means the line is dead, ms. */
export const SILENCE_MS = 20_000;
/** A socket not open this long after it was made is dead, ms. */
export const OPENING_MS = 8000;
/** The pause before the first try to connect again, ms; it doubles with every try that fails. */
export const RETRY_FIRST_MS = 1000;
/** The longest pause between two tries, ms. */
export const RETRY_MAX_MS = 10_000;
/** How many messages wait for a socket to open; any more are dropped. */
export const OUTBOX_MAX = 32;

/** What answers a socket's comeback: its seat back, the audience's view again, or a refusal. */
const ANSWERS: ReadonlySet<ServerMessage['kind']> = new Set(['joined', 'spectator-view', 'error']);

/** The answer to the server's beat (`tick`), as it goes out. */
const TOCK = JSON.stringify({ kind: 'tock' } satisfies ClientMessage);

/**
 * What the page streams — positions, asks for the server's time — the next one supersedes it,
 * so none waits for a socket to open.
 */
const STREAMED: ReadonlySet<ClientMessage['kind']> = new Set(['pos', 'clock']);

/**
 * What the page sends on its own: its streams, and the join screen's asks — the open rooms,
 * where the pass sits — as it comes up and every few seconds. None is a deed of the player's.
 */
const UNBIDDEN: ReadonlySet<ClientMessage['kind']> = new Set([
  ...STREAMED,
  'list-rooms',
  'whereami',
]);

/** Whether sending a message of `kind` takes the banner down: the player's next deed only. */
export function wipesBanner(kind: ClientMessage['kind']): boolean {
  return !UNBIDDEN.has(kind);
}

/**
 * What a socket says first as it opens, to put the tab back where it was: on its seat
 * (`resume`, on the browser's pass) or in the audience of its room (`spectate`).
 */
export type Comeback = Extract<ClientMessage, { kind: 'resume' | 'spectate' }>;

/** The next try while the line is down: its number since the line was last up, and when. */
export interface Retry {
  /** 1 for the first try after the line was up */
  attempt: number;
  /** epoch ms the try goes out; null while it is under way */
  at: number | null;
}

/** What the socket `keepConnected` keeps open tells the app, and asks of it. */
export interface SocketEvents {
  /** a new socket was made: the one to send on from now */
  made: (socket: WebSocket) => void;
  status: (status: LineStatus) => void;
  /** where a socket puts the tab back as it opens (`Comeback`); null where it is in no room */
  session: () => Comeback | null;
  /** a comeback went out: an error now means the room, or the seat, the tab kept is gone */
  resuming: () => void;
  /** the line is ready: its socket open with the session back, or needing none (`Line.send`) */
  ready: () => void;
  message: (msg: ServerMessage) => void;
  /** the line dropped: its socket closed, or was found dead */
  closed: () => void;
  /** the next try while the line is down (`Retry`); null once it is up again */
  retry: (next: Retry | null) => void;
  /** asks the server's time on the line now, to see whether it lives (clock.ts) */
  probe: () => void;
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
   * the limit. Whatever is dropped is said once a time the line is down; nothing throws.
   */
  send: (msg: ClientMessage) => void;
  /**
   * Sends `msg` first on the next socket that opens — before any resume — or at once on a line
   * that is up: a deed that has to reach the server whenever the line is back, the seat given
   * up while it was down. The last one given is the one sent.
   */
  sendFirst: (msg: ClientMessage) => void;
  /** The page is back, or the player asks: a line down tries at once, one up is asked the time. */
  wake: () => void;
  stop: () => void;
}

/** What waits for a socket on its way (`Line.send`), and the one warning a time it is down. */
class Outbox {
  private waiting: string[] = [];
  private warned = false;

  /** Keeps `msg` for the socket on its way; false where it may not wait: streamed, or full. */
  keep(msg: ClientMessage): boolean {
    if (STREAMED.has(msg.kind) || this.waiting.length >= OUTBOX_MAX) {
      return false;
    }
    this.waiting.push(JSON.stringify(msg));
    return true;
  }

  /** Says once a time the line is down that `what` was dropped. */
  drop(what: string): void {
    if (!this.warned) {
      this.warned = true;
      console.warn(
        `escapelab: no line to the server — ${what} dropped, as is what the page streams or ` +
          'does while no socket is on its way, until the line is back',
      );
    }
  }

  /** What waited, in order, taken out: the line is ready, and back. */
  release(): string[] {
    const out = this.waiting;
    this.waiting = [];
    this.warned = false;
    return out;
  }

  /** What waited dropped: its socket will never be ready. */
  forget(): void {
    if (this.waiting.length > 0) {
      this.drop(`what waited (${this.waiting.length})`);
    }
    this.waiting = [];
  }
}

/** One timer at a time under a name: set anew, or cleared. */
class Alarm {
  private timer: ReturnType<typeof setTimeout> | undefined;

  set(ms: number, then: () => void): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      then();
    }, ms);
  }

  clear(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  get armed(): boolean {
    return this.timer !== undefined;
  }
}

/** The line's state and its moves, the sockets one after the other (`keepConnected`). */
class Keeper {
  private stopped = false;
  private retryDelay = RETRY_FIRST_MS;
  /** tries made since the line was last up */
  private tries = 0;
  private current: WebSocket | null = null;
  /** `current` is open with its session back, or needs none: what is sent goes straight out */
  private ready = false;
  /** asks for the server's time out on `current` and not yet answered */
  private asked = 0;
  private first: ClientMessage | null = null;
  private readonly waiting = new Outbox();
  private readonly retryAlarm = new Alarm();
  private readonly openingAlarm = new Alarm();
  private readonly silenceAlarm = new Alarm();
  private readonly answerAlarm = new Alarm();

  constructor(
    private readonly open: () => WebSocket,
    private readonly on: SocketEvents,
  ) {}

  connect(): void {
    this.retryAlarm.clear();
    const socket = this.open();
    this.current = socket;
    this.ready = false;
    this.asked = 0;
    this.tries += 1;
    this.on.made(socket);
    this.on.status('connecting');
    this.on.retry({ attempt: this.tries, at: null });
    this.openingAlarm.set(OPENING_MS, () => this.dead(socket));
    socket.onopen = () => this.opened(socket);
    socket.onmessage = (event) => this.heard(socket, String(event.data));
    socket.onclose = () => this.closed(socket);
  }

  send(msg: ClientMessage): void {
    const socket = this.current;
    if (this.ready && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg));
      if (msg.kind === 'clock') {
        this.askedNow();
      }
      return;
    }
    // Not ready, yet connecting or open: on its way.
    const onItsWay =
      socket?.readyState === WebSocket.CONNECTING || socket?.readyState === WebSocket.OPEN;
    if (!onItsWay || !this.waiting.keep(msg)) {
      this.waiting.drop(`"${msg.kind}"`);
    }
  }

  sendFirst(msg: ClientMessage): void {
    if (this.ready && this.current?.readyState === WebSocket.OPEN) {
      this.current.send(JSON.stringify(msg));
      return;
    }
    this.first = msg;
  }

  wake(): void {
    if (this.stopped) {
      return;
    }
    if (this.retryAlarm.armed) {
      this.retryDelay = RETRY_FIRST_MS;
      this.connect();
    } else if (this.ready && this.current?.readyState === WebSocket.OPEN) {
      this.on.probe();
    }
  }

  stop(): void {
    this.stopped = true;
    for (const alarm of [this.retryAlarm, this.openingAlarm, this.silenceAlarm, this.answerAlarm]) {
      alarm.clear();
    }
    this.waiting.release();
    this.current?.close();
  }

  private opened(socket: WebSocket): void {
    this.openingAlarm.clear();
    this.silenceAlarm.set(SILENCE_MS, () => this.dead(socket));
    this.on.status('open');
    this.retryDelay = RETRY_FIRST_MS;
    if (this.first !== null) {
      socket.send(JSON.stringify(this.first));
      this.first = null;
    }
    const comeback = this.on.session();
    if (comeback === null) {
      this.flush(socket);
      return;
    }
    this.on.resuming();
    socket.send(JSON.stringify(comeback));
  }

  private heard(socket: WebSocket, data: string): void {
    this.silenceAlarm.set(SILENCE_MS, () => this.dead(socket));
    const msg = JSON.parse(data) as ServerMessage;
    if (msg.kind === 'tick') {
      // Answered here and now: no timer of the page's has to run for it.
      socket.send(TOCK);
      return;
    }
    if (msg.kind === 'clock') {
      this.answered(socket);
    }
    this.on.message(msg);
    // The server's answer to the comeback: the seat back, the room's audience again, or refused.
    if (!this.ready && ANSWERS.has(msg.kind)) {
      if (msg.kind === 'error') {
        this.waiting.forget();
      }
      this.flush(socket);
    }
  }

  /** The line is ready on `socket`: what waited goes out on it, in order. */
  private flush(socket: WebSocket): void {
    this.ready = true;
    this.tries = 0;
    this.on.retry(null);
    for (const data of this.waiting.release()) {
      socket.send(data);
    }
    this.on.ready();
  }

  /** An ask for the time went out: unanswered ANSWER_MS from now, the line is dead. */
  private askedNow(): void {
    this.asked += 1;
    const socket = this.current;
    if (!this.answerAlarm.armed && socket !== null) {
      this.answerAlarm.set(ANSWER_MS, () => this.dead(socket));
    }
  }

  /** An answer came: the next ask still out has ANSWER_MS from now. */
  private answered(socket: WebSocket): void {
    this.asked = Math.max(0, this.asked - 1);
    this.answerAlarm.clear();
    if (this.asked > 0) {
      this.answerAlarm.set(ANSWER_MS, () => this.dead(socket));
    }
  }

  private closed(socket: WebSocket): void {
    if (this.stopped || socket !== this.current) {
      return;
    }
    this.lost();
    this.retryAlarm.set(this.retryDelay, () => this.connect());
    this.on.retry({ attempt: this.tries + 1, at: Date.now() + this.retryDelay });
    this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX_MS);
  }

  /**
   * `socket` showed itself dead: it is let go — nothing it says or does reaches the page any
   * more — and a new one is made at once, the pause between tries back at 1 s.
   */
  private dead(socket: WebSocket): void {
    if (this.stopped || socket !== this.current) {
      return;
    }
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.close();
    this.lost();
    this.retryDelay = RETRY_FIRST_MS;
    this.connect();
  }

  /** The line is down: nothing is ready, what waited is dropped, the page hears of it. */
  private lost(): void {
    this.ready = false;
    this.current = null;
    for (const alarm of [this.openingAlarm, this.silenceAlarm, this.answerAlarm]) {
      alarm.clear();
    }
    this.waiting.forget();
    this.on.closed();
    this.on.status('closed');
  }
}

/**
 * Keeps a socket to the server open, each made by `open`: every socket that opens resumes the
 * session the page keeps; a socket that closes — the server restarted, the line dropped, the
 * server's heartbeat terminating it — or shows itself dead is followed by another (see the
 * module's comment). A message sent meanwhile never throws (`Line.send`).
 */
export function keepConnected(open: () => WebSocket, on: SocketEvents): Line {
  const keeper = new Keeper(open, on);
  keeper.connect();
  return {
    send: (msg) => keeper.send(msg),
    sendFirst: (msg) => keeper.sendFirst(msg),
    wake: () => keeper.wake(),
    stop: () => keeper.stop(),
  };
}

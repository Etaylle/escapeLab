/**
 * The server's ear on every connection. A socket whose other end vanished without a word — a
 * laptop shut, a phone gone out of reach, a router dropping the line — stays open on the
 * server until TCP gives up, minutes later, and meanwhile the room waits for a player who is
 * not there and keeps its clock running. So every socket, the players' and the audience's
 * alike, is pinged every HEARTBEAT_MS, and one that leaves MISSED_PINGS pings in a row
 * unanswered is terminated: it closes like any other, and the room hears the player go
 * (`player-disconnected`, the pause while someone is missing) — within three beats of the
 * silence. Browsers answer a ping on their own, even for a page that has stopped — frozen in
 * the background, or its network held back as DevTools' offline mode does — so a socket that
 * sends nothing for SILENT_MS is terminated as well: a page asks the server's time every 10 s
 * (client clock.ts). A player back on a new socket resumes.
 */

/** How often every socket is pinged, ms. */
export const HEARTBEAT_MS = 10_000;

/** Pings in a row a socket may leave unanswered: the beat that finds this many terminates it. */
export const MISSED_PINGS = 2;

/** How long a socket may send nothing before it is terminated, ms — the page's own rule too. */
export const SILENT_MS = 20_000;

/** Why the heartbeat terminated a socket: its pings went unanswered, or it sent nothing. */
export type CutReason = 'pongs' | 'silent';

/** What the heartbeat needs of a socket: `ws`'s WebSocket has it. */
export interface BeatingSocket {
  ping(): void;
  terminate(): void;
  on(event: 'pong' | 'message' | 'close', listener: () => void): unknown;
}

/** What the heartbeat needs of the server: `ws`'s WebSocketServer has it. */
export interface BeatingServer {
  readonly clients: Iterable<BeatingSocket>;
  on(event: 'connection', listener: (socket: BeatingSocket) => void): unknown;
}

/**
 * Pings every socket of `server` every `everyMs` and terminates one whose last MISSED_PINGS
 * pings went unanswered, or that sent nothing for SILENT_MS; a pong at any time clears its
 * count. `onCut` hears of every socket terminated, and why, just before it closes. Returns how
 * to stop.
 */
export function startHeartbeat(
  server: BeatingServer,
  everyMs = HEARTBEAT_MS,
  onCut: (socket: BeatingSocket, why: CutReason) => void = () => undefined,
): () => void {
  const unanswered = new WeakMap<BeatingSocket, number>();
  let stopped = false;
  const cut = (socket: BeatingSocket, why: CutReason): void => {
    if (stopped) {
      return;
    }
    onCut(socket, why);
    socket.terminate();
  };
  server.on('connection', (socket) => {
    socket.on('pong', () => unanswered.set(socket, 0));
    const listen = (): NodeJS.Timeout => setTimeout(() => cut(socket, 'silent'), SILENT_MS);
    let silence = listen();
    socket.on('message', () => {
      clearTimeout(silence);
      silence = listen();
    });
    socket.on('close', () => clearTimeout(silence));
  });
  const timer = setInterval(() => {
    for (const socket of server.clients) {
      const missed = unanswered.get(socket) ?? 0;
      if (missed >= MISSED_PINGS) {
        cut(socket, 'pongs');
        continue;
      }
      unanswered.set(socket, missed + 1);
      socket.ping();
    }
  }, everyMs);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

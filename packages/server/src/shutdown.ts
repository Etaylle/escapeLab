import type { RoomManager } from './roomManager.js';

/**
 * The server going down for a restart: Render sends SIGTERM before a deploy replaces the
 * instance, or whenever a Free instance restarts, and waits 30 s for it to end; a Ctrl-C asks the
 * same. No room's run is lost to it: every run stands still and every seat on the line is handed
 * the room's last snapshot, sealed, which its page hands the next server back (seal.ts).
 */

/** The code a socket is closed with as the server goes down for a restart: Service Restart. */
export const RESTART_CLOSE = 1012;

/** How long the server waits for its sockets to close before it exits all the same, ms. */
export const CLOSING_MS = 3000;

/** How often it looks whether they have, ms. */
const LOOK_MS = 50;

/** What the closing frame says. */
const RESTART_REASON = 'Server startet neu';

/** A socket as the server closes it: `ws`'s WebSocket has it. */
export interface ClosingSocket {
  close(code: number, reason: string): void;
  terminate(): void;
}

/** What going down needs of the server: its web server, its sockets, its rooms, the process. */
export interface Going {
  /** takes no new connection from now: the web server, and the socket server on it */
  stopTaking: () => void;
  /** the sockets open right now */
  sockets: () => Iterable<ClosingSocket>;
  manager: Pick<RoomManager, 'shutDown'>;
  exit: (code: number) => void;
}

/**
 * The server goes down for a restart: it takes no new connection, every room stands its run
 * still and tells every seat its last snapshot (`restart`, RoomManager `shutDown`), every socket
 * is closed with RESTART_CLOSE, and once they are closed — CLOSING_MS at the latest, the ones
 * still open cut — the process exits 0, well within Render's 30 s.
 */
export function shutDown(going: Going): void {
  going.stopTaking();
  going.manager.shutDown(Date.now());
  for (const socket of going.sockets()) {
    socket.close(RESTART_CLOSE, RESTART_REASON);
  }
  const until = Date.now() + CLOSING_MS;
  const look = (): void => {
    const open = [...going.sockets()];
    if (open.length > 0 && Date.now() < until) {
      setTimeout(look, LOOK_MS);
      return;
    }
    for (const socket of open) {
      socket.terminate();
    }
    going.exit(0);
  };
  look();
}

/**
 * What the process does on SIGTERM or SIGINT (index.ts): it goes down for a restart
 * (`shutDown`), the log naming the signal. A signal again meanwhile changes nothing — a Ctrl-C
 * under `pnpm dev` comes twice, from the terminal and from tsx watch — and CLOSING_MS bounds the
 * way down as ever.
 */
export function onSignal(going: Going): (signal: NodeJS.Signals) => void {
  let down = false;
  return (signal) => {
    if (down) {
      console.log(`[escapelab] ${signal} again: going down already`);
      return;
    }
    down = true;
    console.log(`[escapelab] ${signal}: going down for a restart`);
    shutDown(going);
  };
}

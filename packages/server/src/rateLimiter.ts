import type { IncomingMessage } from 'node:http';

/**
 * Limits on writes by who sends them: the editor's missions (customMissions.ts) and the accounts
 * (sockets.ts) each count the writes of an address in a sliding window.
 */

/**
 * Counts writes per address in a sliding window: `take` says whether one
 * more is allowed now, and counts it if so.
 */
export class RateLimiter {
  private readonly seen = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(key: string): boolean {
    const now = this.now();
    const recent = (this.seen.get(key) ?? []).filter((at) => now - at < this.windowMs);
    const allowed = recent.length < this.limit;
    if (allowed) {
      recent.push(now);
    }
    if (recent.length === 0) {
      this.seen.delete(key);
    } else {
      this.seen.set(key, recent);
    }
    return allowed;
  }
}

/** What a request's sender is read from: its headers and its socket. */
export type Sender = Pick<IncomingMessage, 'headers'> & {
  socket: Pick<IncomingMessage['socket'], 'remoteAddress'>;
};

/**
 * The address a request comes from, as a limit counts it: the first of X-Forwarded-For where a
 * proxy in front set one — behind Render's proxy the socket's own address is the proxy's, the same
 * for everybody, and Render puts the client's first — else the socket's.
 */
export function clientAddress(sender: Sender): string {
  const forwarded = sender.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return first !== undefined && first !== '' ? first : (sender.socket.remoteAddress ?? 'unknown');
}

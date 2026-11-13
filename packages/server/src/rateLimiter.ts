import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';

/**
 * Limits on writes by who sends them: the editor's missions (customMissions.ts) and the accounts
 * (sockets.ts) each count the writes of an address in a sliding window.
 */

/** The longest key a limiter keeps, cut there: an IP address is at most 45 characters. */
export const MAX_KEY_LENGTH = 64;

/**
 * Counts writes per address in a sliding window: `take` says whether one more is allowed now, and
 * counts it if so. A key with no write left in its window is let go of (`sweep`) — by the next
 * check once a window has passed since the last sweep, or by the timer of `sweepEveryWindow` —
 * so that addresses seen once are not held for the server's life.
 */
export class RateLimiter {
  private readonly seen = new Map<string, number[]>();
  /** when the keys were last swept */
  private swept: number;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {
    this.swept = now();
  }

  /** How many keys it holds now. */
  get size(): number {
    return this.seen.size;
  }

  take(address: string): boolean {
    const now = this.now();
    if (now - this.swept >= this.windowMs) {
      this.sweep();
    }
    const key = address.slice(0, MAX_KEY_LENGTH);
    const recent = (this.seen.get(key) ?? []).filter((at) => now - at < this.windowMs);
    const allowed = recent.length < this.limit;
    if (allowed) {
      recent.push(now);
    }
    this.seen.set(key, recent);
    return allowed;
  }

  /** Lets go of every key with no write left in the window. */
  sweep(): void {
    const now = this.now();
    this.swept = now;
    for (const [key, writes] of this.seen) {
      const last = writes.at(-1);
      if (last === undefined || now - last >= this.windowMs) {
        this.seen.delete(key);
      }
    }
  }

  /** Sweeps once a window from now, never keeping the process up for it; returns how to stop. */
  sweepEveryWindow(): () => void {
    const timer = setInterval(() => this.sweep(), this.windowMs);
    timer.unref();
    return () => clearInterval(timer);
  }
}

/** What a request's sender is read from: its headers and its socket. */
export type Sender = Pick<IncomingMessage, 'headers'> & {
  socket: Pick<IncomingMessage['socket'], 'remoteAddress'>;
};

/**
 * Who stands between a client and the server: Render's proxy — Cloudflare in front of Render's
 * balancer — or nobody, as on the LAN, where a request's headers are the client's own to write.
 */
export type Front = 'render' | 'none';

/** Who stands in front, as the environment says: Render sets `RENDER` on its services. */
export function frontOf(env: NodeJS.ProcessEnv): Front {
  return (env['RENDER'] ?? '') === '' ? 'none' : 'render';
}

/** `value` as an address a limit may count by: one valid IP address, else undefined. */
function ipOf(value: string | readonly string[] | undefined): string | undefined {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : undefined;
  return text !== undefined && isIP(text) !== 0 ? text : undefined;
}

/** The last address of an X-Forwarded-For header: the one the proxy in front appended. */
function lastForwarded(value: string | readonly string[] | undefined): string | undefined {
  const joined = Array.isArray(value) ? value.join(',') : value;
  return typeof joined === 'string' ? joined.split(',').at(-1) : undefined;
}

/**
 * The address a request comes from, as a limit counts it: only ever a valid IP address, and
 * `unknown` — every such request counted together — where none is to be had. Behind Render
 * (`front`) the socket's own address is the proxy's, the same for everybody, and a client may
 * send any X-Forwarded-For it likes, which Cloudflare appends to: so Cloudflare's
 * `cf-connecting-ip`, else `true-client-ip`, else the last X-Forwarded-For entry, the one the
 * proxy put there. With nobody in front no header is to be trusted: the socket's own address.
 */
export function clientAddress(sender: Sender, front: Front): string {
  const { headers, socket } = sender;
  const proxied =
    front === 'render'
      ? (ipOf(headers['cf-connecting-ip']) ??
        ipOf(headers['true-client-ip']) ??
        ipOf(lastForwarded(headers['x-forwarded-for'])))
      : undefined;
  return proxied ?? ipOf(socket.remoteAddress) ?? 'unknown';
}

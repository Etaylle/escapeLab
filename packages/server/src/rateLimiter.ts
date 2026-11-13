import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';

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

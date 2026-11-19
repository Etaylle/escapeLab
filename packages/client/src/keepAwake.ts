/**
 * A page that watches the demo room keeps its server awake: a host that puts an instance to sleep
 * once no request has come for a while (Render's free plan: 15 minutes) counts requests, and a
 * page that only watches sends none — its socket stays open and says nothing over HTTP. So the
 * demo's audience asks `/health` every few minutes, for as long as it watches.
 */

/** How often the demo's audience asks the server's health, ms: well inside a quarter of an hour. */
export const KEEP_AWAKE_MS = 4 * 60_000;

/** What the keeping awake needs of its page: to ask an address, and its timers. */
export interface AwakePage {
  fetch: (address: string, init: { cache: 'no-store' }) => Promise<unknown>;
  setInterval: (run: () => void, ms: number) => unknown;
  clearInterval: (timer: never) => void;
}

/**
 * Asks `/health` on `page` every KEEP_AWAKE_MS from now on, the answer left unread; a request
 * that fails — the line down, the server restarting — fails quietly, the next goes all the same.
 * Returns how to stop.
 */
export function keepAwake(page: AwakePage = globalThis as unknown as AwakePage): () => void {
  const ask = (): void => {
    // Deliberately silent: the page's own line says when the server is away (line.ts).
    page.fetch('/health', { cache: 'no-store' }).catch(() => undefined);
  };
  const timer = page.setInterval(ask, KEEP_AWAKE_MS);
  return () => page.clearInterval(timer as never);
}

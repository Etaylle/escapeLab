/**
 * How the service worker (worker.ts) answers a request, as a table of its
 * own so it can be tested without a worker. The build's files carry their
 * content's hash in the name and never change: the cache answers first. The
 * page and the mission data change with every release: the network answers
 * first, and what it answered stands in when the network is gone. The socket
 * and the health check are the server's alone and never cached.
 */

/** A way of answering a request. */
export type Route =
  /** cache first, a miss fetched and kept: the hashed build files, the icons, the manifest */
  | 'build'
  /** network first, kept under "/": the page, however it was asked for */
  | 'page'
  /** network first, kept under its own address: the mission list, a mission's manual */
  | 'data';

/** A path and everything under it: "/missions" and "/missions/blackout/manual". */
function under(prefix: string): (path: string) => boolean {
  return (path) => path === prefix || path.startsWith(`${prefix}/`);
}

/** Checked in order; a path no row takes is the worker's only if it precached it. */
const TABLE: readonly { matches: (path: string) => boolean; route: Route | null }[] = [
  { matches: under('/ws'), route: null },
  { matches: under('/health'), route: null },
  { matches: (path) => path === '/' || path === '/index.html', route: 'page' },
  { matches: under('/missions'), route: 'data' },
  { matches: under('/assets'), route: 'build' },
];

/**
 * How the worker answers `request`, or null to leave it to the browser: any
 * method but GET, any other origin, the server's own paths, and whatever it
 * did not precache outside the table.
 *
 * @param origin the worker's origin
 * @param precached the addresses the worker keeps since its install
 */
export function routeOf(
  request: { method: string; url: string },
  origin: string,
  precached: ReadonlySet<string>,
): Route | null {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== origin) {
    return null;
  }
  const row = TABLE.find((entry) => entry.matches(url.pathname));
  if (row !== undefined) {
    return row.route;
  }
  return precached.has(url.pathname) ? 'build' : null;
}

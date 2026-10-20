import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { precacheFiles } from '../src/sw/build.js';
import { routeOf } from '../src/sw/routes.js';

const ORIGIN = 'https://lab.test';

describe('the service worker routes', () => {
  const precached = new Set(['/', '/assets/index-1.js', '/icon.svg', '/manifest.webmanifest']);
  const route = (path: string, method = 'GET'): string | null =>
    routeOf({ method, url: new URL(path, ORIGIN).href }, ORIGIN, precached);

  it('answers the hashed build files from the cache first, kept or not', () => {
    expect(route('/assets/index-1.js')).toBe('build');
    expect(route('/assets/vendor-9.js')).toBe('build');
  });

  it('answers the precached icons and the manifest from the cache first', () => {
    expect(route('/icon.svg')).toBe('build');
    expect(route('/manifest.webmanifest')).toBe('build');
  });

  it('asks the network first for the page, an invite link included', () => {
    expect(route('/')).toBe('page');
    expect(route('/?room=QXT4')).toBe('page');
    expect(route('/index.html')).toBe('page');
  });

  it('asks the network first for the mission list and the manuals', () => {
    expect(route('/missions')).toBe('data');
    expect(route('/missions/blackout/manual')).toBe('data');
  });

  it('never takes the socket or the health check', () => {
    expect(route('/ws')).toBeNull();
    expect(route('/health')).toBeNull();
    expect(route('/health?probe=1')).toBeNull();
  });

  it('leaves other methods, other origins and unknown paths to the browser', () => {
    expect(route('/missions', 'POST')).toBeNull();
    expect(route('https://fonts.googleapis.com/css2?family=Caveat')).toBeNull();
    expect(route('/sw.js')).toBeNull();
    expect(route('/favicon.ico')).toBeNull();
  });

  it('reads a path as a path: /wsx and /missionsfoo are not under /ws or /missions', () => {
    expect(route('/wsx')).toBeNull();
    expect(route('/missionsfoo')).toBeNull();
  });
});

describe('the precache list', () => {
  it('keeps the page as "/", then the build and public/ by address, in order', () => {
    expect(
      precacheFiles(
        ['index.html', 'sw.js', 'assets/vendor-2.js', 'assets/index-1.css'],
        ['manifest.webmanifest', 'icon.svg'],
      ),
    ).toEqual([
      '/',
      '/assets/index-1.css',
      '/assets/vendor-2.js',
      '/icon.svg',
      '/manifest.webmanifest',
    ]);
  });

  it('leaves out dotfiles, whatever folder they lie in', () => {
    expect(precacheFiles(['.vite/manifest.json'], ['.DS_Store', 'icons/.hidden'])).toEqual(['/']);
  });
});

// --- the worker itself, driven by fake events -------------------------------

/** A cache key as the browser makes it: the absolute address. */
function keyOf(request: RequestInfo | URL): string {
  if (typeof request === 'string') {
    return new URL(request, ORIGIN).href;
  }
  return request instanceof URL ? request.href : request.url;
}

/** The browser's cache storage, in memory: cache name → address → response. */
class FakeCaches {
  readonly stores = new Map<string, Map<string, Response>>();

  async open(name: string) {
    const store = this.stores.get(name) ?? new Map<string, Response>();
    this.stores.set(name, store);
    return {
      match: async (request: RequestInfo | URL) => store.get(keyOf(request))?.clone(),
      put: async (request: RequestInfo | URL, response: Response) => {
        store.set(keyOf(request), response);
      },
      addAll: async (requests: string[]) => {
        for (const request of requests) {
          const response = await fetch(new URL(request, ORIGIN));
          if (!response.ok) {
            throw new TypeError(`addAll: ${request} answered ${response.status}`);
          }
          store.set(keyOf(request), response);
        }
      },
    };
  }

  async keys(): Promise<string[]> {
    return [...this.stores.keys()];
  }

  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name);
  }

  /** What `name` keeps under `path`, as text; null when nothing. */
  async text(name: string, path: string): Promise<string | null> {
    const response = this.stores.get(name)?.get(new URL(path, ORIGIN).href);
    return response === undefined ? null : response.clone().text();
  }
}

const FILES = ['/', '/assets/index-1.js', '/assets/index-1.css', '/icon.svg'];
const CACHE = 'escapelab-v2';

/** What the server holds, by path; the network fails while `online` is false. */
const server = new Map(FILES.map((path) => [path, `body of ${path}`]));
server.set('/missions', '[{"id":"blackout"}]');
let online = true;
const network = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  if (!online) {
    throw new TypeError('Failed to fetch');
  }
  const body = server.get(new URL(keyOf(input)).pathname);
  return body === undefined ? new Response('', { status: 404 }) : new Response(body);
});

type Listener = (event: unknown) => void;
const listeners = new Map<string, Listener>();
const told: unknown[] = [];
const scope = {
  location: { origin: ORIGIN },
  clients: {
    claim: vi.fn(async () => undefined),
    matchAll: vi.fn(async () => [{ postMessage: (news: unknown) => told.push(news) }]),
  },
  skipWaiting: vi.fn(async () => undefined),
  addEventListener: (type: string, listener: Listener) => {
    listeners.set(type, listener);
  },
};
let caches = new FakeCaches();

/** Dispatches install or activate and waits for what the worker gave `waitUntil`. */
async function lifecycle(type: 'install' | 'activate'): Promise<void> {
  const pending: Promise<unknown>[] = [];
  listeners.get(type)?.({ waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
  await Promise.all(pending);
}

/** Dispatches a fetch: the worker's answer, or null when it leaves the request to the browser. */
function request(path: string, method = 'GET'): Promise<Response> | null {
  const answered: { response: Promise<Response> | null } = { response: null };
  listeners.get('fetch')?.({
    request: new Request(new URL(path, ORIGIN), { method }),
    respondWith: (response: Promise<Response>) => {
      answered.response = response;
    },
  });
  return answered.response;
}

async function text(answer: Promise<Response> | null): Promise<string> {
  if (answer === null) {
    throw new Error('the worker left the request to the browser');
  }
  return (await answer).text();
}

describe('the service worker', () => {
  beforeAll(async () => {
    vi.stubGlobal('self', scope);
    vi.stubGlobal('PRECACHE', { version: 'v2', files: FILES });
    vi.stubGlobal('fetch', network);
    await import('../src/sw/worker.js');
  });

  beforeEach(() => {
    caches = new FakeCaches();
    vi.stubGlobal('caches', caches);
    online = true;
    told.length = 0;
    network.mockClear();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the whole build in the cache of its version at install, then steps in', async () => {
    await lifecycle('install');
    expect([...(caches.stores.get(CACHE)?.keys() ?? [])]).toEqual(
      FILES.map((path) => new URL(path, ORIGIN).href),
    );
    expect(scope.skipWaiting).toHaveBeenCalled();
  });

  it('drops older versions on taking over, claims the pages and tells them its files', async () => {
    for (const name of ['escapelab-v1', CACHE, 'someone-else']) {
      await caches.open(name);
    }
    await lifecycle('activate');
    expect(await caches.keys()).toEqual([CACHE, 'someone-else']);
    expect(scope.clients.claim).toHaveBeenCalled();
    expect(told).toEqual([{ kind: 'escapelab-sw', files: FILES }]);
  });

  it('answers a kept build file without the network', async () => {
    await (await caches.open(CACHE)).put('/assets/index-1.js', new Response('kept'));
    expect(await text(request('/assets/index-1.js'))).toBe('kept');
    expect(network).not.toHaveBeenCalled();
  });

  it('fetches a build file it lacks once, and keeps it', async () => {
    expect(await text(request('/assets/index-1.css'))).toBe('body of /assets/index-1.css');
    expect(await text(request('/assets/index-1.css'))).toBe('body of /assets/index-1.css');
    expect(network).toHaveBeenCalledTimes(1);
  });

  it('asks the network for the page first and keeps one copy under "/"', async () => {
    server.set('/', 'the new page');
    expect(await text(request('/?room=QXT4'))).toBe('the new page');
    expect(await caches.text(CACHE, '/')).toBe('the new page');
    expect(await caches.text(CACHE, '/?room=QXT4')).toBeNull();
    server.set('/', 'body of /');
  });

  it('opens the kept page offline, for any invite link', async () => {
    await (await caches.open(CACHE)).put('/', new Response('the kept page'));
    online = false;
    expect(await text(request('/?room=ABCD'))).toBe('the kept page');
  });

  it('shows the mission list kept from the last visit while offline', async () => {
    expect(await text(request('/missions'))).toBe('[{"id":"blackout"}]');
    online = false;
    expect(await text(request('/missions'))).toBe('[{"id":"blackout"}]');
  });

  it('fails like the network offline when it kept nothing', async () => {
    online = false;
    await expect(request('/missions')).rejects.toThrow('Failed to fetch');
  });

  it('leaves the socket, the health check, other methods and origins to the browser', () => {
    expect(request('/ws')).toBeNull();
    expect(request('/health')).toBeNull();
    expect(request('/missions', 'POST')).toBeNull();
    expect(request('https://fonts.googleapis.com/css2?family=Caveat')).toBeNull();
  });
});

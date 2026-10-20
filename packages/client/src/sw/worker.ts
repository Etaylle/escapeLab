import type { WorkerNews } from './news.js';
import { routeOf, type Route } from './routes.js';

/**
 * The service worker. build.ts builds it into dist/sw.js, a classic script
 * that imports nothing, and puts PRECACHE in front of it: this build's files
 * and a version hashed from their contents. The worker keeps the whole build
 * in a cache named after that version and answers requests by routes.ts. A
 * new version steps in at once: it drops the older caches, claims the open
 * pages and tells them its files, so a page of an older build can offer the
 * reload (pwa.ts).
 */

/** Put in front of this script by build.ts. */
declare const PRECACHE: { version: string; files: string[] };

/** The few parts of a service worker's scope used here; lib.dom declares none of them. */
interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface FetchEvent extends ExtendableEvent {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}

interface OpenPage {
  postMessage(news: WorkerNews): void;
}

interface WorkerScope {
  readonly location: { readonly origin: string };
  readonly clients: {
    claim(): Promise<void>;
    matchAll(options: { type: 'window' }): Promise<readonly OpenPage[]>;
  };
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void;
}

const worker = self as unknown as WorkerScope;
/** Every cache of this site's workers starts so; another prefix is not ours to drop. */
const PREFIX = 'escapelab-';
const CACHE = `${PREFIX}${PRECACHE.version}`;
const PRECACHED: ReadonlySet<string> = new Set(PRECACHE.files);

worker.addEventListener('install', (event) => {
  event.waitUntil(keepBuild());
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(takeOver());
});

worker.addEventListener('fetch', (event) => {
  const route = routeOf(event.request, worker.location.origin, PRECACHED);
  if (route !== null) {
    event.respondWith(answer(route, event.request));
  }
});

/** Keeps the whole build, then steps in without waiting for older pages to close. */
async function keepBuild(): Promise<void> {
  const cache = await caches.open(CACHE);
  await cache.addAll(PRECACHE.files);
  await worker.skipWaiting();
}

/** Drops older versions' caches, claims the open pages and tells them which files it serves. */
async function takeOver(): Promise<void> {
  const older = (await caches.keys()).filter((name) => name.startsWith(PREFIX) && name !== CACHE);
  await Promise.all(older.map((name) => caches.delete(name)));
  await worker.clients.claim();
  const news: WorkerNews = { kind: 'escapelab-sw', files: PRECACHE.files };
  for (const page of await worker.clients.matchAll({ type: 'window' })) {
    page.postMessage(news);
  }
}

async function answer(route: Route, request: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  switch (route) {
    case 'build':
      return cacheFirst(cache, request);
    case 'page':
      // An invite link (/?room=…) is the same page: one copy, under "/".
      return networkFirst(cache, request, '/');
    case 'data':
      return networkFirst(cache, request, request);
  }
}

async function cacheFirst(cache: Cache, request: Request): Promise<Response> {
  const kept = await cache.match(request);
  if (kept !== undefined) {
    return kept;
  }
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}

/** The network's answer, kept under `key`; the kept one only when the network fails. */
async function networkFirst(cache: Cache, request: Request, key: RequestInfo): Promise<Response> {
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(key, response.clone());
    }
    return response;
  } catch (error) {
    const kept = await cache.match(key);
    if (kept === undefined) {
      throw error;
    }
    return kept;
  }
}

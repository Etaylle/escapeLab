import { useSyncExternalStore } from 'react';
import type { WorkerNews } from './sw/news.js';

/**
 * EscapeLab as an app on the phone: the browser's offer to put it on the
 * home screen, held back for the join screen's line (screens/Install.tsx),
 * and the service worker (sw/worker.ts), registered in production builds,
 * whose word that a new version took over becomes the reload line once this
 * page turns out to be older.
 *
 * Both need a secure origin, localhost or https. The game is usually played
 * over plain http on a LAN address, where neither exists: then nothing is
 * watched or registered, no line shows and the console stays quiet. Where a
 * secure browser refuses them all the same (a private window, blocked
 * storage), that stays quiet too: they are extras, the game plays the same.
 */

/** What a refusal leaves behind: nothing, see above. */
function refused(): undefined {
  return undefined;
}

/** Whether the page has what an install offer and a service worker need. */
function secureOrigin(): boolean {
  return window.isSecureContext === true;
}

/** Chromium's install offer; lib.dom does not declare it, other browsers make none. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
}

export interface Pwa {
  /** the browser offered to install the app, and the offer is still unused */
  installable: boolean;
  /** a newer version took over the service worker: a reload brings it */
  updated: boolean;
}

const NOTHING: Pwa = { installable: false, updated: false };
let state = NOTHING;
let offer: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function change(next: Partial<Pwa>): void {
  state = { ...state, ...next };
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The install offer and the update, kept up to date; nothing of either without a window. */
export function usePwa(): Pwa {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => NOTHING,
  );
}

/**
 * Holds the browser's install offer back from its own banner, for the join
 * screen's line. Call once, before the first render: the offer comes early.
 */
export function watchInstallOffer(): void {
  if (!secureOrigin()) {
    return;
  }
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    offer = event as BeforeInstallPromptEvent;
    change({ installable: true });
  });
  window.addEventListener('appinstalled', () => {
    offer = null;
    change({ installable: false });
  });
}

/** Opens the browser's install dialog; an offer serves once, so the line goes. */
export function install(): void {
  const used = offer;
  offer = null;
  change({ installable: false });
  used?.prompt().catch(refused);
}

/** Closes the update line; the next reload brings the new version all the same. */
export function dismissUpdate(): void {
  change({ updated: false });
}

/**
 * A page's own build files by address: those of `urls` on `origin` under
 * /assets/, which is where the build puts its scripts and stylesheets.
 */
export function pageAssets(urls: readonly string[], origin: string): string[] {
  return urls
    .map((url) => new URL(url, origin))
    .filter((url) => url.origin === origin && url.pathname.startsWith('/assets/'))
    .map((url) => url.pathname);
}

/** Whether a page built from `assets` is older than a worker serving `files`. */
export function isOlder(assets: readonly string[], files: readonly string[]): boolean {
  return assets.some((asset) => !files.includes(asset));
}

const NEWS: WorkerNews['kind'] = 'escapelab-sw';

function isNews(data: unknown): data is WorkerNews {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const { kind, files } = data as Partial<Record<keyof WorkerNews, unknown>>;
  return kind === NEWS && Array.isArray(files) && files.every((file) => typeof file === 'string');
}

/** The scripts and stylesheets this page loaded, by address. */
function ownAssets(): string[] {
  const urls = [...document.querySelectorAll('script[src]')].map((el) => el.getAttribute('src'));
  const links = document.querySelectorAll('link[rel="stylesheet"], link[rel="modulepreload"]');
  urls.push(...[...links].map((el) => el.getAttribute('href')));
  return pageAssets(
    urls.filter((url): url is string => url !== null),
    window.location.origin,
  );
}

/**
 * Registers the service worker once the page has loaded, and turns its news
 * that it took over into the update line where this page is an older build.
 * A page stays open for hours, so the worker is asked for a new version
 * whenever the page comes back into view.
 */
export function registerServiceWorker(): void {
  if (!secureOrigin() || !('serviceWorker' in navigator)) {
    return;
  }
  const workers = navigator.serviceWorker;
  workers.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (isNews(event.data) && isOlder(ownAssets(), event.data.files)) {
      change({ updated: true });
    }
  });
  workers.startMessages();
  const register = (): void => {
    workers.register('/sw.js').then((registration) => {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          // Offline it fails; the next time the page shows, it asks again.
          registration.update().catch(refused);
        }
      });
    }, refused);
  };
  if (document.readyState === 'complete') {
    register();
  } else {
    window.addEventListener('load', register, { once: true });
  }
}

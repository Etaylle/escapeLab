import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isOlder, pageAssets } from '../src/pwa.js';
import type * as PwaModule from '../src/pwa.js';
import { InstallLine, InstallOffer, UpdateLine, UpdateNotice } from '../src/screens/Install.js';

const noop = (): void => undefined;

describe('the install line', () => {
  it('offers the home screen in one line, the button first', () => {
    const html = renderToStaticMarkup(<InstallLine onInstall={noop} />);
    expect(html).toMatch(
      /^<p class="install-line"><button class="link"><svg class="icon icon-hex"/,
    );
    expect(html).toContain('</svg> Zum Startbildschirm hinzufügen</button>');
    expect(html).toContain('<span class="muted"> — startet dann ohne Browserleiste</span></p>');
  });

  it('renders nothing without a window, as in the join screen drawn on the server', () => {
    expect(renderToStaticMarkup(<InstallOffer />)).toBe('');
  });
});

describe('the update line', () => {
  it('says a new version is there, with the reload and a way to close it', () => {
    const html = renderToStaticMarkup(<UpdateLine onReload={noop} onDismiss={noop} />);
    expect(html).toBe(
      '<div class="update-line" role="status"><span>Neue Version —</span>' +
        '<button class="link update-line-reload">neu laden</button>' +
        '<button class="link update-line-close" aria-label="Schließen">✕</button></div>',
    );
  });

  it('renders nothing without a window', () => {
    expect(renderToStaticMarkup(<UpdateNotice />)).toBe('');
  });
});

/** Every console channel a word could go out on, watched and muted. */
function watchConsole(): ReturnType<typeof vi.spyOn>[] {
  return (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => undefined),
  );
}

/** Lets the rejections and callbacks already queued settle. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A stand-in window on a secure origin (localhost, https) or over plain http. */
function standInWindow(secure: boolean): EventTarget & { isSecureContext: boolean } {
  return Object.assign(new EventTarget(), { isSecureContext: secure });
}

describe('the install offer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  /** pwa.ts afresh, watching a stand-in window for the offer. */
  async function watching(secure = true): Promise<typeof PwaModule> {
    vi.stubGlobal('window', standInWindow(secure));
    const pwa = await import('../src/pwa.js');
    pwa.watchInstallOffer();
    return pwa;
  }

  /** Chromium's offer: an event with a dialog to open. */
  function offer(
    prompt = vi.fn(() => Promise.resolve()),
  ): Event & { prompt: ReturnType<typeof vi.fn> } {
    return Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt });
  }

  it("keeps the browser's own banner away and opens the dialog once", async () => {
    const pwa = await watching();
    const event = offer();
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    pwa.install();
    pwa.install();
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it('has nothing to open once the app is installed', async () => {
    const pwa = await watching();
    const event = offer();
    window.dispatchEvent(event);
    window.dispatchEvent(new Event('appinstalled'));
    pwa.install();
    expect(event.prompt).not.toHaveBeenCalled();
  });

  it('watches for nothing over plain http, as on a LAN address', async () => {
    const pwa = await watching(false);
    const event = offer();
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    pwa.install();
    expect(event.prompt).not.toHaveBeenCalled();
  });

  it('says nothing when the dialog will not open', async () => {
    const quiet = watchConsole();
    const pwa = await watching();
    window.dispatchEvent(offer(vi.fn(() => Promise.reject(new Error('no gesture')))));
    pwa.install();
    await settle();
    for (const channel of quiet) {
      expect(channel).not.toHaveBeenCalled();
    }
  });
});

describe('the service worker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  /** A browser's service worker container, recording what the page asks of it. */
  function container(register: () => Promise<unknown>) {
    return { register: vi.fn(register), addEventListener: vi.fn(), startMessages: vi.fn() };
  }

  /** pwa.ts afresh in a loaded page whose browser has `workers`. */
  async function loaded(
    secure: boolean,
    workers: ReturnType<typeof container>,
  ): Promise<typeof PwaModule> {
    vi.stubGlobal('window', standInWindow(secure));
    vi.stubGlobal('document', Object.assign(new EventTarget(), { readyState: 'complete' }));
    vi.stubGlobal('navigator', { serviceWorker: workers });
    return import('../src/pwa.js');
  }

  it('registers nothing over plain http, and says nothing', async () => {
    const quiet = watchConsole();
    const workers = container(() => Promise.resolve({}));
    (await loaded(false, workers)).registerServiceWorker();
    await settle();
    expect(workers.register).not.toHaveBeenCalled();
    expect(workers.addEventListener).not.toHaveBeenCalled();
    for (const channel of quiet) {
      expect(channel).not.toHaveBeenCalled();
    }
  });

  it('registers /sw.js on a secure origin', async () => {
    const workers = container(() => Promise.resolve({ update: () => Promise.resolve() }));
    (await loaded(true, workers)).registerServiceWorker();
    expect(workers.register).toHaveBeenCalledWith('/sw.js');
  });

  it('says nothing when a secure browser refuses it, as a private window does', async () => {
    const quiet = watchConsole();
    const refusal = new DOMException('The operation is insecure.', 'SecurityError');
    const workers = container(() => Promise.reject(refusal));
    (await loaded(true, workers)).registerServiceWorker();
    await settle();
    expect(workers.register).toHaveBeenCalled();
    for (const channel of quiet) {
      expect(channel).not.toHaveBeenCalled();
    }
  });
});

describe('an older page', () => {
  const ORIGIN = 'https://lab.test';

  it('knows its build files by the addresses its scripts and stylesheets load', () => {
    const loaded = [
      '/assets/index-1.js',
      'https://lab.test/assets/vendor-1.js',
      '/assets/index-1.css',
      'https://fonts.googleapis.com/css2?family=Caveat',
      '/src/main.tsx',
    ];
    expect(pageAssets(loaded, ORIGIN)).toEqual([
      '/assets/index-1.js',
      '/assets/vendor-1.js',
      '/assets/index-1.css',
    ]);
  });

  it('is older than a worker that does not serve every one of them', () => {
    const files = ['/', '/assets/index-2.js', '/assets/vendor-1.js', '/assets/index-2.css'];
    const current = ['/assets/index-2.js', '/assets/vendor-1.js', '/assets/index-2.css'];
    const older = ['/assets/index-1.js', '/assets/vendor-1.js', '/assets/index-2.css'];
    expect(isOlder(current, files)).toBe(false);
    expect(isOlder(older, files)).toBe(true);
  });

  it('is never older without build files of its own, as under `vite`', () => {
    expect(isOlder([], ['/'])).toBe(false);
  });
});

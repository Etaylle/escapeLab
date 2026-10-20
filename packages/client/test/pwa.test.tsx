import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isOlder, pageAssets } from '../src/pwa.js';
import type * as PwaModule from '../src/pwa.js';
import { InstallLine, InstallOffer, UpdateLine, UpdateNotice } from '../src/screens/Install.js';

const noop = (): void => undefined;

describe('the install line', () => {
  it('offers the home screen in one line, the button first', () => {
    const html = renderToStaticMarkup(<InstallLine onInstall={noop} />);
    expect(html).toMatch(/^<p class="install-line"><button class="link"><svg class="icon icon-hex"/);
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

describe('the install offer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  /** pwa.ts afresh, watching a stand-in window for the offer. */
  async function watching(): Promise<typeof PwaModule> {
    vi.stubGlobal('window', new EventTarget());
    const pwa = await import('../src/pwa.js');
    pwa.watchInstallOffer();
    return pwa;
  }

  /** Chromium's offer: an event with a dialog to open. */
  function offer(): Event & { prompt: ReturnType<typeof vi.fn> } {
    const prompt = vi.fn(() => Promise.resolve());
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

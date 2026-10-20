import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpsHint, needsHttps } from '../src/screens/HttpsHint.js';
import { JoinScreen } from '../src/screens/Join.js';

const LINE =
  '<p class="https-hint">Ohne HTTPS kein Mikrofon — der Host startet mit ' +
  '<code>pnpm cert</code></p>';

const noop = (): void => undefined;

describe('a page without https', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('needs it: no secure origin, as over plain http on a LAN address', () => {
    expect(needsHttps({ isSecureContext: false })).toBe(true);
  });

  it('does not on a secure origin: localhost, or https once the host made a certificate', () => {
    expect(needsHttps({ isSecureContext: true })).toBe(false);
  });

  it('says nothing where it cannot tell: no window, or a browser that does not say', () => {
    expect(needsHttps(undefined)).toBe(false);
    expect(needsHttps({})).toBe(false);
    expect(renderToStaticMarkup(<HttpsHint />)).toBe('');
  });

  it('gets one line naming what is missing and who can fix it', () => {
    vi.stubGlobal('window', { isSecureContext: false });
    expect(renderToStaticMarkup(<HttpsHint />)).toBe(LINE);
    vi.stubGlobal('window', { isSecureContext: true });
    expect(renderToStaticMarkup(<HttpsHint />)).toBe('');
  });

  it('shows the line on the join screen, between the introduction and the name', () => {
    const join = (isSecureContext: boolean): string => {
      vi.stubGlobal('window', { location: { search: '' }, isSecureContext });
      return renderToStaticMarkup(
        <JoinScreen send={noop} connected missions={[]} rooms={[]} openHandbook={noop} />,
      );
    };
    expect(join(false)).toContain(`Rücken an Rücken, los.</p>${LINE}<label>Dein Name`);
    expect(join(true)).not.toContain('https-hint');
  });
});

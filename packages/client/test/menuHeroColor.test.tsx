import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountView } from '@escapelab/core';
import { PASS_KEY } from '../src/pass.js';
import { JoinScreen } from '../src/screens/Join.js';
import { FIRST_COLOR } from '../src/screens/ProfileChip.js';
import { storage } from './page.js';

/**
 * The hero in the colour the profile shows (screens/Join.tsx, MenuHero.tsx): the account's,
 * where the server told one; else the one the pass kept from a lobby; else the crew's first.
 * The hero stands in for itself here as a mark of the colour it is handed.
 */

vi.mock('../src/screens/MenuHero.js', async () => {
  const { createElement } = await import('react');
  return {
    MenuHero: ({ color }: { color: string }) => createElement('i', { 'data-hero': color }),
  };
});

const noop = (): void => undefined;

/** Anna's account as a server tells it: the colour she chose in a lobby. */
const ANNA: AccountView = {
  name: 'Anna',
  color: '#a78bfa',
  since: Date.UTC(2026, 10, 1, 12),
  runs: 3,
  achievements: {},
  store: 'database',
};

/** Anna's browser, the pass keeping `color` from the last lobby. */
function browser(color: string | null): void {
  const pass = { id: 'a1'.repeat(16), secret: '0f'.repeat(32), name: 'Anna', color };
  const local = new Map([[PASS_KEY, JSON.stringify(pass)]]);
  const history = { state: null, replaceState: noop };
  vi.stubGlobal('window', { localStorage: storage(local), location: { search: '' }, history });
  vi.stubGlobal('sessionStorage', storage(new Map()));
}

/** The start screen with `account` told, and the colours its profile and its hero wear. */
function colours(account: AccountView | null): {
  profile: string | undefined;
  hero: string | undefined;
} {
  const html = renderToStaticMarkup(
    <JoinScreen
      send={noop}
      connected
      missions={[]}
      rooms={[]}
      seat={null}
      account={account}
      stats={[]}
      picked={null}
      onPick={noop}
      openHandbook={noop}
      openHistory={noop}
      openEditor={noop}
      openSettings={noop}
    />,
  );
  return {
    profile: /class="profile-dot" style="background:([^";]+)/.exec(html)?.[1],
    hero: /data-hero="([^"]+)"/.exec(html)?.[1],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the hero’s colour', () => {
  it('is the account’s once the server told one, as the profile’s is', () => {
    browser('#f472b6');
    expect(colours(ANNA)).toEqual({ profile: '#a78bfa', hero: '#a78bfa' });
  });

  it('is the colour the pass kept before, or with an account that chose none', () => {
    browser('#f472b6');
    expect(colours(null)).toEqual({ profile: '#f472b6', hero: '#f472b6' });
    expect(colours({ ...ANNA, color: null })).toEqual({ profile: '#f472b6', hero: '#f472b6' });
  });

  it('is the crew’s first before any', () => {
    browser(null);
    expect(colours(null)).toEqual({ profile: FIRST_COLOR, hero: FIRST_COLOR });
  });
});

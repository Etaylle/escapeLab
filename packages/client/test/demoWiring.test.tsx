import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEMO_CODE, type ClientMessage, type MissionInfo, type Seat } from '@escapelab/core';
import { Screens } from '../src/App.js';
import { PASS_KEY } from '../src/pass.js';
import { JoinScreen } from '../src/screens/Join.js';
import type { MenuItemId } from '../src/screens/MainMenu.js';
import type { Connection, Restoring } from '../src/ws.js';
import { storage } from './page.js';

/**
 * The demo's wiring, where the screens hand its parts on: the menu's „Demo" reaching the line,
 * the link taken by the first menu, the demo's own screen for the demo room alone, the link read as
 * the page comes up, and the audience's ways tall enough for a finger. Each screen is rendered as
 * the app renders it, its effects run as the page runs them.
 */

const stage = vi.hoisted(() => ({
  /** what the menu last shown hands a click on one of its items */
  pick: null as ((item: never) => void) | null,
  /** `demo` as each audience screen shown was given it */
  demo: [] as unknown[],
  cleanups: [] as (() => void)[],
  /** what the page did as it came up, in order */
  boot: [] as string[],
}));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useEffect: (effect: () => void | (() => void)) => {
    const cleanup = effect();
    if (typeof cleanup === 'function') {
      stage.cleanups.push(cleanup);
    }
  },
}));

vi.mock('../src/screens/MainMenu.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  MainMenu: (props: { onPick: (item: never) => void }) => {
    stage.pick = props.onPick;
    return null;
  },
}));

vi.mock('../src/screens/Spectate.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  SpectateScreen: (props: { demo?: boolean }) => {
    stage.demo.push(props.demo === true ? 'the demo’s audience' : 'an audience');
    return null;
  },
}));

vi.mock('../src/screens/Demo.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DemoScreen: (props: { feed: unknown }) => {
    stage.demo.push(props.feed);
    return null;
  },
}));

const noop = (): void => undefined;

const blackout: MissionInfo = {
  id: 'blackout',
  title: 'Blackout im Labor',
  subtitle: 'Der Klassiker.',
  players: { min: 2, max: 3 },
  timeLimitSec: 900,
  puzzleCount: 6,
  tiles: [],
};

/** A seat in a lobby, where the browser's pass sits. */
const SEAT: Seat = {
  code: 'QX7R',
  missionTitle: 'Blackout im Labor',
  phase: 'lobby',
  paused: false,
  crew: ['Anna', 'Ben'],
  leftMs: null,
};

/** Anna's browser at `address`, her pass kept. */
function pageAt(address: string): void {
  const { origin, pathname, search, hash } = new URL(address, 'https://escapelab.test');
  const pass = { id: 'a1'.repeat(16), secret: '0f'.repeat(32), name: 'Anna', color: null };
  vi.stubGlobal('window', {
    location: { origin, pathname, search, hash },
    history: { state: null, replaceState: noop },
    localStorage: storage(new Map([[PASS_KEY, JSON.stringify(pass)]])),
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    addEventListener: noop,
    removeEventListener: noop,
  });
  vi.stubGlobal('sessionStorage', storage(new Map()));
}

/** The start screen shown and taken down again; what it sent on its line meanwhile. */
function menu(more: {
  connected?: boolean;
  seat?: Seat;
  restoring?: Restoring;
  pick?: MenuItemId;
}): ClientMessage[] {
  const sent: ClientMessage[] = [];
  renderToStaticMarkup(
    <JoinScreen
      send={(msg) => void sent.push(msg)}
      connected={more.connected ?? true}
      name="Anna"
      onName={noop}
      missions={[blackout]}
      rooms={[]}
      seat={more.seat ?? null}
      restoring={more.restoring ?? null}
      stats={[]}
      picked={null}
      onPick={noop}
      openHandbook={noop}
      openHistory={noop}
    />,
  );
  stage.cleanups.splice(0).forEach((cleanup) => cleanup());
  if (more.pick !== undefined) {
    stage.pick?.(more.pick as never);
  }
  return sent.filter((msg) => msg.kind === 'spectate');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  stage.pick = null;
  stage.demo = [];
  stage.boot = [];
});

const WATCH = { kind: 'spectate', code: DEMO_CODE };

describe('the start screen and the demo', () => {
  it('asks for the demo room as „Demo" is picked, and for nothing before', () => {
    pageAt('/');
    expect(menu({})).toEqual([]);
    expect(menu({ pick: 'demo' })).toEqual([WATCH]);
    expect(menu({ pick: 'handbook' })).toEqual([]);
  });

  it('asks for it unpicked where the page came by the demo’s link — the first menu alone', () => {
    pageAt('/?demo=1');
    expect(menu({})).toEqual([WATCH]);
    expect(menu({})).toEqual([]);
  });

  it('leaves the link untaken while its line is down, and takes it as the line is up', () => {
    pageAt('/?demo=1');
    expect(menu({ connected: false })).toEqual([]);
    expect(menu({})).toEqual([WATCH]);
  });

  it('leaves the link untaken while the card’s way back waits for its room', () => {
    pageAt('/?demo=1');
    const restoring = { code: SEAT.code, since: 0 };
    expect(menu({ seat: SEAT, restoring })).toEqual([]);
    // The room back or given up, the menu that follows takes it.
    expect(menu({ seat: SEAT })).toEqual([WATCH]);
  });
});

/** The demo's feed as a connection keeps it. */
const FEED = { shot: null, views: {} };

/** The app's screen for a connection that watches the room `roomCode`. */
function watching(roomCode: string): unknown[] {
  const conn = { spectatorView: {}, roomCode, demo: FEED } as unknown as Connection;
  const props = { conn, finale: null } as unknown as Parameters<typeof Screens>[0];
  renderToStaticMarkup(<Screens {...props} />);
  return stage.demo.splice(0);
}

describe('the audience’s screen as the app shows it', () => {
  it('is the demo’s own, with its feed, for the demo room — and for no other', () => {
    expect(watching(DEMO_CODE)).toEqual([FEED]);
    expect(watching('QX7R')).toEqual(['an audience']);
    expect(watching('DEMO2')).toEqual(['an audience']);
  });
});

vi.mock('react-dom/client', () => ({
  createRoot: () => ({ render: () => void stage.boot.push('render') }),
}));

describe('the page as it comes up', () => {
  it('reads the demo’s link off the address before the editor reads the address', async () => {
    vi.doMock('../src/demoLink.js', () => ({
      readDemoLink: () => void stage.boot.push('link'),
    }));
    vi.doMock('../src/editor/session.js', async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      bootEditor: () => {
        stage.boot.push('editor');
        return Promise.resolve({ open: false, work: null, status: null });
      },
      sessionStore: () => null,
    }));
    vi.doMock('../src/App.js', () => ({ App: () => null }));
    vi.doMock('../src/settings.js', () => ({ startSettings: noop }));
    vi.doMock('../src/pwa.js', () => ({ registerServiceWorker: noop, watchInstallOffer: noop }));
    pageAt('/?demo=1');
    vi.stubGlobal('document', { getElementById: () => ({}) });
    await import('../src/main.js');
    await vi.waitFor(() => expect(stage.boot).toContain('render'));
    expect(stage.boot).toEqual(['link', 'editor', 'render']);
    vi.doUnmock('../src/demoLink.js');
    vi.doUnmock('../src/editor/session.js');
    vi.doUnmock('../src/App.js');
    vi.doUnmock('../src/settings.js');
    vi.doUnmock('../src/pwa.js');
  });
});

describe('the audience’s ways under a finger', () => {
  it('are 44 px tall: listening in and „Zuschauen beenden" at the screen’s foot', () => {
    const sheet = readFileSync(new URL('../src/ui.css', import.meta.url), 'utf8');
    const at = sheet.indexOf('@media (pointer: coarse) {\n  .spectate-foot button.link {');
    expect(at).toBeGreaterThan(0);
    const rule = sheet.slice(at, sheet.indexOf('\n}\n', at));
    expect(rule).toMatch(/display: inline-flex;\s*align-items: center;/);
    expect(Number(/min-height: (\d+)px;/.exec(rule)?.[1])).toBeGreaterThanOrEqual(44);
  });
});

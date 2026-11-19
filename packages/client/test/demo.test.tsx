import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEMO_CODE, type SpectatorView } from '@escapelab/core';
import { WORLD, offVoice } from '../../core/test/voice.js';
import { asksForDemo, readDemoLink, takeDemoLink } from '../src/demoLink.js';
import { demoWay, leaveFor, pickOf } from '../src/screens/Join.js';
import { MENU_LABELS, menuItems, opensPanel } from '../src/screens/MainMenu.js';
import { DEMO_LINE, SpectateScreen } from '../src/screens/Spectate.js';

/**
 * „Demo" in the main menu, the demo's link and the line over the demo room's audience: the way
 * into the room the server plays itself (server demo/host.ts), with no name and no code.
 */

const wipe = vi.hoisted(() => ({ doors: vi.fn(), shutter: vi.fn() }));
vi.mock('../src/screens/DoorWipe.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  doorsThen: wipe.doors,
  shutterThen: wipe.shutter,
}));

const noop = (): void => undefined;
const css = (file: string): string =>
  readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');

/** The body of the first rule of `sheet` whose selector line is `selector`. */
function ruleOf(sheet: string, selector: string): string {
  const at = sheet.indexOf(`\n${selector} {`);
  expect(at, selector).toBeGreaterThan(0);
  return sheet.slice(sheet.indexOf('{', at) + 1, sheet.indexOf('}', at));
}

/** A page at `address`: its location, and every address its history was given since. */
function pageAt(address: string) {
  const url = new URL(address, 'https://escapelab.test');
  const location = { pathname: url.pathname, search: url.search, hash: url.hash };
  const replaced: string[] = [];
  const history = {
    state: null,
    replaceState: (_state: unknown, _title: string, to: string) => void replaced.push(to),
  };
  vi.stubGlobal('window', { location, history });
  return { replaced };
}

afterEach(() => {
  vi.unstubAllGlobals();
  wipe.doors.mockReset();
  wipe.shutter.mockReset();
});

describe('„Demo" in the main menu', () => {
  it('stands after the ways into a round, opens no panel and is a target of 46 px', () => {
    const items = menuItems(false);
    expect(items.indexOf('demo')).toBe(items.indexOf('rounds') + 1);
    expect(MENU_LABELS.demo).toBe('Demo');
    expect(opensPanel('demo')).toBe(false);
    const item = ruleOf(css('styles/menu.css'), '.menu-list .menu-item');
    expect(Number(/min-height: (\d+)px;/.exec(item)?.[1])).toBeGreaterThanOrEqual(44);
  });

  it('asks for the demo room by its code alone, at once: the room’s own doors do the rest', () => {
    const send = vi.fn();
    const taken = vi.fn();
    pickOf(demoWay(send, true), noop, taken)('demo');
    expect(send.mock.calls).toEqual([[{ kind: 'spectate', code: DEMO_CODE }]]);
    expect(DEMO_CODE).toBe('DEMO');
    expect(taken).toHaveBeenCalledWith({ at: expect.any(Number), toward: true });
    expect(wipe.doors).not.toHaveBeenCalled();
    expect(wipe.shutter).not.toHaveBeenCalled();
    // Any other page waits behind its shutter.
    leaveFor('handbook', noop);
    expect(wipe.shutter).toHaveBeenCalledTimes(1);
  });

  it('fits a laptop’s low window, and leaves a phone held sideways its seven items', () => {
    const menu = css('styles/menu.css');
    const low = menu.slice(menu.indexOf('@media (min-width: 900px) and (max-height: 760px) {'));
    expect(low.slice(0, low.indexOf('\n}\n'))).toMatch(
      /\.menu-list \.menu-item \{\s*min-height: 44px;/,
    );
    const sideways = menu.slice(
      menu.indexOf('@media (orientation: landscape) and (max-height: 500px) {'),
    );
    const hidden = (item: string): string => `li:has\\(> \\.menu-item\\[data-item='${item}'\\]\\)`;
    expect(sideways).toMatch(
      new RegExp(`${hidden('settings')},\\s*\\.menu-list ${hidden('demo')} \\{\\s*display: none;`),
    );
  });

  it('leads nowhere while the line is down', () => {
    const send = vi.fn();
    const taken = vi.fn();
    pickOf(demoWay(send, false), noop, taken)('demo');
    expect(send).not.toHaveBeenCalled();
    expect(taken).toHaveBeenCalledWith({ at: expect.any(Number), toward: false });
  });
});

describe('the demo’s link', () => {
  it('is ?demo=1, and nothing else', () => {
    expect(asksForDemo('?demo=1')).toBe(true);
    expect(asksForDemo('?gl=off&demo=1')).toBe(true);
    for (const search of ['', '?demo=0', '?demo', '?demo=true', '?room=DEMO']) {
      expect(asksForDemo(search), search).toBe(false);
    }
  });

  it('is taken off the address as the page reads it, the rest of the address kept', () => {
    const { replaced } = pageAt('/?gl=off&demo=1#x');
    expect(readDemoLink().asked).toBe(true);
    expect(replaced).toEqual(['/?gl=off#x']);
    // Read once a page: the address is cleaned no second time.
    readDemoLink();
    expect(replaced).toHaveLength(1);
  });

  it('is taken by the first menu of the page alone', () => {
    pageAt('/?demo=1');
    expect(takeDemoLink()).toBe(true);
    expect(takeDemoLink()).toBe(false);
  });

  it('is none on a plain address, which stays as it is', () => {
    const { replaced } = pageAt('/?seed=12');
    expect(takeDemoLink()).toBe(false);
    expect(replaced).toEqual([]);
    // A demo switched off in the address is no link, and goes off the address all the same.
    const off = pageAt('/?demo=0');
    expect(takeDemoLink()).toBe(false);
    expect(off.replaced).toEqual(['/']);
  });
});

/** The demo room's audience as the first of it finds it: the crew of two in its lobby. */
const LOBBY = {
  phase: 'lobby',
  missionTitle: 'Blackout im Labor',
  difficulty: 'normal',
  currentPuzzleIndex: 0,
  puzzleCount: 6,
  penaltySeq: 0,
  pausedAt: null,
  startedAt: null,
  deadlineAt: null,
  lights: { out: false, outAt: null },
  players: [
    { id: 'a', name: 'Automat A', color: '#2dd4bf', connected: true },
    { id: 'b', name: 'Automat B', color: '#f472b6', connected: true },
  ],
  panels: [],
  events: [],
  away: [],
  puzzle: null,
  edgework: null,
  map: null,
} as unknown as SpectatorView;

/** The audience's screen on `LOBBY`, of the demo room or of any other. */
function audience(demo: boolean): string {
  return renderToStaticMarkup(
    <SpectateScreen
      view={LOBBY}
      finale={null}
      positionsRef={{ current: { run: null, players: {} } }}
      dronesRef={{ current: {} }}
      pingsRef={{ current: [] }}
      chatsRef={{ current: [] }}
      leaveRoom={noop}
      demo={demo}
    />,
  );
}

describe('the demo room’s audience', () => {
  it('reads one line that the plant plays by itself, and any other room’s audience none', () => {
    expect(audience(true)).toContain(`<p class="demo-line">${DEMO_LINE}</p>`);
    expect(audience(false)).not.toContain('demo-line');
    expect(audience(true)).toContain('Automat A');
    expect(audience(true)).toContain('Zuschauen beenden');
  });

  it('says it in the world’s voice, at 14 px by the text size set', () => {
    expect(DEMO_LINE).toBe(
      'Vorführbetrieb: Die Anlage fährt diesen Einsatz selbst, ' +
        'an den Pulten stehen zwei Automaten.',
    );
    expect(offVoice([DEMO_LINE], WORLD)).toEqual([]);
    const line = ruleOf(css('ui.css'), '.demo-line');
    expect(line).toContain('font-size: calc(14px * var(--text-scale));');
  });
});
